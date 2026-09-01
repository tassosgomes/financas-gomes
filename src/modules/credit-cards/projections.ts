import { Temporal } from "@js-temporal/polyfill";
import {
  and,
  asc,
  eq,
  gt,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  type AccountRecord,
} from "@/db/accounts-categories-schema";
import {
  accountEntries,
  financialEvents,
  type AccountEntryRecord,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  installmentPlans,
  installments,
  type CreditCardRecord,
  type CreditCardPurchaseRecord,
  type InstallmentPlanRecord,
  type InstallmentRecord,
} from "@/db/credit-cards-schema";
import { isUuidV7 } from "@/lib/uuidv7";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  currentFinancialDate,
  formatFinancialDate,
  parseFinancialDate,
  type FinancialDate,
} from "@/modules/transactions/dates";
import {
  createS06CreditCardOperation,
  measureS06Query,
  withS06CreditCardObservability,
  type S06CreditCardOperation,
} from "@/modules/observability/s06";

import {
  CreditCardDomainError,
  failure,
  ok,
  type CreditCardProjectionItemState,
  type CreditCardProjectionPaymentState,
  type CreditCardProjectionQuery,
  type CreditCardProjectionReadModel,
  type CreditCardProjectionSummaryReadModel,
  type CreditCardResult,
  type CreditCardStatementItemReadModel,
  type CreditCardStatementPaymentReadModel,
  type CreditCardStatementReadModel,
} from "./contracts";
import { resolveBillingCycle, type BillingRule } from "./billing-cycle";

/** A read query may use a direct database or an injected deterministic date. */
export interface CreditCardProjectionQueryOptions {
  database?: Database;
  today?: FinancialDate | string;
}

interface NormalizedProjectionQuery {
  cardId: string;
  period?: string;
  from?: string;
  to?: string;
  asOf: string;
}

interface ProjectionRow {
  installment: InstallmentRecord;
  purchase: CreditCardPurchaseRecord;
  plan: InstallmentPlanRecord;
  event: FinancialEventRecord;
  entry: AccountEntryRecord | null;
}

interface PaymentRow {
  event: FinancialEventRecord;
  entry: AccountEntryRecord;
}

interface StatementBucket {
  period: string;
  items: CreditCardStatementItemReadModel[];
  totalAmountCents: bigint;
  dueDates: string[];
  minDueOn: string;
}

interface StatementAllocation {
  paidAmountCents: bigint;
  remainingAmountCents: bigint;
  creditAmountCents: bigint;
  state: CreditCardProjectionPaymentState;
}

const PERIOD_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ALLOWED_QUERY_KEYS = new Set([
  "cardId",
  "period",
  "billingCycle",
  "competence",
  "from",
  "to",
  "asOf",
]);

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function toCents(value: bigint | number | string): string {
  return typeof value === "bigint" ? value.toString(10) : String(value);
}

function asBigInt(value: bigint | number | string): bigint {
  try {
    return typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
  }
}

function normalizeDate(value: unknown, field: "asOf" | "from" | "to"): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new CreditCardDomainError("INVALID_DATE", field);
  }
  try {
    return formatFinancialDate(parseFinancialDate(value));
  } catch {
    throw new CreditCardDomainError("INVALID_DATE", field);
  }
}

function normalizePeriod(value: unknown): string {
  if (typeof value !== "string" || !PERIOD_PATTERN.test(value)) {
    throw new CreditCardDomainError("INVALID_STATEMENT_PERIOD", "period");
  }
  try {
    Temporal.PlainYearMonth.from(value, { overflow: "reject" });
  } catch {
    throw new CreditCardDomainError("INVALID_STATEMENT_PERIOD", "period");
  }
  return value;
}

