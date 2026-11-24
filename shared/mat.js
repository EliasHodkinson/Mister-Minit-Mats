/*
 * Shared by the browser (builder, account, admin) and the server (pricing, emails, orders):
 * the Mister Minit mat template, how a design differs from what it started from, how many
 * changes that is, what the mat costs, the order statuses, and the HTML render of a mat.
 * Plain ES module, no dependencies.
 */

/* ===================== TEMPLATE (from Mister Minit Mat-CMYK-Outlined.pdf) ===================== */
export const PALETTE = {
  orange:    { name: "Orange (keys)",             bg: "#d3892d", fg: "#182a48" },
  red:       { name: "Red (shoes / mobile)",      bg: "#c4202e", fg: "#ffffff" },
  green:     { name: "Green (watches / garage)",  bg: "#1a8a3a", fg: "#182a48" },
  blue:      { name: "Blue (engraving / combos)", bg: "#1e5fa8", fg: "#ffffff" },
  magenta:   { name: "Magenta (sharpening)",      bg: "#a1216c", fg: "#182a48" },
  brown:     { name: "Dark brown (Birkenstock)",  bg: "#2b1a10", fg: "#ffffff" },
  lightblue: { name: "Light blue (tags)",         bg: "#5cc4d8", fg: "#182a48" },
};
/* [key, position on the mat, friendly name used for the step, one-line hint] */
export const COLUMNS = [
  ["1", "Column 1 – left", "Keys & sharpening", "House keys, fun keys, RFID tags, sharpening and garage remotes"],
  ["2", "Column 2", "Car keys", "Car key cutting, programming, shells and the mobile service"],
  ["3", "Column 3 – centre", "Shoe repairs", "Heels, soles, extra repairs and Birkenstock"],
  ["4", "Column 4", "Watches", "Service packages, batteries, bands and repairs"],
  ["5", "Column 5 – right", "Engraving & tags", "Engraving tiers, tags, plates and badges"],
  ["bottom", "Bottom band", "Deals & guarantee", "Combo deals and the guarantee strip"],
];
export const KIND_NAME = { list: "Price list", guarantee: "Guarantee", packages: "Packages", tiers: "Tiers", combos: "Combo deals" };
export const MAT_SIZE = "800 x 400 mm";
export const HEADER = {
  headline1: "FIXED", headline2: "WHILE YOU WAIT",
  tagline: "KEYS • CAR KEYS • SHOE REPAIR • WATCH SERVICE • ENGRAVING • SHARPENING",
  gst: "ALL PRICES INCLUDE GST",
};

const S = (id, title, color, column, kind, items, extra = {}) => ({
  id, title, color, column, kind, subtitle: "", badge: "", footnote: "", ...extra,
  items: items.map((it, i) => ({ id: `${id}-${i + 1}`, ...it })),
});
const I = (label, price, hl = false) => ({ label, price, hl });

