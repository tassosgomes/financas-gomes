"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarRange,
  FileUp,
  Filter,
  Plus,
  RotateCcw,
} from "lucide-react";

import {
  CategoryQuickEdit,
  type CategoryQuickEditAction,
  type CategoryQuickEditActionResult,
  type CategoryQuickEditCategory,
} from "./category-quick-edit";
import { TransactionReviewBadges, ReviewSummary } from "./transaction-review-badges";
import { reviewQueryHref, type ReviewQuery } from "./transaction-review-query";
import {
  formatSignedCents,
  formatTransactionDate,
} from "./transaction-listing-formatters";
import { DataTable, ResourceList } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import type { AccountReadModel, CategoryReadModel } from "@/modules/accounts-categories/contracts";
import type {
  TransactionListItemReadModel,
  TransactionListPageInfo,
  TransactionReviewSummaryReadModel,
} from "@/modules/transactions/review-contracts";
import { transactionCreateRoute, TRANSACTION_IMPORT_ROUTE, TRANSACTIONS_ROUTE } from "@/modules/transactions/routes";

export interface TransactionReviewListScreenProps {
  initialTransactions: readonly TransactionListItemReadModel[];
  accounts: readonly AccountReadModel[];
  categories: readonly CategoryReadModel[];
  query: ReviewQuery;
  summary?: TransactionReviewSummaryReadModel | null;
  pageInfo?: TransactionListPageInfo | null;
  hadInvalidFilters?: boolean;
  /** Optional Server Action supplied by T06; no client fetch is created here. */
  updateAction?: CategoryQuickEditAction;
}

export interface TransactionReviewReadErrorProps {
  message?: string;
  retryHref?: string;
}

const DEFAULT_READ_ERROR = "Não foi possível carregar os lançamentos. Tente novamente.";
const UNCATEGORIZED_FILTER_VALUE = "__none";

function categoryLabel(category: CategoryReadModel | null): string {
  if (!category) return "Sem categoria";
  return category.parentId ? `↳ ${category.name}` : category.name;
}

function kindLabel(kind: TransactionListItemReadModel["kind"]): string {
  return kind === "INCOME" ? "Receita" : "Despesa";
}

function kindClassName(kind: TransactionListItemReadModel["kind"]): string {
  return kind === "INCOME"
    ? "bg-emerald-100 text-emerald-800"
    : "bg-rose-100 text-rose-800";
}

