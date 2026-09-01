"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  CategoryKind,
  CategoryStatus,
} from "@/modules/accounts-categories/contracts";
import { generateUuidV7 } from "@/lib/uuidv7";

export const CATEGORY_QUICK_EDIT_STATES = [
  "idle",
  "loading",
  "success",
  "error",
] as const;

export type CategoryQuickEditState =
  (typeof CATEGORY_QUICK_EDIT_STATES)[number];

/** The only category fields needed by this client control. */
export interface CategoryQuickEditCategory {
  id: string;
  name: string;
  kind: CategoryKind;
  status?: CategoryStatus;
}

/** Serializable editable command; tenant and immutable event fields stay out. */
export interface CategoryQuickEditCommand {
  commandId: string;
  financialEventId: string;
  categoryId: string | null;
}

export interface CategoryQuickEditActionError {
  code?: string;
  field?: string;
  message: string;
}

/** Result envelope accepted from the server action boundary. */
export type CategoryQuickEditActionResult =
  | { ok: true; value?: { categoryId?: string | null } }
  | { ok: false; error: CategoryQuickEditActionError };

/** Server Action-friendly function: its input and result are serializable. */
export type CategoryQuickEditAction = (
  command: CategoryQuickEditCommand,
) => Promise<CategoryQuickEditActionResult>;

export interface CategoryQuickEditProps {
  action: CategoryQuickEditAction;
  categories: readonly CategoryQuickEditCategory[];
  categoryId: string | null;
  financialEventId: string;
  kind: CategoryKind;
  currentCategory?: CategoryQuickEditCategory | null;
  disabled?: boolean;
  label?: string;
  className?: string;
  testId?: string;
  /** Called after the server confirms the update; useful for local rehydration. */
  onSuccess?: (result: Extract<CategoryQuickEditActionResult, { ok: true }>) => void;
  /** Defaults to true so summaries/list rows are re-read after a commit. */
  refreshOnSuccess?: boolean;
}

const GENERIC_ERROR_MESSAGE =
  "Não foi possível atualizar a categoria. Tente novamente.";

/**
 * Keeps active categories of the transaction kind and the current archived
 * category for historical context. Archived categories cannot be selected as
 * a new value.
 */
export function filterCategoryQuickEditOptions(
  categories: readonly CategoryQuickEditCategory[],
  kind: CategoryKind,
  currentCategoryId: string | null = null,
  currentCategory?: CategoryQuickEditCategory | null,
): CategoryQuickEditCategory[] {
  const options = new Map<string, CategoryQuickEditCategory>();

  for (const category of categories) {
    if (category.kind !== kind) {
      continue;
    }

    if (category.status === "ARCHIVED" && category.id !== currentCategoryId) {
      continue;
    }

    options.set(category.id, category);
  }

  if (
    currentCategory &&
    currentCategory.id === currentCategoryId &&
    currentCategory.kind === kind
  ) {
    options.set(currentCategory.id, currentCategory);
  }

  return [...options.values()];
}

export const filterActiveCategoryQuickEditOptions =
  filterCategoryQuickEditOptions;

function actionErrorMessage(error: CategoryQuickEditActionError): string {
  const message = error.message.trim();
  return message || GENERIC_ERROR_MESSAGE;
}

function FeedbackIcon({ state }: { state: CategoryQuickEditState }) {
  if (state === "loading") {
    return <Loader2 aria-hidden="true" className="size-4 animate-spin" />;
  }

  if (state === "success") {
    return <CheckCircle2 aria-hidden="true" className="size-4" />;
  }

  return <AlertCircle aria-hidden="true" className="size-4" />;
}

/**
 * Accessible category-only editor. The selection is local form state; the
 * server result is the only point at which success is shown.
 */