export const TEMPLATE_SECTIONS = [
  // ---- Column 1
  S("house", "HOUSE & DOMESTIC KEYS", "orange", "1", "list", [
    I("Single Sided Key", "$9.95", true), I("Double Sided Key", "$9.95", true), I("Roller door / Wafer Key", "$9.95"), I("Chubb Key", "$29.95"),
  ], { footnote: "LIFETIME GUARANTEE ON ALL HOUSEHOLD KEYS" }),
  S("funkeys", "FUNKEYS & FASHION KEYS", "orange", "1", "list", [
    I("Coloured Silca Ultralite", "$12.95"), I("Mister Minit FunKey", "$14.95", true), I("Silky Key", "$12.95"), I("Disney / Marvel Key", "$14.95"), I("Taggy Key", "$14.95"),
  ]),
  S("rfid", "RFID TAGS", "orange", "1", "list", [
    I("Key Fob / Access Card Copy", "$75", true), I("Second Fob – same visit", "$35", true),
  ]),
  S("sharp", "SHARPENING", "magenta", "1", "list", [
    I("Knives – all sizes", "$1 per cm", true), I("Serrated Edge", "add $5"), I("Garden Tools · Shears · Axes", "From $20"), I("Domestic / Kitchen Scissors", "From $15"),
  ]),
  S("garage", "GARAGE REMOTES", "green", "1", "list", [
    I("Minit Supplied Remote", "From $65"), I("Genuine Remote", "From $90"),
  ]),
  // ---- Column 2
  S("carcut", "CAR KEYS – CUT ONLY", "orange", "2", "list", [
    I("Standard Car & Bike Key", "$25", true), I("Customer Supplied Key", "$30"), I("Wave Key", "$65"), I("Tibbe Key", "$65"),
    I("Straight Blade Supplied - No Transponder", "$45"), I("Key to Code - Customer Supplied Key Code", "$75"),
  ]),
  S("carprog", "CAR KEY & PROGRAMMING", "orange", "2", "list", [
    I("Spare Key – Cut & Program", "From $125", true), I("Flip Key - Onboard Programming", "From $165"), I("Flip Key - Diagnostic Programming", "From $185", true),
    I("Proximity / Smart Key", "From $325", true), I("Programming Only - Onboard", "$95"), I("Programming Only - Diagnostic", "$155"),
    I("Commodore VS–VZ Cut & Program", "$240"), I("Remote Only (KD / VVDI)", "From $70"),
  ]),
  S("shell", "SHELL REPLACEMENT", "orange", "2", "list", [
    I("Key Shell – Fixed Blade", "$80"), I("Key Shell – Flip Key", "$95"), I("Key Shell – Smart / Proximity", "$120"), I("Car Key Battery", "add $15", true),
  ]),
  S("mobile", "LOCKED OUT? MOBILE SERVICE", "red", "2", "list", [
    I("Vehicle Entry", "$75", true), I("Call Out – 0-20 km", "$45"), I("Call Out – 20-40 km", "$95"), I("Call Out – 40+ km", "$145"),
  ]),
  // ---- Column 3
  S("heels", "SHOE REPAIRS – HEELS & SOLES", "red", "3", "list", [
    I("Women's Heels – Pegged / Pin", "$30", true), I("Mens Heels", "$30", true), I("Premium Heel – Goodyear · Drover · JR", "$50"),
    I("Half Sole – Safir · Topy · Casali", "$45", true), I("Half Leather Sole", "$70"),
  ]),
  S("shoeextra", "ADDITIONAL SHOE REPAIRS", "red", "3", "list", [
    I("Stitching", "From $15"), I("Patching", "From $20"), I("Gluing", "From $15"), I("Zippers", "$2.95 / cm"),
    I("Stretching (per pair)", "$25"), I("Shoe Polishing", "From $15"), I("Extra Belt Hole", "FREE", true),
  ]),
  S("birk", "BIRKENSTOCK – AUTHORISED REPAIRS", "brown", "3", "list", [
    I("Sole Replacement – Black · Brown · White", "$79.95", true), I("Classic Footbed Recycle (incl. sole)", "$124.95", true),
    I("Buckle Replacement", "$24.95"), I("Cork Repair", "From $14.95"), I("Gluing", "From $39"),
  ], { footnote: "6 MONTH GUARANTEE ON ALL SHOE REPAIRS" }),
  // ---- Column 4
  S("watchpk", "WATCH SERVICE PACKAGES", "green", "4", "packages", [
    { num: "1", label: "Essential Service",  desc: "Battery\nGasket",                             price: "$30", save: "SAVE $8",  featured: false },
    { num: "2", label: "Protection Service", desc: "Battery\nGasket\nAir leak test or Clean",     price: "$40", save: "SAVE $27", featured: true },
    { num: "3", label: "Full Service",       desc: "Battery\nGasket\nAir leak test\nWatch clean", price: "$55", save: "SAVE $42", featured: false },
  ], { badge: "SAVE UP TO $42", footnote: "ALL G-SHOCK WATCHES ADDITIONAL $10" }),
  S("watchbat", "WATCH BATTERIES & BANDS", "green", "4", "list", [
    I("Battery Supplied & Fitted", "$26.95", true), I("Car Keys & Remote Batteries Fitted", "$29.95", true), I("G-Shock – 1 / 2 Batteries", "$34.95 / $39.95"),
    I("Band Adjustment – Standard", "$20", true), I("Band Adjustment – Stretch", "$25"), I("Band X Straps", "$19.95 - $49.95"),
  ], { footnote: "2 YEAR GUARANTEE ON ALL WATCH BATTERIES" }),
  S("watchrep", "WATCH REPAIRS", "green", "4", "list", [
    I("Pressure Test", "$25"), I("Glass Replacement (up to 2 mm)", "From $39.95"), I("Spring Bars / Split Pins", "$8"), I("Rear / G-Shock Gasket", "$10"),
    I("Ultrasonic Clean", "$15"), I("Nano Clean & Restore", "$49.95", true), I("3rd Party Repair – quote", "$22 postage"),
  ]),
  // ---- Column 5
  S("engrave", "ENGRAVING", "blue", "5", "tiers", [
    { label: "Classic", color: "#c4202e", desc: "1-10 Letters\n5 font options", price: "$24.95", allow: "ALLOW 15 MIN" },
    { label: "Bronze",  color: "#f26f21", desc: "10–20 letters · 10 font options\nWood, leather & glass start at\n50% off second side", price: "$39.95", allow: "ALLOW 25 MIN" },
    { label: "Silver",  color: "#b8b8b8", desc: "20–50 letters · 20 font options\nIn-store images\n50% off second side", price: "$54.95", allow: "ALLOW 40 MIN" },
    { label: "Gold",    color: "#c8862a", desc: "50–100 letters · any font\nIn-store images & logos\n50% off second side", price: "$69.95", allow: "ALLOW 60 MIN" },
    { label: "Emerald", color: "#1a9a3a", desc: "Unlimited letters · front & back\nFull custom designs, logos & photos\nAny font · custom fonts available", price: "$95.95", allow: "ALLOW 90 MIN" },
  ], { subtitle: "PRICE LIST • LASER & HAND ENGRAVING" }),
  S("tags", "TAGS, PLATES & BADGES", "lightblue", "5", "list", [
    I("Pet Tag – Plain / Designer", "$20 / $25", true), I("Army Dog Tag – chain & engraving", "$29.95"), I("Plates & Tags – Anodised / Brass", "$6 / $8"),
    I("Name Badge – Pin / Magnet", "From $30 / $35"), I("Custom Logo / Photo Set-Up", "$65 / $55"),
  ], { footnote: "Not in conjunction with any other offer", footnotePlain: true }),
  // ---- Bottom band
  S("combos", "VALUE COMBO DEALS", "blue", "bottom", "combos", [
    { label: "Key Pack",          desc: "3 or more get 10% off\n6 or more get 15% off\n9 or more get 20% off", was: "$90",  price: "$72",  save: "SAVE $18", note: "" },
    { label: "Shell Replacement", desc: "Any shell replaced, get the battery half price",                      was: "$125", price: "$110", save: "SAVE $15", note: "" },
    { label: "Personalisation",   desc: "Get 15% off the item when you get it engraved",                       was: "$120", price: "$102", save: "SAVE $18", note: "EXAMPLE SAVINGS" },
    { label: "Shoe Revival",      desc: "Minit heels + half soles, one pair back to new",                      was: "$75",  price: "$65",  save: "SAVE $10", note: "" },
    { label: "Keyring Combo",     desc: "Purchase any keyring & add first name for $10",                       was: "$35",  price: "$20",  save: "SAVE $15", note: "" },
    { label: "Sharpening",        desc: "Bring 5 or more & get 1 for free",                                    was: "$90",  price: "$75",  save: "SAVE $15", note: "" },
  ]),
  S("guar", "OUR GUARANTEE", "red", "bottom", "guarantee", [
    I("Household Keys", "Lifetime"), I("Transponders & Remotes", "1 Year"), I("Watch Batteries", "2 Years"), I("Band X Straps", "1 Year"),
    I("Watch Repairs", "1 Year"), I("Shoe Repair", "6 Months"), I("Engraving", "Satisfaction"), I("Soldering", "6 Months"),
  ]),
];

