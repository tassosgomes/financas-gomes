import { parseSentryConfig } from "./config";
import type { SentryRuntimeConfig } from "./contracts";

/**
 * Browser-only configuration. A DSN is public by design, but is read only
 * from NEXT_PUBLIC_* to keep server credentials out of the client bundle.
 */
export function getClientSentryConfig(): SentryRuntimeConfig {
  return parseSentryConfig({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    nodeEnvironment: process.env.NODE_ENV,
  });
}
