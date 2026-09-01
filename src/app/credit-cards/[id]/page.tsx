import { notFound } from "next/navigation";

import { listAccountsAction } from "@/app/actions/accounts";
import { getCreditCardAction } from "@/app/actions/credit-cards";
import { getCreditCardProjectionAction } from "@/app/actions/credit-card-projections";
import {
  CreditCardBillingScreen,
} from "@/components/credit-cards/billing-screen";
import {
  CreditCardMaintenance,
  type CreditCardAccountOption,
} from "@/components/credit-cards/card-management-screen";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { isUuidV7 } from "@/lib/uuidv7";
import type {
  CreditCardProjectionReadModel,
  CreditCardStatementReadModel,
} from "@/modules/credit-cards/contracts";
import {
  CREDIT_CARD_ROUTES,
  parseCreditCardPeriodFilter,
  toCreditCardErrorViewModel,
  type AccountOptionViewModel,
  type CreditCardPaymentStatusViewModel,
  type CreditCardProjectionSummaryViewModel,
  type CreditCardStatementViewModel,
} from "@/components/credit-cards/ui-contracts";

export const dynamic = "force-dynamic";

interface CreditCardDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function toStatementViewModel(
  statement: CreditCardStatementReadModel,
): CreditCardStatementViewModel {
  return {
    period: statement.period,
    kind: statement.kind,
    dueOn: statement.dueOn,
    totalAmountCents: statement.totalAmountCents,
    items: statement.items.map((item) => ({
      referenceId: item.referenceId,
      purchaseId: item.purchaseId,
      installmentId: item.installmentId,
      description: item.description,
      amountCents: item.amountCents,
      occurredOn: item.occurredOn,
      billingCycle: item.billingCycle,
      dueOn: item.dueOn,
      installmentNumber: item.installmentNumber,
      installmentCount: item.installmentCount,
      state: item.state,
    })),
  };
}

function toProjectionSummaryViewModel(
  summary: CreditCardProjectionReadModel["summary"],
): CreditCardProjectionSummaryViewModel {
  return {
    currentStatementAmountCents: summary.currentStatementAmountCents,
    projectedStatementAmountCents: summary.projectedStatementAmountCents,
    outstandingCardObligationCents: summary.outstandingCardObligationCents,
    committedCreditLimitCents: summary.committedCreditLimitCents,
    availableCreditLimitCents: summary.availableCreditLimitCents,
    cardCreditBalanceCents: summary.cardCreditBalanceCents,
    asOf: summary.asOf,
  };
}

/** Global payment status is derived server-side; the client receives no raw projection. */
function toPaymentStatusViewModel(
  summary: CreditCardProjectionReadModel["summary"],
): CreditCardPaymentStatusViewModel {
  return {
    state: summary.paymentState,
    statementAmountCents: summary.contractualObligationCents,
    paidAmountCents: summary.totalPaidAmountCents,
    remainingAmountCents: summary.outstandingCardObligationCents,
    creditAmountCents: summary.cardCreditBalanceCents,
  };
}

function routeError(message: string) {
  return (
    <section className="space-y-6" data-testid="credit-card-detail-route-error">
      <PageHeader
        description="Consulte a configuração contratual e as versões de cobrança do cartão."
        eyebrow="Cartões"
        title="Detalhe do cartão"
      />
      <ErrorState
        message={message}
        retryHref={CREDIT_CARD_ROUTES.collection}
        testId="credit-card-detail-route-error-state"
      />
    </section>
  );
}

export default async function CreditCardDetailPage({
  params,
  searchParams,
}: CreditCardDetailPageProps) {
  const { id } = await params;
  if (!isUuidV7(id)) notFound();

  let cardResult: Awaited<ReturnType<typeof getCreditCardAction>>;
  try {
    cardResult = await getCreditCardAction({ cardId: id });
  } catch {
    return routeError("Não foi possível carregar o cartão. Tente novamente.");
  }

  if (!cardResult.ok) {
    if (cardResult.error.code === "CARD_NOT_FOUND" || cardResult.error.code === "CREDIT_CARD_NOT_FOUND") {
      notFound();
    }
    return routeError(toCreditCardErrorViewModel(cardResult.error).message);
  }

  let accountsResult: Awaited<ReturnType<typeof listAccountsAction>> | null = null;
  let accountsLoadError: unknown = null;
  try {
    accountsResult = await listAccountsAction({ status: "ALL" });
  } catch {
    accountsLoadError = { code: "RETRYABLE_ERROR" };
  }
  if (accountsResult && !accountsResult.ok) {
    accountsLoadError = accountsResult.error;
  }

  const accountItems = accountsResult?.ok ? accountsResult.value.items : [];
  const accounts: CreditCardAccountOption[] = accountItems.map((account) => ({
      id: account.id,
      name: account.name,
      status: account.status,
      type: account.type,
    }));

  const filters = parseCreditCardPeriodFilter((await searchParams) ?? {});
  const projectionQuery = {
    cardId: id,
    ...(filters.cycle ? { period: filters.cycle } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  };
  let projectionResult: Awaited<ReturnType<typeof getCreditCardProjectionAction>> | null = null;
  let projectionLoadError: unknown = null;
  try {
    projectionResult = await getCreditCardProjectionAction(projectionQuery);
  } catch {
    projectionLoadError = { code: "RETRYABLE_ERROR" };
  }

  const projection = projectionResult?.ok ? projectionResult.value : null;
  const projectionError = projectionResult && !projectionResult.ok
    ? projectionResult.error
    : projectionLoadError;
  const projectionState = projection
    ? ("ready" as const)
    : ("error" as const);
  const currentStatement = projection && projection.current.items.length > 0
    ? toStatementViewModel(projection.current)
    : null;
  const futureStatements = projection
    ? projection.statements
        .filter((statement) => statement.kind === "FUTURE" && statement.items.length > 0)
        .map(toStatementViewModel)
    : [];
  const projectionSummary = projection
    ? toProjectionSummaryViewModel(projection.summary)
    : null;
  const paymentStatus = projection
    ? toPaymentStatusViewModel(projection.summary)
    : null;

  return (
    <section className="space-y-6" data-testid="credit-card-detail-route">
      <PageHeader
        description="Limite contratual, faturas projetadas e pagamento global do cartão."
        eyebrow="Cartões"
        title={cardResult.value.name}
      />
      <CreditCardMaintenance accounts={accounts} card={cardResult.value} />
      <CreditCardBillingScreen
        accounts={accounts as AccountOptionViewModel[]}
        accountsError={accountsLoadError}
        accountsState={accountsResult?.ok ? "ready" : "error"}
        cardId={cardResult.value.id}
        cardName={cardResult.value.name}
        cardStatus={cardResult.value.status}
        currentStatement={currentStatement}
        defaultSourceAccountId={cardResult.value.defaultPaymentAccountId}
        futureStatements={futureStatements}
        paymentStatus={paymentStatus}
        projectionError={projectionError}
        projectionState={projectionState}
        projectionSummary={projectionSummary}
        retryHref={CREDIT_CARD_ROUTES.collection}
      />
    </section>
  );
}
