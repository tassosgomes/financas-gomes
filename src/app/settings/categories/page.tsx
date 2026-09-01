import { CategoriesScreen } from "@/components/categories/categories-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { listCategoriesAction } from "@/app/actions/categories";
import { CATEGORIES_SETTINGS_ROUTE } from "@/modules/accounts-categories/routes";

export const dynamic = "force-dynamic";

/** Server-render the initial active collection; mutations stay in the client screen. */
export default async function CategoriesSettingsPage() {
  const result = await listCategoriesAction({ status: "ACTIVE" });

  if (!result.ok) {
    return (
      <section className="space-y-6" data-testid="categories-route-error">
        <PageHeader
          description="Mantenha a estrutura de categorias de despesas e receitas do espaço financeiro."
          eyebrow="Configurações financeiras"
          title="Categorias"
        />
        <ErrorState
          message={result.error.message}
          retryHref={CATEGORIES_SETTINGS_ROUTE}
          testId="categories-load-error"
        />
      </section>
    );
  }

  return (
    <div data-testid="categories-route">
      <CategoriesScreen initialCategories={result.value.items} />
    </div>
  );
}
