"use client";

import {
  Archive,
  ChevronLeft,
  Eye,
  EyeOff,
  FolderTree,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  CategoryForm,
  type CategoryFormValues,
} from "@/components/categories/category-form";
import { ArchiveConfirmation } from "@/components/ui/archive-confirmation";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SuccessFeedback,
} from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { DataTable, ResourceList } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  archiveCategoryAction,
  createCategoryAction,
  listCategoriesAction,
  updateCategoryAction,
} from "@/app/actions/categories";
import { generateUuidV7 } from "@/lib/uuidv7";
import type {
  CategoryKind,
  CategoryReadModel,
  CategoryStatus,
  S02Error,
  S02Result,
} from "@/modules/accounts-categories/contracts";
import { CATEGORIES_SETTINGS_ROUTE } from "@/modules/accounts-categories/routes";

type CategoryStatusView = Extract<CategoryStatus, "ACTIVE" | "ARCHIVED">;

export interface CategoriesScreenProps {
  initialCategories: CategoryReadModel[];
}

interface CategoryTreeEntry {
  category: CategoryReadModel;
  depth: 0 | 1;
}

const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  EXPENSE: "Despesa",
  INCOME: "Receita",
};

function safeUnexpectedError(): S02Error {
  return {
    code: "INVALID_COMMAND",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

function actionErrorMessage(error: S02Error): string {
  return error.message || "Não foi possível concluir a operação. Tente novamente.";
}

function categoryRowKey(entry: CategoryTreeEntry): string {
  return entry.category.id;
}

function kindLabel(kind: CategoryKind): string {
  return CATEGORY_KIND_LABELS[kind];
}

/**
 * The use case intentionally returns a flat read model. This projection is
 * kept in the UI so the same response can render an accessible hierarchy on
 * desktop and mobile without an additional request.
 */
function buildCategoryTree(categories: CategoryReadModel[]): CategoryTreeEntry[] {
  const childrenByParent = new Map<string, CategoryReadModel[]>();
  const roots: CategoryReadModel[] = [];
  const byId = new Map(categories.map((category) => [category.id, category]));

  for (const category of categories) {
    if (category.parentId && byId.has(category.parentId)) {
      const children = childrenByParent.get(category.parentId) ?? [];
      children.push(category);
      childrenByParent.set(category.parentId, children);
    } else {
      // A missing parent should not make a historical record disappear from
      // the list. The backend prevents this for new writes, but a defensive
      // fallback keeps the read model visible if old data is inconsistent.
      roots.push(category);
    }
  }

  const entries: CategoryTreeEntry[] = [];
  const visited = new Set<string>();

  function append(category: CategoryReadModel, depth: 0 | 1) {
    if (visited.has(category.id)) {
      return;
    }

    visited.add(category.id);
    entries.push({ category, depth });

    if (depth === 0) {
      const children = childrenByParent.get(category.id) ?? [];
      for (const child of children) {
        append(child, 1);
      }
    }
  }

  for (const root of roots) {
    append(root, 0);
  }

  // A cycle is invalid domain data, but surfacing an unvisited record is more
  // useful than silently dropping it from the settings screen.
  for (const category of categories) {
    append(category, category.parentId ? 1 : 0);
  }

  return entries;
}

function CategoryMeta({ entry }: { entry: CategoryTreeEntry }) {
  const { category, depth } = entry;

  return (
    <div
      className="flex min-w-0 items-start gap-3"
      data-testid={`category-meta-${category.id}`}
      style={depth === 1 ? { paddingLeft: "1.5rem" } : undefined}
    >
      <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
        {depth === 1 ? "└" : "●"}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium">
          {category.name}
          {depth === 1 ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Subcategoria
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">{kindLabel(category.kind)}</p>
      </div>
    </div>
  );
}

function CategoryActions({
  entry,
  onEdit,
  onArchive,
  disabled,
}: {
  entry: CategoryTreeEntry;
  onEdit: (category: CategoryReadModel) => void;
  onArchive: (category: CategoryReadModel) => Promise<void>;
  disabled: boolean;
}) {
  const { category } = entry;

  if (category.status === "ARCHIVED") {
    return <span className="text-xs text-muted-foreground">Somente leitura</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        aria-label={`Editar ${category.name}`}
        className="gap-2"
        data-testid={`category-edit-${category.id}`}
        disabled={disabled}
        onClick={() => onEdit(category)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Pencil aria-hidden="true" className="size-4" />
        <span className="sr-only sm:not-sr-only">Editar</span>
      </Button>
      <ArchiveConfirmation
        disabled={disabled}
        onConfirm={() => onArchive(category)}
        resourceLabel={`a categoria ${category.name}`}
        testId={`category-archive-${category.id}`}
      />
    </div>
  );
}

function CategoryMobileCard({
  entry,
  onEdit,
  onArchive,
  disabled,
}: {
  entry: CategoryTreeEntry;
  onEdit: (category: CategoryReadModel) => void;
  onArchive: (category: CategoryReadModel) => Promise<void>;
  disabled: boolean;
}) {
  const { category, depth } = entry;

  return (
    <article
      className="space-y-4"
      data-testid={`category-card-${category.id}`}
      style={depth === 1 ? { marginLeft: "1rem" } : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <CategoryMeta entry={entry} />
        <StatusBadge status={category.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Tipo</dt>
          <dd className="mt-1">{kindLabel(category.kind)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Nível</dt>
          <dd className="mt-1">{depth === 0 ? "Categoria" : "Subcategoria"}</dd>
        </div>
      </dl>
      <div className="flex justify-end border-t pt-3">
        <CategoryActions
          disabled={disabled}
          entry={entry}
          onArchive={onArchive}
          onEdit={onEdit}
        />
      </div>
    </article>
  );
}

/**
 * Interactive category collection. The first read is server-rendered by the
 * route; all mutations and explicit archived-list reads remain behind the T07
 * Server Actions and refresh this local tree after success.
 */
export function CategoriesScreen({ initialCategories }: CategoriesScreenProps) {
  const [status, setStatus] = useState<CategoryStatusView>("ACTIVE");
  const [categories, setCategories] = useState<CategoryReadModel[]>(initialCategories);
  const [isLoading, setIsLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<
    CategoryReadModel | undefined
  >();
  const [loadError, setLoadError] = useState<S02Error | null>(null);
  const [operationError, setOperationError] = useState<S02Error | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);

  async function loadCategories(nextStatus: CategoryStatusView = status) {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);
    setLoadError(null);

    try {
      const result = await listCategoriesAction({ status: nextStatus });
      if (requestId !== requestSequence.current) {
        return;
      }

      if (!result.ok) {
        setLoadError(result.error);
        return;
      }

      setCategories(result.value.items);
    } catch {
      if (requestId === requestSequence.current) {
        setLoadError(safeUnexpectedError());
      }
    } finally {
      if (requestId === requestSequence.current) {
        setIsLoading(false);
      }
    }
  }

  async function handleStatusChange(nextStatus: CategoryStatusView) {
    if (isLoading || nextStatus === status) {
      return;
    }

    setStatus(nextStatus);
    setSuccessMessage(null);
    await loadCategories(nextStatus);
  }

  function openCreateForm() {
    setEditingCategory(undefined);
    setOperationError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function openEditForm(category: CategoryReadModel) {
    setEditingCategory(category);
    setOperationError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingCategory(undefined);
  }

  async function handleFormSubmit(
    values: CategoryFormValues,
  ): Promise<S02Result<CategoryReadModel>> {
    setOperationError(null);
    setSuccessMessage(null);

    try {
      const result = editingCategory
        ? await updateCategoryAction({
            categoryId: editingCategory.id,
            commandId: generateUuidV7(),
            name: values.name,
            parentId: values.parentId,
          })
        : await createCategoryAction({
            commandId: generateUuidV7(),
            kind: values.kind,
            name: values.name,
            parentId: values.parentId,
          });

      if (!result.ok) {
        setOperationError(result.error);
        return result;
      }

      setSuccessMessage(editingCategory ? "Categoria atualizada." : "Categoria criada.");
      closeForm();
      await loadCategories(status);
      return result;
    } catch {
      const error = safeUnexpectedError();
      setOperationError(error);
      return { ok: false, error };
    }
  }

  async function handleArchive(category: CategoryReadModel): Promise<void> {
    setOperationError(null);
    setSuccessMessage(null);

    try {
      const result = await archiveCategoryAction({
        categoryId: category.id,
        commandId: generateUuidV7(),
      });

      if (!result.ok) {
        setOperationError(result.error);
        return;
      }

      setSuccessMessage(
        "Categoria arquivada. O registro continua disponível no histórico.",
      );
      await loadCategories(status);
    } catch {
      setOperationError(safeUnexpectedError());
    }
  }

  const isArchivedView = status === "ARCHIVED";
  const collectionLabel = isArchivedView
    ? "categorias arquivadas"
    : "categorias ativas";
  const entries = buildCategoryTree(categories);
  const activeRootCategories = categories.filter(
    (category) =>
      category.status === "ACTIVE" && category.parentId === null,
  );

  return (
    <section className="space-y-6" data-testid="categories-screen">
      <PageHeader
        action={
          <Button
            className="w-full gap-2 sm:w-auto"
            data-testid="categories-create-button"
            onClick={openCreateForm}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Nova categoria
          </Button>
        }
        description="Organize despesas e receitas com categorias e subcategorias de até dois níveis."
        eyebrow="Configurações financeiras"
        title="Categorias"
      />

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-foreground">
            <FolderTree aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="font-medium">
              {isArchivedView ? "Histórico de categorias" : "Categorias disponíveis"}
            </p>
            <p className="text-sm text-muted-foreground">
              {isArchivedView
                ? "Consulte categorias arquivadas sem alterar o histórico."
                : "Somente categorias ativas aparecem para novos lançamentos."}
            </p>
          </div>
        </div>
        <Button
          aria-pressed={isArchivedView}
          className="w-full gap-2 sm:w-auto"
          data-testid="categories-archived-toggle"
          disabled={isLoading}
          onClick={() =>
            void handleStatusChange(isArchivedView ? "ACTIVE" : "ARCHIVED")
          }
          type="button"
          variant="outline"
        >
          {isArchivedView ? (
            <>
              <ChevronLeft aria-hidden="true" className="size-4" />
              Voltar às ativas
            </>
          ) : (
            <>
              <Archive aria-hidden="true" className="size-4" />
              Ver arquivadas
            </>
          )}
        </Button>
      </div>

      <p
        className="rounded-xl border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground"
        data-testid="categories-hierarchy-help"
      >
        A árvore aceita uma categoria e suas subcategorias. O segundo nível é o
        limite para manter a organização simples.
      </p>

      {isFormOpen ? (
        <CategoryForm
          category={editingCategory}
          onCancel={closeForm}
          onSubmit={handleFormSubmit}
          parentOptions={activeRootCategories}
        />
      ) : null}

      {successMessage ? (
        <SuccessFeedback message={successMessage} testId="categories-success" />
      ) : null}

      {operationError ? (
        <ErrorState
          message={actionErrorMessage(operationError)}
          testId="categories-operation-error"
          title="Não foi possível concluir a operação"
        />
      ) : null}

      {isLoading ? (
        <LoadingState
          label={`Carregando ${collectionLabel}…`}
          testId="categories-loading"
        />
      ) : loadError ? (
        <ErrorState
          message={actionErrorMessage(loadError)}
          retryHref={CATEGORIES_SETTINGS_ROUTE}
          testId="categories-load-error"
        />
      ) : categories.length === 0 ? (
        <EmptyState
          action={
            isArchivedView ? undefined : (
              <Button className="gap-2" onClick={openCreateForm} type="button">
                <Plus aria-hidden="true" className="size-4" />
                Cadastrar primeira categoria
              </Button>
            )
          }
          description={
            isArchivedView
              ? "Categorias arquivadas ficam disponíveis aqui para preservar o histórico."
              : "Cadastre sua primeira categoria para organizar despesas e receitas."
          }
          testId="categories-empty"
          title={
            isArchivedView
              ? "Nenhuma categoria arquivada"
              : "Nenhuma categoria cadastrada"
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              caption={`Lista em árvore de ${collectionLabel}`}
              columns={[
                {
                  key: "name",
                  header: "Categoria",
                  render: (entry) => <CategoryMeta entry={entry} />,
                },
                {
                  key: "kind",
                  header: "Tipo",
                  render: (entry) => kindLabel(entry.category.kind),
                },
                {
                  key: "level",
                  header: "Nível",
                  render: (entry) =>
                    entry.depth === 0 ? "Categoria" : "Subcategoria",
                },
                {
                  key: "status",
                  header: "Status",
                  render: (entry) => <StatusBadge status={entry.category.status} />,
                },
                {
                  key: "actions",
                  header: "Ações",
                  className: "text-right",
                  render: (entry) => (
                    <CategoryActions
                      disabled={isLoading}
                      entry={entry}
                      onArchive={handleArchive}
                      onEdit={openEditForm}
                    />
                  ),
                },
              ]}
              getRowKey={categoryRowKey}
              rows={entries}
              testId="categories-table"
            />
          </div>

          <div className="md:hidden">
            <ResourceList
              getItemKey={categoryRowKey}
              items={entries}
              renderItem={(entry) => (
                <CategoryMobileCard
                  disabled={isLoading}
                  entry={entry}
                  onArchive={handleArchive}
                  onEdit={openEditForm}
                />
              )}
              testId="categories-list"
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>
          {categories.length === 1
            ? "1 categoria"
            : `${categories.length} categorias`} exibidas em {isArchivedView ? "arquivadas" : "ativas"}.
        </p>
        <Button
          aria-label="Atualizar lista de categorias"
          className="gap-2"
          data-testid="categories-refresh-button"
          disabled={isLoading}
          onClick={() => void loadCategories()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Atualizar
        </Button>
      </div>

      <p className="sr-only" data-testid="categories-view-description">
        {isArchivedView ? (
          <>
            <EyeOff aria-hidden="true" /> Exibindo apenas categorias arquivadas.
          </>
        ) : (
          <>
            <Eye aria-hidden="true" /> Exibindo apenas categorias ativas.
          </>
        )}
      </p>
    </section>
  );
}

