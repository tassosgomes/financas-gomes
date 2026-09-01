"use server";

import { revalidatePath } from "next/cache";

import { requireFinancialContext } from "@/modules/households/context";
import { FinancialContextError } from "@/modules/households/contracts";
import {
  createForecastMaintenanceUseCases,
  type ForecastMaintenancePort,
} from "@/modules/forecast/maintenance";
import type {
  ForecastMaintenanceResult,
  PlannedEventReadModel,
} from "@/modules/forecast/maintenance-contracts";
import { FORECAST_ORIGIN_ROUTE, FORECAST_ROUTE } from "@/modules/forecast/routes";
import type {
  RecurringOccurrenceReadModel,
  RecurringResult,
  RecurringRuleReadModel,
} from "@/modules/recurring/contracts";

function unauthenticated<T>(): ForecastMaintenanceResult<T> {
  return {
    ok: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "É necessário entrar para acessar seu espaço financeiro.",
    },
  };
}

function revalidateForecast(): void {
  revalidatePath(FORECAST_ROUTE);
  revalidatePath(FORECAST_ORIGIN_ROUTE);
}

async function withForecastMaintenance<T>(
  operation: (
    context: Awaited<ReturnType<typeof requireFinancialContext>>,
    port: ForecastMaintenancePort,
  ) => Promise<ForecastMaintenanceResult<T> | RecurringResult<T>>,
): Promise<ForecastMaintenanceResult<T> | RecurringResult<T>> {
  try {
    const context = await requireFinancialContext();
    const result = await operation(context, createForecastMaintenanceUseCases());
    if (result.ok) revalidateForecast();
    return result;
  } catch (error) {
    if (error instanceof FinancialContextError) return unauthenticated<T>();
    throw error;
  }
}

/** Server action for adding a monthly/yearly recurring commitment. */
export async function createRecurringRuleAction(input: unknown): Promise<RecurringResult<RecurringRuleReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.createRecurringRule(context, input as never),
  ) as Promise<RecurringResult<RecurringRuleReadModel>>;
}

/** Server action for prospective recurring-rule changes. */
export async function updateRecurringRuleFutureAction(input: unknown): Promise<RecurringResult<RecurringRuleReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.updateRecurringRuleFuture(context, input as never),
  ) as Promise<RecurringResult<RecurringRuleReadModel>>;
}

export async function endRecurringRuleAction(input: unknown): Promise<RecurringResult<RecurringRuleReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.endRecurringRule(context, input as never),
  ) as Promise<RecurringResult<RecurringRuleReadModel>>;
}

export async function overrideRecurringOccurrenceAction(input: unknown): Promise<RecurringResult<RecurringOccurrenceReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.overrideRecurringOccurrence(context, input as never),
  ) as Promise<RecurringResult<RecurringOccurrenceReadModel>>;
}

export async function cancelRecurringOccurrenceAction(input: unknown): Promise<RecurringResult<RecurringOccurrenceReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.cancelRecurringOccurrence(context, input as never),
  ) as Promise<RecurringResult<RecurringOccurrenceReadModel>>;
}

export async function realizeRecurringOccurrenceAction(input: unknown): Promise<RecurringResult<RecurringOccurrenceReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.realizeRecurringOccurrence(context, input as never),
  ) as Promise<RecurringResult<RecurringOccurrenceReadModel>>;
}

export async function createPlannedEventAction(input: unknown): Promise<ForecastMaintenanceResult<PlannedEventReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.createPlannedEvent(context, input as never),
  ) as Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
}

export async function updatePlannedEventAction(input: unknown): Promise<ForecastMaintenanceResult<PlannedEventReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.updatePlannedEvent(context, input as never),
  ) as Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
}

export async function cancelPlannedEventAction(input: unknown): Promise<ForecastMaintenanceResult<PlannedEventReadModel>> {
  return withForecastMaintenance((context, port) =>
    port.cancelPlannedEvent(context, input as never),
  ) as Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
}

// Explicit aliases keep the action vocabulary discoverable without exposing
// a generic "maintenance" endpoint that could accept an installment target.
export async function createRecurringRule(input: unknown) {
  return createRecurringRuleAction(input);
}
export async function updateRecurringRuleFuture(input: unknown) {
  return updateRecurringRuleFutureAction(input);
}
export async function endRecurringRule(input: unknown) {
  return endRecurringRuleAction(input);
}
export async function overrideRecurringOccurrence(input: unknown) {
  return overrideRecurringOccurrenceAction(input);
}
export async function cancelRecurringOccurrence(input: unknown) {
  return cancelRecurringOccurrenceAction(input);
}
export async function realizeRecurringOccurrence(input: unknown) {
  return realizeRecurringOccurrenceAction(input);
}
export async function createPlannedEvent(input: unknown) {
  return createPlannedEventAction(input);
}
export async function updatePlannedEvent(input: unknown) {
  return updatePlannedEventAction(input);
}
export async function cancelPlannedEvent(input: unknown) {
  return cancelPlannedEventAction(input);
}
