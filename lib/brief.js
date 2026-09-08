/*
 * Turns a submitted mat brief (the JSON the builder posts) into everything the emails need:
 * the designer's HTML, the store's HTML, a tab-separated text version that pastes cleanly into
 * Illustrator, a CSV, and the JSON itself. No dependencies, no side effects.
 */

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

/* ---------- HTML ---------- */
const S = {
  body: "margin:0;padding:0;background:#f3f4f7;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;color:#1b2333;font-size:14px;line-height:1.45",
  wrap: "max-width:960px;margin:0 auto;padding:20px",
  card: "background:#fff;border:1px solid #e3e6ec;border-radius:10px;padding:16px 18px;margin:0 0 16px",
  h1: "margin:0 0 4px;font-size:22px;color:#182a48",
  h2: "margin:22px 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e3e6ec;padding-bottom:6px",
  h3: "margin:16px 0 6px;font-size:15px;color:#182a48",
  chip: "display:inline-block;font-size:11px;background:#f3f4f7;border-radius:999px;padding:2px 9px;margin-left:6px;color:#6b7280;font-weight:normal",
  table: "border-collapse:collapse;width:100%;font-size:13px",
  th: "text-align:left;background:#182a48;color:#fff;padding:6px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase",
  td: "padding:5px 8px;border-bottom:1px solid #e3e6ec;vertical-align:top",
  muted: "color:#6b7280;font-size:12px",
  red: "color:#c4202e;font-weight:700",
};
const rowStyle = it => it.status === "changed" ? "background:#fff7ea" : it.status === "new" ? "background:#eaf8ee" : "";

function infoTable(c) {
  const rows = [
    ["Store", c.storeName || "—"],
    ["Contact", [c.m.contactName, c.m.contactEmail, c.m.contactPhone].filter(Boolean).join(" · ") || "—"],
    ["Mat size / quantity", c.m.matSize || "—"],
    ["Submitted", c.whenText],
    ["Changes from template", String(c.changes.length)],
  ];
  return `<table style="${S.table}">${rows.map(([k, v]) => `<tr><td style="${S.td};width:180px;color:#6b7280">${esc(k)}</td><td style="${S.td}"><b>${esc(v)}</b></td></tr>`).join("")}</table>`;
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
  }).join("") + `<td style="${S.td};font-size:11px;color:#7a4b06">${esc(statusLabel(it))}</td></tr>`).join("");
  return `<table style="${S.table}"><tr>${head}</tr>${rows || `<tr><td style="${S.td}" colspan="${cols.length + 1}"><i>No lines</i></td></tr>`}</table>`;
}
function sectionBlock(c, sec) {
  const chips = [c.kinds[sec.kind] || sec.kind, colorName(c, sec.color)].filter(Boolean).map(x => `<span style="${S.chip}">${esc(x)}</span>`).join("");
  const flag = sec.status === "new" ? `<span style="${S.chip};background:#eaf8ee;color:#155b2b">NEW SECTION</span>` : sec.status === "changed" ? `<span style="${S.chip};background:#fff7ea;color:#7a4b06">CHANGED: ${esc(sec.changedFields.map(k => FIELD_NAME[k] || k).join(", "))}</span>` : "";
  const extras = [sec.subtitle && `Subtitle: <b>${esc(sec.subtitle)}</b>`, sec.badge && `Header badge: <b>${esc(sec.badge)}</b>`, sec.footnote && `Footnote: <b>${esc(oneLine(sec.footnote))}</b>`].filter(Boolean);
  return `<h3 style="${S.h3}">${esc(sec.title || "(untitled section)")}${chips}${flag}</h3>
    ${sectionTable(c, sec)}
    ${extras.length ? `<p style="${S.muted};margin:6px 0 0">${extras.join(" &nbsp;·&nbsp; ")}</p>` : ""}`;
}
function contentBlocks(c) {
  return c.byColumn.map(col => `<h2 style="${S.h2}">${esc(col.theme)} &nbsp;<span style="font-weight:normal;letter-spacing:0;text-transform:none">${esc(col.name)} · ${col.sections.length} section${col.sections.length === 1 ? "" : "s"}</span></h2>
    ${col.sections.map(sec => sectionBlock(c, sec)).join("")}`).join("");
}
function changesBlock(c) {
  return c.changes.length
    ? `<ol style="margin:6px 0 0 18px;padding:0;font-size:13px">${c.changes.map(x => `<li style="margin:3px 0">${esc(x)}</li>`).join("")}</ol>`
    : `<p style="${S.muted};margin:6px 0 0">No changes from the template – print the template as-is with the store name above.</p>`;
}
const renderBlock = (c, caption) => `<div style="${S.card};background:#0f1d36;padding:10px"><img src="cid:layout" alt="Layout render for ${esc(c.storeName)}" style="display:block;width:100%;height:auto;border-radius:6px"></div>
  <p style="${S.muted};margin:-8px 0 16px">${caption}</p>`;

