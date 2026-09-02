import { Temporal } from "@js-temporal/polyfill";

import {
  SPENDABLE_SCENARIOS,
  SpendableContractError,
  compareSpendableDates,
  spendableDate,
  spendableMoney,
  spendablePositiveCents,
  spendableReference,
  type OpaqueReference,
  type SpendableCentsInput,
  type SpendableDate,
  type SpendableMoney,
  type SpendableReserveComponent,
  type SpendableReserveSnapshot,
  type SpendableScenario,
} from "./contracts";

/** The version owned by the future S09 reserve provider. */
export const S09_RESERVE_CONTRACT_VERSION = "s09.v1" as const;
export const RESERVE_CONTRACT_VERSION = S09_RESERVE_CONTRACT_VERSION;
export const SPENDABLE_RESERVE_CONTRACT_VERSION = S09_RESERVE_CONTRACT_VERSION;

/**
 * A rule is deliberately a closed vocabulary in v1.  A new rule must be
 * versioned instead of changing the meaning of an existing component.
 */
export const RESERVE_RULES = ["BOX_BALANCE_PROTECTED"] as const;
export type ReserveRule = (typeof RESERVE_RULES)[number];
export const RESERVE_RULE = RESERVE_RULES[0];

/** Component kind leaves room for future reserve sources without widening v1. */
export const RESERVE_COMPONENT_KINDS = ["BOX_BALANCE"] as const;
export type ReserveComponentKind = (typeof RESERVE_COMPONENT_KINDS)[number];

export const RESERVE_BOX_STATUSES = ["ACTIVE", "CLOSED"] as const;
export type ReserveBoxStatus = (typeof RESERVE_BOX_STATUSES)[number];

export const RESERVE_MOVEMENT_KINDS = ["CONTRIBUTION", "WITHDRAWAL"] as const;
export type ReserveMovementKind = (typeof RESERVE_MOVEMENT_KINDS)[number];

export type ReserveAdapterStatus = "UNAVAILABLE" | "AVAILABLE";

/**
 * Technical context supplied by the S08 server reader.  There is intentionally
 * no household/user/account field here: the owner of tenancy resolves those
 * values before invoking this port.  `asOf` is the inclusive cutoff date.
 */
export interface ReserveAdapterContext {
  readonly asOf: string | Temporal.PlainDate;
  readonly scenario: SpendableScenario;
  readonly horizon: { readonly days: number };
  /** References already represented by POSTED ledger or S07 forecast. */
  readonly reflectedReferenceIds?: readonly OpaqueReference[];
  /** Explicit alias used by callers that call the cutoff a reconciliation set. */
  readonly alreadyReflectedReferenceIds?: readonly OpaqueReference[];
}

/** Domain movement. Amount is positive and the kind carries its sign. */
export interface ReserveMovement {
  readonly referenceId: OpaqueReference;
  readonly boxReferenceId: OpaqueReference;
  readonly kind: ReserveMovementKind;
  readonly amount: SpendableMoney;
  readonly effectiveOn: SpendableDate;
}

/** Input form accepted by the pure S09 handoff adapter. */
export interface ReserveMovementInput {
  readonly referenceId: OpaqueReference;
  readonly boxReferenceId: OpaqueReference;
  readonly kind: ReserveMovementKind;
  readonly amount?: SpendableCentsInput;
  readonly amountCents?: SpendableCentsInput;
  readonly effectiveOn: string | Temporal.PlainDate;
}

/**
 * The box has no persisted balance in this contract.  Its balance is always
 * derived from effective movements.  `closedOn` is the effective date of
 * closing: a query on that date or later has no protected amount, while a
 * historical query before it still sees the box as active.
 */
export interface ReserveBox {
  readonly rule: ReserveRule;
  readonly boxReferenceId: OpaqueReference;
  readonly status: ReserveBoxStatus;
  readonly activeFrom: SpendableDate;
  readonly closedOn: SpendableDate | null;
  readonly movements: readonly ReserveMovement[];
}

