import { describe, expect, it } from "vitest";

import { Money } from "@/modules/transactions/money";

import {
  RESERVE_RULE,
  ZeroReserveAdapter,
  deriveReserveSnapshot,
  createMovementReserveAdapter,
  serializeReserveSnapshot,
  type ReserveAdapterContext,
  type ReserveBoxInput,
} from "./reserve-adapter";

const context: ReserveAdapterContext = {
  asOf: "2026-09-30",
  scenario: "CONSERVATIVE",
  horizon: { days: 90 },
};

function box(overrides: Partial<ReserveBoxInput> = {}): ReserveBoxInput {
  return {
    rule: RESERVE_RULE,
    boxReferenceId: "box-main",
    status: "ACTIVE",
    activeFrom: "2026-09-01",
    closedOn: null,
    movements: [
      {
        referenceId: "movement-contribution",
        boxReferenceId: "box-main",
        kind: "CONTRIBUTION",
        amountCents: "100000",
        effectiveOn: "2026-09-01",
      },
    ],
    ...overrides,
  };
}

describe("S08 ↔ S09 reserve adapter", () => {
  it("returns an explicit unavailable zero snapshot before S09", () => {
    const snapshot = new ZeroReserveAdapter().getReserve(context);
    const serialized = serializeReserveSnapshot(snapshot);

    expect(snapshot.contractVersion).toBe("s09.v1");
    expect(snapshot.status).toBe("UNAVAILABLE");
    expect(snapshot.protectedAmount).toEqual(Money.zero());
    expect(snapshot.appliedOpeningAdjustment).toEqual(Money.zero());
    expect(serialized).toEqual({
      contractVersion: "s09.v1",
      status: "UNAVAILABLE",
      protectedCents: "0",
      appliedOpeningAdjustmentCents: "0",
      components: [],
    });
  });

  it("derives one protected component and a negative opening adjustment", () => {
    const snapshot = deriveReserveSnapshot({ ...context, boxes: [box()] });
    const component = snapshot.components[0];

    expect(snapshot.status).toBe("AVAILABLE");
    expect(snapshot.protectedAmount.toCentsString()).toBe("100000");
    expect(snapshot.appliedOpeningAdjustment.toCentsString()).toBe("-100000");
    expect(component?.kind).toBe("BOX_BALANCE");
    expect(component?.rule).toBe("BOX_BALANCE_PROTECTED");
    expect(component?.boxReferenceId).toBe("box-main");
    expect(component?.amount.toCentsString()).toBe("100000");
    expect(component?.appliedAmount.toCentsString()).toBe("-100000");
    expect(component?.movementReferenceIds).toEqual(["movement-contribution"]);

    expect(serializeReserveSnapshot(snapshot).components).toEqual([
      {
        kind: "BOX_BALANCE",
        rule: "BOX_BALANCE_PROTECTED",
        referenceId: "box-main",
        boxReferenceId: "box-main",
        amountCents: "100000",
        appliedAmountCents: "-100000",
        effectiveOn: "2026-09-30",
        movementReferenceIds: ["movement-contribution"],
        appliedMovementReferenceIds: ["movement-contribution"],
      },
    ]);
  });

  it("deduplicates a reflected contribution and applies a withdrawal release once", () => {
    const snapshot = deriveReserveSnapshot({
      ...context,
      reflectedReferenceIds: ["movement-contribution"],
      boxes: [
        box({
          movements: [
            {
              referenceId: "movement-contribution",
              boxReferenceId: "box-main",
              kind: "CONTRIBUTION",
              amountCents: "100000",
              effectiveOn: "2026-09-01",
            },
            {
              referenceId: "movement-withdrawal",
              boxReferenceId: "box-main",
              kind: "WITHDRAWAL",
              amountCents: "40000",
              effectiveOn: "2026-09-15",
            },
          ],
        }),
      ],
    });

    const component = snapshot.components[0];
    expect(snapshot.protectedAmount.toCentsString()).toBe("60000");
    // The contribution is already in the ledger; only the unreflected
    // withdrawal releases 40,000 once.
    expect(snapshot.appliedOpeningAdjustment.toCentsString()).toBe("40000");
    expect(component?.appliedAmount.toCentsString()).toBe("40000");
    expect(component?.appliedMovementReferenceIds).toEqual(["movement-withdrawal"]);
  });

  it("does not apply any reserve movement twice when all references are reflected", () => {
    const snapshot = deriveReserveSnapshot({
      ...context,
      alreadyReflectedReferenceIds: ["movement-contribution", "movement-withdrawal"],
      boxes: [
        box({
          movements: [
            {
              referenceId: "movement-contribution",
              boxReferenceId: "box-main",
              kind: "CONTRIBUTION",
              amountCents: "100000",
              effectiveOn: "2026-09-01",
            },
            {
              referenceId: "movement-withdrawal",
              boxReferenceId: "box-main",
              kind: "WITHDRAWAL",
              amountCents: "40000",
              effectiveOn: "2026-09-15",
            },
          ],
        }),
      ],
    });

    expect(snapshot.protectedAmount.toCentsString()).toBe("60000");
    expect(snapshot.appliedOpeningAdjustment.toCentsString()).toBe("0");
    expect(snapshot.components[0]?.appliedAmount.toCentsString()).toBe("0");
  });

  it("keeps a negative derived box balance without increasing global spendable", () => {
    const snapshot = deriveReserveSnapshot({
      ...context,
      boxes: [
        box({
          movements: [
            {
              referenceId: "movement-contribution",
              boxReferenceId: "box-main",
              kind: "CONTRIBUTION",
              amountCents: "100000",
              effectiveOn: "2026-09-01",
            },
            {
              referenceId: "movement-overdraft",
              boxReferenceId: "box-main",
              kind: "WITHDRAWAL",
              amountCents: "250000",
              effectiveOn: "2026-09-20",
            },
          ],
        }),
      ],
    });

    expect(snapshot.boxes[0]?.balance.toCentsString()).toBe("-150000");
    expect(snapshot.boxes[0]?.protectedAmount.toCentsString()).toBe("0");
    expect(snapshot.protectedAmount.toCentsString()).toBe("0");
    expect(snapshot.appliedOpeningAdjustment.toCentsString()).toBe("0");
    expect(snapshot.components).toEqual([]);
  });

  it("releases protection at the effective closing date but preserves historical cutoff", () => {
    const closed = box({
      status: "CLOSED",
      closedOn: "2026-09-10",
    });

    const historical = deriveReserveSnapshot({
      ...context,
      asOf: "2026-09-09",
      boxes: [closed],
    });
    expect(historical.boxes[0]?.status).toBe("ACTIVE");
    expect(historical.protectedAmount.toCentsString()).toBe("100000");
    expect(historical.appliedOpeningAdjustment.toCentsString()).toBe("-100000");

    const current = deriveReserveSnapshot({ ...context, boxes: [closed] });
    expect(current.boxes[0]?.status).toBe("CLOSED");
    expect(current.boxes[0]?.balance.toCentsString()).toBe("100000");
    expect(current.protectedAmount.toCentsString()).toBe("0");
    expect(current.appliedOpeningAdjustment.toCentsString()).toBe("0");
    expect(current.components).toEqual([]);
  });

  it("ignores movements after the cutoff and keeps the provider tenant-neutral", async () => {
    let receivedContext: ReserveAdapterContext | undefined;
    const adapter = createMovementReserveAdapter(async (adapterContext) => {
      receivedContext = adapterContext;
      return [
        box({
          movements: [
            ...box().movements,
            {
              referenceId: "future-contribution",
              boxReferenceId: "box-main",
              kind: "CONTRIBUTION",
              amountCents: "900000",
              effectiveOn: "2026-10-01",
            },
          ],
        }),
      ];
    });

    const snapshot = await adapter.getReserve(context);
    expect(snapshot.protectedAmount.toCentsString()).toBe("100000");
    expect(receivedContext).toEqual(context);
    expect("householdId" in (receivedContext ?? {})).toBe(false);
  });

  it("rejects conflicting duplicate box/movement references", () => {
    expect(() =>
      deriveReserveSnapshot({
        ...context,
        boxes: [
          box(),
          box({
            boxReferenceId: "box-main",
          }),
        ],
      }),
    ).toThrowError(/caixinha aparece mais de uma vez/u);

    expect(() =>
      deriveReserveSnapshot({
        ...context,
        boxes: [
          box(),
          box({
            boxReferenceId: "box-other",
            movements: [
              {
                referenceId: "movement-contribution",
                boxReferenceId: "box-other",
                kind: "CONTRIBUTION",
                amountCents: "1",
                effectiveOn: "2026-09-01",
              },
            ],
          }),
        ],
      }),
    ).toThrowError(/movimento aparece mais de uma vez/u);
  });
});
