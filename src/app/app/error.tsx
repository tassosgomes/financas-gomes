"use client";

import { ErrorState } from "@/components/ui/async-state";
import { AUTHENTICATED_ROUTE } from "@/modules/auth/routes";

/** Route-level recovery keeps infrastructure details out of the browser. */
export default function AuthenticatedHomeError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      message="Não foi possível carregar a visão geral. Tente novamente."
      retryHref={AUTHENTICATED_ROUTE}
      retryLabel="Voltar à visão geral"
      testId="overview-route-error"
    >
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </ErrorState>
  );
}
