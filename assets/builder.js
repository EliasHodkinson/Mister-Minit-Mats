/*
 * The guided mat builder: stores → each part of the mat → review & order.
 * Drafts autosave to the account (and to this browser as a backup). Lines and sections reorder by drag & drop
 * (SortableJS, touch friendly). The price updates live from the number of changes (shared/mat.js).
 */
import {
  blankItem, clone, COLUMNS, designChanges, EXTRA_MAT_PRICE, KIND_NAME, MAX_QTY, MAX_STORES, money, norm, PALETTE,
  PRICE_TIERS, quoteLines, storeLabel, storeProblems, TEMPLATE_SECTIONS, tierFor, tierLabel, changesToNextTier, matPrice, totalMats, uid, itemChanges, secChanges, matHTML,
} from "../shared/mat.js";
import { $, $$, api, confirmDialog, esc, fitRender, icon, plural, session, showPlacedOrder, toast, ago } from "./app.js";

const STEPS = [
  { id: "stores", label: "Stores", short: "Stores" },
  ...COLUMNS.map(([col, pos, theme, hint]) => ({ id: "col:" + col, col, label: theme, short: theme.split(" ")[0], pos, hint })),
  { id: "review", label: "Review & order", short: "Review" },
];
const FIELDS = {
  list:      [["label", "Item", "text", "wide"], ["price", "Price", "text", "price"], ["hl", "Red price", "toggle"]],
  guarantee: [["label", "Item", "text", "wide"], ["price", "Term", "text", "price"]],
  packages:  [["num", "No.", "text", "tiny"], ["label", "Package name", "text", "wide"], ["desc", "Includes (one per line)", "area", "wide"], ["price", "Price", "text", "price"], ["save", "Save badge", "text", "price"], ["featured", "Featured", "toggle"]],
  tiers:     [["label", "Tier", "text", "mid"], ["color", "Colour", "color"], ["desc", "Description (one per line)", "area", "wide"], ["price", "Price", "text", "price"], ["allow", "Time", "text", "price"]],
  combos:    [["label", "Deal", "text", "mid"], ["desc", "Description", "area", "wide"], ["was", "Was", "text", "tiny"], ["price", "Now", "text", "tiny"], ["save", "Save badge", "text", "price"], ["note", "Small note", "text", "price"]],
};
const ADDABLE = ["list", "packages", "tiers", "combos"];
const backupKey = id => `mm-draft-${id}`;

export async function mountBuilder(root, designId) {
  root.className = "builder-root";
  root.innerHTML = `<div class="page"><div class="loading"><div class="spinner"></div></div></div>`;
  let design;
  try { ({ design } = await api(`designs?id=${encodeURIComponent(designId)}`)); }
  catch (e) {
    root.innerHTML = `<div class="page narrow"><div class="notice bad">${icon("alert")}<p>${esc(e.message)}</p></div><p><a href="#/">Back to my mats</a></p></div>`;
    return { unmount: async () => {} };
  }
  if (design.status !== "draft") { location.hash = "#/"; return { unmount: async () => {} }; }
  return new Builder(root, design);
}

class Builder {
  constructor(root, design) {
    this.root = root; this.design = design;
    this.base = design.baseSections || TEMPLATE_SECTIONS;
    this.baseById = new Map(this.base.map(s => [s.id, s]));
    this.state = design.state;
    // a newer copy in this browser (e.g. the connection dropped before the last save) wins
    try {
      const b = JSON.parse(localStorage.getItem(backupKey(design.id)) || "null");
      if (b && b.at > new Date(design.updatedAt).getTime() + 2000 && b.state?.sections) { this.state = b.state; this.dirty = true; }
    } catch {}
    this.state.ui ||= { step: 0, done: [] };
    this.state.ui.step = Math.min(Math.max(0, this.state.ui.step | 0), STEPS.length - 1);
    this.collapsed = new Set(); this.addingKind = null; this.sortables = [];
    this.saving = false; this.savedAt = this.dirty ? null : design.updatedAt;
    this.onUnload = () => { if (this.dirty) this.save({ keepalive: true }); };
    window.addEventListener("beforeunload", this.onUnload);
    this.renderShell();
    this.renderStep();
    if (this.dirty) this.queueSave();
  }