export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => "n" + Math.random().toString(36).slice(2, 9);
export const norm = v => (typeof v === "boolean") ? v : String(v ?? "").trim();

/** A fresh design state: one store, the template's sections. */
export const newDesignState = (sections = TEMPLATE_SECTIONS) => ({
  stores: [{ id: "store-1", line1: "", line2: "", qty: 1 }],
  sections: clone(sections),
  notes: "",
});

export const ITEM_KEYS = {
  list: ["label", "price", "hl"], guarantee: ["label", "price"],
  packages: ["num", "label", "desc", "price", "save", "featured"],
  tiers: ["label", "color", "desc", "price", "allow"],
  combos: ["label", "desc", "was", "price", "save", "note"],
};
export const SEC_KEYS = ["title", "subtitle", "badge", "footnote", "color", "column"];
export const FIELD_NAME = { label: "text", price: "price", hl: "red highlight", desc: "description", save: "save badge", featured: "featured", num: "number", color: "colour", allow: "time", was: "was price", note: "note", title: "title", subtitle: "subtitle", badge: "badge", footnote: "footnote", column: "position" };

export function blankItem(kind) {
  const id = uid();
  if (kind === "packages") return { id, num: "", label: "", desc: "", price: "", save: "", featured: false };
  if (kind === "tiers") return { id, label: "", color: "#1e5fa8", desc: "", price: "", allow: "" };
  if (kind === "combos") return { id, label: "", desc: "", was: "", price: "", save: "", note: "" };
  return { id, label: "", price: "", hl: false };
}

