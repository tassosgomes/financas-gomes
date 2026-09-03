const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;
const INVALID_LABEL = "—";

const GENERATED_AT_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatDecimalPtBr(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/** Formats a byte count for export summaries (not monetary values). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return INVALID_LABEL;
  if (bytes === 0) return "0 B";

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    FILE_SIZE_UNITS.length - 1,
  );
  const scaled = bytes / 1024 ** unitIndex;
  const unit = FILE_SIZE_UNITS[unitIndex];

  if (unitIndex === 0) return `${bytes} B`;

  const label =
    scaled >= 10 || Number.isInteger(scaled)
      ? String(Math.round(scaled))
      : formatDecimalPtBr(scaled);

  return `${label} ${unit}`;
}

/** Formats a dataset row total with pt-BR grouping and Portuguese pluralization. */
export function formatRowCount(count: number): string {
  if (!Number.isInteger(count) || count < 0) return INVALID_LABEL;

  const formatted = count.toLocaleString("pt-BR");
  if (count === 1) return "1 linha";
  return `${formatted} linhas`;
}

/**
 * Formats an ISO-8601 UTC instant (`…Z`) for display. The input is parsed as
 * UTC and rendered with a fixed timezone so server locale cannot shift the date.
 */
export function formatGeneratedAt(isoUtc: string): string {
  const instant = new Date(isoUtc);
  if (Number.isNaN(instant.getTime())) return isoUtc;
  return GENERATED_AT_FORMATTER.format(instant);
}
