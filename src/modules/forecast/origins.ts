import {
  and,
  eq,
} from "drizzle-orm";

import { getDb } from "@/db";
import type { Database } from "@/db";
import {
  creditCardPurchases,
  creditCards,
  installmentPlans,
  installments,
} from "@/db/credit-cards-schema";
import {
  financialEvents,
} from "@/db/financial-events-schema";
import {
  plannedEvents,
  recurringOccurrences,
  recurringRules,
} from "@/db/recurring-schema";
import { isUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";

import {
  FORECAST_ORIGIN_ACTIONS,
  FORECAST_ORIGIN_CONTRACT_VERSION,
  forecastOriginQuerySchema,
  type ForecastOriginActionDescriptor,
  type ForecastOriginDetail,
  type ForecastOriginQuery,
  type ForecastOriginResult,
} from "./origin-contracts";
import {
  FORECAST_SOURCE_KINDS,
  type ForecastItem,
  type ForecastSourceKind,
} from "./contracts";
import { FORECAST_ORIGIN_ROUTE } from "./routes";

/** A database or an already-open transaction at the trusted server boundary. */
export type ForecastOriginExecutor = Database;

const NOT_FOUND_ERROR = { code: "FORECAST_NOT_FOUND" as const, field: null };
const QUERY_FAILED_ERROR = {
  code: "FORECAST_QUERY_FAILED" as const,
  field: null,
};

function notFound(): ForecastOriginResult {
  // Return a fresh object so a caller cannot mutate the shared error result.
  return { ok: false, error: { ...NOT_FOUND_ERROR } };
}

function queryFailed(): ForecastOriginResult {
  return { ok: false, error: { ...QUERY_FAILED_ERROR } };
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return isUuidV7(normalized) ? normalized : undefined;
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || /[\p{Cc}\p{Cf}]/u.test(normalized)) return fallback;
  return normalized.slice(0, 240) || fallback;
}

function databaseFor(value?: ForecastOriginExecutor): ForecastOriginExecutor {
  return value ?? getDb();
}

function action(
  operation: (typeof FORECAST_ORIGIN_ACTIONS)[number],
  label: string,
  enabled: boolean,
  reason: string | null = null,
): ForecastOriginActionDescriptor {
  return { operation, label, enabled, reason };
}

function recurringActions(
  hasOccurrence: boolean,
  status: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED",
): readonly ForecastOriginActionDescriptor[] {
  const actions: ForecastOriginActionDescriptor[] = [
    action(
      "recurring_rule.update_future",
      "Alterar recorrência futura",
      true,
    ),
    action("recurring_rule.end", "Encerrar recorrência", true),
  ];

  if (!hasOccurrence) return actions;

  const blockedReason =
    status === "POSTED"
      ? "A ocorrência já está realizada; o fato POSTED é somente leitura."
      : status === "CANCELLED"
        ? "A ocorrência está cancelada; crie uma nova informação futura."
        : null;
  const enabled = blockedReason === null;
  actions.push(
    action(
      "recurring_occurrence.override",
      "Substituir esta ocorrência",
      enabled,
      blockedReason,
    ),
    action(
      "recurring_occurrence.cancel",
      "Cancelar esta ocorrência",
      enabled,
      blockedReason,
    ),
    action(
      "recurring_occurrence.realize",
      "Vincular realização",
      enabled,
      blockedReason,
    ),
  );
  return actions;
}

function plannedEventActions(
  status: "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED",
): readonly ForecastOriginActionDescriptor[] {
  const enabled = status === "PLANNED" || status === "EXPECTED";
  const reason = enabled
    ? null
    : status === "POSTED"
      ? "O evento POSTED é um fato realizado e não pode ser sobrescrito."
      : "O evento já foi cancelado e permanece preservado para histórico.";
  return [
    action("planned_event.update", "Alterar evento futuro", enabled, reason),
    action("planned_event.cancel", "Cancelar evento futuro", enabled, reason),
  ];
}

function kindStatus(value: unknown): "PLANNED" | "EXPECTED" | "POSTED" | "CANCELLED" | null {
  return value === "PLANNED" ||
    value === "EXPECTED" ||
    value === "POSTED" ||
    value === "CANCELLED"
    ? value
    : null;
}

