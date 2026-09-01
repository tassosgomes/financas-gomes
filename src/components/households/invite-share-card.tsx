"use client";

import { AlertCircle, Check, Copy, Link2, Loader2, UsersRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  HouseholdInviteClientError,
  createHouseholdInviteRequest,
} from "@/modules/households/invites/client";
import {
  HOUSEHOLD_INVITE_ERROR_CODES,
  HOUSEHOLD_INVITE_ERROR_MESSAGES,
  type HouseholdInviteErrorCode,
} from "@/modules/households/invites/contracts";

function LoadingMark() {
  return <Loader2 aria-hidden="true" className="size-4 animate-spin" />;
}

function getErrorCode(
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

async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textArea.remove();
  }

  if (!copied) {
    throw new Error("clipboard unavailable");
  }
}

/** Authenticated action for creating and copying a one-time invite link. */
export function InviteShareCard() {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorCode, setErrorCode] = useState<HouseholdInviteErrorCode | null>(
    null,
  );
  const [copyError, setCopyError] = useState(false);

  async function handleCreateInvite() {
    if (isCreating) {
      return;
    }

    setIsCreating(true);
    setErrorCode(null);
    setCopyError(false);
    setCopied(false);

    try {
      const result = await createHouseholdInviteRequest();
      setInviteUrl(result.invite.inviteUrl);
    } catch (error) {
      setErrorCode(getErrorCode(error, "INVITE_CREATION_FAILED"));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopyInvite() {
    if (!inviteUrl || isCopying) {
      return;
    }

    setIsCopying(true);
    setCopyError(false);
    try {
      await copyText(inviteUrl);
      setCopied(true);
    } catch {
      // The link remains visible and can still be copied manually. The raw
      // value is never placed in an error, log or observability context.
      setCopyError(true);
      setCopied(false);
    } finally {
      setIsCopying(false);
    }
  }

  const inviteErrorMessage = errorCode
    ? HOUSEHOLD_INVITE_ERROR_MESSAGES[errorCode]
    : null;

  return (
    <section
      aria-labelledby="invite-share-title"
      className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
      data-testid="invite-share-card"
    >
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <UsersRound aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Compartilhe seu espaço
          </p>
          <h2 className="text-xl font-semibold tracking-tight" id="invite-share-title">
            Convide alguém de confiança
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Gere um link para incluir outra pessoa no mesmo espaço financeiro.
            O link pode ser usado uma única vez.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {inviteUrl ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="household-invite-link">
                Link de convite
              </label>
              <input
                aria-label="Link de convite"
                className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="invite-link"
                id="household-invite-link"
                readOnly
                spellCheck={false}
                value={inviteUrl}
              />
              <Button
                aria-busy={isCopying}
                className="shrink-0 gap-2"
                data-testid="copy-invite-button"
                disabled={isCopying}
                onClick={handleCopyInvite}
                type="button"
                variant="outline"
              >
                {isCopying ? <LoadingMark /> : <Copy aria-hidden="true" className="size-4" />}
                {isCopying ? "Copiando…" : "Copiar link"}
              </Button>
            </div>

            <p
              aria-live="polite"
              className={copied ? "text-sm text-emerald-700" : "text-sm text-muted-foreground"}
              data-testid={copied ? "invite-copied-status" : "invite-created-status"}
              role="status"
            >
              {copied ? (
                <span className="inline-flex items-center gap-2">
                  <Check aria-hidden="true" className="size-4" />
                  Link copiado. Agora é só compartilhar.
                </span>
              ) : (
                "Link criado. Compartilhe com quem deseja incluir no espaço."
              )}
            </p>
            {copyError ? (
              <p aria-live="polite" className="text-sm text-destructive" role="alert">
                Não foi possível copiar automaticamente. Selecione o link e copie manualmente.
              </p>
            ) : null}
          </div>
        ) : (
          <Button
            aria-busy={isCreating}
            className="gap-2"
            data-testid="create-invite-button"
            disabled={isCreating}
            onClick={handleCreateInvite}
            type="button"
          >
            {isCreating ? <LoadingMark /> : <Link2 aria-hidden="true" className="size-4" />}
            {isCreating ? "Gerando link…" : "Gerar link de convite"}
          </Button>
        )}

        {inviteErrorMessage ? (
          <div
            aria-live="polite"
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="invite-share-error"
            role="alert"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>{inviteErrorMessage}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