function KindBadge({ kind }: { kind: TransactionListItemReadModel["kind"] }) {
  const Icon = kind === "INCOME" ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      aria-label={`Tipo: ${kindLabel(kind)}`}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${kindClassName(kind)}`}
      data-testid={`review-kind-${kind.toLowerCase()}`}
    >
      <Icon aria-hidden="true" className="size-4" />
      {kindLabel(kind)}
    </span>
  );
}

function statusLabel(status: TransactionListItemReadModel["status"]): string {
  return status === "CANCELLED" ? "Cancelado" : "Publicado";
}

function StatusBadge({ status }: { status: TransactionListItemReadModel["status"] }) {
  return (
    <span
      aria-label={`Status: ${statusLabel(status)}`}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        status === "CANCELLED" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"
      }`}
      data-testid={`review-status-${status.toLowerCase()}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function TransactionAmount({ transaction }: { transaction: TransactionListItemReadModel }) {
  const cancelled = transaction.status === "CANCELLED";
  return (
    <span
      className={`whitespace-nowrap font-semibold ${
        cancelled
          ? "text-muted-foreground line-through decoration-amber-700/60"
          : transaction.entry.amountCents.startsWith("-")
            ? "text-rose-700"
            : "text-emerald-700"
      }`}
      data-testid={`review-amount-${transaction.id}`}
    >
      {formatSignedCents(transaction.entry.amountCents)}
    </span>
  );
}

function quickEditCategories(categories: readonly CategoryReadModel[]): CategoryQuickEditCategory[] {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    kind: category.kind,
    status: category.status,
  }));
}

/** Applies only a confirmed category transition to the server summary. */
export function reviewCountAfterCategoryEdit(
  currentCount: number,
  transaction: Pick<
    TransactionListItemReadModel,
    "categoryId" | "needsReview" | "status"
  >,
  nextCategoryId: string | null | undefined,
): number {
  if (
    nextCategoryId === undefined ||
    nextCategoryId === transaction.categoryId
  ) {
    return currentCount;
  }

  const wasPending = transaction.needsReview;
  const isPending = transaction.status === "POSTED" && nextCategoryId === null;
  if (wasPending === isPending) {
    return currentCount;
  }

  return Math.max(0, currentCount + (isPending ? 1 : -1));
}

function CategoryCell({
  transaction,
  categories,
  onSuccess,
  updateAction,
}: {
  transaction: TransactionListItemReadModel;
  categories: readonly CategoryReadModel[];
  onSuccess?: (
    result: Extract<CategoryQuickEditActionResult, { ok: true }>,
  ) => void;
  updateAction?: CategoryQuickEditAction;
}) {
  if (!updateAction) {
    return (
      <span data-testid={`review-category-${transaction.id}`}>
        {categoryLabel(transaction.category)}
      </span>
    );
  }

  return (
    <CategoryQuickEdit
      action={updateAction}
      categories={quickEditCategories(categories)}
      categoryId={transaction.categoryId}
      currentCategory={transaction.category}
      disabled={transaction.status !== "POSTED"}
      financialEventId={transaction.id}
      kind={transaction.kind}
      label="Categoria"
      onSuccess={onSuccess}
      testId={`review-category-edit-${transaction.id}`}
    />
  );
}

function DetailLink({ transaction, query }: { transaction: TransactionListItemReadModel; query: ReviewQuery }) {
  return (
    <Link
      aria-label={`Abrir lançamento ${transaction.description}`}
      className="inline-flex rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`review-detail-${transaction.id}`}
      href={reviewQueryHref(`${TRANSACTIONS_ROUTE}/${encodeURIComponent(transaction.id)}`, query)}
    >
      Ver lançamento
    </Link>
  );
}

function Badges({ transaction }: { transaction: TransactionListItemReadModel }) {
  return (
    <TransactionReviewBadges
      categoryId={transaction.categoryId}
      origin={transaction.origin}
      reviewState={transaction.reviewState}
      testId={`review-badges-${transaction.id}`}
    />
  );
}

function ReviewTable({
  transactions,
  categories,
  query,
  onCategorySuccess,
  updateAction,
}: {
  transactions: readonly TransactionListItemReadModel[];
  categories: readonly CategoryReadModel[];
  query: ReviewQuery;
  onCategorySuccess?: (
    transaction: TransactionListItemReadModel,
    result: Extract<CategoryQuickEditActionResult, { ok: true }>,
  ) => void;
  updateAction?: CategoryQuickEditAction;
}) {
  return (
    <div className="hidden md:block" data-testid="transactions-table">
      <DataTable
        caption="Lançamentos para revisão"
        columns={[
          {
            key: "occurredOn",
            header: "Data",
            render: (transaction) => (
              <time dateTime={transaction.occurredOn}>{formatTransactionDate(transaction.occurredOn)}</time>
            ),
          },
          {
            key: "description",
            header: "Descrição",
            className: "min-w-48",
            render: (transaction) => (
              <div className="space-y-2">
                <Link
                  aria-label={`Abrir lançamento ${transaction.description}`}
                  className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`review-description-${transaction.id}`}
                  href={reviewQueryHref(`${TRANSACTIONS_ROUTE}/${encodeURIComponent(transaction.id)}`, query)}
                >
                  {transaction.description}
                </Link>
                <Badges transaction={transaction} />
              </div>
            ),
          },
          {
            key: "kind",
            header: "Tipo",
            render: (transaction) => <KindBadge kind={transaction.kind} />,
          },
          {
            key: "category",
            header: "Categoria",
            className: "min-w-52",
            render: (transaction) => (
              <CategoryCell
                categories={categories}
                onSuccess={(result) => onCategorySuccess?.(transaction, result)}
                transaction={transaction}
                updateAction={updateAction}
              />
            ),
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
            render: (transaction) => <TransactionAmount transaction={transaction} />,
          },
          {
            key: "status",
            header: "Status",
            render: (transaction) => <StatusBadge status={transaction.status} />,
          },
          {
            key: "detail",
            header: "Ação",
            render: (transaction) => <DetailLink query={query} transaction={transaction} />,
          },
        ]}
        getRowKey={(transaction) => transaction.id}
        rows={transactions}
        testId="transactions-review-table"
      />
    </div>
  );
}

function ReviewCard({
  transaction,
  categories,
  query,
  onCategorySuccess,
  updateAction,
}: {
  transaction: TransactionListItemReadModel;
  categories: readonly CategoryReadModel[];
  query: ReviewQuery;
  onCategorySuccess?: (
    transaction: TransactionListItemReadModel,
    result: Extract<CategoryQuickEditActionResult, { ok: true }>,
  ) => void;
  updateAction?: CategoryQuickEditAction;
}) {
  return (
    <article
      className={`space-y-4 ${transaction.status === "CANCELLED" ? "opacity-80" : ""}`}
      data-testid={`review-card-${transaction.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link
            aria-label={`Abrir lançamento ${transaction.description}`}
            className="block truncate font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={reviewQueryHref(`${TRANSACTIONS_ROUTE}/${encodeURIComponent(transaction.id)}`, query)}
          >
            {transaction.description}
          </Link>
          <time className="block text-xs text-muted-foreground" dateTime={transaction.occurredOn}>
            {formatTransactionDate(transaction.occurredOn)}
          </time>
        </div>
        <TransactionAmount transaction={transaction} />
      </div>
      <Badges transaction={transaction} />
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={transaction.kind} />
        <StatusBadge status={transaction.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Conta</dt>
          <dd className="mt-1 truncate">{transaction.account.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Categoria</dt>
          <dd className="mt-1">
            <CategoryCell
              categories={categories}
              onSuccess={(result) => onCategorySuccess?.(transaction, result)}
              transaction={transaction}
              updateAction={updateAction}
            />
          </dd>
        </div>
      </dl>
      <div className="flex justify-end border-t pt-3">
        <DetailLink query={query} transaction={transaction} />
      </div>
    </article>
  );
}

function ReviewMobileList({
  transactions,
  categories,
  query,
  onCategorySuccess,
  updateAction,
}: {
  transactions: readonly TransactionListItemReadModel[];
  categories: readonly CategoryReadModel[];
  query: ReviewQuery;
  onCategorySuccess?: (
    transaction: TransactionListItemReadModel,
    result: Extract<CategoryQuickEditActionResult, { ok: true }>,
  ) => void;
  updateAction?: CategoryQuickEditAction;
}) {
  return (
    <div className="md:hidden" data-testid="transactions-mobile-list">
      <ResourceList
        getItemKey={(transaction) => transaction.id}
        items={transactions}
        renderItem={(transaction) => (
          <ReviewCard
            categories={categories}
            onCategorySuccess={onCategorySuccess}
            query={query}
            transaction={transaction}
            updateAction={updateAction}
          />
        )}
        testId="transactions-review-mobile-list"
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
  accounts: readonly AccountReadModel[];
  categories: readonly CategoryReadModel[];
  query: ReviewQuery;
}) {
  const selectedCategory = query.categoryId === null ? UNCATEGORIZED_FILTER_VALUE : query.categoryId ?? "";
  return (
    <section
      aria-labelledby="transactions-review-filters-title"
      className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      data-testid="transactions-filters"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Filter aria-hidden="true" className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold" id="transactions-review-filters-title">Filtrar lançamentos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Combine período, origem, pendência e busca para revisar sua fila.</p>
        </div>
      </div>
      <form action={TRANSACTIONS_ROUTE} className="mt-5 space-y-4" method="get">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-from">De</label>
            <input className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.from ?? ""} id="transactions-from" name="from" type="date" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-to">Até</label>
            <input className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.to ?? ""} id="transactions-to" name="to" type="date" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-account">Conta</label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.accountId ?? ""} id="transactions-account" name="accountId">
              <option value="">Todas as contas</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.status === "ARCHIVED" ? " (arquivada)" : ""}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-category">Categoria</label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={selectedCategory} id="transactions-category" name="categoryId">
              <option value="">Todas as categorias</option>
              <option value={UNCATEGORIZED_FILTER_VALUE}>Sem categoria</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category)}{category.status === "ARCHIVED" ? " (arquivada)" : ""}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-kind">Tipo</label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.kind ?? ""} id="transactions-kind" name="kind">
              <option value="">Receitas e despesas</option>
              <option value="INCOME">Receitas</option>
              <option value="EXPENSE">Despesas</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-status">Status</label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.status ?? "ALL"} id="transactions-status" name="status">
              <option value="ALL">Todos os status</option>
              <option value="POSTED">Publicados</option>
              <option value="CANCELLED">Cancelados</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-review-origin">Origem</label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.origin ?? "ALL"} id="transactions-review-origin" name="origin">
              <option value="ALL">Todas as origens</option>
              <option value="MANUAL">Manual</option>
              <option value="IMPORT">Importado</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-review-review">Organização</label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.review ?? "ALL"} id="transactions-review-review" name="review">
              <option value="ALL">Todos os estados</option>
              <option value="NEEDS_REVIEW">Precisa de revisão</option>
              <option value="ORGANIZED">Organizado</option>
            </select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium" htmlFor="transactions-review-search">Buscar descrição</label>
            <input className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={query.search ?? ""} id="transactions-review-search" maxLength={120} name="search" placeholder="Ex.: mercado" type="search" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transactions-review-limit">Itens por página</label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={String(query.limit ?? 50)} id="transactions-review-limit" name="limit">
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground"><CalendarRange aria-hidden="true" className="size-4" />A busca usa a descrição corrente do lançamento.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="gap-2" type="submit"><Filter aria-hidden="true" className="size-4" />Aplicar filtros</Button>
            {hasReviewFilters(query) ? <ActionLink href={TRANSACTIONS_ROUTE} variant="outline"><RotateCcw aria-hidden="true" className="size-4" />Limpar filtros</ActionLink> : null}
          </div>
        </div>
      </form>
    </section>
  );
}

