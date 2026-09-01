import { captureRouterTransitionStart } from "@sentry/nextjs";

import { initializeClientSentry } from "@/modules/observability/client";

try {
  initializeClientSentry();
} catch {
  // Client instrumentation must never prevent React from becoming interactive.
}

/** Enables App Router navigation spans after the sanitized client init. */
export const onRouterTransitionStart = captureRouterTransitionStart;
