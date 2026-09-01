import { listAccountsAction } from "@/app/actions/accounts";
import {
  confirmCsvImportAction,
  findCsvImportReportAction,
  previewCsvImportAction,
} from "@/app/actions/transaction-imports";
import { CsvImportScreen } from "@/components/transaction-imports";
import { ErrorState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { toCsvImportResultViewModel } from "@/modules/transaction-imports/ui-contracts";
import { TRANSACTION_IMPORT_ROUTE } from "@/modules/transactions/routes";

export const dynamic = "force-dynamic";

type TransactionImportSearchParams = Record<
  string,
  string | string[] | undefined
>;

function scalarImportId(
  searchParams: TransactionImportSearchParams | undefined,
): string | undefined {
  const value = searchParams?.importId;
  if (Array.isArray(value)) {
    return undefined;
  }
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Resolves only active, tenant-scoped account display options on the server.
 * The client receives the selected ID as an untrusted preview hint; T06/T07
 * revalidate account and household authority inside their server boundaries.
 */
export default async function TransactionImportPage({
  searchParams,
}: {
  searchParams?: Promise<TransactionImportSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const importId = scalarImportId(resolvedSearchParams);
  const [accountsResult, report] = await Promise.all([
    listAccountsAction({ status: "ACTIVE" }),
    importId
      ? findCsvImportReportAction(importId).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  if (!accountsResult.ok) {
    return (
      <section className="space-y-6" data-testid="csv-import-route-error">
        <PageHeader
          description="Envie um CSV normalizado e revise os lançamentos antes de confirmar."
          eyebrow="Movimentações"
          title="Importar extrato CSV"
        />
        <ErrorState
          message={accountsResult.error.message}
          retryHref={TRANSACTION_IMPORT_ROUTE}
          testId="csv-import-accounts-load-error"
        />
      </section>
    );
  }

  const accounts = accountsResult.value.items.map((account) => ({
    id: account.id,
    name: account.name,
    status: account.status,
  }));

  return (
    <CsvImportScreen
      accounts={accounts}
      confirmationAction={confirmCsvImportAction}
      initialResult={report ? toCsvImportResultViewModel(report) : undefined}
      previewAction={previewCsvImportAction}
    />
  );
}
