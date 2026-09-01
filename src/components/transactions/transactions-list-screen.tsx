import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarRange,
  FileUp,
  Filter,
  Plus,
  RotateCcw,
} from "lucide-react";

import { DataTable, ResourceList } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import type { CategoryQuickEditAction } from "./category-quick-edit";
import {
  TransactionReviewListScreen,
  type TransactionReviewListScreenProps,
} from "./transaction-review-list-screen";
import {
  parseReviewQuery,
  type ReviewQuery,
  type ReviewQueryInput,
} from "./transaction-review-query";
import type {
  AccountReadModel,
  CategoryReadModel,
} from "@/modules/accounts-categories/contracts";
import type {
  ListManualTransactionsQuery,
  ManualTransactionListItemReadModel,
} from "@/modules/transactions/contracts";
import {
  projectTransactionReview,
  type TransactionListItemReadModel,
} from "@/modules/transactions/review-contracts";
import {
  transactionCreateRoute,
  TRANSACTION_IMPORT_ROUTE,
  TRANSACTIONS_ROUTE,
} from "@/modules/transactions/routes";

import {
  formatSignedCents,
  formatTransactionDate,
  hasActiveTransactionFilters,
  transactionDetailHref,
  UNCATEGORIZED_FILTER_VALUE,
} from "./transaction-listing-utils";

interface LegacyTransactionsListScreenProps {
  initialTransactions: ManualTransactionListItemReadModel[];
  accounts: AccountReadModel[];
  categories: CategoryReadModel[];
  query: ListManualTransactionsQuery;
  hadInvalidFilters?: boolean;
}

/**
 * S03 keeps this component's original props for regression coverage while
 * S05 can pass its richer list/summary/page contract through the same route.
 * The explicit `reviewMode` flag is useful for an empty S05 page where there
 * is no row from which to infer the read-model version.
 */
export type TransactionsListScreenProps = Omit<
  LegacyTransactionsListScreenProps,
  "initialTransactions" | "accounts" | "categories" | "query"
> & {
  initialTransactions:
    | readonly ManualTransactionListItemReadModel[]
    | readonly TransactionListItemReadModel[];
  accounts: readonly AccountReadModel[];
  categories: readonly CategoryReadModel[];
  query: ListManualTransactionsQuery | ReviewQuery;
  summary?: TransactionReviewListScreenProps["summary"];
  pageInfo?: TransactionReviewListScreenProps["pageInfo"];
  updateAction?: CategoryQuickEditAction;
  reviewMode?: boolean;
};

export interface TransactionsReadErrorProps {
  message?: string;
  retryHref?: string;
}

const DEFAULT_READ_ERROR =
  "Não foi possível carregar os lançamentos. Tente novamente.";

function displayCategory(category: CategoryReadModel | null): string {
  if (!category) {
    return "Sem categoria";
  }
  return category.parentId ? `↳ ${category.name}` : category.name;
}

function kindLabel(kind: ManualTransactionListItemReadModel["kind"]): string {
  return kind === "INCOME" ? "Receita" : "Despesa";
}

function kindIcon(kind: ManualTransactionListItemReadModel["kind"]) {
  return kind === "INCOME" ? (
    <ArrowUpRight aria-hidden="true" className="size-4" />
  ) : (
    <ArrowDownLeft aria-hidden="true" className="size-4" />
  );
}

function kindClassName(kind: ManualTransactionListItemReadModel["kind"]): string {
  return kind === "INCOME"
    ? "bg-emerald-100 text-emerald-800"
    : "bg-rose-100 text-rose-800";
}

function statusLabel(
  status: ManualTransactionListItemReadModel["status"],
): string {
  return status === "CANCELLED" ? "Cancelado" : "Publicado";
}

