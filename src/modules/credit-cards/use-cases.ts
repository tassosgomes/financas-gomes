import { createHash } from "node:crypto";

import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  accounts,
  applicationCommands,
  type AccountRecord,
  type ApplicationCommandRecord,
} from "@/db/accounts-categories-schema";
import {
  accountEntries,
  financialEvents,
  type AccountEntryRecord,
  type FinancialEventRecord,
} from "@/db/financial-events-schema";
import {
  creditCardBillingRules,
  creditCards,
  type CreditCardBillingRuleRecord,
  type CreditCardRecord,
} from "@/db/credit-cards-schema";
import { generateUuidV7 } from "@/lib/uuidv7";
import type { FinancialContext } from "@/modules/households/contracts";
import { assertFinancialContext } from "@/modules/households/tenant-scoped";
import {
  assertDateNotFuture,
  assertDateOnOrAfter,
  formatFinancialDate,
  parseFinancialDate,
  Money,
  type FinancialDate,
} from "@/modules/transactions/domain";
import {
  insertAccountEntryForContext,
  insertFinancialEventForContext,
} from "@/modules/transactions/references";
import {
  createS06CreditCardOperation,
  withS06CreditCardObservability,
  type S06CreditCardOperation,
  type S06CreditCardOperationContext,
} from "@/modules/observability/s06";

import {
  ARCHIVE_CREDIT_CARD_OPERATION,
  CREATE_CREDIT_CARD_BILLING_RULE_OPERATION,
  CREATE_CREDIT_CARD_PAYMENT_OPERATION,
  CREATE_CREDIT_CARD_OPERATION,
  CREDIT_CARD_ACCOUNT_TYPE,
  UPDATE_CREDIT_CARD_BILLING_RULE_OPERATION,
  UPDATE_CREDIT_CARD_OPERATION,
  CreditCardDomainError,
  failure,
  ok,
  type AccountReference,
  type ArchiveCreditCardCommand,
  type CreditCardBillingRuleReadModel,
  type CreditCardCommandOperation,
  type CreditCardPaymentEntryReadModel,
  type CreditCardPaymentReadModel,
  type CreditCardReadModel,
  type CreditCardResult,
  type CreateCreditCardCommand,
  type RegisterCreditCardPaymentCommand,
  type GetCreditCardQuery,
  type ListCreditCardsReadModel,
  type UpdateCreditCardBillingRuleCommand,
  type UpdateCreditCardCommand,
} from "./contracts";
import {
  assertBillingRuleVersion,
  assertCreditCardCanArchive,
  assertCreditCardIsActive,
  assertDefaultPaymentAccount,
  normalizeCreateCreditCardCommand,
  parseArchiveCreditCardCommand,
  parseCreateCreditCardCommand,
  parseGetCreditCardQuery,
  parseListCreditCardsQuery,
  parseRegisterCreditCardPaymentCommand,
  parseUpdateCreditCardBillingRuleCommand,
  parseUpdateCreditCardCommand,
} from "./validation";
import {
  assertCreditCardPaymentSourceAccount,
} from "./validation";
import { buildCreditCardPaymentTransfer } from "./payments";

/** Drizzle transaction type shared by node-postgres and Neon. */
export type CreditCardTransaction =
  Parameters<NonNullable<ReturnType<typeof getDb>["transaction"]>>[0] extends (
    transaction: infer T,
  ) => Promise<unknown>
    ? T
    : never;

