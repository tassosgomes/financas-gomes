import { describe, expect, it } from "vitest";

import {
  Money,
  assertAccountReference,
  assertCategoryReference,
  assertDateNotFuture,
  assertDateOnOrAfter,
  compareFinancialDates,
  formatFinancialDate,
  formatMoneyBRL,
  generateTransactionCommandId,
  isUuidV7,
  isFinancialDateInFuture,
  parseFinancialDate,
  parseMoneyBRL,
} from "./domain";
import { S03DomainError } from "./contracts";

const householdId = "018f47b7-6c3a-7abc-8def-1234567890aa";
const otherHouseholdId = "018f47b7-6c3a-7abc-8def-1234567890ab";
const accountId = "018f47b7-6c3a-7abc-8def-1234567890ac";
const categoryId = "018f47b7-6c3a-7abc-8def-1234567890ad";

function expectCode(run: () => unknown, code: string): void {
  expect(run).toThrowError(S03DomainError);
  try {
    run();
  } catch (error) {
    expect((error as S03DomainError).code).toBe(code);
  }
}

describe("S03 Money", () => {
  it("keeps Brazilian cents exact through the serialized boundary", () => {
    const money = Money.fromCents("123456");

    expect(money.cents).toBe(BigInt("123456"));
    expect(money.toCentsString()).toBe("123456");
    expect(formatMoneyBRL(money)).toBe("R$ 1.234,56");
    expect(parseMoneyBRL("R$ 1.234,56")).toBe("123456");
  });

  it.each(["", " ", "0", "-1", "+1", "1.00", "1,00", "1e3"]) (
    "rejects malformed or non-positive amount %s",
    (value) => {
      expectCode(() => Money.fromCents(value), "INVALID_AMOUNT");
    },
  );

  it("does not round fractional manual input", () => {
    expectCode(() => parseMoneyBRL("1,001"), "INVALID_AMOUNT");
    expect(Money.fromCents("999999999999999999").add(Money.fromCents("1")).toCentsString()).toBe(
      "1000000000000000000",
    );
  });

  it("supports signed ledger arithmetic without allowing zero input amounts", () => {
    const expense = Money.fromSignedCents("-100");
    expect(expense.negate().toCentsString()).toBe("100");
    expect(expense.add(Money.fromSignedCents("100")).isZero()).toBe(true);
    expectCode(() => Money.fromSignedCents("0"), "INVALID_AMOUNT");
  });
});

describe("S03 financial dates", () => {
  it("round-trips strict YYYY-MM-DD as Temporal.PlainDate", () => {
    const date = parseFinancialDate("2026-08-29");
    expect(formatFinancialDate(date)).toBe("2026-08-29");
    expect(compareFinancialDates(date, parseFinancialDate("2026-08-29"))).toBe(0);
  });

  it.each(["2026-02-29", "2026-13-01", "2026-8-01", "2026-08-1", "not-a-date"]) (
    "rejects invalid date %s",
    (value) => expectCode(() => parseFinancialDate(value), "INVALID_DATE"),
  );

  it("rejects a future date and dates before tracking starts", () => {
    expect(isFinancialDateInFuture("2026-08-30", "2026-08-29")).toBe(true);
    expectCode(
      () => assertDateNotFuture("2026-08-30", "2026-08-29"),
      "DATE_IN_FUTURE",
    );
    expectCode(
      () => assertDateOnOrAfter("2026-08-28", "2026-08-29"),
      "TRACKING_START_DATE_VIOLATION",
    );
  });
});

describe("S03 tenant and reference invariants", () => {
  const account = {
    id: accountId,
    householdId,
    status: "ACTIVE" as const,
    trackingStartedOn: "2026-08-01",
  };
  const category = {
    id: categoryId,
    householdId,
    status: "ACTIVE" as const,
    kind: "EXPENSE" as const,
  };

  it("accepts active same-household references and optional category", () => {
    expect(
      assertAccountReference({
        householdId,
        accountId,
        account,
        occurredOn: "2026-08-29",
      }),
    ).toBe(account);
    expect(
      assertCategoryReference({
        householdId,
        categoryId,
        category,
        kind: "EXPENSE",
      }),
    ).toBe(category);
    expect(
      assertCategoryReference({ householdId, categoryId: null, kind: "EXPENSE" }),
    ).toBeNull();
  });

  it("does not reveal cross-household rows and rejects archived/incompatible references", () => {
    expectCode(
      () =>
        assertAccountReference({
          householdId: otherHouseholdId,
          accountId,
          account,
          occurredOn: "2026-08-29",
        }),
      "ACCOUNT_NOT_FOUND",
    );
    expectCode(
      () =>
        assertCategoryReference({
          householdId,
          categoryId,
          category: { ...category, status: "ARCHIVED" },
          kind: "EXPENSE",
        }),
      "RESOURCE_ARCHIVED",
    );
    expectCode(
      () =>
        assertCategoryReference({
          householdId,
          categoryId,
          category,
          kind: "INCOME",
        }),
      "CATEGORY_KIND_MISMATCH",
    );
  });
});

describe("S03 identifier boundary", () => {
  it("delegates command IDs to the central UUIDv7 generator", () => {
    expect(isUuidV7(generateTransactionCommandId())).toBe(true);
  });
});
