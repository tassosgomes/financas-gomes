"use server";

import {
  getForecast as readForecast,
} from "@/modules/forecast/service";
import type {
  ForecastResult,
  ForecastTimeline,
} from "@/modules/forecast/contracts";

/**
 * Server Action boundary for the S07 read. `readForecast` resolves the
 * authenticated financial context; this action accepts only the public
 * period/scenario query and never accepts a household selector.
 */
export async function getForecastAction(
  input?: unknown,
): Promise<ForecastResult<ForecastTimeline>> {
  return readForecast(input);
}

/** Compatibility names used by route/page adapters. */
export async function getForecast(input?: unknown) {
  return getForecastAction(input);
}

export async function getForecastTimelineAction(input?: unknown) {
  return getForecastAction(input);
}

export async function getForecastTimeline(input?: unknown) {
  return getForecastAction(input);
}

