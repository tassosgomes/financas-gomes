/** Client-safe formatting helpers for the detail island. */

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

/** Formats signed cent values without converting through a floating number. */
export function formatDetailCents(value: string): string {
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
    return value;
  }
}

/** Formats a civil date without allowing the browser timezone to shift it. */
export function formatDetailDate(value: string): string {
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

