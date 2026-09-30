/*
 * Tiny key/value store on a Redis-compatible REST API (Upstash for Redis from the Vercel Marketplace sets
 * UPSTASH_REDIS_REST_* or KV_REST_API_*). Used to keep the Xero login between requests.
 */
export function kvStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const run = async cmd => {
    const r = await fetch(url.replace(/\/$/, ""), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(`Key/value store error: ${d.error || r.status}`);
    return d.result;
  };
  return {
    async get(key) { const v = await run(["GET", key]); return v == null ? null : JSON.parse(v); },
    async set(key, value, ttlSec) { await run(ttlSec ? ["SET", key, JSON.stringify(value), "EX", ttlSec] : ["SET", key, JSON.stringify(value)]); },
    async del(key) { await run(["DEL", key]); },
  };
}
