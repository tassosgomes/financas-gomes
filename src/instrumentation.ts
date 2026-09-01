import type { Instrumentation } from "next";

/**
 * Load the runtime-specific Sentry entrypoint. Next evaluates this hook for
 * both Node and Edge, so runtime-only dependencies must stay behind imports.
 */
export async function register(): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
      return;
    }

    await import("./sentry.server.config");
  } catch {
    // Instrumentation is best effort and cannot prevent the app from booting.
  }
}

/** Capture errors Next.js catches outside a route's own error boundary. */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  try {
    if (process.env.NEXT_RUNTIME === "edge") {
      const { reportNextRequestError } = await import("./sentry.edge.config");
      await reportNextRequestError(error, {
        routerKind: context.routerKind,
        routePath: context.routePath,
        routeType: context.routeType,
        renderSource: context.renderSource,
      });
      return;
    }

    const { reportNextRequestError } = await import("./sentry.server.config");
    await reportNextRequestError(error, {
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
    });
  } catch {
    // A Sentry outage or configuration error must not affect the response.
  }
};