function recurringDetail(
  query: ForecastOriginQuery,
  rule: typeof recurringRules.$inferSelect,
  occurrence: typeof recurringOccurrences.$inferSelect | null,
  event: typeof financialEvents.$inferSelect | null,
): ForecastOriginDetail {
  const status = kindStatus(occurrence?.status) ?? "PLANNED";
  const occurrenceKey = occurrence?.occurrenceKey ?? query.occurrenceKey ?? null;
  const sourceReference = query.referenceId;
  const description = safeLabel(rule.description, "Recorrência");
  return {
    contractVersion: FORECAST_ORIGIN_CONTRACT_VERSION,
    kind: "RECURRING",
    referenceId: sourceReference,
    label: description,
    status,
    sourceUnavailable: false,
    actions: recurringActions(occurrenceKey !== null, status),
    recurring: {
      ruleId: rule.id,
      occurrenceId: occurrence?.id ?? null,
      occurrenceKey,
      frequency: rule.frequency,
      kind: rule.kind === "INCOME" ? "INCOME" : "EXPENSE",
      amountCents: (event?.amountCents ?? occurrence?.amountCents ?? rule.amountCents).toString(),
      description,
      startOn: rule.startOn,
      endOn: rule.endOn,
      expectedOn: occurrence?.expectedOn ?? null,
      status,
      isVirtual: occurrence === null,
      financialEventId: occurrence?.financialEventId ?? null,
    },
    plannedEvent: null,
    installment: null,
    realizedEvent: event
      ? {
          financialEventId: event.id,
          kind: event.kind === "INCOME" ? "INCOME" : "EXPENSE",
          amountCents: event.amountCents.toString(),
          occurredOn: event.occurredOn,
          description: safeLabel(event.description, description),
          status: event.status === "CANCELLED" ? "CANCELLED" : "POSTED",
          transactionHref: `/transactions/${encodeURIComponent(event.id)}`,
        }
      : null,
  };
}

function plannedEventDetail(
  query: ForecastOriginQuery,
  planned: typeof plannedEvents.$inferSelect,
): ForecastOriginDetail {
  const status = kindStatus(planned.status) ?? "PLANNED";
  const description = safeLabel(planned.description, "Evento planejado");
  return {
    contractVersion: FORECAST_ORIGIN_CONTRACT_VERSION,
    kind: "PLANNED_EVENT",
    referenceId: query.referenceId,
    label: description,
    status,
    sourceUnavailable: false,
    actions: plannedEventActions(status),
    recurring: null,
    plannedEvent: {
      plannedEventId: planned.id,
      kind: planned.kind === "INCOME" ? "INCOME" : "EXPENSE",
      amountCents: planned.amountCents.toString(),
      description,
      expectedOn: planned.expectedOn,
      status,
      financialEventId: planned.financialEventId,
    },
    installment: null,
    realizedEvent: null,
  };
}

function installmentDetail(
  query: ForecastOriginQuery,
  row: {
    installment: typeof installments.$inferSelect;
    purchase: typeof creditCardPurchases.$inferSelect;
    plan: typeof installmentPlans.$inferSelect;
    card: typeof creditCards.$inferSelect;
    event: typeof financialEvents.$inferSelect;
  },
): ForecastOriginDetail {
  const status =
    row.installment.status === "CANCELLED" || row.event.status === "CANCELLED"
      ? "CANCELLED"
      : row.installment.status;
  const description = safeLabel(row.event.description, "Parcela de cartão");
  return {
    contractVersion: FORECAST_ORIGIN_CONTRACT_VERSION,
    kind: "INSTALLMENT",
    referenceId: query.referenceId,
    label: description,
    status,
    sourceUnavailable: false,
    // There is deliberately no installment update/cancel/payment action.
    actions: [],
    recurring: null,
    plannedEvent: null,
    installment: {
      installmentId: row.installment.id,
      purchaseId: row.purchase.id,
      cardId: row.card.id,
      sequence: row.installment.sequence,
      installmentCount: row.plan.installmentCount,
      amountCents: row.installment.amountCents.toString(),
      status,
      billingCycle: row.installment.billingCycle.slice(0, 7),
      dueOn: row.installment.billingDueOnOverride ?? row.installment.billingDueOn,
      purchaseHref: `/credit-cards/${encodeURIComponent(row.card.id)}/purchases/${encodeURIComponent(row.purchase.id)}`,
      aggregateOnly: true,
    },
    realizedEvent: null,
  };
}

