/*
 * Fixed-window rate limiter.
 *
 * Uses a Redis-compatible REST store when one is configured (Upstash / Vercel KV env vars),
 * which makes the limits global across all serverless instances. Without one it falls back to
 * an in-memory map – still useful against bursts, but each warm function instance counts
 * separately, so treat it as best-effort and lean on reCAPTCHA as the primary defence.
 */

function redisStore(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return {
    name: "redis",
    async incr(key, ttlSec) {
      const r = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, ttlSec, "NX"]]),
      });
      if (!r.ok) throw new Error(`rate-limit store error ${r.status}`);
      const [{ result }] = await r.json();
      return Number(result);
    },
  };
}

const memory = new Map();
function memoryStore() {
  return {
    name: "memory",
    async incr(key, ttlSec) {
      const now = Date.now();
      if (memory.size > 5000) for (const [k, v] of memory) if (v.expires < now) memory.delete(k);
      const cur = memory.get(key);
      if (cur && cur.expires > now) return ++cur.count;
      memory.set(key, { count: 1, expires: now + ttlSec * 1000 });
      return 1;
    },
  };
}

/**
 * @returns {{ name: string, hit(key: string, limit: number, windowSec: number): Promise<{allowed: boolean, count: number, retryAfter: number}> }}
 */
export function createLimiter(env = process.env) {
  const store = redisStore(env) || memoryStore();
  return {
    name: store.name,
    async hit(key, limit, windowSec) {
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - (now % windowSec);
      let count;
      try { count = await store.incr(`rl:${key}:${windowStart}`, windowSec + 5); }
      catch (e) { console.warn("rate limit store unavailable, allowing request:", e.message); return { allowed: true, count: 0, retryAfter: 0 }; }
      return { allowed: count <= limit, count, retryAfter: windowStart + windowSec - now };
    },
  };
}

export const rateLimitError = retryAfter => {
  const mins = Math.max(1, Math.ceil(retryAfter / 60));
  return Object.assign(new Error(`Too many submissions from here – please wait ${mins} minute${mins === 1 ? "" : "s"} and try again`), { status: 429, retryAfter });
};
