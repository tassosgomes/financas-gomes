import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/async-state";
import {
  OVERVIEW_TEST_IDS,
  toOverviewErrorViewModel,
} from "@/modules/overview/ui-contracts";

export interface OverviewLoadingStateProps {
  label?: string;
  testId?: string;
}

export function OverviewLoadingState({
  label = "Carregando visão geral…",
  testId = OVERVIEW_TEST_IDS.blockLoading,
}: OverviewLoadingStateProps) {
  return <LoadingState label={label} testId={testId} />;
}

export interface OverviewEmptyStateProps {
  title?: string;
  description?: string;
  testId?: string;
}

export function OverviewEmptyState({
  description = "Quando houver dados para este bloco, eles aparecerão aqui.",
  testId = OVERVIEW_TEST_IDS.blockEmpty,
  title = "Nada para exibir neste bloco",
}: OverviewEmptyStateProps) {
  return (
    <EmptyState
      description={description}
      testId={testId}
      title={title}
    />
  );
}

export interface OverviewErrorStateProps {
  error?: unknown;
  retryHref?: string;
  testId?: string;
  title?: string;
}

export function OverviewErrorState({
  error,
  retryHref,
  testId = OVERVIEW_TEST_IDS.blockError,
  title = "Não foi possível carregar este bloco",
}: OverviewErrorStateProps) {
  const safeError = toOverviewErrorViewModel(error);
  return (
    <ErrorState
      message={safeError.message}
      retryHref={safeError.retryable ? retryHref : undefined}
      testId={testId}
      title={title}
    />
  );
}
