"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  cancelPlannedEventAction,
  cancelRecurringOccurrenceAction,
  endRecurringRuleAction,
  overrideRecurringOccurrenceAction,
  realizeRecurringOccurrenceAction,
  updatePlannedEventAction,
  updateRecurringRuleFutureAction,
} from "@/app/actions/forecast-maintenance";
import { generateUuidV7 } from "@/lib/uuidv7";
import type {
  ForecastOriginAction,
  ForecastOriginDetail,
} from "@/modules/forecast/origin-contracts";

const CONTROL_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const TEXTAREA_CLASS =
  "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const OUTLINE_BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

type ActionResponse = {
  ok: boolean;
  error?: { code?: unknown };
};

function actionEnabled(
  detail: ForecastOriginDetail,
  operation: ForecastOriginAction,
): boolean {
  return detail.actions.some(
    (candidate) => candidate.operation === operation && candidate.enabled,
  );
}

function actionReason(
  detail: ForecastOriginDetail,
  operation: ForecastOriginAction,
): string | null {
  return (
    detail.actions.find((candidate) => candidate.operation === operation)
      ?.reason ?? null
  );
}

function errorMessage(response: ActionResponse | null): string | null {
  if (!response || response.ok) return null;
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "Entre para alterar compromissos.",
    INVALID_COMMAND: "Revise os dados informados.",
    INVALID_COMMAND_ID: "Não foi possível identificar esta operação. Tente novamente.",
    INVALID_AMOUNT: "Informe um valor positivo em centavos.",
    INVALID_DATE: "Informe uma data válida.",
    INVALID_DESCRIPTION: "Informe uma descrição válida.",
    INVALID_KIND: "Escolha um tipo de compromisso válido.",
    NON_EDITABLE_FIELD: "Esse campo pertence ao fato financeiro e não pode ser alterado aqui.",
    PLANNED_EVENT_NOT_FOUND: "O evento planejado não está disponível neste espaço.",
    PLANNED_EVENT_NOT_EDITABLE: "Este evento já foi realizado ou cancelado.",
    PLANNED_EVENT_ALREADY_CANCELLED: "Este evento já foi cancelado.",
    RULE_NOT_FOUND: "A recorrência não está disponível neste espaço.",
    OCCURRENCE_NOT_FOUND: "A ocorrência não está disponível neste espaço.",
    OCCURRENCE_ALREADY_REALIZED: "Esta ocorrência já foi realizada.",
    TENANT_RESOURCE_NOT_FOUND: "O recurso não está disponível neste espaço.",
    COMMAND_ID_REUSED: "Esta operação já foi usada com outros dados.",
    CONFLICT: "A informação mudou em outra operação. Atualize e tente novamente.",
  };
  const code = typeof response.error?.code === "string" ? response.error.code : "";
  return messages[code] ?? "Não foi possível salvar a alteração. Tente novamente.";
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Feedback({ response }: { response: ActionResponse | null }) {
  const message = errorMessage(response);
  if (!response || response.ok) return null;
  return (
    <p aria-live="polite" className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

function useSubmitFeedback() {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [response, setResponse] = React.useState<ActionResponse | null>(null);

  function run(action: (input: unknown) => Promise<unknown>, input: unknown) {
    setResponse(null);
    startTransition(() => {
      void action(input).then((value) => {
        const result = value as ActionResponse;
        setResponse(result);
        if (result.ok) router.refresh();
      });
    });
  }

  return { isPending, response, run };
}

function RecurringRuleForm({ detail }: { detail: ForecastOriginDetail }) {
  const recurring = detail.recurring;
  const { isPending, response, run } = useSubmitFeedback();
  const [amountCents, setAmountCents] = React.useState(recurring?.amountCents ?? "");
  const [description, setDescription] = React.useState(recurring?.description ?? "");
  const [effectiveFrom, setEffectiveFrom] = React.useState(
    recurring?.expectedOn ?? recurring?.startOn ?? "",
  );
  const [endOn, setEndOn] = React.useState(recurring?.endOn ?? effectiveFrom);

  if (!recurring || !actionEnabled(detail, "recurring_rule.update_future")) {
    return null;
  }
  const source = recurring;

  function submitUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(updateRecurringRuleFutureAction, {
      commandId: generateUuidV7(),
      recurringRuleId: source.ruleId,
      effectiveFrom,
      amountCents,
      description,
    });
  }

  function submitEnd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(endRecurringRuleAction, {
      commandId: generateUuidV7(),
      recurringRuleId: source.ruleId,
      endOn,
    });
  }

  return (
    <div className="space-y-4 rounded-xl border bg-background p-4" data-testid="forecast-recurring-maintenance">
      <div>
        <h3 className="font-semibold">Manter recorrência</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Alterações começam na data efetiva e preservam ocorrências anteriores.
        </p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={submitUpdate}>
        <Field label="Valor (centavos)">
          <input
            className={CONTROL_CLASS}
            disabled={isPending}
            inputMode="numeric"
            onChange={(event) => setAmountCents(event.target.value)}
            value={amountCents}
          />
        </Field>
        <Field label="Vigência a partir de">
          <input
            className={CONTROL_CLASS}
            disabled={isPending}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            type="date"
            value={effectiveFrom}
          />
        </Field>
        <Field label="Descrição">
          <textarea
            className={`${TEXTAREA_CLASS} sm:col-span-2`}
            disabled={isPending}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </Field>
        <div className="flex items-end sm:col-span-2">
          <button className={PRIMARY_BUTTON_CLASS} disabled={isPending} type="submit">
            {isPending ? "Salvando…" : "Salvar versão futura"}
          </button>
        </div>
      </form>
      <Feedback response={response} />
      {actionEnabled(detail, "recurring_rule.end") ? (
        <form className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end" noValidate onSubmit={submitEnd}>
          <Field label="Encerrar em">
            <input
              className={CONTROL_CLASS}
              disabled={isPending}
              onChange={(event) => setEndOn(event.target.value)}
              type="date"
              value={endOn}
            />
          </Field>
          <button className={OUTLINE_BUTTON_CLASS} disabled={isPending} type="submit">
            Encerrar recorrência
          </button>
        </form>
      ) : null}
    </div>
  );
}

