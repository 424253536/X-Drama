import type { RuntimeModelRoute } from './model-routing';

interface RouteScheduleState {
  tail: Promise<void>;
  lastStartedAt: number;
  minIntervalMs: number;
}

const routeStates = new Map<string, RouteScheduleState>();

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function routeMinIntervalMs(route: RuntimeModelRoute): number {
  const limits = route.profile.limits || {};
  const options = route.gateway.options || {};
  const explicit = positiveNumber(limits.minIntervalMs)
    || positiveNumber(options.minIntervalMs);
  if (explicit) return explicit;
  const rpm = positiveNumber(limits.requestsPerMinute)
    || positiveNumber(limits.rpm)
    || positiveNumber(options.requestsPerMinute)
    || positiveNumber(options.rpm);
  return rpm ? Math.ceil(60_000 / rpm) : 0;
}

export function isUpstreamRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate.?limit|too many requests|请求数限制|请求过多|频率限制|最多请求\s*\d+\s*次/i.test(message);
}

export function rateLimitDelayMs(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const seconds = message.match(/retry[- ]?after[^\d]*(\d+)/i)?.[1];
  if (seconds) return Math.max(1_000, Number(seconds) * 1_000);
  const minutes = message.match(/(\d+)\s*分钟内最多请求/i)?.[1];
  return minutes ? Math.max(1_000, Number(minutes) * 60_000) : 60_000;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Serialize calls to one gateway-model mapping. If the upstream reveals a rate
 * limit, learn its interval and retry once while keeping later calls queued.
 */
export async function runScheduledModelRoute<T>(
  route: RuntimeModelRoute,
  execute: () => Promise<T>,
): Promise<T> {
  const key = route.id;
  const state = routeStates.get(key) || {
    tail: Promise.resolve(),
    lastStartedAt: 0,
    minIntervalMs: routeMinIntervalMs(route),
  };
  routeStates.set(key, state);

  let release!: () => void;
  const previous = state.tail;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => {});

  try {
    const waitForSlot = async () => {
      const waitMs = Math.max(0, state.lastStartedAt + state.minIntervalMs - Date.now());
      await sleep(waitMs);
      state.lastStartedAt = Date.now();
    };

    await waitForSlot();
    try {
      return await execute();
    } catch (error) {
      if (!isUpstreamRateLimit(error)) throw error;
      state.minIntervalMs = Math.max(state.minIntervalMs, rateLimitDelayMs(error));
      await waitForSlot();
      return await execute();
    }
  } finally {
    release();
  }
}

export function resetModelRouteSchedulesForTests(): void {
  routeStates.clear();
}
