import { LoadingState } from "@/components/ui/async-state";

export default function TransactionsLoading() {
  return (
    <LoadingState
      label="Carregando lançamentos…"
      testId="transactions-loading"
    />
  );
}
