import { LoadingState } from "@/components/ui/async-state";

export default function AccountsLoading() {
  return <LoadingState label="Carregando contas…" testId="accounts-loading" />;
}
