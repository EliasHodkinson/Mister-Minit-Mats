/*
 * Mister Minit Mat Builder – the customer app (no build step; ES modules).
 *   #/              your mats: start a design, continue drafts, reorder, track orders
 *   #/build/:id     the builder (assets/builder.js)
 *   #/orders/:id    one order: status, invoice, what was ordered
 *   #/account       business details
 * Signed-out visitors see the landing page; a first sign-in goes through onboarding (business details → Xero contact).
 */
import { matHTML, money, PRICE_TIERS, tierLabel, STATUSES, statusInfo, EXTRA_MAT_PRICE } from "../shared/mat.js";
import { mountBuilder } from "./builder.js";

/* ===================== helpers ===================== */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const icon = name => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const fmtWhen = iso => iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "";
export const fmtDate = iso => iso ? new Date(String(iso).length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 6) return `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? "" : "s"} ago`;
  return fmtDate(iso);
}
export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

let toastT;
export function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
}
export function confirmDialog({ title, text = "", ok = "OK", danger = false }) {
  const d = $("#confirm");
  $("#confirm-title").textContent = title; $("#confirm-text").textContent = text;
  const b = $("#confirm-ok"); b.textContent = ok; b.className = `btn ${danger ? "primary" : "navy"}`;
  return new Promise(res => {
    d.addEventListener("close", () => res(d.returnValue === "ok"), { once: true });
    d.returnValue = ""; d.showModal();
  });
}

