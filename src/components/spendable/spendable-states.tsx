import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/async-state";
import { toSpendableErrorViewModel } from "@/modules/spendable/ui-contracts";

export interface SpendableLoadingStateProps {
  label?: string;
  testId?: string;
}

export function SpendableLoadingState({
  label = "Carregando disponibilidade para gastar…",
  testId = "spendable-loading-state",
}: SpendableLoadingStateProps) {
  return <LoadingState label={label} testId={testId} />;
}

export interface SpendableEmptyStateProps {
  title?: string;
  description?: string;
  testId?: string;
}

export function SpendableEmptyState({
  description =
    "Quando houver dados financeiros disponíveis para o período, o valor aparecerá aqui.",
  testId = "spendable-empty-state",
  title = "Nenhuma disponibilidade para exibir",
}: SpendableEmptyStateProps) {
  return (
    <EmptyState
      description={description}
      testId={testId}
      title={title}
    />
  );
}

export interface SpendableErrorStateProps {
  error?: unknown;
  retryHref?: string;
  testId?: string;
}

export function SpendableErrorState({
  error,
  retryHref,
  testId = "spendable-error-state",
}: SpendableErrorStateProps) {
  const safeError = toSpendableErrorViewModel(error);
  return (
    <ErrorState
      message={safeError.message}
      retryHref={safeError.retryable ? retryHref : undefined}
      testId={testId}
      title="Não foi possível carregar a disponibilidade"
    />
  );
}

export const SpendableLoading = SpendableLoadingState;
export const SpendableEmpty = SpendableEmptyState;
export const SpendableError = SpendableErrorState;

