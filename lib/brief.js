/*
 * Turns a submitted mat brief (the JSON the builder posts) into the two Ankor'd-branded emails
 * and a CSV of every line on the mat. No dependencies, no side effects.
 */
import { BRAND } from "./brand.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = s => String(s ?? "").replace(/\s*\n\s*/g, " / ").trim();
const yes = v => (v ? "Yes" : "");

const COLS = {
  list:      [["label", "Item"], ["price", "Price"], ["hl", "Red price"]],
  guarantee: [["label", "Item"], ["price", "Term"]],
  packages:  [["num", "No."], ["label", "Package"], ["desc", "Includes"], ["price", "Price"], ["save", "Save badge"], ["featured", "Featured"]],
  tiers:     [["label", "Tier"], ["color", "Badge colour"], ["desc", "Description"], ["price", "Price"], ["allow", "Time"]],
  combos:    [["label", "Deal"], ["desc", "Description"], ["was", "Was"], ["price", "Now"], ["save", "Save badge"], ["note", "Small note"]],
};
const BOOL_KEYS = new Set(["hl", "featured"]);
const FIELD_NAME = { label: "text", price: "price", hl: "red highlight", desc: "description", save: "save badge", featured: "featured", num: "number", color: "colour", allow: "time", was: "was price", note: "note", title: "title", subtitle: "subtitle", badge: "badge", footnote: "footnote", column: "column" };

/* ---------- shared helpers ---------- */
function ctx(payload) {
  const lk = payload.lookup || {};
  const columns = Array.isArray(lk.columns) && lk.columns.length ? lk.columns : [
    { key: "1", name: "Column 1 – left", theme: "Keys & sharpening" }, { key: "2", name: "Column 2", theme: "Car keys" },
    { key: "3", name: "Column 3 – centre", theme: "Shoe repairs" }, { key: "4", name: "Column 4", theme: "Watches" },
    { key: "5", name: "Column 5 – right", theme: "Engraving & tags" }, { key: "bottom", name: "Bottom band", theme: "Deals & guarantee" },
  ];
  const colors = lk.colors || {};
  const kinds = lk.kinds || { list: "Price list", guarantee: "Guarantee", packages: "Packages", tiers: "Tiers", combos: "Combo deals" };
  const m = payload.meta || {};
  const storeName = [m.store1, m.store2].filter(Boolean).join(" ");
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const byColumn = columns.map(c => ({ ...c, sections: sections.filter(s => s.column === c.key) })).filter(c => c.sections.length);
  const orphans = sections.filter(s => !columns.some(c => c.key === s.column));
  if (orphans.length) byColumn.push({ key: "?", name: "Unplaced", theme: "Unplaced sections", sections: orphans });
  const when = payload.submittedAt ? new Date(payload.submittedAt) : new Date();
  const whenText = when.toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  return { m, storeName, sections, byColumn, colors, kinds, whenText, changes, notes: String(m.notes || "").trim() };
}
const colorName = (c, key) => c.colors[key] || key || "";
const statusLabel = it => it.status === "new" ? "NEW" : it.status === "changed" ? "CHANGED" + (it.changedFields?.length ? " (" + it.changedFields.map(k => FIELD_NAME[k] || k).join(", ") + ")" : "") : "";

