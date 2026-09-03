import { describe, expect, it } from "vitest";

import {
  FINANCIAL_EVENT_KINDS,
  FINANCIAL_EVENT_ORIGINS,
  FINANCIAL_EVENT_STATUSES,
  TransactionDomainError,
} from "./contracts";
import {
  assertManualEventCanCancel,
  assertManualEventCanUpdate,
} from "./domain";
import {
  parseCancelManualTransactionCommand,
  parseCreateIncomeCommand,
  parseUpdateManualTransactionCommand,
} from "./validation";
import {
  TRANSACTION_CONTEXTS,
  TRANSACTION_FIXTURES,
  TRANSACTION_HOUSEHOLD_IDS,
  TRANSACTION_USER_IDS,
} from "@/test/transaction-fixtures";

const eventId = "00000000-0000-7000-8000-000000135101";

const postedManualEvent = {
  id: eventId,
  householdId: TRANSACTION_FIXTURES.households.a,
  origin: "MANUAL" as const,
  status: "POSTED" as const,
  kind: "EXPENSE",
};

function expectDomainCode(run: () => unknown, code: string): void {
  expect(run).toThrowError(TransactionDomainError);
  try {
    run();
  } catch (error) {
    expect((error as TransactionDomainError).code).toBe(code);
  }
}

describe("T13 S03 deterministic foundation fixtures", () => {
  it("provides two isolated tenants and every reference state needed by T02-T04", () => {
    expect(TRANSACTION_HOUSEHOLD_IDS).toHaveLength(2);
    expect(new Set(TRANSACTION_HOUSEHOLD_IDS).size).toBe(2);
    expect(TRANSACTION_USER_IDS).toHaveLength(2);
    expect(new Set(TRANSACTION_USER_IDS).size).toBe(2);

    expect(TRANSACTION_CONTEXTS.a.householdId).not.toBe(TRANSACTION_CONTEXTS.b.householdId);
    expect(TRANSACTION_FIXTURES.accounts.activeA.status).toBe("ACTIVE");
    expect(TRANSACTION_FIXTURES.accounts.archivedA.status).toBe("ARCHIVED");
    expect(TRANSACTION_FIXTURES.categories.expenseA.kind).toBe("EXPENSE");
    expect(TRANSACTION_FIXTURES.categories.incomeA.kind).toBe("INCOME");
    expect(TRANSACTION_FIXTURES.categories.archivedA.status).toBe("ARCHIVED");
    expect(TRANSACTION_FIXTURES.categories.expenseB.householdId).toBe(
      TRANSACTION_CONTEXTS.b.householdId,
    );
  });

  it("keeps event kind, status and origin vocabularies explicit", () => {
    expect(FINANCIAL_EVENT_KINDS).toEqual(["EXPENSE", "INCOME", "REVERSAL"]);
    expect(FINANCIAL_EVENT_STATUSES).toEqual(["POSTED", "CANCELLED"]);
    expect(FINANCIAL_EVENT_ORIGINS).toEqual(["MANUAL", "SYSTEM", "IMPORT"]);
  });
});

describe("T13 manual event policy foundation", () => {
  it("allows only a same-tenant posted manual event to be updated", () => {
    expect(
      assertManualEventCanUpdate({
        householdId: TRANSACTION_CONTEXTS.a.householdId,
        financialEventId: eventId,
        event: postedManualEvent,
      }),
    ).toBe(postedManualEvent);

    expectDomainCode(
      () =>
        assertManualEventCanUpdate({
          householdId: TRANSACTION_CONTEXTS.b.householdId,
          financialEventId: eventId,
          event: postedManualEvent,
        }),
      "EVENT_NOT_FOUND",
    );
    expectDomainCode(
      () =>
        assertManualEventCanUpdate({
          householdId: TRANSACTION_CONTEXTS.a.householdId,
          financialEventId: eventId,
          event: { ...postedManualEvent, origin: "SYSTEM" },
        }),
      "EVENT_NOT_MANUAL",
    );
    expectDomainCode(
      () =>
        assertManualEventCanUpdate({
          householdId: TRANSACTION_CONTEXTS.a.householdId,
          financialEventId: eventId,
          event: { ...postedManualEvent, status: "CANCELLED" },
        }),
      "EVENT_ALREADY_CANCELLED",
    );
  });

  it("allows one cancellation candidate and rejects duplicate reversal state", () => {
    expect(
      assertManualEventCanCancel({
        householdId: TRANSACTION_CONTEXTS.a.householdId,
        financialEventId: eventId,
        event: postedManualEvent,
      }),
    ).toBe(postedManualEvent);

    expectDomainCode(
      () =>
        assertManualEventCanCancel({
          householdId: TRANSACTION_CONTEXTS.a.householdId,
          financialEventId: eventId,
          event: postedManualEvent,
          hasReversal: true,
        }),
      "REVERSAL_ALREADY_EXISTS",
    );
    expectDomainCode(
      () =>
        assertManualEventCanCancel({
          householdId: TRANSACTION_CONTEXTS.a.householdId,
          financialEventId: eventId,
          event: { ...postedManualEvent, status: "CANCELLED" },
        }),
      "EVENT_ALREADY_CANCELLED",
    );
    expectDomainCode(
      () =>
        assertManualEventCanCancel({
          householdId: TRANSACTION_CONTEXTS.a.householdId,
          financialEventId: eventId,
          event: { ...postedManualEvent, origin: "SYSTEM" },
        }),
      "EVENT_NOT_MANUAL",
    );
  });
});

describe("T13 command boundary foundation", () => {
  it("keeps create/update/cancel commands JSON-safe and server-owned", () => {
    const create = parseCreateIncomeCommand(
      {
        commandId: "t13-create-income",
        amountCents: "0001234",
        occurredOn: "2026-08-29",
        description: "  Recebimento  T13 ",
        accountId: TRANSACTION_FIXTURES.accounts.activeA.id,
        categoryId: TRANSACTION_FIXTURES.categories.incomeA.id,
      },
      { today: "2026-08-29" },
    );
    const update = parseUpdateManualTransactionCommand({
      commandId: "t13-update",
      financialEventId: eventId,
      description: "Descrição atualizada",
      categoryId: null,
    });
    const cancel = parseCancelManualTransactionCommand({
      commandId: "t13-cancel",
      financialEventId: eventId,
    });

    expect(create.amountCents).toBe("1234");
    expect(create.description).toBe("Recebimento T13");
    expect(JSON.stringify({ create, update, cancel })).not.toContain("bigint");
    expect(create).not.toHaveProperty("householdId");
    expect(create).not.toHaveProperty("status");
    expect(create).not.toHaveProperty("origin");
    expect(update).not.toHaveProperty("amountCents");
    expect(update).not.toHaveProperty("accountId");
    expect(cancel).not.toHaveProperty("amountCents");
  });
});