/* ===================== CHANGES ===================== */
/*
 * Changes are counted against what the design started from: the template for a new design, or the
 * customer's previous design for a reorder. One change per line edited, added or removed (however many
 * fields on that line changed), one per section setting changed (title, subtitle, badge, footnote),
 * one per line in an added section, one per removed section, and one per section whose lines were
 * re-ordered (or per part of the mat whose sections were re-ordered). Store names are never counted.
 */
const colName = c => (COLUMNS.find(([k]) => k === c) || [c, c])[1];
const fmtItem = (kind, it) => {
  const d = s => String(s || "").replace(/\n/g, " / ");
  if (kind === "packages") return `${it.num} ${it.label} — ${it.price} (${it.save})${it.featured ? " [featured]" : ""}: ${d(it.desc)}`;
  if (kind === "tiers") return `${it.label} — ${it.price} ${it.allow || ""}: ${d(it.desc)}`.trim();
  if (kind === "combos") return `${it.label} — was ${it.was} now ${it.price} (${it.save})${it.note ? " · " + it.note : ""}: ${d(it.desc)}`;
  return `${it.label} — ${it.price}${it.hl ? " [red]" : ""}`;
};
const showVal = v => typeof v === "boolean" ? (v ? "on" : "off") : `"${String(v ?? "").replace(/\n/g, " / ")}"`;
/* ids that are in both lists, in each list's order – equal arrays mean the shared ones weren't re-ordered */
const sameOrder = (a, b) => {
  const inB = new Set(b), inA = new Set(a);
  const x = a.filter(id => inB.has(id)), y = b.filter(id => inA.has(id));
  return x.length === y.length && x.every((id, i) => id === y[i]);
};

export function itemChanges(kind, it, base) {
  if (!base) return null;
  return ITEM_KEYS[kind].filter(k => norm(it[k]) !== norm(base[k]));
}
export function secChanges(sec, base) {
  if (!base) return null;
  return SEC_KEYS.filter(k => norm(sec[k]) !== norm(base[k]));
}

/**
 * @param sections the design's sections now
 * @param baseSections what it started from (defaults to the template)
 * @returns {{ list: {text: string, n: number}[], count: number }}
 */
