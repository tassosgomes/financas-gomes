import type { ObservabilityContext } from "./contracts";
import { getClientSentryConfig } from "./client-config";
import {
  captureExceptionSafely,
  initializeConfiguredSentry,
} from "./runtime";

export function initializeClientSentry(): boolean {
  return initializeConfiguredSentry(getClientSentryConfig());
}

export function captureClientException(
  error: unknown,
  context?: ObservabilityContext,
): string | undefined {
  initializeClientSentry();
  return captureExceptionSafely(error, context);
}
