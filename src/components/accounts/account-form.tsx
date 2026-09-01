"use client";

import { X } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { S02Form, S02FormField } from "@/components/ui/form";
import type {
  AccountReadModel,
  AccountType,
  Liquidity,
  S02Result,
  Spendability,
} from "@/modules/accounts-categories/contracts";
import {
  accountNameSchema,
  accountTypeSchema,
  liquiditySchema,
  spendabilitySchema,
} from "@/modules/accounts-categories/validation";

const accountFormSchema = z.object({
  name: accountNameSchema,
  type: accountTypeSchema,
  spendability: spendabilitySchema,
  liquidity: liquiditySchema,
  includeInNetWorth: z.boolean(),
});

export type AccountFormValues = z.infer<typeof accountFormSchema>;

export interface AccountFormProps {
  account?: AccountReadModel;
  onCancel: () => void;
  onSubmit: (
    values: AccountFormValues,
  ) => Promise<S02Result<AccountReadModel>> | S02Result<AccountReadModel>;
}

const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{
  value: AccountType;
  label: string;
}> = [
  { value: "CHECKING", label: "Conta corrente" },
  { value: "SAVINGS", label: "Poupança" },
  { value: "CASH", label: "Dinheiro" },
  { value: "CREDIT_CARD", label: "Cartão de crédito" },
  { value: "BENEFIT", label: "Benefícios" },
  { value: "INVESTMENT", label: "Investimentos" },
  { value: "OTHER", label: "Outra" },
];

const SPENDABILITY_OPTIONS: ReadonlyArray<{
  value: Spendability;
  label: string;
}> = [
  { value: "GENERAL", label: "Uso geral" },
  { value: "RESTRICTED", label: "Restrita" },
  { value: "EXCLUDED", label: "Excluída" },
];

const LIQUIDITY_OPTIONS: ReadonlyArray<{
  value: Liquidity;
  label: string;
}> = [
  { value: "IMMEDIATE", label: "Imediata" },
  { value: "LIQUID", label: "Líquida" },
  { value: "RESTRICTED", label: "Restrita" },
];

function selectClassName() {
  return "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

/**
 * Account metadata form. Command IDs and account IDs are deliberately
 * generated/attached by the collection boundary, so the user only edits
 * fields that belong to the S02 UI contract.
 */
export function AccountForm({ account, onCancel, onSubmit }: AccountFormProps) {
  const isEditing = Boolean(account);

  return (
    <section
      aria-labelledby="account-form-title"
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      data-testid={isEditing ? "account-form-edit" : "account-form-create"}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {isEditing ? "Editar conta" : "Nova conta"}
          </p>
          <h2 className="text-xl font-semibold tracking-tight" id="account-form-title">
            {isEditing ? "Atualize os dados da conta" : "Cadastre sua primeira conta"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Saldo e movimentações serão configurados nos fluxos financeiros próprios.
          </p>
        </div>
        <Button
          aria-label="Fechar formulário de conta"
          data-testid="account-form-cancel"
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
          <span className="sr-only">Fechar</span>
        </Button>
      </div>

      <S02Form<AccountFormValues>
        className="mt-6 space-y-5"
        defaultValues={{
          name: account?.name ?? "",
          type: account?.type ?? "CHECKING",
          spendability: account?.spendability ?? "GENERAL",
          liquidity: account?.liquidity ?? "IMMEDIATE",
          includeInNetWorth: account?.includeInNetWorth ?? true,
        }}
        onSubmit={onSubmit}
        pendingLabel={isEditing ? "Salvando…" : "Criando…"}
        schema={accountFormSchema}
        submitLabel={isEditing ? "Salvar alterações" : "Criar conta"}
        testId="account-form"
      >
        {(form) => (
          <>
            <S02FormField form={form} label="Nome da conta" name="name">
              {(field) => (
                <input
                  aria-describedby="name-error"
                  aria-invalid={form.formState.errors.name ? true : undefined}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="account-name-input"
                  id="name"
                  {...field}
                />
              )}
            </S02FormField>

            <div className="grid gap-5 sm:grid-cols-2">
              <S02FormField
                description={isEditing ? "O tipo é definido no cadastro e não pode ser alterado." : undefined}
                form={form}
                label="Tipo"
                name="type"
              >
                {(field) => (
                  <select
                    aria-describedby={isEditing ? "type-description type-error" : "type-error"}
                    aria-invalid={form.formState.errors.type ? true : undefined}
                    className={selectClassName()}
                    data-testid="account-type-input"
                    defaultValue={account?.type ?? "CHECKING"}
                    disabled={isEditing}
                    id="type"
                    {...field}
                  >
                    {ACCOUNT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </S02FormField>

              <S02FormField
                description="Como os próximos fluxos devem considerar este recurso."
                form={form}
                label="Disponibilidade"
                name="spendability"
              >
                {(field) => (
                  <select
                    aria-describedby="spendability-description spendability-error"
                    aria-invalid={form.formState.errors.spendability ? true : undefined}
                    className={selectClassName()}
                    data-testid="account-spendability-input"
                    defaultValue={account?.spendability ?? "GENERAL"}
                    id="spendability"
                    {...field}
                  >
                    {SPENDABILITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </S02FormField>

              <S02FormField
                description="Indica a facilidade de uso do recurso."
                form={form}
                label="Liquidez"
                name="liquidity"
              >
                {(field) => (
                  <select
                    aria-describedby="liquidity-description liquidity-error"
                    aria-invalid={form.formState.errors.liquidity ? true : undefined}
                    className={selectClassName()}
                    data-testid="account-liquidity-input"
                    defaultValue={account?.liquidity ?? "IMMEDIATE"}
                    id="liquidity"
                    {...field}
                  >
                    {LIQUIDITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </S02FormField>
            </div>

            <S02FormField
              description="A conta poderá compor o patrimônio quando esse cálculo existir."
              form={form}
              label="Patrimônio"
              name="includeInNetWorth"
            >
              {(field) => (
                <label className="flex min-h-10 items-center gap-3 rounded-md border bg-background px-3 text-sm">
                  <input
                    aria-describedby="includeInNetWorth-description"
                    aria-invalid={form.formState.errors.includeInNetWorth ? true : undefined}
                    className="size-4 accent-primary"
                    data-testid="account-include-in-net-worth-input"
                    defaultChecked={account?.includeInNetWorth ?? true}
                    id="includeInNetWorth"
                    type="checkbox"
                    {...field}
                  />
                  <span>Incluir esta conta no patrimônio</span>
                </label>
              )}
            </S02FormField>
          </>
        )}
      </S02Form>
    </section>
  );
}
