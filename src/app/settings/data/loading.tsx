import { LoadingState } from "@/components/ui/async-state";

export default function ExportDataLoading() {
  return (
    <LoadingState label="Carregando seus dados…" testId="export-data-loading" />
  );
}
