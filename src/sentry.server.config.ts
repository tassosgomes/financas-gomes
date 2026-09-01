import {
  captureNextRequestError,
  initializeServerSentry,
  type NextRequestErrorContext,
} from "@/modules/observability/server";

// Keep this file side-effect-only for the Next.js Sentry integration point.
initializeServerSentry();

export async function reportNextRequestError(
  error: unknown,
  context: NextRequestErrorContext,
): Promise<void> {
  await captureNextRequestError(error, context, "server");
}