export interface CreditCardUseCasePort {
  create(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardReadModel>>;
  list(
    context: FinancialContext,
    query?: unknown,
  ): Promise<CreditCardResult<ListCreditCardsReadModel>>;
  get(
    context: FinancialContext,
    query: unknown,
  ): Promise<CreditCardResult<CreditCardReadModel>>;
  update(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardReadModel>>;
  archive(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardReadModel>>;
  createBillingRule(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardReadModel>>;
  updateBillingRule(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardReadModel>>;
  createPayment(
    context: FinancialContext,
    command: unknown,
  ): Promise<CreditCardResult<CreditCardPaymentReadModel>>;
}

export interface CreditCardUseCaseOptions {
  database?: Database;
  /** Injectable civil business date for deterministic payment validation. */
  today?: FinancialDate | string;
}

type CreditCardAggregate = {
  card: CreditCardRecord;
  account: AccountRecord;
  rules: CreditCardBillingRuleRecord[];
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

function payloadHash(
  operation: CreditCardCommandOperation,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, payload }), "utf8")
    .digest("hex");
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
    if (constraint === "accounts_household_name_ci_uq") {
      return new CreditCardDomainError("CREDIT_CARD_NAME_CONFLICT", "name");
    }
    if (
      constraint === "credit_card_billing_rules_card_effective_from_uq" ||
      constraint === "credit_card_billing_rules_no_overlap"
    ) {
      return new CreditCardDomainError("BILLING_RULE_OVERLAP", "effectiveFrom");
    }
    return new CreditCardDomainError("CONFLICT");
  }
  if (code === "23P01") {
    return new CreditCardDomainError("BILLING_RULE_OVERLAP", "effectiveFrom");
  }
  if (code === "23503") {
    return new CreditCardDomainError("PAYMENT_ACCOUNT_NOT_FOUND", "defaultPaymentAccountId");
  }
  if (code === "23514") {
    return new CreditCardDomainError("CREDIT_CARD_INVALID");
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
    throw error;
  }
}

function accountReference(row: AccountRecord): AccountReference {
  return {
    id: row.id,
    householdId: row.householdId,
    status: row.status,
    type: row.type,
  };
}

function billingRuleReadModel(row: CreditCardBillingRuleRecord): CreditCardBillingRuleReadModel {
  return {
    id: row.id,
    cardId: row.cardId,
    closingDay: row.closingDay,
    dueDay: row.dueDay,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
  };
}

function toReadModel(aggregate: CreditCardAggregate): CreditCardReadModel {
  const rules = aggregate.rules.map(billingRuleReadModel);
  const today = new Date().toISOString().slice(0, 10);
  const activeBillingRule =
    rules.find(
      (rule) =>
        rule.effectiveFrom <= today &&
        (rule.effectiveUntil === null || today < rule.effectiveUntil),
    ) ?? null;

  return {
    id: aggregate.card.id,
    householdId: aggregate.card.householdId,
    accountId: aggregate.card.accountId,
    name: aggregate.account.name,
    type: CREDIT_CARD_ACCOUNT_TYPE,
    status: aggregate.account.status,
    creditLimitCents: aggregate.card.creditLimitCents.toString(10),
    defaultPaymentAccountId: aggregate.card.defaultPaymentAccountId,
    activeBillingRule,
    billingRules: rules,
  };
}

function isReadModel(value: unknown, householdId: string): value is CreditCardReadModel {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { householdId?: unknown }).householdId === householdId &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { billingRules?: unknown }).billingRules)
  );
}

async function findAggregate(
  queryable: CreditCardTransaction | Database,
  context: FinancialContext,
  cardId: string,
  lock = false,
): Promise<CreditCardAggregate | undefined> {
  const predicate = and(
    eq(creditCards.id, cardId),
    eq(creditCards.householdId, context.householdId),
    eq(accounts.id, creditCards.accountId),
    eq(accounts.householdId, context.householdId),
  );
  const query = queryable
    .select({ card: creditCards, account: accounts })
    .from(creditCards)
    .innerJoin(accounts, predicate)
    .where(
      and(
        eq(creditCards.id, cardId),
        eq(creditCards.householdId, context.householdId),
      ),
    )
    .limit(1);
  const rows = lock ? await query.for("update") : await query;
  const row = rows[0];
  if (!row) {
    return undefined;
  }

  const rules = await queryable
    .select()
    .from(creditCardBillingRules)
    .where(
      and(
        eq(creditCardBillingRules.cardId, cardId),
        eq(creditCardBillingRules.householdId, context.householdId),
      ),
    )
    .orderBy(asc(creditCardBillingRules.effectiveFrom), asc(creditCardBillingRules.id));
  return { card: row.card, account: row.account, rules };
}

async function findPaymentAccount(
  transaction: CreditCardTransaction,
  context: FinancialContext,
  accountId: string,
): Promise<AccountRecord | undefined> {
  const rows = await transaction
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, context.householdId)))
    .limit(1);
  return rows[0];
}

async function hasNameConflict(
  transaction: CreditCardTransaction,
  context: FinancialContext,
  name: string,
  exceptAccountId?: string,
): Promise<boolean> {
  const predicates: SQL<unknown>[] = [
    eq(accounts.householdId, context.householdId),
    sql`lower(${accounts.name}) = lower(${name})`,
  ];
  if (exceptAccountId) {
    predicates.push(ne(accounts.id, exceptAccountId));
  }
  const rows = await transaction
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(...predicates))
    .limit(1);
  return rows.length > 0;
}

