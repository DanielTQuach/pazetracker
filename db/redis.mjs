import Redis from "ioredis";

/** @type {import('ioredis').default | null} */
let client = null;

export function isRedisEnabled() {
  return Boolean(process.env.REDIS_URL);
}

/**
 * Lazy Redis client. Returns null when REDIS_URL is unset.
 * @returns {import('ioredis').default | null}
 */
export function getRedis() {
  if (!isRedisEnabled()) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      console.error("Redis error:", err.message);
    });
  }
  return client;
}

export function usesRedis() {
  return isRedisEnabled();
}
