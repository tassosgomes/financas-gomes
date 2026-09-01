"use client";

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  acceptHouseholdInviteRequest,
  HouseholdInviteClientError,
} from "@/modules/households/invites/client";
import {
  HOUSEHOLD_INVITE_ACCEPT_PATH,
  HOUSEHOLD_INVITE_ERROR_CODES,
  HOUSEHOLD_INVITE_ERROR_MESSAGES,
  HOUSEHOLD_INVITE_QUERY_PARAMETER,
  type HouseholdInviteErrorCode,
} from "@/modules/households/invites/contracts";
import { signInWithGoogle, useAuthSession } from "@/lib/auth-client";
import {
  getPublicAuthErrorFromSearchParams,
  toPublicAuthError,
  type PublicAuthError,
} from "@/modules/auth/public-auth";
import { AUTHENTICATED_ROUTE, PUBLIC_AUTH_ROUTE } from "@/modules/auth/routes";

const MAX_INVITE_TOKEN_LENGTH = 512;

function LoadingMark() {
  return <Loader2 aria-hidden="true" className="size-5 animate-spin" />;
}

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

function InviteAlert({
  message,
  testId,
}: {
  message: string;
  testId?: string;
}) {
  return (
    <div
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      data-testid={testId}
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function InviteStatus({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border bg-secondary/60 px-4 py-3 text-sm text-muted-foreground"
      data-testid="invite-status"
      role="status"
    >
      <LoadingMark />
      <span>{children}</span>
    </div>
  );
}

function getInviteErrorCode(
  error: unknown,
  fallback: HouseholdInviteErrorCode,
): HouseholdInviteErrorCode {
  if (error instanceof HouseholdInviteClientError) {
    return error.code;
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    HOUSEHOLD_INVITE_ERROR_CODES.includes(
      (error as { code?: unknown }).code as HouseholdInviteErrorCode,
    )
  ) {
    return (error as { code: HouseholdInviteErrorCode }).code;
  }

  return fallback;
}

function getInviteErrorMessage(code: HouseholdInviteErrorCode): string {
  return HOUSEHOLD_INVITE_ERROR_MESSAGES[code];
}

function buildInviteCallbackUrl(token: string, error?: string): string {
  const callback = new URL(HOUSEHOLD_INVITE_ACCEPT_PATH, window.location.origin);
  callback.searchParams.set(HOUSEHOLD_INVITE_QUERY_PARAMETER, token);
  if (error) {
    callback.searchParams.set("error", error);
  }
  return callback.toString();
}

function readInviteToken(): string | null {
  const rawToken = new URLSearchParams(window.location.search).get(
    HOUSEHOLD_INVITE_QUERY_PARAMETER,
  );
  const token = rawToken?.trim() ?? "";

  if (!token || token.length > MAX_INVITE_TOKEN_LENGTH) {
    return null;
  }

  return token;
}

function clearInviteQueryParameters(): void {
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.hash}`,
  );
}

function InviteFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-secondary/70 px-4 py-10 sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -top-32 size-80 rounded-full bg-primary/5 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-24 size-96 rounded-full bg-primary/5 blur-3xl"
      />

      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <WalletCards aria-hidden="true" className="size-6" />
          </span>
          <span className="text-sm font-semibold tracking-wide text-foreground">
            Finanças Gomes
          </span>
        </div>
        {children}
        <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
          Seu acesso é protegido pelo Google.
        </p>
      </div>
    </main>
  );
}

function InviteCard({
  children,
  title,
  description,
  testId,
}: {
  children: React.ReactNode;
  title: string;
  description: string;
  testId?: string;
}) {
  return (
    <section
      aria-labelledby="invite-screen-title"
      className="rounded-2xl border bg-card/95 p-6 shadow-xl shadow-primary/5 backdrop-blur sm:p-8"
      data-testid={testId}
    >
      <div className="mb-8 space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Convite para compartilhar</p>
        <h1 className="text-2xl font-semibold tracking-tight" id="invite-screen-title">
          {title}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** Public route that authenticates a guest and consumes the invitation once. */
export function InviteAcceptanceScreen() {
  const router = useRouter();
  const {
    data: session,
    error: sessionError,
    isPending,
    isRefetching,
    refetch,
  } = useAuthSession();
  const [token, setToken] = useState<string | null>(null);
  const [tokenRead, setTokenRead] = useState(false);
  const [callbackError, setCallbackError] = useState<PublicAuthError | null>(
    null,
  );
  const [signInError, setSignInError] = useState<PublicAuthError | null>(null);
  const [acceptErrorCode, setAcceptErrorCode] =
    useState<HouseholdInviteErrorCode | null>(null);
  const [acceptedInvite, setAcceptedInvite] = useState<{
    householdName: string;
  } | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRetryingSession, setIsRetryingSession] = useState(false);
  const [acceptRetry, setAcceptRetry] = useState(0);
  const attemptedAcceptRef = useRef<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const authError = getPublicAuthErrorFromSearchParams(searchParams);
    const nextToken = readInviteToken();

    setToken(nextToken);
    if (authError) {
      setCallbackError(authError);
    }

    // Keep the bearer value in component state only; it is still re-added to
    // the explicit OAuth callback URL when the guest needs to authenticate.
    clearInviteQueryParameters();
    setTokenRead(true);
  }, []);

  useEffect(() => {
    if (
      !tokenRead ||
      !token ||
      !session ||
      isAccepting ||
      acceptedInvite
    ) {
      return;
    }

    const attemptKey = `${token}:${acceptRetry}`;
    if (attemptedAcceptRef.current === attemptKey) {
      return;
    }

    attemptedAcceptRef.current = attemptKey;
    setIsAccepting(true);
    setAcceptErrorCode(null);
    setCallbackError(null);
    setSignInError(null);

    void acceptHouseholdInviteRequest(token)
      .then((result) => {
        setAcceptedInvite({
          householdName: result.household.name,
        });
      })
      .catch((error: unknown) => {
        setAcceptErrorCode(
          getInviteErrorCode(error, "PROVISIONING_FAILED"),
        );
      })
      .finally(() => {
        setIsAccepting(false);
      });
  }, [acceptRetry, acceptedInvite, isAccepting, session, token, tokenRead]);

  async function handleGoogleSignIn() {
    if (!token || isSigningIn) {
      return;
    }

    setIsSigningIn(true);
    setSignInError(null);
    setCallbackError(null);

    try {
      const callbackURL = buildInviteCallbackUrl(token);
      const result = await signInWithGoogle({
        callbackURL,
        errorCallbackURL: buildInviteCallbackUrl(token, "auth_callback_error"),
        newUserCallbackURL: callbackURL,
      });

      if (result.error) {
        setSignInError(toPublicAuthError(result.error));
        setIsSigningIn(false);
        return;
      }

      // Better Auth normally redirects immediately. Keep the card usable if
      // a custom/test client returns without starting that navigation.
      if (!result.data?.redirect) {
        setSignInError(toPublicAuthError({ code: "AUTH_REQUEST_FAILED" }));
        setIsSigningIn(false);
      }
    } catch (error) {
      setSignInError(toPublicAuthError(error));
      setIsSigningIn(false);
    }
  }

  async function handleRetrySession() {
    if (isRetryingSession || isRefetching) {
      return;
    }

    setIsRetryingSession(true);
    setSignInError(null);
    try {
      await refetch();
    } finally {
      setIsRetryingSession(false);
    }
  }

  function handleRetryAcceptance() {
    if (isAccepting) {
      return;
    }

    setAcceptErrorCode(null);
    setAcceptRetry((value) => value + 1);
  }

  if (!tokenRead) {
    return (
      <InviteFrame>
        <InviteCard
          description="Aguarde enquanto verificamos o seu convite."
          testId="invite-acceptance-card"
          title="Verificando convite"
        >
          <InviteStatus>Verificando seu convite…</InviteStatus>
        </InviteCard>
      </InviteFrame>
    );
  }

  if (!token) {
    return (
      <InviteFrame>
        <InviteCard
          description="O link precisa conter um convite válido para continuar."
          testId="invite-invalid-state"
          title="Convite inválido"
        >
          <InviteAlert
            message={getInviteErrorMessage("INVITATION_INVALID")}
            testId="invite-error-invalid"
          />
          <Link
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={PUBLIC_AUTH_ROUTE}
          >
            Voltar para a entrada
          </Link>
        </InviteCard>
      </InviteFrame>
    );
  }

  if (isPending || isRefetching) {
    return (
      <InviteFrame>
        <InviteCard
          description="Vamos confirmar sua identidade antes de associar o espaço."
          testId="invite-acceptance-card"
          title="Preparando seu convite"
        >
          <InviteStatus>Verificando sua sessão…</InviteStatus>
        </InviteCard>
      </InviteFrame>
    );
  }

  if (sessionError && !session) {
    const safeError = toPublicAuthError(sessionError, { sessionError: true });
    return (
      <InviteFrame>
        <InviteCard
          description="Não foi possível confirmar sua sessão agora."
          testId="invite-session-error"
          title="Não foi possível continuar"
        >
          <div className="space-y-3">
            <InviteAlert message={safeError.message} testId="invite-auth-error" />
            <Button
              aria-busy={isRetryingSession}
              className="w-full gap-2"
              data-testid="invite-session-retry"
              disabled={isRetryingSession}
              onClick={handleRetrySession}
              type="button"
              variant="outline"
            >
              {isRetryingSession ? <LoadingMark /> : null}
              {isRetryingSession ? "Tentando novamente…" : "Tentar novamente"}
            </Button>
          </div>
        </InviteCard>
      </InviteFrame>
    );
  }

  if (!session) {
    const visibleAuthError = signInError ?? callbackError;
    return (
      <InviteFrame>
        <InviteCard
          description="Entre com o Google para aceitar o convite e acessar o espaço compartilhado."
          testId="invite-authentication-card"
          title="Você recebeu um convite"
        >
          <div className="space-y-4">
            {visibleAuthError ? (
              <InviteAlert
                message={visibleAuthError.message}
                testId="invite-auth-error"
              />
            ) : null}
            <Button
              aria-busy={isSigningIn}
              className="h-12 w-full gap-3 bg-primary text-base shadow-sm hover:bg-primary/90"
              data-testid="invite-google-sign-in"
              disabled={isSigningIn}
              onClick={handleGoogleSignIn}
              type="button"
            >
              {isSigningIn ? <LoadingMark /> : <GoogleMark />}
              {isSigningIn ? "Conectando ao Google…" : "Entrar com Google para aceitar"}
            </Button>
            <p className="text-center text-xs leading-5 text-muted-foreground">
              Depois do login, o convite será associado automaticamente a esta conta.
            </p>
          </div>
        </InviteCard>
      </InviteFrame>
    );
  }

  if (isAccepting) {
    return (
      <InviteFrame>
        <InviteCard
          description="Estamos concluindo o vínculo com segurança."
          testId="invite-accepting-state"
          title="Aceitando convite"
        >
          <InviteStatus>Associando você ao espaço financeiro…</InviteStatus>
        </InviteCard>
      </InviteFrame>
    );
  }

  if (acceptedInvite) {
    return (
      <InviteFrame>
        <InviteCard
          description="Seu vínculo foi concluído e o acesso já está disponível."
          testId="invite-success-state"
          title="Convite aceito"
        >
          <div className="space-y-5">
            <div
              aria-live="polite"
              className="flex items-start gap-3 rounded-lg border border-emerald-600/20 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-800"
              data-testid="invite-accept-success"
              role="status"
            >
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              <p>
                Você agora faz parte do espaço financeiro{" "}
                <strong>{acceptedInvite.householdName}</strong>.
              </p>
            </div>
            <Button
              className="w-full"
              data-testid="invite-continue-button"
              onClick={() => router.replace(AUTHENTICATED_ROUTE)}
              type="button"
            >
              Entrar no espaço financeiro
            </Button>
          </div>
        </InviteCard>
      </InviteFrame>
    );
  }

  if (acceptErrorCode) {
    const isTerminal =
      acceptErrorCode === "INVITATION_INVALID" ||
      acceptErrorCode === "INVITATION_EXPIRED" ||
      acceptErrorCode === "INVITATION_ALREADY_USED";
    return (
      <InviteFrame>
        <InviteCard
          description={
            isTerminal
              ? "Peça à pessoa que enviou o convite para verificar o link ou gerar um novo."
              : "Não foi possível concluir o convite agora."
          }
          testId="invite-acceptance-error-state"
          title={isTerminal ? "Não foi possível aceitar o convite" : "Algo deu errado"}
        >
          <div className="space-y-4">
            <InviteAlert
              message={getInviteErrorMessage(acceptErrorCode)}
              testId={`invite-error-${acceptErrorCode.toLowerCase()}`}
            />
            {isTerminal ? (
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={PUBLIC_AUTH_ROUTE}
              >
                Voltar para a entrada
              </Link>
            ) : (
              <Button
                className="w-full"
                data-testid="invite-accept-retry"
                onClick={handleRetryAcceptance}
                type="button"
                variant="outline"
              >
                Tentar novamente
              </Button>
            )}
          </div>
        </InviteCard>
      </InviteFrame>
    );
  }

  return (
    <InviteFrame>
      <InviteCard
        description="Estamos preparando a associação com o espaço financeiro."
        testId="invite-acceptance-card"
        title="Preparando convite"
      >
        <InviteStatus>Preparando seu acesso…</InviteStatus>
      </InviteCard>
    </InviteFrame>
  );
}
