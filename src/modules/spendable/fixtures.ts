import { Temporal } from "@js-temporal/polyfill";

import {
  ForecastEngine,
  type ForecastEngineItem,
} from "@/modules/forecast/engine";
import type { ForecastTimeline } from "@/modules/forecast/contracts";

import type {
  SpendableBufferSource,
  SpendableScenario,
} from "./contracts";

export interface SpendableFixtureExpectation {
  readonly openingProjectedBalanceCents: string;
  readonly closingProjectedBalanceCents: string;
  readonly minimumProjectedBalanceCents: string;
  readonly minimumProjectedOn: string | null;
  readonly minimumBalanceReferences: readonly string[];
  readonly rawSpendableCents: string;
  readonly displaySpendableCents: string;
  readonly deficitToPreserveReserveCents: string;
}

export interface SpendableFixtureResourceBalances {
  readonly generalCents: string;
  readonly restrictedCents: string;
  readonly excludedCents: string;
}

export interface SpendableFixture {
  readonly id: string;
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly horizonDays: number;
  readonly scenario: SpendableScenario;
  readonly openingBalanceCents: string;
  readonly operationalBufferCents: string;
  readonly operationalBufferSource: SpendableBufferSource;
  readonly items: readonly ForecastEngineItem[];
  readonly timeline: ForecastTimeline;
  readonly expected: SpendableFixtureExpectation;
  /** References intentionally absent from the normalized timeline. */
  readonly excludedReferenceIds?: readonly string[];
  readonly resources?: SpendableFixtureResourceBalances;
  readonly reserveStatus?: "UNAVAILABLE" | "AVAILABLE";
  readonly effectiveBufferFrom?: string | null;
}

export interface SpendableFixtureScenarioSet {
  readonly id: string;
  readonly items: readonly ForecastEngineItem[];
  readonly variants: Readonly<Record<SpendableScenario, SpendableFixture>>;
}

const ZERO = BigInt(0);

function source(
  referenceId: string,
  kind: ForecastEngineItem["source"]["kind"] = "PLANNED_EVENT",
  values: Partial<ForecastEngineItem["source"]> = {},
): ForecastEngineItem["source"] {
  return {
    kind,
    referenceId,
    label: `fixture-${referenceId}`,
    ...values,
  };
}

function item(
  referenceId: string,
  values: Partial<ForecastEngineItem> = {},
): ForecastEngineItem {
  const sourceValue = values.source;
  return {
    date: "2026-09-02",
    amountCents: "100",
    direction: "OUTFLOW",
    status: "PLANNED",
    certainty: "COMMITTED",
    referenceId,
    reconciliation: null,
    ...values,
    source: source(
      referenceId,
      sourceValue?.kind ?? "PLANNED_EVENT",
      sourceValue ?? {},
    ),
  };
}

function period(asOf: string, horizonDays: number): {
  readonly from: string;
  readonly to: string;
} {
  const date = Temporal.PlainDate.from(asOf, { overflow: "reject" });
  return {
    from: date.add({ days: 1 }).toString(),
    to: date.add({ days: horizonDays }).toString(),
  };
}

function expectedFor(
  timeline: ForecastTimeline,
  operationalBufferCents: string,
): SpendableFixtureExpectation {
  const minimum = BigInt(timeline.minimumProjectedBalanceCents);
  const buffer = BigInt(operationalBufferCents);
  const raw = minimum - buffer;
  const display = raw > ZERO ? raw : ZERO;
  const deficit = raw < ZERO ? -raw : ZERO;
  return {
    openingProjectedBalanceCents: timeline.openingProjectedBalanceCents,
    closingProjectedBalanceCents: timeline.closingProjectedBalanceCents,
    minimumProjectedBalanceCents: timeline.minimumProjectedBalanceCents,
    minimumProjectedOn: timeline.minimumProjectedOn,
    minimumBalanceReferences: timeline.minimumBalanceReferences,
    rawSpendableCents: raw.toString(10),
    displaySpendableCents: display.toString(10),
    deficitToPreserveReserveCents: deficit.toString(10),
  };
}