function RecurringOccurrenceForm({ detail }: { detail: ForecastOriginDetail }) {
  const recurring = detail.recurring;
  const { isPending, response, run } = useSubmitFeedback();
  const [amountCents, setAmountCents] = React.useState(recurring?.amountCents ?? "");
  const [expectedOn, setExpectedOn] = React.useState(recurring?.expectedOn ?? "");
  const [financialEventId, setFinancialEventId] = React.useState("");
  const [isPartial, setIsPartial] = React.useState(false);

  if (!recurring?.occurrenceKey) return null;
  const source = recurring;
  const hasOverride = actionEnabled(detail, "recurring_occurrence.override");
  const hasCancel = actionEnabled(detail, "recurring_occurrence.cancel");
  const hasRealize = actionEnabled(detail, "recurring_occurrence.realize");
  if (!hasOverride && !hasCancel && !hasRealize) return null;

  function submitOverride(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(overrideRecurringOccurrenceAction, {
      commandId: generateUuidV7(),
      recurringRuleId: source.ruleId,
      occurrenceKey: source.occurrenceKey,
      ...(amountCents ? { amountCents } : {}),
      ...(expectedOn ? { expectedOn } : {}),
    });
  }

  function submitCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(cancelRecurringOccurrenceAction, {
      commandId: generateUuidV7(),
      recurringRuleId: source.ruleId,
      occurrenceKey: source.occurrenceKey,
    });
  }

  function submitRealize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(realizeRecurringOccurrenceAction, {
      commandId: generateUuidV7(),
      recurringRuleId: source.ruleId,
      occurrenceKey: source.occurrenceKey,
      financialEventId,
      isPartial,
    });
  }

  return (
    <div className="space-y-4 rounded-xl border bg-background p-4" data-testid="forecast-occurrence-maintenance">
      <div>
        <h3 className="font-semibold">Manter ocorrência {recurring.occurrenceKey}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          O override e o cancelamento valem somente para esta ocorrência da regra.
        </p>
      </div>
      {hasOverride ? (
        <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={submitOverride}>
          <Field label="Valor substituto (centavos)">
            <input
              className={CONTROL_CLASS}
              disabled={isPending}
              inputMode="numeric"
              onChange={(event) => setAmountCents(event.target.value)}
              value={amountCents}
            />
          </Field>
          <Field label="Data substituta">
            <input
              className={CONTROL_CLASS}
              disabled={isPending}
              onChange={(event) => setExpectedOn(event.target.value)}
              type="date"
              value={expectedOn}
            />
          </Field>
          <div className="sm:col-span-2">
            <button className={PRIMARY_BUTTON_CLASS} disabled={isPending} type="submit">
              {isPending ? "Salvando…" : "Salvar override"}
            </button>
          </div>
        </form>
      ) : null}
      {hasCancel ? (
        <form className="border-t pt-4" noValidate onSubmit={submitCancel}>
          <button className={OUTLINE_BUTTON_CLASS} disabled={isPending} type="submit">
            Cancelar esta ocorrência
          </button>
        </form>
      ) : null}
      {hasRealize ? (
        <form className="space-y-3 border-t pt-4" noValidate onSubmit={submitRealize}>
          <Field label="ID do lançamento POSTED para vincular">
            <input
              className={CONTROL_CLASS}
              disabled={isPending}
              onChange={(event) => setFinancialEventId(event.target.value)}
              placeholder="UUIDv7 do lançamento"
              value={financialEventId}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={isPartial}
              disabled={isPending}
              onChange={(event) => setIsPartial(event.target.checked)}
              type="checkbox"
            />
            Realização parcial explícita
          </label>
          <button className={PRIMARY_BUTTON_CLASS} disabled={isPending} type="submit">
            Vincular realização
          </button>
        </form>
      ) : null}
      <Feedback response={response} />
    </div>
  );
}