export const session = { user: null, profile: null, onboarded: false, isAdmin: false };
export async function api(path, { method = "GET", body, keepalive = false } = {}) {
  const r = await fetch(`/misterminit/api/${path}`, {
    method, credentials: "same-origin", keepalive,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "me") { session.user = null; toast("Your session ended – please sign in again"); setTimeout(() => render(), 600); }
  if (!r.ok || d.ok === false) throw Object.assign(new Error(d.error || `The server replied ${r.status}`), { status: r.status, data: d });
  return d;
}
export const signInUrl = (signup = false) => `/misterminit/api/auth/${signup ? "signup" : "login"}?returnTo=${encodeURIComponent("/misterminit/" + (location.hash || ""))}`;

/* The 1500px-wide mat render, scaled to the width of its box */
export function fitRender(box) {
  const r = box?.querySelector(".mat-render"); if (!r) return;
  r.style.transform = "none"; box.style.height = "auto";
  const sc = Math.min(1, box.clientWidth / r.offsetWidth), H = r.offsetHeight;
  r.style.transform = `scale(${sc})`; box.style.height = Math.ceil(H * sc) + "px";
}
window.addEventListener("resize", () => $$(".mat-render-box").forEach(fitRender));
export const matBox = (sections, store, id = "") => `<div class="mat-render-box" ${id ? `id="${id}"` : ""}><div class="mat-render mat-wide">${matHTML(sections, store)}</div></div>`;

/* ===================== profile form (onboarding + account) ===================== */
const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
const get = (o, path) => path.split(".").reduce((v, k) => v?.[k], o);
function f(path, label, { type = "text", optional = false, hint = "", attrs = "", cls = "" } = {}) {
  return `<div class="field ${cls}"><label for="p-${path}">${label}${optional ? ' <span class="opt">optional</span>' : ""}</label>
    <input type="${type}" id="p-${path}" name="${path}" ${attrs}>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
}
const stateSel = p => `<div class="field"><label for="p-${p}.state">State</label><select id="p-${p}.state" name="${p}.state"><option value="">Select</option>${AU_STATES.map(s => `<option>${s}</option>`).join("")}</select></div>`;
const addr = p => `<div class="grid-addr">
    ${f(`${p}.street`, "Street address", { cls: "span-all", attrs: 'autocomplete="street-address"' })}
    ${f(`${p}.suburb`, "Suburb", { attrs: 'autocomplete="address-level2"' })}
    ${stateSel(p)}
    ${f(`${p}.postcode`, "Postcode", { attrs: 'inputmode="numeric" maxlength="4" autocomplete="postal-code"' })}
  </div>`;
function profileFormHTML() {
  return `
  <section class="card form-block"><div class="body">
    <h2 class="card-title"><span class="num-badge">1</span> Your business</h2>
    <div class="grid2">
      ${f("legalName", "Legal entity name", { hint: "As registered with your ABN", attrs: 'autocomplete="organization"' })}
      ${f("tradingName", "Trading name", { hint: "e.g. Mister Minit Penrith" })}
      ${f("abn", "ABN", { attrs: 'inputmode="numeric" placeholder="12 345 678 901"' })}
    </div>
  </div></section>
  <section class="card form-block"><div class="body">
    <h2 class="card-title"><span class="num-badge">2</span> Contact</h2>
    <div class="grid2">
      ${f("firstName", "First name", { attrs: 'autocomplete="given-name"' })}
      ${f("lastName", "Last name", { attrs: 'autocomplete="family-name"' })}
      ${f("phone", "Phone", { type: "tel", attrs: 'autocomplete="tel"' })}
      <div class="field"><label>Email</label><div class="static-val">${esc(session.user?.email)}</div><div class="hint">Invoices and mockups are sent here</div></div>
    </div>
  </div></section>
  <section class="card form-block"><div class="body">
    <h2 class="card-title"><span class="num-badge">3</span> Billing address</h2>
    ${addr("billing")}
    <label class="check-line"><input type="checkbox" name="deliverySame"> Deliver mats to this address</label>
    <div id="delivery-block"></div>
  </div></section>`;
}
function fillProfile(form, p) {
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = get(p, el.name);
    if (el.type === "checkbox") el.checked = v !== false; else el.value = v ?? "";
  }
  syncDelivery(form, p);
}
function syncDelivery(form, p = {}) {
  const same = form.elements.deliverySame.checked, box = $("#delivery-block", form);
  if (same) { box.innerHTML = ""; return; }
  if (box.innerHTML) return;
  box.innerHTML = `<div class="fade-up"><h3 class="sub-title">Delivery address</h3>${addr("delivery")}</div>`;
  for (const el of box.querySelectorAll("[name]")) el.value = get(p, el.name) ?? "";
}
function readProfileForm(form) {
  const p = { billing: {}, delivery: {} };
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = el.type === "checkbox" ? el.checked : el.value;
    const [a, b] = el.name.split(".");
    if (b) p[a][b] = v; else p[a] = v;
  }
  return p;
}
const abnDigits = s => String(s ?? "").normalize("NFKC").replace(/\D/g, "");
function bindProfileForm(form, { onSaved, submitLabel }) {
  form.addEventListener("change", e => { if (e.target.name === "deliverySame") syncDelivery(form); });
  form.addEventListener("input", e => { const fl = e.target.closest(".field"); fl?.classList.remove("invalid"); fl?.querySelector(".err")?.remove(); });
  form.addEventListener("focusout", e => {
    if (e.target.name !== "abn") return;
    const d = abnDigits(e.target.value);
    if (d.length === 11) e.target.value = d.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4");
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.innerHTML = `<span class="spinner small"></span> Saving…`;
    $$(".field.invalid", form).forEach(x => { x.classList.remove("invalid"); x.querySelector(".err")?.remove(); });
    try {
      const d = await api("me", { method: "PUT", body: readProfileForm(form) });
      Object.assign(session, { profile: d.profile, onboarded: d.onboarded, isAdmin: d.isAdmin });
      onSaved(d);
    } catch (err) {
      const probs = err.data?.problems || [];
      for (const pr of probs) {
        const el = form.elements[pr.field]; const fl = el?.closest(".field");
        if (fl && !fl.classList.contains("invalid")) { fl.classList.add("invalid"); fl.insertAdjacentHTML("beforeend", `<div class="err">${esc(pr.msg)}</div>`); }
      }
      const first = $(".field.invalid", form);
      if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); first.querySelector("input,select")?.focus({ preventScroll: true }); }
      toast(probs.length ? "A few details need another look" : err.message);
    } finally { btn.disabled = false; btn.innerHTML = submitLabel; }
  });
}

/* ===================== views ===================== */
const app = () => $("#app");
let current = null;    // the mounted builder, if any (so we can save before leaving)

function setView(html, cls = "") {
  const el = app();
  el.className = cls;
  el.innerHTML = html;
  el.classList.add("view-enter");
  setTimeout(() => el.classList.remove("view-enter"), 500);
}
function renderHeader() {
  const nav = $("#nav"), act = $("#head-actions"), r = route();
  if (session.testMode && !$("#test-banner")) $("#site-head").insertAdjacentHTML("afterend",
    `<div class="test-banner" id="test-banner">${icon("info")} <b>Test site</b> – orders are saved, but nothing goes to Xero and no emails are sent.</div>`);
  if (!session.user) { nav.innerHTML = ""; act.innerHTML = `<a class="btn small primary" href="${signInUrl()}">Sign in</a>`; return; }
  const on = name => r.name === name ? "on" : "";
  nav.innerHTML = session.onboarded ? `<a href="#/" class="${on("home")}">My mats</a><a href="#/account" class="${on("account")}">Account</a>${session.isAdmin ? `<a href="/misterminit/admin">Admin</a>` : ""}` : "";
  const p = session.profile || {};
  const initials = ((p.firstName || session.user.email || "?")[0] + ((p.lastName || "")[0] || "")).toUpperCase();
  act.innerHTML = `<a class="avatar" href="#/account" title="Account" aria-label="Account">${esc(initials)}</a>`;
}

function landingHTML() {
  const err = new URLSearchParams(location.search).get("signin_error");
  return `<section class="hero">
    <div class="hero-in">
      <div class="hero-copy stagger">
        <span class="eyebrow">For Mister Minit stores</span>
        <h1>Your price mat, built in minutes.</h1>
        <p>Walk through your mat one section at a time, match every price to your store, and order it in one go. We design it, send you a mockup, then print and deliver.</p>
        ${err ? `<div class="notice bad">${icon("alert")}<p>${esc(err)}</p></div>` : ""}
        <div class="hero-cta">
          <a class="btn primary big" href="${signInUrl(true)}">Create an account ${icon("right")}</a>
          <a class="btn big hero-ghost" href="${signInUrl()}">Sign in</a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true"><img src="/misterminit/assets/example-mat.jpg" alt="" loading="eager"></div>
    </div>
  </section>
  <section class="page">
    <div class="features stagger">
      <div class="feature"><span class="f-ico">${icon("sparkle")}</span><b>Guided, step by step</b><p>Each part of the mat on its own screen. Drag lines into order, edit prices, done.</p></div>
      <div class="feature"><span class="f-ico">${icon("save")}</span><b>Save and come back</b><p>Drafts save as you go, on any device. Pick up where you left off.</p></div>
      <div class="feature"><span class="f-ico">${icon("truck")}</span><b>Track every order</b><p>See your invoice, mockup and delivery status in your account.</p></div>
      <div class="feature"><span class="f-ico">${icon("repeat")}</span><b>Easy reorders</b><p>Reorder a mat you've had before for ${money(PRICE_TIERS[0].price).replace(".00", "")}, with up to 10 changes.</p></div>
    </div>
    ${pricingCard()}
  </section>`;
}
function pricingCard() {
  return `<section class="card pricing-card fade-up"><div class="body">
    <h2 class="card-title">Simple pricing <span class="hint">Your first mat is priced by how much you change. Prices include GST.</span></h2>
    <div class="tiers">${PRICE_TIERS.map((t, i) => `<div class="tier"><b>${money(t.price).replace(".00", "")}</b><span>${tierLabel(t, i)}</span></div>`).join("")}</div>
    <p class="muted small-print">Every extra mat of the same design (another store, or more than one per store) is ${money(EXTRA_MAT_PRICE).replace(".00", "")}. Reorders of your design with up to 10 changes are ${money(PRICE_TIERS[0].price).replace(".00", "")}. Freight is added once per order.</p>
  </div></section>`;
}

function onboardingView() {
  setView(`<div class="page narrow">
    <header class="page-head"><div><span class="eyebrow">Welcome</span><h1>Let's set up your business</h1>
      <p>We'll use these details for every invoice and delivery, so you only enter them once. You can change them later in your account.</p></div></header>
    <form id="profile-form" novalidate class="stagger">${profileFormHTML()}
      <div class="form-actions"><button class="btn primary big" type="submit">Save and continue ${icon("right")}</button></div>
    </form></div>`);
  const form = $("#profile-form");
  fillProfile(form, { ...session.profile, firstName: session.profile?.firstName || session.user.firstName || "", lastName: session.profile?.lastName || session.user.lastName || "" });
  bindProfileForm(form, { submitLabel: `Save and continue ${icon("right")}`, onSaved: () => { toast("You're all set up"); location.hash = "#/"; render(); } });
}

function accountView() {
  setView(`<div class="page narrow">
    <header class="page-head"><div><span class="eyebrow">Account</span><h1>Business details</h1><p>Used for your invoices and deliveries.</p></div>
      <a class="btn" href="/misterminit/api/auth/logout">${icon("logout")} Sign out</a></header>
    <form id="profile-form" novalidate class="stagger">${profileFormHTML()}
      <div class="form-actions"><button class="btn navy big" type="submit">Save changes</button></div>
    </form></div>`);
  const form = $("#profile-form");
  fillProfile(form, session.profile);
  bindProfileForm(form, { submitLabel: "Save changes", onSaved: () => toast("Saved") });
}

async function homeView() {
  const first = session.profile?.firstName || session.user.firstName || "";
  setView(`<div class="page">
    <header class="page-head"><div><span class="eyebrow">${esc(session.profile?.tradingName || "My mats")}</span><h1>${first ? `Hi ${esc(first)}` : "Your mats"}</h1>
      <p>Start a new mat, pick up a draft, or reorder one you've had before.</p></div></header>
    <div class="home-grid">
      <div class="home-main" id="home-main">
        <button class="start-card fade-up" id="start-new"><span class="s-ico">${icon("plus")}</span><span><b>Design a new mat</b><span>Start from the Mister Minit template and match it to your store</span></span>${icon("right")}</button>
        <div class="skeleton" style="height:120px;margin-top:22px"></div><div class="skeleton" style="height:120px;margin-top:12px"></div>
      </div>
      <aside class="home-side">${pricingCard()}</aside>
    </div></div>`);
  $("#start-new").addEventListener("click", startNew);
  let designs, orders;
  try { [{ designs }, { orders }] = await Promise.all([api("designs"), api("orders")]); }
  catch (e) { $("#home-main").insertAdjacentHTML("beforeend", `<div class="notice bad">${icon("alert")}<p>${esc(e.message)}</p></div>`); return; }
  $$("#home-main .skeleton").forEach(s => s.remove());
  const drafts = designs.filter(d => d.status === "draft"), ordered = designs.filter(d => d.status === "ordered");
  const orderByDesign = new Map(orders.map(o => [o.designId, o]));
  const html = [];
  if (drafts.length) html.push(`<section class="block fade-up"><h2 class="block-title">Drafts <span>${drafts.length}</span></h2><div class="tiles">${drafts.map(d => `
    <article class="tile">
      <div class="tile-top"><span class="pill draft">Draft</span>${d.isReorder ? `<span class="tag">${icon("repeat")} Reorder</span>` : ""}<span class="muted when">Saved ${esc(ago(d.updatedAt))}</span></div>
      <h3>${esc(d.storeNames || "Untitled mat")}</h3>
      <div class="tile-meta"><span>${plural(d.changes, "change")}</span><span>${money(d.matPrice)} first mat</span><span>Step ${Math.min(d.step + 1, 8)} of 8</span></div>
      <div class="bar"><i style="width:${Math.round(Math.min(d.step, 7) / 7 * 100)}%"></i></div>
      <div class="tile-actions"><a class="btn navy small" href="#/build/${d.id}">Continue ${icon("right")}</a><button class="btn ghost small danger" data-del="${d.id}">${icon("trash")} Delete</button></div>
    </article>`).join("")}</div></section>`);
  if (orders.length) html.push(`<section class="block fade-up"><h2 class="block-title">Orders <span>${orders.length}</span></h2><div class="order-list">${orders.map(o => `
    <a class="order-row" href="#/orders/${o.id}">
      <div class="or-main"><b>${esc(o.number)}</b><span class="muted">${esc(fmtDate(o.createdAt))} · ${esc(o.storeNames)} · ${plural(o.mats, "mat")}</span></div>
      <div class="or-progress" aria-hidden="true">${progressDots(o.status)}</div>
      <span class="pill s-${esc(o.status)}">${esc(o.statusLabel)}</span>
      <b class="or-total">${money(o.total)}</b>${icon("right")}
    </a>`).join("")}</div></section>`);
  if (ordered.length) html.push(`<section class="block fade-up"><h2 class="block-title">Your designs <span>${ordered.length}</span></h2>
    <p class="block-hint">Reorder any design for ${money(PRICE_TIERS[0].price).replace(".00", "")} a mat, with up to 10 changes.</p><div class="tiles">${ordered.map(d => {
      const o = orderByDesign.get(d.id);
      return `<article class="tile">
        <div class="tile-top"><span class="tag">${icon("check")} Ordered</span><span class="muted when">${esc(fmtDate(d.updatedAt))}</span></div>
        <h3>${esc(d.storeNames || d.name)}</h3>
        <div class="tile-meta"><span>${plural(d.mats, "mat")}</span>${o ? `<span>${esc(o.number)}</span>` : ""}</div>
        <div class="tile-actions"><button class="btn primary small" data-reorder="${d.id}">${icon("repeat")} Reorder</button>${o ? `<a class="btn ghost small" href="#/orders/${o.id}">View order</a>` : ""}</div>
      </article>`;
    }).join("")}</div></section>`);
  if (!html.length) html.push(`<div class="empty fade-up" style="margin-top:22px"><b>No mats yet.</b><br>Start your first design above. It saves as you go.</div>`);
  $("#home-main").insertAdjacentHTML("beforeend", html.join(""));
  $("#home-main").addEventListener("click", async e => {
    const del = e.target.closest("[data-del]"), re = e.target.closest("[data-reorder]");
    if (del) {
      if (!await confirmDialog({ title: "Delete this draft?", text: "This can't be undone.", ok: "Delete draft", danger: true })) return;
      try { await api(`designs?id=${del.dataset.del}`, { method: "DELETE" }); del.closest(".tile").animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.97)" }], 200).onfinish = () => homeView(); toast("Draft deleted"); }
      catch (err) { toast(err.message); }
    }
    if (re) startReorder(re.dataset.reorder, re);
  });
}
function progressDots(status) {
  const i = STATUSES.findIndex(s => s.id === status);
  return STATUSES.map((s, k) => `<i class="${status === "cancelled" ? "" : k <= i ? "on" : ""}" title="${esc(s.label)}"></i>`).join("");
}
async function startNew() {
  const b = $("#start-new"); if (b) { b.disabled = true; b.classList.add("busy"); }
  try { const { design } = await api("designs", { method: "POST", body: { from: "template" } }); location.hash = `#/build/${design.id}`; }
  catch (e) { toast(e.message); if (b) { b.disabled = false; b.classList.remove("busy"); } }
}
export async function startReorder(designId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner small"></span> Starting…`; }
  try { const { design } = await api("designs", { method: "POST", body: { reorder: designId } }); location.hash = `#/build/${design.id}`; toast("Reorder started – change anything you need"); }
  catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.innerHTML = `${icon("repeat")} Reorder`; } }
}

