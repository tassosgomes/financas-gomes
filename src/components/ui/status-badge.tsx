import type { AccountStatus } from "@/modules/accounts-categories/contracts";

export interface StatusBadgeProps {
  status: AccountStatus;
  className?: string;
}

const STATUS_LABELS: Record<AccountStatus, string> = {
  ACTIVE: "Ativa",
  ARCHIVED: "Arquivada",
};

/** Shared status vocabulary for accounts and categories. */
export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const isActive = status === "ACTIVE";

  return (
    <span
      aria-label={`Status: ${STATUS_LABELS[status]}`}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        isActive
          ? "bg-emerald-100 text-emerald-800"
          : "bg-secondary text-muted-foreground"
      } ${className}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export const ResourceStatusBadge = StatusBadge;
