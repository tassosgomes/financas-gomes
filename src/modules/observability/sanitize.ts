import type {
  Breadcrumb,
  ErrorEvent,
  Event,
  Exception,
  Mechanism,
  SpanJSON,
  StackFrame,
  TransactionEvent,
} from "@sentry/core";

import {
  SENSITIVE_OBSERVABILITY_FIELDS,
  type ObservabilityContext,
} from "./contracts";

const sensitiveKeys = new Set(
  SENSITIVE_OBSERVABILITY_FIELDS.map((field) =>
    field.toLowerCase().replaceAll("-", "").replaceAll("_", ""),
  ),
);

const safeTagKeys = new Set([
  "event",
  "usecase",
  "operation",
  "entitytype",
  "entityid",
  "cardid",
  "purchaseid",
  "installmentplanid",
  "installmentid",
  "billingruleid",
  "paymentid",
  "eventid",
  "transactionkind",
  "durationms",
  "requestid",
  "userid",
  "householdid",
  "route",
  "statuscode",
  "stage",
  "previewid",
  "importid",
  "accountid",
  "errorcode",
  "processedrows",
  "validrows",
  "invalidrows",
  "ignoredduplicaterows",
  "importedrows",
  "forecaststage",
  "forecastscenario",
  "forecastsourcekind",
  "forecastperiodbucket",
  "forecastquerycode",
  "forecastsourcecount",
  "forecastrecurringcount",
  "forecastplannedeventcount",
  "forecastinstallmentcount",
  "forecastrealizedeventcount",
  "forecastcancelledcount",
  "forecastitemcount",
  "forecastprojecteditemcount",
  "forecastrealizeditemcount",
  "forecastperiodcount",
  "forecastdaycount",
  "forecastquerybudgetms",
  "forecastslowquery",
  "forecastbudgetexceeded",
]);

const safeMeasurementKeys = new Set([
  "cls",
  "fcp",
  "fid",
  "inp",
  "lcp",
  "tbt",
  "ttfb",
  "frames_total",
  "frames_slow",
  "frames_frozen",
  "http.request.connection_end",
  "http.request.connect_end",
  "http.request.connect_start",
  "http.request.domain_lookup_end",
  "http.request.domain_lookup_start",
  "http.request.fetch_start",
  "http.request.redirect_end",
  "http.request.redirect_start",
  "http.request.request_start",
  "http.request.response_end",
  "http.request.response_start",
  "http.request.secure_connection_start",
  "http.response_content_length",
]);

// Contexts are received from SDK integrations as untrusted records. Keep
// numeric/boolean values closed as well; otherwise a key such as
// `amountCents` could bypass the string-only field allow-list below.
const safeContextScalarKeys = new Set([
  "durationms",
  "statuscode",
  "processedrows",
  "validrows",
  "invalidrows",
  "ignoredduplicaterows",
  "importedrows",
  "forecastsourcecount",
  "forecastrecurringcount",
  "forecastplannedeventcount",
  "forecastinstallmentcount",
  "forecastrealizedeventcount",
  "forecastcancelledcount",
  "forecastitemcount",
  "forecastprojecteditemcount",
  "forecastrealizeditemcount",
  "forecastperiodcount",
  "forecastdaycount",
  "forecastquerybudgetms",
  "forecastslowquery",
  "forecastbudgetexceeded",
]);

const secretPatterns = [
  /(?:authorization|bearer)\s*[:=]\s*\S+/giu,
  /(?:access|refresh|invite|session|id)?[-_ ]?token\s*[:=]\s*\S+/giu,
  /(?:cookie|set-cookie)\s*[:=]\s*\S+/giu,
  /(?:password|secret)\s*[:=]\s*\S+/giu,
  /(?:amount|description|account(?:name|_name)?|notes?|currency|merchant|category|value)\s*[:=]\s*\S+/giu,
];

function compact<T extends Record<string, unknown>>(value: T): T {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      delete value[key];
    }
  }

  return value;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll("-", "").replaceAll("_", "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    sensitiveKeys.has(normalized) ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token")
  );
}

function safeText(value: string | undefined, maxLength = 256): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return secretPatterns.reduce(
    (result, pattern) => result.replace(pattern, "[redacted]"),
    normalized,
  ).slice(0, maxLength);
}

