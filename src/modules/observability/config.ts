import type { SentryRuntimeConfig } from "./contracts";

const DEFAULT_SENTRY_ENVIRONMENT = "development";

export type SentryConfigInput = {
  dsn?: string;
  environment?: string;
  release?: string;
  nodeEnvironment?: string;
};

function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function validDsn(value: string | undefined): string | undefined {
  const dsn = optionalString(value);
  if (!dsn) {
    return undefined;
  }

  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return dsn;
}

/**
 * Parses only Sentry settings. It intentionally does not call getServerEnv,
 * so a missing database or OAuth setting can never stop the error reporter
 * from starting (or stop the app from starting when Sentry is disabled).
 */
export function parseSentryConfig(
  input: SentryConfigInput,
): SentryRuntimeConfig {
  return {
    dsn: validDsn(input.dsn),
    environment:
      optionalString(input.environment) ??
      optionalString(input.nodeEnvironment) ??
      DEFAULT_SENTRY_ENVIRONMENT,
    release: optionalString(input.release),
  };
}
