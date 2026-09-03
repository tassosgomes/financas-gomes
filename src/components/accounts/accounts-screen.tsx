"use client";

import {
  Archive,
  ChevronLeft,
  Eye,
  EyeOff,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useRef, useState } from "react";

import { AccountForm, type AccountFormValues } from "@/components/accounts/account-form";
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
  archiveAccountAction,
  createAccountAction,
  listAccountsAction,
  updateAccountAction,
} from "@/app/actions/accounts";
import { generateUuidV7 } from "@/lib/uuidv7";
import type {
  AccountReadModel,
  AccountStatus,
  AccountType,
  Liquidity,
  AccountsCategoriesError,
  AccountsCategoriesResult,
  Spendability,
} from "@/modules/accounts-categories/contracts";
import { ACCOUNTS_ROUTE } from "@/modules/accounts-categories/routes";

type AccountStatusView = Extract<AccountStatus, "ACTIVE" | "ARCHIVED">;

export interface AccountsScreenProps {
  initialAccounts: AccountReadModel[];
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: "Conta corrente",
  SAVINGS: "Poupança",
  CASH: "Dinheiro",
  CREDIT_CARD: "Cartão de crédito",
  BENEFIT: "Benefícios",
  INVESTMENT: "Investimentos",
  OTHER: "Outra",
};

const SPENDABILITY_LABELS: Record<Spendability, string> = {
  GENERAL: "Uso geral",
  RESTRICTED: "Restrita",
  EXCLUDED: "Excluída",
};

const LIQUIDITY_LABELS: Record<Liquidity, string> = {
  IMMEDIATE: "Imediata",
  LIQUID: "Líquida",
  RESTRICTED: "Restrita",
};

function safeUnexpectedError(): AccountsCategoriesError {
  return {
    code: "INVALID_COMMAND",
    message: "Não foi possível concluir a operação. Tente novamente.",
  };
}

function actionErrorMessage(error: AccountsCategoriesError): string {
  return error.message || "Não foi possível concluir a operação. Tente novamente.";
}

function formatAccountType(type: AccountType): string {
  return ACCOUNT_TYPE_LABELS[type];
}

function accountRowKey(account: AccountReadModel): string {
  return account.id;
}

function AccountActions({
  account,
  onEdit,
  onArchive,
  disabled,
}: {
  account: AccountReadModel;
  onEdit: (account: AccountReadModel) => void;
  onArchive: (account: AccountReadModel) => Promise<void>;
  disabled: boolean;
}) {
  if (account.status === "ARCHIVED") {
    return <span className="text-xs text-muted-foreground">Somente leitura</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        aria-label={`Editar ${account.name}`}
        className="gap-2"
        data-testid={`account-edit-${account.id}`}
        disabled={disabled}
        onClick={() => onEdit(account)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Pencil aria-hidden="true" className="size-4" />
        <span className="sr-only sm:not-sr-only">Editar</span>
      </Button>
      <ArchiveConfirmation
        disabled={disabled}
        onConfirm={() => onArchive(account)}
        resourceLabel={`a conta ${account.name}`}
        testId={`account-archive-${account.id}`}
      />
    </div>
  );
}

function AccountMeta({ account }: { account: AccountReadModel }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{account.name}</p>
      <p className="text-xs text-muted-foreground">{formatAccountType(account.type)}</p>
    </div>
  );
}