function normalizeProjectionQuery(
  input: unknown,
  today?: FinancialDate | string,
): NormalizedProjectionQuery {
  if (typeof input === "string") {
    input = { cardId: input };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CreditCardDomainError("INVALID_PROJECTION_QUERY");
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      // In particular, householdId is never accepted as a read authority.
      throw new CreditCardDomainError("INVALID_PROJECTION_QUERY");
    }
  }

  const cardId = record.cardId;
  if (typeof cardId !== "string" || !isUuidV7(cardId.trim())) {
    throw new CreditCardDomainError("INVALID_CARD_ID", "cardId");
  }

  const periodInputs = [record.period, record.billingCycle, record.competence]
    .filter((value): value is string => value !== undefined);
  let period: string | undefined;
  if (periodInputs.length > 0) {
    const normalizedPeriods = periodInputs.map(normalizePeriod);
    if (normalizedPeriods.some((value) => value !== normalizedPeriods[0])) {
      throw new CreditCardDomainError("INVALID_PROJECTION_QUERY", "period");
    }
    period = normalizedPeriods[0];
  }

  const from = record.from === undefined ? undefined : normalizeDate(record.from, "from");
  const to = record.to === undefined ? undefined : normalizeDate(record.to, "to");
  if (from !== undefined && to !== undefined && from > to) {
    throw new CreditCardDomainError("INVALID_PROJECTION_QUERY", "from");
  }
  if (period !== undefined &&
      ((from !== undefined && period < from.slice(0, 7)) ||
        (to !== undefined && period > to.slice(0, 7)))) {
    throw new CreditCardDomainError("INVALID_PROJECTION_QUERY", "period");
  }

  const defaultToday =
    typeof today === "string"
      ? normalizeDate(today, "asOf")
      : formatFinancialDate(today ?? currentFinancialDate());
  const asOf = record.asOf === undefined
    ? defaultToday
    : normalizeDate(record.asOf, "asOf");

  return {
    cardId: cardId.trim(),
    ...(period ? { period } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    asOf,
  };
}

function emptyStatement(
  context: FinancialContext,
  cardId: string,
  period: string,
  kind: "CURRENT" | "FUTURE",
): CreditCardStatementReadModel {
  return {
    householdId: context.householdId,
    cardId,
    period,
    kind,
    dueOn: null,
    totalAmountCents: "0",
    items: [],
    payment: {
      state: "UNPAID",
      statementAmountCents: "0",
      paidAmountCents: "0",
      remainingAmountCents: "0",
      creditAmountCents: "0",
    },
  };
}

function itemState(
  installment: InstallmentRecord,
  entry: AccountEntryRecord,
): CreditCardProjectionItemState {
  return installment.status === "POSTED" || entry.status === "POSTED"
    ? "CONFIRMED"
    : "PROJECTED";
}

function statementItem(row: ProjectionRow): CreditCardStatementItemReadModel {
  const { installment, purchase, plan, event, entry } = row;
  if (!entry || entry.installmentId !== installment.id || entry.accountId === "") {
    throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
  }
  if (
    entry.status === "POSTED" &&
    (entry.postedOn === null || entry.expectedOn !== null)
  ) {
    throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
  }
  if (
    entry.status === "EXPECTED" &&
    (entry.expectedOn === null || entry.postedOn !== null)
  ) {
    throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
  }
  const amount = asBigInt(installment.amountCents);
  if (amount <= BigInt(0) || plan.totalAmountCents <= BigInt(0)) {
    throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
  }
  const period = installment.billingCycle.slice(0, 7);
  if (!PERIOD_PATTERN.test(period)) {
    throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
  }
  return {
    referenceId: installment.id,
    purchaseId: purchase.id,
    installmentId: installment.id,
    financialEventId: event.id,
    cardId: purchase.cardId,
    description: event.description,
    amountCents: toCents(amount),
    occurredOn: event.occurredOn,
    billingCycle: period,
    dueOn: installment.billingDueOnOverride ?? installment.billingDueOn,
    installmentNumber: installment.sequence,
    installmentCount: plan.installmentCount,
    installmentStatus: installment.status,
    entryStatus: entry.status,
    state: itemState(installment, entry),
    origin: "PURCHASE",
  };
}

function groupRows(rows: readonly ProjectionRow[]): StatementBucket[] {
  const groups = new Map<string, StatementBucket>();
  for (const row of rows) {
    const item = statementItem(row);
    const existing = groups.get(item.billingCycle);
    if (existing) {
      existing.items.push(item);
      existing.totalAmountCents += asBigInt(item.amountCents);
      existing.dueDates.push(item.dueOn);
      existing.minDueOn = existing.minDueOn < item.dueOn
        ? existing.minDueOn
        : item.dueOn;
      continue;
    }
    groups.set(item.billingCycle, {
      period: item.billingCycle,
      items: [item],
      totalAmountCents: asBigInt(item.amountCents),
      dueDates: [item.dueOn],
      minDueOn: item.dueOn,
    });
  }
  return [...groups.values()].sort((left, right) =>
    left.minDueOn.localeCompare(right.minDueOn) ||
    left.period.localeCompare(right.period),
  );
}

