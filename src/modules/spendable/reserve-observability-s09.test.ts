import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/observability/server", () => ({
  addBreadcrumbSafely: vi.fn(),
  captureServerException: vi.fn(),
}));

import {
  captureServerException,
} from "@/modules/observability/server";

import {
  deriveReserveSnapshot,
  readReserveSnapshot,
  readSerializableReserveSnapshot,
  serializeReserveSnapshot,
  type ReserveAdapterContext,
  type SpendableReserveAdapter,
} from "./reserve-adapter";

const context: ReserveAdapterContext = {
  asOf: "2026-09-30",
  scenario: "CONSERVATIVE",
  horizon: { days: 90 },
};

function protectedSnapshot() {
  return deriveReserveSnapshot({
    ...context,
    boxes: [
      {
        boxReferenceId: "box-private-123456",
        status: "ACTIVE",
        activeFrom: "2026-09-01",
        closedOn: null,
        movements: [
          {
            referenceId: "movement-private-123456",
            boxReferenceId: "box-private-123456",
            kind: "CONTRIBUTION",
            amountCents: "123456",
            effectiveOn: "2026-09-01",
          },
        ],
      },
    ],
  });
}

function adapterFor(snapshot: ReturnType<typeof protectedSnapshot>): SpendableReserveAdapter {
  return {
    contractVersion: "s09.v1",
    getReserve: vi.fn().mockResolvedValue(snapshot),
  };
}

describe("S09 provider/serialization reserve boundaries", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(captureServerException).mockClear();
  });

  it("emits only categorical provider metadata and preserves the domain result", async () => {
    const records: unknown[] = [];
    const snapshot = protectedSnapshot();
    const adapter = adapterFor(snapshot);

    const observed = await readReserveSnapshot(adapter, context, {
      requestId: "reserve-provider-correlation",
      onRecord: (record) => records.push(record),
      amountCents: "123456",
      name: "Nome financeiro privado",
      referenceId: "movement-private-123456",
      payload: { amountCents: "123456" },
    });

    expect(observed).toBe(snapshot);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: "s09_budget_provider_read_success",
      operation: "budget.provider.read",
      stage: "provider",
      requestId: "reserve-provider-correlation",
      result: "PROTECTED",
      providerStatus: "AVAILABLE",
      budgetCount: 1,
      activeBudgetCount: 1,
      componentCount: 1,
      movementCount: 1,
      appliedMovementCount: 1,
    });
    expect(JSON.stringify(records[0])).not.toMatch(
      /123456|private|Nome financeiro|box-private|reference/u,
    );
  });

  it("distinguishes no boxes from an unavailable provider", async () => {
    const records: unknown[] = [];
    const noBoxes = deriveReserveSnapshot({ ...context, boxes: [] });

    await readReserveSnapshot(adapterFor(noBoxes), context, {
      onRecord: (record) => records.push(record),
    });
    await readReserveSnapshot(
      {
        contractVersion: "s09.v1",
        getReserve: vi.fn().mockResolvedValue({
          contractVersion: "s09.v1",
          status: "UNAVAILABLE",
          protectedAmount: noBoxes.protectedAmount,
          appliedOpeningAdjustment: noBoxes.appliedOpeningAdjustment,
          components: [],
          boxes: [],
        }),
      },
      context,
      { onRecord: (record) => records.push(record) },
    );

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      result: "NO_BOXES",
      providerStatus: "AVAILABLE",
    });
    expect(records[1]).toMatchObject({
      result: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
    });
  });

  it("captures provider exceptions opaquely and preserves the original throw", async () => {
    const records: unknown[] = [];
    const error = {
      code: "database private 123456",
      message: "SELECT amount_cents=123456 from private_source",
    };
    const adapter: SpendableReserveAdapter = {
      contractVersion: "s09.v1",
      getReserve: vi.fn().mockRejectedValue(error),
    };

    await expect(
      readReserveSnapshot(adapter, context, {
        onRecord: (record) => records.push(record),
      }),
    ).rejects.toBe(error);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.provider.read",
      stage: "provider",
      outcome: "unexpected_error",
      result: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
      errorCode: "BUDGET_PROVIDER_FAILED",
    });
    expect(JSON.stringify(records[0])).not.toMatch(
      /database|SELECT|amount_cents|123456|private/u,
    );
    expect(captureServerException).toHaveBeenCalledOnce();
    expect(
      JSON.stringify(vi.mocked(captureServerException).mock.calls[0]?.[1]),
    ).not.toMatch(/database|SELECT|amount_cents|123456|private/u);
  });

  it("observes serialized s09.v1 output without logging its fields", async () => {
    const records: unknown[] = [];
    const adapter = adapterFor(protectedSnapshot());
    const serialized = await readSerializableReserveSnapshot(adapter, context, {
      requestId: "reserve-serialization-correlation",
      onRecord: (record) => records.push(record),
    });

    expect(serialized).toMatchObject({
      contractVersion: "s09.v1",
      status: "AVAILABLE",
      protectedCents: "123456",
      components: [
        expect.objectContaining({
          referenceId: "box-private-123456",
          amountCents: "123456",
        }),
      ],
    });
    expect(records.map((record) => (record as { operation: string }).operation)).toEqual([
      "budget.provider.read",
      "budget.serialize",
    ]);
    expect(records[1]).toMatchObject({
      event: "s09_budget_serialize_success",
      stage: "serialization",
      requestId: "reserve-serialization-correlation",
      result: "PROTECTED",
      providerStatus: "AVAILABLE",
      componentCount: 1,
      serializedFieldCount: 14,
    });
    expect(JSON.stringify(records[1])).not.toMatch(/123456|private|box-private/u);
  });

  it("captures serialization failures with a stable technical code", () => {
    const records: unknown[] = [];
    const malformed = {
      contractVersion: "s09.v1",
      status: "AVAILABLE",
      protectedAmount: {
        toCentsString: () => {
          throw new Error("serialize amount_cents=123456 private");
        },
      },
      appliedOpeningAdjustment: { toCentsString: () => "0" },
      components: [],
      boxes: [],
    } as unknown as ReturnType<typeof protectedSnapshot>;

    expect(() =>
      serializeReserveSnapshot(malformed, {
        onRecord: (record) => records.push(record),
      }),
    ).toThrow(/serialize amount_cents=123456 private/u);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "budget.serialize",
      stage: "serialization",
      outcome: "unexpected_error",
      errorCode: "BUDGET_SERIALIZATION_FAILED",
    });
    expect(JSON.stringify(records[0])).not.toMatch(/amount_cents|123456|private/u);
    expect(captureServerException).toHaveBeenCalledOnce();
  });
});