/* ---------- Ankor'd email styling (inline, for email clients) ---------- */
const C = BRAND.colors;
const FONT = "'Segoe UI',Calibri,Helvetica,Arial,sans-serif";
const S = {
  body: `margin:0;padding:0;background:${C.mistLight};font-family:${FONT};color:${C.ink};font-size:14px;line-height:1.5`,
  wrap: "max-width:960px;margin:0 auto;padding:0 16px 24px",
  header: `background:${C.teal};border-radius:0 0 12px 12px;padding:22px 24px;border-bottom:4px solid ${C.orange}`,
  headerLabel: `color:${C.mist};font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;text-align:right`,
  card: `background:#fff;border:1px solid ${C.mistStrong};border-radius:10px;padding:18px 20px;margin:16px 0 0`,
  h1: `margin:0 0 4px;font-size:22px;line-height:1.25;color:${C.ink};font-weight:700`,
  h2: `margin:22px 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${C.tealMid};font-weight:700;border-bottom:2px solid ${C.mistStrong};padding-bottom:6px`,
  h3: `margin:16px 0 6px;font-size:15px;color:${C.teal};font-weight:700`,
  chip: `display:inline-block;font-size:11px;background:${C.mistLight};border-radius:999px;padding:2px 9px;margin-left:6px;color:${C.inkSoft};font-weight:normal`,
  table: "border-collapse:collapse;width:100%;font-size:13px",
  th: `text-align:left;background:${C.teal};color:#fff;padding:6px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase`,
  td: `padding:5px 8px;border-bottom:1px solid ${C.mistStrong};vertical-align:top`,
  muted: `color:${C.inkSoft};font-size:12px`,
  red: "color:#c4202e;font-weight:700",
  button: `display:inline-block;background:${C.teal};color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px`,
  footer: `background:${C.teal};border-radius:12px;padding:20px 24px;margin-top:20px;color:${C.mist};font-size:12px;line-height:1.6`,
};
const rowStyle = it => it.status === "changed" ? `background:${C.orangeTint}` : it.status === "new" ? `background:${C.tealTint}` : "";