function createFixture(input: {
  readonly id: string;
  readonly asOf: string;
  readonly horizonDays: number;
  readonly openingBalanceCents: string;
  readonly operationalBufferCents: string;
  readonly operationalBufferSource?: SpendableBufferSource;
  readonly scenario?: SpendableScenario;
  readonly items?: readonly ForecastEngineItem[];
  readonly excludedReferenceIds?: readonly string[];
  readonly resources?: SpendableFixtureResourceBalances;
  readonly reserveStatus?: "UNAVAILABLE" | "AVAILABLE";
  readonly effectiveBufferFrom?: string | null;
}): SpendableFixture {
  const range = period(input.asOf, input.horizonDays);
  const scenario = input.scenario ?? "CONSERVATIVE";
  const items = input.items ?? [];
  const timeline = ForecastEngine(
    items,
    input.openingBalanceCents,
    range,
    scenario,
  );
  return Object.freeze({
    id: input.id,
    asOf: input.asOf,
    from: range.from,
    to: range.to,
    horizonDays: input.horizonDays,
    scenario,
    openingBalanceCents: input.openingBalanceCents,
    operationalBufferCents: input.operationalBufferCents,
    operationalBufferSource: input.operationalBufferSource ?? "CONFIGURED",
    items,
    timeline,
    expected: expectedFor(timeline, input.operationalBufferCents),
    excludedReferenceIds: input.excludedReferenceIds,
    resources: input.resources,
    reserveStatus: input.reserveStatus,
    effectiveBufferFrom: input.effectiveBufferFrom,
  });
}

const reliableAndUncertainItems: readonly ForecastEngineItem[] = [
  item("fx-expense-known", {
    date: "2026-09-02",
    amountCents: "500000",
    direction: "OUTFLOW",
  }),
  item("fx-income-reliable", {
    date: "2026-09-03",
    amountCents: "100000",
    direction: "INFLOW",
    certainty: "COMMITTED",
    status: "PLANNED",
  }),
  item("fx-income-uncertain", {
    date: "2026-09-04",
    amountCents: "300000",
    direction: "INFLOW",
    certainty: "EXPECTED",
    status: "EXPECTED",
    source: source("fx-income-uncertain", "PLANNED_EVENT", {
      includeInConservativeForecast: false,
    }),
  }),
];

export const SPENDABLE_FIXTURE_IDS = [
  "positive",
  "zero",
  "negative",
  "same-day",
  "no-events",
  "reliable-income",
  "uncertain-income",
  "future-commitment",
  "installments-once",
  "realized-once",
  "card-payment-not-source",
  "year-boundary",
  "resource-scope",
  "buffer-absent",
  "buffer-effective-before",
  "buffer-effective-on",
  "reserve-zero",
] as const;

export const positiveSpendableFixture = createFixture({
  id: "positive",
  asOf: "2026-09-01",
  horizonDays: 14,
  openingBalanceCents: "1200000",
  operationalBufferCents: "500000",
  items: [
    item("fx-minimum-expense", {
      date: "2026-09-15",
      amountCents: "465500",
      direction: "OUTFLOW",
    }),
  ],
});

export const zeroSpendableFixture = createFixture({
  id: "zero",
  asOf: "2026-09-01",
  horizonDays: 1,
  openingBalanceCents: "500000",
  operationalBufferCents: "500000",
});

export const negativeSpendableFixture = createFixture({
  id: "negative",
  asOf: "2026-09-01",
  horizonDays: 1,
  openingBalanceCents: "600000",
  operationalBufferCents: "500000",
  items: [
    item("fx-deficit-expense", {
      amountCents: "300000",
      direction: "OUTFLOW",
    }),
  ],
});

