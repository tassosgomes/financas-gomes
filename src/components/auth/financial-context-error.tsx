"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth-client";
import { toPublicAuthError } from "@/modules/auth/public-auth";
import { PUBLIC_AUTH_ROUTE } from "@/modules/auth/routes";

const DEFAULT_MESSAGE =
  "Não foi possível validar seu espaço financeiro. Tente novamente ou entre com outra conta.";

export interface FinancialContextErrorProps {
  message?: string;
}

/** Safe recovery state for a session without a usable household membership. */
export function FinancialContextErrorState({
  message = DEFAULT_MESSAGE,
}: FinancialContextErrorProps) {
  const router = useRouter();
  const [isLeaving, setIsLeaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleLeave() {
    if (isLeaving) {
      return;
    }

    setIsLeaving(true);
    setErrorMessage(null);

    try {
      const result = await logout();
      if (result.error) {
        setErrorMessage(toPublicAuthError(result.error).message);
        setIsLeaving(false);
        return;
      }

      router.replace(PUBLIC_AUTH_ROUTE);
      router.refresh();
    } catch (error) {
      setErrorMessage(toPublicAuthError(error).message);
      setIsLeaving(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-12">
      <section
        aria-labelledby="financial-context-error-title"
        className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm sm:p-10"
      >
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle aria-hidden="true" className="size-6" />
        </span>
        <h1
          className="mt-5 text-2xl font-semibold tracking-tight"
          id="financial-context-error-title"
        >
          Espaço financeiro indisponível
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button
          aria-busy={isLeaving}
          className="mt-7 gap-2"
          disabled={isLeaving}
          onClick={handleLeave}
          type="button"
        >
          {isLeaving ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : null}
          {isLeaving ? "Saindo…" : "Sair e voltar à entrada"}
        </Button>
        {errorMessage ? (
          <p aria-live="polite" className="mt-3 text-xs text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
