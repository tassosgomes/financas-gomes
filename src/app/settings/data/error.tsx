"use client";

import { ErrorState } from "@/components/ui/async-state";
import { EXPORT_SETTINGS_ROUTE } from "@/modules/export/routes";

/** Route-level recovery keeps infrastructure details out of the browser. */
export default function ExportDataError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      message="Não foi possível carregar a página de portabilidade. Tente novamente."
      retryHref={EXPORT_SETTINGS_ROUTE}
      retryLabel="Voltar aos dados"
      testId="export-data-route-error"
    >
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </ErrorState>
  );
}