export const sameDaySpendableFixture = createFixture({
  id: "same-day",
  asOf: "2026-09-01",
  horizonDays: 1,
  openingBalanceCents: "100000",
  operationalBufferCents: "0",
  items: [
    item("fx-same-day-outflow-a", { amountCents: "30000" }),
    item("fx-same-day-inflow", {
      amountCents: "150000",
      direction: "INFLOW",
    }),
    item("fx-same-day-outflow-b", { amountCents: "20000" }),
  ],
});

export const noEventsSpendableFixture = createFixture({
  id: "no-events",
  asOf: "2026-09-01",
  horizonDays: 90,
  openingBalanceCents: "800000",
  operationalBufferCents: "100000",
});

export const reliableIncomeSpendableFixture = createFixture({
  id: "reliable-income",
  asOf: "2026-09-01",
  horizonDays: 5,
  openingBalanceCents: "500000",
  operationalBufferCents: "0",
  items: reliableAndUncertainItems,
});

export const uncertainIncomeSpendableFixture = createFixture({
  id: "uncertain-income",
  asOf: "2026-09-01",
  horizonDays: 5,
  openingBalanceCents: "500000",
  operationalBufferCents: "0",
  scenario: "EXPECTED",
  items: reliableAndUncertainItems,
});

export const reliableIncomeScenarioFixture: SpendableFixtureScenarioSet = Object.freeze({
  id: "reliable-income-scenarios",
  items: reliableAndUncertainItems,
  variants: {
    CONSERVATIVE: reliableIncomeSpendableFixture,
    EXPECTED: uncertainIncomeSpendableFixture,
  },
});

export const futureCommitmentSpendableFixture = createFixture({
  id: "future-commitment",
  asOf: "2026-09-01",
  horizonDays: 30,
  openingBalanceCents: "500000",
  operationalBufferCents: "0",
  items: [
    item("fx-future-commitment", {
      date: "2026-09-20",
      amountCents: "250000",
    }),
  ],
});

const installmentItems: readonly ForecastEngineItem[] = [
  item("fx-installment-1", {
    date: "2026-09-10",
    amountCents: "100000",
    source: source("fx-installment-1", "INSTALLMENT", {
      billingCycle: "2026-09",
      installmentSequence: 1,
    }),
  }),
  item("fx-installment-2", {
    date: "2026-10-10",
    amountCents: "100000",
    source: source("fx-installment-2", "INSTALLMENT", {
      billingCycle: "2026-10",
      installmentSequence: 2,
    }),
  }),
  item("fx-installment-3", {
    date: "2026-11-10",
    amountCents: "100000",
    source: source("fx-installment-3", "INSTALLMENT", {
      billingCycle: "2026-11",
      installmentSequence: 3,
    }),
  }),
];

export const installmentsOnceSpendableFixture = createFixture({
  id: "installments-once",
  asOf: "2026-09-01",
  horizonDays: 90,
  openingBalanceCents: "1000000",
  operationalBufferCents: "0",
  items: installmentItems,
  excludedReferenceIds: ["fx-purchase-total", "fx-card-payment"],
});

export const realizedOnceSpendableFixture = createFixture({
  id: "realized-once",
  asOf: "2026-09-01",
  horizonDays: 5,
  openingBalanceCents: "500000",
  operationalBufferCents: "0",
  items: [
    item("fx-realized-expense", {
      date: "2026-09-02",
      amountCents: "200000",
      status: "POSTED",
      certainty: "REALIZED",
      source: source("fx-realized-expense", "REALIZED_EVENT"),
      reconciliation: {
        key: "fx-planned-expense",
        replacesReferenceId: "fx-planned-expense",
        plannedAmountCents: "200000",
        realizedAmountCents: "200000",
        remainingAmountCents: "0",
        varianceAmountCents: "0",
      },
    }),
  ],
  excludedReferenceIds: ["fx-planned-expense"],
});

