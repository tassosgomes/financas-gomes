import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  applicationCommands,
  categories,
  type AccountRecord,
  type ApplicationCommandRecord,
  type CategoryRecord,
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
  type CreditCardBillingRuleRecord,
  type CreditCardPurchaseRecord,
  type InstallmentPlanRecord,
  type InstallmentRecord,
} from "@/db/credit-cards-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import {
  createCreditCardOperation,
  withCreditCardObservability,
} from "@/modules/observability/credit-cards";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";

import {
  CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
  CREATE_CREDIT_CARD_PURCHASE_OPERATION,
  CREDIT_CARD_ACCOUNT_TYPE,
  CreditCardDomainError,
  failure,
  ok,
  type CreditCardCommandOperation,
  type CreditCardErrorCode,
  type CreditCardInstallmentReadModel,
  type CreditCardPurchaseReadModel,
  type CreditCardResult,
  type CancelCreditCardPurchaseCommand,
  type CreateCreditCardPurchaseCommand,
  type UpdateCreditCardPurchaseCommand,
  UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
} from "./contracts";
import {
  parseCancelCreditCardPurchaseCommand,
  parseCreateCreditCardPurchaseCommand,
  parseGetCreditCardPurchaseQuery,
  parseUpdateCreditCardPurchaseCommand,
} from "./validation";
import {
  generateInstallmentSchedule,
} from "./installments";
import {
  BillingCycleError,
  type BillingRule,
} from "./billing-cycle";
import { InstallmentDomainError } from "./installments";

export type PurchaseTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

