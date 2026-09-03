import {
  getBudgetAction,
  listBudgetsAction,
} from "@/app/actions/budgets";
import { getSpendableAction } from "@/app/actions/spendable";
import { BudgetDetailScreen, type BudgetTransferOption } from "@/components/budgets";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { getTodayIsoDate } from "@/modules/transactions/form-contract";
import {
  BUDGETS_ROUTE,
  SPENDABLE_BREAKDOWN_ROUTE,
  budgetDetailRoute,
} from "@/modules/budgets/routes";

export const dynamic = "force-dynamic";

interface BudgetDetailPageProps {
  params: Promise<{ referenceId: string }>;
}

function routeError(message: string) {
  return (
    <section className="space-y-6" data-testid="budget-detail-route-error">
      <PageHeader
        description="Consulte saldo, progresso e histórico da Caixinha autenticada."
        eyebrow="Planejamento financeiro"
        title="Detalhe da Caixinha"
      />
      <ErrorState
        message={message}
        retryHref={BUDGETS_ROUTE}
        testId="budget-detail-load-error"
      />
    </section>
  );
}

/** Server-first detail route. Household identity and authority stay in the actions. */
export default async function BudgetDetailPage({ params }: BudgetDetailPageProps) {
  const { referenceId } = await params;
  const asOf = getTodayIsoDate();
  const from = `${asOf.slice(0, 7)}-01`;
  let detailResult: Awaited<ReturnType<typeof getBudgetAction>>;

  try {
    detailResult = await getBudgetAction(referenceId, {
      asOf,
      from,
      to: asOf,
      limit: 50,
    });
  } catch {
    return routeError("Não foi possível carregar a Caixinha. Tente novamente.");
  }

  if (!detailResult.ok) {
    return routeError(detailResult.error.message);
  }

  let destinationError: string | null = null;
  let destinations: BudgetTransferOption[] = [];
  try {
    const listResult = await listBudgetsAction({ status: "ACTIVE", asOf });
    if (listResult.ok) {
      destinations = listResult.value.items
        .filter((item) => item.referenceId !== detailResult.value.referenceId)
        .map((item) => ({ referenceId: item.referenceId, name: item.name }));
    } else {
      destinationError = "Não foi possível carregar os destinos de transferência.";
    }
  } catch {
    destinationError = "Não foi possível carregar os destinos de transferência.";
  }

  let spendableResult: Awaited<ReturnType<typeof getSpendableAction>>;
  try {
    spendableResult = await getSpendableAction({ asOf });
  } catch {
    spendableResult = {
      ok: false,
      error: { code: "SPENDABLE_QUERY_FAILED", field: null },
    };
  }

  const spendableHref = `${SPENDABLE_BREAKDOWN_ROUTE}?returnTo=${encodeURIComponent(
    budgetDetailRoute(detailResult.value.referenceId),
  )}`;

  return (
    <BudgetDetailScreen
      destinationError={destinationError}
      destinations={destinations}
      initialDetail={detailResult.value}
      initialSpendable={spendableResult}
      spendableHref={spendableHref}
    />
  );
}
