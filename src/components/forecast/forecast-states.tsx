import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/async-state";
import { toForecastErrorViewModel } from "@/modules/forecast/ui-contracts";

export interface ForecastLoadingStateProps {
  label?: string;
  testId?: string;
}

export function ForecastLoadingState({
  label = "Carregando fluxo futuro…",
  testId = "forecast-loading-state",
}: ForecastLoadingStateProps) {
  return <LoadingState label={label} testId={testId} />;
}

export interface ForecastEmptyStateProps {
  title?: string;
  description?: string;
  testId?: string;
}

export function ForecastEmptyState({
  description = "Não há compromissos conhecidos para os dias consultados.",
  testId = "forecast-empty-state",
  title = "Nenhum compromisso no período",
}: ForecastEmptyStateProps) {
  return (
    <EmptyState
      description={description}
      testId={testId}
      title={title}
    />
  );
}

export interface ForecastErrorStateProps {
  error?: unknown;
  retryHref?: string;
  testId?: string;
}

export function ForecastErrorState({
  error,
  retryHref,
  testId = "forecast-error-state",
}: ForecastErrorStateProps) {
  const safeError = toForecastErrorViewModel(error);
  return (
    <ErrorState
      message={safeError.message}
      retryHref={safeError.retryable ? retryHref : undefined}
      testId={testId}
    />
  );
}

export const ForecastLoading = ForecastLoadingState;
export const ForecastEmpty = ForecastEmptyState;
export const ForecastError = ForecastErrorState;

