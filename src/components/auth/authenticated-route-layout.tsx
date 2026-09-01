import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/auth/authenticated-shell";
import { FinancialContextErrorState } from "@/components/auth/financial-context-error";
import { getDb } from "@/db";
import { households } from "@/db/schema";
import { requireAuth } from "@/modules/auth/server";
import { PUBLIC_AUTH_ROUTE } from "@/modules/auth/routes";
import {
  FINANCIAL_CONTEXT_ERROR_CODES,
  FinancialContextError,
} from "@/modules/households/contracts";
import { requireFinancialContext } from "@/modules/households/context";

export const dynamic = "force-dynamic";

const FALLBACK_CONTEXT_ERROR_MESSAGE =
  "Não foi possível validar seu espaço financeiro. Tente novamente ou entre com outra conta.";

interface AuthenticatedShellData {
  householdName: string;
  user: {
    name: string;
    email: string;
  };
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function redirectForSessionError(error: unknown): void {
  const code = getErrorCode(error);

  if (code === "UNAUTHENTICATED") {
    redirect(PUBLIC_AUTH_ROUTE);
  }

  if (code === "INVALID_SESSION") {
    redirect(`${PUBLIC_AUTH_ROUTE}?error=auth_session_expired`);
  }
}

function isFinancialContextError(error: unknown): error is FinancialContextError {
  const code = getErrorCode(error);
  return (
    error instanceof FinancialContextError ||
    (code !== null &&
      FINANCIAL_CONTEXT_ERROR_CODES.includes(
        code as (typeof FINANCIAL_CONTEXT_ERROR_CODES)[number],
      ))
  );
}

function getSafeContextErrorMessage(error: unknown): string {
  if (error instanceof FinancialContextError) {
    return error.message;
  }

  return FALLBACK_CONTEXT_ERROR_MESSAGE;
}

async function loadAuthenticatedShell(): Promise<
  | { kind: "ready"; data: AuthenticatedShellData }
  | { kind: "context-error"; message: string }
> {
  let session: Awaited<ReturnType<typeof requireAuth>>;

  try {
    session = await requireAuth();
  } catch (error) {
    redirectForSessionError(error);
    throw error;
  }

  let context: Awaited<ReturnType<typeof requireFinancialContext>>;

  try {
    context = await requireFinancialContext();
  } catch (error) {
    redirectForSessionError(error);

    if (isFinancialContextError(error)) {
      return { kind: "context-error", message: getSafeContextErrorMessage(error) };
    }

    throw error;
  }

  const [household] = await getDb()
    .select({ id: households.id, name: households.name })
    .from(households)
    .where(eq(households.id, context.householdId))
    .limit(1);

  if (!household) {
    return {
      kind: "context-error",
      message: FALLBACK_CONTEXT_ERROR_MESSAGE,
    };
  }

  return {
    kind: "ready",
    data: {
      householdName: household.name,
      user: {
        name: session.user.name?.trim() || "Usuário",
        email: session.user.email,
      },
    },
  };
}

/** Shared server layout for `/app` and the canonical S02 feature routes. */
export async function AuthenticatedRouteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const result = await loadAuthenticatedShell();

  if (result.kind === "context-error") {
    return <FinancialContextErrorState message={result.message} />;
  }

  return (
    <AuthenticatedShell
      householdName={result.data.householdName}
      user={result.data.user}
    >
      {children}
    </AuthenticatedShell>
  );
}
