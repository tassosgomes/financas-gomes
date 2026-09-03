"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DomainForm, FormField } from "@/components/ui/form";
import type {
  CategoryKind,
  CategoryReadModel,
  AccountsCategoriesResult,
} from "@/modules/accounts-categories/contracts";
import {
  categoryKindSchema,
  categoryNameSchema,
  resourceIdSchema,
} from "@/modules/accounts-categories/validation";

/**
 * The form intentionally exposes only editable metadata. `commandId` and the
 * category ID are attached at the collection boundary, while the server
 * action validates the complete command again.
 */
const categoryFormSchema = z.object({
  name: categoryNameSchema,
  kind: categoryKindSchema,
  parentId: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    resourceIdSchema.nullable(),
  ),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export interface CategoryFormProps {
  category?: CategoryReadModel;
  /** Active root categories only; archived and second-level parents are never offered. */
  parentOptions: CategoryReadModel[];
  onCancel: () => void;
  onSubmit: (
    values: CategoryFormValues,
  ) => Promise<AccountsCategoriesResult<CategoryReadModel>> | AccountsCategoriesResult<CategoryReadModel>;
}

const CATEGORY_KIND_OPTIONS: ReadonlyArray<{
  value: CategoryKind;
  label: string;
}> = [
  { value: "EXPENSE", label: "Despesa" },
  { value: "INCOME", label: "Receita" },
];

function selectClassName() {
  return "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

function kindLabel(kind: CategoryKind): string {
  return kind === "EXPENSE" ? "Despesa" : "Receita";
}

interface CategoryFormFieldsProps {
  category?: CategoryReadModel;
  form: UseFormReturn<CategoryFormValues>;
  parentOptions: CategoryReadModel[];
}

function CategoryFormFields({
  category,
  form,
  parentOptions,
}: CategoryFormFieldsProps) {
  const selectedKind = useWatch({
    control: form.control,
    name: "kind",
  });
  const selectedParentId = useWatch({
    control: form.control,
    name: "parentId",
  });
  const isEditing = Boolean(category);
  const validParentOptions = parentOptions.filter(
    (parent) =>
      parent.status === "ACTIVE" &&
      parent.parentId === null &&
      parent.kind === selectedKind &&
      parent.id !== category?.id,
  );
  const selectedParentIsValid = validParentOptions.some(
    (parent) => parent.id === selectedParentId,
  );

  // Changing the kind can make a previously selected parent invalid. Clear it
  // in the form state as well as visually so the submitted command cannot
  // retain a stale cross-kind parent.
  useEffect(() => {
    if (selectedParentId && !selectedParentIsValid) {
      form.setValue("parentId", null, { shouldDirty: true });
    }
  }, [form, selectedParentId, selectedParentIsValid]);

  return (
    <>
      <FormField form={form} label="Nome da categoria" name="name">
        {(field) => (
          <input
            aria-describedby="name-error"
            aria-invalid={form.formState.errors.name ? true : undefined}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="category-name-input"
            id="name"
            placeholder="Ex.: Moradia"
            {...field}
          />
        )}
      </FormField>

      <FormField
        description={
          isEditing
            ? "O tipo não pode ser alterado depois que a categoria é criada."
            : "Use o mesmo tipo da categoria pai, quando houver."
        }
        form={form}
        label="Tipo"
        name="kind"
      >
        {(field) =>
          isEditing ? (
            <>
              <input
                {...field}
                aria-hidden="true"
                className="sr-only"
                data-testid="category-kind-input"
                id="kind-value"
                tabIndex={-1}
                type="hidden"
                value={category?.kind ?? selectedKind}
              />
              <div
                aria-describedby="kind-description"
                aria-label={`Tipo: ${kindLabel(category?.kind ?? selectedKind)}`}
                className="flex h-10 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground"
                data-testid="category-kind-readonly"
                id="kind"
                role="status"
              >
                {kindLabel(category?.kind ?? selectedKind)}
              </div>
            </>
          ) : (
            <select
              aria-describedby="kind-error"
              aria-invalid={form.formState.errors.kind ? true : undefined}
              className={selectClassName()}
              data-testid="category-kind-input"
              id="kind"
              {...field}
            >
              {CATEGORY_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )
        }
      </FormField>

      <FormField
        description="Categorias filhas só podem escolher um pai de primeiro nível. Categorias arquivadas não aparecem aqui."
        form={form}
        label="Categoria pai (opcional)"
        name="parentId"
      >
        {(field) => (
          <>
            <select
              aria-describedby="parentId-description parentId-depth-description parentId-error"
              aria-invalid={form.formState.errors.parentId ? true : undefined}
              className={selectClassName()}
              data-testid="category-parent-input"
              id="parentId"
              {...field}
              value={selectedParentIsValid ? selectedParentId ?? "" : ""}
            >
              <option value="">Sem categoria pai (categoria raiz)</option>
              {validParentOptions.map((parent) => (
                <option
                  data-level="1"
                  key={parent.id}
                  value={parent.id}
                >
                  {parent.name}
                </option>
              ))}
            </select>
            <p
              className="text-xs text-muted-foreground"
              data-testid="category-parent-depth-help"
              id="parentId-depth-description"
            >
              O segundo nível é o limite: categorias filhas não podem virar
              pai de uma nova categoria.
            </p>
          </>
        )}
      </FormField>
    </>
  );
}

/** Form used for both root categories and valid second-level subcategories. */
export function CategoryForm({
  category,
  parentOptions,
  onCancel,
  onSubmit,
}: CategoryFormProps) {
  const isEditing = Boolean(category);

  return (
    <section
      aria-labelledby="category-form-title"
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid={isEditing ? "category-form-edit" : "category-form-create"}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {isEditing ? "Editar categoria" : "Nova categoria"}
          </p>
          <h2 className="text-xl font-semibold tracking-tight" id="category-form-title">
            {isEditing
              ? "Atualize os dados da categoria"
              : "Cadastre uma categoria para organizar seus lançamentos"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Escolha se ela representa uma despesa ou uma receita e, se quiser,
            vincule-a a uma categoria pai.
          </p>
        </div>
        <Button
          aria-label="Fechar formulário de categoria"
          data-testid="category-form-cancel"
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
          <span className="sr-only">Fechar</span>
        </Button>
      </div>

      <DomainForm<CategoryFormValues>
        className="mt-6 space-y-5"
        defaultValues={{
          name: category?.name ?? "",
          kind: category?.kind ?? "EXPENSE",
          parentId: category?.parentId
            ? (category.parentId as CategoryFormValues["parentId"])
            : null,
        }}
        onSubmit={onSubmit}
        pendingLabel={isEditing ? "Salvando…" : "Criando…"}
        schema={categoryFormSchema}
        submitLabel={isEditing ? "Salvar alterações" : "Criar categoria"}
        testId="category-form"
      >
        {(form) => (
          <CategoryFormFields
            category={category}
            form={form}
            parentOptions={parentOptions}
          />
        )}
      </DomainForm>
    </section>
  );
}

export { categoryFormSchema };