export interface CreditCardPurchaseUseCasePort {
  create(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardPurchaseReadModel>>;
  get(
    context: FinancialContext,
    query: unknown,
  ): Promise<CreditCardResult<CreditCardPurchaseReadModel>>;
  update(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardPurchaseReadModel>>;
  cancel(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardPurchaseReadModel>>;
}

export interface CreditCardPurchaseUseCaseOptions {
  database?: Database;
  today?: string;
}

type PurchaseAggregate = {
  purchase: CreditCardPurchaseRecord;
  event: FinancialEventRecord;
  plan: InstallmentPlanRecord;
  installments: InstallmentRecord[];
  entries: AccountEntryRecord[];
};

type CommandClaim =
  | { created: true }
  | { created: false; record: ApplicationCommandRecord };

function resolveDatabase(database?: Database): Database {
  return database ?? getDb();
}

function normalizeContext(context: FinancialContext): FinancialContext {
  assertFinancialContext(context);
  return { userId: context.userId, householdId: context.householdId };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function hashOperationPayload(operation: CreditCardCommandOperation, payload: unknown): string {
  // commandId is the idempotency key, not part of the compared payload.
  return createHash("sha256")
    .update(
      canonicalJson({
        operation,
        payload,
      }),
      "utf8",
    )
    .digest("hex");
}

function payloadHash(command: CreateCreditCardPurchaseCommand): string {
  return hashOperationPayload(CREATE_CREDIT_CARD_PURCHASE_OPERATION, {
    cardId: command.cardId,
    amountCents: command.amountCents,
    occurredOn: command.occurredOn,
    description: command.description,
    categoryId: command.categoryId ?? null,
    installmentCount: command.installmentCount,
    billingDueOnOverride: command.billingDueOnOverride ?? null,
  });
}

function updatePayload(command: UpdateCreditCardPurchaseCommand): object {
  return {
    purchaseId: command.purchaseId,
    ...(command.description === undefined
      ? {}
      : { description: command.description }),
    ...(command.categoryId === undefined ? {} : { categoryId: command.categoryId }),
  };
}

function cancelPayload(command: CancelCreditCardPurchaseCommand): object {
  return { purchaseId: command.purchaseId };
}

function dbCode(error: unknown, key: "code" | "constraint"): string | undefined {
  let candidate: unknown = error;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (
      candidate &&
      typeof candidate === "object" &&
      key in candidate &&
      typeof (candidate as Record<string, unknown>)[key] === "string"
    ) {
      return (candidate as Record<string, string>)[key];
    }
    candidate =
      candidate && typeof candidate === "object" && "cause" in candidate
        ? (candidate as { cause?: unknown }).cause
        : undefined;
  }
  return undefined;
}

function mapPersistenceError(error: unknown): CreditCardDomainError | null {
  if (error instanceof CreditCardDomainError) {
    return error;
  }
  const code = dbCode(error, "code");
  const constraint = dbCode(error, "constraint");
  if (code === "23505") {
    if (constraint === "credit_card_purchases_event_id_uq") {
      return new CreditCardDomainError("CONFLICT");
    }
    if (constraint === "account_entries_installment_id_uq") {
      return new CreditCardDomainError("CONFLICT");
    }
    return new CreditCardDomainError("CONFLICT");
  }
  if (code === "23503") {
    return new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  if (code === "23514") {
    return new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
  }
  return null;
}

async function toResult<T>(work: () => Promise<T>): Promise<CreditCardResult<T>> {
  try {
    return ok(await work());
  } catch (error) {
    const mapped = mapPersistenceError(error);
    if (mapped) {
      return failure(mapped.code, mapped.field);
    }
    if (error instanceof BillingCycleError) {
      const code = billingErrorCode(error.code);
      return failure(code, "occurredOn");
    }
    if (error instanceof InstallmentDomainError) {
      const code = installmentErrorCode(error.code);
      return failure(code, error.field as never);
    }
    throw error;
  }
}

function billingErrorCode(code: BillingCycleError["code"]): CreditCardErrorCode {
  switch (code) {
    case "INVALID_DATE":
      return "INVALID_DATE";
    case "INVALID_BILLING_DAY":
      return "INVALID_BILLING_DAY";
    case "BILLING_RULE_NOT_FOUND":
      return "BILLING_RULE_NOT_FOUND";
    case "BILLING_RULE_NOT_APPLICABLE":
      return "BILLING_RULE_NOT_APPLICABLE";
    case "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING":
      return "BILLING_DUE_OVERRIDE_NOT_AFTER_CLOSING";
    case "INVALID_BILLING_DUE_OVERRIDE":
      return "INVALID_BILLING_DUE_OVERRIDE";
    case "INVALID_BILLING_RULE_RANGE":
      return "INVALID_BILLING_RULE_RANGE";
    default:
      return "INVALID_BILLING_RULE";
  }
}

function installmentErrorCode(code: string): CreditCardErrorCode {
  switch (code) {
    case "INVALID_AMOUNT":
      return "INVALID_AMOUNT";
    case "AMOUNT_OUT_OF_RANGE":
      return "AMOUNT_OUT_OF_RANGE";
    case "INVALID_INSTALLMENT_COUNT":
      return "INVALID_INSTALLMENT_COUNT";
    case "INSTALLMENT_COUNT_OUT_OF_RANGE":
      return "INSTALLMENT_COUNT_OUT_OF_RANGE";
    case "SCHEDULE_INVARIANT_VIOLATION":
      return "SCHEDULE_INVARIANT_VIOLATION";
    default:
      return "INVALID_INSTALLMENT" as CreditCardErrorCode;
  }
}

async function reserveCommand(
  transaction: PurchaseTransaction,
  context: FinancialContext,
  commandId: string,
  operation: CreditCardCommandOperation,
  hash: string,
  resourceId: string,
): Promise<CommandClaim> {
  const inserted = await transaction
    .insert(applicationCommands)
    .values({
      householdId: context.householdId,
      commandId,
      operation,
      payloadHash: hash,
      resourceId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) {
    return { created: true };
  }
  const rows = await transaction
    .select()
    .from(applicationCommands)
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
      ),
    )
    .limit(1)
    .for("update");
  const record = rows[0];
  if (!record) {
    throw new Error("O registro de idempotência não foi encontrado após conflito.");
  }
  if (record.operation !== operation || record.payloadHash !== hash) {
    throw new CreditCardDomainError("COMMAND_ID_REUSED", "commandId");
  }
  if (!record.resourceId) {
    throw new Error("O registro de idempotência não possui recurso associado.");
  }
  return { created: false, record };
}

async function findCard(
  transaction: PurchaseTransaction,
  context: FinancialContext,
  cardId: string,
): Promise<{ card: typeof creditCards.$inferSelect; account: AccountRecord } | undefined> {
  const rows = await transaction
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
        eq(creditCards.id, cardId),
        eq(creditCards.householdId, context.householdId),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0];
}

async function findRules(
  transaction: PurchaseTransaction,
  context: FinancialContext,
  cardId: string,
): Promise<CreditCardBillingRuleRecord[]> {
  return transaction
    .select()
    .from(creditCardBillingRules)
    .where(
      and(
        eq(creditCardBillingRules.cardId, cardId),
        eq(creditCardBillingRules.householdId, context.householdId),
      ),
    )
    .orderBy(asc(creditCardBillingRules.effectiveFrom), asc(creditCardBillingRules.id));
}

async function findCategory(
  transaction: PurchaseTransaction,
  context: FinancialContext,
  categoryId: string,
): Promise<CategoryRecord | undefined> {
  const rows = await transaction
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, context.householdId)))
    .limit(1);
  return rows[0];
}