export const cardPaymentNotSourceSpendableFixture = createFixture({
  id: "card-payment-not-source",
  asOf: "2026-09-01",
  horizonDays: 90,
  openingBalanceCents: "1000000",
  operationalBufferCents: "0",
  items: installmentItems,
  excludedReferenceIds: ["fx-purchase-total", "fx-card-payment", "fx-invoice-total"],
});

export const yearBoundarySpendableFixture = createFixture({
  id: "year-boundary",
  asOf: "2026-12-30",
  horizonDays: 3,
  openingBalanceCents: "500000",
  operationalBufferCents: "0",
  items: [
    item("fx-year-end-outflow", {
      date: "2026-12-31",
      amountCents: "100000",
    }),
    item("fx-new-year-inflow", {
      date: "2027-01-01",
      amountCents: "250000",
      direction: "INFLOW",
      certainty: "COMMITTED",
    }),
  ],
});

export const resourceScopeSpendableFixture = createFixture({
  id: "resource-scope",
  asOf: "2026-09-01",
  horizonDays: 1,
  openingBalanceCents: "100000",
  operationalBufferCents: "0",
  resources: {
    generalCents: "100000",
    restrictedCents: "900000",
    excludedCents: "500000",
  },
  excludedReferenceIds: ["fx-restricted-balance", "fx-excluded-balance"],
});

export const bufferAbsentSpendableFixture = createFixture({
  id: "buffer-absent",
  asOf: "2026-09-01",
  horizonDays: 90,
  openingBalanceCents: "800000",
  operationalBufferCents: "0",
  operationalBufferSource: "ABSENT_DEFAULT_ZERO",
});

export const bufferEffectiveBeforeSpendableFixture = createFixture({
  id: "buffer-effective-before",
  asOf: "2026-09-09",
  horizonDays: 1,
  openingBalanceCents: "200000",
  operationalBufferCents: "0",
  effectiveBufferFrom: null,
});

export const bufferEffectiveOnSpendableFixture = createFixture({
  id: "buffer-effective-on",
  asOf: "2026-09-10",
  horizonDays: 1,
  openingBalanceCents: "200000",
  operationalBufferCents: "50000",
  effectiveBufferFrom: "2026-09-10",
});

export const reserveZeroSpendableFixture = createFixture({
  id: "reserve-zero",
  asOf: "2026-09-01",
  horizonDays: 1,
  openingBalanceCents: "200000",
  operationalBufferCents: "0",
  reserveStatus: "UNAVAILABLE",
});

export const SPENDABLE_FIXTURES: readonly SpendableFixture[] = Object.freeze([
  positiveSpendableFixture,
  zeroSpendableFixture,
  negativeSpendableFixture,
  sameDaySpendableFixture,
  noEventsSpendableFixture,
  reliableIncomeSpendableFixture,
  uncertainIncomeSpendableFixture,
  futureCommitmentSpendableFixture,
  installmentsOnceSpendableFixture,
  realizedOnceSpendableFixture,
  cardPaymentNotSourceSpendableFixture,
  yearBoundarySpendableFixture,
  resourceScopeSpendableFixture,
  bufferAbsentSpendableFixture,
  bufferEffectiveBeforeSpendableFixture,
  bufferEffectiveOnSpendableFixture,
  reserveZeroSpendableFixture,
]);

export const spendableFixtures = SPENDABLE_FIXTURES;

const byId = new Map(SPENDABLE_FIXTURES.map((fixture) => [fixture.id, fixture]));

export function getSpendableFixture(id: string): SpendableFixture {
  const fixture = byId.get(id);
  if (!fixture) throw new Error(`Unknown spendable fixture: ${id}`);
  return fixture;
}

export const fixtureById = getSpendableFixture;

export function getSpendableFixtureTimeline(id: string): ForecastTimeline {
  return getSpendableFixture(id).timeline;
}

export const spendableFixtureTimeline = getSpendableFixtureTimeline;

export function expectedSpendableResult(
  fixture: SpendableFixture,
): SpendableFixtureExpectation {
  return fixture.expected;
}
