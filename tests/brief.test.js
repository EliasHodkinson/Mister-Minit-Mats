import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief, briefText, briefCsv } from "../lib/brief.js";
import { processSubmission } from "../api/submit.js";

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
};

test("designer email carries the essentials", () => {
  const b = buildBrief(payload);
  assert.match(b.subject, /PENRITH/);
  assert.match(b.subject, /2 changes/);
  for (const needle of ["HOUSE &amp; DOMESTIC KEYS", "Single Sided Key", "$10.95", "Bike Key", "Essential", "Battery / Gasket", "Key Pack", "No Birkenstock here", "cid:layout", "sam@example.com", "CHANGED (price)", "NEW"]) {
    assert.ok(b.designerHtml.includes(needle), `designer html should include ${needle}`);
  }
  assert.ok(b.customerHtml.includes("we've received your mat brief"));
  assert.ok(!b.json.includes("dataUrl"), "json attachment must not embed the image");
});

test("text version is tab-separated and grouped by column", () => {
  const t = briefText(payload);
  assert.ok(t.includes("==== COLUMN 1 – LEFT — KEYS & SHARPENING ===="));
  assert.ok(t.includes("Single Sided Key\t$10.95\t(RED · CHANGED (price))"));
  assert.ok(t.includes("Bike Key\t$12\t(NEW)"));
  assert.ok(t.includes("1\tEssential\tBattery / Gasket\t$30\tSAVE $8\t(FEATURED)"));
  assert.ok(t.includes("Footnote:\tLIFETIME GUARANTEE"));
});

test("csv has a header plus one row per line", () => {
  const rows = briefCsv(payload).split("\r\n");
  assert.equal(rows.length, 1 + 4);
  assert.ok(rows[0].startsWith("Column,Section,Type"));
  assert.ok(rows[2].includes("Bike Key"));
});

test("submission validation rejects bad input before any mail is sent", async () => {
  const env = { MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", MAIL_FROM: "marketing@ankord.com.au", MAIL_TO: ["marketing@ankord.com.au"] };
  await assert.rejects(processSubmission({ ...payload, meta: { ...payload.meta, contactEmail: "nope" } }, env), /Contact email/);
  await assert.rejects(processSubmission({ ...payload, image: { dataUrl: "data:text/html;base64,AAAA" } }, env), /PNG or JPEG/);
  await assert.rejects(processSubmission({ ...payload, sections: "x" }, env), /Sections/);
});
