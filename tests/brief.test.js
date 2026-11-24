import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief, briefCsv } from "../lib/brief.js";
import { processOrder, readEnv, briefPayload } from "../api/submit.js";
import { isValidAbn, formatAbn, profileProblems, readProfile, readPricing } from "../lib/order.js";
import {
  TEMPLATE_SECTIONS, clone, designChanges, matPrice, quoteLines, storeProblems, annotate, newDesignState, changesToNextTier, blankItem,
} from "../shared/mat.js";

/* ---------- fixtures ---------- */
const customerRow = {
  id: "user_01TEST", email: "sam@example.com", first_name: "Sam", last_name: "Lee",
  legal_name: "Lee Family Holdings Pty Ltd", trading_name: "Mister Minit Penrith", abn: "51 824 753 556", phone: "0400 000 000",
  billing: { street: "1 High St", suburb: "Penrith", state: "NSW", postcode: "2750" }, delivery_same: true, delivery: {},
  xero_contact_id: null,
};
function editedState() {
  const st = newDesignState(clone(TEMPLATE_SECTIONS));
  st.stores = [{ id: "s1", line1: "PENRITH", line2: "", qty: 1 }, { id: "s2", line1: "BLACKTOWN", line2: "WESTPOINT", qty: 2 }];
  const sec = st.sections.find(s => s.kind === "list");
  sec.items[0].price = "$99.95";                         // 1: edited line
  sec.items.push({ ...blankItem("list"), label: "Bike Key", price: "$12" });   // 2: added line
  st.notes = "No Birkenstock here";
  return st;
}
/** a stand-in for the Neon tagged template: records every statement, returns a row for inserts */
function fakeSql() {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/^\s*insert into orders/i.test(text)) return [{ id: "order-1", number: "MM-1001" }];
    return [];
  };
  sql.calls = calls;
  return sql;
}
const env = readEnv({ MS_DIRECTORY_TENANT_ID: "t", MS_APPLICATION_CLIENT_ID: "c", MS_APP_CLIENT_SECRET: "s", MAIL_FROM: "marketing@ankord.com.au", MAIL_TO: "marketing@ankord.com.au" });
const xeroEnv = { ...env, XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y" };
const design = { id: "design-1", name: "New mat", base_sections: null, base_design_id: null };
const image = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", width: 3000, height: 1500 };
const fakeDoc = { kind: "invoice", id: "i1", number: "INV-0107", subTotal: 440, tax: 44, total: 490, pdf: Buffer.from("%PDF-1.4 test"),
  payUrl: "https://in.xero.com/abc", due: "2026-10-07", contact: { contactId: "c1", name: "Lee Family Holdings Pty Ltd", created: true } };

/* ---------- change counting ---------- */
test("the untouched template has no changes", () => {
  assert.equal(designChanges(clone(TEMPLATE_SECTIONS)).count, 0);
});

test("changes are counted per line", () => {
  const s = clone(TEMPLATE_SECTIONS), list = s.find(x => x.kind === "list");
  list.items[0].price = "$1";  list.items[0].label = "Something else";   // same line, two fields → 1
  assert.equal(designChanges(s).count, 1);
  list.items.splice(1, 1);                                                // removed line → +1
  assert.equal(designChanges(s).count, 2);
  list.title = "NEW TITLE";                                               // section setting → +1
  assert.equal(designChanges(s).count, 3);
  s.push({ id: "x1", title: "EXTRA", color: "orange", column: "1", kind: "list", items: [1, 2, 3].map(n => ({ ...blankItem("list"), label: `Line ${n}` })) });
  assert.equal(designChanges(s).count, 6, "a new section counts one per line");
  const gone = s.findIndex(x => x.id !== list.id && x.id !== "x1");
  s.splice(gone, 1);                                                      // removed section → +1
  assert.equal(designChanges(s).count, 7);
  assert.ok(designChanges(s).list.every(c => typeof c.text === "string" && c.n >= 1));
});

test("a reorder counts against the previous design, not the template", () => {
  const prev = editedState().sections;
  assert.equal(designChanges(clone(prev), prev).count, 0);
  const next = clone(prev); next[0].items[0].price = "$5";
  assert.equal(designChanges(next, prev).count, 1);
});

test("annotate marks new and changed lines for the designer", () => {
  const st = editedState(), a = annotate(st.sections, TEMPLATE_SECTIONS), list = a.find(s => s.kind === "list");
  assert.equal(list.items[0].status, "changed");
  assert.equal(list.items.at(-1).status, "new");
});

/* ---------- pricing ---------- */
test("mat price tiers: $150 up to 10 changes, then $15 per 10, capped at $250", () => {
  const cases = [[0, 150], [10, 150], [11, 165], [20, 165], [21, 180], [30, 180], [31, 195], [41, 210], [51, 225], [61, 240], [70, 240], [71, 250], [500, 250]];
  for (const [n, p] of cases) assert.equal(matPrice(n), p, `${n} changes`);
  assert.equal(changesToNextTier(8), 3);
  assert.equal(changesToNextTier(71), null);
});

test("quote: first mat by changes, each extra mat $150, $25 freight, GST inclusive", () => {
  const q = quoteLines([{ line1: "A", qty: 1 }, { line1: "B", qty: 2 }], readPricing({}), { changeCount: 12 });
  assert.deepEqual(q.lines.map(l => [l.key, l.qty, l.amount]), [["first", 1, 165], ["extra", 2, 300], ["freight", 1, 25]]);
  assert.equal(q.total, 490);
  assert.equal(q.gst, 44.55);
  const re = quoteLines([{ line1: "A", qty: 1 }], {}, { changeCount: 0, isReorder: true });
  assert.equal(re.lines[0].amount, 150);
  assert.match(re.lines[0].label, /Reprint/);
  assert.match(re.lines[0].description, /Reorder/);
  const ex = quoteLines([{ line1: "A", qty: 1 }], { freight: 30, includesGst: false }, { changeCount: 0 });
  assert.equal(ex.total, 198);   // (150 + 30) + 10% GST
});

/* ---------- validation ---------- */
test("ABN checksum and profile validation", () => {
  assert.ok(isValidAbn("51 824 753 556"));
  assert.ok(!isValidAbn("51 824 753 557"));
  assert.ok(!isValidAbn("1234"));
  assert.ok(isValidAbn("９１６９８８９６２７６"));   // full-width digits
  assert.equal(formatAbn("51824753556"), "51 824 753 556");
  const good = readProfile({ legalName: "A Pty Ltd", tradingName: "A", abn: "51824753556", firstName: "S", lastName: "L", phone: "1",
    billing: { street: "1 St", suburb: "X", state: "nsw", postcode: "2000" }, deliverySame: true }, "a@b.co");
  assert.deepEqual(profileProblems(good), []);
  const bad = profileProblems(readProfile({ ...good, abn: "123", deliverySame: false, delivery: {} }, "a@b.co"));
  assert.ok(bad.some(p => p.field === "abn"));
  assert.ok(bad.some(p => p.field === "delivery.street"));
});

test("store validation", () => {
  assert.deepEqual(storeProblems([{ line1: "A", qty: 1 }]), []);
  const p = storeProblems([{ line1: "", qty: 0 }]);
  assert.ok(p.includes("Store 1 needs a name"));
  assert.ok(p.some(x => /between/.test(x)));
  assert.ok(storeProblems([]).length);
});

/* ---------- brief + order flow ---------- */
test("designer brief carries the order number, changes and price", () => {
  const st = editedState(), changes = designChanges(st.sections);
  const payload = briefPayload({ state: st, customer: readProfile({ ...customerRow, legalName: customerRow.legal_name, tradingName: customerRow.trading_name, firstName: "Sam", lastName: "Lee", billing: customerRow.billing, deliverySame: true }, customerRow.email),
    changes, sections: annotate(st.sections, TEMPLATE_SECTIONS), submittedAt: "2026-09-08T04:00:00.000Z", image, orderNumber: "MM-1001" });
  const b = buildBrief(payload);
  assert.match(b.subject, /MM-1001/);
  assert.match(b.subject, /3 mats, 2 changes/);
  for (const needle of ["cid:ankord-logo", "Bike Key", "$99.95", "No Birkenstock here"]) assert.ok(b.designerHtml.includes(needle), needle);
  assert.ok(briefCsv(payload).split("\r\n").length > 10);
});

test("without Xero an order is still saved and both emails go out", async () => {
  const sql = fakeSql(), sent = [];
  const r = await processOrder({ customerRow, design, state: editedState(), image }, env, { sql, send: async (_e, m) => { sent.push(m); }, accountUrl: "https://x/misterminit/#/orders/" });
  assert.equal(r.order.number, "MM-1001");
  assert.equal(r.changes.count, 2);
  assert.equal(r.quote.total, 475);     // 150 + 2 × 150 + 25
  assert.match(r.xeroError, /Xero isn't connected/);
  assert.ok(sql.calls[0].text.startsWith("\n    insert into orders") || /insert into orders/.test(sql.calls[0].text));
  assert.ok(sql.calls.some(c => /update designs set/.test(c.text)), "design is marked ordered");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].to, ["marketing@ankord.com.au"]);
  assert.ok(sent[0].attachments.some(a => a.name.endsWith(".pdf") && a.name.startsWith("Checklist")));
  assert.match(sent[0].subject, /NO INVOICE/);
  assert.deepEqual(sent[1].to, ["sam@example.com"]);
  assert.ok(sent[1].html.includes("https://x/misterminit/#/orders/order-1"), "customer email links to the order in their account");
});

