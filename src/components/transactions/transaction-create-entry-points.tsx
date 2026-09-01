import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ManualTransactionKind } from "@/modules/transactions/contracts";
import { transactionCreateRoute } from "@/modules/transactions/routes";

export interface TransactionCreateEntryPointsProps {
  activeKind?: ManualTransactionKind;
  className?: string;
}

/** Direct, labelled entry points for the two manual transaction intentions. */
export function TransactionCreateEntryPoints({
  activeKind,
  className,
}: TransactionCreateEntryPointsProps) {
  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      data-testid="transaction-create-entry-points"
    >
      <Link
        className={buttonVariants({
          variant: activeKind === "EXPENSE" ? "default" : "outline",
        })}
        data-testid="add-expense"
        href={transactionCreateRoute("EXPENSE")}
      >
        Adicionar despesa
      </Link>
      <Link
        className={buttonVariants({
          variant: activeKind === "INCOME" ? "default" : "outline",
        })}
        data-testid="add-income"
        href={transactionCreateRoute("INCOME")}
      >
        Adicionar receita
      </Link>
    </div>
  );
}

export const TransactionCreateActions = TransactionCreateEntryPoints;
