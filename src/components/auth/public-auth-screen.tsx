"use client";

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  signInWithGoogle,
  useAuthSession,
} from "@/lib/auth-client";
import {
  getPublicAuthErrorFromSearchParams,
  toPublicAuthError,
  type PublicAuthError,
} from "@/modules/auth/public-auth";
import {
  AUTHENTICATED_ROUTE,
  PUBLIC_AUTH_ROUTE,
} from "@/modules/auth/routes";

function GoogleMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-[#4285f4] shadow-sm"
    >
      G
    </span>
  );
}

function LoadingMark() {
  return <Loader2 aria-hidden="true" className="size-5 animate-spin" />;
}

function AuthAlert({ error }: { error: PublicAuthError }) {
  return (
    <div
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>{error.message}</p>
    </div>
  );
}

function AuthStatus({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "success";
}) {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border bg-secondary/60 px-4 py-3 text-sm text-muted-foreground"
      role="status"
    >
      {tone === "success" ? (
        <CheckCircle2
          aria-hidden="true"
          className="size-5 shrink-0 text-emerald-600"
        />
      ) : (
        <LoadingMark />
      )}
      <span>{children}</span>
    </div>
  );
}

export function PublicAuthScreen() {
  const router = useRouter();
  const { data: session, error: sessionError, isPending, isRefetching, refetch } =
    useAuthSession();
  const [callbackError, setCallbackError] = useState<PublicAuthError | null>(
    null,
  );
  const [actionError, setActionError] = useState<PublicAuthError | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const signInInFlight = useRef(false);
  const retryInFlight = useRef(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const error = getPublicAuthErrorFromSearchParams(searchParams);

    if (error) {
      setCallbackError(error);
      // Remove callback details, including provider descriptions, from the
      // address bar after copying only their safe category into local state.
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    setIsRedirecting(true);
    router.replace(AUTHENTICATED_ROUTE);
  }, [router, session]);

  const sessionViewError = sessionError
    ? toPublicAuthError(sessionError, { sessionError: true })
    : null;
  const visibleError = callbackError ?? sessionViewError ?? actionError;
  const isBusy =
    isPending ||
    isRefetching ||
    isSigningIn ||
    isRedirecting ||
    isRetrying ||
    Boolean(session);

  async function handleGoogleSignIn() {
    if (isBusy || signInInFlight.current) {
      return;
    }

    signInInFlight.current = true;
    setActionError(null);
    setCallbackError(null);
    setIsSigningIn(true);

    try {
      const result = await signInWithGoogle({
        callbackURL: AUTHENTICATED_ROUTE,
        newUserCallbackURL: AUTHENTICATED_ROUTE,
        errorCallbackURL: PUBLIC_AUTH_ROUTE,
      });

      if (result.error) {
        setActionError(toPublicAuthError(result.error));
        signInInFlight.current = false;
        setIsSigningIn(false);
        return;
      }

      // Better Auth normally navigates to Google through its redirect plugin.
      // If a custom fetch/plugin setup returns without redirecting, keep the
      // page actionable and show a safe transient failure instead of spinning.
      if (!result.data?.redirect) {
        setActionError(toPublicAuthError({ code: "AUTH_REQUEST_FAILED" }));
        signInInFlight.current = false;
        setIsSigningIn(false);
      }
    } catch (error) {
      setActionError(toPublicAuthError(error));
      signInInFlight.current = false;
      setIsSigningIn(false);
    }
  }

  async function handleRetry() {
    if (isRetrying || isRefetching || retryInFlight.current) {
      return;
    }

    retryInFlight.current = true;
    setActionError(null);
    setIsRetrying(true);
    try {
      await refetch();
    } finally {
      retryInFlight.current = false;
      setIsRetrying(false);
    }
  }

  function renderAuthCardContent() {
    if (isPending || isRefetching) {
      return <AuthStatus>Verificando sua sessão…</AuthStatus>;
    }

    if (session) {
      return (
        <AuthStatus tone="success">
          Abrindo seu espaço financeiro…
        </AuthStatus>
      );
    }

    if (sessionError) {
      return (
        <div className="space-y-3">
          {visibleError ? <AuthAlert error={visibleError} /> : null}
          <Button
            className="w-full"
            disabled={isBusy}
            onClick={handleRetry}
            type="button"
            variant="outline"
          >
            {isRetrying ? <LoadingMark /> : null}
            {isRetrying ? "Tentando novamente…" : "Tentar novamente"}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {visibleError ? <AuthAlert error={visibleError} /> : null}
        <Button
          aria-busy={isSigningIn}
          className="h-12 w-full gap-3 bg-primary text-base shadow-sm hover:bg-primary/90"
          disabled={isBusy}
          onClick={handleGoogleSignIn}
          type="button"
        >
          {isSigningIn ? <LoadingMark /> : <GoogleMark />}
          {isSigningIn ? "Conectando ao Google…" : "Continuar com Google"}
        </Button>
        <p className="text-center text-xs leading-5 text-muted-foreground">
          No primeiro acesso, sua conta Google cria automaticamente seu espaço
          financeiro. Não há senha local.
        </p>
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-background via-background to-secondary/70">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-32 size-80 rounded-full bg-primary/5 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-24 size-96 rounded-full bg-primary/5 blur-3xl"
      />

      <div className="container relative flex min-h-screen max-w-6xl flex-col justify-center py-8 sm:py-12 lg:py-16">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:gap-20">
          <section className="space-y-8 lg:py-8" aria-labelledby="auth-title">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <WalletCards aria-hidden="true" className="size-6" />
              </span>
              <span className="text-sm font-semibold tracking-wide text-foreground">
                Finanças Gomes
              </span>
            </div>

            <div className="max-w-xl space-y-5">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Seu dinheiro, em conjunto
              </p>
              <h1
                className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl"
                id="auth-title"
              >
                Organize o dinheiro da casa, junto.
              </h1>
              <p className="max-w-lg text-lg leading-8 text-muted-foreground">
                Um espaço financeiro compartilhado para acompanhar as decisões
                importantes com clareza e tranquilidade.
              </p>
            </div>

            <div className="flex items-start gap-3 text-sm text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <p>Login seguro pelo Google, sem senha para armazenar aqui.</p>
            </div>
          </section>

          <section
            aria-labelledby="auth-card-title"
            className="rounded-2xl border bg-card/95 p-6 shadow-xl shadow-primary/5 backdrop-blur sm:p-8"
          >
            <div className="mb-8 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">
                Entrada segura
              </p>
              <h2 className="text-2xl font-semibold tracking-tight" id="auth-card-title">
                Acesse seu espaço financeiro
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Entre ou crie sua conta usando o Google para começar.
              </p>
            </div>

            {renderAuthCardContent()}
          </section>
        </div>

        <footer className="mt-10 text-center text-xs text-muted-foreground lg:mt-16">
          Finanças Gomes · Gestão financeira compartilhada
        </footer>
      </div>
    </main>
  );
}
