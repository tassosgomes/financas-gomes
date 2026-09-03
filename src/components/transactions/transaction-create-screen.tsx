"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  createExpenseAction,
  createIncomeAction,
} from "@/app/actions/transactions";
import { SuccessFeedback } from "@/components/ui/async-state";
import { buttonVariants } from "@/components/ui/button";
import type { ManualTransactionFormValues } from "@/modules/transactions/form-contract";
import type {
  ManualTransactionKind,
  ManualTransactionReadModel,
  TransactionResult,
} from "@/modules/transactions/contracts";
import {
  TRANSACTIONS_ROUTE,
  transactionCreateRoute,
} from "@/modules/transactions/routes";

import { TransactionForm } from "./transaction-form";
import {
  commandForTransactionAttempt,
  transactionCommandFingerprint,
  type TransactionCreateAttempt,
} from "./transaction-create-attempt";
import type {
  TransactionAccountOption,
  TransactionCategoryOption,
} from "./transaction-form";

export interface TransactionCreateScreenProps {
  accounts: readonly TransactionAccountOption[];
  categories: readonly TransactionCategoryOption[];
  initialKind: ManualTransactionKind;
  today?: string;
}

export { commandForTransactionAttempt, transactionCommandFingerprint };

function kindLabel(kind: ManualTransactionKind): string {
  return kind === "EXPENSE" ? "Despesa" : "Receita";
}

function createdDescription(transaction: ManualTransactionReadModel): string {
  const amount = transaction.amountCents;
  const integerPart = amount.length > 2 ? amount.slice(0, -2) : "0";
  const cents = amount.slice(-2).padStart(2, "0");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return `${transaction.description} · R$ ${grouped},${cents} · ${transaction.occurredOn}`;
}

/** Client island that owns only submit/retry state; reads stay server-side. */
export function TransactionCreateScreen({
  accounts,
  categories,
  initialKind,
  today,
}: TransactionCreateScreenProps) {
  const router = useRouter();
  const attempt = useRef<TransactionCreateAttempt | null>(null);
  const [created, setCreated] = useState<ManualTransactionReadModel | null>(null);

  async function handleSubmit(
    values: ManualTransactionFormValues,
  ): Promise<TransactionResult<unknown>> {
    setCreated(null);
    const command = commandForTransactionAttempt(values, attempt);
    const result =
      values.kind === "EXPENSE"
        ? await createExpenseAction(command)
        : await createIncomeAction(command);

    if (result.ok) {
      attempt.current = null;
      setCreated(result.value);
    }

    return result;
  }

  if (created) {
    return (
      <section
        aria-labelledby="transaction-created-title"
        className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
        data-testid="transaction-create-success"
      >
        <SuccessFeedback
          description={createdDescription(created)}
          message={`${kindLabel(created.kind)} registrada com sucesso.`}
          testId="transaction-created-feedback"
        />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold" id="transaction-created-title">
            Lançamento salvo
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            A listagem foi atualizada. Você pode conferir o lançamento ou
            registrar outro movimento.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link
            className={`${buttonVariants({ variant: "outline" })} w-full sm:w-auto`}
            href={transactionCreateRoute(created.kind)}
          >
            Adicionar outro
          </Link>
          <Link
            className={`${buttonVariants()} w-full sm:w-auto`}
            href={TRANSACTIONS_ROUTE}
          >
            Ver lançamentos
          </Link>
        </div>
      </section>
    );
  }

  return (
    <TransactionForm
      accounts={accounts}
      categories={categories}
      initialKind={initialKind}
      onCancel={() => router.push(TRANSACTIONS_ROUTE)}
      onSubmit={handleSubmit}
      testId="transaction-create-form"
      today={today}
    />
  );
}