function paymentState(
  statementAmountCents: bigint,
  paidAmountCents: bigint,
  creditAmountCents: bigint,
): CreditCardProjectionPaymentState {
  if (statementAmountCents <= BigInt(0)) {
    return "UNPAID";
  }
  if (paidAmountCents <= BigInt(0)) {
    return "UNPAID";
  }
  if (paidAmountCents < statementAmountCents) {
    return "PARTIALLY_PAID";
  }
  return creditAmountCents > BigInt(0) ? "CREDIT" : "PAID";
}

/**
 * Applies global card credits to statement buckets in due-date order. No
 * installment is mutated or marked paid; this is only a deterministic read
 * projection. The helper is exported for unit tests and S07 adapters.
 */
export function allocateGlobalCardPayments(
  buckets: readonly Pick<StatementBucket, "period" | "totalAmountCents" | "minDueOn">[],
  creditsCents: bigint,
): ReadonlyMap<string, StatementAllocation> {
  let remainingCredits = creditsCents > BigInt(0) ? creditsCents : BigInt(0);
  const totalDebt = buckets.reduce(
    (total, bucket) => total + asBigInt(bucket.totalAmountCents),
    BigInt(0),
  );
  const globalCredit = remainingCredits > totalDebt
    ? remainingCredits - totalDebt
    : BigInt(0);
  const result = new Map<string, StatementAllocation>();
  const ordered = [...buckets].sort((left, right) =>
    left.minDueOn.localeCompare(right.minDueOn) ||
    left.period.localeCompare(right.period),
  );

  for (const bucket of ordered) {
    const amount = asBigInt(bucket.totalAmountCents);
    const paid = amount < remainingCredits ? amount : remainingCredits;
    remainingCredits -= paid;
    const remaining = amount - paid;
    result.set(bucket.period, {
      paidAmountCents: paid,
      remainingAmountCents: remaining,
      // A leftover while a later statement is still outstanding is not
      // credit; it is simply reserved for that later due date.
      creditAmountCents: globalCredit,
      state: paymentState(amount, paid, globalCredit),
    });
  }

  return result;
}

function statementReadModel(
  context: FinancialContext,
  cardId: string,
  bucket: StatementBucket,
  kind: "CURRENT" | "FUTURE",
  allocation: StatementAllocation,
  exposeCredit: boolean,
): CreditCardStatementReadModel {
  const uniqueDueDates = [...new Set(bucket.dueDates)].sort();
  const payment = {
    state: allocation.state,
    statementAmountCents: toCents(bucket.totalAmountCents),
    paidAmountCents: toCents(allocation.paidAmountCents),
    remainingAmountCents: toCents(allocation.remainingAmountCents),
    creditAmountCents: exposeCredit ? toCents(allocation.creditAmountCents) : "0",
  } satisfies CreditCardStatementPaymentReadModel;
  return {
    householdId: context.householdId,
    cardId,
    period: bucket.period,
    kind,
    dueOn: uniqueDueDates.length === 1 ? uniqueDueDates[0] : null,
    totalAmountCents: toCents(bucket.totalAmountCents),
    items: Object.freeze(
      [...bucket.items].sort(
        (left, right) =>
          left.dueOn.localeCompare(right.dueOn) ||
          left.purchaseId.localeCompare(right.purchaseId) ||
          left.installmentNumber - right.installmentNumber ||
          left.referenceId.localeCompare(right.referenceId),
      ),
    ),
    payment,
  };
}

function summaryPaymentState(
  contractualDebt: bigint,
  credits: bigint,
): CreditCardProjectionPaymentState {
  if (credits > contractualDebt) return "CREDIT";
  if (contractualDebt <= BigInt(0)) return "UNPAID";
  if (credits <= BigInt(0)) return "UNPAID";
  if (credits < contractualDebt) return "PARTIALLY_PAID";
  return "PAID";
}

function deriveFallbackCurrentPeriod(
  asOf: string,
  rules: readonly {
    id: string;
    cardId: string;
    closingDay: number;
    dueDay: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }[],
): string {
  try {
    const snapshots: BillingRule[] = rules.map((rule) => ({
      id: rule.id,
      cardId: rule.cardId,
      closingDay: rule.closingDay,
      dueDay: rule.dueDay,
      effectiveFrom: rule.effectiveFrom,
      effectiveUntil: rule.effectiveUntil,
    }));
    return resolveBillingCycle({ occurredOn: asOf, rules: snapshots }).billingCycle;
  } catch {
    return asOf.slice(0, 7);
  }
}