async function reserveCommand(
  transaction: CreditCardTransaction,
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

async function completeCommand(
  transaction: CreditCardTransaction,
  context: FinancialContext,
  commandId: string,
  operation: CreditCardCommandOperation,
  hash: string,
  model: CreditCardReadModel,
): Promise<void> {
  const updated = await transaction
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
  if (!updated[0]) {
    throw new Error("Não foi possível concluir o registro de idempotência.");
  }
}

async function resultForClaim(
  transaction: CreditCardTransaction,
  context: FinancialContext,
  claim: Extract<CommandClaim, { created: false }>,
): Promise<CreditCardReadModel> {
  if (isReadModel(claim.record.result, context.householdId)) {
    return claim.record.result;
  }
  const aggregate = await findAggregate(
    transaction,
    context,
    claim.record.resourceId as string,
  );
  if (!aggregate) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  return toReadModel(aggregate);
}

const DEFAULT_PAYMENT_DESCRIPTION = "Pagamento de cartão";

function paymentPayload(command: RegisterCreditCardPaymentCommand): object {
  return {
    cardId: command.cardId,
    sourceAccountId: command.sourceAccountId,
    amountCents: command.amountCents,
    occurredOn: command.occurredOn,
    description: command.description ?? DEFAULT_PAYMENT_DESCRIPTION,
  };
}

function errorCode(value: unknown): string | undefined {
  return value && typeof value === "object" && "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
    ? (value as { code: string }).code
    : undefined;
}

/** Applies civil-date upper/lower anchors and maps S03 failures to S06. */
function paymentDateBoundary(
  value: string,
  sourceAccount: AccountRecord,
  cardAccount: AccountRecord,
  today?: FinancialDate | string,
): string {
  try {
    const occurredOn = parseFinancialDate(value);
    assertDateNotFuture(occurredOn, today);
    assertDateOnOrAfter(occurredOn, sourceAccount.trackingStartedOn);
    assertDateOnOrAfter(occurredOn, cardAccount.trackingStartedOn);
    return formatFinancialDate(occurredOn);
  } catch (error) {
    const code = errorCode(error);
    if (
      code === "INVALID_DATE" ||
      code === "DATE_IN_FUTURE" ||
      code === "TRACKING_START_DATE_VIOLATION"
    ) {
      throw new CreditCardDomainError(
        code,
        "occurredOn",
      );
    }
    throw error;
  }
}

function toPaymentEntryReadModel(
  entry: AccountEntryRecord,
): CreditCardPaymentEntryReadModel {
  if (
    entry.status !== "POSTED" ||
    entry.installmentId !== null ||
    entry.expectedOn !== null ||
    entry.postedOn === null
  ) {
    throw new Error("A entry de pagamento possui um shape inválido.");
  }
  return {
    id: entry.id,
    financialEventId: entry.financialEventId,
    householdId: entry.householdId,
    accountId: entry.accountId,
    amountCents: entry.amountCents.toString(10),
    status: "POSTED",
    installmentId: null,
    expectedOn: null,
    postedOn: entry.postedOn,
  };
}

function toPaymentReadModel(
  event: FinancialEventRecord,
  sourceEntry: AccountEntryRecord,
  cardEntry: AccountEntryRecord,
  cardId: string,
): CreditCardPaymentReadModel {
  if (
    event.kind !== "TRANSFER" ||
    event.origin !== "MANUAL" ||
    event.status !== "POSTED" ||
    event.reversalOfEventId !== null ||
    event.categoryId !== null
  ) {
    throw new Error("O evento de pagamento possui um shape inválido.");
  }
  const source = toPaymentEntryReadModel(sourceEntry);
  const card = toPaymentEntryReadModel(cardEntry);
  if (
    source.amountCents !== `-${event.amountCents.toString(10)}` ||
    card.amountCents !== event.amountCents.toString(10) ||
    BigInt(source.amountCents) + BigInt(card.amountCents) !== BigInt(0)
  ) {
    throw new Error("As entries de pagamento não fecham soma zero.");
  }
  const entries = Object.freeze([source, card]) as readonly [
    CreditCardPaymentEntryReadModel,
    CreditCardPaymentEntryReadModel,
  ];
  return {
    id: event.id,
    paymentId: event.id,
    financialEventId: event.id,
    householdId: event.householdId,
    cardId,
    creditCardAccountId: card.accountId,
    sourceAccountId: source.accountId,
    kind: "TRANSFER",
    origin: "MANUAL",
    status: "POSTED",
    amountCents: event.amountCents.toString(10),
    occurredOn: event.occurredOn,
    description: event.description,
    entries,
  };
}

function isPaymentReadModel(
  value: unknown,
  householdId: string,
  cardId: string,
): value is CreditCardPaymentReadModel {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { householdId?: unknown }).householdId === householdId &&
    (value as { cardId?: unknown }).cardId === cardId &&
    (value as { kind?: unknown }).kind === "TRANSFER" &&
    (value as { status?: unknown }).status === "POSTED" &&
    Array.isArray((value as { entries?: unknown }).entries) &&
    (value as { entries: unknown[] }).entries.length === 2
  );
}

