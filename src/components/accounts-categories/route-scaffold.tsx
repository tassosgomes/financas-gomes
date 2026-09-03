import { EmptyState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";

export interface FeatureRouteScaffoldProps {
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  testId: string;
}

/**
 * Route-level placeholder used while T05/T06 and T08/T09 are being wired.
 * It keeps the authenticated route and shared states stable for the real
 * collection components that will replace the empty state.
 */
export function FeatureRouteScaffold({
  eyebrow,
  title,
  description,
  emptyTitle,
  emptyDescription,
  testId,
}: FeatureRouteScaffoldProps) {
  return (
    <section className="space-y-6" data-testid={testId}>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState title={emptyTitle} description={emptyDescription} />
    </section>
  );
}