function assertPurchaseReferences(
  context: FinancialContext,
  card: { card: typeof creditCards.$inferSelect; account: AccountRecord } | undefined,
  command: CreateCreditCardPurchaseCommand,
  category: CategoryRecord | undefined,
  today: string,
): void {
  if (!card) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  if (card.account.householdId !== context.householdId) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  if (card.account.type !== CREDIT_CARD_ACCOUNT_TYPE) {
    throw new CreditCardDomainError("ACCOUNT_NOT_CREDIT_CARD", "cardId");
  }
  if (card.account.status === "ARCHIVED") {
    throw new CreditCardDomainError("CARD_ARCHIVED", "cardId");
  }
  if (command.occurredOn > today) {
    throw new CreditCardDomainError("DATE_IN_FUTURE", "occurredOn");
  }
  if (
    card.account.trackingStartedOn !== null &&
    command.occurredOn < card.account.trackingStartedOn
  ) {
    throw new CreditCardDomainError("TRACKING_START_DATE_VIOLATION", "occurredOn");
  }
  if (command.categoryId !== undefined && command.categoryId !== null) {
    if (!category || category.householdId !== context.householdId) {
      throw new CreditCardDomainError("CATEGORY_NOT_FOUND", "categoryId");
    }
    if (category.status === "ARCHIVED") {
      throw new CreditCardDomainError("CATEGORY_ARCHIVED", "categoryId");
    }
    if (category.kind !== "EXPENSE") {
      throw new CreditCardDomainError("CATEGORY_KIND_MISMATCH", "categoryId");
    }
  }
}

async function findPurchaseAggregate(
  transaction: PurchaseTransaction | Database,
  context: FinancialContext,
  purchaseId: string,
  lock = false,
): Promise<PurchaseAggregate | undefined> {
  const purchasePredicate = and(
    eq(creditCardPurchases.id, purchaseId),
    eq(creditCardPurchases.householdId, context.householdId),
  );
  const purchaseRows = lock
    ? await transaction
        .select()
        .from(creditCardPurchases)
        .where(purchasePredicate)
        .limit(1)
        .for("update")
    : await transaction
        .select()
        .from(creditCardPurchases)
        .where(purchasePredicate)
        .limit(1);
  const purchase = purchaseRows[0];
  if (!purchase) {
    return undefined;
  }
  const eventRows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, purchase.financialEventId),
        eq(financialEvents.householdId, context.householdId),
      ),
    )
    .limit(1);
  const planRows = await transaction
    .select()
    .from(installmentPlans)
    .where(
      and(
        eq(installmentPlans.id, purchase.installmentPlanId),
        eq(installmentPlans.householdId, context.householdId),
        eq(installmentPlans.purchaseId, purchase.id),
      ),
    )
    .limit(1);
  const event = eventRows[0];
  const plan = planRows[0];
  if (!event || !plan) {
    throw new Error("O agregado de compra está incompleto.");
  }
  const scheduleRows = await transaction
    .select()
    .from(installments)
    .where(
      and(
        eq(installments.planId, plan.id),
        eq(installments.purchaseId, purchase.id),
        eq(installments.householdId, context.householdId),
      ),
    )
    .orderBy(asc(installments.sequence));
  const entryRows = await transaction
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.financialEventId, event.id),
        eq(accountEntries.householdId, context.householdId),
      ),
    );
  return {
    purchase,
    event,
    plan,
    installments: scheduleRows,
    entries: entryRows,
  };
}