export function designChanges(sections, baseSections = TEMPLATE_SECTIONS) {
  const out = [], add = (text, n = 1) => out.push({ text, n });
  const base = new Map(baseSections.map(s => [s.id, s]));
  const cur = new Map(sections.map(s => [s.id, s]));
  for (const bs of baseSections) if (!cur.has(bs.id)) add(`REMOVED SECTION: ${bs.title}`);
  for (const s of sections) {
    const bs = base.get(s.id);
    if (!bs) {
      add(`NEW SECTION: ${s.title || "(untitled)"} [${KIND_NAME[s.kind]}, ${colName(s.column)}] with ${s.items.length} line${s.items.length === 1 ? "" : "s"}`, Math.max(1, s.items.length));
      continue;
    }
    for (const k of SEC_KEYS) {
      if (norm(s[k]) === norm(bs[k])) continue;
      const v = x => k === "color" ? PALETTE[x]?.name : k === "column" ? colName(x) : showVal(x);
      add(`${bs.title} · ${FIELD_NAME[k]}: was ${v(bs[k])}, now ${v(s[k])}`);
    }
    const bItems = new Map(bs.items.map(i => [i.id, i]));
    const have = new Set(s.items.map(i => i.id));
    for (const bi of bs.items) if (!have.has(bi.id)) add(`${bs.title} · REMOVED line: ${fmtItem(s.kind, bi)}`);
    for (const it of s.items) {
      const bi = bItems.get(it.id);
      if (!bi) { add(`${s.title} · ADDED line: ${fmtItem(s.kind, it)}`); continue; }
      const ch = itemChanges(s.kind, it, bi);
      if (ch.length) add(`${s.title} · "${bi.label}": ` + ch.map(k => `${FIELD_NAME[k]} was ${showVal(bi[k])}, now ${showVal(it[k])}`).join("; "));
    }
    if (!sameOrder(s.items.map(i => i.id), bs.items.map(i => i.id))) add(`${s.title} · lines re-ordered`);
  }
  for (const [col, , theme] of COLUMNS) {
    const a = sections.filter(s => s.column === col).map(s => s.id), b = baseSections.filter(s => s.column === col).map(s => s.id);
    if (!sameOrder(a, b)) add(`${theme} · sections re-ordered`);
  }
  return { list: out, count: out.reduce((n, c) => n + c.n, 0) };
}

/** Each section and line tagged "new" / "changed" (with the fields) for the emails and the admin view. */
export function annotate(sections, baseSections = TEMPLATE_SECTIONS) {
  const base = new Map(baseSections.map(s => [s.id, s]));
  return sections.map(sec => {
    const bs = base.get(sec.id), sch = secChanges(sec, bs);
    const bItems = new Map((bs?.items || []).map(i => [i.id, i]));
    return {
      ...sec,
      status: sch === null ? "new" : (sch.length ? "changed" : ""),
      changedFields: sch || [],
      items: sec.items.map(it => {
        const ch = bs ? itemChanges(sec.kind, it, bItems.get(it.id)) : null;
        return { ...it, status: ch === null ? "new" : (ch.length ? "changed" : ""), changedFields: ch || [] };
      }),
    };
  });
}

/* ===================== PRICING ===================== */
/*
 * The first mat of a design is priced by how many changes it has: up to 10 changes is $150, then $15 more
 * for every further 10 changes, up to $250 for 71 or more. A reorder of an existing design with up to 10
 * changes is therefore $150. Every further mat of the same design (more stores, or more mats per store) is
 * $150, plus freight once per order.
 */
export const PRICE_TIERS = [
  { upTo: 10, price: 150 }, { upTo: 20, price: 165 }, { upTo: 30, price: 180 }, { upTo: 40, price: 195 },
  { upTo: 50, price: 210 }, { upTo: 60, price: 225 }, { upTo: 70, price: 240 }, { upTo: Infinity, price: 250 },
];
export const EXTRA_MAT_PRICE = 150;
export const DEFAULT_FREIGHT = 25;
export const tierFor = changes => PRICE_TIERS.find(t => changes <= t.upTo);
export const matPrice = changes => tierFor(Math.max(0, changes | 0)).price;
export const tierLabel = (t, i) => i === 0 ? `Up to ${t.upTo} changes` : t.upTo === Infinity ? `${PRICE_TIERS[i - 1].upTo + 1}+ changes` : `${PRICE_TIERS[i - 1].upTo + 1}–${t.upTo} changes`;
/** How many more changes until the price steps up (null at the top tier). */
export const changesToNextTier = changes => { const t = tierFor(changes); return t.upTo === Infinity ? null : t.upTo - changes + 1; };