export interface ReserveBoxInput {
  readonly rule?: ReserveRule;
  readonly boxReferenceId: OpaqueReference;
  readonly status: ReserveBoxStatus;
  readonly activeFrom: string | Temporal.PlainDate;
  readonly closedOn?: string | Temporal.PlainDate | null;
  readonly movements: readonly ReserveMovementInput[];
}

/** Balance of one box at the cutoff; signed values are retained for S09. */
export interface ReserveBoxBalance {
  readonly rule: ReserveRule;
  readonly boxReferenceId: OpaqueReference;
  readonly status: ReserveBoxStatus;
  readonly asOf: SpendableDate;
  /** Signed derived balance; negative balances are carried, never spendable. */
  readonly balance: SpendableMoney;
  /** max(balance, 0), used only for protection of the global spendable. */
  readonly protectedAmount: SpendableMoney;
  readonly movementReferenceIds: readonly OpaqueReference[];
}

/**
 * A protected component is one current box balance.  `appliedAmount` is the
 * signed opening adjustment contributed by movements that were not already
 * reflected in the ledger/forecast: contribution => negative, withdrawal =>
 * positive.  The component's `amount` remains the positive protected balance.
 */
export interface ProtectedReserveComponent {
  readonly kind: ReserveComponentKind;
  readonly rule: ReserveRule;
  readonly referenceId: OpaqueReference;
  readonly boxReferenceId: OpaqueReference;
  readonly amount: SpendableMoney;
  readonly appliedAmount: SpendableMoney;
  readonly effectiveOn: SpendableDate;
  readonly movementReferenceIds: readonly OpaqueReference[];
  readonly appliedMovementReferenceIds: readonly OpaqueReference[];
}

export type SpendableReserveComponentDomain = ProtectedReserveComponent;
export type S09ReserveComponent = ProtectedReserveComponent;
export type S09ReserveMovement = ReserveMovement;
export type S09ReserveBox = ReserveBox;

/** Internal snapshot used between server adapters and the S08 pure engine. */
export interface ReserveSnapshotDomain {
  readonly contractVersion: typeof S09_RESERVE_CONTRACT_VERSION;
  readonly status: ReserveAdapterStatus;
  readonly protectedAmount: SpendableMoney;
  readonly appliedOpeningAdjustment: SpendableMoney;
  readonly components: readonly ProtectedReserveComponent[];
  readonly boxes: readonly ReserveBoxBalance[];
}

export type SpendableReserveSnapshotDomain = ReserveSnapshotDomain;

/** Input for the persistence-free movement adapter used by S09. */
export interface DeriveReserveSnapshotInput extends ReserveAdapterContext {
  readonly boxes: readonly ReserveBoxInput[] | readonly ReserveBox[];
}

export interface DeriveReserveSnapshotWithContextInput {
  readonly context: ReserveAdapterContext;
  readonly boxes: readonly ReserveBoxInput[] | readonly ReserveBox[];
}

export type ReserveSnapshotInput =
  | DeriveReserveSnapshotInput
  | DeriveReserveSnapshotWithContextInput;

/**
 * Server-only adapter port.  S08 consumes the versioned snapshot and does not
 * know about S09 tables, CRUD, or a persisted box balance.
 */
export interface SpendableReserveAdapter {
  readonly contractVersion: typeof S09_RESERVE_CONTRACT_VERSION;
  getReserve(
    context: ReserveAdapterContext,
  ): ReserveSnapshotDomain | Promise<ReserveSnapshotDomain>;
}

export type ReserveAdapter = SpendableReserveAdapter;
export type S09ReserveAdapter = SpendableReserveAdapter;

const ZERO = BigInt(0);
const MAX_HORIZON_DAYS = 3_660;

function fail(code: ConstructorParameters<typeof SpendableContractError>[0], message: string, field?: string): never {
  throw new SpendableContractError(code, message, field);
}

