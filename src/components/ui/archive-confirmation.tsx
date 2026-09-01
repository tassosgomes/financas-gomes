"use client";

import { Archive, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export interface ArchiveConfirmationProps {
  onConfirm: () => void | Promise<void>;
  resourceLabel?: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * Explicit archive confirmation shared by both metadata screens. The
 * destructive operation is never inferred from a row click.
 */
export function ArchiveConfirmation({
  onConfirm,
  resourceLabel = "este item",
  disabled = false,
  testId = "archive-confirmation",
}: ArchiveConfirmationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  async function confirm() {
    if (isConfirming || disabled) {
      return;
    }

    setIsConfirming(true);
    try {
      await onConfirm();
      setIsOpen(false);
    } finally {
      setIsConfirming(false);
    }
  }

  if (!isOpen) {
    return (
      <Button
        aria-label={`Arquivar ${resourceLabel}`}
        data-testid={`${testId}-open`}
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        type="button"
        variant="outline"
      >
        <Archive aria-hidden="true" className="size-4" />
        <span className="sr-only">Arquivar</span>
      </Button>
    );
  }

  return (
    <div
      aria-label="Confirmar arquivamento"
      className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2"
      data-testid={testId}
      role="group"
    >
      <span className="mr-1 text-xs text-destructive">Arquivar {resourceLabel}?</span>
      <Button
        aria-busy={isConfirming}
        data-testid={`${testId}-confirm`}
        disabled={isConfirming || disabled}
        onClick={() => void confirm()}
        type="button"
        variant="default"
      >
        {isConfirming ? "Arquivando…" : "Confirmar"}
      </Button>
      <Button
        aria-label="Cancelar arquivamento"
        data-testid={`${testId}-cancel`}
        disabled={isConfirming}
        onClick={() => setIsOpen(false)}
        type="button"
        variant="ghost"
      >
        <X aria-hidden="true" className="size-4" />
        <span className="sr-only">Cancelar</span>
      </Button>
    </div>
  );
}

export const ConfirmArchive = ArchiveConfirmation;