function hasReviewFilters(query: ReviewQuery): boolean {
  return Boolean(
    query.from || query.to || query.accountId || query.categoryId !== undefined || query.kind || query.status || query.origin || query.review || query.search || query.cursor,
  );
}

function emptyState(hasFilters: boolean) {
  if (hasFilters) {
    return <EmptyState action={<ActionLink href={TRANSACTIONS_ROUTE} variant="outline"><RotateCcw aria-hidden="true" className="size-4" />Limpar filtros</ActionLink>} description="Nenhum lançamento corresponde aos filtros atuais. Limpe os filtros para consultar toda a fila." testId="transactions-empty-filter-state" title="Nenhum lançamento encontrado" />;
  }
  return <EmptyState action={<div className="flex flex-col gap-2 sm:flex-row"><ActionLink href={transactionCreateRoute("INCOME")} testId="transactions-empty-income-cta"><Plus aria-hidden="true" className="size-4" />Adicionar receita</ActionLink><ActionLink href={transactionCreateRoute("EXPENSE")} testId="transactions-empty-expense-cta" variant="outline"><Plus aria-hidden="true" className="size-4" />Adicionar despesa</ActionLink></div>} description="Importe um extrato ou registre sua primeira receita/despesa para começar a organizar os lançamentos." testId="transactions-empty-state" title="Ainda não há lançamentos" />;
}