function readEnum<T extends readonly string[]>(
  value: unknown,
  values: T,
  message: string,
  field: string,
): T[number] {
  if (typeof value === "string" && (values as readonly string[]).includes(value)) {
    return value as T[number];
  }
  return fail("INVALID_ITEM", message, field);
}

function canonicalReferences(
  values: readonly OpaqueReference[] | undefined,
  field: string,
): readonly OpaqueReference[] {
  if (!values) return [];
  const unique = new Set<string>();
  for (const [index, value] of values.entries()) {
    const reference = spendableReference(value, `${field}[${index}]`);
    unique.add(reference);
  }
  return [...unique].sort();
}

function resolveContext(
  input: ReserveSnapshotInput,
): {
  readonly context: {
    readonly asOf: Temporal.PlainDate;
    readonly scenario: SpendableScenario;
    readonly horizonDays: number;
    readonly reflectedReferenceIds: ReadonlySet<string>;
  };
  readonly boxes: readonly ReserveBoxInput[] | readonly ReserveBox[];
} {
  const value = "context" in input ? input.context : input;
  const asOf = spendableDate(value.asOf, "asOf");
  if (!SPENDABLE_SCENARIOS.includes(value.scenario)) {
    return fail("INVALID_SCENARIO", "O cenário da reserva é inválido.", "scenario");
  }

  const horizonDays = value.horizon.days;
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > MAX_HORIZON_DAYS) {
    return fail("INVALID_ITEM", "O horizonte da reserva é inválido.", "horizon.days");
  }

  const reflected = [
    ...canonicalReferences(value.reflectedReferenceIds, "reflectedReferenceIds"),
    ...canonicalReferences(
      value.alreadyReflectedReferenceIds,
      "alreadyReflectedReferenceIds",
    ),
  ];

  return {
    context: {
      asOf,
      scenario: value.scenario,
      horizonDays,
      reflectedReferenceIds: new Set(reflected),
    },
    boxes: input.boxes,
  };
}

function readMovementAmount(input: ReserveMovementInput): bigint {
  if (input.amount !== undefined && input.amountCents !== undefined) {
    const amount = spendablePositiveCents(input.amount, "movement.amount");
    const alias = spendablePositiveCents(input.amountCents, "movement.amountCents");
    if (amount !== alias) {
      return fail(
        "SPENDABLE_INCONSISTENT",
        "amount e amountCents devem coincidir.",
        "movement.amount",
      );
    }
    return amount;
  }
  if (input.amount !== undefined) return spendablePositiveCents(input.amount, "movement.amount");
  if (input.amountCents !== undefined) {
    return spendablePositiveCents(input.amountCents, "movement.amountCents");
  }
  return fail("INVALID_AMOUNT", "O movimento exige amount em centavos.", "movement.amount");
}

function normalizeMovement(
  input: ReserveMovementInput | ReserveMovement,
  boxReferenceId: OpaqueReference,
  index: number,
): ReserveMovement {
  const referenceId = spendableReference(input.referenceId, `movements[${index}].referenceId`);
  const movementBox = spendableReference(
    input.boxReferenceId,
    `movements[${index}].boxReferenceId`,
  );
  if (movementBox !== boxReferenceId) {
    return fail(
      "SPENDABLE_INCONSISTENT",
      "O movimento deve pertencer à mesma caixinha.",
      `movements[${index}].boxReferenceId`,
    );
  }
  const kind = readEnum(
    input.kind,
    RESERVE_MOVEMENT_KINDS,
    "O tipo de movimento da reserva é inválido.",
    `movements[${index}].kind`,
  );
  const amount = "amount" in input ? input.amount : undefined;
  const amountCents = "amountCents" in input ? input.amountCents : undefined;
  const amountValue = amount !== undefined || amountCents !== undefined
    ? readMovementAmount({
        referenceId,
        boxReferenceId: movementBox,
        kind,
        amount,
        amountCents,
        effectiveOn: input.effectiveOn,
      })
    : spendablePositiveCents((input as ReserveMovement).amount, `movements[${index}].amount`);
  const effectiveOn = spendableDate(input.effectiveOn, `movements[${index}].effectiveOn`);
  return {
    referenceId,
    boxReferenceId: movementBox,
    kind,
    amount: spendableMoney(amountValue),
    effectiveOn,
  };
}