async function completePaymentCommand(
  transaction: CreditCardTransaction,
  context: FinancialContext,
  commandId: string,
  hash: string,
  model: CreditCardPaymentReadModel,
): Promise<void> {
  const updated = await transaction
    .update(applicationCommands)
    .set({ result: model })
    .where(
      and(
        eq(applicationCommands.householdId, context.householdId),
        eq(applicationCommands.commandId, commandId),
        eq(applicationCommands.operation, CREATE_CREDIT_CARD_PAYMENT_OPERATION),
        eq(applicationCommands.payloadHash, hash),
      ),
    )
    .returning({ commandId: applicationCommands.commandId });
  if (!updated[0]) {
    throw new Error("Não foi possível concluir o pagamento idempotente.");
  }
}

async function resultForPaymentClaim(
  transaction: CreditCardTransaction,
  context: FinancialContext,
  claim: Extract<CommandClaim, { created: false }>,
  cardId: string,
): Promise<CreditCardPaymentReadModel> {
  if (isPaymentReadModel(claim.record.result, context.householdId, cardId)) {
    return claim.record.result;
  }

  const eventRows = await transaction
    .select()
    .from(financialEvents)
    .where(
      and(
        eq(financialEvents.id, claim.record.resourceId as string),
        eq(financialEvents.householdId, context.householdId),
        eq(financialEvents.kind, "TRANSFER"),
        eq(financialEvents.origin, "MANUAL"),
        eq(financialEvents.status, "POSTED"),
      ),
    )
    .limit(1);
  const event = eventRows[0];
  if (!event) {
    throw new Error("O evento de pagamento idempotente não foi encontrado.");
  }

  const entries = await transaction
    .select()
    .from(accountEntries)
    .where(
      and(
        eq(accountEntries.financialEventId, event.id),
        eq(accountEntries.householdId, context.householdId),
      ),
    )
    .orderBy(asc(accountEntries.id));
  if (entries.length !== 2 || entries.some((entry) => entry.installmentId !== null)) {
    throw new Error("O pagamento idempotente não possui exatamente duas entries.");
  }

  const aggregate = await findAggregate(transaction, context, cardId);
  if (!aggregate) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  const cardEntry = entries.find((entry) => entry.accountId === aggregate.card.accountId);
  const sourceEntry = entries.find((entry) => entry.accountId !== aggregate.card.accountId);
  if (!cardEntry || !sourceEntry) {
    throw new Error("As entries idempotentes não apontam para o cartão esperado.");
  }
  return toPaymentReadModel(event, sourceEntry, cardEntry, cardId);
}

async function executePayment(
  database: Database,
  context: FinancialContext,
  input: unknown,
  today?: FinancialDate | string,
): Promise<CreditCardPaymentReadModel> {
  const command = parseRegisterCreditCardPaymentCommand(input);
  const amount = Money.fromCents(command.amountCents);
  const paymentId = generateUuidV7();
  const sourceEntryId = generateUuidV7();
  const cardEntryId = generateUuidV7();
  const hash = payloadHash(
    CREATE_CREDIT_CARD_PAYMENT_OPERATION,
    paymentPayload(command),
  );

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      CREATE_CREDIT_CARD_PAYMENT_OPERATION,
      hash,
      paymentId,
    );
    if (!claim.created) {
      return resultForPaymentClaim(
        transaction,
        context,
        claim,
        command.cardId,
      );
    }

    const aggregate = await findAggregate(
      transaction,
      context,
      command.cardId,
      true,
    );
    if (!aggregate) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    assertCreditCardIsActive({
      card: {
        id: aggregate.card.id,
        householdId: aggregate.card.householdId,
        accountId: aggregate.card.accountId,
        status: aggregate.account.status,
        type: aggregate.account.type,
      },
      householdId: context.householdId,
      account: accountReference(aggregate.account),
    });

    const source = await findPaymentAccount(
      transaction,
      context,
      command.sourceAccountId,
    );
    if (!source) {
      throw new CreditCardDomainError("PAYMENT_ACCOUNT_NOT_FOUND", "sourceAccountId");
    }
    const paymentSource = assertCreditCardPaymentSourceAccount({
      householdId: context.householdId,
      cardAccountId: aggregate.card.accountId,
      sourceAccountId: command.sourceAccountId,
      account: source ? accountReference(source) : null,
    });
    const occurredOn = paymentDateBoundary(
      command.occurredOn,
      source,
      aggregate.account,
      today,
    );
    const transfer = buildCreditCardPaymentTransfer({
      sourceAccountId: paymentSource.id,
      cardAccountId: aggregate.card.accountId,
      amount,
      postedOn: occurredOn,
    });
    const [sourceDraft, cardDraft] = transfer.entries;
    const event = await insertFinancialEventForContext(transaction, context, {
      id: paymentId,
      kind: "TRANSFER",
      status: "POSTED",
      origin: "MANUAL",
      amountCents: transfer.amountCents,
      occurredOn,
      description: command.description ?? DEFAULT_PAYMENT_DESCRIPTION,
      categoryId: null,
      reversalOfEventId: null,
    });
    const sourceEntry = await insertAccountEntryForContext(transaction, context, {
      id: sourceEntryId,
      financialEventId: event.id,
      installmentId: sourceDraft.installmentId,
      accountId: sourceDraft.accountId,
      amountCents: sourceDraft.amountCents,
      status: sourceDraft.status,
      expectedOn: sourceDraft.expectedOn,
      postedOn: sourceDraft.postedOn,
    });
    const cardEntry = await insertAccountEntryForContext(transaction, context, {
      id: cardEntryId,
      financialEventId: event.id,
      installmentId: cardDraft.installmentId,
      accountId: cardDraft.accountId,
      amountCents: cardDraft.amountCents,
      status: cardDraft.status,
      expectedOn: cardDraft.expectedOn,
      postedOn: cardDraft.postedOn,
    });
    const model = toPaymentReadModel(event, sourceEntry, cardEntry, command.cardId);
    await completePaymentCommand(
      transaction,
      context,
      command.commandId,
      hash,
      model,
    );
    return model;
  });
}