function toInstallmentReadModel(
  row: InstallmentRecord,
  entry: AccountEntryRecord | undefined,
): CreditCardInstallmentReadModel {
  const override = row.billingDueOnOverride;
  const snapshot = {
    billingRuleId: row.billingRuleId,
    billingCycle: row.billingCycle.slice(0, 7),
    cycle: row.billingCycle.slice(0, 7),
    competence: row.billingCycle.slice(0, 7),
    closingOn: row.billingClosingOn,
    dueOn: override ?? row.billingDueOn,
    closingDay: row.billingClosingDay,
    dueDay: row.billingDueDay,
    billingDueOnOverride: override,
    dueDateSource: override === null ? ("RULE" as const) : ("OVERRIDE" as const),
  };
  return {
    id: row.id,
    planId: row.planId,
    purchaseId: row.purchaseId,
    sequence: row.sequence,
    amountCents: row.amountCents.toString(10),
    status: row.status,
    billingRuleId: row.billingRuleId,
    billingCycle: snapshot.billingCycle,
    cycle: snapshot.cycle,
    competence: snapshot.competence,
    billingClosingDay: row.billingClosingDay,
    billingDueDay: row.billingDueDay,
    billingClosingOn: row.billingClosingOn,
    billingDueOn: row.billingDueOn,
    billingDueOnOverride: override,
    billingSnapshot: snapshot,
    entryId: entry?.id ?? "",
    entryStatus: entry?.status ?? "EXPECTED",
  };
}

function toReadModel(aggregate: PurchaseAggregate): CreditCardPurchaseReadModel {
  const readInstallments = aggregate.installments.map((row) =>
    toInstallmentReadModel(
      row,
      aggregate.entries.find((entry) => entry.installmentId === row.id),
    ),
  );
  const value = {
    id: aggregate.purchase.id,
    householdId: aggregate.purchase.householdId,
    cardId: aggregate.purchase.cardId,
    financialEventId: aggregate.purchase.financialEventId,
    installmentPlanId: aggregate.purchase.installmentPlanId,
    amountCents: aggregate.event.amountCents.toString(10),
    occurredOn: aggregate.event.occurredOn,
    description: aggregate.event.description,
    categoryId: aggregate.event.categoryId,
    installmentCount: aggregate.plan.installmentCount,
    status: aggregate.event.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
    installments: readInstallments,
    schedule: {
      id: aggregate.plan.id,
      planId: aggregate.plan.id,
      purchaseId: aggregate.plan.purchaseId,
      totalAmountCents: aggregate.plan.totalAmountCents.toString(10),
      installmentCount: aggregate.plan.installmentCount,
      status:
        aggregate.event.status === "CANCELLED"
          ? ("CANCELLED" as const)
          : ("ACTIVE" as const),
      installments: readInstallments,
    },
  } satisfies CreditCardPurchaseReadModel;
  return value;
}

function storedResult(
  record: ApplicationCommandRecord,
  context: FinancialContext,
): CreditCardPurchaseReadModel | undefined {
  const value = record.result;
  if (
    value &&
    typeof value === "object" &&
    (value as { householdId?: unknown }).householdId === context.householdId &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { installments?: unknown }).installments)
  ) {
    return value as CreditCardPurchaseReadModel;
  }
  return undefined;
}

async function completeCommand(
  transaction: PurchaseTransaction,
  context: FinancialContext,
  commandId: string,
  operation: CreditCardCommandOperation,
  hash: string,
  model: CreditCardPurchaseReadModel,
): Promise<void> {
  const rows = await transaction
    .update(applicationCommands)
    .set({ result: model })
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
        eq(applicationCommands.operation, operation),
        eq(applicationCommands.payloadHash, hash),
      ),
    )
    .returning({ commandId: applicationCommands.commandId });
  if (!rows[0]) {
    throw new Error("Não foi possível concluir o registro de idempotência.");
  }
}

function dueStatus(dueOn: string, today: string): "EXPECTED" | "POSTED" {
  return dueOn <= today ? "POSTED" : "EXPECTED";
}

