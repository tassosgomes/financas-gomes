"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  createPlannedEventAction,
  createRecurringRuleAction,
} from "@/app/actions/forecast-maintenance";
import { MoneyInput } from "@/components/transactions/money-input";
import { generateUuidV7 } from "@/lib/uuidv7";

const CONTROL_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const TEXTAREA_CLASS =
  "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

type CommitmentKind = "PLANNED_EVENT" | "RECURRING";
type ActionResponse = { ok: boolean; error?: { code?: unknown } };

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Entre para adicionar um compromisso.",
  INVALID_COMMAND: "Revise os dados informados.",
  INVALID_COMMAND_ID: "Não foi possível identificar esta operação. Tente novamente.",
  INVALID_AMOUNT: "Informe um valor positivo.",
  INVALID_DATE: "Informe uma data válida.",
  INVALID_DESCRIPTION: "Informe uma descrição válida.",
  INVALID_KIND: "Escolha um tipo válido.",
  INVALID_RULE: "Revise a frequência e o dia escolhido.",
  INVALID_RULE_RANGE: "Revise o intervalo de vigência.",
  CONFLICT: "A informação mudou em outra operação. Tente novamente.",
};

function errorMessage(response: ActionResponse | null): string | null {
  if (!response || response.ok) return null;
  const code = typeof response.error?.code === "string" ? response.error.code : "";
  return ERROR_MESSAGES[code] ?? "Não foi possível salvar o compromisso. Tente novamente.";
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

/** Small, source-specific creation form; tenant/status are never form fields. */
export function ForecastCreateCommitmentForm() {
  const router = useRouter();
  const [kind, setKind] = React.useState<CommitmentKind>("PLANNED_EVENT");
  const [eventKind, setEventKind] = React.useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [amountCents, setAmountCents] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [expectedOn, setExpectedOn] = React.useState("");
  const [frequency, setFrequency] = React.useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [dayRule, setDayRule] = React.useState<"FIXED_DAY" | "FIRST_BUSINESS_DAY" | "LAST_BUSINESS_DAY">("FIXED_DAY");
  const [dayOfMonth, setDayOfMonth] = React.useState("1");
  const [includeInConservativeForecast, setIncludeInConservativeForecast] = React.useState(true);
  const [isPending, startTransition] = React.useTransition();
  const [response, setResponse] = React.useState<ActionResponse | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResponse(null);
    const base = {
      commandId: generateUuidV7(),
      kind: eventKind,
      amountCents,
      description,
      includeInConservativeForecast,
    };
    const command =
      kind === "PLANNED_EVENT"
        ? { ...base, expectedOn }
        : {
            ...base,
            frequency,
            dayRule,
            ...(dayRule === "FIXED_DAY" ? { dayOfMonth: Number(dayOfMonth) } : {}),
            startOn: expectedOn,
          };
    startTransition(() => {
      void (kind === "PLANNED_EVENT"
        ? createPlannedEventAction(command)
        : createRecurringRuleAction(command)
      ).then((value) => {
        const result = value as ActionResponse;
        setResponse(result);
        if (result.ok) {
          router.push("/forecast");
          router.refresh();
        }
      });
    });
  }

  const message = errorMessage(response);
  return (
    <form className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-6" noValidate onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fonte">
          <select className={CONTROL_CLASS} disabled={isPending} onChange={(event) => setKind(event.target.value as CommitmentKind)} value={kind}>
            <option value="PLANNED_EVENT">Evento futuro</option>
            <option value="RECURRING">Recorrência</option>
          </select>
        </Field>
        <Field label="Tipo">
          <select className={CONTROL_CLASS} disabled={isPending} onChange={(event) => setEventKind(event.target.value as "EXPENSE" | "INCOME")} value={eventKind}>
            <option value="EXPENSE">Despesa</option>
            <option value="INCOME">Receita</option>
          </select>
        </Field>
        <Field label="Valor">
          <MoneyInput
            className={CONTROL_CLASS}
            disabled={isPending}
            onCentsChange={setAmountCents}
            value={amountCents}
          />
        </Field>
        <Field label={kind === "PLANNED_EVENT" ? "Data esperada" : "Início da vigência"}>
          <input className={CONTROL_CLASS} disabled={isPending} onChange={(event) => setExpectedOn(event.target.value)} type="date" value={expectedOn} />
        </Field>
        <Field label="Descrição">
          <textarea className={`${TEXTAREA_CLASS} sm:col-span-2`} disabled={isPending} onChange={(event) => setDescription(event.target.value)} value={description} />
        </Field>
      </div>
      {kind === "RECURRING" ? (
        <div className="grid gap-4 border-t pt-5 sm:grid-cols-3">
          <Field label="Frequência">
            <select className={CONTROL_CLASS} disabled={isPending} onChange={(event) => setFrequency(event.target.value as "MONTHLY" | "YEARLY")} value={frequency}>
              <option value="MONTHLY">Mensal</option>
              <option value="YEARLY">Anual</option>
            </select>
          </Field>
          <Field label="Regra de dia">
            <select className={CONTROL_CLASS} disabled={isPending} onChange={(event) => setDayRule(event.target.value as "FIXED_DAY" | "FIRST_BUSINESS_DAY" | "LAST_BUSINESS_DAY")} value={dayRule}>
              <option value="FIXED_DAY">Dia fixo</option>
              <option value="FIRST_BUSINESS_DAY">Primeiro dia útil</option>
              <option value="LAST_BUSINESS_DAY">Último dia útil</option>
            </select>
          </Field>
          {dayRule === "FIXED_DAY" ? (
            <Field label="Dia do mês">
              <input className={CONTROL_CLASS} disabled={isPending} max="31" min="1" onChange={(event) => setDayOfMonth(event.target.value)} type="number" value={dayOfMonth} />
            </Field>
          ) : null}
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input checked={includeInConservativeForecast} disabled={isPending} onChange={(event) => setIncludeInConservativeForecast(event.target.checked)} type="checkbox" />
        Incluir no cenário conservador
      </label>
      {message ? <p aria-live="polite" className="text-sm text-destructive" role="alert">{message}</p> : null}
      <button className={BUTTON_CLASS} disabled={isPending} type="submit">
        {isPending ? "Salvando…" : "Adicionar compromisso"}
      </button>
    </form>
  );
}
