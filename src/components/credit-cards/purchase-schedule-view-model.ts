import type {
  CreditCardInstallmentReadModel,
  CreditCardPurchaseReadModel,
} from "@/modules/credit-cards/contracts";

import type { CreditCardScheduleViewModel } from "./ui-contracts";

/**
 * Adapts the T06 purchase read model to the T11 schedule projection. Every
 * amount, row count, cycle and due date is copied from the server result;
 * this adapter deliberately does not calculate installment values.
 *
 * This module intentionally has no client directive so Server Components can
 * build the same serializable view model as the purchase client island.
 */
export function purchaseScheduleViewModel(
  purchase: CreditCardPurchaseReadModel,
): CreditCardScheduleViewModel {
  const items = purchase.schedule.installments.map(
    (item: CreditCardInstallmentReadModel) => ({
      id: item.id,
      purchaseId: item.purchaseId,
      installmentNumber: item.sequence,
      installmentCount: purchase.schedule.installmentCount,
      amountCents: item.amountCents,
      billingCycle: item.billingCycle,
      dueOn: item.billingDueOnOverride ?? item.billingDueOn,
      status: item.status,
      state:
        item.entryStatus === "POSTED"
          ? ("CONFIRMED" as const)
          : ("PROJECTED" as const),
    }),
  );

  return {
    purchaseId: purchase.schedule.purchaseId,
    totalAmountCents: purchase.schedule.totalAmountCents,
    installmentCount: purchase.schedule.installmentCount,
    items,
  };
}
