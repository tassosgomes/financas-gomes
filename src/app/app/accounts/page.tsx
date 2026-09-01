import { redirect } from "next/navigation";

import { ACCOUNTS_ROUTE } from "@/modules/accounts-categories/routes";

/** Compatibility path while the authenticated home remains `/app`. */
export default function AppAccountsCompatibilityPage() {
  redirect(ACCOUNTS_ROUTE);
}
