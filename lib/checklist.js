/*
 * The designer's printable checklist (A4 PDF): store names, delivery, notes, every change from the
 * template, then every line on the mat – each with a tick box – so the brief can be worked through on paper.
 * Uses pdf-lib's built-in Helvetica, so text is limited to the Windows-1252 character set (see pdfText).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ctx, colorName, FIELD_NAME, oneLine } from "./brief.js";
import { addressText, contactName, MAT_SIZE, storeLabel } from "./order.js";

const A4 = [595.28, 841.89], M = 40, GUTTER = 18;
const INK = rgb(0.11, 0.14, 0.2), MUTED = rgb(0.42, 0.45, 0.5), RULE = rgb(0.82, 0.84, 0.88);
const RED = rgb(0.77, 0.13, 0.18);
const TINT = { changed: rgb(0.99, 0.94, 0.87), new: rgb(0.9, 0.96, 0.92) };

/* Standard PDF fonts only know Windows-1252; swap the few characters the builder uses that it lacks */
const CP1252 = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
const SWAP = { "★": "*", "✓": "", "→": "->", "≈": "~", "\t": " " };
export const pdfText = s => [...String(s ?? "")].map(ch => {
  if (ch in SWAP) return SWAP[ch];
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252.has(ch) ? ch : "?";
}).join("");

function lineFor(kind, it) {
  const d = oneLine(it.desc);
  switch (kind) {
    case "packages": return [`${it.num ? it.num + ". " : ""}${it.label}${d ? " – " + d : ""}`, [it.price, it.save].filter(Boolean).join("  ")];
    case "tiers":    return [`${it.label}${d ? " – " + d : ""}`, [it.price, it.allow].filter(Boolean).join("  ")];
    case "combos":   return [`${it.label}${d ? " – " + d : ""}${it.note ? " (" + it.note + ")" : ""}`, [it.was && "was " + it.was, it.price, it.save].filter(Boolean).join("  ")];
    default:         return [it.label, it.price];
  }
}
const tagsFor = (kind, it) => [
  it.hl && "RED",
  kind === "packages" && it.featured && "FEATURED",
  it.status === "new" ? "NEW" : it.status === "changed" ? "CHANGED" + (it.changedFields?.length ? ": " + it.changedFields.map(k => FIELD_NAME[k] || k).join(", ") : "") : "",
].filter(Boolean);

