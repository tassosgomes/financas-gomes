/**
 * Server-side bridge from S08's opaque causal references to the existing S07
 * origin resolver.  It only builds a route from an item already authorized by
 * S07; it never accepts a household, table, status or client-selected source.
 */
import {
  forecastOriginHref,
} from "@/modules/forecast/origins";

import {
  SPENDABLE_SOURCE_KINDS,
  type NormalizedSpendableForecastItem,
  type OpaqueReference,
  type SpendableCausalItem,
  type SpendableSourceKind,
} from "./contracts";

export interface SpendableOriginMapping {
  readonly referenceId: OpaqueReference;
  readonly sourceKind: SpendableSourceKind;
  /** Null means the source is unavailable for an S07 origin route (RESERVE). */
  readonly href: string | null;
}

function sourceKindForOrigin(
  kind: SpendableSourceKind,
): Exclude<SpendableSourceKind, "RESERVE"> | null {
  if (kind === "RESERVE") return null;
  return SPENDABLE_SOURCE_KINDS.includes(kind) ? kind : null;
}

/**
 * Returns the canonical S07 route for a normalized item.  UUID/tenant
 * authorization remains the responsibility of `resolveForecastOriginForContext`
 * when that route is opened.
 */
export function spendableOriginHref(
  item: Pick<NormalizedSpendableForecastItem, "referenceId" | "source">,
  basePath?: string,
): string | null {
  const sourceKind = sourceKindForOrigin(item.source.kind);
  if (sourceKind === null) return null;
  return forecastOriginHref(
    {
      referenceId: item.referenceId,
      source: {
        kind: sourceKind,
        referenceId: item.source.referenceId,
        label: item.source.label,
        ...(item.source.recurringRuleId === undefined
          ? {}
          : { recurringRuleId: item.source.recurringRuleId }),
        ...(item.source.occurrenceKey === undefined
          ? {}
          : { occurrenceKey: item.source.occurrenceKey }),
        ...(item.source.billingCycle === undefined
          ? {}
          : { billingCycle: item.source.billingCycle }),
        ...(item.source.installmentSequence === undefined
          ? {}
          : { installmentSequence: item.source.installmentSequence }),
      },
    },
    basePath as Parameters<typeof forecastOriginHref>[1],
  );
}

/** Maps a public causal item to its source route when enough S07 hints exist. */
export function spendableCausalOriginHref(
  item: SpendableCausalItem,
  basePath?: string,
): string | null {
  const sourceKind = sourceKindForOrigin(item.sourceKind);
  if (sourceKind === null) return null;
  return forecastOriginHref(
    {
      referenceId: item.referenceId,
      source: {
        kind: sourceKind,
        referenceId: item.referenceId,
        label: "Origem do compromisso",
        ...(item.recurringRuleId === undefined
          ? {}
          : { recurringRuleId: item.recurringRuleId }),
        ...(item.occurrenceKey === undefined
          ? {}
          : { occurrenceKey: item.occurrenceKey }),
        ...(item.billingCycle === undefined
          ? {}
          : { billingCycle: item.billingCycle }),
        ...(item.installmentSequence === undefined
          ? {}
          : { installmentSequence: item.installmentSequence }),
      },
    },
    basePath as Parameters<typeof forecastOriginHref>[1],
  );
}

export function mapSpendableOrigin(
  item: SpendableCausalItem,
  basePath?: string,
): SpendableOriginMapping {
  return {
    referenceId: item.referenceId,
    sourceKind: item.sourceKind,
    href: spendableCausalOriginHref(item, basePath),
  };
}

export const getSpendableOriginHref = spendableOriginHref;
export const getSpendableCausalOriginHref = spendableCausalOriginHref;