function realizedEventDetail(
  query: ForecastOriginQuery,
  event: typeof financialEvents.$inferSelect,
): ForecastOriginDetail {
  const status = event.status === "CANCELLED" ? "CANCELLED" : "POSTED";
  const description = safeLabel(event.description, "Lançamento realizado");
  return {
    contractVersion: FORECAST_ORIGIN_CONTRACT_VERSION,
    kind: "REALIZED_EVENT",
    referenceId: query.referenceId,
    label: description,
    status,
    sourceUnavailable: false,
    actions: [],
    recurring: null,
    plannedEvent: null,
    installment: null,
    realizedEvent: {
      financialEventId: event.id,
      kind: event.kind === "INCOME" ? "INCOME" : "EXPENSE",
      amountCents: event.amountCents.toString(),
      occurredOn: event.occurredOn,
      description,
      status,
      transactionHref: `/transactions/${encodeURIComponent(event.id)}`,
    },
  };
}

async function resolveRecurringOrigin(
  database: ForecastOriginExecutor,
  context: FinancialContext,
  query: ForecastOriginQuery,
): Promise<ForecastOriginResult> {
  const referenceId = normalizeId(query.referenceId);
  if (!referenceId) return notFound();

  const [occurrenceRows, ruleRows] = await Promise.all([
    database
      .select()
      .from(recurringOccurrences)
      .where(
        and(
          eq(recurringOccurrences.id, referenceId),
          eq(recurringOccurrences.householdId, context.householdId),
        ),
      )
      .limit(1),
    database
      .select()
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.id, referenceId),
          eq(recurringRules.householdId, context.householdId),
        ),
      )
      .limit(1),
  ]);

  const occurrenceByReference = occurrenceRows[0] ?? null;
  const ruleByReference = ruleRows[0] ?? null;
  // A UUID cannot be treated as both kinds of source. Fail closed if a
  // pathological fixture creates a collision across the two tables.
  if (occurrenceByReference && ruleByReference) return notFound();

  let occurrence = occurrenceByReference;
  let rule = ruleByReference;
  if (occurrence) {
    if (
      query.recurringRuleId !== undefined &&
      query.recurringRuleId !== occurrence.recurringRuleId
    ) {
      return notFound();
    }
    const rows = await database
      .select()
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.id, occurrence.recurringRuleId),
          eq(recurringRules.householdId, context.householdId),
        ),
      )
      .limit(1);
    rule = rows[0] ?? null;
  } else if (rule) {
    if (
      query.recurringRuleId !== undefined &&
      query.recurringRuleId !== rule.id
    ) {
      return notFound();
    }
    if (query.occurrenceKey !== undefined) {
      const rows = await database
        .select()
        .from(recurringOccurrences)
        .where(
          and(
            eq(recurringOccurrences.recurringRuleId, rule.id),
            eq(recurringOccurrences.occurrenceKey, query.occurrenceKey),
            eq(recurringOccurrences.householdId, context.householdId),
          ),
        )
        .limit(1);
      occurrence = rows[0] ?? null;
    }
  }

  if (!rule) return notFound();
  if (occurrence && occurrence.recurringRuleId !== rule.id) return notFound();
  if (
    occurrence &&
    query.occurrenceKey !== undefined &&
    occurrence.occurrenceKey !== query.occurrenceKey
  ) {
    return notFound();
  }
  if (
    query.occurrenceKey !== undefined &&
    ((rule.frequency === "MONTHLY" && !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(query.occurrenceKey)) ||
      (rule.frequency === "YEARLY" && !/^\d{4}$/u.test(query.occurrenceKey)))
  ) {
    return notFound();
  }

  let event: typeof financialEvents.$inferSelect | null = null;
  if (occurrence?.financialEventId) {
    const rows = await database
      .select()
      .from(financialEvents)
      .where(
        and(
          eq(financialEvents.id, occurrence.financialEventId),
          eq(financialEvents.householdId, context.householdId),
        ),
      )
      .limit(1);
    event = rows[0] ?? null;
    if (!event || event.status !== "POSTED" || event.kind !== rule.kind) {
      return notFound();
    }
  }

  return { ok: true, value: recurringDetail(query, rule, occurrence, event) };
}

async function resolvePlannedEventOrigin(
  database: ForecastOriginExecutor,
  context: FinancialContext,
  query: ForecastOriginQuery,
): Promise<ForecastOriginResult> {
  const referenceId = normalizeId(query.referenceId);
  if (!referenceId) return notFound();
  const rows = await database
    .select()
    .from(plannedEvents)
    .where(
      and(
        eq(plannedEvents.id, referenceId),
        eq(plannedEvents.householdId, context.householdId),
      ),
    )
    .limit(1);
  const planned = rows[0];
  if (!planned) return notFound();
  if (planned.financialEventId) {
    const events = await database
      .select()
      .from(financialEvents)
      .where(
        and(
          eq(financialEvents.id, planned.financialEventId),
          eq(financialEvents.householdId, context.householdId),
        ),
      )
      .limit(1);
    const event = events[0];
    if (!event || event.status !== "POSTED" || event.kind !== planned.kind) {
      return notFound();
    }
  }
  return { ok: true, value: plannedEventDetail(query, planned) };
}

