import { getRedis, isRedisEnabled } from "./redis.mjs";

/** @type {Map<string, { count: number, expiresAt: number }>} */
const memoryCounters = new Map();

function rateLimitError(retryAfterSeconds) {
  return Object.assign(new Error("rate_limited"), {
    statusCode: 429,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
  });
}

function cleanupMemory(now = Date.now()) {
  for (const [key, entry] of memoryCounters) {
    if (entry.expiresAt <= now) memoryCounters.delete(key);
  }
}

async function incrMemory(key, windowSeconds) {
  cleanupMemory();
  const now = Date.now();
  const existing = memoryCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryCounters.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    });
    return { count: 1, ttlSeconds: windowSeconds };
  }
  existing.count += 1;
  const ttlSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
  return { count: existing.count, ttlSeconds };
}

async function incrRedis(key, windowSeconds) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured");

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  let ttlSeconds = await redis.ttl(key);
  if (ttlSeconds < 0) {
    await redis.expire(key, windowSeconds);
    ttlSeconds = windowSeconds;
  }
  return { count, ttlSeconds };
}

/**
 * Increment a counter and throw 429 if over limit.
 * @param {{ key: string, limit: number, windowSeconds: number }} opts
 */
export async function assertRateLimit({ key, limit, windowSeconds }) {
  const safeKey = String(key || "").trim();
  const max = Math.max(1, Number(limit) || 1);
  const window = Math.max(1, Number(windowSeconds) || 1);
  if (!safeKey) return;

  const { count, ttlSeconds } = isRedisEnabled()
    ? await incrRedis(safeKey, window)
    : await incrMemory(safeKey, window);

  if (count > max) {
    throw rateLimitError(ttlSeconds);
  }
}

export function rateLimitBackend() {
  return isRedisEnabled() ? "redis" : "memory";
}

/** Seconds until next UTC midnight (for calendar-day windows). */
export function secondsUntilUtcMidnight(now = new Date()) {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/** UTC date key YYYY-MM-DD for calendar-day rate keys. */
export function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