function header(label) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${S.header}"><tr>
    <td style="vertical-align:middle"><img src="cid:ankord-logo" alt="Ankor'd" width="150" style="display:block;width:150px;height:auto;border:0"></td>
    <td style="vertical-align:middle;${S.headerLabel}">${esc(label)}</td></tr></table>`;
}
function footer() {
  return `<div style="${S.footer}">
    <img src="cid:ankord-logo" alt="Ankor'd" width="110" style="display:block;width:110px;height:auto;border:0;margin-bottom:10px">
    <div style="color:#fff;font-weight:600;font-size:13px">${esc(BRAND.name)}</div>
    <div>${esc(BRAND.tagline)}</div>
    <div style="margin-top:8px"><a href="mailto:${BRAND.email}" style="color:#fff;text-decoration:none">${BRAND.email}</a> &nbsp;·&nbsp; <a href="${BRAND.site}" style="color:#fff;text-decoration:none">${BRAND.site.replace(/^https?:\/\//, "")}</a></div>
    <div style="margin-top:10px;font-size:11px;color:${C.mist}">This email was generated by the Mister Minit Mat Builder, built and run by ${esc(BRAND.name)} for Mister Minit stores.</div>
  </div>`;
}
function infoTable(c) {
  const rows = [
    ["Store", c.storeName || "—"],
    ["Contact", [c.m.contactName, c.m.contactEmail, c.m.contactPhone].filter(Boolean).join(" · ") || "—"],
    ["Mat size / quantity", c.m.matSize || "—"],
    ["Submitted", c.whenText],
    ["Changes from template", String(c.changes.length)],
  ];
  return `<table style="${S.table}">${rows.map(([k, v]) => `<tr><td style="${S.td};width:180px;color:${C.inkSoft}">${esc(k)}</td><td style="${S.td}"><b>${esc(v)}</b></td></tr>`).join("")}</table>`;
}
function sectionTable(c, sec) {
  const cols = COLS[sec.kind] || COLS.list;
  const head = cols.map(([, h]) => `<th style="${S.th}">${esc(h)}</th>`).join("") + `<th style="${S.th}">Status</th>`;
  const rows = (sec.items || []).map(it => `<tr style="${rowStyle(it)}">` + cols.map(([k]) => {
    let v = it[k];
    if (BOOL_KEYS.has(k)) v = yes(v);
    else if (k === "desc") v = oneLine(v);
    const style = (k === "price" && it.hl) ? `${S.td};${S.red}` : (k === "price" || k === "was") ? `${S.td};white-space:nowrap;font-weight:600` : S.td;
    return `<td style="${style}">${esc(v)}</td>`;
  }).join("") + `<td style="${S.td};font-size:11px;color:${C.orange};font-weight:600">${esc(statusLabel(it))}</td></tr>`).join("");
  return `<table style="${S.table}"><tr>${head}</tr>${rows || `<tr><td style="${S.td}" colspan="${cols.length + 1}"><i>No lines</i></td></tr>`}</table>`;
}
function sectionBlock(c, sec) {
  const chips = [c.kinds[sec.kind] || sec.kind, colorName(c, sec.color)].filter(Boolean).map(x => `<span style="${S.chip}">${esc(x)}</span>`).join("");
  const flag = sec.status === "new" ? `<span style="${S.chip};background:${C.tealTint};color:${C.tealMid}">NEW SECTION</span>` : sec.status === "changed" ? `<span style="${S.chip};background:${C.orangeTint};color:${C.orange}">CHANGED: ${esc(sec.changedFields.map(k => FIELD_NAME[k] || k).join(", "))}</span>` : "";
  const extras = [sec.subtitle && `Subtitle: <b>${esc(sec.subtitle)}</b>`, sec.badge && `Header badge: <b>${esc(sec.badge)}</b>`, sec.footnote && `Footnote: <b>${esc(oneLine(sec.footnote))}</b>`].filter(Boolean);
  return `<h3 style="${S.h3}">${esc(sec.title || "(untitled section)")}${chips}${flag}</h3>
    ${sectionTable(c, sec)}
    ${extras.length ? `<p style="${S.muted};margin:6px 0 0">${extras.join(" &nbsp;·&nbsp; ")}</p>` : ""}`;
}
function contentBlocks(c) {
  return c.byColumn.map(col => `<h2 style="${S.h2}">${esc(col.theme)} &nbsp;<span style="font-weight:normal;letter-spacing:0;text-transform:none;color:${C.inkSoft}">${esc(col.name)} · ${col.sections.length} section${col.sections.length === 1 ? "" : "s"}</span></h2>
    ${col.sections.map(sec => sectionBlock(c, sec)).join("")}`).join("");
}
function changesBlock(c) {
  return c.changes.length
    ? `<ol style="margin:6px 0 0 18px;padding:0;font-size:13px">${c.changes.map(x => `<li style="margin:3px 0">${esc(x)}</li>`).join("")}</ol>`
    : `<p style="${S.muted};margin:6px 0 0">No changes from the template – print the template as-is with the store name above.</p>`;
}
const renderBlock = (c, caption) => `<div style="background:#0f1d36;border-radius:8px;padding:8px;margin:8px 0 6px"><img src="cid:layout" alt="Layout render for ${esc(c.storeName)}" style="display:block;width:100%;height:auto;border-radius:6px"></div>
  <p style="${S.muted};margin:0 0 12px">${caption}</p>`;
const legend = `Rows highlighted <span style="background:${C.orangeTint};padding:1px 6px;border-radius:3px">orange</span> were changed from the template; <span style="background:${C.tealTint};padding:1px 6px;border-radius:3px">teal</span> rows were added.`;
const page = (label, inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="${S.body}"><div style="${S.wrap}">${header(label)}${inner}${footer()}</div></body></html>`;

export function designerHtml(payload) {
  const c = ctx(payload);
  return page("Mister Minit Mat Builder · New brief", `
  <div style="${S.card}">
    <h1 style="${S.h1}">Mat brief – ${esc(c.storeName || "unnamed store")}</h1>
    <p style="${S.muted};margin:0 0 12px">Submitted through the Mister Minit Mat Builder${payload.page ? ` · <a href="${esc(payload.page)}" style="color:${C.tealMid}">${esc(payload.page)}</a>` : ""}. Reply to this email to reach the store contact.</p>
    ${infoTable(c)}
    ${c.notes ? `<h2 style="${S.h2}">Notes from the store</h2><div style="white-space:pre-wrap;background:${C.mistLight};border:1px solid ${C.mistStrong};border-radius:8px;padding:10px 12px">${esc(c.notes)}</div>` : ""}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Their layout <span style="font-weight:normal;letter-spacing:0;text-transform:none;color:${C.inkSoft}">(example only – the builder's approximate render)</span></h2>
    ${renderBlock(c, `Full-resolution render attached as <b>layout.png</b> (or .jpg). ${legend}`)}
    <h2 style="${S.h2}">Changes from template (${c.changes.length})</h2>
    ${changesBlock(c)}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Full content – every section and price</h2>
    <p style="${S.muted};margin:0">Every line is also attached as a <b>.csv</b> for Illustrator.</p>
    ${contentBlocks(c)}
    <p style="${S.muted};margin:14px 0 0">Header is fixed on every mat: FIXED WHILE YOU WAIT · ${esc(c.m.tagline || "")} · ${esc(c.m.gst || "")}</p>
  </div>`);
}

export function customerHtml(payload) {
  const c = ctx(payload);
  const first = (c.m.contactName || "").trim().split(/\s+/)[0];
  return page("Mister Minit Mat Builder · Your copy", `
  <div style="${S.card}">
    <h1 style="${S.h1}">Thanks${first ? `, ${esc(first)}` : ""} – we've received your mat brief</h1>
    <p style="margin:0 0 12px">This is your copy of what you sent us for <b>${esc(c.storeName)}</b>. The ${esc(BRAND.name)} design team will lay out your mat from it and be in touch if anything needs clarifying. Spotted a mistake? Just reply to this email.</p>
    ${infoTable(c)}
    ${c.notes ? `<h2 style="${S.h2}">Your notes</h2><div style="white-space:pre-wrap;background:${C.mistLight};border:1px solid ${C.mistStrong};border-radius:8px;padding:10px 12px">${esc(c.notes)}</div>` : ""}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Your layout <span style="font-weight:normal;letter-spacing:0;text-transform:none;color:${C.inkSoft}">(example only – the finished mat will be professionally laid out in this style)</span></h2>
    ${renderBlock(c, legend)}
    <h2 style="${S.h2}">What you changed (${c.changes.length})</h2>
    ${changesBlock(c)}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Everything on your mat</h2>
    ${contentBlocks(c)}
  </div>`);
}

/* ---------- CSV ---------- */
export function briefCsv(payload) {
  const c = ctx(payload);
  const q = v => { const s = String(v ?? ""); return /[",\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [["Column", "Section", "Type", "Colour", "No.", "Item", "Price", "Red", "Description", "Was", "Save badge", "Note / time", "Featured", "Status"]];
  for (const col of c.byColumn) for (const sec of col.sections) for (const it of sec.items || []) {
    rows.push([col.name, sec.title, c.kinds[sec.kind] || sec.kind, colorName(c, sec.color), it.num, it.label, it.price, yes(it.hl), oneLine(it.desc), it.was, it.save, it.note || it.allow, yes(it.featured), statusLabel(it)]);
  }
  return rows.map(r => r.map(q).join(",")).join("\r\n");
}

/* ---------- everything, in one go ---------- */
export function buildBrief(payload) {
  const c = ctx(payload);
  const slug = (c.storeName || "store").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    storeName: c.storeName,
    subject: `Mat brief – ${c.storeName || "unnamed store"} (${c.changes.length} change${c.changes.length === 1 ? "" : "s"} from template)`,
    customerSubject: `Your Mister Minit mat brief – ${c.storeName}`,
    designerHtml: designerHtml(payload),
    customerHtml: customerHtml(payload),
    csv: briefCsv(payload),
    fileBase: `mister-minit-mat-${slug}`,
  };
}
