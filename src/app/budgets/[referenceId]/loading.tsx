import { LoadingState } from "@/components/ui/async-state";

export default function BudgetDetailLoading() {
  return <LoadingState label="Carregando detalhe da Caixinha…" testId="budget-detail-loading" />;
}
