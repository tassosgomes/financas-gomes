import {
  captureNextRequestError,
  initializeEdgeSentry,
  type NextRequestErrorContext,
} from "@/modules/observability/server";

// Keep this file side-effect-only for the Next.js Sentry integration point.
initializeEdgeSentry();

export async function reportNextRequestError(
  error: unknown,
  context: NextRequestErrorContext,
): Promise<void> {
  await captureNextRequestError(error, context, "edge");
}