function TransactionKindBadge({
  kind,
}: {
  kind: ManualTransactionListItemReadModel["kind"];
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${kindClassName(kind)}`}
      data-testid={`transaction-kind-${kind.toLowerCase()}`}
    >
      {kindIcon(kind)}
      {kindLabel(kind)}
    </span>
  );
}

function TransactionStatusBadge({
  status,
}: {
  status: ManualTransactionListItemReadModel["status"];
}) {
  const cancelled = status === "CANCELLED";
  return (
    <span
      aria-label={`Status: ${statusLabel(status)}`}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        cancelled
          ? "bg-amber-100 text-amber-900"
          : "bg-emerald-100 text-emerald-800"
      }`}
      data-testid={`transaction-status-${status.toLowerCase()}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function signedAmountClassName(
  transaction: ManualTransactionListItemReadModel,
): string {
  if (transaction.status === "CANCELLED") {
    return "text-muted-foreground";
  }
  return transaction.entry.amountCents.startsWith("-")
    ? "text-rose-700"
    : "text-emerald-700";
}

function TransactionAmount({
  transaction,
}: {
  transaction: ManualTransactionListItemReadModel;
}) {
  return (
    <span
      className={`whitespace-nowrap font-semibold ${signedAmountClassName(transaction)} ${
        transaction.status === "CANCELLED" ? "line-through decoration-amber-700/60" : ""
      }`}
      data-testid={`transaction-amount-${transaction.id}`}
    >
      {formatSignedCents(transaction.entry.amountCents)}
    </span>
  );
}

function TransactionDetailLink({
  transaction,
  query,
}: {
  transaction: ManualTransactionListItemReadModel;
  query: ListManualTransactionsQuery;
}) {
  return (
    <Link
      aria-label={`Abrir lançamento ${transaction.description}`}
      className="inline-flex rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`transaction-detail-${transaction.id}`}
      href={transactionDetailHref(transaction.id, query)}
    >
      Ver lançamento
    </Link>
  );
}

function TransactionTable({
  transactions,
  query,
}: {
  transactions: ManualTransactionListItemReadModel[];
  query: ListManualTransactionsQuery;
}) {
  return (
    <div className="hidden md:block">
      <DataTable
        caption="Lançamentos manuais"
        columns={[
          {
            key: "occurredOn",
            header: "Data",
            render: (transaction) => (
              <time dateTime={transaction.occurredOn}>
                {formatTransactionDate(transaction.occurredOn)}
              </time>
            ),
          },
          {
            key: "description",
            header: "Descrição",
            className: "min-w-44",
            render: (transaction) => (
              <div className="space-y-1">
                <Link
                  aria-label={`Abrir lançamento ${transaction.description}`}
                  className={`font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    transaction.status === "CANCELLED"
                      ? "text-muted-foreground"
                      : ""
                  }`}
                  data-testid={`transaction-description-${transaction.id}`}
                  href={transactionDetailHref(transaction.id, query)}
                >
                  {transaction.description}
                </Link>
                <div className="text-xs text-muted-foreground">
                  Origem manual
                </div>
              </div>
            ),
          },
          {
            key: "kind",
            header: "Tipo",
            render: (transaction) => <TransactionKindBadge kind={transaction.kind} />,
          },
          {
            key: "category",
            header: "Categoria",
            render: (transaction) => displayCategory(transaction.category),
          },
          {
            key: "account",
            header: "Conta",
            render: (transaction) => transaction.account.name,
          },
          {
            key: "amount",
            header: "Valor",
            className: "text-right",
            render: (transaction) => (
              <TransactionAmount transaction={transaction} />
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (transaction) => (
              <TransactionStatusBadge status={transaction.status} />
            ),
          },
        ]}
        getRowKey={(transaction) => transaction.id}
        rows={transactions}
        testId="transactions-table"
      />
    </div>
  );
}

function TransactionMobileCard({
  transaction,
  query,
}: {
  transaction: ManualTransactionListItemReadModel;
  query: ListManualTransactionsQuery;
}) {
  return (
    <article
      className={`space-y-4 ${transaction.status === "CANCELLED" ? "opacity-80" : ""}`}
      data-testid={`transaction-card-${transaction.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link
            aria-label={`Abrir lançamento ${transaction.description}`}
            className="block truncate font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={transactionDetailHref(transaction.id, query)}
          >
            {transaction.description}
          </Link>
          <time
            className="block text-xs text-muted-foreground"
            dateTime={transaction.occurredOn}
          >
            {formatTransactionDate(transaction.occurredOn)}
          </time>
        </div>
        <TransactionAmount transaction={transaction} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TransactionKindBadge kind={transaction.kind} />
        <TransactionStatusBadge status={transaction.status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Conta</dt>
          <dd className="mt-1 truncate">{transaction.account.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Categoria</dt>
          <dd className="mt-1 truncate">{displayCategory(transaction.category)}</dd>
        </div>
      </dl>

      <div className="flex justify-end border-t pt-3">
        <TransactionDetailLink query={query} transaction={transaction} />
      </div>
    </article>
  );
}

function TransactionMobileList({
  transactions,
  query,
}: {
  transactions: ManualTransactionListItemReadModel[];
  query: ListManualTransactionsQuery;
}) {
  return (
    <div className="md:hidden">
      <ResourceList
        getItemKey={(transaction) => transaction.id}
        items={transactions}
        renderItem={(transaction) => (
          <TransactionMobileCard query={query} transaction={transaction} />
        )}
        testId="transactions-mobile-list"
      />
    </div>
  );
}

function ActionLink({
  children,
  href,
  testId,
  variant = "default",
}: {
  children: React.ReactNode;
  href: string;
  testId?: string;
  variant?: "default" | "outline";
}) {
  return (
    <Link
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        variant === "outline"
          ? "border border-input bg-background hover:bg-accent"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      }`}
      data-testid={testId}
      href={href}
    >
      {children}
    </Link>
  );
}

function FiltersForm({
  accounts,
  categories,
  query,
}: {
  accounts: AccountReadModel[];
  categories: CategoryReadModel[];
  query: ListManualTransactionsQuery;
}) {
  const selectedCategory =
    query.categoryId === null
      ? UNCATEGORIZED_FILTER_VALUE
      : query.categoryId ?? "";

  return (
    <section
      aria-labelledby="transactions-filters-title"
      className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      data-testid="transactions-filters"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Filter aria-hidden="true" className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold" id="transactions-filters-title">
            Filtrar lançamentos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use apenas os filtros necessários para encontrar um registro.
          </p>
        </div>
      </div>

      <form action={TRANSACTIONS_ROUTE} className="mt-5 space-y-4" method="get">
        <input name="origin" type="hidden" value="MANUAL" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-from">
              De
            </label>
            <input
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={query.from ?? ""}
              id="transactions-from"
              name="from"
              type="date"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-to">
              Até
            </label>
            <input
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={query.to ?? ""}
              id="transactions-to"
              name="to"
              type="date"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-account">
              Conta
            </label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={query.accountId ?? ""}
              id="transactions-account"
              name="accountId"
            >
              <option value="">Todas as contas</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.status === "ARCHIVED" ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-category">
              Categoria
            </label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={selectedCategory}
              id="transactions-category"
              name="categoryId"
            >
              <option value="">Todas as categorias</option>
              <option value={UNCATEGORIZED_FILTER_VALUE}>Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {displayCategory(category)}
                  {category.status === "ARCHIVED" ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-kind">
              Tipo
            </label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={query.kind ?? ""}
              id="transactions-kind"
              name="kind"
            >
              <option value="">Receitas e despesas</option>
              <option value="INCOME">Receitas</option>
              <option value="EXPENSE">Despesas</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-status">
              Status
            </label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={query.status ?? "ALL"}
              id="transactions-status"
              name="status"
            >
              <option value="ALL">Todos os status</option>
              <option value="POSTED">Publicados</option>
              <option value="CANCELLED">Cancelados</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarRange aria-hidden="true" className="size-4" />
            A origem manual já está aplicada nesta tela.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="gap-2" type="submit">
              <Filter aria-hidden="true" className="size-4" />
              Aplicar filtros
            </Button>
            {hasActiveTransactionFilters(query) ? (
              <ActionLink href={TRANSACTIONS_ROUTE} variant="outline">
                <RotateCcw aria-hidden="true" className="size-4" />
                Limpar filtros
              </ActionLink>
            ) : null}
          </div>
        </div>
      </form>
    </section>
  );
}

function EmptyTransactionsState({
  hasFilters,
}: {
  hasFilters: boolean;
}) {
  if (hasFilters) {
    return (
      <EmptyState
        action={
          <ActionLink href={TRANSACTIONS_ROUTE} variant="outline">
            <RotateCcw aria-hidden="true" className="size-4" />
            Limpar filtros
          </ActionLink>
        }
        description="Nenhum lançamento corresponde aos filtros atuais. Limpe os filtros para consultar todo o histórico."
        testId="transactions-empty-filter-state"
        title="Nenhum lançamento encontrado"
      />
    );
  }

  return (
    <EmptyState
      action={
        <div className="flex flex-col gap-2 sm:flex-row">
          <ActionLink
            href={transactionCreateRoute("INCOME")}
            testId="transactions-empty-income-cta"
          >
            <Plus aria-hidden="true" className="size-4" />
            Adicionar receita
          </ActionLink>
          <ActionLink
            href={transactionCreateRoute("EXPENSE")}
            testId="transactions-empty-expense-cta"
            variant="outline"
          >
            <Plus aria-hidden="true" className="size-4" />
            Adicionar despesa
          </ActionLink>
        </div>
      }
      description="Registre sua primeira receita ou despesa para começar a acompanhar o movimento da conta."
      testId="transactions-empty-state"
      title="Ainda não há lançamentos"
    />
  );
}

function NoAccountsNotice() {
  return (
    <aside
      className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950"
      data-testid="transactions-no-accounts"
    >
      <p className="font-medium">Cadastre uma conta antes do primeiro lançamento</p>
      <p className="mt-1 text-sm leading-6 text-amber-900/80">
        Todo lançamento precisa indicar onde o dinheiro entrou ou saiu.
      </p>
      <ActionLink href="/accounts" variant="outline">
        Ir para contas
      </ActionLink>
    </aside>
  );
}

function NoCategoriesNotice() {
  return (
    <aside
      className="rounded-2xl border bg-card px-5 py-4 text-sm"
      data-testid="transactions-no-categories"
    >
      <p className="font-medium">Nenhuma categoria cadastrada</p>
      <p className="mt-1 leading-6 text-muted-foreground">
        Categoria é opcional, mas ajuda a entender seus lançamentos.
      </p>
      <Link
        className="mt-3 inline-flex rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="/settings/categories"
      >
        Gerenciar categorias
      </Link>
    </aside>
  );
}

export function TransactionsReadError({
  message = DEFAULT_READ_ERROR,
  retryHref = TRANSACTIONS_ROUTE,
}: TransactionsReadErrorProps) {
  return (
    <section className="space-y-6" data-testid="transactions-route-error">
      <PageHeader
        description="Consulte os lançamentos manuais do seu espaço financeiro."
        eyebrow="Movimentações"
        title="Lançamentos"
      />
      <ErrorState
        message={message}
        retryHref={retryHref}
        testId="transactions-load-error"
      />
    </section>
  );
}

/**
 * Server-rendered collection. URL forms and links carry the only navigation
 * state, so refreshing or opening a detail can restore the same filters.
 */
function LegacyTransactionsListScreen({
  initialTransactions,
  accounts,
  categories,
  query,
  hadInvalidFilters = false,
}: LegacyTransactionsListScreenProps) {
  const hasFilters = hasActiveTransactionFilters(query);

  return (
    <section className="space-y-6" data-testid="transactions-route">
      <PageHeader
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <ActionLink
              href={TRANSACTION_IMPORT_ROUTE}
              testId="transactions-import-csv"
              variant="outline"
            >
              <FileUp aria-hidden="true" className="size-4" />
              Importar CSV
            </ActionLink>
            <ActionLink
              href={transactionCreateRoute("INCOME")}
              testId="transactions-add-income"
            >
              <Plus aria-hidden="true" className="size-4" />
              Adicionar receita
            </ActionLink>
            <ActionLink
              href={transactionCreateRoute("EXPENSE")}
              testId="transactions-add-expense"
              variant="outline"
            >
              <Plus aria-hidden="true" className="size-4" />
              Adicionar despesa
            </ActionLink>
          </div>
        }
        description="Veja receitas e despesas manuais em ordem de data, com filtros simples para encontrar o que importa."
        eyebrow="Movimentações"
        title="Lançamentos"
      />

      {hadInvalidFilters ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          data-testid="transactions-invalid-filters"
          role="status"
        >
          Alguns filtros da URL eram inválidos e foram ignorados.
        </p>
      ) : null}

      <FiltersForm accounts={accounts} categories={categories} query={query} />

      {accounts.length === 0 ? <NoAccountsNotice /> : null}
      {categories.length === 0 ? <NoCategoriesNotice /> : null}

      {initialTransactions.length === 0 ? (
        <EmptyTransactionsState hasFilters={hasFilters} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="transactions-count">
            {initialTransactions.length === 1
              ? "1 lançamento"
              : `${initialTransactions.length} lançamentos`}
          </p>
          <TransactionTable query={query} transactions={initialTransactions} />
          <TransactionMobileList
            query={query}
            transactions={initialTransactions}
          />
        </>
      )}
    </section>
  );
}

function isReviewListItem(
  value: ManualTransactionListItemReadModel | TransactionListItemReadModel,
): value is TransactionListItemReadModel {
  return (
    "source" in value &&
    "reviewState" in value &&
    "reviewReason" in value &&
    "needsReview" in value
  );
}

function toReviewListItem(
  value: ManualTransactionListItemReadModel | TransactionListItemReadModel,
): TransactionListItemReadModel {
  if (isReviewListItem(value)) {
    return value;
  }

  return {
    ...value,
    source: { origin: "MANUAL", import: null },
    ...projectTransactionReview(value.status, value.categoryId),
  };
}

/**
 * Shared route surface for S03 and S05. Once T06 supplies the review reads,
 * callers opt into `reviewMode` (or pass a summary/pageInfo/action) and the
 * richer queue is rendered without changing the existing S03 entry points.
 */
export function TransactionsListScreen(props: TransactionsListScreenProps) {
  const isReviewMode =
    props.reviewMode === true ||
    props.summary !== undefined ||
    props.pageInfo !== undefined ||
    props.updateAction !== undefined ||
    props.initialTransactions.some(isReviewListItem);

  if (isReviewMode) {
    const reviewQuery = parseReviewQuery(props.query as ReviewQueryInput);
    return (
      <TransactionReviewListScreen
        accounts={props.accounts}
        categories={props.categories}
        hadInvalidFilters={props.hadInvalidFilters}
        initialTransactions={props.initialTransactions.map(toReviewListItem)}
        pageInfo={props.pageInfo}
        query={reviewQuery}
        summary={props.summary}
        updateAction={props.updateAction}
      />
    );
  }

  return (
    <LegacyTransactionsListScreen
      accounts={props.accounts as AccountReadModel[]}
      categories={props.categories as CategoryReadModel[]}
      hadInvalidFilters={props.hadInvalidFilters}
      initialTransactions={
        props.initialTransactions as ManualTransactionListItemReadModel[]
      }
      query={props.query as ListManualTransactionsQuery}
    />
  );
}
