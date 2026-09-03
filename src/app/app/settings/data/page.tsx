import { redirect } from "next/navigation";

import { EXPORT_SETTINGS_ROUTE } from "@/modules/export/routes";

/** Compatibility path for callers that prefix private routes with `/app`. */
export default function AppExportDataCompatibilityPage() {
  redirect(EXPORT_SETTINGS_ROUTE);
}
