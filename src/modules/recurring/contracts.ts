import type {
  RecurrenceDayRule,
  RecurrenceFrequency,
  RecurringOccurrenceStatus,
} from "@/modules/recurrences/contracts";

/** S07 command allow-list already installed by T02's application_commands. */
export const RECURRING_RULE_CREATE_OPERATION = "recurring_rule.create" as const;
export const RECURRING_RULE_UPDATE_FUTURE_OPERATION =
  "recurring_rule.update_future" as const;
export const RECURRING_RULE_END_OPERATION = "recurring_rule.end" as const;
export const RECURRING_OCCURRENCE_OVERRIDE_OPERATION =
  "recurring_occurrence.override" as const;
export const RECURRING_OCCURRENCE_CANCEL_OPERATION =
  "recurring_occurrence.cancel" as const;
export const RECURRING_OCCURRENCE_REALIZE_OPERATION =
  "recurring_occurrence.realize" as const;

export const RECURRING_OPERATIONS = [
  RECURRING_RULE_CREATE_OPERATION,
  RECURRING_RULE_UPDATE_FUTURE_OPERATION,
  RECURRING_RULE_END_OPERATION,
  RECURRING_OCCURRENCE_OVERRIDE_OPERATION,
  RECURRING_OCCURRENCE_CANCEL_OPERATION,
  RECURRING_OCCURRENCE_REALIZE_OPERATION,
] as const;
export type RecurringOperation = (typeof RECURRING_OPERATIONS)[number];

export interface CreateRecurringRuleCommand {
  commandId: string;
  accountId?: string | null;
  categoryId?: string | null;
  kind: "EXPENSE" | "INCOME";
  amountCents: string;
  description: string;
  frequency: RecurrenceFrequency;
  dayRule: RecurrenceDayRule;
  dayOfMonth?: number | null;
  startOn: string;
  endOn?: string | null;
  includeInConservativeForecast?: boolean;
}

export interface UpdateRecurringRuleFutureCommand {
  commandId: string;
  recurringRuleId: string;
  effectiveFrom: string;
  accountId?: string | null;
  categoryId?: string | null;
  kind?: "EXPENSE" | "INCOME";
  amountCents?: string;
  description?: string;
  frequency?: RecurrenceFrequency;
  dayRule?: RecurrenceDayRule;
  dayOfMonth?: number | null;
  startOn?: string;
  endOn?: string | null;
  includeInConservativeForecast?: boolean;
}

export interface EndRecurringRuleCommand {
  commandId: string;
  recurringRuleId: string;
  endOn: string;
}

export interface OverrideRecurringOccurrenceCommand {
  commandId: string;
  recurringRuleId: string;
  occurrenceKey: string;
  amountCents?: string;
  expectedOn?: string;
}

export interface CancelRecurringOccurrenceCommand {
  commandId: string;
  recurringRuleId: string;
  occurrenceKey: string;
}

export interface RealizeRecurringOccurrenceCommand {
  commandId: string;
  recurringRuleId: string;
  occurrenceKey: string;
  financialEventId: string;
  isPartial?: boolean;
}

export interface RecurringRuleReadModel {
  id: string;
  householdId: string;
  accountId: string | null;
  categoryId: string | null;
  kind: "EXPENSE" | "INCOME";
  amountCents: string;
  description: string;
  frequency: RecurrenceFrequency;
  dayRule: RecurrenceDayRule;
  dayOfMonth: number | null;
  startOn: string;
  endOn: string | null;
  includeInConservativeForecast: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringOccurrenceReadModel {
  id: string;
  householdId: string;
  recurringRuleId: string;
  occurrenceKey: string;
  status: RecurringOccurrenceStatus;
  amountCents: string | null;
  expectedOn: string | null;
  financialEventId: string | null;
  isPartial: boolean;
  createdAt: string;
  updatedAt: string;
}

export const RECURRING_ERROR_CODES = [
  "INVALID_COMMAND",
  "INVALID_COMMAND_ID",
  "INVALID_AMOUNT",
  "INVALID_DATE",
  "INVALID_RULE",
  "INVALID_RULE_RANGE",
  "INVALID_OCCURRENCE",
  "RULE_NOT_FOUND",
  "RULE_ALREADY_ENDED",
  "OCCURRENCE_NOT_FOUND",
  "OCCURRENCE_ALREADY_REALIZED",
  "COMMAND_ID_REUSED",
  "TENANT_RESOURCE_NOT_FOUND",
  "CONFLICT",
] as const;
export type RecurringErrorCode = (typeof RECURRING_ERROR_CODES)[number];

export interface RecurringError {
  code: RecurringErrorCode;
  message: string;
  field?: string;
}

export type RecurringResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RecurringError };

export class RecurringCommandError extends Error {
  readonly code: RecurringErrorCode;
  readonly field?: string;

  constructor(code: RecurringErrorCode, message: string, field?: string) {
    super(message);
    this.name = "RecurringCommandError";
    this.code = code;
    this.field = field;
  }
}

export type RecurringRuleCommand =
  | CreateRecurringRuleCommand
  | UpdateRecurringRuleFutureCommand
  | EndRecurringRuleCommand;