async function resolveInstallmentOrigin(
  database: ForecastOriginExecutor,
  context: FinancialContext,
  query: ForecastOriginQuery,
): Promise<ForecastOriginResult> {
  const referenceId = normalizeId(query.referenceId);
  if (!referenceId) return notFound();
  const rows = await database
    .select({
      installment: installments,
      purchase: creditCardPurchases,
      plan: installmentPlans,
      card: creditCards,
      event: financialEvents,
    })
    .from(installments)
    .innerJoin(
      creditCardPurchases,
      and(
        eq(creditCardPurchases.id, installments.purchaseId),
        eq(creditCardPurchases.householdId, context.householdId),
      ),
    )
    .innerJoin(
      installmentPlans,
      and(
        eq(installmentPlans.id, installments.planId),
        eq(installmentPlans.purchaseId, installments.purchaseId),
        eq(installmentPlans.householdId, context.householdId),
      ),
    )
    .innerJoin(
      creditCards,
      and(
        eq(creditCards.id, creditCardPurchases.cardId),
        eq(creditCards.householdId, context.householdId),
      ),
    )
    .innerJoin(
      financialEvents,
      and(
        eq(financialEvents.id, creditCardPurchases.financialEventId),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .where(
      and(
        eq(installments.id, referenceId),
        eq(installments.householdId, context.householdId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.event.kind !== "PURCHASE") return notFound();
  return { ok: true, value: installmentDetail(query, row) };
}

async function resolveRealizedEventOrigin(
  database: ForecastOriginExecutor,
  context: FinancialContext,
  query: ForecastOriginQuery,
): Promise<ForecastOriginResult> {
  const referenceId = normalizeId(query.referenceId);
  if (!referenceId) return notFound();
  const rows = await database
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, referenceId),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .limit(1);
  const event = rows[0];
  if (
    !event ||
    (event.kind !== "EXPENSE" && event.kind !== "INCOME") ||
    (event.status !== "POSTED" && event.status !== "CANCELLED")
  ) {
    return notFound();
  }
  return { ok: true, value: realizedEventDetail(query, event) };
}

/**
 * Resolves a forecast reference only inside the server-authenticated
 * household. Invalid, absent and cross-tenant identifiers intentionally share
 * the same response so an origin URL cannot become an oracle.
 */
export async function resolveForecastOriginForContext(
  context: FinancialContext,
  input: unknown,
  options: { database?: ForecastOriginExecutor } = {},
): Promise<ForecastOriginResult> {
  assertFinancialContext(context);
  const parsed = forecastOriginQuerySchema.safeParse(input);
  if (!parsed.success) return notFound();
  const query = parsed.data as ForecastOriginQuery;
  try {
    const database = databaseFor(options.database);
    switch (query.kind) {
      case "RECURRING":
        return await resolveRecurringOrigin(database, context, query);
      case "PLANNED_EVENT":
        return await resolvePlannedEventOrigin(database, context, query);
      case "INSTALLMENT":
        return await resolveInstallmentOrigin(database, context, query);
      case "REALIZED_EVENT":
        return await resolveRealizedEventOrigin(database, context, query);
      default:
        return notFound();
    }
  } catch {
    // Database and adapter details never cross this boundary.
    return queryFailed();
  }
}

export const getForecastOriginForContext = resolveForecastOriginForContext;
export const resolveForecastSourceForContext = resolveForecastOriginForContext;

/** Builds a safe origin route from an already server-produced forecast item. */
export function forecastOriginHref(
  item: Pick<ForecastItem, "referenceId" | "source">,
  basePath = FORECAST_ORIGIN_ROUTE,
): string | null {
  const parsedId = normalizeId(item.referenceId);
  if (!parsedId || !FORECAST_SOURCE_KINDS.includes(item.source.kind as ForecastSourceKind)) {
    return null;
  }
  const params = new URLSearchParams({
    kind: item.source.kind,
    referenceId: parsedId,
  });
  if (item.source.recurringRuleId && isUuidV7(item.source.recurringRuleId)) {
    params.set("recurringRuleId", item.source.recurringRuleId);
  }
  if (item.source.occurrenceKey) {
    params.set("occurrenceKey", item.source.occurrenceKey);
  }
  return `${basePath}?${params.toString()}`;
}

export const getForecastOriginHref = forecastOriginHref;
