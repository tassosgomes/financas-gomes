import type { ObservabilityContext } from "./contracts";
import {
  getEdgeSentryConfig,
  getServerSentryConfig,
} from "./server-config";
import {
  captureExceptionSafely,
  captureNextRequestError as captureNextRequestErrorWithRuntime,
  addBreadcrumbSafely,
  flushSentrySafely,
  initializeConfiguredSentry,
  type NextRequestErrorContext,
} from "./runtime";

export type { NextRequestErrorContext } from "./runtime";

export function initializeServerSentry(): boolean {
  return initializeConfiguredSentry(getServerSentryConfig());
}

export function initializeEdgeSentry(): boolean {
  return initializeConfiguredSentry(getEdgeSentryConfig());
}

export function captureServerException(
  error: unknown,
  context?: ObservabilityContext,
): string | undefined {
  initializeServerSentry();
  return captureExceptionSafely(error, context);
}

export async function captureNextRequestError(
  error: unknown,
  context: NextRequestErrorContext,
  runtime: "server" | "edge" = "server",
): Promise<void> {
  await captureNextRequestErrorWithRuntime(
    error,
    context,
    runtime === "edge" ? initializeEdgeSentry : initializeServerSentry,
  );
}

export { addBreadcrumbSafely, flushSentrySafely };
