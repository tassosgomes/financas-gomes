import { redirect } from "next/navigation";

import { CATEGORIES_SETTINGS_ROUTE } from "@/modules/accounts-categories/routes";

/** Compatibility path for callers that prefix private routes with `/app`. */
export default function AppCategoriesCompatibilityPage() {
  redirect(CATEGORIES_SETTINGS_ROUTE);
}