async function orderView(id, { justPlaced = null } = {}) {
  setView(`<div class="page"><div class="loading"><div class="spinner"></div></div></div>`);
  let o;
  try { ({ order: o } = await api(`orders?id=${encodeURIComponent(id)}`)); }
  catch (e) { setView(`<div class="page narrow"><div class="notice bad">${icon("alert")}<p>${esc(e.message)}</p></div><p><a href="#/">Back to my mats</a></p></div>`); return; }
  const cancelled = o.status === "cancelled", idx = STATUSES.findIndex(s => s.id === o.status);
  const when = st => o.history.filter(h => h.status === st).pop()?.at;
  const inv = o.invoice, placed = justPlaced;
  const pdf = placed?.invoice?.pdf;
  setView(`<div class="page">
    ${placed ? `<section class="placed fade-up"><div class="done-mark" aria-hidden="true">${icon("check")}</div>
      <div><h1>Order placed</h1><p>${session.testMode ? `Test order – <b>${esc(inv?.number || o.number)}</b> was saved. No invoice was raised in Xero and no emails were sent.` : inv ? `${inv.kind === "invoice" ? "Invoice" : "Quote"} <b>${esc(inv.number)}</b> is on its way to <b>${esc(session.user.email)}</b>.` : `We've got your order. Your invoice will be emailed to <b>${esc(session.user.email)}</b> shortly.`}</p></div></section>` : ""}
    <header class="page-head"><div><a class="back-link" href="#/">${icon("left")} My mats</a><h1>Order ${esc(o.number)}</h1>
      <p>${esc(fmtWhen(o.createdAt))} · ${esc(o.storeNames)} · ${plural(o.mats, "mat")}</p></div>
      <span class="pill big s-${esc(o.status)}">${esc(o.statusLabel)}</span></header>
    <div class="order-grid">
      <div class="order-main">
        ${inv && o.status === "requested" ? `<section class="card pay-card fade-up"><div class="body">
          <div><span class="muted">${inv.kind === "invoice" ? "Invoice" : "Quote"} ${esc(inv.number)}${inv.due ? ` · ${inv.kind === "invoice" ? "due" : "valid until"} ${esc(fmtDate(inv.due))}` : ""}</span><div class="big-total">${money(o.total)}</div><span class="muted">AUD incl. GST</span></div>
          <div class="pay-actions">${inv.payUrl ? `<a class="btn primary big" href="${esc(inv.payUrl)}" target="_blank" rel="noopener">Pay ${inv.kind} ${icon("right")}</a>` : ""}${pdf ? `<button class="btn big" id="dl-pdf">${icon("file")} Download PDF</button>` : ""}</div>
        </div></section>` : ""}
        <section class="card fade-up"><div class="body"><h2 class="card-title">What you ordered</h2>
          <table class="lines">${o.quote.lines.map(l => `<tr><td><b>${esc(l.label || l.description.split("\n")[0])}</b>${l.qty > 1 ? ` <span class="muted">× ${l.qty}</span>` : ""}${l.note ? `<small>${esc(l.note)}</small>` : ""}</td><td class="amt">${money(l.amount)}</td></tr>`).join("")}
            <tr class="sub"><td>${o.quote.includesGst ? "Includes GST" : "GST"}</td><td class="amt">${money(o.quote.gst)}</td></tr>
            <tr class="grand"><td>Total</td><td class="amt">${money(o.total)}</td></tr></table>
          <div class="stores-chips">${o.stores.map(s => `<span class="chip-static">${icon("store")} ${esc([s.line1, s.line2].filter(Boolean).join(" "))} × ${s.qty}</span>`).join("")}</div>
        </div></section>
        <section class="card fade-up"><div class="body"><h2 class="card-title">Your layout <span class="hint">Layout only – we produce the final artwork</span></h2>
          ${matBox(o.sections, o.stores[0], "order-mat")}
          <details class="more"><summary>${icon("right")} ${plural(o.changeCount, "change")} ${o.isReorder ? "to your previous design" : "from the template"}</summary>
            ${o.changes.length ? `<ol class="changes">${o.changes.map(c => `<li>${esc(c)}</li>`).join("")}</ol>` : `<p class="muted">No changes.</p>`}</details>
          ${o.notes ? `<p class="notes"><b>Your notes:</b> ${esc(o.notes)}</p>` : ""}
          ${o.designId ? `<div class="reorder-row"><button class="btn" id="reorder-btn">${icon("repeat")} Reorder this design</button><span class="muted">${money(PRICE_TIERS[0].price).replace(".00", "")} a mat with up to 10 changes</span></div>` : ""}
        </div></section>
      </div>
      <aside class="order-side">
        <section class="card fade-up"><div class="body"><h2 class="card-title">Progress</h2>
          ${cancelled ? `<div class="notice">${icon("info")}<p>This order was cancelled${when("cancelled") ? ` on ${esc(fmtDate(when("cancelled")))}` : ""}.</p></div>` : `
          <ol class="track">${STATUSES.map((s, k) => `<li class="${k < idx || (k === idx && k === STATUSES.length - 1) ? "done" : k === idx ? "now" : ""}">
            <span class="dot">${icon("check")}</span><div><b>${esc(s.label)}</b><small>${k === idx ? esc(s.desc) : when(s.id) ? esc(fmtDate(when(s.id))) : ""}</small></div></li>`).join("")}</ol>`}
          ${o.tracking ? `<div class="notice good" style="margin-top:16px">${icon("truck")}<p><b>Tracking:</b> ${esc(o.tracking)}</p></div>` : ""}
        </div></section>
        <section class="card fade-up"><div class="body help"><b>Questions about this order?</b><p class="muted">Email <a href="mailto:marketing@ankord.com.au?subject=${encodeURIComponent(`Order ${o.number}`)}">marketing@ankord.com.au</a> and quote ${esc(o.number)}.</p></div></section>
      </aside>
    </div></div>`);
  requestAnimationFrame(() => fitRender($("#order-mat")));
  $("#reorder-btn")?.addEventListener("click", e => startReorder(o.designId, e.currentTarget));
  $("#dl-pdf")?.addEventListener("click", () => {
    const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    a.download = `${inv.kind === "invoice" ? "Invoice" : "Quote"} ${inv.number}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
}

/* ===================== routing ===================== */
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [a, b] = h.split("/");
  if (a === "build" && b) return { name: "build", id: b };
  if (a === "orders" && b) return { name: "order", id: b };
  if (a === "account") return { name: "account" };
  return { name: "home" };
}
let justPlaced = null;
export function showPlacedOrder(order) { justPlaced = order; location.hash = `#/orders/${order.id}`; }

export async function render() {
  if (current) { await current.unmount(); current = null; }
  document.body.classList.remove("in-builder");
  renderHeader();
  window.scrollTo({ top: 0 });
  if (!session.user) { setView(landingHTML(), "landing"); return; }
  // Staff skip business details (that would add them to Xero as a customer) and go to the admin dashboard.
  if (session.isAdmin && !session.onboarded) { location.replace("/misterminit/admin"); return; }
  if (!session.onboarded) { onboardingView(); return; }
  const r = route();
  if (r.name === "account") return accountView();
  if (r.name === "order") { const p = justPlaced; justPlaced = null; return orderView(r.id, { justPlaced: p }); }
  if (r.name === "build") { document.body.classList.add("in-builder"); current = await mountBuilder(app(), r.id); return; }
  return homeView();
}

window.addEventListener("hashchange", () => render());
(async function boot() {
  try {
    const d = await api("me");
    Object.assign(session, { user: d.user, profile: d.profile, onboarded: d.onboarded, isAdmin: d.isAdmin, testMode: !!d.testMode });
  } catch (e) {
    if (e.status !== 401) console.warn(e);
  }
  render();
})();