export const totalMats = stores => (stores || []).reduce((n, s) => n + (Math.floor(+s.qty) || 0), 0);
export const storeLabel = s => [s.line1, s.line2].map(norm).filter(Boolean).join(" ");

const cents = n => Math.round(n * 100) / 100;
export const MAT_PRODUCT = "80x40cm Non-slip Mat - Colour Stitched - 4mm";
/**
 * The priced order. key: "first" (the design's first mat), "extra" (further mats) or "freight" – Xero item codes hang off it.
 * @param p { freight, includesGst, gstRate }
 */
export function quoteLines(stores, p = {}, { changeCount = 0, isReorder = false } = {}) {
  const freight = p.freight ?? DEFAULT_FREIGHT, includesGst = p.includesGst !== false, gstRate = p.gstRate ?? 0.1;
  const mats = totalMats(stores);
  const names = (stores || []).map(s => `${storeLabel(s)}${s.qty > 1 ? ` x${s.qty}` : ""}`).join(", ");
  const unit = matPrice(changeCount);
  const what = `${changeCount} change${changeCount === 1 ? "" : "s"}${isReorder ? " to your existing design" : " from the template"}`;
  const lines = [];
  if (mats >= 1) lines.push({ key: "first", qty: 1, unit,
    label: isReorder && changeCount === 0 ? "Reprint of your design" : "Price mat with your changes",
    note: `${tierLabel(tierFor(changeCount), PRICE_TIERS.indexOf(tierFor(changeCount)))} · ${what}`,
    description: `${MAT_PRODUCT} - ${isReorder ? "Reorder" : "New design"}, ${what}\nMister Minit price mat · Stores: ${names}` });
  if (mats >= 2) lines.push({ key: "extra", qty: mats - 1, unit: EXTRA_MAT_PRICE, label: "Additional mats, same design", note: "Each with its own store name",
    description: `${MAT_PRODUCT} - Reprint` });
  if (mats >= 1 && freight > 0) lines.push({ key: "freight", qty: 1, unit: freight, label: "Standard freight", note: "", description: "Standard Freight" });
  for (const l of lines) l.amount = cents(l.qty * l.unit);
  const sum = cents(lines.reduce((n, l) => n + l.amount, 0));
  const gst = includesGst ? cents(sum / (1 + 1 / gstRate)) : cents(sum * gstRate);
  return { lines, mats, changeCount, isReorder, includesGst, subTotal: includesGst ? cents(sum - gst) : sum, gst, total: includesGst ? sum : cents(sum + gst) };
}