function normalizeBox(input: ReserveBoxInput | ReserveBox, index: number): ReserveBox {
  const boxReferenceId = spendableReference(input.boxReferenceId, `boxes[${index}].boxReferenceId`);
  const rule = readEnum(
    input.rule ?? RESERVE_RULE,
    RESERVE_RULES,
    "A regra da caixinha é inválida.",
    `boxes[${index}].rule`,
  );
  const status = readEnum(
    input.status,
    RESERVE_BOX_STATUSES,
    "O status da caixinha é inválido.",
    `boxes[${index}].status`,
  );
  const activeFrom = spendableDate(input.activeFrom, `boxes[${index}].activeFrom`);
  const closedOn = input.closedOn == null ? null : spendableDate(input.closedOn, `boxes[${index}].closedOn`);
  if (closedOn && compareSpendableDates(closedOn, activeFrom) < 0) {
    return fail(
      "INVALID_DATE_RANGE",
      "A data de encerramento não pode preceder a ativação.",
      `boxes[${index}].closedOn`,
    );
  }
  if (status === "CLOSED" && closedOn === null) {
    return fail(
      "SPENDABLE_INCONSISTENT",
      "Caixinha encerrada exige closedOn.",
      `boxes[${index}].closedOn`,
    );
  }
  if (status === "ACTIVE" && closedOn !== null) {
    return fail(
      "SPENDABLE_INCONSISTENT",
      "Caixinha ativa não pode ter closedOn.",
      `boxes[${index}].closedOn`,
    );
  }

  const movements = input.movements.map((movement, movementIndex) => {
    const normalized = normalizeMovement(movement, boxReferenceId, movementIndex);
    if (compareSpendableDates(normalized.effectiveOn, activeFrom) < 0) {
      return fail(
        "INVALID_DATE_RANGE",
        "Movimento anterior à ativação da caixinha.",
        `boxes[${index}].movements[${movementIndex}].effectiveOn`,
      );
    }
    if (closedOn && compareSpendableDates(normalized.effectiveOn, closedOn) > 0) {
      return fail(
        "INVALID_DATE_RANGE",
        "Movimento posterior ao encerramento da caixinha.",
        `boxes[${index}].movements[${movementIndex}].effectiveOn`,
      );
    }
    return normalized;
  });

  return {
    rule,
    boxReferenceId,
    status,
    activeFrom,
    closedOn,
    movements,
  };
}

function movementEffect(movement: ReserveMovement): bigint {
  return movement.kind === "CONTRIBUTION" ? movement.amount.cents : -movement.amount.cents;
}

function isActiveAt(box: ReserveBox, asOf: Temporal.PlainDate): boolean {
  return compareSpendableDates(box.activeFrom, asOf) <= 0 &&
    (box.closedOn === null || compareSpendableDates(asOf, box.closedOn) < 0);
}

function emptySnapshot(): ReserveSnapshotDomain {
  return {
    contractVersion: S09_RESERVE_CONTRACT_VERSION,
    status: "UNAVAILABLE",
    protectedAmount: spendableMoney(ZERO),
    appliedOpeningAdjustment: spendableMoney(ZERO),
    components: [],
    boxes: [],
  };
}

/**
 * Derives the S09 contract from movements.  It is intentionally persistence
 * free: S09 can replace the source with tenant-scoped SQL without changing
 * this boundary or the S08 public API.
 */