test("with Xero the invoice is raised once, the contact saved, and the PDF attached", async () => {
  const sql = fakeSql(), sent = [], raised = [];
  const raise = async (_e, o) => { raised.push(o); return fakeDoc; };
  const r = await processOrder({ customerRow, design, state: editedState(), image }, xeroEnv, { sql, send: async (_e, m) => { sent.push(m); }, raise });
  assert.equal(raised.length, 1);
  assert.equal(raised[0].customer.abn, "51 824 753 556");
  assert.match(raised[0].reference, /^MM-1001/);
  assert.equal(r.doc.number, "INV-0107");
  assert.ok(sql.calls.some(c => /update customers set xero_contact_id/.test(c.text)));
  assert.ok(sent[0].attachments.some(a => a.name === "Invoice INV-0107.pdf"));
  assert.ok(sent[1].html.includes('href="https://in.xero.com/abc"'));
});

test("a Xero failure or email failure doesn't lose the order", async () => {
  const sql = fakeSql();
  const raise = async () => { throw new Error("Account code '999' is not a valid code"); };
  const r = await processOrder({ customerRow, design, state: editedState(), image }, xeroEnv, { sql, raise, send: async () => { throw new Error("Graph down"); } });
  assert.match(r.xeroError, /not a valid code/);
  assert.equal(r.customerCopy, false);
  assert.ok(sql.calls.some(c => /email_error/.test(c.text)));
});

