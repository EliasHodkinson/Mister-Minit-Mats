/*
 * The order side of a brief: pricing, the customer's business details and the stores they're ordering for.
 * Shared by the endpoint (validation + the Xero quote) and the emails. No dependencies, no side effects.
 *
 * Pricing: the first mat includes up to 45 minutes of design time, every further mat is a reprint with the
 * store name changed, then freight once per order. The builder page shows the same numbers (it fetches
 * them from /api/pricing), but the server is the source of truth for the quote.
 */

export const MAT_SIZE = "800 x 400 mm";
/* Line wording, as on the Ankor'd quote template QU-0003 */
export const MAT_PRODUCT = "80x40cm Non-slip Mat - Colour Stitched - 4mm";
export const MAX_STORES = 20;
export const MAX_QTY_PER_STORE = 20;
export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

const num = (v, d) => (v !== undefined && v !== "" && !Number.isNaN(Number(v))) ? Number(v) : d;
const cents = n => Math.round(n * 100) / 100;

export function readPricing(env = process.env) {
  return {
    first: num(env.MAT_PRICE_FIRST, 250),
    extra: num(env.MAT_PRICE_EXTRA, 150),
    freight: num(env.FREIGHT_PRICE, 25),
    includesGst: !/^(0|false|no)$/i.test(env.PRICES_INCLUDE_GST || ""),   // quotes are tax inclusive unless set to false
    gstRate: 0.1,
    designMinutes: num(env.DESIGN_MINUTES_INCLUDED, 45),
    document: docKind(env),
  };
}
/* What Xero raises for an order: an invoice they can pay online (default), or a quote (XERO_DOCUMENT=quote) */
export function docKind(env = process.env) {
  return /^quote$/i.test(env.XERO_DOCUMENT || "") ? "quote" : "invoice";
}

/* ---------- ABN ---------- */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
export const abnDigits = s => String(s ?? "").replace(/\D/g, "");
export function isValidAbn(s) {
  const d = abnDigits(s);
  if (d.length !== 11) return false;
  const sum = [...d].reduce((acc, ch, i) => acc + (Number(ch) - (i === 0 ? 1 : 0)) * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}
export const formatAbn = s => abnDigits(s).replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4");

/* ---------- stores + customer, cleaned up from the payload ---------- */
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

export function readStores(payload) {
  return (Array.isArray(payload?.stores) ? payload.stores : []).map(s => ({
    line1: str(s?.line1, 60), line2: str(s?.line2, 60),
    qty: Math.floor(num(s?.qty, 0)),
  }));
}
export const storeLabel = s => [s.line1, s.line2].filter(Boolean).join(" ");
export const totalMats = stores => stores.reduce((n, s) => n + s.qty, 0);

function readAddress(m, prefix) {
  return { street: str(m[prefix + "Street"]), suburb: str(m[prefix + "Suburb"], 80), state: str(m[prefix + "State"], 3).toUpperCase(), postcode: str(m[prefix + "Postcode"], 4) };
}
export const addressText = a => a ? [a.street, [a.suburb, a.state, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";

export function readCustomer(meta = {}) {
  const billing = readAddress(meta, "bill");
  const sameDelivery = meta.deliverySame !== false;
  return {
    legalName: str(meta.legalName), tradingName: str(meta.tradingName), abn: formatAbn(meta.abn),
    firstName: str(meta.firstName, 80), lastName: str(meta.lastName, 80),
    email: str(meta.contactEmail).toLowerCase(), phone: str(meta.contactPhone, 40),
    billing, sameDelivery,
    delivery: sameDelivery ? billing : readAddress(meta, "del"),
  };
}
export const contactName = c => [c.firstName, c.lastName].filter(Boolean).join(" ");

/** Returns a list of problems (empty when the order part of the brief is complete). */
export function orderProblems(payload) {
  const out = [];
  const stores = readStores(payload);
  if (!stores.length) out.push("Add at least one store");
  if (stores.length > MAX_STORES) out.push(`Up to ${MAX_STORES} stores per brief`);
  stores.forEach((s, i) => {
    if (!s.line1) out.push(`Store ${i + 1} needs a name`);
    if (!(s.qty >= 1 && s.qty <= MAX_QTY_PER_STORE)) out.push(`Store ${i + 1} quantity must be between 1 and ${MAX_QTY_PER_STORE}`);
  });
  const c = readCustomer(payload?.meta);
  if (!c.legalName) out.push("Legal entity name is missing");
  if (!c.tradingName) out.push("Trading name is missing");
  if (!isValidAbn(c.abn)) out.push("ABN is missing or invalid");
  if (!c.firstName || !c.lastName) out.push("First and last name are required");
  if (!c.phone) out.push("Contact number is missing");
  for (const [label, a] of [["Billing", c.billing], ...(c.sameDelivery ? [] : [["Delivery", c.delivery]])]) {
    if (!a.street || !a.suburb) out.push(`${label} address is incomplete`);
    if (!AU_STATES.includes(a.state)) out.push(`${label} address needs a state`);
    if (!/^\d{4}$/.test(a.postcode)) out.push(`${label} postcode should be 4 digits`);
  }
  return out;
}

/* ---------- the quote ---------- */
/**
 * @returns {{ lines: {key, description, qty, unit, amount}[], subTotal, gst, total, mats, includesGst }}
 */
export function quoteLines(stores, pricing) {
  const mats = totalMats(stores);
  const names = stores.map(s => `${storeLabel(s)}${s.qty > 1 ? ` x${s.qty}` : ""}`).join(", ");
  const lines = [];
  if (mats >= 1) lines.push({ key: "first", qty: 1, unit: pricing.first,
    description: `${MAT_PRODUCT} - Your Customisations Applied (Includes ${pricing.designMinutes} minutes of design changes)\nMister Minit price mat · Stores: ${names}` });
  if (mats >= 2) lines.push({ key: "extra", qty: mats - 1, unit: pricing.extra, description: `${MAT_PRODUCT} - Reprint` });
  if (mats >= 1 && pricing.freight > 0) lines.push({ key: "freight", qty: 1, unit: pricing.freight, description: "Standard Freight" });
  for (const l of lines) l.amount = cents(l.qty * l.unit);
  const sum = cents(lines.reduce((n, l) => n + l.amount, 0));
  const gst = pricing.includesGst ? cents(sum / (1 + 1 / pricing.gstRate)) : cents(sum * pricing.gstRate);
  return { lines, mats, includesGst: pricing.includesGst, subTotal: pricing.includesGst ? cents(sum - gst) : sum, gst, total: pricing.includesGst ? sum : cents(sum + gst) };
}

export const money = n => "$" + Number(n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
