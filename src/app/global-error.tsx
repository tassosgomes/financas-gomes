"use client";

import { useEffect } from "react";

import { captureClientException } from "@/modules/observability/client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureClientException(error, {
      event: "client_fatal_error",
      route: "/",
    });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h2>Algo deu errado</h2>
          <p>Recarregue a página para tentar novamente.</p>
          <button onClick={() => reset()} type="button">
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  );
}
