"use client";

import { ErrorState } from "@/components/ui/async-state";
import { BUDGETS_ROUTE } from "@/modules/budgets/routes";

/** Route-level recovery keeps infrastructure details out of the browser. */
export default function BudgetsError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      message="Não foi possível carregar as Caixinhas. Tente novamente."
      retryHref={BUDGETS_ROUTE}
      retryLabel="Voltar às Caixinhas"
      testId="budgets-route-error"
    >
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </ErrorState>
  );
}
