/*
 * Xero: find-or-create the customer's contact, raise a quote (or an invoice) for their mats, and fetch
 * its PDF. Node 18+ – uses the built-in fetch.
 *
 * Two ways to sign in (XERO_MODE):
 *   webapp (default) – a Xero "Web app". Someone at Ankor'd connects it once at /misterminit/api/xero/connect;
 *                      the refresh token and organisation id are then kept in the key/value store (lib/store.js)
 *                      and rotated on every refresh. A daily cron keeps it alive (tokens lapse after 60 idle days).
 *   custom           – a Xero "Custom connection" (client credentials, paid add-on). No store needed.
 *
 * Nothing here is shown to the customer except the document it creates: whether they were already a
 * contact is only reported back to the design team.
 */
import { addressText, contactName, MAT_SIZE, storeLabel } from "./order.js";
import { kvStore } from "./store.js";

const API = "https://api.xero.com/api.xro/2.0";
const TOKEN_URL = "https://identity.xero.com/connect/token";
// One login per Vercel environment, so connecting staging (Preview) never replaces production's
export const TOKEN_KEY = `xero:connection:${process.env.VERCEL_ENV || "development"}`;
// accounting.invoices covers quotes; granular scopes are the only ones offered to apps made since March 2026
export const DEFAULT_SCOPES = "openid profile email offline_access accounting.contacts accounting.invoices accounting.settings.read";
let cached = { token: null, tenantId: null, expires: 0 };

export const isCustomConnection = env => /^custom$/i.test(env.XERO_MODE || "");
export const xeroConfigured = env => !!(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET);

export async function tokenRequest(env, params) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`Xero sign-in failed: ${data.error_description || data.error || r.status}`);
  return data;
}

/** Swaps the stored refresh token for a new pair and saves it straight away (Xero rotates refresh tokens). */
export async function refreshConnection(env, store = kvStore(env)) {
  if (!store) throw new Error("Xero web app needs a key/value store (add Upstash for Redis in Vercel)");
  const conn = await store.get(TOKEN_KEY);
  if (!conn?.refreshToken) throw new Error("Xero isn't connected yet – open /misterminit/api/xero/connect to connect it");
  const d = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: conn.refreshToken });
  const next = { ...conn, refreshToken: d.refresh_token, refreshedAt: new Date().toISOString() };
  await store.set(TOKEN_KEY, next);
  return { token: d.access_token, tenantId: conn.tenantId, expires: Date.now() + (d.expires_in || 1800) * 1000 };
}

/** @returns {{ token: string, tenantId: string|null }} */
export async function getXeroToken(env) {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached;
  if (isCustomConnection(env)) {
    // Custom connections get every scope ticked on the app when none is asked for
    const d = await tokenRequest(env, { grant_type: "client_credentials", ...(env.XERO_SCOPES ? { scope: env.XERO_SCOPES } : {}) });
    cached = { token: d.access_token, tenantId: env.XERO_TENANT_ID || null, expires: Date.now() + (d.expires_in || 1800) * 1000 };
  } else {
    cached = await refreshConnection(env);
  }
  return cached;
}
export const resetXeroToken = () => { cached = { token: null, tenantId: null, expires: 0 }; };

/* Pulls the useful part out of a Xero error (validation errors live under Elements[].ValidationErrors) */
function xeroError(status, data, what) {
  const v = (data?.Elements || []).flatMap(e => e.ValidationErrors || []).map(e => e.Message);
  const msg = v.length ? v.join("; ") : (data?.Message || data?.Detail || data?.Title || `HTTP ${status}`);
  return Object.assign(new Error(`Xero ${what} failed: ${msg}`), { status: 502 });
}