function createCommandHash(command: CreateCreditCardCommand): string {
  return payloadHash(CREATE_CREDIT_CARD_OPERATION, {
    name: command.name,
    creditLimitCents: command.creditLimitCents,
    closingDay: command.closingDay,
    dueDay: command.dueDay,
    defaultPaymentAccountId: command.defaultPaymentAccountId ?? null,
    effectiveFrom: command.effectiveFrom,
  });
}

function updateHash(command: UpdateCreditCardCommand): string {
  return payloadHash(UPDATE_CREDIT_CARD_OPERATION, {
    cardId: command.cardId,
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.creditLimitCents === undefined
      ? {}
      : { creditLimitCents: command.creditLimitCents }),
    ...(command.defaultPaymentAccountId === undefined
      ? {}
      : { defaultPaymentAccountId: command.defaultPaymentAccountId }),
  });
}

function archiveHash(command: ArchiveCreditCardCommand): string {
  return payloadHash(ARCHIVE_CREDIT_CARD_OPERATION, { cardId: command.cardId });
}

function billingHash(
  command: UpdateCreditCardBillingRuleCommand,
  operation: CreditCardCommandOperation,
): string {
  return payloadHash(operation, {
    cardId: command.cardId,
    closingDay: command.closingDay,
    dueDay: command.dueDay,
    effectiveFrom: command.effectiveFrom,
  });
}

async function executeCreate(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<CreditCardReadModel> {
  const parsed = normalizeCreateCreditCardCommand(
    parseCreateCreditCardCommand(input),
    new Date().toISOString().slice(0, 10),
  );
  const hash = createCommandHash(parsed);
  const cardId = generateUuidV7();
  const accountId = generateUuidV7();

  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      parsed.commandId,
      CREATE_CREDIT_CARD_OPERATION,
      hash,
      cardId,
    );
    if (!claim.created) {
      return resultForClaim(transaction, context, claim);
    }

    if (await hasNameConflict(transaction, context, parsed.name)) {
      throw new CreditCardDomainError("CREDIT_CARD_NAME_CONFLICT", "name");
    }

    const payment = parsed.defaultPaymentAccountId
      ? await findPaymentAccount(transaction, context, parsed.defaultPaymentAccountId)
      : null;
    assertDefaultPaymentAccount({
      householdId: context.householdId,
      cardAccountId: accountId,
      defaultPaymentAccountId: parsed.defaultPaymentAccountId,
      account: payment ? accountReference(payment) : null,
    });

    await transaction.insert(accounts).values({
      id: accountId,
      householdId: context.householdId,
      name: parsed.name,
      type: CREDIT_CARD_ACCOUNT_TYPE,
      status: "ACTIVE",
      trackingStartedOn: null,
    });
    await transaction.insert(creditCards).values({
      id: cardId,
      householdId: context.householdId,
      accountId,
      creditLimitCents: BigInt(parsed.creditLimitCents),
      defaultPaymentAccountId: parsed.defaultPaymentAccountId ?? null,
    });
    await transaction.insert(creditCardBillingRules).values({
      id: generateUuidV7(),
      householdId: context.householdId,
      cardId,
      closingDay: parsed.closingDay,
      dueDay: parsed.dueDay,
      effectiveFrom: parsed.effectiveFrom as string,
      effectiveUntil: null,
    });

    const aggregate = await findAggregate(transaction, context, cardId);
    if (!aggregate) {
      throw new Error("A criação do cartão não retornou o agregado.");
    }
    const model = toReadModel(aggregate);
    await completeCommand(
      transaction,
      context,
      parsed.commandId,
      CREATE_CREDIT_CARD_OPERATION,
      hash,
      model,
    );
    return model;
  });
}