  /* ---------- persistence ---------- */
  markDirty() {
    this.dirty = true;
    try { localStorage.setItem(backupKey(this.design.id), JSON.stringify({ at: Date.now(), state: this.state })); } catch {}
    this.paintSave();
    this.queueSave();
  }
  queueSave() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 1200); }
  async save({ keepalive = false, manual = false } = {}) {
    clearTimeout(this.saveT);
    if (this.saving) { this.again = true; return; }
    if (!this.dirty && !manual) return;
    this.saving = true; this.dirty = false; this.paintSave();
    try {
      await api(`designs?id=${this.design.id}`, { method: "PUT", body: { state: this.state }, keepalive });
      this.savedAt = new Date().toISOString(); this.failed = false;
      try { localStorage.removeItem(backupKey(this.design.id)); } catch {}
      if (manual) toast("Draft saved – find it any time under My mats");
    } catch (e) {
      this.dirty = true; this.failed = true;
      if (manual || e.status !== 401) toast(`Couldn't save: ${e.message}`);
    } finally {
      this.saving = false; this.paintSave();
      if (this.again) { this.again = false; this.save(); }
    }
  }
  paintSave() {
    const el = $("#save-state", this.root); if (!el) return;
    el.className = "save-state " + (this.saving ? "is-saving" : this.failed ? "is-failed" : this.dirty ? "is-dirty" : "is-saved");
    el.innerHTML = this.saving ? `<span class="spinner tiny"></span> Saving…` : this.failed ? `${icon("alert")} Not saved` : this.dirty ? "Unsaved changes" : `${icon("cloud")} Saved${this.savedAt ? " " + ago(this.savedAt) : ""}`;
  }
  async unmount() {
    window.removeEventListener("beforeunload", this.onUnload);
    this.ac.abort();
    clearInterval(this.tick); clearTimeout(this.undoT);
    this.sortables.forEach(s => s.destroy());
    if (this.dirty) await this.save();
  }

  /* ---------- derived ---------- */
  get step() { return STEPS[this.state.ui.step]; }
  changes() { return designChanges(this.state.sections, this.base); }
  quote(n = this.changes().count) { return quoteLines(this.state.stores, {}, { changeCount: n, isReorder: !!this.design.isReorder }); }
  secCount(sec) { const bs = this.baseById.get(sec.id); return designChanges([sec], bs ? [bs] : []).count; }
  rowClass(sec, it) {
    const bs = this.baseById.get(sec.id);
    if (!bs) return "new";
    const bi = bs.items.find(i => i.id === it.id);
    if (!bi) return "new";
    return itemChanges(sec.kind, it, bi).length ? "changed" : "";
  }

  /* ---------- shell ---------- */
  renderShell() {
    this.root.innerHTML = `
      <div class="b-top" id="b-top">
        <div class="b-top-in">
          <a class="icon-btn back" href="#/" title="Back to my mats" aria-label="Back to my mats">${icon("left")}</a>
          <div class="b-title"><b id="b-name"></b><span class="save-state" id="save-state"></span></div>
          <button class="btn small" id="save-draft">${icon("save")} <span>Save draft</span></button>
        </div>
        <nav class="b-steps" id="b-steps" aria-label="Steps"></nav>
        <div class="b-progress" aria-hidden="true"><i id="b-bar"></i></div>
      </div>
      <div class="b-body">
        <div class="b-main"><div class="step-view" id="step-view"></div><div class="b-nav" id="b-nav"></div></div>
        <aside class="b-side"><div class="b-side-in" id="b-side"></div></aside>
      </div>
      <div class="m-bar" id="m-bar"></div>`;
    // #app is shared by every view, so the listeners go when the builder unmounts
    this.ac = new AbortController();
    const signal = this.ac.signal;
    this.root.addEventListener("input", e => this.onInput(e), { signal });
    this.root.addEventListener("change", e => this.onChange(e), { signal });
    this.root.addEventListener("click", e => this.onClick(e), { signal });
    this.root.addEventListener("focusout", e => { if (e.target.matches("[data-store][data-key=line1]")) { e.target.value = e.target.value.toUpperCase(); this.setStore(e.target); } }, { signal });
    this.tick = setInterval(() => this.paintSave(), 30000);
    this.paintSave();
  }
  paintName() { $("#b-name", this.root).textContent = this.state.stores.map(storeLabel).filter(Boolean).join(", ") || (this.design.isReorder ? "Reorder" : "New mat design"); }
  paintSteps() {
    const i = this.state.ui.step, done = new Set(this.state.ui.done);
    $("#b-steps", this.root).innerHTML = `<ol>${STEPS.map((s, k) => `<li><button type="button" class="b-step ${k === i ? "current" : ""} ${done.has(s.id) && k !== i ? "done" : ""}" data-goto="${k}" ${k === i ? 'aria-current="step"' : ""}>
      <span class="n">${done.has(s.id) && k !== i ? icon("check") : k + 1}</span><span class="t">${esc(s.label)}</span></button></li>`).join("")}</ol>`;
    $("#b-bar", this.root).style.width = `${Math.round(i / (STEPS.length - 1) * 100)}%`;
    $("#b-steps .current", this.root)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }
  paintNav() {
    const i = this.state.ui.step, prev = STEPS[i - 1], next = STEPS[i + 1];
    const back = `<button type="button" class="btn" data-goto="${i - 1}" ${prev ? "" : "disabled"}>${icon("left")} Back</button>`;
    const fwd = next ? `<button type="button" class="btn navy" data-goto="${i + 1}" data-advance="1"><span class="lbl">Next: ${esc(next.label)}</span><span class="lbl-short">Next</span> ${icon("right")}</button>` : "";
    $("#b-nav", this.root).innerHTML = `${back}<span class="nav-pos">Step ${i + 1} of ${STEPS.length}</span>${fwd}`;
    const q = this.quote();
    $("#m-bar", this.root).innerHTML = `${prev ? `<button type="button" class="icon-btn" data-goto="${i - 1}" aria-label="Back">${icon("left")}</button>` : "<span></span>"}
      <button type="button" class="m-price" data-act="price-sheet"><b id="m-total">${money(q.total)}</b><span id="m-changes">${plural(q.changeCount, "change")}</span></button>
      ${next ? `<button type="button" class="btn navy" data-goto="${i + 1}" data-advance="1">Next ${icon("right")}</button>` : `<button type="button" class="btn primary" data-act="submit">Order</button>`}`;
  }
  paintSide() {
    const ch = this.changes(), q = this.quote(ch.count), n = ch.count, t = tierFor(n), ti = PRICE_TIERS.indexOf(t), toNext = changesToNextTier(n);
    $("#b-side", this.root).innerHTML = `
      <section class="meter card"><div class="body">
        <div class="meter-head"><span class="eyebrow">${this.design.isReorder ? "Reorder" : "Your price"}</span>${this.design.isReorder ? `<span class="tag">${icon("repeat")} vs. your last mat</span>` : ""}</div>
        <div class="meter-num"><b id="meter-changes">${n}</b><span>change${n === 1 ? "" : "s"}</span></div>
        <div class="tier-bar" role="img" aria-label="Price tier ${ti + 1} of ${PRICE_TIERS.length}">${PRICE_TIERS.map((x, k) => `<i class="${k < ti ? "past" : k === ti ? "cur" : ""}" title="${esc(tierLabel(x, k))}: ${money(x.price)}"></i>`).join("")}</div>
        <p class="meter-tier"><b>${money(t.price)}</b> first mat · ${esc(tierLabel(t, ti))}</p>
        <p class="meter-next">${toNext === null ? "Top price reached – more changes won't cost more." : `${plural(toNext, "more change")} until ${money(PRICE_TIERS[ti + 1].price)}.`}</p>
        <table class="mini-lines">${q.lines.map(l => `<tr><td>${esc(l.label)}${l.qty > 1 ? ` × ${l.qty}` : ""}</td><td>${money(l.amount)}</td></tr>`).join("")}
          <tr class="grand"><td>Total incl. GST</td><td>${money(q.total)}</td></tr></table>
        <details class="more tiers-more"><summary>${icon("right")} How pricing works</summary>
          <ul class="tier-list">${PRICE_TIERS.map((x, k) => `<li class="${k === ti ? "cur" : ""}"><span>${esc(tierLabel(x, k))}</span><b>${money(x.price).replace(".00", "")}</b></li>`).join("")}</ul>
          <p class="muted small-print">One change = one line edited, added or removed, or one section setting. Each extra mat of this design is ${money(EXTRA_MAT_PRICE).replace(".00", "")}. Store names don't count.</p>
        </details>
      </div></section>
      ${this.step.col ? `<section class="tip card"><div class="body">${icon("info")}<p>Drag ${icon("grip")} to reorder lines or sections. Edits show in <b class="c-changed">orange</b>, new lines in <b class="c-new">green</b>. Undo a section to drop its changes.</p></div></section>` : ""}`;
    const mt = $("#m-total", this.root); if (mt) { mt.textContent = money(q.total); $("#m-changes", this.root).textContent = plural(n, "change"); }
  }
  refreshCounts() {
    this.paintSide();
    for (const sec of this.state.sections) {
      const b = this.root.querySelector(`[data-sec-card="${sec.id}"] .sec-badge`);
      if (b) b.outerHTML = this.secBadge(sec);
    }
    this.paintName();
  }

  /* ---------- steps ---------- */
  renderStep(dir = 0) {
    const view = $("#step-view", this.root), s = this.step;
    this.sortables.forEach(x => x.destroy()); this.sortables = [];
    view.innerHTML = s.id === "stores" ? this.storesHTML() : s.id === "review" ? this.reviewHTML() : this.columnHTML(s);
    view.classList.remove("in-left", "in-right"); void view.offsetWidth;
    if (dir) view.classList.add(dir > 0 ? "in-right" : "in-left");
    this.paintSteps(); this.paintNav(); this.paintSide(); this.paintName();
    if (s.col) { this.bindSortables(); requestAnimationFrame(() => $$("textarea", view).forEach(autosize)); }
    if (s.id === "review") { requestAnimationFrame(() => fitRender($("#review-mat", this.root))); }
  }
  async goTo(i, viaNext = false) {
    if (i < 0 || i >= STEPS.length || i === this.state.ui.step) return;
    if (i > this.state.ui.step && this.step.id === "stores" && !this.validateStores()) return;
    if (viaNext && !this.state.ui.done.includes(this.step.id) && this.step.id !== "review") this.state.ui.done.push(this.step.id);
    const dir = i > this.state.ui.step ? 1 : -1;
    const view = $("#step-view", this.root);
    view.classList.remove("in-left", "in-right");
    view.classList.add(dir > 0 ? "out-left" : "out-right");
    await new Promise(r => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 170));
    view.classList.remove("out-left", "out-right");
    this.state.ui.step = i; this.markDirty();
    this.renderStep(dir);
    const top = $("#b-top", this.root).getBoundingClientRect().top + window.scrollY - 60;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  /* ---- stores ---- */
  storesHTML() {
    const st = this.state.stores, reorder = this.design.isReorder;
    return `<header class="step-head"><span class="eyebrow">Step 1</span><h1>Which stores need a mat?</h1>
        <p>Every mat uses the same design with that store's name in the top corner.</p></header>
      ${reorder ? `<div class="notice good">${icon("repeat")}<p><b>Reordering your design.</b> Changes are counted against your last mat, so with up to 10 changes it's ${money(PRICE_TIERS[0].price).replace(".00", "")}.</p></div>` : ""}
      <div class="store-list">${st.map((s, i) => this.storeCard(s, i)).join("")}</div>
      ${st.length < MAX_STORES ? `<button type="button" class="add-dashed" data-act="add-store">${icon("plus")} Add another store</button>` : ""}
      <p class="muted small-print">Mat size 800 × 400 mm, non-slip, colour stitched. Your first mat is priced by your changes; each extra mat is ${money(EXTRA_MAT_PRICE).replace(".00", "")}.</p>`;
  }
  storeCard(s, i) {
    return `<div class="store-card" data-store-card="${s.id}">
      <span class="store-no">${icon("store")}<b>${i + 1}</b></span>
      <div class="field"><label for="st-${s.id}-1">Store name</label><input type="text" id="st-${s.id}-1" data-store="${s.id}" data-key="line1" value="${esc(s.line1)}" placeholder="PENRITH" autocapitalize="characters" maxlength="60"></div>
      <div class="field"><label for="st-${s.id}-2">Second line <span class="opt">optional</span></label><input type="text" id="st-${s.id}-2" data-store="${s.id}" data-key="line2" value="${esc(s.line2)}" placeholder="WESTFIELD" autocapitalize="characters" maxlength="60"></div>
      <div class="field qty"><label>Mats</label><div class="stepper">
        <button type="button" class="icon-btn" data-act="qty" data-d="-1" data-store="${s.id}" aria-label="Fewer mats">${icon("minus")}</button>
        <input type="number" inputmode="numeric" min="1" max="${MAX_QTY}" data-store="${s.id}" data-key="qty" value="${esc(s.qty)}" aria-label="Number of mats">
        <button type="button" class="icon-btn" data-act="qty" data-d="1" data-store="${s.id}" aria-label="More mats">${icon("plus")}</button></div></div>
      ${this.state.stores.length > 1 ? `<button type="button" class="icon-btn del" data-act="del-store" data-store="${s.id}" aria-label="Remove store ${i + 1}">${icon("trash")}</button>` : ""}
    </div>`;
  }
  validateStores() {
    const probs = storeProblems(this.state.stores);
    $$(".store-card .field.invalid", this.root).forEach(f => { f.classList.remove("invalid"); f.querySelector(".err")?.remove(); });
    if (!probs.length) return true;
    for (const s of this.state.stores) {
      if (!norm(s.line1)) { const f = $(`[data-store="${s.id}"][data-key=line1]`, this.root)?.closest(".field"); f?.classList.add("invalid"); f?.insertAdjacentHTML("beforeend", `<div class="err">Enter the store name</div>`); }
      const q = Math.floor(+s.qty);
      if (!(q >= 1 && q <= MAX_QTY)) { const f = $(`[data-store="${s.id}"][data-key=qty]`, this.root)?.closest(".field"); f?.classList.add("invalid"); f?.insertAdjacentHTML("beforeend", `<div class="err">1–${MAX_QTY}</div>`); }
    }
    const first = $(".field.invalid input", this.root);
    first?.focus(); first?.closest(".store-card")?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], 260);
    toast("Add a name for each store");
    return false;
  }

  /* ---- a part of the mat ---- */
  columnHTML(s) {
    const secs = this.state.sections.filter(x => x.column === s.col);
    const removed = this.base.filter(b => b.column === s.col && !this.state.sections.some(x => x.id === b.id));
    const idx = this.state.ui.step;
    return `<header class="step-head"><span class="eyebrow">Step ${idx + 1} · ${esc(s.pos)}</span><h1>${esc(s.label)}</h1>
        <p>${esc(s.hint)}. Match every line to your store's prices and remove anything you don't offer.</p></header>
      <div class="sections" data-col="${s.col}">${secs.map(sec => this.sectionHTML(sec)).join("")}</div>
      ${!secs.length ? `<div class="empty">Nothing in this part of the mat. Add a section below, or leave it empty.</div>` : ""}
      ${removed.length ? `<div class="removed">${removed.map(b => `<div class="removed-row"><span>${icon("trash")} Removed <b>${esc(b.title)}</b></span><button type="button" class="btn ghost small" data-act="restore-sec" data-sec="${b.id}">${icon("undo")} Restore</button></div>`).join("")}</div>` : ""}
      <div class="add-sec">
        ${this.addingKind === s.col ? `<div class="kind-pick fade-up"><span>What kind of section?</span>${ADDABLE.map(k => `<button type="button" class="chip" data-act="add-sec" data-kind="${k}" data-col="${s.col}">${esc(KIND_NAME[k])}</button>`).join("")}<button type="button" class="icon-btn" data-act="cancel-add" aria-label="Cancel">${icon("x")}</button></div>`
          : `<button type="button" class="add-dashed" data-act="pick-kind" data-col="${s.col}">${icon("plus")} Add a section</button>`}
      </div>`;
  }
  undoBtn(sec) { return `<button type="button" class="icon-btn" data-act="undo-sec" data-sec="${sec.id}" title="Undo this section's changes" aria-label="Undo this section's changes">${icon("undo")}</button>`; }
  secBadge(sec) {
    const n = this.secCount(sec), isNew = !this.baseById.has(sec.id);
    return isNew ? `<span class="sec-badge new">New · ${plural(n, "change")}</span>` : n ? `<span class="sec-badge changed">${plural(n, "change")}</span>` : `<span class="sec-badge"></span>`;
  }
  sectionHTML(sec) {
    const pal = PALETTE[sec.color] || PALETTE.orange, bs = this.baseById.get(sec.id);
    const sch = secChanges(sec, bs), col = this.collapsed.has(sec.id);
    const extra = (key, label, ph) => `<div class="field ${bs && norm(sec[key]) !== norm(bs[key]) ? "is-changed" : ""}"><label>${label}</label><textarea rows="1" data-sec="${sec.id}" data-key="${key}" placeholder="${ph}">${esc(sec[key])}</textarea></div>`;
    const extras = [
      (sec.kind === "tiers" || sec.subtitle || bs?.subtitle) && extra("subtitle", "Subtitle", "e.g. PRICE LIST • LASER & HAND ENGRAVING"),
      (sec.kind === "packages" || sec.badge || bs?.badge) && extra("badge", "Header badge", "e.g. SAVE UP TO $42"),
      (sec.footnote || bs?.footnote || sec.kind !== "guarantee") && extra("footnote", "Footnote", "e.g. LIFETIME GUARANTEE ON ALL HOUSEHOLD KEYS"),
    ].filter(Boolean);
    const changed = bs && this.secCount(sec) > 0;
    return `<section class="sec ${col ? "collapsed" : ""} ${!bs ? "is-new" : ""}" data-sec-card="${sec.id}" style="--c:${pal.bg}">
      <div class="sec-head ${sch?.includes("title") ? "is-changed" : ""}">
        <span class="grip sec-grip" title="Drag to reorder" aria-label="Drag to reorder section">${icon("grip")}</span>
        <input class="sec-title" type="text" data-sec="${sec.id}" data-key="title" value="${esc(sec.title)}" placeholder="SECTION TITLE" aria-label="Section title">
        ${this.secBadge(sec)}
        <div class="sec-tools">
          ${changed ? this.undoBtn(sec) : ""}
          <button type="button" class="icon-btn del" data-act="del-sec" data-sec="${sec.id}" title="Remove section" aria-label="Remove section">${icon("trash")}</button>
          <button type="button" class="icon-btn chev" data-act="toggle" data-sec="${sec.id}" aria-expanded="${!col}" aria-label="${col ? "Expand" : "Collapse"} section">${icon("down")}</button>
        </div>
      </div>
      <div class="sec-body">
        <div class="line-head kind-${sec.kind}" aria-hidden="true"><span></span>${FIELDS[sec.kind].map(([, l]) => `<span>${esc(l)}</span>`).join("")}<span></span></div>
        <div class="lines" data-sec="${sec.id}">${sec.items.map(it => this.lineHTML(sec, it)).join("")}</div>
        <button type="button" class="add-line" data-act="add-item" data-sec="${sec.id}">${icon("plus")} Add a line</button>
        ${extras.length ? `<div class="sec-extra">${extras.join("")}</div>` : ""}
      </div>
    </section>`;
  }
  lineHTML(sec, it) {
    const cells = FIELDS[sec.kind].map(([key, label, type, size]) => {
      const a = `data-sec="${sec.id}" data-item="${it.id}" data-key="${key}"`;
      let ctl;
      if (type === "toggle") ctl = `<span class="switch"><input type="checkbox" ${a} ${it[key] ? "checked" : ""} role="switch" aria-label="${esc(label)}"><i></i></span>`;
      else if (type === "color") ctl = `<input type="color" ${a} value="${esc(it[key] || "#1e5fa8")}" aria-label="${esc(label)}">`;
      else if (type === "area") ctl = `<textarea rows="2" ${a} placeholder="${esc(label)}" aria-label="${esc(label)}">${esc(it[key])}</textarea>`;
      else ctl = `<input type="text" ${a} value="${esc(it[key])}" placeholder="${esc(label)}" aria-label="${esc(label)}">`;
      return `<label class="cell c-${size || type} t-${type} f-${key}"><span class="cl">${esc(label)}</span>${ctl}</label>`;
    }).join("");
    return `<div class="line kind-${sec.kind} ${this.rowClass(sec, it)}" data-row="${it.id}">
      <span class="grip" title="Drag to reorder" aria-label="Drag to reorder line">${icon("grip")}</span><div class="cells">${cells}</div>
      <button type="button" class="icon-btn del" data-act="del-item" data-sec="${sec.id}" data-item="${it.id}" aria-label="Remove line">${icon("x")}</button></div>`;
  }
  bindSortables() {
    if (!window.Sortable) { setTimeout(() => this.step.col && this.bindSortables(), 300); return; }
    const opts = { animation: 180, easing: "cubic-bezier(.22,1,.36,1)", ghostClass: "drag-ghost", chosenClass: "drag-chosen", dragClass: "drag-active", forceFallback: true, fallbackTolerance: 4 };
    for (const list of $$(".lines", this.root)) {
      this.sortables.push(Sortable.create(list, { ...opts, handle: ".grip", onEnd: () => {
        const sec = this.findSec(list.dataset.sec), order = [...list.children].map(el => el.dataset.row);
        sec.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        this.changed(sec);
      } }));
    }
    const wrap = $(".sections", this.root);
    if (wrap) this.sortables.push(Sortable.create(wrap, { ...opts, handle: ".sec-grip", onEnd: () => {
      const order = [...wrap.children].map(el => el.dataset.secCard), col = wrap.dataset.col;
      const slots = this.state.sections.map((s, i) => s.column === col ? i : -1).filter(i => i >= 0);
      const mine = order.map(id => this.findSec(id));
      slots.forEach((slot, k) => { this.state.sections[slot] = mine[k]; });
      this.markDirty(); this.refreshCounts();
    } }));
  }

  /* ---- review ---- */
  issues() {
    const out = [];
    if (storeProblems(this.state.stores).length) out.push({ text: "A store name or mat quantity is missing", step: 0 });
    STEPS.forEach((s, k) => { if (s.col && !this.state.ui.done.includes(s.id)) out.push({ text: `${s.label} not checked yet`, step: k, soft: true }); });
    for (const sec of this.state.sections) {
      const k = STEPS.findIndex(s => s.col === sec.column), name = sec.title || "A section";
      if (!norm(sec.title)) out.push({ text: `A section in ${STEPS[k]?.label} has no title`, step: k });
      const blank = sec.items.filter(it => !norm(it.label)).length;
      if (blank) out.push({ text: `${name}: ${plural(blank, "empty line")}`, step: k });
      const noPrice = sec.items.filter(it => norm(it.label) && "price" in it && !norm(it.price)).length;
      if (noPrice) out.push({ text: `${name}: ${plural(noPrice, "line")} without a price`, step: k, soft: true });
    }
    return out;
  }
  reviewHTML() {
    const ch = this.changes(), q = this.quote(ch.count), issues = this.issues(), hard = issues.filter(x => !x.soft), p = session.profile || {};
    const addr = a => [a?.street, [a?.suburb, a?.state, a?.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return `<header class="step-head"><span class="eyebrow">Last step</span><h1>Review & order</h1><p>Check everything, then place your order. Your invoice is emailed straight away.</p></header>
      ${issues.length ? `<section class="card"><div class="body"><h2 class="card-title">${hard.length ? `${plural(hard.length, "thing")} to fix` : "Worth a quick look"}</h2>
        <div class="checks">${issues.map(c => `<div class="check ${c.soft ? "soft" : "warn"}">${icon(c.soft ? "info" : "alert")}<span>${esc(c.text)}</span><button type="button" class="btn small" data-goto="${c.step}">Go to step</button></div>`).join("")}</div></div></section>`
        : `<div class="notice good">${icon("check")}<p><b>Everything's complete.</b> ${esc(this.state.stores.map(storeLabel).join(", "))} · ${plural(q.mats, "mat")}</p></div>`}
      <section class="card"><div class="body"><h2 class="card-title">Your mat <span class="hint">Layout only – our designer produces the final artwork</span></h2>
        <div class="mat-render-box" id="review-mat"><div class="mat-render mat-wide">${matHTML(this.state.sections, this.state.stores[0])}</div></div>
        <details class="more"><summary>${icon("right")} Compare with a finished mat</summary><img class="example-img" src="/misterminit/assets/example-mat.jpg" alt="Example of a finished Mister Minit price mat" loading="lazy"></details>
        <details class="more" ${ch.count && ch.count <= 15 ? "open" : ""}><summary>${icon("right")} ${plural(ch.count, "change")} ${this.design.isReorder ? "to your last mat" : "from the template"}</summary>
          ${ch.list.length ? `<ol class="changes">${ch.list.map(c => `<li>${esc(c.text)}${c.n > 1 ? ` <span class="muted">(${c.n} changes)</span>` : ""}</li>`).join("")}</ol>` : `<p class="muted">None – ${this.design.isReorder ? "a straight reprint of your design" : "the template as-is"} with your store names.</p>`}</details>
      </div></section>
      <section class="card"><div class="body"><h2 class="card-title"><label for="notes">Notes for the designer</label> <span class="opt">optional</span></h2>
        <textarea class="input" id="notes" data-notes rows="3" placeholder="e.g. Please make the car key section stand out">${esc(this.state.notes || "")}</textarea></div></section>
      <section class="card"><div class="body review-details">
        <div><h2 class="card-title">Invoice to</h2><p><b>${esc(p.legalName)}</b>${p.tradingName && p.tradingName !== p.legalName ? `<br>trading as ${esc(p.tradingName)}` : ""}<br>ABN ${esc(p.abn)}<br>${esc(p.firstName)} ${esc(p.lastName)} · ${esc(session.user?.email)}</p></div>
        <div><h2 class="card-title">Deliver to</h2><p>${esc(addr(p.deliverySame !== false ? p.billing : p.delivery))}</p></div>
        <a class="btn ghost small" href="#/account">${icon("edit")} Edit details</a>
      </div></section>
      <section class="card order-card"><div class="body"><h2 class="card-title">Your order</h2>
        <table class="lines">${q.lines.map(l => `<tr><td><b>${esc(l.label)}</b>${l.qty > 1 ? ` <span class="muted">× ${l.qty}</span>` : ""}${l.note ? `<small>${esc(l.note)}</small>` : ""}</td><td class="amt">${money(l.amount)}</td></tr>`).join("")}
          <tr class="sub"><td>Includes GST</td><td class="amt">${money(q.gst)}</td></tr><tr class="grand"><td>Total (AUD)</td><td class="amt">${money(q.total)}</td></tr></table>
        <ol class="next-mini"><li>Pay your invoice online</li><li>We apply your changes and email a mockup</li><li>You approve it, we print and deliver</li></ol>
        <button type="button" class="btn primary big block" data-act="submit" ${hard.length ? "disabled" : ""}>Place order · ${money(q.total)}</button>
        ${hard.length ? `<p class="muted small-print center">Fix the ${plural(hard.length, "item")} above to place your order.</p>` : `<p class="muted small-print center">Your invoice and a copy of your brief are emailed to ${esc(session.user?.email)}.</p>`}
      </div></section>`;
  }

  /* ---------- events ---------- */
  findSec(id) { return this.state.sections.find(s => s.id === id); }
  findStore(id) { return this.state.stores.find(s => s.id === id); }
  changed(sec) {
    this.markDirty();
    if (sec) {
      // show/hide the section's undo button in place – never redraw the card, or the field being typed in loses focus
      const card = this.root.querySelector(`[data-sec-card="${sec.id}"]`);
      const btn = card?.querySelector("[data-act=undo-sec]"), should = this.baseById.has(sec.id) && this.secCount(sec) > 0;
      if (card && !btn && should) card.querySelector(".sec-tools").insertAdjacentHTML("afterbegin", this.undoBtn(sec));
      if (btn && !should) btn.remove();
    }
    this.refreshCounts();
  }
  setStore(t) {
    const st = this.findStore(t.dataset.store); if (!st) return;
    st[t.dataset.key] = t.dataset.key === "qty" ? (t.value === "" ? "" : Math.max(0, Math.floor(+t.value))) : t.value;
    const f = t.closest(".field"); f?.classList.remove("invalid"); f?.querySelector(".err")?.remove();
    this.markDirty(); this.refreshCounts();
  }
  onInput(e) {
    const t = e.target;
    if (t.matches("[data-notes]")) { this.state.notes = t.value; this.markDirty(); return; }
    if (t.dataset.store) return this.setStore(t);
    if (!t.dataset.sec || !t.dataset.key) return;
    if (t.type === "checkbox") return;      // handled on change
    const sec = this.findSec(t.dataset.sec); if (!sec) return;
    if (t.dataset.item) {
      const it = sec.items.find(i => i.id === t.dataset.item); if (!it) return;
      it[t.dataset.key] = t.value;
      const row = t.closest(".line"); row.classList.remove("changed", "new"); const c = this.rowClass(sec, it); if (c) row.classList.add(c);
    } else {
      sec[t.dataset.key] = t.dataset.key === "title" ? t.value : t.value;
      const bs = this.baseById.get(sec.id);
      t.closest(".field, .sec-head")?.classList.toggle("is-changed", !!bs && norm(sec[t.dataset.key]) !== norm(bs[t.dataset.key]));
    }
    if (t.tagName === "TEXTAREA") autosize(t);
    this.changed(sec);
  }
  onChange(e) {
    const t = e.target;
    if (t.type !== "checkbox" || !t.dataset.sec) return;
    const sec = this.findSec(t.dataset.sec), it = sec?.items.find(i => i.id === t.dataset.item); if (!it) return;
    it[t.dataset.key] = t.checked;
    const row = t.closest(".line"); row.classList.remove("changed", "new"); const c = this.rowClass(sec, it); if (c) row.classList.add(c);
    this.changed(sec);
  }
  async onClick(e) {
    const g = e.target.closest("[data-goto]");
    if (g && !g.disabled) return this.goTo(+g.dataset.goto, g.hasAttribute("data-advance"));
    if (e.target.closest("#save-draft")) return this.save({ manual: true });
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, sec = b.dataset.sec ? this.findSec(b.dataset.sec) : null;
    switch (act) {
      case "add-store": {
        const st = { id: uid(), line1: "", line2: "", qty: 1 };
        this.state.stores.push(st); this.markDirty();
        $(".store-list", this.root).insertAdjacentHTML("beforeend", this.storeCard(st, this.state.stores.length - 1));
        this.rerenderStores(st.id); return;
      }
      case "del-store": {
        const st = this.findStore(b.dataset.store);
        if (!st || this.state.stores.length < 2) return;
        if (norm(st.line1) && !await confirmDialog({ title: `Remove ${storeLabel(st)}?`, ok: "Remove", danger: true })) return;
        const card = b.closest(".store-card");
        await card.animate([{ opacity: 1 }, { opacity: 0, transform: "translateX(-12px)" }], 180).finished;
        this.state.stores.splice(this.state.stores.indexOf(st), 1); this.markDirty(); this.rerenderStores(); return;
      }
      case "qty": {
        const st = this.findStore(b.dataset.store); if (!st) return;
        st.qty = Math.min(MAX_QTY, Math.max(1, (Math.floor(+st.qty) || 0) + +b.dataset.d));
        $(`input[data-store="${st.id}"][data-key=qty]`, this.root).value = st.qty;
        this.markDirty(); this.refreshCounts(); return;
      }
      case "toggle": {
        this.collapsed.has(sec.id) ? this.collapsed.delete(sec.id) : this.collapsed.add(sec.id);
        const card = b.closest(".sec"); card.classList.toggle("collapsed"); b.setAttribute("aria-expanded", String(!card.classList.contains("collapsed"))); return;
      }
      case "add-item": {
        const it = blankItem(sec.kind); sec.items.push(it); this.collapsed.delete(sec.id);
        const list = $(`.lines[data-sec="${sec.id}"]`, this.root);
        list.insertAdjacentHTML("beforeend", this.lineHTML(sec, it));
        const row = list.lastElementChild; row.classList.add("appear");
        row.querySelector("input[type=text],textarea")?.focus();
        this.changed(sec); return;
      }
      case "del-item": {
        const i = sec.items.findIndex(x => x.id === b.dataset.item); if (i < 0) return;
        const [gone] = sec.items.splice(i, 1);
        const row = b.closest(".line");
        await row.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(16px)" }], 160).finished;
        row.remove(); this.changed(sec);
        this.undoToast(`Removed "${gone.label || "line"}"`, () => { sec.items.splice(i, 0, gone); this.changed(sec); this.renderStep(); });
        return;
      }
      case "del-sec": {
        if (!await confirmDialog({ title: `Remove ${sec.title || "this section"}?`, text: "The whole section comes off your mat. You can restore it from the bottom of this step.", ok: "Remove section", danger: true })) return;
        const card = b.closest(".sec");
        await card.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.98)" }], 180).finished;
        this.state.sections.splice(this.state.sections.indexOf(sec), 1); this.markDirty(); this.renderStep(); return;
      }
      case "undo-sec": {
        const bs = this.baseById.get(sec.id); if (!bs) return;
        if (!await confirmDialog({ title: `Undo changes to ${bs.title}?`, text: `It goes back to how it was ${this.design.isReorder ? "on your last mat" : "on the template"}.`, ok: "Undo changes" })) return;
        this.state.sections[this.state.sections.indexOf(sec)] = { ...clone(bs), column: sec.column };
        this.markDirty(); this.renderStep(); toast("Section restored"); return;
      }
      case "restore-sec": {
        const bs = this.baseById.get(b.dataset.sec); if (!bs) return;
        const order = this.base.map(s => s.id), pos = order.indexOf(bs.id);
        let at = this.state.sections.findIndex(s => order.indexOf(s.id) > pos);
        if (at < 0) at = this.state.sections.length;
        this.state.sections.splice(at, 0, clone(bs)); this.markDirty(); this.renderStep(); toast(`${bs.title} restored`); return;
      }
      case "pick-kind": this.addingKind = b.dataset.col; return this.renderStep();
      case "cancel-add": this.addingKind = null; return this.renderStep();
      case "add-sec": {
        const col = b.dataset.col, kind = b.dataset.kind;
        const color = this.state.sections.find(s => s.column === col)?.color || (kind === "combos" ? "blue" : "orange");
        const s = { id: uid(), title: "", color, column: col, kind, subtitle: "", badge: "", footnote: "", items: [blankItem(kind)] };
        const last = this.state.sections.map(x => x.column).lastIndexOf(col);
        this.state.sections.splice(last < 0 ? this.state.sections.length : last + 1, 0, s);
        this.addingKind = null; this.markDirty(); this.renderStep();
        const card = this.root.querySelector(`[data-sec-card="${s.id}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" }); card?.classList.add("appear"); card?.querySelector(".sec-title")?.focus({ preventScroll: true });
        return;
      }
      case "price-sheet": $(".b-side", this.root).classList.toggle("sheet-open"); return;
      case "submit": return this.submit();
    }
  }
  rerenderStores(focusId) {
    $(".store-list", this.root).innerHTML = this.state.stores.map((s, i) => this.storeCard(s, i)).join("");
    this.refreshCounts();
    if (focusId) { const el = $(`[data-store="${focusId}"][data-key=line1]`, this.root); el?.closest(".store-card")?.classList.add("appear"); el?.focus(); }
    const add = $("[data-act=add-store]", this.root); if (add) add.hidden = this.state.stores.length >= MAX_STORES;
  }
  undoToast(msg, undo) {
    const t = $("#toast");
    t.innerHTML = `${esc(msg)} <button type="button" class="toast-undo">Undo</button>`;
    t.classList.add("show", "has-action");
    const btn = t.querySelector("button");
    const close = () => { t.classList.remove("show", "has-action"); };
    btn.onclick = () => { close(); undo(); };
    clearTimeout(this.undoT); this.undoT = setTimeout(close, 5000);
  }

  /* ---------- order ---------- */
  async submit() {
    if (this.submitting) return;
    const hard = this.issues().filter(x => !x.soft);
    if (hard.length) { toast("Fix the highlighted items first"); return this.goTo(STEPS.length - 1); }
    const q = this.quote();
    if (!await confirmDialog({ title: `Place order for ${money(q.total)}?`, text: `${plural(q.mats, "mat")} for ${this.state.stores.map(storeLabel).join(", ")}. We'll email your invoice to ${session.user?.email}.`, ok: "Place order" })) return;
    this.submitting = true;
    const overlay = document.createElement("div");
    overlay.className = "submit-overlay";
    const stages = ["Preparing your mat layout", "Saving your order", "Creating your invoice", `Emailing ${session.user?.email}`];
    overlay.innerHTML = `<div class="submit-box"><h2>Placing your order</h2><p class="muted">This usually takes under a minute. Keep this page open.</p>
      <ol class="stages">${stages.map((s, i) => `<li class="stage" data-stage="${i}"><span class="stage-dot">${icon("check")}</span><span>${esc(s)}</span></li>`).join("")}</ol><div id="submit-err"></div></div>`;
    document.body.appendChild(overlay);
    const set = n => $$(".stage", overlay).forEach(li => { const i = +li.dataset.stage; li.className = "stage " + (i < n ? "done" : i === n ? "active" : ""); });
    set(0);
    const timers = [];
    try {
      const image = await renderMatImage(this.state);
      set(1);
      timers.push(setTimeout(() => set(2), 1200), setTimeout(() => set(3), 6000));
      const { order } = await api("submit", { method: "POST", body: { designId: this.design.id, state: this.state, image } });
      timers.forEach(clearTimeout); set(4);
      this.dirty = false;
      try { localStorage.removeItem(backupKey(this.design.id)); } catch {}
      await new Promise(r => setTimeout(r, 700));
      overlay.remove();
      showPlacedOrder(order);
    } catch (e) {
      timers.forEach(clearTimeout);
      $(".stage.active", overlay)?.classList.replace("active", "error");
      $("#submit-err", overlay).innerHTML = `<div class="notice bad">${icon("alert")}<p><b>Not sent.</b> ${esc(e.message)}</p></div>
        <div class="err-actions"><button class="btn" id="err-close">Back to review</button></div>`;
      $("#err-close", overlay).onclick = () => overlay.remove();
      this.submitting = false;
    }
  }
}