function makeEmptyBucket(period: string): StatementBucket {
  return {
    period,
    items: [],
    totalAmountCents: BigInt(0),
    dueDates: [],
    minDueOn: `${period}-01`,
  };
}

function bucketDue(bucket: StatementBucket): string {
  return bucket.minDueOn;
}

function selectedBucket(
  buckets: readonly StatementBucket[],
  query: NormalizedProjectionQuery,
  currentPeriod: string,
): StatementBucket[] {
  if (query.period) {
    return [buckets.find((bucket) => bucket.period === query.period) ?? makeEmptyBucket(query.period)];
  }
  return buckets.filter((bucket) =>
    (query.from === undefined || bucket.period >= query.from.slice(0, 7)) &&
    (query.to === undefined || bucket.period <= query.to.slice(0, 7))
  ).map((bucket) => bucket.period === currentPeriod ? bucket : bucket);
}

function assertCardAggregate(
  card: CreditCardRecord,
  account: AccountRecord,
  context: FinancialContext,
): void {
  if (
    card.householdId !== context.householdId ||
    account.householdId !== context.householdId ||
    account.id !== card.accountId ||
    account.type !== "CREDIT_CARD"
  ) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
}

async function executeProjection(
  database: Database,
  context: FinancialContext,
  input: unknown,
  today?: FinancialDate | string,
): Promise<CreditCardProjectionReadModel> {
  assertFinancialContext(context);
  const query = normalizeProjectionQuery(input, today);
  const operation: S06CreditCardOperation = "credit_card.statement.read";
  const operationContext = createS06CreditCardOperation(operation, {
    householdId: context.householdId,
    userId: context.userId,
    cardId: query.cardId,
  });

  const cardRows = await measureS06Query(
    operationContext,
    () => database
      .select({ card: creditCards, account: accounts })
      .from(creditCards)
      .innerJoin(
        accounts,
        and(
          eq(accounts.id, creditCards.accountId),
          eq(accounts.householdId, context.householdId),
        ),
      )
      .where(
        and(
          eq(creditCards.id, query.cardId),
          eq(creditCards.householdId, context.householdId),
          eq(accounts.type, "CREDIT_CARD"),
        ),
      )
      .limit(1),
    { technicalErrorCode: "PROJECTION_QUERY_FAILED" },
  );
  const aggregate = cardRows[0];
  if (!aggregate) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  assertCardAggregate(aggregate.card, aggregate.account, context);

  const rows = await measureS06Query(
    operationContext,
    () => database
      .select({
        installment: installments,
        purchase: creditCardPurchases,
        plan: installmentPlans,
        event: financialEvents,
        entry: accountEntries,
      })
      .from(installments)
      .innerJoin(
        creditCardPurchases,
        and(
          eq(creditCardPurchases.id, installments.purchaseId),
          eq(creditCardPurchases.householdId, context.householdId),
          eq(creditCardPurchases.cardId, query.cardId),
        ),
      )
      .innerJoin(
        installmentPlans,
        and(
          eq(installmentPlans.id, installments.planId),
          eq(installmentPlans.householdId, context.householdId),
          eq(installmentPlans.purchaseId, installments.purchaseId),
        ),
      )
      .innerJoin(
        financialEvents,
        and(
          eq(financialEvents.id, creditCardPurchases.financialEventId),
          eq(financialEvents.householdId, context.householdId),
        ),
      )
      .leftJoin(
        accountEntries,
        and(
          eq(accountEntries.installmentId, installments.id),
          eq(accountEntries.financialEventId, financialEvents.id),
          eq(accountEntries.householdId, context.householdId),
        ),
      )
      .where(
        and(
          eq(installments.householdId, context.householdId),
          ne(installments.status, "CANCELLED"),
          ne(financialEvents.status, "CANCELLED"),
        ),
      )
      .orderBy(
        asc(installments.billingCycle),
        asc(installments.billingDueOn),
        asc(installments.purchaseId),
        asc(installments.sequence),
        asc(installments.id),
      ),
    { technicalErrorCode: "STATEMENT_QUERY_FAILED" },
  );
  const projectionRows = rows as ProjectionRow[];
  const buckets = groupRows(projectionRows);

  const payments = await measureS06Query(
    operationContext,
    () => database
      .select({ event: financialEvents, entry: accountEntries })
      .from(accountEntries)
      .innerJoin(
        financialEvents,
        and(
          eq(financialEvents.id, accountEntries.financialEventId),
          eq(financialEvents.householdId, context.householdId),
        ),
      )
      .where(
        and(
          eq(accountEntries.householdId, context.householdId),
          eq(accountEntries.accountId, aggregate.card.accountId),
          eq(accountEntries.status, "POSTED"),
          gt(accountEntries.amountCents, BigInt(0)),
          isNull(accountEntries.installmentId),
          lte(accountEntries.postedOn, query.asOf),
          eq(financialEvents.kind, "TRANSFER"),
          eq(financialEvents.origin, "MANUAL"),
          eq(financialEvents.status, "POSTED"),
          lte(financialEvents.occurredOn, query.asOf),
        ),
      )
      .orderBy(
        asc(financialEvents.occurredOn),
        asc(financialEvents.id),
        asc(accountEntries.id),
      ),
    { technicalErrorCode: "PAYMENT_QUERY_FAILED" },
  );
  const paymentRows = payments as PaymentRow[];
  const paymentEventIds = new Set<string>();
  let paymentCredits = BigInt(0);
  for (const payment of paymentRows) {
    if (paymentEventIds.has(payment.event.id)) {
      throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
    }
    paymentEventIds.add(payment.event.id);
    if (payment.entry.amountCents !== payment.event.amountCents) {
      throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
    }
    paymentCredits += asBigInt(payment.entry.amountCents);
  }

  const postedRows = await measureS06Query(
    operationContext,
    () => database
      .select({
        balanceCents: sql<string>`coalesce(sum(${accountEntries.amountCents}), 0)::text`,
      })
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.householdId, context.householdId),
          eq(accountEntries.accountId, aggregate.card.accountId),
          eq(accountEntries.status, "POSTED"),
          lte(accountEntries.postedOn, query.asOf),
        ),
      ),
    { technicalErrorCode: "PROJECTION_QUERY_FAILED" },
  );
  const postedPosition = asBigInt(postedRows[0]?.balanceCents ?? "0");

  const rules = await database
    .select()
    .from(creditCardBillingRules)
    .where(
      and(
        eq(creditCardBillingRules.cardId, query.cardId),
        eq(creditCardBillingRules.householdId, context.householdId),
      ),
    )
    .orderBy(asc(creditCardBillingRules.effectiveFrom), asc(creditCardBillingRules.id));

  const fallbackPeriod = deriveFallbackCurrentPeriod(query.asOf, rules);
  const datedBuckets = buckets.length > 0
    ? buckets
    : [makeEmptyBucket(fallbackPeriod)];
  const currentCandidates = datedBuckets.filter((bucket) => bucketDue(bucket) <= query.asOf);
  const currentBucket = (currentCandidates.length > 0
    ? currentCandidates[currentCandidates.length - 1]
    : datedBuckets[0]) ?? makeEmptyBucket(fallbackPeriod);
  const currentPeriod = currentBucket.period;
  const currentIndex = datedBuckets.findIndex((bucket) => bucket.period === currentPeriod);
  const nextBucket = datedBuckets.find(
    (bucket, index) => index > currentIndex && bucketDue(bucket) > bucketDue(currentBucket),
  ) ?? null;

  const allocations = allocateGlobalCardPayments(datedBuckets, paymentCredits);
  const contractualObligation = datedBuckets.reduce(
    (total, bucket) => total + bucket.totalAmountCents,
    BigInt(0),
  );
  const outstanding = contractualObligation > paymentCredits
    ? contractualObligation - paymentCredits
    : BigInt(0);
  const cardCredit = paymentCredits > contractualObligation
    ? paymentCredits - contractualObligation
    : BigInt(0);
  const remainingFuture = projectionRows.reduce((total, row) => {
    const item = statementItem(row);
    return item.dueOn > query.asOf || item.entryStatus === "EXPECTED"
      ? total + asBigInt(item.amountCents)
      : total;
  }, BigInt(0));
  const projectedAmount = datedBuckets.reduce(
    (total, bucket, index) => index > currentIndex ? total + bucket.totalAmountCents : total,
    BigInt(0),
  );
  const nextAmount = nextBucket?.totalAmountCents ?? BigInt(0);
  const summary: CreditCardProjectionSummaryReadModel = {
    householdId: context.householdId,
    cardId: query.cardId,
    asOf: query.asOf,
    currentPeriod,
    nextPeriod: nextBucket?.period ?? null,
    currentStatementAmountCents: toCents(currentBucket.totalAmountCents),
    projectedStatementAmountCents: toCents(projectedAmount),
    nextStatementAmountCents: toCents(nextAmount),
    remainingFutureInstallmentsCents: toCents(remainingFuture),
    contractualObligationCents: toCents(contractualObligation),
    outstandingCardObligationCents: toCents(outstanding),
    committedCreditLimitCents: toCents(outstanding),
    availableCreditLimitCents: toCents(
      aggregate.card.creditLimitCents > outstanding
        ? aggregate.card.creditLimitCents - outstanding
        : BigInt(0),
    ),
    currentPostedCardPositionCents: toCents(postedPosition),
    cardNetPositionCents: toCents(postedPosition - remainingFuture),
    cardCreditBalanceCents: toCents(cardCredit),
    paymentState: summaryPaymentState(contractualObligation, paymentCredits),
    totalPaidAmountCents: toCents(
      paymentCredits < contractualObligation ? paymentCredits : contractualObligation,
    ),
  };

  const allStatements = datedBuckets.map((bucket) =>
    statementReadModel(
      context,
      query.cardId,
      bucket,
      bucket.period === currentPeriod ? "CURRENT" : "FUTURE",
      allocations.get(bucket.period) ?? {
        paidAmountCents: BigInt(0),
        remainingAmountCents: bucket.totalAmountCents,
        creditAmountCents: BigInt(0),
        state: paymentState(bucket.totalAmountCents, BigInt(0), BigInt(0)),
      },
      bucket.period === currentPeriod,
    ),
  );
  const current = allStatements.find((statement) => statement.period === currentPeriod) ??
    emptyStatement(context, query.cardId, currentPeriod, "CURRENT");
  const next = nextBucket
    ? allStatements.find((statement) => statement.period === nextBucket.period) ?? null
    : null;
  const selected = selectedBucket(datedBuckets, query, currentPeriod).map((bucket) =>
    allStatements.find((statement) => statement.period === bucket.period) ??
    statementReadModel(
      context,
      query.cardId,
      bucket,
      bucket.period === currentPeriod ? "CURRENT" : "FUTURE",
      allocations.get(bucket.period) ?? {
        paidAmountCents: BigInt(0),
        remainingAmountCents: bucket.totalAmountCents,
        creditAmountCents: BigInt(0),
        state: paymentState(bucket.totalAmountCents, BigInt(0), BigInt(0)),
      },
      bucket.period === currentPeriod,
    ),
  );

  return {
    householdId: context.householdId,
    cardId: query.cardId,
    asOf: query.asOf,
    summary,
    current,
    next,
    statements: Object.freeze(selected),
  };
}

