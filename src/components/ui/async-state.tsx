import { AlertCircle, CheckCircle2, Inbox, Loader2 } from "lucide-react";
import Link from "next/link";

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
  testId?: string;
}

/** Shared empty state for account and category collections. */
export function EmptyState({
  title,
  description,
  action,
  testId = "empty-state",
}: EmptyStateProps) {
  return (
    <section
      aria-label="Estado vazio"
      className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 py-10 text-center"
      data-testid={testId}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Inbox aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

export interface LoadingStateProps {
  label?: string;
  testId?: string;
}

/** Stable accessible loading state used while a collection is being read. */
export function LoadingState({
  label = "Carregando…",
  testId = "loading-state",
}: LoadingStateProps) {
  return (
    <div
      aria-live="polite"
      aria-label={label}
      className="flex min-h-56 items-center justify-center rounded-2xl border bg-card px-6 py-10 text-sm text-muted-foreground"
      data-testid={testId}
      role="status"
    >
      <span className="inline-flex items-center gap-2">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {label}
      </span>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  retryHref?: string;
  retryLabel?: string;
  children?: React.ReactNode;
  testId?: string;
}

/** Shared non-sensitive error state; infrastructure details stay server-side. */
export function ErrorState({
  title = "Não foi possível carregar os dados",
  message,
  retryHref,
  retryLabel = "Tentar novamente",
  children,
  testId = "error-state",
}: ErrorStateProps) {
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="rounded-2xl border border-destructive/30 bg-destructive/10 px-6 py-8"
      data-testid={testId}
      role="alert"
    >
      <div className="flex items-start gap-3 text-destructive">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="space-y-2">
          <h2 className="font-semibold" id={`${testId}-title`}>
            {title}
          </h2>
          <p className="text-sm leading-6">{message}</p>
          {retryHref ? (
            <Link
              className="inline-flex rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={retryHref}
            >
              {retryLabel}
            </Link>
          ) : null}
          {children ? <div className="mt-2">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}

export interface SuccessFeedbackProps {
  message: string;
  description?: string;
  testId?: string;
}

/**
 * Success feedback deliberately renders caller-provided copy only. Callers
 * should pass a stable confirmation and never a financial payload or secret.
 */
export function SuccessFeedback({
  message,
  description,
  testId = "success-feedback",
}: SuccessFeedbackProps) {
  return (
    <div
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      data-testid={testId}
      role="status"
    >
      <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{message}</p>
        {description ? <p className="mt-1 text-emerald-700">{description}</p> : null}
      </div>
    </div>
  );
}

export const EmptyCollectionState = EmptyState;
export const CollectionLoadingState = LoadingState;
export const CollectionErrorState = ErrorState;