test("test mode (staging): order saved, nothing sent to Xero, no emails", async () => {
  const sql = fakeSql();
  const never = async () => { throw new Error("should not be called"); };
  const stagingEnv = readEnv({ MS_DIRECTORY_TENANT_ID: "t", MS_APPLICATION_CLIENT_ID: "c", MS_APP_CLIENT_SECRET: "s", XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y", VERCEL_ENV: "preview" });
  assert.equal(stagingEnv.TEST_MODE, true);
  const r = await processOrder({ customerRow, design, state: editedState(), image }, stagingEnv, { sql, send: never, raise: never });
  assert.equal(r.doc.number, "TEST-MM-1001");
  assert.equal(r.xeroError, null);
  assert.equal(r.customerCopy, false);
  assert.ok(sql.calls.some(c => /email_error/.test(c.text) && c.values.some(v => /Test mode/.test(v))));
  assert.ok(!sql.calls.some(c => c.values.some(v => /Brief failed/.test(String(v)))), "the brief and checklist still build in test mode");
  assert.equal(readEnv({ XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y", VERCEL_ENV: "production" }).TEST_MODE, false);
  assert.equal(readEnv({ VERCEL_ENV: "preview", TEST_MODE: "false" }).TEST_MODE, false);
});

test("a returning customer's invoice (saved Xero contact) still builds the brief", async () => {
  const sql = fakeSql(), sent = [];
  const raise = async () => ({ ...fakeDoc, contact: { contactId: "c1", created: false, matchedBy: "the saved account link" } });
  await processOrder({ customerRow: { ...customerRow, xero_contact_id: "c1" }, design, state: editedState(), image }, xeroEnv, { sql, send: async (_e, m) => { sent.push(m); }, raise });
  assert.equal(sent.length, 2);
  assert.ok(sent[0].html.includes("Lee Family Holdings Pty Ltd"));
});