async function executeUpdate(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<CreditCardReadModel> {
  const command = parseUpdateCreditCardCommand(input);
  const hash = updateHash(command);
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(
      transaction,
      context,
      command.commandId,
      UPDATE_CREDIT_CARD_OPERATION,
      hash,
      command.cardId,
    );
    if (!claim.created) {
      return resultForClaim(transaction, context, claim);
    }
    const current = await findAggregate(transaction, context, command.cardId, true);
    if (!current) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    assertCreditCardIsActive(
      {
        card: {
          id: current.card.id,
          householdId: current.card.householdId,
          accountId: current.card.accountId,
          status: current.account.status,
          type: current.account.type,
        },
        householdId: context.householdId,
        account: accountReference(current.account),
      },
    );

    if (command.name !== undefined && (await hasNameConflict(transaction, context, command.name, current.account.id))) {
      throw new CreditCardDomainError("CREDIT_CARD_NAME_CONFLICT", "name");
    }
    if (command.defaultPaymentAccountId !== undefined) {
      const payment = command.defaultPaymentAccountId
        ? await findPaymentAccount(transaction, context, command.defaultPaymentAccountId)
        : null;
      assertDefaultPaymentAccount({
        householdId: context.householdId,
        cardAccountId: current.card.accountId,
        defaultPaymentAccountId: command.defaultPaymentAccountId,
        account: payment ? accountReference(payment) : null,
      });
    }

    if (command.name !== undefined) {
      await transaction
        .update(accounts)
        .set({ name: command.name, updatedAt: new Date() })
        .where(and(eq(accounts.id, current.account.id), eq(accounts.householdId, context.householdId)));
    }
    if (command.creditLimitCents !== undefined || command.defaultPaymentAccountId !== undefined) {
      await transaction
        .update(creditCards)
        .set({
          ...(command.creditLimitCents === undefined
            ? {}
            : { creditLimitCents: BigInt(command.creditLimitCents) }),
          ...(command.defaultPaymentAccountId === undefined
            ? {}
            : { defaultPaymentAccountId: command.defaultPaymentAccountId }),
          updatedAt: new Date(),
        })
        .where(and(eq(creditCards.id, current.card.id), eq(creditCards.householdId, context.householdId)));
    }

    const aggregate = await findAggregate(transaction, context, command.cardId);
    if (!aggregate) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    const model = toReadModel(aggregate);
    await completeCommand(transaction, context, command.commandId, UPDATE_CREDIT_CARD_OPERATION, hash, model);
    return model;
  });
}

async function executeArchive(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<CreditCardReadModel> {
  const command = parseArchiveCreditCardCommand(input);
  const hash = archiveHash(command);
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, ARCHIVE_CREDIT_CARD_OPERATION, hash, command.cardId);
    if (!claim.created) {
      return resultForClaim(transaction, context, claim);
    }
    const current = await findAggregate(transaction, context, command.cardId, true);
    if (!current) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    assertCreditCardCanArchive({
      card: {
        id: current.card.id,
        householdId: current.card.householdId,
        accountId: current.card.accountId,
        status: current.account.status,
        type: current.account.type,
      },
      householdId: context.householdId,
    });
    await transaction
      .update(accounts)
      .set({ status: "ARCHIVED", updatedAt: new Date() })
      .where(and(eq(accounts.id, current.account.id), eq(accounts.householdId, context.householdId)));
    const aggregate = await findAggregate(transaction, context, command.cardId);
    if (!aggregate) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    const model = toReadModel(aggregate);
    await completeCommand(transaction, context, command.commandId, ARCHIVE_CREDIT_CARD_OPERATION, hash, model);
    return model;
  });
}

