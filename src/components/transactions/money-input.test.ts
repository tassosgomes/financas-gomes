import { describe, expect, it } from "vitest";

import {
  formatMoneyInputCents,
  parseMoneyInputCents,
} from "./money-input";

describe("MoneyInput boundary helpers", () => {
  it("formats integer cents in Brazilian notation without floating point", () => {
    expect(formatMoneyInputCents("600000")).toBe("6.000,00");
    expect(formatMoneyInputCents("123456")).toBe("1.234,56");
    expect(formatMoneyInputCents("900719925474099301")).toBe(
      "9.007.199.254.740.993,01",
    );
  });

  it("keeps the exact cents when a localized value is pasted", () => {
    expect(parseMoneyInputCents("1.234,56")).toBe("123456");
    expect(parseMoneyInputCents("1.234")).toBe("123400");
    expect(parseMoneyInputCents("R$ 6.000,00")).toBe("600000");
    expect(parseMoneyInputCents("0,01")).toBe("1");
  });

  it("uses digit-mask semantics for typing and rejects invalid signs", () => {
    expect(parseMoneyInputCents("123456")).toBe("123456");
    expect(formatMoneyInputCents(parseMoneyInputCents("123456"))).toBe(
      "1.234,56",
    );
    expect(parseMoneyInputCents("-100")).toBe("");
    expect(parseMoneyInputCents("1,234")).toBe("");
    expect(parseMoneyInputCents("")).toBe("");
  });
});