function projectionOperation(input: unknown): S06CreditCardOperation {
  if (typeof input === "object" && input !== null &&
      typeof (input as { period?: unknown }).period === "string") {
    return "credit_card.statement.read";
  }
  return "credit_card.obligation.read";
}

function operationContext(
  operation: S06CreditCardOperation,
  context: FinancialContext,
  input: unknown,
) {
  const cardId = typeof input === "object" && input !== null &&
    typeof (input as { cardId?: unknown }).cardId === "string"
    ? (input as { cardId: string }).cardId
    : undefined;
  return createS06CreditCardOperation(operation, {
    householdId: context.householdId,
    userId: context.userId,
    ...(cardId ? { cardId } : {}),
  });
}

async function result<T>(work: () => Promise<T>): Promise<CreditCardResult<T>> {
  try {
    return ok(await work());
  } catch (error) {
    if (error instanceof CreditCardDomainError) {
      return failure(error.code, error.field);
    }
    throw error;
  }
}

export async function getCreditCardProjectionForContext(
  database: Database,
  context: FinancialContext,
  query: unknown,
  today?: FinancialDate | string,
): Promise<CreditCardProjectionReadModel> {
  const operation = projectionOperation(query);
  return withS06CreditCardObservability(
    operationContext(operation, context, query),
    () => executeProjection(database, context, query, today),
    { technicalErrorCode: "PROJECTION_QUERY_FAILED" },
  );
}