function NoAccountsNotice() {
  return (
    <aside
      className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950"
      data-testid="transactions-review-no-accounts"
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
      data-testid="transactions-review-no-categories"
    >
      <p className="font-medium">Nenhuma categoria cadastrada</p>
      <p className="mt-1 leading-6 text-muted-foreground">
        Categoria é opcional, mas ajuda a organizar os lançamentos pendentes.
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

function Pagination({ pageInfo, query }: { pageInfo?: TransactionListPageInfo | null; query: ReviewQuery }) {
  if (!pageInfo?.hasNextPage || !pageInfo.nextCursor) return null;
  return (
    <nav aria-label="Paginação dos lançamentos" className="flex justify-end" data-testid="transactions-review-pagination">
      <ActionLink href={reviewQueryHref(TRANSACTIONS_ROUTE, { ...query, cursor: pageInfo.nextCursor })} testId="transactions-review-next-page" variant="outline">Próximos lançamentos</ActionLink>
    </nav>
  );
}

export function TransactionReviewReadError({ message = DEFAULT_READ_ERROR, retryHref = TRANSACTIONS_ROUTE }: TransactionReviewReadErrorProps) {
  return <section className="space-y-6" data-testid="transactions-review-route-error"><PageHeader description="Revise os lançamentos do seu espaço financeiro." eyebrow="Movimentações" title="Revisão de lançamentos" /><ErrorState message={message} retryHref={retryHref} testId="transactions-review-load-error" /></section>;
}

/** Server-rendered review queue; query state stays in canonical hrefs. */
export function TransactionReviewListScreen({
  accounts,
  categories,
  hadInvalidFilters = false,
  initialTransactions,
  pageInfo,
  query,
  summary,
  updateAction,
}: TransactionReviewListScreenProps) {
  const initialNeedsReviewCount = summary?.needsReviewCount ?? null;
  const [needsReviewCount, setNeedsReviewCount] = useState<number | null>(
    initialNeedsReviewCount,
  );

  useEffect(() => {
    setNeedsReviewCount(initialNeedsReviewCount);
  }, [initialNeedsReviewCount]);

  const handleCategorySuccess = useCallback(
    (
      transaction: TransactionListItemReadModel,
      result: Extract<CategoryQuickEditActionResult, { ok: true }>,
    ) => {
      const nextCategoryId = result.value?.categoryId;
      if (
        nextCategoryId === undefined ||
        nextCategoryId === transaction.categoryId
      ) {
        return;
      }

      setNeedsReviewCount((current) => {
        if (current === null) return current;
        return reviewCountAfterCategoryEdit(current, transaction, nextCategoryId);
      });
    },
    [],
  );

  const hasFilters = hasReviewFilters(query);
  const reviewHref = reviewQueryHref(TRANSACTIONS_ROUTE, { ...query, review: "NEEDS_REVIEW", cursor: undefined });
  return (
    <section className="space-y-6" data-testid="transactions-route">
      <PageHeader
        action={<div className="flex flex-col gap-2 sm:flex-row"><ActionLink href={TRANSACTION_IMPORT_ROUTE} testId="transactions-review-import" variant="outline"><FileUp aria-hidden="true" className="size-4" />Importar CSV</ActionLink><ActionLink href={transactionCreateRoute("INCOME")} testId="transactions-review-add-income"><Plus aria-hidden="true" className="size-4" />Adicionar receita</ActionLink><ActionLink href={transactionCreateRoute("EXPENSE")} testId="transactions-review-add-expense" variant="outline"><Plus aria-hidden="true" className="size-4" />Adicionar despesa</ActionLink></div>}
        description="Uma fila única para organizar lançamentos manuais e importados sem perder a origem."
        eyebrow="Movimentações"
        title="Revisão de lançamentos"
      />
      {hadInvalidFilters ? <p aria-live="polite" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="transactions-review-invalid-filters" role="status">Alguns filtros da URL eram inválidos e foram ignorados.</p> : null}
      {needsReviewCount !== null ? <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]" data-testid="transactions-review-summary-area"><ReviewSummary needsReviewCount={needsReviewCount} /><div className="flex items-center"><ActionLink href={reviewHref} testId="transactions-review-now" variant="outline">Revisar agora</ActionLink></div></section> : null}
      <FiltersForm accounts={accounts} categories={categories} query={query} />
      {accounts.length === 0 ? <NoAccountsNotice /> : null}
      {categories.length === 0 ? <NoCategoriesNotice /> : null}
      {initialTransactions.length === 0 ? emptyState(hasFilters) : <><p className="text-sm text-muted-foreground" data-testid="transactions-review-count">{initialTransactions.length === 1 ? "1 lançamento nesta página" : `${initialTransactions.length} lançamentos nesta página`}</p><ReviewTable categories={categories} onCategorySuccess={handleCategorySuccess} query={query} transactions={initialTransactions} updateAction={updateAction} /><ReviewMobileList categories={categories} onCategorySuccess={handleCategorySuccess} query={query} transactions={initialTransactions} updateAction={updateAction} /><Pagination pageInfo={pageInfo} query={query} /></>}
    </section>
  );
}