export function deriveReserveSnapshot(input: ReserveSnapshotInput): ReserveSnapshotDomain {
  const { context, boxes: rawBoxes } = resolveContext(input);
  const normalizedBoxes = rawBoxes.map((box, index) => normalizeBox(box, index));
  const seenBoxes = new Set<string>();
  const seenMovements = new Set<string>();
  const protectedComponents: ProtectedReserveComponent[] = [];
  const balances: ReserveBoxBalance[] = [];
  let protectedAmount = ZERO;
  let appliedOpeningAdjustment = ZERO;

  for (const box of normalizedBoxes) {
    if (seenBoxes.has(box.boxReferenceId)) {
      return fail(
        "DUPLICATE_REFERENCE",
        "A caixinha aparece mais de uma vez.",
        "boxes.boxReferenceId",
      );
    }
    seenBoxes.add(box.boxReferenceId);

    for (const movement of box.movements) {
      if (seenMovements.has(movement.referenceId)) {
        return fail(
          "DUPLICATE_REFERENCE",
          "Um movimento aparece mais de uma vez.",
          "movements.referenceId",
        );
      }
      seenMovements.add(movement.referenceId);
    }

    const effectiveMovements = box.movements.filter(
      ({ effectiveOn }) => compareSpendableDates(effectiveOn, context.asOf) <= 0,
    );
    const movementReferenceIds = effectiveMovements
      .map(({ referenceId }) => referenceId)
      .sort();
    const balance = effectiveMovements.reduce(
      (total, movement) => total + movementEffect(movement),
      ZERO,
    );
    const active = isActiveAt(box, context.asOf);
    const protectedCents = active && balance > ZERO ? balance : ZERO;
    const unreflected = effectiveMovements
      .filter(({ referenceId }) => !context.reflectedReferenceIds.has(referenceId))
      .reduce((total, movement) => total + movementEffect(movement), ZERO);
    // Negative box balances are carried by S09 but can never increase global
    // spendable.  A closed box similarly releases protection exactly once.
    const appliedCents = active && balance > ZERO ? -unreflected : ZERO;

    balances.push({
      rule: box.rule,
      boxReferenceId: box.boxReferenceId,
      status: active ? "ACTIVE" : "CLOSED",
      asOf: context.asOf,
      balance: spendableMoney(balance),
      protectedAmount: spendableMoney(protectedCents),
      movementReferenceIds,
    });

    if (protectedCents > ZERO) {
      const appliedMovementReferenceIds = effectiveMovements
        .filter(({ referenceId }) => !context.reflectedReferenceIds.has(referenceId))
        .map(({ referenceId }) => referenceId)
        .sort();
      protectedComponents.push({
        kind: "BOX_BALANCE",
        rule: box.rule,
        referenceId: box.boxReferenceId,
        boxReferenceId: box.boxReferenceId,
        amount: spendableMoney(protectedCents),
        appliedAmount: spendableMoney(appliedCents),
        effectiveOn: context.asOf,
        movementReferenceIds,
        appliedMovementReferenceIds,
      });
      protectedAmount += protectedCents;
      appliedOpeningAdjustment += appliedCents;
    }
  }

  return {
    contractVersion: S09_RESERVE_CONTRACT_VERSION,
    status: "AVAILABLE",
    protectedAmount: spendableMoney(protectedAmount),
    appliedOpeningAdjustment: spendableMoney(appliedOpeningAdjustment),
    components: protectedComponents,
    boxes: balances,
  };
}

/** A source function is the only thing S09 needs to replace with a DB reader. */
export type ReserveBoxSource = (
  context: ReserveAdapterContext,
) => readonly ReserveBoxInput[] | readonly ReserveBox[] | Promise<readonly ReserveBoxInput[] | readonly ReserveBox[]>;

export class MovementReserveAdapter implements SpendableReserveAdapter {
  readonly contractVersion = S09_RESERVE_CONTRACT_VERSION;

  constructor(private readonly source: ReserveBoxSource) {}

  async getReserve(context: ReserveAdapterContext): Promise<ReserveSnapshotDomain> {
    const boxes = await this.source(context);
    return deriveReserveSnapshot({ ...context, boxes });
  }
}