export async function getCreditCardStatementForContext(
  database: Database,
  context: FinancialContext,
  query: unknown,
  today?: FinancialDate | string,
): Promise<CreditCardStatementReadModel> {
  const projection = await getCreditCardProjectionForContext(database, context, query, today);
  const input = query as { period?: unknown; billingCycle?: unknown; competence?: unknown };
  const period = typeof input.period === "string"
    ? input.period
    : typeof input.billingCycle === "string"
      ? input.billingCycle
      : typeof input.competence === "string"
        ? input.competence
        : projection.current.period;
  return projection.statements.find((statement) => statement.period === period) ??
    (period === projection.current.period
      ? projection.current
      : emptyStatement(context, projection.cardId, period, "FUTURE"));
}

export async function getCurrentCreditCardStatementForContext(
  database: Database,
  context: FinancialContext,
  cardId: string,
  asOf?: FinancialDate | string,
): Promise<CreditCardStatementReadModel> {
  const projection = await getCreditCardProjectionForContext(
    database,
    context,
    { cardId, ...(asOf ? { asOf: typeof asOf === "string" ? asOf : formatFinancialDate(asOf) } : {}) },
    asOf,
  );
  return projection.current;
}

export interface CreditCardProjectionQueries {
  get(context: FinancialContext, query: unknown): Promise<CreditCardProjectionReadModel>;
  statement(context: FinancialContext, query: unknown): Promise<CreditCardStatementReadModel>;
  currentStatement(context: FinancialContext, cardId: string, asOf?: FinancialDate | string): Promise<CreditCardStatementReadModel>;
  currentStatementAmount(context: FinancialContext, query: unknown): Promise<string>;
  projectedStatementAmount(context: FinancialContext, query: unknown): Promise<string>;
  outstandingCardObligation(context: FinancialContext, query: unknown): Promise<string>;
  availableCreditLimit(context: FinancialContext, query: unknown): Promise<string>;
  cardCreditBalance(context: FinancialContext, query: unknown): Promise<string>;
}

