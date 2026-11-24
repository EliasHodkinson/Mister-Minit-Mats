/*
 * The order side of a brief: pricing settings, the customer's business details (their account profile) and the
 * stores they're ordering for. Shared by the endpoints (validation, the Xero invoice) and the emails.
 *
 * Mat pricing (tiers by number of changes, extra mats, freight) lives in shared/mat.js so the builder page and
 * the server always agree; the server recounts the changes itself and is the source of truth for the invoice.
 */
import { DEFAULT_FREIGHT, MAT_SIZE, MAX_QTY, MAX_STORES, quoteLines, storeLabel, totalMats } from "../shared/mat.js";

export { MAT_SIZE, quoteLines, storeLabel, totalMats };
export const MAX_QTY_PER_STORE = MAX_QTY;
export { MAX_STORES };
export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

const num = (v, d) => (v !== undefined && v !== "" && !Number.isNaN(Number(v))) ? Number(v) : d;

export function readPricing(env = process.env) {
  return {
    freight: num(env.FREIGHT_PRICE, DEFAULT_FREIGHT),
    includesGst: !/^(0|false|no)$/i.test(env.PRICES_INCLUDE_GST || ""),   // invoices are tax inclusive unless set to false
    gstRate: 0.1,
    document: docKind(env),
  };
}
/* What Xero raises for an order: an invoice they can pay online (default), or a quote (XERO_DOCUMENT=quote) */
export function docKind(env = process.env) {
  return /^quote$/i.test(env.XERO_DOCUMENT || "") ? "quote" : "invoice";
}

/* ---------- ABN ---------- */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
export const abnDigits = s => String(s ?? "").normalize("NFKC").replace(/\D/g, "");
export function isValidAbn(s) {
  const d = abnDigits(s);
  if (d.length !== 11) return false;
  const sum = [...d].reduce((acc, ch, i) => acc + (Number(ch) - (i === 0 ? 1 : 0)) * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}
export const formatAbn = s => abnDigits(s).replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4");

/* ---------- stores ---------- */
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

export function readStores(payload) {
  return (Array.isArray(payload?.stores) ? payload.stores : []).map(s => ({
    line1: str(s?.line1, 60), line2: str(s?.line2, 60),
    qty: Math.floor(num(s?.qty, 0)),
  }));
}

/* ---------- business details (the customer profile) ---------- */
function readAddress(a = {}) {
  return { street: str(a.street), suburb: str(a.suburb, 80), state: str(a.state, 3).toUpperCase(), postcode: str(a.postcode, 4) };
}
export const addressText = a => a ? [a.street, [a.suburb, a.state, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";

/** Cleans the profile the onboarding / account form posts: { legalName, tradingName, abn, firstName, lastName, phone, billing, deliverySame, delivery } */
export function readProfile(p = {}, email = "") {
  const billing = readAddress(p.billing);
  const sameDelivery = p.deliverySame !== false;
  return {
    legalName: str(p.legalName), tradingName: str(p.tradingName), abn: formatAbn(p.abn),
    firstName: str(p.firstName, 80), lastName: str(p.lastName, 80),
    email: str(email || p.email).toLowerCase(), phone: str(p.phone, 40),
    billing, sameDelivery,
    delivery: sameDelivery ? billing : readAddress(p.delivery),
  };
}
/** A customers row → the customer shape the emails and Xero use */
export function customerFromRow(r) {
  return readProfile({
    legalName: r.legal_name, tradingName: r.trading_name, abn: r.abn, firstName: r.first_name, lastName: r.last_name,
    phone: r.phone, billing: r.billing, deliverySame: r.delivery_same, delivery: r.delivery,
  }, r.email);
}
export const contactName = c => [c.firstName, c.lastName].filter(Boolean).join(" ");

/** Problems with the business details (empty when complete). Keys match the form fields. */
export function profileProblems(c) {
  const out = [], bad = (field, msg) => out.push({ field, msg });
  if (!c.legalName) bad("legalName", "Enter the legal entity name");
  if (!c.tradingName) bad("tradingName", "Enter the trading name");
  const n = abnDigits(c.abn).length;
  if (!n) bad("abn", "Enter the ABN");
  else if (n !== 11) bad("abn", `The ABN has ${n} digit${n === 1 ? "" : "s"}, it needs 11`);
  else if (!isValidAbn(c.abn)) bad("abn", "That ABN doesn't pass the ATO check – look for a mistyped digit");
  if (!c.firstName) bad("firstName", "Enter a first name");
  if (!c.lastName) bad("lastName", "Enter a last name");
  if (!c.phone) bad("phone", "Enter a phone number");
  for (const [p, a] of [["billing", c.billing], ...(c.sameDelivery ? [] : [["delivery", c.delivery]])]) {
    if (!a.street) bad(`${p}.street`, "Enter the street address");
    if (!a.suburb) bad(`${p}.suburb`, "Enter the suburb");
    if (!AU_STATES.includes(a.state)) bad(`${p}.state`, "Choose a state");
    if (!/^\d{4}$/.test(a.postcode)) bad(`${p}.postcode`, "4 digits");
  }
  return out;
}

export { money } from "../shared/mat.js";
