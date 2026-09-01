"use client";

import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth-client";
import { toPublicAuthError } from "@/modules/auth/public-auth";
import { PUBLIC_AUTH_ROUTE } from "@/modules/auth/routes";

/**
 * Client-only session action. The server remains the authority for the
 * private route; this button only asks Better Auth to revoke the cookie and
 * then navigates back to the public entry point.
 */
export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setErrorMessage(null);

    try {
      const result = await logout();

      if (result.error) {
        setErrorMessage(toPublicAuthError(result.error).message);
        setIsSigningOut(false);
        return;
      }

      router.replace(PUBLIC_AUTH_ROUTE);
      router.refresh();
    } catch (error) {
      setErrorMessage(toPublicAuthError(error).message);
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        aria-busy={isSigningOut}
        aria-label="Sair da conta"
        className="gap-2"
        disabled={isSigningOut}
        onClick={handleSignOut}
        type="button"
        variant="outline"
      >
        {isSigningOut ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <LogOut aria-hidden="true" className="size-4" />
        )}
        {isSigningOut ? "Saindo…" : "Sair"}
      </Button>
      {errorMessage ? (
        <p aria-live="polite" className="max-w-52 text-right text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
