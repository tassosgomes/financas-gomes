/**
 * Browser-safe presentation helpers for transaction list read models.
 *
 * Keep this module free of database, Node.js, and server-action imports. It is
 * consumed by the client review island, while the legacy listing utilities
 * also re-export these helpers for S03 callers.
 */

function absoluteCents(value: string): {
  amount: bigint;
  sign: "positive" | "negative" | "zero";
} {
  const cents = BigInt(value);
  if (cents > BigInt(0)) {
    return { amount: cents, sign: "positive" };
  }
  if (cents < BigInt(0)) {
    return { amount: -cents, sign: "negative" };
  }
  return { amount: BigInt(0), sign: "zero" };
}

/** Formats signed entry cents without converting through a floating number. */
export function formatSignedCents(value: string): string {
  try {
    const parsed = absoluteCents(value);
    const whole = parsed.amount / BigInt(100);
    const fraction = (parsed.amount % BigInt(100)).toString(10).padStart(2, "0");
    const formattedWhole = new Intl.NumberFormat("pt-BR").format(whole);
    const sign =
      parsed.sign === "positive"
        ? "+"
        : parsed.sign === "negative"
          ? "-"
          : "";
    return `${sign}R$ ${formattedWhole},${fraction}`;
  } catch {
    // A malformed persistence value must remain visible to diagnostics while
    // avoiding a server-rendering crash. Valid read models never use this path.
    return value;
  }
}

export function formatTransactionDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