/** @returns {Promise<Buffer>} */
export async function checklistPdf(payload, extra = {}) {
  const c = ctx(payload, extra);
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfText(`Mat checklist – ${c.storeName}`)); pdf.setAuthor("Ankor'd · Mister Minit Mat Builder");
  const F = await pdf.embedFont(StandardFonts.Helvetica), B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = A4[0] - 2 * M, TOP = A4[1] - M, BOTTOM = M + 22;

  let page, y, cols = 1, col = 0;
  const colW = () => cols === 1 ? W : (W - GUTTER) / 2;
  const colX = () => M + col * (colW() + GUTTER);
  const newPage = () => { page = pdf.addPage(A4); y = TOP; col = 0; };
  const ensure = h => {             // room for h points in this column, else next column / page
    if (y - h >= BOTTOM) return;
    if (cols === 2 && col === 0) { col = 1; y = colTop; } else { newPage(); colTop = y; }
  };
  let colTop = TOP;
  const wrap = (str, font, size, width) => {
    const out = []; let line = "";
    for (const word of pdfText(str).split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next; else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out.length ? out : [""];
  };
  const text = (str, x, yy, size, font = F, color = INK) => page.drawText(pdfText(str), { x, y: yy, size, font, color });
  const box = (x, yy) => page.drawRectangle({ x, y: yy - 1, width: 8, height: 8, borderColor: INK, borderWidth: 0.8 });

  /* a heading that stays with at least `keep` points of what follows */
  const heading = (str, size = 11, keep = 30) => {
    ensure(size + 8 + keep); y -= size + 2;
    text(str, colX(), y, size, B); y -= 4;
    page.drawLine({ start: { x: colX(), y }, end: { x: colX() + colW(), y }, thickness: 0.6, color: RULE }); y -= 8;
  };
  /* one tick-box row: wrapped label on the left, optional value right-aligned, optional tags underneath */
  const row = (label, value = "", { tags = [], tint = null, size = 8.5 } = {}) => {
    const w = colW(), valW = value ? Math.min(B.widthOfTextAtSize(pdfText(value), size), w * 0.42) : 0;
    const lines = wrap(label, F, size, w - 14 - (value ? valW + 8 : 0));
    const valLines = value ? wrap(value, B, size, w * 0.42) : [];
    const n = Math.max(lines.length, valLines.length), lh = size + 2.5;
    const h = n * lh + (tags.length ? lh : 0) + 3;
    ensure(h);
    const x = colX();                 // after ensure – the row may have moved to the next column
    if (tint) page.drawRectangle({ x: x - 2, y: y - h + 1, width: w + 4, height: h, color: tint });
    box(x, y - size + 1);
    lines.forEach((l, i) => text(l, x + 14, y - size - i * lh + 1, size));
    valLines.forEach((l, i) => text(l, x + w - B.widthOfTextAtSize(l, size), y - size - i * lh + 1, size, B, tags.includes("RED") ? RED : INK));
    if (tags.length) text(tags.join(" · "), x + 14, y - size - n * lh + 1, size - 1.5, B, MUTED);
    y -= h + 1.5;
  };
  const note = (str, size = 8) => {
    for (const l of wrap(str, F, size, colW() - 14)) { ensure(size + 3); text(l, colX() + 14, y - size, size, F, MUTED); y -= size + 2.5; }
    y -= 2;
  };

  newPage();
  /* ---- title block */
  text(`Mat checklist – ${c.storeName || "unnamed store"}`, M, y - 16, 16, B); y -= 24;
  const doc = extra.doc;
  text([doc && `${doc.kind === "invoice" ? "Invoice" : "Quote"} ${doc.number}`, `Submitted ${c.whenText}`, `${c.quote.mats} x ${MAT_SIZE}`, `${c.changes.length} change${c.changes.length === 1 ? "" : "s"} from template`].filter(Boolean).join("   ·   "), M, y - 9, 9, F, MUTED); y -= 20;
  const cu = c.customer;
  for (const [k, v] of [["Business", [cu.tradingName, cu.legalName !== cu.tradingName && cu.legalName, cu.abn && "ABN " + cu.abn].filter(Boolean).join(" · ")], ["Contact", [contactName(cu), cu.phone, cu.email].filter(Boolean).join(" · ")], ["Deliver to", addressText(cu.delivery)]]) {
    if (!v) continue;
    text(k, M, y - 9, 9, B, MUTED);
    wrap(v, F, 9, W - 70).forEach((l, i) => text(l, M + 70, y - 9 - i * 12, 9));
    y -= 12 * wrap(v, F, 9, W - 70).length + 2;
  }
  y -= 6;

  /* ---- store names: one mat design per store */
  heading("Store names on the mats");
  for (const s of c.stores) row(storeLabel(s), `${s.qty} mat${s.qty === 1 ? "" : "s"}`);

  if (c.notes) { heading("Notes from the store"); for (const para of c.notes.split(/\n+/)) row(para); }

  /* ---- every change from the template */
  heading(`Changes from the template (${c.changes.length})`);
  if (c.changes.length) for (const ch of c.changes) row(ch);
  else note("None – use the template as-is with the store names above.");

  /* ---- the full mat, two columns per page */
  y -= 6; ensure(60);
  text("Everything on the mat", M, y - 13, 13, B); y -= 22;
  cols = 2; col = 0; colTop = y;
  for (const column of c.byColumn) {
    heading(`${column.theme} – ${column.name}`, 10, 40);
    for (const sec of column.sections) {
      const meta = [colorName(c, sec.color), sec.subtitle && `subtitle "${sec.subtitle}"`, sec.badge && `badge "${sec.badge}"`,
        sec.status === "new" ? "NEW SECTION" : sec.status === "changed" && `CHANGED: ${sec.changedFields.map(k => FIELD_NAME[k] || k).join(", ")}`].filter(Boolean).join(" · ");
      ensure(34);
      text(sec.title || "(untitled section)", colX(), y - 9, 9, B); y -= 12;
      if (meta) { for (const l of wrap(meta, F, 7.5, colW())) { text(l, colX(), y - 7.5, 7.5, F, MUTED); y -= 9.5; } }
      y -= 2;
      for (const it of sec.items || []) {
        const [label, value] = lineFor(sec.kind, it);
        row(label, value, { tags: tagsFor(sec.kind, it), tint: TINT[it.status] || null });
      }
      if (sec.footnote) row(`Footnote: ${oneLine(sec.footnote)}`, "", { size: 8 });
      y -= 6;
    }
  }

  /* ---- footer on every page */
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(pdfText(`Mister Minit mat checklist · ${c.storeName} · page ${i + 1} of ${pages.length}`), { x: M, y: M - 6, size: 7.5, font: F, color: MUTED });
    p.drawText(pdfText("Tint: orange = changed, green = added. Red = price shown in red."), { x: A4[0] - M - F.widthOfTextAtSize("Tint: orange = changed, green = added. Red = price shown in red.", 7.5), y: M - 6, size: 7.5, font: F, color: MUTED });
  });
  return Buffer.from(await pdf.save());
}