function AccountMobileCard({
  account,
  onEdit,
  onArchive,
  disabled,
}: {
  account: AccountReadModel;
  onEdit: (account: AccountReadModel) => void;
  onArchive: (account: AccountReadModel) => Promise<void>;
  disabled: boolean;
}) {
  return (
    <article className="space-y-4" data-testid={`account-card-${account.id}`}>
      <div className="flex items-start justify-between gap-4">
        <AccountMeta account={account} />
        <StatusBadge status={account.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Disponibilidade</dt>
          <dd className="mt-1">{SPENDABILITY_LABELS[account.spendability]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Liquidez</dt>
          <dd className="mt-1">{LIQUIDITY_LABELS[account.liquidity]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Patrimônio</dt>
          <dd className="mt-1">
            {account.includeInNetWorth ? "Incluída" : "Excluída"}
          </dd>
        </div>
      </dl>
      <div className="flex justify-end border-t pt-3">
        <AccountActions
          account={account}
          disabled={disabled}
          onArchive={onArchive}
          onEdit={onEdit}
        />
      </div>
    </article>
  );
}

/**
 * Interactive accounts collection. Reads start in the Server Component and
 * every mutation goes through the T07 Server Actions, keeping the household
 * context on the server and updating the visible collection after success.
 */
export function AccountsScreen({ initialAccounts }: AccountsScreenProps) {
  const [status, setStatus] = useState<AccountStatusView>("ACTIVE");
  const [accounts, setAccounts] = useState<AccountReadModel[]>(initialAccounts);
  const [isLoading, setIsLoading] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountReadModel | undefined>();
  const [loadError, setLoadError] = useState<AccountsCategoriesError | null>(null);
  const [operationError, setOperationError] = useState<AccountsCategoriesError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);

  async function loadAccounts(nextStatus: AccountStatusView = status) {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);
    setLoadError(null);

    try {
      const result = await listAccountsAction({ status: nextStatus });
      if (requestId !== requestSequence.current) {
        return;
      }

      if (!result.ok) {
        setLoadError(result.error);
        return;
      }

      setAccounts(result.value.items);
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

  async function handleStatusChange(nextStatus: AccountStatusView) {
    if (isLoading || nextStatus === status) {
      return;
    }

    setStatus(nextStatus);
    setSuccessMessage(null);
    await loadAccounts(nextStatus);
  }

  function openCreateForm() {
    setEditingAccount(undefined);
    setOperationError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function openEditForm(account: AccountReadModel) {
    setEditingAccount(account);
    setOperationError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingAccount(undefined);
  }

  async function handleFormSubmit(values: AccountFormValues): Promise<AccountsCategoriesResult<AccountReadModel>> {
    setOperationError(null);
    setSuccessMessage(null);

    try {
      const result = editingAccount
        ? await updateAccountAction({
            name: values.name,
            spendability: values.spendability,
            liquidity: values.liquidity,
            includeInNetWorth: values.includeInNetWorth,
            accountId: editingAccount.id,
            commandId: generateUuidV7(),
          })
        : await createAccountAction({
            ...values,
            commandId: generateUuidV7(),
          });

      if (!result.ok) {
        setOperationError(result.error);
        return result;
      }

      setSuccessMessage(editingAccount ? "Conta atualizada." : "Conta criada.");
      closeForm();
      await loadAccounts(status);
      return result;
    } catch {
      const error = safeUnexpectedError();
      setOperationError(error);
      return { ok: false, error };
    }
  }

  async function handleArchive(account: AccountReadModel): Promise<void> {
    setOperationError(null);
    setSuccessMessage(null);

    try {
      const result = await archiveAccountAction({
        accountId: account.id,
        commandId: generateUuidV7(),
      });

      if (!result.ok) {
        setOperationError(result.error);
        return;
      }

      setSuccessMessage("Conta arquivada. O registro continua disponível no histórico.");
      await loadAccounts(status);
    } catch {
      setOperationError(safeUnexpectedError());
    }
  }

  const isArchivedView = status === "ARCHIVED";
  const collectionLabel = isArchivedView ? "contas arquivadas" : "contas ativas";

  return (
    <section className="space-y-6" data-testid="accounts-screen">
      <PageHeader
        action={
          <Button
            className="w-full gap-2 sm:w-auto"
            data-testid="accounts-create-button"
            onClick={openCreateForm}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Nova conta
          </Button>
        }
        description="Cadastre as contas que serão usadas nos próximos fluxos financeiros, sem misturar saldo ou movimentações aqui."
        eyebrow="Estrutura financeira"
        title="Contas"
      />

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-foreground">
            <Landmark aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="font-medium">{isArchivedView ? "Histórico de contas" : "Contas disponíveis"}</p>
            <p className="text-sm text-muted-foreground">
              {isArchivedView
                ? "Consulte contas arquivadas sem alterar o histórico."
                : "Somente contas ativas aparecem para novos fluxos."}
            </p>
          </div>
        </div>
        <Button
          aria-pressed={isArchivedView}
          className="w-full gap-2 sm:w-auto"
          data-testid="accounts-archived-toggle"
          disabled={isLoading}
          onClick={() => void handleStatusChange(isArchivedView ? "ACTIVE" : "ARCHIVED")}
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

      {isFormOpen ? (
        <AccountForm
          account={editingAccount}
          onCancel={closeForm}
          onSubmit={handleFormSubmit}
        />
      ) : null}

      {successMessage ? (
        <SuccessFeedback
          message={successMessage}
          testId="accounts-success"
        />
      ) : null}

      {operationError ? (
        <ErrorState
          message={actionErrorMessage(operationError)}
          testId="accounts-operation-error"
          title="Não foi possível concluir a operação"
        />
      ) : null}

      {isLoading ? (
        <LoadingState
          label={`Carregando ${collectionLabel}…`}
          testId="accounts-loading"
        />
      ) : loadError ? (
        <ErrorState
          message={actionErrorMessage(loadError)}
          retryHref={ACCOUNTS_ROUTE}
          testId="accounts-load-error"
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          action={
            isArchivedView ? undefined : (
              <Button className="gap-2" onClick={openCreateForm} type="button">
                <Plus aria-hidden="true" className="size-4" />
                Cadastrar primeira conta
              </Button>
            )
          }
          description={
            isArchivedView
              ? "Contas arquivadas ficam disponíveis aqui para preservar o histórico."
              : "Cadastre sua primeira conta para começar a organizar o espaço financeiro."
          }
          testId="accounts-empty"
          title={isArchivedView ? "Nenhuma conta arquivada" : "Nenhuma conta cadastrada"}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              caption={`Lista de ${collectionLabel}`}
              getRowKey={accountRowKey}
              rows={accounts}
              testId="accounts-table"
              columns={[
                {
                  key: "name",
                  header: "Conta",
                  render: (account) => <AccountMeta account={account} />,
                },
                {
                  key: "spendability",
                  header: "Disponibilidade",
                  render: (account) => SPENDABILITY_LABELS[account.spendability],
                },
                {
                  key: "type",
                  header: "Tipo",
                  render: (account) => formatAccountType(account.type),
                },
                {
                  key: "liquidity",
                  header: "Liquidez",
                  render: (account) => LIQUIDITY_LABELS[account.liquidity],
                },
                {
                  key: "net-worth",
                  header: "Patrimônio",
                  render: (account) =>
                    account.includeInNetWorth ? "Incluída" : "Excluída",
                },
                {
                  key: "status",
                  header: "Status",
                  render: (account) => <StatusBadge status={account.status} />,
                },
                {
                  key: "actions",
                  header: "Ações",
                  className: "text-right",
                  render: (account) => (
                    <AccountActions
                      account={account}
                      disabled={isLoading}
                      onArchive={handleArchive}
                      onEdit={openEditForm}
                    />
                  ),
                },
              ]}
            />
          </div>

          <div className="md:hidden">
            <ResourceList
              getItemKey={accountRowKey}
              items={accounts}
              renderItem={(account) => (
                <AccountMobileCard
                  account={account}
                  disabled={isLoading}
                  onArchive={handleArchive}
                  onEdit={openEditForm}
                />
              )}
              testId="accounts-list"
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>
          {accounts.length === 1 ? "1 conta" : `${accounts.length} contas`} exibidas em {isArchivedView ? "arquivadas" : "ativas"}.
        </p>
        <Button
          aria-label="Atualizar lista de contas"
          className="gap-2"
          data-testid="accounts-refresh-button"
          disabled={isLoading}
          onClick={() => void loadAccounts()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Atualizar
        </Button>
      </div>

      <p className="sr-only" data-testid="accounts-view-description">
        {isArchivedView ? (
          <>
            <EyeOff aria-hidden="true" /> Exibindo apenas contas arquivadas.
          </>
        ) : (
          <>
            <Eye aria-hidden="true" /> Exibindo apenas contas ativas.
          </>
        )}
      </p>
    </section>
  );
}
