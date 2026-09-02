/**
 * Tenant-scoped persistence reads owned by the S08 availability service.
 *
 * This module intentionally exposes only the two pieces of configuration that
 * S08 needs from persistence: the realized GENERAL opening position and the
 * effective operational buffer. Forecast rows remain the S07 source of truth
 * and are never queried again here.
 */
import { and, desc, eq, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  accounts,
} from "@/db/accounts-categories-schema";
import { accountEntries } from "@/db/financial-events-schema";
import {
  spendableSettings,
  type SpendableSettingRecord,
} from "@/db/spendable-schema";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { TransactionReferenceExecutor } from "@/modules/transactions/references";
import { spendableDate, spendableNonNegativeCents } from "./contracts";

/** A database or an already-open Drizzle transaction. */
export type SpendableReadExecutor = TransactionReferenceExecutor;

export interface SpendableQueryOptions {
  readonly database?: SpendableReadExecutor;
}

export interface SpendableOpeningBalanceReadModel {
  readonly householdId: string;
  readonly asOf: string;
  readonly openingBalanceCents: string;
  /** Aggregate count is technical telemetry only and never crosses the API. */
  readonly generalAccountCount: number;
}

export interface SpendableBufferReadModel {
  readonly householdId: string;
  readonly amountCents: string;
  readonly source: "CONFIGURED" | "ABSENT_DEFAULT_ZERO";
  readonly effectiveFrom: string | null;
  readonly revision: string | null;
}

export class SpendableQueryError extends Error {
  readonly code = "SPENDABLE_READ_FAILED" as const;
  readonly field: string | null;

  constructor(field: string | null = null) {
    super("SPENDABLE_READ_FAILED");
    this.name = "SpendableQueryError";
    this.field = field;
  }
}

export class SpendableResourceNotFoundError extends Error {
  readonly code = "SPENDABLE_NOT_FOUND" as const;
  readonly field = null;

  constructor() {
    super("SPENDABLE_NOT_FOUND");
    this.name = "SpendableResourceNotFoundError";
  }
}

function resolveExecutor(database?: SpendableReadExecutor): SpendableReadExecutor {
  return database ?? getDb();
}

function parseAsOf(value: unknown): string {
  try {
    return spendableDate(value, "asOf").toString();
  } catch {
    throw new SpendableQueryError("asOf");
  }
}

function decimalString(value: unknown, field: string): string {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value !== "string" || !/^-?\d+$/u.test(value)) {
    throw new SpendableQueryError(field);
  }
  try {
    return BigInt(value).toString(10);
  } catch {
    throw new SpendableQueryError(field);
  }
}

function aggregateCount(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new SpendableQueryError("generalAccountCount");
}

function assertReturnedHousehold(value: unknown, context: FinancialContext): void {
  if (value !== undefined && value !== null && value !== context.householdId) {
    // A malformed/foreign adapter response is indistinguishable from an
    // absent resource at the public boundary.
    throw new SpendableResourceNotFoundError();
  }
}

/**
 * Reads the realized opening balance from POSTED entries belonging to
 * GENERAL accounts in the resolved household. The household predicate is
 * repeated on both sides of the relationship so an id copied from another
 * tenant cannot contribute to the sum.
 */
export async function readSpendableOpeningBalanceForContext(
  context: FinancialContext,
  asOf: string,
  options: SpendableQueryOptions = {},
): Promise<SpendableOpeningBalanceReadModel> {
  assertFinancialContext(context);
  const normalizedAsOf = parseAsOf(asOf);
  const executor = resolveExecutor(options.database);

  try {
    const rows = await executor
      .select({
        balanceCents: sql<string>`coalesce(sum(${accountEntries.amountCents}), 0)::text`,
        generalAccountCount: sql<number>`count(distinct ${accounts.id})::int`,
      })
      .from(accountEntries)
      .innerJoin(
        accounts,
        and(
          eq(accountEntries.accountId, accounts.id),
          eq(accountEntries.householdId, accounts.householdId),
          eq(accountEntries.householdId, context.householdId),
          eq(accounts.householdId, context.householdId),
          eq(accounts.spendability, "GENERAL"),
        ),
      )
      .where(
        and(
          eq(accountEntries.householdId, context.householdId),
          eq(accountEntries.status, "POSTED"),
          lte(accountEntries.postedOn, normalizedAsOf),
          eq(accounts.householdId, context.householdId),
          eq(accounts.spendability, "GENERAL"),
        ),
      );

    const row = rows[0];
    if (!row) throw new SpendableQueryError();
    const openingBalanceCents = decimalString(row.balanceCents, "openingBalanceCents");
    const generalAccountCount = aggregateCount(row.generalAccountCount);
    return {
      householdId: context.householdId,
      asOf: normalizedAsOf,
      openingBalanceCents,
      generalAccountCount,
    };
  } catch (error) {
    if (error instanceof SpendableQueryError || error instanceof SpendableResourceNotFoundError) {
      throw error;
    }
    throw new SpendableQueryError();
  }
}

/**
 * Selects the latest setting effective on or before `asOf`. There is no
 * fallback to another tenant: both the WHERE and ordering are household
 * scoped, and no row is returned when the configuration is absent.
 */
export async function readSpendableBufferForContext(
  context: FinancialContext,
  asOf: string,
  options: SpendableQueryOptions = {},
): Promise<SpendableBufferReadModel> {
  assertFinancialContext(context);
  const normalizedAsOf = parseAsOf(asOf);
  const executor = resolveExecutor(options.database);

  try {
    const rows = await executor
      .select({
        id: spendableSettings.id,
        householdId: spendableSettings.householdId,
        effectiveFrom: spendableSettings.effectiveFrom,
        operationalBufferCents: spendableSettings.operationalBufferCents,
      })
      .from(spendableSettings)
      .where(
        and(
          eq(spendableSettings.householdId, context.householdId),
          lte(spendableSettings.effectiveFrom, normalizedAsOf),
        ),
      )
      .orderBy(
        desc(spendableSettings.effectiveFrom),
        desc(spendableSettings.id),
      )
      .limit(1);

    const row = rows[0] as
      | Pick<SpendableSettingRecord, "id" | "householdId" | "effectiveFrom" | "operationalBufferCents">
      | undefined;
    if (!row) {
      return {
        householdId: context.householdId,
        amountCents: "0",
        source: "ABSENT_DEFAULT_ZERO",
        effectiveFrom: null,
        revision: null,
      };
    }

    assertReturnedHousehold(row.householdId, context);
    const effectiveFrom = spendableDate(row.effectiveFrom, "effectiveFrom").toString();
    const amount = spendableNonNegativeCents(
      row.operationalBufferCents,
      "operationalBufferCents",
    ).toString(10);
    return {
      householdId: context.householdId,
      amountCents: amount,
      source: "CONFIGURED",
      effectiveFrom,
      revision: typeof row.id === "string" ? row.id : null,
    };
  } catch (error) {
    if (error instanceof SpendableQueryError || error instanceof SpendableResourceNotFoundError) {
      throw error;
    }
    throw new SpendableQueryError();
  }
}

export const readSpendableBalanceForContext = readSpendableOpeningBalanceForContext;
export const getSpendableOpeningBalanceForContext = readSpendableOpeningBalanceForContext;
export const readOperationalBufferForContext = readSpendableBufferForContext;
export const getSpendableBufferForContext = readSpendableBufferForContext;