async function executeCreate(
  database: Database,
  context: FinancialContext,
  input: unknown,
  today: string,
): Promise<CreditCardPurchaseReadModel> {
  const command = parseCreateCreditCardPurchaseCommand(input);
  const hash = payloadHash(command);
  const purchaseId = generateUuidV7();
  const planId = generateUuidV7();
  const eventId = generateUuidV7();

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      CREATE_CREDIT_CARD_PURCHASE_OPERATION,
      hash,
      purchaseId,
    );
    if (!claim.created) {
      const original = storedResult(claim.record, context);
      if (original) {
        return original;
      }
      const aggregate = await findPurchaseAggregate(
        transaction,
        context,
        claim.record.resourceId as string,
      );
      if (!aggregate) {
        throw new CreditCardDomainError("PURCHASE_NOT_FOUND", "cardId");
      }
      return toReadModel(aggregate);
    }

    const card = await findCard(transaction, context, command.cardId);
    const category =
      command.categoryId === undefined || command.categoryId === null
        ? undefined
        : await findCategory(transaction, context, command.categoryId);
    assertPurchaseReferences(context, card, command, category, today);
    const rules = await findRules(transaction, context, command.cardId);
    if (rules.length === 0) {
      throw new CreditCardDomainError("BILLING_RULE_NOT_FOUND", "occurredOn");
    }
    const billingRules: BillingRule[] = rules.map((rule) => ({
      id: rule.id,
      cardId: rule.cardId,
      closingDay: rule.closingDay,
      dueDay: rule.dueDay,
      effectiveFrom: rule.effectiveFrom,
      effectiveUntil: rule.effectiveUntil,
    }));

    const generated = generateInstallmentSchedule({
      planId,
      purchaseId,
      amountCents: BigInt(command.amountCents),
      installmentCount: command.installmentCount,
      occurredOn: command.occurredOn,
      rules: billingRules,
      billingDueOnOverride: command.billingDueOnOverride ?? null,
    });

    await transaction.insert(financialEvents).values({
      id: eventId,
      householdId: context.householdId,
      kind: "PURCHASE",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: BigInt(command.amountCents),
      occurredOn: command.occurredOn,
      description: command.description,
      categoryId: command.categoryId ?? null,
      reversalOfEventId: null,
    });
    await transaction.insert(creditCardPurchases).values({
      id: purchaseId,
      householdId: context.householdId,
      cardId: command.cardId,
      financialEventId: eventId,
      installmentPlanId: planId,
    });
    await transaction.insert(installmentPlans).values({
      id: planId,
      householdId: context.householdId,
      purchaseId,
      totalAmountCents: generated.totalAmountCents,
      installmentCount: generated.installmentCount,
    });
    for (const item of generated.installments) {
      const installmentId = generateUuidV7();
      await transaction.insert(installments).values({
        id: installmentId,
        householdId: context.householdId,
        planId,
        purchaseId,
        sequence: item.sequence,
        amountCents: item.amountCents,
        status: "PLANNED",
        billingRuleId: item.billingRuleId as string,
        billingCycle: `${item.billingCycle}-01`,
        billingClosingDay: item.billingClosingDay,
        billingDueDay: item.billingDueDay,
        billingClosingOn: item.billingClosingOn,
        billingDueOn: item.billingDueOn,
        billingDueOnOverride: item.billingDueOnOverride,
      });
      const status = dueStatus(item.billingDueOn, today);
      await transaction.insert(accountEntries).values({
        id: generateUuidV7(),
        financialEventId: eventId,
        installmentId,
        accountId: card?.card.accountId as string,
        householdId: context.householdId,
        amountCents: -item.amountCents,
        status,
        ...(status === "POSTED"
          ? { postedOn: item.billingDueOn, expectedOn: null }
          : { expectedOn: item.billingDueOn, postedOn: null }),
      });
    }

    const aggregate = await findPurchaseAggregate(transaction, context, purchaseId);
    if (!aggregate) {
      throw new Error("A criação da compra não retornou o agregado.");
    }
    const model = toReadModel(aggregate);
    await completeCommand(
      transaction,
      context,
      command.commandId,
      CREATE_CREDIT_CARD_PURCHASE_OPERATION,
      hash,
      model,
    );
    return model;
  });
}