function safeOperationalName(value: string | undefined): string | undefined {
  const text = safeText(value, 160);
  return text && /^[A-Za-z][A-Za-z0-9_.-]*$/u.test(text) ? text : undefined;
}

function safeRoute(value: string | undefined): string | undefined {
  const text = safeText(value, 512);
  if (!text) {
    return undefined;
  }

  try {
    // URL accepts both absolute URLs and route-like values with a base.
    const parsed = new URL(text, "http://observability.invalid");
    return parsed.pathname || "/";
  } catch {
    return text.split(/[?#]/u, 1)[0] || "/";
  }
}

/**
 * Keeps trace names useful while replacing identifier-like path segments.
 * Query strings are already removed by safeRoute, but path segments can also
 * contain bearer-like invite values or opaque resource IDs.
 */
function safeTraceRoute(value: string | undefined): string | undefined {
  const route = safeRoute(value);
  if (!route) {
    return undefined;
  }

  return route
    .split("/")
    .map((segment) => {
      if (!segment) {
        return segment;
      }

      if (
        /^\d+$/u.test(segment) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          segment,
        ) ||
        (segment.length >= 16 && /^[A-Za-z0-9._~-]+$/u.test(segment))
      ) {
        return ":id";
      }

      return segment;
    })
    .join("/");
}

function safeTraceName(value: string | undefined): string | undefined {
  const text = safeText(value, 240);
  if (!text) {
    return undefined;
  }

  const methodAndTarget = /^([A-Z]+)\s+(.+)$/u.exec(text);
  if (methodAndTarget) {
    const method = safeOperationalName(methodAndTarget[1]);
    const target = safeTraceRoute(methodAndTarget[2]);
    if (method && target) {
      return `${method} ${target}`;
    }
  }

  if (text.startsWith("/") || /^https?:\/\//iu.test(text)) {
    return safeTraceRoute(text);
  }

  return safeOperationalName(text);
}

function safeOpaqueId(value: string | undefined): string | undefined {
  const text = safeText(value, 160);
  return text && /^[A-Za-z0-9._:/-]+$/u.test(text) ? text : undefined;
}

function safeMechanism(mechanism: Mechanism | undefined): Mechanism | undefined {
  if (!mechanism) {
    return undefined;
  }

  return compact({
    type: safeText(mechanism.type, 80) ?? "generic",
    handled: mechanism.handled,
    synthetic: mechanism.synthetic,
    source: safeText(mechanism.source, 80),
    is_exception_group: mechanism.is_exception_group,
    exception_id: mechanism.exception_id,
    parent_id: mechanism.parent_id,
    // mechanism.data is intentionally omitted: browser event targets can
    // contain input values and server integrations can add request payloads.
  });
}

function safeStackFrame(frame: StackFrame): StackFrame {
  return compact({
    filename: safeText(frame.filename, 512),
    function: safeText(frame.function, 200),
    module: safeText(frame.module, 200),
    platform: safeText(frame.platform, 80),
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
    debug_id: safeText(frame.debug_id, 160),
    // abs_path, source context and vars are omitted to avoid source/data
    // values being attached by an error integration.
  });
}

function safeException(exception: Exception): Exception {
  return compact({
    type: safeText(exception.type, 120) ?? "Error",
    // Error messages are not trusted input. Keep the event useful while
    // avoiding a database/provider message becoming a financial data leak.
    value: "Unexpected application error",
    mechanism: safeMechanism(exception.mechanism),
    module: safeText(exception.module, 200),
    thread_id:
      typeof exception.thread_id === "number"
        ? exception.thread_id
        : safeOpaqueId(exception.thread_id),
    stacktrace: exception.stacktrace
      ? compact({
          frames: exception.stacktrace.frames?.map(safeStackFrame),
          frames_omitted: exception.stacktrace.frames_omitted,
        })
      : undefined,
  });
}

function safeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  const safeData =
    data && typeof data === "object"
      ? compact({
          stage:
            typeof data.stage === "string"
              ? safeOperationalName(data.stage)
              : undefined,
          operation:
            typeof data.operation === "string"
              ? safeOperationalName(data.operation)
              : undefined,
          transaction_kind:
            typeof data.transaction_kind === "string"
              ? safeOperationalName(data.transaction_kind)
              : undefined,
          event_id:
            typeof data.event_id === "string"
              ? safeOpaqueId(data.event_id)
              : undefined,
          preview_id:
            typeof data.preview_id === "string"
              ? safeOpaqueId(data.preview_id)
              : undefined,
          import_id:
            typeof data.import_id === "string"
              ? safeOpaqueId(data.import_id)
              : undefined,
          account_id:
            typeof data.account_id === "string"
              ? safeOpaqueId(data.account_id)
              : undefined,
          card_id:
            typeof data.card_id === "string"
              ? safeOpaqueId(data.card_id)
              : undefined,
          purchase_id:
            typeof data.purchase_id === "string"
              ? safeOpaqueId(data.purchase_id)
              : undefined,
          installment_plan_id:
            typeof data.installment_plan_id === "string"
              ? safeOpaqueId(data.installment_plan_id)
              : undefined,
          installment_id:
            typeof data.installment_id === "string"
              ? safeOpaqueId(data.installment_id)
              : undefined,
          billing_rule_id:
            typeof data.billing_rule_id === "string"
              ? safeOpaqueId(data.billing_rule_id)
              : undefined,
          payment_id:
            typeof data.payment_id === "string"
              ? safeOpaqueId(data.payment_id)
              : undefined,
          request_id:
            typeof data.request_id === "string"
              ? safeOpaqueId(data.request_id)
              : undefined,
          outcome:
            typeof data.outcome === "string"
              ? safeOperationalName(data.outcome)
              : undefined,
          error_code:
            typeof data.error_code === "string" &&
            /^[A-Z][A-Z0-9_]{1,63}$/u.test(data.error_code)
              ? data.error_code
              : undefined,
          duration_ms:
            typeof data.duration_ms === "number" &&
            Number.isFinite(data.duration_ms)
              ? Math.max(0, Math.round(data.duration_ms))
              : undefined,
          processed_rows:
            typeof data.processed_rows === "number" &&
            Number.isFinite(data.processed_rows)
              ? Math.max(0, Math.round(data.processed_rows))
              : undefined,
          valid_rows:
            typeof data.valid_rows === "number" &&
            Number.isFinite(data.valid_rows)
              ? Math.max(0, Math.round(data.valid_rows))
              : undefined,
          invalid_rows:
            typeof data.invalid_rows === "number" &&
            Number.isFinite(data.invalid_rows)
              ? Math.max(0, Math.round(data.invalid_rows))
              : undefined,
          ignored_duplicate_rows:
            typeof data.ignored_duplicate_rows === "number" &&
            Number.isFinite(data.ignored_duplicate_rows)
              ? Math.max(0, Math.round(data.ignored_duplicate_rows))
              : undefined,
          imported_rows:
            typeof data.imported_rows === "number" &&
            Number.isFinite(data.imported_rows)
              ? Math.max(0, Math.round(data.imported_rows))
              : undefined,
          forecast_stage:
            typeof data.forecast_stage === "string"
              ? safeOperationalName(data.forecast_stage)
              : undefined,
          forecast_scenario:
            typeof data.forecast_scenario === "string"
              ? safeOperationalName(data.forecast_scenario)
              : undefined,
          forecast_source_kind:
            typeof data.forecast_source_kind === "string"
              ? safeOperationalName(data.forecast_source_kind)
              : undefined,
          forecast_period_bucket:
            typeof data.forecast_period_bucket === "string"
              ? safeOperationalName(data.forecast_period_bucket)
              : undefined,
          forecast_query_code:
            typeof data.forecast_query_code === "string"
              ? safeOperationalName(data.forecast_query_code)
              : undefined,
          forecast_source_count:
            typeof data.forecast_source_count === "number" &&
            Number.isFinite(data.forecast_source_count)
              ? Math.max(0, Math.round(data.forecast_source_count))
              : undefined,
          forecast_recurring_count:
            typeof data.forecast_recurring_count === "number" &&
            Number.isFinite(data.forecast_recurring_count)
              ? Math.max(0, Math.round(data.forecast_recurring_count))
              : undefined,
          forecast_planned_event_count:
            typeof data.forecast_planned_event_count === "number" &&
            Number.isFinite(data.forecast_planned_event_count)
              ? Math.max(0, Math.round(data.forecast_planned_event_count))
              : undefined,
          forecast_installment_count:
            typeof data.forecast_installment_count === "number" &&
            Number.isFinite(data.forecast_installment_count)
              ? Math.max(0, Math.round(data.forecast_installment_count))
              : undefined,
          forecast_realized_event_count:
            typeof data.forecast_realized_event_count === "number" &&
            Number.isFinite(data.forecast_realized_event_count)
              ? Math.max(0, Math.round(data.forecast_realized_event_count))
              : undefined,
          forecast_cancelled_count:
            typeof data.forecast_cancelled_count === "number" &&
            Number.isFinite(data.forecast_cancelled_count)
              ? Math.max(0, Math.round(data.forecast_cancelled_count))
              : undefined,
          forecast_item_count:
            typeof data.forecast_item_count === "number" &&
            Number.isFinite(data.forecast_item_count)
              ? Math.max(0, Math.round(data.forecast_item_count))
              : undefined,
          forecast_projected_item_count:
            typeof data.forecast_projected_item_count === "number" &&
            Number.isFinite(data.forecast_projected_item_count)
              ? Math.max(0, Math.round(data.forecast_projected_item_count))
              : undefined,
          forecast_realized_item_count:
            typeof data.forecast_realized_item_count === "number" &&
            Number.isFinite(data.forecast_realized_item_count)
              ? Math.max(0, Math.round(data.forecast_realized_item_count))
              : undefined,
          forecast_period_count:
            typeof data.forecast_period_count === "number" &&
            Number.isFinite(data.forecast_period_count)
              ? Math.max(0, Math.round(data.forecast_period_count))
              : undefined,
          forecast_day_count:
            typeof data.forecast_day_count === "number" &&
            Number.isFinite(data.forecast_day_count)
              ? Math.max(0, Math.round(data.forecast_day_count))
              : undefined,
          forecast_query_budget_ms:
            typeof data.forecast_query_budget_ms === "number" &&
            Number.isFinite(data.forecast_query_budget_ms)
              ? Math.max(0, Math.round(data.forecast_query_budget_ms))
              : undefined,
          forecast_slow_query:
            typeof data.forecast_slow_query === "boolean"
              ? data.forecast_slow_query
              : undefined,
          forecast_budget_exceeded:
            typeof data.forecast_budget_exceeded === "boolean"
              ? data.forecast_budget_exceeded
              : undefined,
          method:
            typeof data.method === "string"
              ? safeText(data.method, 16)?.toUpperCase()
              : undefined,
          status_code:
            typeof data.status_code === "number" ? data.status_code : undefined,
          request_body_size:
            typeof data.request_body_size === "number"
              ? data.request_body_size
              : undefined,
          response_body_size:
            typeof data.response_body_size === "number"
              ? data.response_body_size
              : undefined,
        })
      : undefined;

  return compact({
    type: safeText(breadcrumb.type, 80),
    level: breadcrumb.level,
    category: safeOperationalName(breadcrumb.category),
    timestamp: breadcrumb.timestamp,
    data: safeData,
    // Breadcrumb messages can contain clicked account names or form values;
    // intentionally omit them.
  });
}

