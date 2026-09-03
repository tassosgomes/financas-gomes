import { ExportDataScreen } from "@/components/export/export-data-screen";

export const dynamic = "force-dynamic";

/** Settings route for S11 data portability (ADR-014, T10). */
export default function ExportDataSettingsPage() {
  return (
    <div data-testid="export-data-route">
      <ExportDataScreen />
    </div>
  );
}