export function createCreditCardProjectionQueries(
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): CreditCardProjectionQueries {
  const isDb = typeof databaseOrOptions === "object" && databaseOrOptions !== null &&
    "select" in databaseOrOptions && "transaction" in databaseOrOptions;
  const options: CreditCardProjectionQueryOptions = isDb
    ? { database: databaseOrOptions as Database }
    : databaseOrOptions ?? {};
  // Resolve lazily so importing contracts/actions during a Next build never
  // opens a pool or requires DATABASE_URL.
  const database = () => resolveDatabase(options.database);
  const read = (context: FinancialContext, query: unknown) =>
    getCreditCardProjectionForContext(database(), context, query, options.today);
  return {
    get: read,
    statement: async (context, query) =>
      getCreditCardStatementForContext(database(), context, query, options.today),
    currentStatement: async (context, cardId, asOf) =>
      getCurrentCreditCardStatementForContext(database(), context, cardId, asOf ?? options.today),
    currentStatementAmount: async (context, query) => (await read(context, query)).summary.currentStatementAmountCents,
    projectedStatementAmount: async (context, query) => (await read(context, query)).summary.projectedStatementAmountCents,
    outstandingCardObligation: async (context, query) => (await read(context, query)).summary.outstandingCardObligationCents,
    availableCreditLimit: async (context, query) => (await read(context, query)).summary.availableCreditLimitCents,
    cardCreditBalance: async (context, query) => (await read(context, query)).summary.cardCreditBalanceCents,
  };
}

export interface CreditCardProjectionUseCasePort {
  get(context: FinancialContext, query: unknown): Promise<CreditCardResult<CreditCardProjectionReadModel>>;
  statement(context: FinancialContext, query: unknown): Promise<CreditCardResult<CreditCardStatementReadModel>>;
  currentStatement(context: FinancialContext, cardId: string, asOf?: FinancialDate | string): Promise<CreditCardResult<CreditCardStatementReadModel>>;
  currentStatementAmount(context: FinancialContext, query: unknown): Promise<CreditCardResult<string>>;
  projectedStatementAmount(context: FinancialContext, query: unknown): Promise<CreditCardResult<string>>;
  outstandingCardObligation(context: FinancialContext, query: unknown): Promise<CreditCardResult<string>>;
  availableCreditLimit(context: FinancialContext, query: unknown): Promise<CreditCardResult<string>>;
  cardCreditBalance(context: FinancialContext, query: unknown): Promise<CreditCardResult<string>>;
}