export const createMovementReserveAdapter = (source: ReserveBoxSource): SpendableReserveAdapter =>
  new MovementReserveAdapter(source);

/**
 * Pre-S09 implementation.  The output is explicitly unavailable, not an
 * omitted field, so S08 can ship and the UI can state that no box protection
 * was applied.
 */
export class ZeroReserveAdapter implements SpendableReserveAdapter {
  readonly contractVersion = S09_RESERVE_CONTRACT_VERSION;

  getReserve(context: ReserveAdapterContext): ReserveSnapshotDomain {
    void context;
    return emptySnapshot();
  }

  /** Alias useful to service code that calls the port a snapshot reader. */
  getSnapshot(context: ReserveAdapterContext): ReserveSnapshotDomain {
    return this.getReserve(context);
  }

  read(context: ReserveAdapterContext): ReserveSnapshotDomain {
    return this.getReserve(context);
  }
}

export const zeroReserveAdapter: SpendableReserveAdapter = new ZeroReserveAdapter();
export const createZeroReserveAdapter = (): SpendableReserveAdapter => new ZeroReserveAdapter();

export interface SerializedSpendableReserveComponent
  extends SpendableReserveComponent {
  readonly kind: ReserveComponentKind;
  readonly rule: ReserveRule;
  readonly boxReferenceId: OpaqueReference;
  readonly appliedAmountCents: string;
  readonly movementReferenceIds: readonly OpaqueReference[];
  readonly appliedMovementReferenceIds: readonly OpaqueReference[];
}

export interface SerializedSpendableReserveSnapshot
  extends Omit<SpendableReserveSnapshot, "components"> {
  readonly components: readonly SerializedSpendableReserveComponent[];
}

/** Converts Money/PlainDate internals to the existing S08 serializable DTO. */
export function serializeReserveSnapshot(
  snapshot: ReserveSnapshotDomain,
): SerializedSpendableReserveSnapshot {
  return {
    contractVersion: snapshot.contractVersion,
    status: snapshot.status,
    protectedCents: snapshot.protectedAmount.toCentsString(),
    appliedOpeningAdjustmentCents: snapshot.appliedOpeningAdjustment.toCentsString(),
    components: snapshot.components.map((component) => ({
      kind: component.kind,
      rule: component.rule,
      referenceId: component.referenceId,
      boxReferenceId: component.boxReferenceId,
      amountCents: component.amount.toCentsString(),
      appliedAmountCents: component.appliedAmount.toCentsString(),
      effectiveOn: component.effectiveOn.toString(),
      movementReferenceIds: [...component.movementReferenceIds],
      appliedMovementReferenceIds: [...component.appliedMovementReferenceIds],
    })),
  };
}

export const toSerializableReserveSnapshot = serializeReserveSnapshot;
export const serializeS09ReserveSnapshot = serializeReserveSnapshot;

/** Resolves either sync or async implementations at the S08 server boundary. */
export async function readReserveSnapshot(
  adapter: SpendableReserveAdapter,
  context: ReserveAdapterContext,
): Promise<ReserveSnapshotDomain> {
  const snapshot = await adapter.getReserve(context);
  if (snapshot.contractVersion !== S09_RESERVE_CONTRACT_VERSION) {
    return fail(
      "SPENDABLE_INCONSISTENT",
      "A versão do contrato de reserva é incompatível.",
      "contractVersion",
    );
  }
  return snapshot;
}

export async function readSerializableReserveSnapshot(
  adapter: SpendableReserveAdapter,
  context: ReserveAdapterContext,
): Promise<SerializedSpendableReserveSnapshot> {
  return serializeReserveSnapshot(await readReserveSnapshot(adapter, context));
}

// Kept as named aliases for downstream S08/S09 handoff code.
export const buildReserveSnapshot = deriveReserveSnapshot;
export const deriveProtectedReserve = deriveReserveSnapshot;
export const toReserveSnapshot = serializeReserveSnapshot;