function PlannedEventForm({ detail }: { detail: ForecastOriginDetail }) {
  const planned = detail.plannedEvent;
  const { isPending, response, run } = useSubmitFeedback();
  const [amountCents, setAmountCents] = React.useState(planned?.amountCents ?? "");
  const [expectedOn, setExpectedOn] = React.useState(planned?.expectedOn ?? "");
  const [description, setDescription] = React.useState(planned?.description ?? "");

  if (!planned || !actionEnabled(detail, "planned_event.update")) return null;
  const source = planned;

  function submitUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(updatePlannedEventAction, {
      commandId: generateUuidV7(),
      plannedEventId: source.plannedEventId,
      amountCents,
      expectedOn,
      description,
    });
  }

  function submitCancel() {
    run(cancelPlannedEventAction, {
      commandId: generateUuidV7(),
      plannedEventId: source.plannedEventId,
    });
  }

  return (
    <div className="space-y-4 rounded-xl border bg-background p-4" data-testid="forecast-planned-event-maintenance">
      <div>
        <h3 className="font-semibold">Manter evento planejado</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          O evento permanece previsto até uma realização explícita.
        </p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={submitUpdate}>
        <Field label="Valor (centavos)">
          <input
            className={CONTROL_CLASS}
            disabled={isPending}
            inputMode="numeric"
            onChange={(event) => setAmountCents(event.target.value)}
            value={amountCents}
          />
        </Field>
        <Field label="Data esperada">
          <input
            className={CONTROL_CLASS}
            disabled={isPending}
            onChange={(event) => setExpectedOn(event.target.value)}
            type="date"
            value={expectedOn}
          />
        </Field>
        <Field label="Descrição">
          <textarea
            className={`${TEXTAREA_CLASS} sm:col-span-2`}
            disabled={isPending}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button className={PRIMARY_BUTTON_CLASS} disabled={isPending} type="submit">
            {isPending ? "Salvando…" : "Salvar evento"}
          </button>
          {actionEnabled(detail, "planned_event.cancel") ? (
            <button className={OUTLINE_BUTTON_CLASS} disabled={isPending} onClick={submitCancel} type="button">
              Cancelar evento
            </button>
          ) : null}
        </div>
      </form>
      <Feedback response={response} />
    </div>
  );
}

/**
 * Client-side controls receive only the server-authorized origin detail. No
 * form can target installments or submit household/status/ledger fields.
 */
export function ForecastOriginMaintenance({ detail }: { detail: ForecastOriginDetail }) {
  const blockedActions = detail.actions.filter((candidate) => !candidate.enabled);
  if (detail.kind === "INSTALLMENT" || detail.kind === "REALIZED_EVENT") {
    return null;
  }

  return (
    <section aria-labelledby="forecast-origin-actions-title" className="space-y-4" data-testid="forecast-origin-actions">
      <div>
        <h2 className="text-xl font-semibold" id="forecast-origin-actions-title">
          Ações permitidas
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ações futuras passam pelo domínio da fonte e atualizam a projeção após sucesso.
        </p>
      </div>
      <RecurringRuleForm detail={detail} />
      <RecurringOccurrenceForm detail={detail} />
      <PlannedEventForm detail={detail} />
      {blockedActions.length > 0 ? (
        <ul className="space-y-2 rounded-xl border border-dashed p-4 text-sm" data-testid="forecast-origin-blocked-actions">
          {blockedActions.map((candidate) => (
            <li className="flex flex-col gap-1 sm:flex-row sm:justify-between" key={candidate.operation}>
              <span className="font-medium">{candidate.label}</span>
              <span className="text-muted-foreground">
                {candidate.reason ?? actionReason(detail, candidate.operation) ?? "Indisponível"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
