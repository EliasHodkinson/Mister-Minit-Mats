import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief, briefCsv } from "../lib/brief.js";
import { processSubmission, readEnv } from "../api/submit.js";
import { createLimiter } from "../lib/ratelimit.js";
import { isValidAbn, formatAbn, orderProblems, quoteLines, readPricing } from "../lib/order.js";

const payload = {
  meta: {
    legalName: "Lee Family Holdings Pty Ltd", tradingName: "Mister Minit Penrith", abn: "51 824 753 556",
    firstName: "Sam", lastName: "Lee", contactName: "Sam Lee", contactEmail: "sam@example.com", contactPhone: "0400 000 000",
    billStreet: "1 High St", billSuburb: "Penrith", billState: "NSW", billPostcode: "2750", deliverySame: true,
    notes: "No Birkenstock here", tagline: "KEYS • CAR KEYS", gst: "ALL PRICES INCLUDE GST",
  },
  stores: [{ line1: "PENRITH", line2: "", qty: 1 }, { line1: "BLACKTOWN", line2: "WESTPOINT", qty: 2 }],
  sections: [
    { id: "house", title: "HOUSE & DOMESTIC KEYS", kind: "list", color: "orange", column: "1", footnote: "LIFETIME GUARANTEE", status: "", changedFields: [],
      items: [
        { id: "house-1", label: "Single Sided Key", price: "$10.95", hl: true, status: "changed", changedFields: ["price"] },
        { id: "n1", label: "Bike Key", price: "$12", hl: false, status: "new", changedFields: [] },
      ] },
    { id: "watchpk", title: "WATCH SERVICE PACKAGES", kind: "packages", color: "green", column: "4", badge: "SAVE UP TO $42", status: "", changedFields: [],
      items: [{ id: "watchpk-1", num: "1", label: "Essential", desc: "Battery\nGasket", price: "$30", save: "SAVE $8", featured: true, status: "", changedFields: [] }] },
    { id: "combos", title: "VALUE COMBO DEALS", kind: "combos", color: "blue", column: "bottom", status: "", changedFields: [],
      items: [{ id: "combos-1", label: "Key Pack", desc: "3 or more, 10% off", was: "$90", price: "$72", save: "SAVE $18", note: "", status: "", changedFields: [] }] },
  ],
  changes: ["Store name · line 1: was \"BLACKTOWN\", now \"PENRITH\"", "HOUSE & DOMESTIC KEYS · \"Single Sided Key\": price was \"$9.95\", now \"$10.95\""],
  lookup: { columns: [{ key: "1", name: "Column 1 – left", theme: "Keys & sharpening" }, { key: "4", name: "Column 4", theme: "Watches" }, { key: "bottom", name: "Bottom band", theme: "Deals & guarantee" }], colors: { orange: "Orange (keys)", green: "Green (watches / garage)", blue: "Blue (engraving / combos)" } },
  submittedAt: "2026-09-08T04:00:00.000Z",
  image: { dataUrl: "data:image/png;base64,iVBORw0KGgo=", width: 3000, height: 1500 },
  recaptchaToken: "test-token",
};