export const money = n => "$" + Number(n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ===================== ORDER STATUS ===================== */
export const STATUSES = [
  { id: "requested",   label: "Requested",   desc: "Order received, invoice sent" },
  { id: "paid",        label: "Paid",        desc: "Payment received" },
  { id: "in_design",   label: "In design",   desc: "Our designer is applying your changes" },
  { id: "mockup_sent", label: "Mockup sent", desc: "Check your email and approve the mockup" },
  { id: "approved",    label: "Approved",    desc: "Mockup approved, ready to print" },
  { id: "printing",    label: "Printing",    desc: "Your mats are being made" },
  { id: "shipped",     label: "Shipped",     desc: "On the way to you" },
  { id: "delivered",   label: "Delivered",   desc: "Delivered" },
];
export const CANCELLED = { id: "cancelled", label: "Cancelled", desc: "This order was cancelled" };
export const statusInfo = id => STATUSES.find(s => s.id === id) || (id === "cancelled" ? CANCELLED : { id, label: id, desc: "" });
export const isStatus = id => id === "cancelled" || STATUSES.some(s => s.id === id);

/* ===================== VALIDATION ===================== */
export const MAX_STORES = 20, MAX_QTY = 20;
export function storeProblems(stores) {
  const out = [];
  if (!stores?.length) out.push("Add at least one store");
  if (stores?.length > MAX_STORES) out.push(`Up to ${MAX_STORES} stores per order`);
  (stores || []).forEach((s, i) => {
    if (!norm(s.line1)) out.push(`Store ${i + 1} needs a name`);
    const q = Math.floor(+s.qty);
    if (!(q >= 1 && q <= MAX_QTY)) out.push(`Store ${i + 1}: mats must be between 1 and ${MAX_QTY}`);
  });
  return out;
}

/* ===================== RENDER ===================== */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function pvSection(s) {
  const pal = PALETTE[s.color] || PALETTE.orange;
  let body = "";
  if (s.kind === "guarantee") body = `<div class="pv-guar">${s.items.map(i => `<span>${esc(i.label)} • <b>${esc(i.price)}</b></span>`).join("")}</div>`;
  else if (s.kind === "list") body = `<div class="pv-rows">${s.items.map(i => `<div class="pv-row"><span class="l">${esc(i.label)}</span><span class="pv-price ${i.hl ? "hl" : ""}">${esc(i.price)}</span></div>`).join("")}</div>`;
  else if (s.kind === "packages") body = `<div class="pv-pk">${s.items.map(i => `<div class="pk ${i.featured ? "feat" : ""}"><span class="num">${esc(i.num)}</span><div class="nm">${esc(i.label)}</div><div class="inc">${esc(i.desc)}</div><div class="pr">${esc(i.price)}${i.save ? `<span class="sv">${esc(i.save)}</span>` : ""}</div></div>`).join("")}</div>`;
  else if (s.kind === "tiers") body = s.items.map(i => `<div class="pv-tier" style="--tc:${esc(i.color || "#1e5fa8")}"><span class="tb">${esc(i.label)}</span><div class="td">${esc(i.desc)}</div><div class="tp">${esc(i.price)}<small>${esc(i.allow)}</small></div></div>`).join("") + `<div style="height:5px"></div>`;
  else if (s.kind === "combos") body = `<div class="pv-combos">${s.items.map(i => `<div class="pv-combo"><div class="ct">${esc(i.label)}</div><div class="cd">${esc(i.desc)}</div><div class="cp"><s>${esc(i.was)}</s>${esc(i.price)}${i.save ? `<span class="cs">${esc(i.save)}</span>` : ""}</div>${i.note ? `<span class="cn">${esc(i.note)}</span>` : ""}</div>`).join("")}</div>`;
  const foot = s.footnote ? `<div class="pv-note ${s.footnotePlain || s.footnote.length > 70 ? "plain" : ""}">${esc(s.footnote)}</div>` : "";
  return `<div class="pv-sec kind-${s.kind}" style="--c:${pal.bg};--fg:${pal.fg}"><div class="pv-head"><span>${esc(s.title)}${s.subtitle ? `<span class="sub">${esc(s.subtitle)}</span>` : ""}</span>${s.badge ? `<span class="badge">${esc(s.badge)}</span>` : ""}</div>${body}${foot}</div>`;
}
/** The full-width mat (wrap it in an element with class "mat-wide"); store = the store whose name goes in the corner. */
export function matHTML(sections, store = {}) {
  let html = `<div class="pv-mat"><div class="pv-header">
    <div class="logo">Mister Minit<i>'Real people fixing problems'</i></div>
    <div class="fixed"><b>${esc(HEADER.headline1)}<span>${esc(HEADER.headline2)}</span></b><small>${esc(HEADER.tagline)}</small><small class="gst">${esc(HEADER.gst)}</small></div>
    <div class="store">${esc(norm(store.line1) || "YOUR STORE")}<br>${esc(store.line2)}</div></div><div class="pv-grid">`;
  for (const [col] of COLUMNS) {
    const secs = sections.filter(s => s.column === col); if (!secs.length) continue;
    html += `<div class="pv-col ${col === "bottom" ? "pv-band" : ""}">${secs.map(pvSection).join("")}</div>`;
  }
  return html + `</div></div>`;
}
