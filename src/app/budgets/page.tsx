import { listBudgetsAction } from "@/app/actions/budgets";
import { listCategoriesAction } from "@/app/actions/categories";
import { BudgetCollectionScreen } from "@/components/budgets";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { BUDGETS_ROUTE } from "@/modules/budgets/routes";

export const dynamic = "force-dynamic";

/**
 * Server-first collection route. Category records are reduced to opaque id /
 * label options before the client receives them; household identity never
 * becomes a form field or URL selector.
 */
export default async function BudgetsPage() {
  try {
    const [budgets, categories] = await Promise.all([
      listBudgetsAction({ status: "ACTIVE" }),
      listCategoriesAction({ status: "ACTIVE" }),
    ]);

    if (!budgets.ok) {
      return (
        <section className="space-y-6" data-testid="budgets-route-error">
          <PageHeader
            description="Consulte e mantenha as Caixinhas do espaço financeiro autenticado."
            eyebrow="Planejamento financeiro"
            title="Caixinhas"
          />
          <ErrorState
            message={budgets.error.message}
            retryHref={BUDGETS_ROUTE}
            testId="budgets-load-error"
          />
        </section>
      );
    }

    const categoryOptions = categories.ok
      ? categories.value.items
          .filter((category) => category.kind === "EXPENSE" && category.status === "ACTIVE")
          .map((category) => ({ id: category.id, name: category.name }))
      : [];

    return (
      <div data-testid="budgets-route">
        <BudgetCollectionScreen
          categories={categoryOptions}
          categoryError={
            categories.ok
              ? null
              : "Não foi possível carregar as categorias de despesa. Tente atualizar a página."
          }
          initialItems={budgets.value.items}
        />
      </div>
    );
  } catch {
    return (
      <section className="space-y-6" data-testid="budgets-route-error">
        <PageHeader
          description="Consulte e mantenha as Caixinhas do espaço financeiro autenticado."
          eyebrow="Planejamento financeiro"
          title="Caixinhas"
        />
        <ErrorState
          message="Não foi possível carregar as Caixinhas. Tente novamente."
          retryHref={BUDGETS_ROUTE}
          testId="budgets-load-error"
        />
      </section>
    );
  }
}