const env = readEnv({ MS_DIRECTORY_TENANT_ID: "t", MS_APPLICATION_CLIENT_ID: "c", MS_APP_CLIENT_SECRET: "s", RECAPTCHA_SECRET_KEY: "r", MAIL_FROM: "marketing@ankord.com.au", MAIL_TO: "marketing@ankord.com.au", FREIGHT_PRICE: "30" });
const xeroEnv = { ...env, XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y" };
const fakeDoc = { kind: "quote", id: "q1", number: "QU-0042", subTotal: 580, tax: 58, total: 638, pdf: Buffer.from("%PDF-1.4 test"), payUrl: null, contact: { contactId: "c1", name: "Lee Family Holdings Pty Ltd", created: true } };
const okVerify = async () => ({ score: 0.9, hostname: "apps.ankord.com.au" });
const noLimit = { name: "none", hit: async () => ({ allowed: true, count: 1, retryAfter: 0 }) };

test("designer email is Ankor'd-branded and carries the essentials", () => {
  const b = buildBrief(payload);
  assert.match(b.subject, /PENRITH, BLACKTOWN WESTPOINT/);
  assert.match(b.subject, /3 mats, 2 changes/);
  for (const needle of ["cid:ankord-logo", "#08393a", "ankord.com.au", "HOUSE &amp; DOMESTIC KEYS", "Single Sided Key", "$10.95", "Bike Key", "Essential", "Battery / Gasket", "Key Pack", "No Birkenstock here", "cid:layout", "sam@example.com", "CHANGED (price)", "NEW", "Lee Family Holdings Pty Ltd", "ABN 51 824 753 556", "1 High St, Penrith NSW 2750", "BLACKTOWN WESTPOINT – 2 mats"]) {
    assert.ok(b.designerHtml.includes(needle), `designer html should include ${needle}`);
  }
  assert.ok(b.customerHtml.includes("Brief received"));
  assert.ok(b.customerHtml.includes("Next steps"));
  assert.ok(!b.customerHtml.includes("Battery / Gasket"), "customer email skips the full content tables");
  assert.ok(b.customerHtml.includes("cid:ankord-logo"));
});

test("csv has a header plus one row per line", () => {
  const rows = briefCsv(payload).split("\r\n");
  assert.equal(rows.length, 1 + 4);
  assert.ok(rows[0].startsWith("Column,Section,Type"));
  assert.ok(rows[2].includes("Bike Key"));
});

test("without Xero a submission still sends both emails and flags the missing quote", async () => {
  const sent = [];
  const r = await processSubmission(payload, env, { ip: "1.2.3.4", limiter: noLimit, verify: okVerify, send: async (_e, m) => { sent.push(m); } });
  assert.equal(r.customerCopy, true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].to, ["marketing@ankord.com.au"]);
  assert.deepEqual(sent[0].attachments.map(a => a.name), ["ankord-logo.png", "layout.png", "Checklist – PENRITH, BLACKTOWN WESTPOINT.pdf", "mister-minit-mat-penrith.csv"]);
  assert.ok(Buffer.from(sent[0].attachments[2].contentBytes, "base64").subarray(0, 5).toString() === "%PDF-");
  assert.match(sent[0].subject, /NO INVOICE/);
  assert.ok(sent[0].html.includes("Please raise this one by hand"));
  assert.deepEqual(sent[1].to, ["sam@example.com"]);
  assert.deepEqual(sent[1].attachments.map(a => a.name), ["ankord-logo.png", "layout.png"]);
});

test("with Xero the quote is raised once and its PDF goes to both emails", async () => {
  const sent = [], raised = [];
  const raise = async (_e, o) => { raised.push(o); return fakeDoc; };
  const r = await processSubmission(payload, xeroEnv, { ip: "1.2.3.4", limiter: noLimit, verify: okVerify, send: async (_e, m) => { sent.push(m); }, raise });
  assert.equal(raised.length, 1);
  assert.equal(raised[0].customer.abn, "51 824 753 556");
  assert.equal(raised[0].quote.mats, 3);
  assert.equal(r.doc.number, "QU-0042");
  assert.ok(sent[0].attachments.some(a => a.name === "Quote QU-0042.pdf"));
  assert.ok(sent[1].attachments.some(a => a.name === "Quote QU-0042.pdf"));
  assert.match(sent[0].subject, /Quote QU-0042/);
  assert.ok(sent[0].html.includes("new contact created"));
  assert.ok(!sent[1].html.includes("new contact created"), "the customer never sees whether they were already in Xero");
  assert.ok(sent[1].html.includes("Next steps"));
  assert.ok(sent[1].html.includes("Quote QU-0042"));
});

test("a Xero failure doesn't lose the brief", async () => {
  const sent = [];
  const raise = async () => { throw new Error("Xero creating the quote failed: Account code '999' is not a valid code"); };
  const r = await processSubmission(payload, xeroEnv, { ip: "1.2.3.4", limiter: noLimit, verify: okVerify, send: async (_e, m) => { sent.push(m); }, raise });
  assert.equal(sent.length, 2);
  assert.match(r.xeroError, /not a valid code/);
  assert.ok(sent[0].html.includes("not a valid code"));
});

