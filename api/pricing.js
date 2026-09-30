/*
 * GET /api/pricing — the mat prices the builder shows in its order summary, from the same settings the
 * quote is raised with (MAT_PRICE_FIRST, MAT_PRICE_EXTRA, FREIGHT_PRICE, PRICES_INCLUDE_GST).
 */
import { readPricing } from "../lib/order.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  return res.status(200).json({ ok: true, pricing: readPricing() });
}