function assertMaintenablePurchase(
  aggregate: PurchaseAggregate,
): void {
  if (
    aggregate.event.kind !== "PURCHASE" ||
    aggregate.event.origin !== "MANUAL" ||
    aggregate.event.status !== "POSTED"
  ) {
    throw new CreditCardDomainError("PURCHASE_NOT_EDITABLE", "purchaseId");
  }
}

function assertCancellablePurchase(aggregate: PurchaseAggregate): void {
  if (aggregate.event.status === "CANCELLED") {
    throw new CreditCardDomainError(
      "PURCHASE_ALREADY_CANCELLED",
      "purchaseId",
    );
  }
  assertMaintenablePurchase(aggregate);
}

async function executeGet(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<CreditCardPurchaseReadModel> {
  const query = parseGetCreditCardPurchaseQuery(input);
  return database.transaction(async (transaction) => {
    const aggregate = await findPurchaseAggregate(
      transaction,
      context,
      query.purchaseId,
    );
    if (!aggregate) {
      throw new CreditCardDomainError("PURCHASE_NOT_FOUND", "purchaseId");
    }
    return toReadModel(aggregate);
  });
}

async function executeUpdate(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<CreditCardPurchaseReadModel> {
  const command = parseUpdateCreditCardPurchaseCommand(input);
  const hash = hashOperationPayload(
    UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
    updatePayload(command),
  );

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
      hash,
      command.purchaseId,
    );
    if (!claim.created) {
      const original = storedResult(claim.record, context);
      if (original) {
        return original;
      }
      const aggregate = await findPurchaseAggregate(
        transaction,
        context,
        claim.record.resourceId as string,
      );
      if (!aggregate) {
        throw new CreditCardDomainError("PURCHASE_NOT_FOUND", "purchaseId");
      }
      return toReadModel(aggregate);
    }

    const aggregate = await findPurchaseAggregate(
      transaction,
      context,
      command.purchaseId,
      true,
    );
    if (!aggregate) {
      throw new CreditCardDomainError("PURCHASE_NOT_FOUND", "purchaseId");
    }
    assertMaintenablePurchase(aggregate);

    let categoryId = aggregate.event.categoryId;
    if (command.categoryId !== undefined) {
      categoryId = command.categoryId;
      if (command.categoryId !== null) {
        const category = await findCategory(
          transaction,
          context,
          command.categoryId,
        );
        if (!category) {
          throw new CreditCardDomainError("CATEGORY_NOT_FOUND", "categoryId");
        }
        if (category.status === "ARCHIVED") {
          throw new CreditCardDomainError("CATEGORY_ARCHIVED", "categoryId");
        }
        if (category.kind !== "EXPENSE") {
          throw new CreditCardDomainError(
            "CATEGORY_KIND_MISMATCH",
            "categoryId",
          );
        }
      }
    }

    const updatedEventRows = await transaction
      .update(financialEvents)
      .set({
        ...(command.description === undefined
          ? {}
          : { description: command.description }),
        ...(command.categoryId === undefined ? {} : { categoryId }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financialEvents.id, aggregate.event.id),
          eq(financialEvents.householdId, context.householdId),
          eq(financialEvents.kind, "PURCHASE"),
          eq(financialEvents.status, "POSTED"),
        ),
      )
      .returning({ id: financialEvents.id });
    if (!updatedEventRows[0]) {
      throw new CreditCardDomainError("PURCHASE_NOT_EDITABLE", "purchaseId");
    }

    await transaction
      .update(creditCardPurchases)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(creditCardPurchases.id, command.purchaseId),
          eq(creditCardPurchases.householdId, context.householdId),
        ),
      );

    const updatedAggregate = await findPurchaseAggregate(
      transaction,
      context,
      command.purchaseId,
    );
    if (!updatedAggregate) {
      throw new Error("A edição da compra não retornou o agregado.");
    }
    const model = toReadModel(updatedAggregate);
    await completeCommand(
      transaction,
      context,
      command.commandId,
      UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
      hash,
      model,
    );
    return model;
  });
}

