import { getOverviewAction } from "@/app/actions/overview";
import { OverviewHome, OverviewPageError } from "@/components/overview/overview-home";

/** The authenticated overview reads the consolidated S10 read model server-side. */
export default async function AuthenticatedHomePage() {
  const overview = await getOverviewAction();

  if (!overview.ok) {
    return <OverviewPageError error={overview.error} />;
  }

  return <OverviewHome model={overview.value} />;
}
