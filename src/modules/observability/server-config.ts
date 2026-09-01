import { parseSentryConfig } from "./config";
import type { SentryRuntimeConfig } from "./contracts";

/**
 * Server-only configuration. Keep private SENTRY_* reads in this module so
 * client imports can never embed the server DSN in the browser bundle.
 */
export function getServerSentryConfig(): SentryRuntimeConfig {
  return parseSentryConfig({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT,
    release:
      process.env.SENTRY_RELEASE ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA,
    nodeEnvironment: process.env.NODE_ENV,
  });
}

export const getEdgeSentryConfig = getServerSentryConfig;
