/** Drizzle schema entrypoint shared by Better Auth and domain modules. */
export {
  account,
  authSchema,
  betterAuthAccount,
  betterAuthSchema,
  betterAuthSession,
  betterAuthUser,
  betterAuthVerification,
  session,
  user,
  verification,
} from "@/modules/auth/schema";
export {
  householdInvites,
  householdMembers,
  households,
  protectedResources,
} from "./tenancy-schema";
export {
  accountStatusEnum,
  accountTypeEnum,
  accounts,
  applicationCommands,
  categories,
  categoryKindEnum,
  liquidityEnum,
  spendabilityEnum,
} from "./accounts-categories-schema";
export {
  accountEntries,
  accountEntryStatusEnum,
  financialEventKindEnum,
  financialEventOriginEnum,
  financialEvents,
  financialEventStatusEnum,
} from "./financial-events-schema";
export {
  transactionImportItems,
  transactionImportSourceColumnsEnum,
  transactionImportStaging,
  transactionImportStatusEnum,
  transactionImports,
} from "./transaction-imports-schema";
export {
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  installmentPlans,
  installmentStatusEnum,
  installments,
} from "./credit-cards-schema";
export {
  holidays,
  plannedEventStatusEnum,
  plannedEvents,
  recurringDayRuleEnum,
  recurringFrequencyEnum,
  recurringOccurrenceStatusEnum,
  recurringOccurrences,
  recurringRules,
} from "./recurring-schema";
export { spendableSettings } from "./spendable-schema";
export {
  budgetAllocationRules,
  BUDGET_COMMAND_OPERATIONS,
  budgetMovementKindEnum,
  budgetMovementSourceKindEnum,
  budgetMovements,
  budgetStatusEnum,
  budgets,
} from "./budgets-schema";

import { betterAuthSchema } from "@/modules/auth/schema";
import {
  accounts,
  applicationCommands,
  categories,
} from "./accounts-categories-schema";
import {
  householdInvites,
  householdMembers,
  households,
  protectedResources,
} from "./tenancy-schema";
import { accountEntries, financialEvents } from "./financial-events-schema";
import {
  transactionImportItems,
  transactionImportStaging,
  transactionImports,
} from "./transaction-imports-schema";
import {
  creditCardBillingRules,
  creditCardPurchases,
  creditCards,
  installmentPlans,
  installments,
} from "./credit-cards-schema";
import {
  holidays,
  plannedEvents,
  recurringOccurrences,
  recurringRules,
} from "./recurring-schema";
import { spendableSettings } from "./spendable-schema";
import {
  budgetAllocationRules,
  budgetMovements,
  budgets,
} from "./budgets-schema";

export const schema = {
  ...betterAuthSchema,
  households,
  householdMembers,
  householdInvites,
  protectedResources,
  accounts,
  categories,
  applicationCommands,
  financialEvents,
  accountEntries,
  transactionImports,
  transactionImportStaging,
  transactionImportItems,
  creditCards,
  creditCardBillingRules,
  creditCardPurchases,
  installmentPlans,
  installments,
  recurringRules,
  recurringOccurrences,
  holidays,
  plannedEvents,
  spendableSettings,
  budgets,
  budgetMovements,
  budgetAllocationRules,
} as const;

export default schema;
