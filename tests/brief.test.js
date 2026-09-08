import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief, briefCsv } from "../lib/brief.js";
import { processSubmission, readEnv } from "../api/submit.js";
import { createLimiter } from "../lib/ratelimit.js";

const payload = {
  meta: { store1: "PENRITH", store2: "", contactName: "Sam Lee", contactEmail: "sam@example.com", contactPhone: "0400 000 000", matSize: "800 x 400 mm", notes: "No Birkenstock here", tagline: "KEYS • CAR KEYS", gst: "ALL PRICES INCLUDE GST" },
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

const env = readEnv({ MS_DIRECTORY_TENANT_ID: "t", MS_APPLICATION_CLIENT_ID: "c", MS_APP_CLIENT_SECRET: "s", RECAPTCHA_SECRET_KEY: "r", MAIL_FROM: "marketing@ankord.com.au", MAIL_TO: "marketing@ankord.com.au" });
const okVerify = async () => ({ score: 0.9, hostname: "apps.ankord.com.au" });
const noLimit = { name: "none", hit: async () => ({ allowed: true, count: 1, retryAfter: 0 }) };

test("designer email is Ankor'd-branded and carries the essentials", () => {
  const b = buildBrief(payload);
  assert.match(b.subject, /PENRITH/);
  assert.match(b.subject, /2 changes/);
  for (const needle of ["cid:ankord-logo", "#08393a", "ankord.com.au", "HOUSE &amp; DOMESTIC KEYS", "Single Sided Key", "$10.95", "Bike Key", "Essential", "Battery / Gasket", "Key Pack", "No Birkenstock here", "cid:layout", "sam@example.com", "CHANGED (price)", "NEW"]) {
    assert.ok(b.designerHtml.includes(needle), `designer html should include ${needle}`);
  }
  assert.ok(b.customerHtml.includes("we've received your mat brief"));
  assert.ok(b.customerHtml.includes("cid:ankord-logo"));
});

test("csv has a header plus one row per line", () => {
  const rows = briefCsv(payload).split("\r\n");
  assert.equal(rows.length, 1 + 4);
  assert.ok(rows[0].startsWith("Column,Section,Type"));
  assert.ok(rows[2].includes("Bike Key"));
});

test("a good submission sends two emails with logo, render and csv only", async () => {
  const sent = [];
  const r = await processSubmission(payload, env, { ip: "1.2.3.4", limiter: noLimit, verify: okVerify, send: async (_e, m) => { sent.push(m); } });
  assert.equal(r.customerCopy, true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].to, ["marketing@ankord.com.au"]);
  assert.deepEqual(sent[0].attachments.map(a => a.name), ["ankord-logo.png", "layout.png", "mister-minit-mat-penrith.csv"]);
  assert.deepEqual(sent[1].to, ["sam@example.com"]);
  assert.deepEqual(sent[1].attachments.map(a => a.name), ["ankord-logo.png", "layout.png"]);
});

test("validation rejects bad input before any mail or captcha call", async () => {
  const never = async () => { throw new Error("should not be called"); };
  await assert.rejects(processSubmission({ ...payload, meta: { ...payload.meta, contactEmail: "nope" } }, env, { limiter: noLimit, verify: never, send: never }), /Contact email/);
  await assert.rejects(processSubmission({ ...payload, image: { dataUrl: "data:text/html;base64,AAAA" } }, env, { limiter: noLimit, verify: never, send: never }), /PNG or JPEG/);
  await assert.rejects(processSubmission({ ...payload, sections: "x" }, env, { limiter: noLimit, verify: never, send: never }), /Sections/);
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