async function executeCancel(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<CreditCardPurchaseReadModel> {
  const command = parseCancelCreditCardPurchaseCommand(input);
  const hash = hashOperationPayload(
    CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
    cancelPayload(command),
  );

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
      hash,
      command.purchaseId,
    );
    if (!claim.created) {
      const original = storedResult(claim.record, context);
      if (original) {
        return original;
      }
      const aggregate = await findPurchaseAggregate(
        transaction,
        context,
        claim.record.resourceId as string,
      );
      if (!aggregate) {
        throw new CreditCardDomainError("PURCHASE_NOT_FOUND", "purchaseId");
      }
      return toReadModel(aggregate);
    }

    const aggregate = await findPurchaseAggregate(
      transaction,
      context,
      command.purchaseId,
      true,
    );
    if (!aggregate) {
      throw new CreditCardDomainError("PURCHASE_NOT_FOUND", "purchaseId");
    }
    assertCancellablePurchase(aggregate);

    const postedEntries = aggregate.entries.filter(
      (entry) => entry.status === "POSTED",
    );
    if (postedEntries.length > 0) {
      const reversalRows = await transaction
        .select({ id: financialEvents.id })
        .from(financialEvents)
        .where(
          and(
            eq(financialEvents.householdId, context.householdId),
            eq(financialEvents.reversalOfEventId, aggregate.event.id),
          ),
        )
        .limit(1);
      if (reversalRows[0]) {
        throw new CreditCardDomainError("CONFLICT", "purchaseId");
      }

      const reversalAmount = postedEntries.reduce(
        (total, entry) =>
          total +
            (entry.amountCents < BigInt(0)
              ? -entry.amountCents
              : entry.amountCents),
        BigInt(0),
      );
      if (reversalAmount <= BigInt(0)) {
        throw new CreditCardDomainError("SCHEDULE_INVARIANT_VIOLATION");
      }
      const reversalId = generateUuidV7();
      await transaction.insert(financialEvents).values({
        id: reversalId,
        householdId: context.householdId,
        kind: "REVERSAL",
        status: "POSTED",
        origin: "SYSTEM",
        amountCents: reversalAmount,
        occurredOn: aggregate.event.occurredOn,
        description: aggregate.event.description,
        categoryId: aggregate.event.categoryId,
        reversalOfEventId: aggregate.event.id,
      });
      for (const entry of postedEntries) {
        await transaction.insert(accountEntries).values({
          id: generateUuidV7(),
          financialEventId: reversalId,
          accountId: entry.accountId,
          householdId: context.householdId,
          amountCents: -entry.amountCents,
          status: "POSTED",
          expectedOn: null,
          postedOn: entry.postedOn ?? aggregate.event.occurredOn,
        });
      }
    }

    await transaction
      .update(installments)
      .set({ status: "CANCELLED" })
      .where(
        and(
          eq(installments.purchaseId, command.purchaseId),
          eq(installments.householdId, context.householdId),
          inArray(installments.status, ["PLANNED", "POSTED"]),
        ),
      );

    const updatedEventRows = await transaction
      .update(financialEvents)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(
        and(
          eq(financialEvents.id, aggregate.event.id),
          eq(financialEvents.householdId, context.householdId),
          eq(financialEvents.kind, "PURCHASE"),
          eq(financialEvents.status, "POSTED"),
        ),
      )
      .returning({ id: financialEvents.id });
    if (!updatedEventRows[0]) {
      throw new CreditCardDomainError(
        "PURCHASE_ALREADY_CANCELLED",
        "purchaseId",
      );
    }

    await transaction
      .update(creditCardPurchases)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(creditCardPurchases.id, command.purchaseId),
          eq(creditCardPurchases.householdId, context.householdId),
        ),
      );

    const cancelledAggregate = await findPurchaseAggregate(
      transaction,
      context,
      command.purchaseId,
    );
    if (!cancelledAggregate) {
      throw new Error("O cancelamento da compra não retornou o agregado.");
    }
    const model = toReadModel(cancelledAggregate);
    await completeCommand(
      transaction,
      context,
      command.commandId,
      CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
      hash,
      model,
    );
    return model;
  });
}