function autosize(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 320) + "px"; }

function loadScript(src) {
  return new Promise((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const el = document.createElement("script"); el.src = src; el.onload = ok; el.onerror = () => fail(new Error("Couldn't load the image library")); document.head.appendChild(el);
  });
}
/* The full-width mat as an image for the designer (1500px layout at 2x). Graph's sendMail must stay under ~4 MB. */
async function renderMatImage(state) {
  try {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    const host = document.createElement("div");
    host.className = "mat-wide mat-render-src"; host.innerHTML = matHTML(state.sections, state.stores[0]);
    document.body.appendChild(host);
    try {
      const canvas = await html2canvas(host, { scale: 2, backgroundColor: "#182a48", useCORS: true, logging: false, windowWidth: 1600,
        onclone: doc => { const h = doc.querySelector(".mat-render-src"); if (h) h.style.left = "0"; } });
      let url = canvas.toDataURL("image/png");
      if (url.length > 2_400_000) url = canvas.toDataURL("image/jpeg", 0.92);
      if (url.length > 3_100_000) url = canvas.toDataURL("image/jpeg", 0.8);
      return { dataUrl: url, width: canvas.width, height: canvas.height };
    } finally { host.remove(); }
  } catch (e) { console.warn("render failed", e); return null; }      // the order still goes through without the picture
}