test("pricing: first mat $250 with design, each extra $150, then freight", () => {
  assert.deepEqual([readPricing({}).freight, readPricing({}).includesGst], [25, true]);
  const p = { ...readPricing({}), freight: 30, includesGst: false };
  const one = quoteLines([{ line1: "A", qty: 1 }], p);
  assert.deepEqual(one.lines.map(l => [l.key, l.qty, l.amount]), [["first", 1, 250], ["freight", 1, 30]]);
  assert.equal(one.total, 308);
  const three = quoteLines([{ line1: "A", qty: 1 }, { line1: "B", qty: 2 }], p);
  assert.deepEqual(three.lines.map(l => [l.key, l.qty, l.amount]), [["first", 1, 250], ["extra", 2, 300], ["freight", 1, 30]]);
  assert.equal(three.subTotal, 580);
  assert.equal(three.gst, 58);
  const inc = quoteLines([{ line1: "A", qty: 1 }], { ...p, freight: 0, includesGst: true });
  assert.equal(inc.total, 250);
  assert.equal(inc.gst, 22.73);
});

test("ABN checksum and order validation", () => {
  assert.ok(isValidAbn("51 824 753 556"));
  assert.ok(!isValidAbn("51 824 753 557"));
  assert.ok(!isValidAbn("1234"));
  assert.equal(formatAbn("51824753556"), "51 824 753 556");
  assert.deepEqual(orderProblems(payload), []);
  const bad = orderProblems({ ...payload, stores: [{ line1: "", qty: 0 }], meta: { ...payload.meta, abn: "123", deliverySame: false } });
  assert.ok(bad.includes("Store 1 needs a name"));
  assert.ok(bad.some(p => /quantity/.test(p)));
  assert.ok(bad.includes("ABN is missing or invalid"));
  assert.ok(bad.some(p => /Delivery address/.test(p)));
});

test("validation rejects bad input before any mail or captcha call", async () => {
  const never = async () => { throw new Error("should not be called"); };
  await assert.rejects(processSubmission({ ...payload, meta: { ...payload.meta, contactEmail: "nope" } }, env, { limiter: noLimit, verify: never, send: never }), /Contact email/);
  await assert.rejects(processSubmission({ ...payload, image: { dataUrl: "data:text/html;base64,AAAA" } }, env, { limiter: noLimit, verify: never, send: never }), /PNG or JPEG/);
  await assert.rejects(processSubmission({ ...payload, sections: "x" }, env, { limiter: noLimit, verify: never, send: never }), /Sections/);
  await assert.rejects(processSubmission({ ...payload, stores: [] }, env, { limiter: noLimit, verify: never, send: never, raise: never }), /at least one store/);
});

test("a failed captcha blocks sending", async () => {
  const never = async () => { throw new Error("should not be called"); };
  const badVerify = async () => { throw Object.assign(new Error("This submission looked automated"), { status: 403 }); };
  await assert.rejects(processSubmission(payload, env, { limiter: noLimit, verify: badVerify, send: never }), { status: 403 });
});

test("rate limit: sixth submission from one IP inside the window is refused with 429", async () => {
  const limiter = createLimiter({});     // in-memory store
  const sent = [];
  const opts = { ip: "9.9.9.9", limiter, verify: okVerify, send: async (_e, m) => { sent.push(m); } };
  const smallEnv = { ...env, LIMIT_EMAIL: 100, LIMIT_GLOBAL: 100 };
  for (let i = 0; i < 5; i++) await processSubmission(payload, smallEnv, opts);
  await assert.rejects(processSubmission(payload, smallEnv, opts), { status: 429 });
  assert.equal(sent.length, 10);
});

test("readEnv insists on the captcha secret", () => {
  assert.throws(() => readEnv({ MS_DIRECTORY_TENANT_ID: "t", MS_APPLICATION_CLIENT_ID: "c", MS_APP_CLIENT_SECRET: "s" }), /RECAPTCHA_SECRET_KEY/);
});

test("customer email leads with the pay button when Xero returns a pay link", () => {
  const doc = { ...fakeDoc, kind: "invoice", number: "INV-0107", payUrl: "https://in.xero.com/abc", due: "2026-10-07" };
  const b = buildBrief(payload, { doc });
  assert.ok(b.customerHtml.includes('href="https://in.xero.com/abc"'));
  assert.ok(b.customerHtml.includes("Pay invoice INV-0107"));
  assert.ok(b.customerHtml.includes("Due 7 Oct 2026"));
  assert.ok(b.customerHtml.indexOf("Pay invoice INV-0107") < b.customerHtml.indexOf("Next steps"));
});
