import { cn } from "@/lib/utils";
import type {
  ReviewableTransactionOrigin,
  TransactionReviewState,
  TransactionReviewSummaryReadModel,
  TransactionSource,
} from "@/modules/transactions/review-contracts";

const ORIGIN_LABELS: Record<ReviewableTransactionOrigin, string> = {
  MANUAL: "Manual",
  IMPORT: "Importado",
};

const REVIEW_STATE_LABELS: Record<TransactionReviewState, string> = {
  NEEDS_REVIEW: "Revisar",
  ORGANIZED: "Organizado",
  NOT_APPLICABLE: "Não aplicável",
};

export type ReviewBadgeTone = "attention" | "positive" | "neutral";

const REVIEW_BADGE_TONE_CLASS_NAMES: Record<ReviewBadgeTone, string> = {
  attention: "bg-amber-100 text-amber-900",
  positive: "bg-emerald-100 text-emerald-800",
  neutral: "bg-secondary text-secondary-foreground",
};

export interface ReviewBadgeProps {
  label: string;
  tone?: ReviewBadgeTone;
  testId?: string;
}

/** Small text-first badge: the visual treatment never replaces its label. */
export function ReviewBadge({
  label,
  tone = "neutral",
  testId,
}: ReviewBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        REVIEW_BADGE_TONE_CLASS_NAMES[tone],
      )}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

export interface TransactionReviewBadgesProps {
  /** Read-model origin; this component does not infer it from other fields. */
  origin: ReviewableTransactionOrigin;
  /** Read-model review state; the component does not calculate a new rule. */
  reviewState: TransactionReviewState;
  /** `null` is the explicit read-model representation of no category. */
  categoryId: string | null;
  className?: string;
  testId?: string;
}

/** Origin, review state and missing-category indicators for a review item. */
export function TransactionReviewBadges({
  categoryId,
  className,
  origin,
  reviewState,
  testId = "transaction-review-badges",
}: TransactionReviewBadgesProps) {
  const reviewTone: ReviewBadgeTone =
    reviewState === "NEEDS_REVIEW"
      ? "attention"
      : reviewState === "ORGANIZED"
        ? "positive"
        : "neutral";

  return (
    <ul
      aria-label="Indicadores da revisão"
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-testid={testId}
    >
      <li>
        <ReviewBadge
          label={ORIGIN_LABELS[origin]}
          testId={`${testId}-origin`}
        />
      </li>
      <li>
        <ReviewBadge
          label={REVIEW_STATE_LABELS[reviewState]}
          testId={`${testId}-status`}
          tone={reviewTone}
        />
      </li>
      {categoryId === null ? (
        <li>
          <ReviewBadge
            label="Sem categoria"
            testId={`${testId}-uncategorized`}
            tone="attention"
          />
        </li>
      ) : null}
    </ul>
  );
}

export interface SourceDetailsProps {
  /** The server-projected source contains only safe import-lineage fields. */
  source: TransactionSource;
  className?: string;
  testId?: string;
}

/** Read-only origin details shared by list/detail surfaces. */
export function SourceDetails({
  className,
  source,
  testId = "transaction-source-details",
}: SourceDetailsProps) {
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={cn("space-y-3 rounded-2xl border bg-card p-5 shadow-sm", className)}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold" id={`${testId}-title`}>
          Origem do lançamento
        </h2>
        <ReviewBadge
          label={ORIGIN_LABELS[source.origin]}
          testId={`${testId}-origin`}
        />
      </div>

      {source.origin === "IMPORT" ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Lote de importação</dt>
            <dd className="mt-1 break-all" data-testid={`${testId}-import-id`}>
              {source.import.importId}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Linha importada</dt>
            <dd className="mt-1" data-testid={`${testId}-row-number`}>
              {source.import.rowNumber}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Identificador externo</dt>
            <dd className="mt-1 break-all" data-testid={`${testId}-external-id`}>
              {source.import.externalId ?? "Não informado"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          Este lançamento foi criado manualmente.
        </p>
      )}
    </section>
  );
}

export interface ReviewSummaryProps
  extends Pick<TransactionReviewSummaryReadModel, "needsReviewCount"> {
  className?: string;
  testId?: string;
}

/** Summary display that reports the server-provided pending count verbatim. */
export function ReviewSummary({
  className,
  needsReviewCount,
  testId = "transaction-review-summary",
}: ReviewSummaryProps) {
  const countLabel =
    needsReviewCount === 1
      ? "lançamento para revisar"
      : "lançamentos para revisar";

  return (
    <section
      aria-labelledby={`${testId}-title`}
      className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}
      data-testid={testId}
    >
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Revisão
      </p>
      <h2 className="mt-1 text-lg font-semibold" id={`${testId}-title`}>
        Pendências de organização
      </h2>
      <p
        aria-live="polite"
        className="mt-3 text-sm text-muted-foreground"
        data-testid={`${testId}-count`}
      >
        <strong className="mr-1 text-2xl text-foreground">{needsReviewCount}</strong>
        {countLabel}
      </p>
    </section>
  );
}