async function executeBillingRule(
  database: Database,
  context: FinancialContext,
  input: unknown,
  operation: CreditCardCommandOperation,
): Promise<CreditCardReadModel> {
  const command = parseUpdateCreditCardBillingRuleCommand(input);
  const hash = billingHash(command, operation);
  return database.transaction(async (transaction) => {
    const claim = await reserveCommand(transaction, context, command.commandId, operation, hash, command.cardId);
    if (!claim.created) {
      return resultForClaim(transaction, context, claim);
    }
    const current = await findAggregate(transaction, context, command.cardId, true);
    if (!current) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    assertCreditCardIsActive({
      card: {
        id: current.card.id,
        householdId: current.card.householdId,
        accountId: current.card.accountId,
        status: current.account.status,
        type: current.account.type,
      },
      householdId: context.householdId,
      account: accountReference(current.account),
    });
    const latest = current.rules[current.rules.length - 1];
    if (!latest || command.effectiveFrom <= latest.effectiveFrom) {
      throw new CreditCardDomainError("BILLING_RULE_OVERLAP", "effectiveFrom");
    }
    const adjustedRules = current.rules.map((rule) =>
      rule.id === latest.id ? { ...billingRuleReadModel(rule), effectiveUntil: command.effectiveFrom } : billingRuleReadModel(rule),
    );
    assertBillingRuleVersion({
      cardId: command.cardId,
      householdId: context.householdId,
      closingDay: command.closingDay,
      dueDay: command.dueDay,
      effectiveFrom: command.effectiveFrom,
      existingRules: adjustedRules,
    });
    await transaction
      .update(creditCardBillingRules)
      .set({ effectiveUntil: command.effectiveFrom })
      .where(and(eq(creditCardBillingRules.id, latest.id), eq(creditCardBillingRules.householdId, context.householdId)));
    await transaction.insert(creditCardBillingRules).values({
      id: generateUuidV7(),
      householdId: context.householdId,
      cardId: command.cardId,
      closingDay: command.closingDay,
      dueDay: command.dueDay,
      effectiveFrom: command.effectiveFrom,
      effectiveUntil: null,
    });
    const aggregate = await findAggregate(transaction, context, command.cardId);
    if (!aggregate) {
      throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
    }
    const model = toReadModel(aggregate);
    await completeCommand(transaction, context, command.commandId, operation, hash, model);
    return model;
  });
}

async function executeList(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<ListCreditCardsReadModel> {
  const query = parseListCreditCardsQuery(input ?? {});
  const predicates: SQL<unknown>[] = [
    eq(creditCards.householdId, context.householdId),
    eq(accounts.householdId, context.householdId),
    eq(accounts.id, creditCards.accountId),
  ];
  if (query.status !== "ALL") {
    predicates.push(eq(accounts.status, query.status ?? "ACTIVE"));
  }
  const rows = await database
    .select({ card: creditCards, account: accounts })
    .from(creditCards)
    .innerJoin(accounts, and(eq(accounts.id, creditCards.accountId), eq(accounts.householdId, context.householdId)))
    .where(and(...predicates))
    .orderBy(sql`lower(${accounts.name})`, asc(creditCards.id));
  const items: CreditCardReadModel[] = [];
  for (const row of rows) {
    const rules = await database
      .select()
      .from(creditCardBillingRules)
      .where(and(eq(creditCardBillingRules.cardId, row.card.id), eq(creditCardBillingRules.householdId, context.householdId)))
      .orderBy(asc(creditCardBillingRules.effectiveFrom), asc(creditCardBillingRules.id));
    items.push(toReadModel({ card: row.card, account: row.account, rules }));
  }
  return { items };
}

async function executeGet(
  database: Database,
  context: FinancialContext,
  input: unknown,
): Promise<CreditCardReadModel> {
  const query = parseGetCreditCardQuery(input);
  const aggregate = await findAggregate(database, context, query.cardId);
  if (!aggregate) {
    throw new CreditCardDomainError("CARD_NOT_FOUND", "cardId");
  }
  return toReadModel(aggregate);
}

function operationContext(
  operation: S06CreditCardOperation,
  context: FinancialContext,
  input: unknown,
): S06CreditCardOperationContext {
  const cardId =
    typeof input === "object" && input !== null && typeof (input as { cardId?: unknown }).cardId === "string"
      ? (input as { cardId: string }).cardId
      : undefined;
  return createS06CreditCardOperation(operation, {
    householdId: context.householdId,
    userId: context.userId,
    ...(cardId ? { cardId } : {}),
  });
}

function isDatabase(value: unknown): value is Database {
  return typeof value === "object" && value !== null && "select" in value && "transaction" in value;
}

function optionsFor(value?: Database | CreditCardUseCaseOptions): CreditCardUseCaseOptions {
  return isDatabase(value) ? { database: value } : value ?? {};
}

export function createCreditCardUseCases(database?: Database): CreditCardUseCasePort;
export function createCreditCardUseCases(options?: CreditCardUseCaseOptions): CreditCardUseCasePort;
export function createCreditCardUseCases(
  databaseOrOptions?: Database | CreditCardUseCaseOptions,
): CreditCardUseCasePort;
export function createCreditCardUseCases(databaseOrOptions?: Database | CreditCardUseCaseOptions): CreditCardUseCasePort {
  const selectedOptions = optionsFor(databaseOrOptions);
  const database = selectedOptions.database;
  const run = (context: FinancialContext, operation: S06CreditCardOperation, input: unknown, work: () => Promise<unknown>) =>
    withS06CreditCardObservability(operationContext(operation, context, input), work);

  return {
    create: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() => run(normalized, CREATE_CREDIT_CARD_OPERATION, command, () => executeCreate(resolveDatabase(database), normalized, command)) as Promise<CreditCardReadModel>);
    },
    list: async (context, query) => {
      const normalized = normalizeContext(context);
      return toResult(() => run(normalized, "credit_card.statement.read", query, () => executeList(resolveDatabase(database), normalized, query)) as Promise<ListCreditCardsReadModel>);
    },
    get: async (context, query) => {
      const normalized = normalizeContext(context);
      return toResult(() => run(normalized, "credit_card.statement.read", query, () => executeGet(resolveDatabase(database), normalized, query)) as Promise<CreditCardReadModel>);
    },
    update: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() => run(normalized, UPDATE_CREDIT_CARD_OPERATION, command, () => executeUpdate(resolveDatabase(database), normalized, command)) as Promise<CreditCardReadModel>);
    },
    archive: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() => run(normalized, ARCHIVE_CREDIT_CARD_OPERATION, command, () => executeArchive(resolveDatabase(database), normalized, command)) as Promise<CreditCardReadModel>);
    },
    createBillingRule: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() => run(normalized, CREATE_CREDIT_CARD_BILLING_RULE_OPERATION, command, () => executeBillingRule(resolveDatabase(database), normalized, command, CREATE_CREDIT_CARD_BILLING_RULE_OPERATION)) as Promise<CreditCardReadModel>);
    },
    updateBillingRule: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() => run(normalized, UPDATE_CREDIT_CARD_BILLING_RULE_OPERATION, command, () => executeBillingRule(resolveDatabase(database), normalized, command, UPDATE_CREDIT_CARD_BILLING_RULE_OPERATION)) as Promise<CreditCardReadModel>);
    },
    createPayment: async (context, command) => {
      const normalized = normalizeContext(context);
      return toResult(() =>
        run(
          normalized,
          CREATE_CREDIT_CARD_PAYMENT_OPERATION,
          command,
          () => executePayment(resolveDatabase(database), normalized, command, selectedOptions.today),
        ) as Promise<CreditCardPaymentReadModel>,
      );
    },
  };
}

