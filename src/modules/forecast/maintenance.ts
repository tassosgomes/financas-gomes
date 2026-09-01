import type { Database } from "@/db";
import type { FinancialContext } from "@/modules/households/contracts";
import {
  createRecurringUseCases,
  type RecurringUseCasePort,
} from "@/modules/recurring/use-cases";
import type {
  RecurringOccurrenceReadModel,
  RecurringResult,
  RecurringRuleReadModel,
} from "@/modules/recurring/contracts";

import {
  createPlannedEventUseCases,
  type PlannedEventUseCasePort,
} from "./planned-events";
import type {
  CancelPlannedEventCommand,
  CreatePlannedEventCommand,
  ForecastMaintenanceResult,
  PlannedEventReadModel,
  UpdatePlannedEventCommand,
} from "./maintenance-contracts";
import type {
  CancelRecurringOccurrenceCommand,
  CreateRecurringRuleCommand,
  EndRecurringRuleCommand,
  OverrideRecurringOccurrenceCommand,
  RealizeRecurringOccurrenceCommand,
  UpdateRecurringRuleFutureCommand,
} from "@/modules/recurring/contracts";

/**
 * Composition port for T10. It intentionally has no installment methods:
 * installments are navigable source context, while purchase S06 owns all
 * edits/cancellation and the payment boundary is global to the card.
 */
export interface ForecastMaintenancePort {
  createRecurringRule(
    context: FinancialContext,
    command: CreateRecurringRuleCommand,
  ): Promise<RecurringResult<RecurringRuleReadModel>>;
  updateRecurringRuleFuture(
    context: FinancialContext,
    command: UpdateRecurringRuleFutureCommand,
  ): Promise<RecurringResult<RecurringRuleReadModel>>;
  endRecurringRule(
    context: FinancialContext,
    command: EndRecurringRuleCommand,
  ): Promise<RecurringResult<RecurringRuleReadModel>>;
  overrideRecurringOccurrence(
    context: FinancialContext,
    command: OverrideRecurringOccurrenceCommand,
  ): Promise<RecurringResult<RecurringOccurrenceReadModel>>;
  cancelRecurringOccurrence(
    context: FinancialContext,
    command: CancelRecurringOccurrenceCommand,
  ): Promise<RecurringResult<RecurringOccurrenceReadModel>>;
  realizeRecurringOccurrence(
    context: FinancialContext,
    command: RealizeRecurringOccurrenceCommand,
  ): Promise<RecurringResult<RecurringOccurrenceReadModel>>;
  createPlannedEvent(
    context: FinancialContext,
    command: CreatePlannedEventCommand,
  ): Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
  updatePlannedEvent(
    context: FinancialContext,
    command: UpdatePlannedEventCommand,
  ): Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
  cancelPlannedEvent(
    context: FinancialContext,
    command: CancelPlannedEventCommand,
  ): Promise<ForecastMaintenanceResult<PlannedEventReadModel>>;
}

export interface ForecastMaintenanceUseCaseOptions {
  database?: Database;
}

/** Operations intentionally exposed to source-detail actions. */
export const FORECAST_MAINTENANCE_OPERATIONS = [
  "recurring_rule.create",
  "recurring_rule.update_future",
  "recurring_rule.end",
  "recurring_occurrence.override",
  "recurring_occurrence.cancel",
  "recurring_occurrence.realize",
  "planned_event.create",
  "planned_event.update",
  "planned_event.cancel",
] as const;
export type ForecastMaintenanceOperation =
  (typeof FORECAST_MAINTENANCE_OPERATIONS)[number];

/** Guards adapters against accidentally routing a card action through T10. */
export function isAllowedForecastMaintenanceOperation(
  value: unknown,
): value is ForecastMaintenanceOperation {
  return (
    typeof value === "string" &&
    (FORECAST_MAINTENANCE_OPERATIONS as readonly string[]).includes(value)
  );
}

export function createForecastMaintenanceUseCases(
  options: ForecastMaintenanceUseCaseOptions = {},
): ForecastMaintenancePort {
  const recurring: RecurringUseCasePort = createRecurringUseCases({
    database: options.database,
  });
  const planned: PlannedEventUseCasePort = createPlannedEventUseCases({
    database: options.database,
  });
  return {
    createRecurringRule: (context, command) => recurring.createRule(context, command),
    updateRecurringRuleFuture: (context, command) => recurring.updateRuleFuture(context, command),
    endRecurringRule: (context, command) => recurring.endRule(context, command),
    overrideRecurringOccurrence: (context, command) => recurring.overrideOccurrence(context, command),
    cancelRecurringOccurrence: (context, command) => recurring.cancelOccurrence(context, command),
    realizeRecurringOccurrence: (context, command) => recurring.realizeOccurrence(context, command),
    createPlannedEvent: (context, command) => planned.create(context, command),
    updatePlannedEvent: (context, command) => planned.update(context, command),
    cancelPlannedEvent: (context, command) => planned.cancel(context, command),
  };
}

/** Lazy compatibility port; avoid opening a database while importing UI contracts. */
export const forecastMaintenanceUseCases: ForecastMaintenancePort = {
  createRecurringRule: (context, command) => createForecastMaintenanceUseCases().createRecurringRule(context, command),
  updateRecurringRuleFuture: (context, command) => createForecastMaintenanceUseCases().updateRecurringRuleFuture(context, command),
  endRecurringRule: (context, command) => createForecastMaintenanceUseCases().endRecurringRule(context, command),
  overrideRecurringOccurrence: (context, command) => createForecastMaintenanceUseCases().overrideRecurringOccurrence(context, command),
  cancelRecurringOccurrence: (context, command) => createForecastMaintenanceUseCases().cancelRecurringOccurrence(context, command),
  realizeRecurringOccurrence: (context, command) => createForecastMaintenanceUseCases().realizeRecurringOccurrence(context, command),
  createPlannedEvent: (context, command) => createForecastMaintenanceUseCases().createPlannedEvent(context, command),
  updatePlannedEvent: (context, command) => createForecastMaintenanceUseCases().updatePlannedEvent(context, command),
  cancelPlannedEvent: (context, command) => createForecastMaintenanceUseCases().cancelPlannedEvent(context, command),
};

export type {
  CancelPlannedEventCommand,
  CreatePlannedEventCommand,
  PlannedEventReadModel,
  UpdatePlannedEventCommand,
};