export function CategoryQuickEdit({
  action,
  categories,
  categoryId,
  className,
  currentCategory = null,
  disabled = false,
  financialEventId,
  kind,
  label = "Categoria",
  onSuccess,
  refreshOnSuccess = true,
  testId = "category-quick-edit",
}: CategoryQuickEditProps) {
  const router = useRouter();
  const [selectedCategoryId, setSelectedCategoryId] =
    React.useState<string | null>(categoryId);
  const [state, setState] = React.useState<CategoryQuickEditState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const inFlightRef = React.useRef(false);
  const attemptRef = React.useRef<{
    categoryId: string | null;
    commandId: string;
  } | null>(null);

  React.useEffect(() => {
    setSelectedCategoryId(categoryId);
    setState("idle");
    setErrorMessage(null);
    attemptRef.current = null;
  }, [categoryId, financialEventId, kind]);

  const options = React.useMemo(
    () =>
      filterCategoryQuickEditOptions(
        categories,
        kind,
        categoryId,
        currentCategory,
      ),
    [categories, categoryId, currentCategory, kind],
  );
  const selectedCategory = options.find(
    (category) => category.id === selectedCategoryId,
  );
  const selectedArchived = selectedCategory?.status === "ARCHIVED";
  const isDisabled = disabled || state === "loading";
  const selectId = `${testId}-select`;
  const descriptionId = `${testId}-description`;
  const historyId = `${testId}-history`;
  const canSubmit = !isDisabled;

  function handleCategoryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextCategoryId = event.currentTarget.value || null;
    setSelectedCategoryId(nextCategoryId);
    setState("idle");
    setErrorMessage(null);

    if (attemptRef.current?.categoryId !== nextCategoryId) {
      attemptRef.current = null;
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setState("loading");
    setErrorMessage(null);

    try {
      if (
        !attemptRef.current ||
        attemptRef.current.categoryId !== selectedCategoryId
      ) {
        attemptRef.current = {
          categoryId: selectedCategoryId,
          commandId: generateUuidV7(),
        };
      }

      const result = await action({
        categoryId: selectedCategoryId,
        commandId: attemptRef.current.commandId,
        financialEventId,
      });

      if (!result.ok) {
        setState("error");
        setErrorMessage(actionErrorMessage(result.error));
        return;
      }

      attemptRef.current = null;
      setState("success");
      onSuccess?.(result);
      if (refreshOnSuccess) {
        router.refresh();
      }
    } catch {
      setState("error");
      setErrorMessage(GENERIC_ERROR_MESSAGE);
    } finally {
      inFlightRef.current = false;
    }
  }

  const feedbackMessage =
    state === "loading"
      ? "Salvando categoria…"
      : state === "success"
        ? "Categoria atualizada."
        : state === "error"
          ? errorMessage ?? GENERIC_ERROR_MESSAGE
          : null;

  return (
    <form
      aria-busy={state === "loading"}
      className={cn("space-y-3", className)}
      data-testid={testId}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={selectId}>
          {label}
        </label>
        <p className="text-xs text-muted-foreground" id={descriptionId}>
          Escolha uma categoria compatível com o tipo do lançamento ou remova a classificação.
        </p>
        <select
          aria-describedby={
            selectedArchived
              ? `${descriptionId} ${historyId}`
              : descriptionId
          }
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`${testId}-select`}
          disabled={isDisabled}
          id={selectId}
          onChange={handleCategoryChange}
          value={selectedCategoryId ?? ""}
        >
          <option value="">Sem categoria</option>
          {options.map((category) => {
            const isArchived = category.status === "ARCHIVED";
            return (
              <option
                disabled={isArchived}
                key={category.id}
                value={category.id}
              >
                {category.name}
                {isArchived ? " (arquivada)" : ""}
              </option>
            );
          })}
        </select>
        {selectedArchived ? (
          <p className="text-xs text-muted-foreground" id={historyId}>
            A categoria atual está arquivada e aparece somente como histórico. Escolha outra ou “Sem categoria”.
          </p>
        ) : null}
      </div>

      {feedbackMessage ? (
        <p
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 text-sm",
            state === "error" ? "text-destructive" : "text-muted-foreground",
          )}
          data-testid={`${testId}-feedback`}
          role={state === "error" ? "alert" : "status"}
        >
          <FeedbackIcon state={state} />
          {feedbackMessage}
        </p>
      ) : null}

      <Button
        aria-busy={state === "loading"}
        className="w-full sm:w-auto"
        data-testid={`${testId}-submit`}
        disabled={!canSubmit}
        type="submit"
      >
        {state === "loading" ? "Salvando…" : state === "error" ? "Tentar novamente" : "Salvar categoria"}
      </Button>
    </form>
  );
}
