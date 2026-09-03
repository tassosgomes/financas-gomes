import { LoadingState } from "@/components/ui/async-state";

export default function BudgetsLoading() {
  return <LoadingState label="Carregando Caixinhas…" testId="budgets-route-loading" />;
}
