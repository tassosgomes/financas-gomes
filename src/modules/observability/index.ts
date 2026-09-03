export * from "./contracts";
export * from "./config";
export * from "./sanitize";
export {
  addBreadcrumbSafely,
  captureExceptionSafely,
  flushSentrySafely,
  initializeConfiguredSentry,
} from "./runtime";
export type { NextRequestErrorContext } from "./runtime";
export * from "./client-config";
export * from "./server-config";
export * from "./client";
export * from "./server";
export * from "./logger";
export * from "./accounts-categories";
export * from "./transactions";
export * from "./csv-import";
export * from "./forecast";
export * from "./spendable";
export * from "./s09";
export * from "./s11";

import { getClientSentryConfig } from "./client-config";
import {
  getEdgeSentryConfig,
  getServerSentryConfig,
} from "./server-config";
import { initializeConfiguredSentry } from "./runtime";
import type { SentryRuntime } from "./contracts";

/** Runtime-neutral convenience initializer for server-side callers/tests. */
export function initializeSentry(runtime: SentryRuntime): boolean {
  const config =
    runtime === "client"
      ? getClientSentryConfig()
      : runtime === "edge"
        ? getEdgeSentryConfig()
        : getServerSentryConfig();

  return initializeConfiguredSentry(config);
}