export const createCreditCardUseCase = createCreditCardUseCases;
export const createCreditCardUseCasePort = createCreditCardUseCases;
export const creditCardUseCases = createCreditCardUseCases();
export const creditCardUseCase = creditCardUseCases;
export const creditCardUseCasePort = creditCardUseCases;

export async function createCreditCard(context: FinancialContext, command: unknown, database?: Database): Promise<CreditCardResult<CreditCardReadModel>> {
  return creditCardUseCasesWith(database).create(context, command);
}
export async function listCreditCards(context: FinancialContext, query?: unknown, database?: Database): Promise<CreditCardResult<ListCreditCardsReadModel>> {
  return creditCardUseCasesWith(database).list(context, query);
}
export async function getCreditCard(context: FinancialContext, query: GetCreditCardQuery | unknown, database?: Database): Promise<CreditCardResult<CreditCardReadModel>> {
  return creditCardUseCasesWith(database).get(context, query);
}
export async function updateCreditCard(context: FinancialContext, command: unknown, database?: Database): Promise<CreditCardResult<CreditCardReadModel>> {
  return creditCardUseCasesWith(database).update(context, command);
}
export async function archiveCreditCard(context: FinancialContext, command: unknown, database?: Database): Promise<CreditCardResult<CreditCardReadModel>> {
  return creditCardUseCasesWith(database).archive(context, command);
}
export async function updateCreditCardBillingRule(context: FinancialContext, command: unknown, database?: Database): Promise<CreditCardResult<CreditCardReadModel>> {
  return creditCardUseCasesWith(database).updateBillingRule(context, command);
}
export async function createCreditCardBillingRule(context: FinancialContext, command: unknown, database?: Database): Promise<CreditCardResult<CreditCardReadModel>> {
  return creditCardUseCasesWith(database).createBillingRule(context, command);
}
export async function registerCreditCardPayment(
  context: FinancialContext,
  command: unknown,
  databaseOrOptions?: Database | CreditCardUseCaseOptions,
): Promise<CreditCardResult<CreditCardPaymentReadModel>> {
  return createCreditCardUseCases(databaseOrOptions).createPayment(context, command);
}

export const createCreditCardPayment = registerCreditCardPayment;
export const createPayment = registerCreditCardPayment;
export const registerPayment = registerCreditCardPayment;
export const RegisterCreditCardPayment = registerCreditCardPayment;

function creditCardUseCasesWith(
  databaseOrOptions?: Database | CreditCardUseCaseOptions,
): CreditCardUseCasePort {
  return databaseOrOptions ? createCreditCardUseCases(databaseOrOptions) : creditCardUseCases;
}

export const createCard = createCreditCard;
export const listCards = listCreditCards;
export const getCard = getCreditCard;
export const updateCard = updateCreditCard;
export const archiveCard = archiveCreditCard;
