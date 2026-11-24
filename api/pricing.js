/*
 * GET /api/pricing — the price tiers and freight the builder shows, from the same settings the invoice uses.
 */
import { EXTRA_MAT_PRICE, PRICE_TIERS } from "../shared/mat.js";
import { readPricing } from "../lib/order.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const tiers = PRICE_TIERS.map(t => ({ upTo: t.upTo === Infinity ? null : t.upTo, price: t.price }));
  return res.status(200).json({ ok: true, pricing: { ...readPricing(), tiers, extra: EXTRA_MAT_PRICE } });
}
