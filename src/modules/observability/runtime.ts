import * as Sentry from "@sentry/nextjs";
import type { Breadcrumb } from "@sentry/core";

import type {
  ObservabilityContext,
  SentryRuntimeConfig,
} from "./contracts";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
  toSafeObservabilityContext,
} from "./sanitize";

let sentryInitialized = false;

function traceSampleRate(environment: string): number {
  return environment === "development" ? 1 : 0.1;
}

function shouldDropTrace(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("/api/health") || normalized.includes("/api/readiness");
}

/** Initialize with an already selected runtime config. */
export function initializeConfiguredSentry(
  config: SentryRuntimeConfig,
): boolean {
  if (sentryInitialized) {
    return true;
  }

  if (!config.dsn) {
    return false;
  }

  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      sendDefaultPii: false,
      // Trace all local requests and sample production traffic conservatively.
      // Health/readiness probes add noise and are intentionally dropped.
      tracesSampler: ({ name, inheritOrSampleWith }) =>
        shouldDropTrace(name)
          ? 0
          : inheritOrSampleWith(traceSampleRate(config.environment)),
      beforeSend: sanitizeSentryEvent,
      beforeSendSpan: sanitizeSentrySpan,
      beforeSendTransaction: sanitizeSentryTransaction,
      beforeBreadcrumb: sanitizeSentryBreadcrumb,
      maxBreadcrumbs: 20,
    });
    sentryInitialized = true;
    return true;
  } catch {
    return false;
  }
}

/** Capture only through the sanitized scope; never pass request/payload data. */
export function captureExceptionSafely(
  error: unknown,
  context?: ObservabilityContext,
): string | undefined {
  try {
    const safe = toSafeObservabilityContext(context);
    let eventId: string | undefined;

    Sentry.withScope((scope) => {
      if (Object.keys(safe.tags).length > 0) {
        scope.setTags(safe.tags);
      }
      if (Object.keys(safe.context).length > 0) {
        scope.setContext("observability", safe.context);
      }

      eventId = Sentry.captureException(error, {
        mechanism: {
          type: "generic",
          handled: false,
        },
      });
    });

    return eventId || undefined;
  } catch {
    return undefined;
  }
}

/** Adds a sanitized technical breadcrumb without making Sentry a dependency. */
export function addBreadcrumbSafely(breadcrumb: Breadcrumb): void {
  try {
    const safe = sanitizeSentryBreadcrumb(breadcrumb);
    if (safe) {
      Sentry.addBreadcrumb(safe);
    }
  } catch {
    // A breadcrumb must never alter the application operation.
  }
}

export async function flushSentrySafely(timeoutMs = 2_000): Promise<boolean> {
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

export interface NextRequestErrorContext {
  routerKind: string;
  routePath: string;
  routeType: string;
  renderSource?: string;
}

/** Captures Next's server/edge request errors without forwarding the request. */
export async function captureNextRequestError(
  error: unknown,
  context: NextRequestErrorContext,
  initialize: () => boolean,
): Promise<void> {
  try {
    initialize();
    captureExceptionSafely(error, {
      event: "next_request_error",
      useCase: context.routeType,
      route: context.routePath,
    });
    await flushSentrySafely();
  } catch {
    // Observability is best effort and must never change the response path.
  }
}