export function designerHtml(payload) {
  const c = ctx(payload);
  return `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.card}">
    <h1 style="${S.h1}">Mat brief – ${esc(c.storeName || "unnamed store")}</h1>
    <p style="${S.muted};margin:0 0 12px">Submitted from the Mister Minit Mat Builder${payload.page ? ` · <a href="${esc(payload.page)}" style="color:#1e5fa8">${esc(payload.page)}</a>` : ""}</p>
    ${infoTable(c)}
    ${c.notes ? `<h2 style="${S.h2}">Notes from the store</h2><div style="white-space:pre-wrap;background:#fafafa;border:1px solid #e3e6ec;border-radius:8px;padding:10px 12px">${esc(c.notes)}</div>` : ""}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Their layout <span style="font-weight:normal;letter-spacing:0;text-transform:none">(example only – the builder's approximate render)</span></h2>
    ${renderBlock(c, "Full-resolution render attached as <b>layout.png</b> (or .jpg). Rows highlighted orange below were changed from the template; green rows were added.")}
    <h2 style="${S.h2}">Changes from template (${c.changes.length})</h2>
    ${changesBlock(c)}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Full content – every section and price</h2>
    <p style="${S.muted};margin:0">Everything below is also attached as <b>brief.txt</b> (tab-separated, ready to paste into Illustrator), <b>brief.csv</b> and <b>brief.json</b>.</p>
    ${contentBlocks(c)}
  </div>
  <p style="${S.muted}">Header is fixed on every mat: FIXED WHILE YOU WAIT · ${esc(c.m.tagline || "")} · ${esc(c.m.gst || "")}</p>
  </div></body></html>`;
}

export function customerHtml(payload) {
  const c = ctx(payload);
  return `<!doctype html><html><body style="${S.body}"><div style="${S.wrap}">
  <div style="${S.card}">
    <h1 style="${S.h1}">Thanks${c.m.contactName ? `, ${esc(c.m.contactName.split(" ")[0])}` : ""} – we've received your mat brief</h1>
    <p style="margin:0 0 12px">This is your copy of what you sent us for <b>${esc(c.storeName)}</b>. We'll design the mat from it and be in touch if anything needs clarifying. If you spot a mistake, just reply to this email.</p>
    ${infoTable(c)}
    ${c.notes ? `<h2 style="${S.h2}">Your notes</h2><div style="white-space:pre-wrap;background:#fafafa;border:1px solid #e3e6ec;border-radius:8px;padding:10px 12px">${esc(c.notes)}</div>` : ""}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Your layout <span style="font-weight:normal;letter-spacing:0;text-transform:none">(example only – the finished mat will be professionally laid out in this style)</span></h2>
    ${renderBlock(c, "Rows highlighted orange were changed from the standard template; green rows were added.")}
    <h2 style="${S.h2}">What you changed (${c.changes.length})</h2>
    ${changesBlock(c)}
  </div>
  <div style="${S.card}">
    <h2 style="${S.h2};margin-top:0">Everything on your mat</h2>
    ${contentBlocks(c)}
  </div>
  </div></body></html>`;
}

/* ---------- plain text (tab-separated, Illustrator-friendly) ---------- */
export function briefText(payload) {
  const c = ctx(payload), L = [];
  L.push(`MISTER MINIT — PRICE MAT BRIEF`);
  L.push(`Store:      ${c.storeName}`);
  L.push(`Contact:    ${[c.m.contactName, c.m.contactEmail, c.m.contactPhone].filter(Boolean).join("  ")}`);
  L.push(`Mat size:   ${c.m.matSize || "-"}`);
  L.push(`Submitted:  ${c.whenText}`);
  L.push(`Header:     FIXED WHILE YOU WAIT | ${c.m.tagline || ""} | ${c.m.gst || ""}`);
  if (c.notes) { L.push(""); L.push("NOTES FROM THE STORE"); L.push(c.notes); }
  L.push(""); L.push(`CHANGES FROM TEMPLATE (${c.changes.length})`);
  L.push(...(c.changes.length ? c.changes.map(x => "• " + x) : ["(none)"]));
  for (const col of c.byColumn) {
    L.push(""); L.push(`==== ${col.name.toUpperCase()} — ${col.theme.toUpperCase()} ====`);
    for (const sec of col.sections) {
      L.push("");
      L.push(`${(sec.title || "(UNTITLED)").toUpperCase()}\t[${c.kinds[sec.kind] || sec.kind} · ${colorName(c, sec.color)}${sec.status ? " · " + sec.status.toUpperCase() : ""}]`);
      if (sec.subtitle) L.push(`Subtitle:\t${sec.subtitle}`);
      if (sec.badge) L.push(`Badge:\t${sec.badge}`);
      for (const it of sec.items || []) {
        const flag = [it.hl && "RED", it.featured && "FEATURED", statusLabel(it)].filter(Boolean).join(" · ");
        let cells;
        if (sec.kind === "packages") cells = [it.num, it.label, oneLine(it.desc), it.price, it.save];
        else if (sec.kind === "tiers") cells = [it.label, it.color, oneLine(it.desc), it.price, it.allow];
        else if (sec.kind === "combos") cells = [it.label, oneLine(it.desc), `was ${it.was}`, `now ${it.price}`, it.save, it.note];
        else cells = [it.label, it.price];
        L.push(cells.map(v => String(v ?? "")).join("\t") + (flag ? `\t(${flag})` : ""));
      }
      if (sec.footnote) L.push(`Footnote:\t${oneLine(sec.footnote)}`);
    }
  }
  L.push(""); L.push("Flags: RED = price shown in red on the mat · CHANGED / NEW = different from the template");
  return L.join("\n");
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
  const { image, ...data } = payload;
  const slug = (c.storeName || "store").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    storeName: c.storeName,
    subject: `Mat brief – ${c.storeName || "unnamed store"} (${c.changes.length} change${c.changes.length === 1 ? "" : "s"} from template)`,
    customerSubject: `Your Mister Minit mat brief – ${c.storeName}`,
    designerHtml: designerHtml(payload),
    customerHtml: customerHtml(payload),
    text: briefText(payload),
    csv: briefCsv(payload),
    json: JSON.stringify(data, null, 2),
    fileBase: `mister-minit-mat-${slug}`,
  };
}
