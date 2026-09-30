import { test } from "node:test";
import assert from "node:assert/strict";
import { raiseXeroDocument, resetXeroToken, TOKEN_KEY } from "../lib/xero.js";
import { quoteLines, readCustomer, readPricing } from "../lib/order.js";

const customer = readCustomer({
  legalName: "Lee Family Holdings Pty Ltd", tradingName: "Mister Minit Penrith", abn: "51824753556",
  firstName: "Sam", lastName: "Lee", contactEmail: "Sam@Example.com", contactPhone: "0400 000 000",
  billStreet: "1 High St", billSuburb: "Penrith", billState: "nsw", billPostcode: "2750", deliverySame: true,
});
const stores = [{ line1: "PENRITH", line2: "", qty: 2 }];
const quote = quoteLines(stores, { ...readPricing({}), freight: 30 });   // tax inclusive by default
const env = { XERO_MODE: "custom", XERO_CLIENT_ID: "id", XERO_CLIENT_SECRET: "secret", XERO_ACCOUNT_CODE: "200", XERO_ITEM_CODE_FREIGHT: "FREIGHT" };

/* A fake Xero: records every call, answers from `existing` for contact lookups */
function fakeXero(existing = [], kv = {}) {
  const calls = [];
  resetXeroToken();
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("https://kv.test")) {       // Upstash-style REST store
      const [cmd, key, val] = JSON.parse(init.body);
      if (cmd === "SET") kv[key] = val;
      return new Response(JSON.stringify({ result: cmd === "GET" ? (kv[key] ?? null) : "OK" }), { status: 200 });
    }
    const u = new URL(url), body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
    calls.push({ method: init.method || "GET", host: u.hostname, path: u.pathname, where: u.searchParams.get("where"), body, accept: init.headers?.Accept, tenant: init.headers?.["Xero-tenant-id"] });
    const json = d => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.hostname === "identity.xero.com") return json({ access_token: "tok", expires_in: 1800 });
    if (u.pathname.endsWith("/Contacts") && (init.method || "GET") === "GET") {
      const w = u.searchParams.get("where");
      return json({ Contacts: existing.filter(c => w.includes(`"${c.match}"`)).map(c => ({ ContactID: c.id, Name: c.name, ContactStatus: "ACTIVE" })) });
    }
    if (u.pathname.endsWith("/Contacts")) return json({ Contacts: [{ ContactID: "new-1", Name: body.Contacts[0].Name }] });
    if (u.pathname.endsWith("/Quotes")) return json({ Quotes: [{ QuoteID: "q-1", QuoteNumber: "QU-0004", SubTotal: 430, TotalTax: 43, Total: 473 }] });
    if (u.pathname.includes("/Quotes/q-1")) return new Response("%PDF-1.4", { status: 200, headers: { "Content-Type": "application/pdf" } });
    return new Response("{}", { status: 404 });
  };
  return calls;
}

test("new customer: looked up by ABN, email and name, then created, then quoted", async () => {
  const calls = fakeXero();
  const doc = await raiseXeroDocument(env, { customer, stores, quote, reference: "Mat brief – PENRITH" });
  const lookups = calls.filter(c => c.path.endsWith("/Contacts") && c.method === "GET").map(c => c.where);
  assert.equal(lookups.length, 3);
  assert.match(lookups[0], /TaxNumber=="51824753556"\|\|TaxNumber=="51 824 753 556"/);
  assert.match(lookups[1], /EmailAddress=="sam@example.com"/);
  const created = calls.find(c => c.path.endsWith("/Contacts") && c.method === "POST").body.Contacts[0];
  assert.equal(created.Name, "Lee Family Holdings Pty Ltd");
  assert.equal(created.TaxNumber, "51 824 753 556");
  assert.equal(created.Addresses[0].Region, "NSW");
  const q = calls.find(c => c.path.endsWith("/Quotes")).body.Quotes[0];
  assert.equal(q.Contact.ContactID, "new-1");
  assert.equal(q.LineAmountTypes, "Inclusive");
  assert.deepEqual(q.LineItems.map(l => [l.Quantity, l.UnitAmount, l.ItemCode]), [[1, 250, undefined], [1, 150, undefined], [1, 30, "FREIGHT"]]);
  assert.equal(doc.number, "QU-0004");
  assert.equal(doc.contact.created, true);
  assert.equal(doc.pdf.toString(), "%PDF-1.4");
});

test("existing customer matched by ABN is reused, never re-created", async () => {
  const calls = fakeXero([{ id: "abc", name: "Lee Holdings", match: "51824753556" }]);
  const doc = await raiseXeroDocument(env, { customer, stores, quote, reference: "x" });
  assert.equal(doc.contact.contactId, "abc");
  assert.equal(doc.contact.matchedBy, "ABN");
  assert.ok(!calls.some(c => c.path.endsWith("/Contacts") && c.method === "POST"));
});

test("web app: refreshes with the stored token, saves the rotated one, sends the organisation id", async () => {
  const kv = { [TOKEN_KEY]: JSON.stringify({ refreshToken: "old-rt", tenantId: "org-1", tenantName: "Ankor'd" }) };
  const calls = fakeXero([], kv);
  const webEnv = { ...env, XERO_MODE: undefined, KV_REST_API_URL: "https://kv.test", KV_REST_API_TOKEN: "t" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes("identity.xero.com")
    ? (calls.push({ host: "identity", body: String(init.body) }), new Response(JSON.stringify({ access_token: "tok", refresh_token: "new-rt", expires_in: 1800 }), { status: 200 }))
    : realFetch(url, init);
  await raiseXeroDocument(webEnv, { customer, stores, quote, reference: "x" });
  assert.match(calls.find(c => c.host === "identity").body, /grant_type=refresh_token&refresh_token=old-rt/);
  assert.equal(JSON.parse(kv[TOKEN_KEY]).refreshToken, "new-rt");
  assert.ok(calls.filter(c => c.host === "api.xero.com").every(c => c.tenant === "org-1"));
});

test("web app without a connection fails with a clear message", async () => {
  fakeXero([], {});
  await assert.rejects(raiseXeroDocument({ ...env, XERO_MODE: undefined, KV_REST_API_URL: "https://kv.test", KV_REST_API_TOKEN: "t" }, { customer, stores, quote, reference: "x" }), /isn't connected yet/);
});
