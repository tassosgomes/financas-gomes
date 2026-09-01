"use client";

import { useEffect } from "react";

import { captureClientException } from "@/modules/observability/client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureClientException(error, {
      event: "client_route_error",
      route: "/app",
    });
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Algo deu errado</h2>
      <p className="text-muted-foreground">
        Não foi possível carregar esta tela. Tente novamente.
      </p>
      <button
        className="rounded-md border px-4 py-2 text-sm"
        onClick={() => reset()}
        type="button"
      >
        Tentar novamente
      </button>
    </main>
  );
}