function safeTags(
  tags: Event["tags"],
): Event["tags"] | undefined {
  if (!tags) {
    return undefined;
  }

  const result: NonNullable<Event["tags"]> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!safeTagKeys.has(normalizedKey(key)) || isSensitiveKey(key)) {
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (typeof value === "string") {
      const normalized = normalizedKey(key);
      const safeValue =
        normalized === "route"
          ? safeRoute(value) ?? "[redacted]"
          : normalized === "event" ||
              normalized === "usecase" ||
              normalized === "operation" ||
              normalized === "entitytype"
            ? safeOperationalName(value)
            : safeOpaqueId(value);
      if (safeValue !== undefined) {
        result[key] = safeValue;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function safeContexts(
  contexts: Event["contexts"],
): Event["contexts"] | undefined {
  if (!contexts) {
    return undefined;
  }

  const result: NonNullable<Event["contexts"]> = {};

  for (const [contextName, context] of Object.entries(contexts)) {
    if (!context || (contextName !== "observability" && contextName !== "nextjs")) {
      continue;
    }

    const safeContext: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (isSensitiveKey(key)) {
        continue;
      }

      if (key === "route" || key === "route_path" || key === "request_path") {
        const route = safeRoute(typeof value === "string" ? value : undefined);
        if (route) {
          safeContext[key] = route;
        }
      } else if (
        typeof value === "string" &&
        (
          key === "event" ||
          key === "use_case" ||
          key === "operation" ||
          key === "entity_type" ||
          key === "entity_id" ||
          key === "event_id" ||
          key === "environment" ||
          key === "release" ||
          key === "transaction_kind" ||
          key === "router_kind" ||
          key === "route_type" ||
          key === "stage" ||
          key === "preview_id" ||
          key === "import_id" ||
          key === "account_id" ||
          key === "card_id" ||
          key === "purchase_id" ||
          key === "installment_plan_id" ||
          key === "installment_id" ||
          key === "billing_rule_id" ||
          key === "payment_id" ||
          key === "error_code" ||
          key === "forecast_stage" ||
          key === "forecast_scenario" ||
          key === "forecast_source_kind" ||
          key === "forecast_period_bucket" ||
          key === "forecast_query_code"
        )
      ) {
        const text =
          key === "event" ||
          key === "use_case" ||
          key === "operation" ||
          key === "entity_type" ||
          key === "transaction_kind" ||
          key === "router_kind" ||
          key === "route_type" ||
          key === "stage" ||
          key === "error_code" ||
          key === "forecast_stage" ||
          key === "forecast_scenario" ||
          key === "forecast_source_kind" ||
          key === "forecast_period_bucket" ||
          key === "forecast_query_code"
            ? safeOperationalName(value)
            : safeOpaqueId(value);
        if (text) {
          safeContext[key] = text;
        }
      } else if (
        (typeof value === "number" || typeof value === "boolean") &&
        safeContextScalarKeys.has(normalizedKey(key))
      ) {
        safeContext[key] = value;
      }
    }

    if (Object.keys(safeContext).length > 0) {
      result[contextName] = safeContext;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function safeRequest(request: Event["request"]): Event["request"] | undefined {
  if (!request) {
    return undefined;
  }

  return compact({
    url: safeTraceRoute(request.url),
    method: safeText(request.method, 16)?.toUpperCase(),
    // data, query_string, cookies, env and headers are intentionally omitted.
  });
}

function safeMeasurements(
  measurements: Event["measurements"],
): Event["measurements"] | undefined {
  if (!measurements) {
    return undefined;
  }

  const result: NonNullable<Event["measurements"]> = {};
  for (const [key, measurement] of Object.entries(measurements)) {
    if (
      !safeMeasurementKeys.has(key.toLowerCase()) ||
      isSensitiveKey(key) ||
      !measurement ||
      typeof measurement.value !== "number" ||
      !Number.isFinite(measurement.value) ||
      typeof measurement.unit !== "string"
    ) {
      continue;
    }

    result[key] = {
      value: measurement.value,
      unit: measurement.unit,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Span-level allow-list. Sentry's automatic spans may carry URLs, SQL, form
 * values or response data in `data`; keeping the timing and operation fields
 * gives Performance useful waterfalls without forwarding those values.
 */
export function sanitizeSentrySpan(span: SpanJSON): SpanJSON {
  try {
    return compact({
      data: {},
      description: safeTraceName(span.description),
      op: safeOperationalName(span.op),
      parent_span_id: safeOpaqueId(span.parent_span_id) ?? "unknown",
      span_id: safeOpaqueId(span.span_id) ?? "unknown",
      start_timestamp:
        typeof span.start_timestamp === "number" &&
        Number.isFinite(span.start_timestamp)
          ? span.start_timestamp
          : 0,
      status: safeOperationalName(span.status),
      timestamp:
        typeof span.timestamp === "number" && Number.isFinite(span.timestamp)
          ? span.timestamp
          : undefined,
      trace_id: safeOpaqueId(span.trace_id) ?? "unknown",
      origin: safeOperationalName(span.origin),
      exclusive_time:
        typeof span.exclusive_time === "number" &&
        Number.isFinite(span.exclusive_time)
          ? Math.max(0, span.exclusive_time)
          : undefined,
      is_segment: span.is_segment,
      segment_id: safeOpaqueId(span.segment_id),
    }) as SpanJSON;
  } catch {
    return {
      data: {},
      span_id: "unknown",
      start_timestamp: 0,
      trace_id: "unknown",
    };
  }
}

/**
 * Transaction-level allow-list used by beforeSendTransaction. Error events
 * and transactions have different payload needs, so tracing must not bypass
 * the existing error sanitizer.
 */
export function sanitizeSentryTransaction(
  event: TransactionEvent,
): TransactionEvent | null {
  try {
    return compact({
      type: "transaction" as const,
      event_id: safeOpaqueId(event.event_id),
      timestamp: event.timestamp,
      start_timestamp: event.start_timestamp,
      platform: safeText(event.platform, 80),
      release: safeOpaqueId(event.release),
      environment: safeOpaqueId(event.environment),
      transaction: safeTraceName(event.transaction),
      request: safeRequest(event.request),
      spans: event.spans?.map(sanitizeSentrySpan),
      measurements: safeMeasurements(event.measurements),
      contexts: safeContexts(event.contexts),
      tags: safeTags(event.tags),
    }) as TransactionEvent;
  } catch {
    return null;
  }
}

/**
 * Final event boundary. The returned object is allow-listed rather than
 * recursively redacted: unknown SDK fields are not trusted and are dropped.
 */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent;
export function sanitizeSentryEvent(event: Event): Event;
export function sanitizeSentryEvent(event: Event): Event {
  const sanitized: Event = compact({
    event_id: event.event_id,
    timestamp: event.timestamp,
    start_timestamp: event.start_timestamp,
    level: event.level,
    platform: event.platform,
    logger: safeText(event.logger, 160),
    release: safeOpaqueId(event.release),
    environment: safeOpaqueId(event.environment),
    transaction: safeTraceName(event.transaction),
    request: safeRequest(event.request),
    exception: event.exception?.values
      ? {
          values: event.exception.values.map(safeException),
        }
      : undefined,
    breadcrumbs: event.breadcrumbs?.map(safeBreadcrumb),
    contexts: safeContexts(event.contexts),
    tags: safeTags(event.tags),
    // sdk metadata, message, logentry, user, extra, spans, measurements and
    // debug metadata are deliberately omitted because they are not needed to
    // diagnose this slice and integrations may attach raw input there.
  });

  return sanitized;
}

/** Callback suitable for Sentry's beforeBreadcrumb option. */
export function sanitizeSentryBreadcrumb(
  breadcrumb: Breadcrumb,
): Breadcrumb | null {
  try {
    return safeBreadcrumb(breadcrumb);
  } catch {
    return null;
  }
}

/**
 * Converts the explicit application context into the only tags/contexts that
 * capture helpers are allowed to attach.
 */
export function toSafeObservabilityContext(context?: ObservabilityContext): {
  tags: NonNullable<Event["tags"]>;
  context: Record<string, string | number | boolean>;
} {
  const tags: NonNullable<Event["tags"]> = {};
  const safeContext: Record<string, string | number | boolean> = {};

  if (!context) {
    return { tags, context: safeContext };
  }

  const addString = (
    tagKey: string,
    contextKey: string,
    value: string | undefined,
    route = false,
  ) => {
    if (isSensitiveKey(tagKey) || isSensitiveKey(contextKey)) {
      return;
    }

    const safeValue = route
      ? safeRoute(value)
      : tagKeyIsOperational(tagKey)
        ? safeOperationalName(value)
        : safeOpaqueId(value);
    if (safeValue) {
      tags[tagKey] = safeValue;
      safeContext[contextKey] = safeValue;
    }
  };

  addString("event", "event", context.event);
  addString("use_case", "use_case", context.useCase);
  addString("operation", "operation", context.operation);
  addString("entity_type", "entity_type", context.entityType);
  addString("entity_id", "entity_id", context.entityId);
  addString("card_id", "card_id", context.cardId);
  addString("purchase_id", "purchase_id", context.purchaseId);
  addString("installment_plan_id", "installment_plan_id", context.installmentPlanId);
  addString("installment_id", "installment_id", context.installmentId);
  addString("billing_rule_id", "billing_rule_id", context.billingRuleId);
  addString("payment_id", "payment_id", context.paymentId);
  addString("event_id", "event_id", context.eventId);
  addString("environment", "environment", context.environment);
  addString("release", "release", context.release);
  addString("request_id", "request_id", context.requestId);
  addString("user_id", "user_id", context.userId);
  addString("household_id", "household_id", context.householdId);
  addString("transaction_kind", "transaction_kind", context.transactionKind);
  addString("route", "route", context.route, true);
  addString("stage", "stage", context.stage);
  addString("preview_id", "preview_id", context.previewId);
  addString("import_id", "import_id", context.importId);
  addString("account_id", "account_id", context.accountId);
  addString("error_code", "error_code", context.errorCode);
  addString("forecast_stage", "forecast_stage", context.forecastStage);
  addString("forecast_scenario", "forecast_scenario", context.forecastScenario);
  addString(
    "forecast_source_kind",
    "forecast_source_kind",
    context.forecastSourceKind,
  );
  addString(
    "forecast_period_bucket",
    "forecast_period_bucket",
    context.forecastPeriodBucket,
  );
  addString(
    "forecast_query_code",
    "forecast_query_code",
    context.forecastQueryCode,
  );

  if (typeof context.durationMs === "number" && Number.isFinite(context.durationMs)) {
    const duration = Math.max(0, Math.round(context.durationMs));
    tags.duration_ms = duration;
    safeContext.duration_ms = duration;
  }

  if (typeof context.statusCode === "number" && Number.isFinite(context.statusCode)) {
    const statusCode = Math.round(context.statusCode);
    tags.status_code = statusCode;
    safeContext.status_code = statusCode;
  }

  const addCount = (
    tagKey:
      | "processed_rows"
      | "valid_rows"
      | "invalid_rows"
      | "ignored_duplicate_rows"
      | "imported_rows",
    value: number | undefined,
  ) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }

    const count = Math.max(0, Math.round(value));
    tags[tagKey] = count;
    safeContext[tagKey] = count;
  };

  addCount("processed_rows", context.processedRows);
  addCount("valid_rows", context.validRows);
  addCount("invalid_rows", context.invalidRows);
  addCount("ignored_duplicate_rows", context.ignoredDuplicateRows);
  addCount("imported_rows", context.importedRows);

  const addForecastCount = (
    tagKey:
      | "forecast_source_count"
      | "forecast_recurring_count"
      | "forecast_planned_event_count"
      | "forecast_installment_count"
      | "forecast_realized_event_count"
      | "forecast_cancelled_count"
      | "forecast_item_count"
      | "forecast_projected_item_count"
      | "forecast_realized_item_count"
      | "forecast_period_count"
      | "forecast_day_count"
      | "forecast_query_budget_ms",
    value: number | undefined,
  ) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }

    const count = Math.max(0, Math.round(value));
    tags[tagKey] = count;
    safeContext[tagKey] = count;
  };

  addForecastCount("forecast_source_count", context.forecastSourceCount);
  addForecastCount("forecast_recurring_count", context.forecastRecurringCount);
  addForecastCount(
    "forecast_planned_event_count",
    context.forecastPlannedEventCount,
  );
  addForecastCount(
    "forecast_installment_count",
    context.forecastInstallmentCount,
  );
  addForecastCount(
    "forecast_realized_event_count",
    context.forecastRealizedEventCount,
  );
  addForecastCount("forecast_cancelled_count", context.forecastCancelledCount);
  addForecastCount("forecast_item_count", context.forecastItemCount);
  addForecastCount(
    "forecast_projected_item_count",
    context.forecastProjectedItemCount,
  );
  addForecastCount(
    "forecast_realized_item_count",
    context.forecastRealizedItemCount,
  );
  addForecastCount("forecast_period_count", context.forecastPeriodCount);
  addForecastCount("forecast_day_count", context.forecastDayCount);
  addForecastCount("forecast_query_budget_ms", context.forecastQueryBudgetMs);

  if (typeof context.forecastSlowQuery === "boolean") {
    tags.forecast_slow_query = context.forecastSlowQuery;
    safeContext.forecast_slow_query = context.forecastSlowQuery;
  }
  if (typeof context.forecastBudgetExceeded === "boolean") {
    tags.forecast_budget_exceeded = context.forecastBudgetExceeded;
    safeContext.forecast_budget_exceeded = context.forecastBudgetExceeded;
  }

  return { tags, context: safeContext };
}

function tagKeyIsOperational(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    normalized === "event" ||
    normalized === "usecase" ||
    normalized === "operation" ||
    normalized === "entitytype" ||
    normalized === "forecaststage" ||
    normalized === "forecastquerycode"
  );
}