function operationContext(
  operation:
    | typeof CREATE_CREDIT_CARD_PURCHASE_OPERATION
    | "credit_card.purchase.read"
    | typeof UPDATE_CREDIT_CARD_PURCHASE_OPERATION
    | typeof CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
  context: FinancialContext,
  input: unknown,
) {
  const purchaseId =
    typeof input === "object" && input !== null && typeof (input as { purchaseId?: unknown }).purchaseId === "string"
      ? (input as { purchaseId: string }).purchaseId
      : undefined;
  const cardId =
    typeof input === "object" && input !== null && typeof (input as { cardId?: unknown }).cardId === "string"
      ? (input as { cardId: string }).cardId
      : undefined;
  return createCreditCardOperation(operation, {
    householdId: context.householdId,
    userId: context.userId,
    ...(cardId ? { cardId } : {}),
    ...(purchaseId ? { purchaseId } : {}),
  });
}

function isDatabase(value: unknown): value is Database {
  return typeof value === "object" && value !== null && "select" in value && "transaction" in value;
}

function optionsFor(value?: Database | CreditCardPurchaseUseCaseOptions): CreditCardPurchaseUseCaseOptions {
  return isDatabase(value) ? { database: value } : value ?? {};
}

export function createCreditCardPurchaseUseCases(
  databaseOrOptions?: Database | CreditCardPurchaseUseCaseOptions,
): CreditCardPurchaseUseCasePort {
  const options = optionsFor(databaseOrOptions);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  return {
    get: async (context, query) => {
      const normalized = normalizeContext(context);
      return toResult(() =>
        withCreditCardObservability(
          operationContext("credit_card.purchase.read", normalized, query),
          () => executeGet(resolveDatabase(options.database), normalized, query),
        ),
      );
    },
    create: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() =>
        withCreditCardObservability(
          operationContext(
            CREATE_CREDIT_CARD_PURCHASE_OPERATION,
            normalized,
            command,
          ),
          () => executeCreate(resolveDatabase(options.database), normalized, command, today),
        ),
      );
    },
    update: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() =>
        withCreditCardObservability(
          operationContext(
            UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
            normalized,
            command,
          ),
          () => executeUpdate(resolveDatabase(options.database), normalized, command),
        ),
      );
    },
    cancel: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() =>
        withCreditCardObservability(
          operationContext(
            CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
            normalized,
            command,
          ),
          () => executeCancel(resolveDatabase(options.database), normalized, command),
        ),
      );
    },
  };
}

export const createCreditCardPurchaseUseCase = createCreditCardPurchaseUseCases;
export const createPurchaseUseCases = createCreditCardPurchaseUseCases;
export const creditCardPurchaseUseCases = createCreditCardPurchaseUseCases();
export const creditCardPurchaseUseCase = creditCardPurchaseUseCases;

export async function getCreditCardPurchase(
  context: FinancialContext,
  query: unknown,
  databaseOrOptions?: Database | CreditCardPurchaseUseCaseOptions,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  return createCreditCardPurchaseUseCases(databaseOrOptions).get(context, query);
}

export const getPurchase = getCreditCardPurchase;

export async function createCreditCardPurchase(
  context: FinancialContext,
  command: unknown,
  databaseOrOptions?: Database | CreditCardPurchaseUseCaseOptions,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  return createCreditCardPurchaseUseCases(databaseOrOptions).create(context, command);
}

export const createPurchase = createCreditCardPurchase;

export async function updateCreditCardPurchase(
  context: FinancialContext,
  command: unknown,
  databaseOrOptions?: Database | CreditCardPurchaseUseCaseOptions,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  return createCreditCardPurchaseUseCases(databaseOrOptions).update(context, command);
}

export const updatePurchase = updateCreditCardPurchase;

export async function cancelCreditCardPurchase(
  context: FinancialContext,
  command: unknown,
  databaseOrOptions?: Database | CreditCardPurchaseUseCaseOptions,
): Promise<CreditCardResult<CreditCardPurchaseReadModel>> {
  return createCreditCardPurchaseUseCases(databaseOrOptions).cancel(context, command);
}

export const cancelPurchase = cancelCreditCardPurchase;

export type {
  CreditCardPurchaseReadModel,
  CreditCardInstallmentReadModel,
} from "./contracts";