export function createCreditCardProjectionUseCases(
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): CreditCardProjectionUseCasePort {
  const queries = createCreditCardProjectionQueries(databaseOrOptions);
  return {
    get: (context, query) => result(() => queries.get(context, query)),
    statement: (context, query) => result(() => queries.statement(context, query)),
    currentStatement: (context, cardId, asOf) => result(() => queries.currentStatement(context, cardId, asOf)),
    currentStatementAmount: (context, query) => result(() => queries.currentStatementAmount(context, query)),
    projectedStatementAmount: (context, query) => result(() => queries.projectedStatementAmount(context, query)),
    outstandingCardObligation: (context, query) => result(() => queries.outstandingCardObligation(context, query)),
    availableCreditLimit: (context, query) => result(() => queries.availableCreditLimit(context, query)),
    cardCreditBalance: (context, query) => result(() => queries.cardCreditBalance(context, query)),
  };
}

export const createCreditCardProjectionReadQueries = createCreditCardProjectionQueries;
export const createCreditCardProjectionReadUseCases = createCreditCardProjectionUseCases;
export const creditCardProjectionQueries = createCreditCardProjectionQueries();
export const creditCardProjectionUseCases = createCreditCardProjectionUseCases();

export async function getCreditCardProjection(
  context: FinancialContext,
  query: CreditCardProjectionQuery | unknown,
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): Promise<CreditCardProjectionReadModel> {
  return createCreditCardProjectionQueries(databaseOrOptions).get(context, query);
}

export async function getCreditCardStatement(
  context: FinancialContext,
  query: CreditCardProjectionQuery | unknown,
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): Promise<CreditCardStatementReadModel> {
  return createCreditCardProjectionQueries(databaseOrOptions).statement(context, query);
}

export async function getCurrentStatementAmount(
  context: FinancialContext,
  query: CreditCardProjectionQuery | unknown,
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): Promise<string> {
  return createCreditCardProjectionQueries(databaseOrOptions).currentStatementAmount(context, query);
}

export async function getProjectedStatementAmount(
  context: FinancialContext,
  query: CreditCardProjectionQuery | unknown,
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): Promise<string> {
  return createCreditCardProjectionQueries(databaseOrOptions).projectedStatementAmount(context, query);
}

export async function getOutstandingCardObligation(
  context: FinancialContext,
  query: CreditCardProjectionQuery | unknown,
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): Promise<string> {
  return createCreditCardProjectionQueries(databaseOrOptions).outstandingCardObligation(context, query);
}

export async function getAvailableCreditLimit(
  context: FinancialContext,
  query: CreditCardProjectionQuery | unknown,
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): Promise<string> {
  return createCreditCardProjectionQueries(databaseOrOptions).availableCreditLimit(context, query);
}

export async function getCardCreditBalance(
  context: FinancialContext,
  query: CreditCardProjectionQuery | unknown,
  databaseOrOptions?: Database | CreditCardProjectionQueryOptions,
): Promise<string> {
  return createCreditCardProjectionQueries(databaseOrOptions).cardCreditBalance(context, query);
}

/** Result-returning aliases for Server Actions and route adapters. */
export async function getCurrentStatementAmountForContext(
  database: Database,
  context: FinancialContext,
  query: CreditCardProjectionQuery | string,
  today?: FinancialDate | string,
): Promise<string> {
  return (await getCreditCardProjectionForContext(database, context, query, today))
    .summary.currentStatementAmountCents;
}

export async function getProjectedStatementAmountForContext(
  database: Database,
  context: FinancialContext,
  query: CreditCardProjectionQuery | string,
  today?: FinancialDate | string,
): Promise<string> {
  return (await getCreditCardProjectionForContext(database, context, query, today))
    .summary.projectedStatementAmountCents;
}

export async function getOutstandingCardObligationForContext(
  database: Database,
  context: FinancialContext,
  query: CreditCardProjectionQuery | string,
  today?: FinancialDate | string,
): Promise<string> {
  return (await getCreditCardProjectionForContext(database, context, query, today))
    .summary.outstandingCardObligationCents;
}

export async function getAvailableCreditLimitForContext(
  database: Database,
  context: FinancialContext,
  query: CreditCardProjectionQuery | string,
  today?: FinancialDate | string,
): Promise<string> {
  return (await getCreditCardProjectionForContext(database, context, query, today))
    .summary.availableCreditLimitCents;
}

export async function getCardCreditBalanceForContext(
  database: Database,
  context: FinancialContext,
  query: CreditCardProjectionQuery | string,
  today?: FinancialDate | string,
): Promise<string> {
  return (await getCreditCardProjectionForContext(database, context, query, today))
    .summary.cardCreditBalanceCents;
}