async function xero(env, method, path, { body, accept = "application/json", what = path } = {}) {
  const { token, tenantId } = await getXeroToken(env);
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, Accept: accept,
      ...(tenantId ? { "Xero-tenant-id": tenantId } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (accept === "application/pdf" && r.ok) return Buffer.from(await r.arrayBuffer());
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw xeroError(r.status, data, what);
  return data;
}

/* Values go inside a double-quoted where clause – drop anything that could break out of it */
const q = s => String(s).replace(/["\\]/g, "").trim();

async function findContact(env, where) {
  const d = await xero(env, "GET", `/Contacts?summaryOnly=true&where=${encodeURIComponent(where)}`, { what: "contact lookup" });
  return (d.Contacts || []).find(c => c.ContactStatus !== "ARCHIVED") || null;
}

/**
 * Looks the customer up by ABN, then email, then legal name; creates them when none match.
 * An existing contact is used as-is (we never overwrite details already in Xero).
 * @returns {{ contactId: string, name: string, created: boolean, matchedBy?: string }}
 */
export async function findOrCreateContact(env, c) {
  const abn = c.abn.replace(/\s/g, "");
  const tries = [
    ["ABN", `TaxNumber=="${q(abn)}"||TaxNumber=="${q(c.abn)}"`],
    ["email", `EmailAddress=="${q(c.email)}"`],
    ["name", `Name=="${q(c.legalName)}"||Name=="${q(c.tradingName)}"`],
  ];
  for (const [by, where] of tries) {
    const hit = await findContact(env, where);
    if (hit) return { contactId: hit.ContactID, name: hit.Name, created: false, matchedBy: by };
  }
  const addr = (type, a) => ({ AddressType: type, AddressLine1: a.street, City: a.suburb, Region: a.state, PostalCode: a.postcode, Country: "Australia",
    AttentionTo: `${contactName(c)}, ${c.tradingName}`.slice(0, 255) });
  const d = await xero(env, "POST", "/Contacts", { what: "creating the contact", body: { Contacts: [{
    Name: c.legalName,
    FirstName: c.firstName, LastName: c.lastName, EmailAddress: c.email,
    TaxNumber: c.abn,
    Phones: [{ PhoneType: "DEFAULT", PhoneNumber: c.phone }],
    // Xero has no trading-name field, so it goes in each address's "attention" line (and the quote title)
    Addresses: [addr("POBOX", c.billing), addr("STREET", c.delivery)],
  }] } });
  const made = d.Contacts?.[0];
  if (!made?.ContactID) throw new Error("Xero didn't return the new contact");
  return { contactId: made.ContactID, name: made.Name, created: true };
}

const isoDate = (d = new Date()) => new Date(d.getTime() + 10 * 3600_000).toISOString().slice(0, 10);   // AEST date
const addDays = (n, from = new Date()) => isoDate(new Date(from.getTime() + n * 86_400_000));

function lineItems(env, quote) {
  const code = { first: env.XERO_ITEM_CODE_FIRST, extra: env.XERO_ITEM_CODE_EXTRA, freight: env.XERO_ITEM_CODE_FREIGHT };
  const account = { freight: env.XERO_FREIGHT_ACCOUNT_CODE };
  return quote.lines.map(l => ({
    Description: l.description, Quantity: l.qty, UnitAmount: l.unit,
    AccountCode: account[l.key] || env.XERO_ACCOUNT_CODE || "200",
    TaxType: env.XERO_TAX_TYPE || "OUTPUT",
    ...(code[l.key] ? { ItemCode: code[l.key] } : {}),
  }));
}

/**
 * Raises the document for this order and fetches its PDF.
 * XERO_DOCUMENT=quote (default) → a quote; =invoice → an approved invoice with an online "pay now" link.
 * @returns {{ kind: "quote"|"invoice", id, number, subTotal, tax, total, pdf: Buffer|null, payUrl: string|null, contact }}
 */
export async function raiseXeroDocument(env, { customer, stores, quote, reference }) {
  const contact = await findOrCreateContact(env, customer);
  const kind = /^invoice$/i.test(env.XERO_DOCUMENT || "") ? "invoice" : "quote";
  const storeList = stores.map(s => `${storeLabel(s)} (${s.qty})`).join(", ");
  const common = {
    Contact: { ContactID: contact.contactId },
    Date: isoDate(),
    LineAmountTypes: quote.includesGst ? "Inclusive" : "Exclusive",
    LineItems: lineItems(env, quote),
    Reference: reference.slice(0, 255),
    CurrencyCode: "AUD",
    ...(env.XERO_BRANDING_THEME_ID ? { BrandingThemeID: env.XERO_BRANDING_THEME_ID } : {}),
  };
  let id, number, doc, payUrl = null;
  if (kind === "invoice") {
    const d = await xero(env, "POST", "/Invoices", { what: "creating the invoice", body: { Invoices: [{
      ...common, Type: "ACCREC", Status: "AUTHORISED", DueDate: addDays(Number(env.XERO_INVOICE_DUE_DAYS) || 7),
    }] } });
    doc = d.Invoices?.[0]; id = doc?.InvoiceID; number = doc?.InvoiceNumber;
    if (!id) throw new Error("Xero didn't return the new invoice");
    try {
      const o = await xero(env, "GET", `/Invoices/${id}/OnlineInvoice`, { what: "the online invoice link" });
      payUrl = o.OnlineInvoices?.[0]?.OnlineInvoiceUrl || null;
    } catch (e) { console.warn(e.message); }
  } else {
    const d = await xero(env, "POST", "/Quotes", { what: "creating the quote", body: { Quotes: [{
      ...common,
      Status: (env.XERO_QUOTE_STATUS || "SENT").toUpperCase(),
      ExpiryDate: addDays(Number(env.XERO_QUOTE_EXPIRY_DAYS) || 30),
      Title: `Mister Minit price mats – ${customer.tradingName}`.slice(0, 100),
      Summary: `${quote.mats} x ${MAT_SIZE} price mat${quote.mats === 1 ? "" : "s"} for ${storeList}.\nDeliver to: ${addressText(customer.delivery)}`.slice(0, 3000),
      ...(env.XERO_QUOTE_TERMS ? { Terms: env.XERO_QUOTE_TERMS.replace(/\\n/g, "\n") } : {}),
    }] } });
    doc = d.Quotes?.[0]; id = doc?.QuoteID; number = doc?.QuoteNumber;
    if (!id) throw new Error("Xero didn't return the new quote");
  }
  let pdf = null;
  try { pdf = await xero(env, "GET", `/${kind === "invoice" ? "Invoices" : "Quotes"}/${id}`, { accept: "application/pdf", what: "the PDF" }); }
  catch (e) { console.warn(e.message); }
  return { kind, id, number, subTotal: doc.SubTotal, tax: doc.TotalTax, total: doc.Total, pdf, payUrl, contact };
}
