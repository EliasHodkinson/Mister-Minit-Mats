/*
 * Mister Minit Mat Builder – staff admin (/misterminit/admin).
 * Hash routes: #/orders, #/orders/:id, #/customers, #/customers/:id
 * Talks to /misterminit/api/admin (see api/admin.js). Vanilla ES module, no build step.
 */
import { matHTML, STATUSES, CANCELLED, statusInfo, money, COLUMNS, KIND_NAME, PALETTE, FIELD_NAME, ITEM_KEYS } from "/misterminit/shared/mat.js";

const API = "/misterminit/api/admin";
const LOGIN = "/misterminit/api/auth/login?returnTo=" + encodeURIComponent("/misterminit/admin");
const ALL_STATUSES = [...STATUSES, CANCELLED];
const MOBILE = window.matchMedia("(max-width: 760px)");

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");

/* ===================== helpers ===================== */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmtDate = d => {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(x) ? String(d) : x.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
};
const fmtDay = d => {
  if (!d) return "";
  const x = new Date(String(d).length === 10 ? d + "T00:00:00" : d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("en-AU", { dateStyle: "medium" });
};
const relDate = d => {
  if (!d) return "";
  const x = new Date(d), diff = (Date.now() - x) / 864e5;
  if (isNaN(x)) return "";
  if (diff < 1 && new Date().toDateString() === x.toDateString()) return "Today, " + x.toLocaleTimeString("en-AU", { timeStyle: "short" });
  if (diff < 2 && new Date(Date.now() - 864e5).toDateString() === x.toDateString()) return "Yesterday";
  return x.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: x.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};
const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;
const pill = (status, label) => `<span class="pill s-${esc(status)}">${esc(label || statusInfo(status).label)}</span>`;
const fullName = c => [c?.firstName, c?.lastName].filter(Boolean).join(" ");
const addrLines = a => {
  if (!a) return [];
  const line2 = [a.suburb, a.state, a.postcode].filter(Boolean).join(" ");
  return [a.street, line2].filter(Boolean);
};
const addrHTML = a => {
  const l = addrLines(a);
  return l.length ? l.map(esc).join("<br>") : `<span class="muted">Not given</span>`;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

let toastTimer;
function toast(msg, kind = "") {
  $toast.textContent = msg;
  $toast.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.className = "toast"; }, 2800);
}

/* ===================== API ===================== */
class ApiError extends Error { constructor(status, message, body) { super(message); this.status = status; this.body = body; } }

async function api(params = {}, { method = "GET", body } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  let res, data = null;
  try {
    res = await fetch(`${API}${qs ? "?" + qs : ""}`, {
      method, credentials: "same-origin", cache: "no-store",
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data || data.ok === false) throw new ApiError(res.status, data?.error || `Something went wrong (${res.status})`, data);
  return data;
}

/* ===================== router ===================== */
let renderToken = 0;          // bumps on every navigation so slow responses for an old view are dropped
const ordersState = { status: "", q: "" };
const customersState = { q: "" };

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(query) };
}

function setNav(section) {
  document.querySelectorAll("[data-nav]").forEach(a => {
    const on = a.dataset.nav === section;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

async function route() {
  const token = ++renderToken;
  const { parts, query } = parseHash();
  const [section = "orders", id] = parts;
  setNav(section === "customers" ? "customers" : "orders");
  try {
    if (section === "customers" && id) await viewCustomer(id, token);
    else if (section === "customers") { customersState.q = query.get("q") || ""; await viewCustomers(token); }
    else if (section === "orders" && id) await viewOrder(id, token);
    else { ordersState.status = query.get("status") || ""; ordersState.q = query.get("q") || ""; await viewOrders(token); }
  } catch (e) {
    if (token !== renderToken) return;
    showError(e);
  }
}
window.addEventListener("hashchange", route);
function start() { if (!location.hash || location.hash === "#") history.replaceState(null, "", "#/orders"); route(); }

/** Swap the page content with a gentle fade-up (base.css respects reduced motion). */
function paint(html, { title, focus = true, animate = true } = {}) {
  $app.innerHTML = `<div class="view ${animate ? "fade-up" : ""}">${html}</div>`;
  if (title) document.title = `${title} · Mister Minit Admin`;
  if (focus) { window.scrollTo({ top: 0 }); $app.focus({ preventScroll: true }); }
}
const stale = token => token !== renderToken;

function showError(e) {
  if (e.status === 401) {
    paint(`<div class="gate card fade-up"><div class="body">
      <div class="gate-icon">${icon("lock")}</div>
      <h1>Sign in to continue</h1>
      <p>The admin area is for Ankor'd staff. Sign in with your staff account to manage Mister Minit orders.</p>
      <a class="btn navy big" href="${LOGIN}">Sign in${icon("arrow-right")}</a>
    </div></div>`, { title: "Sign in" });
    return;
  }
  if (e.status === 403) {
    paint(`<div class="gate card fade-up"><div class="body">
      <div class="gate-icon bad">${icon("lock")}</div>
      <h1>This page is for Ankor'd staff only</h1>
      <p>You're signed in, but this account isn't on the staff list. If you think it should be, ask an Ankor'd admin to add your email.</p>
      <div class="gate-actions"><a class="btn navy" href="/misterminit/">Back to the Mat Builder</a><a class="btn ghost" href="/misterminit/api/auth/logout">Sign out</a></div>
    </div></div>`, { title: "Staff only" });
    return;
  }
  const back = location.hash.startsWith("#/customers") ? ["#/customers", "Back to customers"] : ["#/orders", "Back to orders"];
  paint(`<div class="gate card fade-up"><div class="body">
    <div class="gate-icon bad">${icon("alert")}</div>
    <h1>${e.status === 404 ? "Not found" : "Something went wrong"}</h1>
    <p>${esc(e.message)}</p>
    <div class="gate-actions"><button class="btn navy" type="button" data-retry>${icon("refresh")}Try again</button><a class="btn ghost" href="${back[0]}">${back[1]}</a></div>
  </div></div>`, { title: "Error" });
  $app.querySelector("[data-retry]")?.addEventListener("click", route);
}

/* ===================== skeletons ===================== */
const skRows = (n, cols) => Array.from({ length: n }, () => `<div class="sk-row">${Array.from({ length: cols }, (_, i) => `<div class="skeleton" style="height:14px;width:${[70, 90, 55, 40, 60, 50][i % 6]}%"></div>`).join("")}</div>`).join("");
const skList = (title, n = 7) => `
  <div class="page-head"><div><div class="skeleton" style="width:90px;height:12px;margin-bottom:10px"></div><h1 class="skeleton" style="width:220px;height:34px"></h1></div></div>
  <div class="chips">${Array.from({ length: 6 }, () => `<span class="skeleton" style="width:96px;height:36px;border-radius:999px"></span>`).join("")}</div>
  <div class="card sk-card" aria-busy="true" aria-label="Loading ${esc(title)}">${skRows(n, 6)}</div>`;
const skDetail = () => `
  <div class="skeleton" style="width:120px;height:14px;margin-bottom:16px"></div>
  <div class="skeleton" style="width:280px;height:34px;margin-bottom:22px"></div>
  <div class="od-grid"><div class="od-main">
    <div class="card"><div class="body">${skRows(5, 2)}</div></div>
    <div class="card"><div class="body">${skRows(4, 3)}</div></div>
  </div><div class="od-side">
    <div class="card"><div class="body">${skRows(6, 1)}</div></div>
    <div class="card"><div class="body">${skRows(3, 1)}</div></div>
  </div></div>`;

/* ===================== ORDERS LIST ===================== */
let ordersCache = null;       // last list response (for counts)

async function viewOrders(token) {
  const fresh = !$app.querySelector("[data-view=orders]");
  if (fresh) paint(skList("orders"), { title: "Orders" });
  const data = await api({ view: "orders", status: ordersState.status, q: ordersState.q });
  if (stale(token)) return;
  ordersCache = data;
  if (fresh || !$app.querySelector("[data-view=orders]")) {
    paint(ordersShell(), { title: "Orders", focus: fresh });
    bindOrdersShell();
  }
  renderOrdersBody(data);
}

function ordersShell() {
  return `<section data-view="orders">
    <div class="page-head">
      <div><div class="eyebrow">Staff</div><h1>Orders</h1><p>Every Mister Minit mat order, newest first. Paid invoices are picked up from Xero when this list loads.</p></div>
      <button class="btn small" type="button" data-refresh>${icon("refresh")}Refresh</button>
    </div>
    <div class="toolbar">
      <div class="chips" role="tablist" aria-label="Filter by status" data-chips></div>
      <label class="search">${icon("search")}<span class="sr">Search orders</span>
        <input type="search" placeholder="Search orders, customers, stores" value="${esc(ordersState.q)}" data-search autocomplete="off" enterkeyhint="search">
      </label>
    </div>
    <div data-body></div>
  </section>`;
}

function bindOrdersShell() {
  const sec = $app.querySelector("[data-view=orders]");
  const reload = async () => {
    const token = renderToken;
    const body = sec.querySelector("[data-body]");
    body.classList.add("is-loading");
    try {
      const data = await api({ view: "orders", status: ordersState.status, q: ordersState.q });
      if (stale(token)) return;
      ordersCache = data;
      renderOrdersBody(data);
    } catch (e) { if (!stale(token)) showError(e); }
    finally { body.classList.remove("is-loading"); }
  };
  const syncHash = () => {
    const q = new URLSearchParams();
    if (ordersState.status) q.set("status", ordersState.status);
    if (ordersState.q) q.set("q", ordersState.q);
    history.replaceState(null, "", "#/orders" + (q.toString() ? "?" + q : ""));
  };
  sec.querySelector("[data-search]").addEventListener("input", debounce(e => {
    ordersState.q = e.target.value.trim(); syncHash(); reload();
  }, 280));
  sec.querySelector("[data-refresh]").addEventListener("click", reload);
  sec.querySelector("[data-chips]").addEventListener("click", e => {
    const b = e.target.closest("[data-status]"); if (!b) return;
    ordersState.status = b.dataset.status; syncHash(); reload();
  });
  sec.addEventListener("click", e => {
    if (e.target.closest("a, button, select, input, label")) return;
    const row = e.target.closest("[data-href]");
    if (row) location.hash = row.dataset.href;
  });
  sec.addEventListener("keydown", e => {
    const row = e.target.closest?.("[data-href]");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = row.dataset.href; }
  });
  sec.addEventListener("change", async e => {
    const sel = e.target.closest("select[data-quick]"); if (!sel) return;
    const id = sel.dataset.quick, prev = sel.dataset.prev, next = sel.value;
    sel.disabled = true;
    try {
      await api({ id }, { method: "PATCH", body: { status: next, note: "" } });
      toast(`Order moved to ${statusInfo(next).label}`);
      reload();
    } catch (err) {
      sel.value = prev; sel.disabled = false;
      if (err.status === 401 || err.status === 403) showError(err); else toast(err.message, "bad");
    }
  });
}

function renderOrdersBody(data) {
  const sec = $app.querySelector("[data-view=orders]"); if (!sec) return;
  const counts = data.counts || {}, statuses = (data.statuses || ALL_STATUSES);
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  const chip = (id, label, n) => `<button type="button" class="chip ${ordersState.status === id ? "on" : ""} ${id ? "c-" + esc(id) : ""}" role="tab" aria-selected="${ordersState.status === id}" data-status="${esc(id)}">${esc(label)}<span class="n">${n || 0}</span></button>`;
  sec.querySelector("[data-chips]").innerHTML = chip("", "All", total) + statuses.map(s => chip(s.id, s.label, counts[s.id])).join("");
  const strip = sec.querySelector("[data-chips]"), on = strip.querySelector(".on");   // keep the active chip in view on phones (without scrolling the page)
  if (on && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, on.offsetLeft - strip.offsetLeft - 14);

  const orders = data.orders || [];
  const body = sec.querySelector("[data-body]");
  if (!orders.length) {
    const filtered = ordersState.status || ordersState.q;
    body.innerHTML = `<div class="empty fade-up">${icon("orders", "big")}<b>${filtered ? "No orders match" : "No orders yet"}</b>
      <p>${filtered ? "Try another status or search." : "Orders appear here as soon as a customer submits one."}</p>
      ${filtered ? `<button class="btn small" type="button" data-clear>Clear filters</button>` : ""}</div>`;
    body.querySelector("[data-clear]")?.addEventListener("click", () => {
      ordersState.status = ""; ordersState.q = ""; sec.querySelector("[data-search]").value = "";
      history.replaceState(null, "", "#/orders"); route();
    });
    return;
  }
  body.innerHTML = `<p class="result-count muted">${plural(orders.length, "order")}${orders.length >= 500 ? " (showing the newest 500)" : ""}</p>` + ordersTable(orders, { quick: true });
}

function statusSelect(o) {
  return `<label class="quick-status s-${esc(o.status)}"><span class="sr">Status for ${esc(o.number)}</span>
    <select data-quick="${esc(o.id)}" data-prev="${esc(o.status)}">${ALL_STATUSES.map(s => `<option value="${s.id}" ${s.id === o.status ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>`;
}

/** Orders as a table on desktop, stacked cards on phones (same markup, CSS does the collapse). */
function ordersTable(orders, { quick = false, showCustomer = true } = {}) {
  return `<div class="card table-card"><table class="rtable orders-table">
    <thead><tr><th>Order</th><th>Placed</th>${showCustomer ? "<th>Customer</th>" : ""}<th class="c-stores">Stores</th><th class="num">Mats</th><th class="num">Changes</th><th class="num">Total</th><th>Status</th><th class="c-inv">Invoice</th><th class="chev-col"><span class="sr">Open</span></th></tr></thead>
    <tbody class="stagger">${orders.map(o => `<tr data-href="#/orders/${esc(o.id)}" tabindex="0" aria-label="Order ${esc(o.number)}">
      <td class="c-num"><a href="#/orders/${esc(o.id)}" class="ord-no">${esc(o.number)}</a></td>
      <td class="c-date" title="${esc(fmtDate(o.createdAt))}">${esc(relDate(o.createdAt))}</td>
      ${showCustomer ? `<td class="c-cust"><b>${esc(o.customerName || o.customer?.tradingName || "—")}</b><small>${esc(o.customer?.email || "")}</small></td>` : ""}
      <td class="c-stores">${esc(o.storeNames || "—")}</td>
      <td class="num c-mats" data-label="Mats">${esc(o.mats)}</td>
      <td class="num c-changes" data-label="Changes">${esc(o.changeCount ?? 0)}${o.isReorder ? ` <span class="tag">reorder</span>` : ""}</td>
      <td class="num c-total"><b>${money(o.total)}</b></td>
      <td class="c-status">${quick ? statusSelect(o) : pill(o.status, o.statusLabel)}</td>
      <td class="c-inv">${o.invoice ? `<span class="mono">${esc(o.invoice.number)}</span>` : o.xeroError ? `<span class="tag bad" title="${esc(o.xeroError)}">Xero error</span>` : `<span class="muted">—</span>`}</td>
      <td class="chev-col">${icon("right")}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

/* ===================== ORDER DETAIL ===================== */
let current = null;   // { order, account, statuses }

async function viewOrder(id, token) {
  paint(skDetail(), { title: "Order" });
  const data = await api({ view: "order", id });
  if (stale(token)) return;
  current = { order: data.order, account: data.account, statuses: data.statuses || ALL_STATUSES };
  renderOrder();
}

function renderOrder({ keepScroll = false } = {}) {
  const { order: o, account } = current;
  const y = window.scrollY;
  paint(`<article class="order-view" data-view="order">
    <a class="back no-print" href="#/orders">${icon("left")}All orders</a>
    <header class="od-head">
      <div class="od-title">
        <div class="eyebrow">Order${o.isReorder ? " · Reorder" : ""}</div>
        <h1>${esc(o.number)} ${pill(o.status, o.statusLabel)}</h1>
        <p class="muted">Placed ${esc(fmtDate(o.createdAt))} by <a href="#/customers/${esc(o.customerId)}">${esc(o.customerName || o.customer?.email || "customer")}</a>${o.updatedAt && o.updatedAt !== o.createdAt ? ` · updated ${esc(fmtDate(o.updatedAt))}` : ""}</p>
      </div>
      <div class="od-total">
        <span class="muted">Total inc. GST</span><b>${money(o.total)}</b>
        <span class="muted small">${plural(o.mats || 0, "mat")} · ${plural(o.changeCount || 0, "change")}</span>
      </div>
      <div class="od-actions no-print">
        <button class="btn small" type="button" data-print>${icon("print")}Print</button>
      </div>
    </header>

    <div class="od-grid">
      <div class="od-main">
        ${statusCard(o)}
        ${linesCard(o)}
      </div>
      <aside class="od-side">
        ${customerCard(o, account)}
        ${invoiceCard(o)}
        ${historyCard(o)}
      </aside>
    </div>
    ${configCard(o)}
  </article>`, { title: o.number, focus: !keepScroll, animate: !keepScroll });
  if (keepScroll) window.scrollTo({ top: y });
  bindOrder();
}

function trackHTML(o) {
  const cancelled = o.status === "cancelled";
  const hist = o.history || [];
  const reached = id => [...hist].reverse().find(h => h.status === id);
  let idx = STATUSES.findIndex(s => s.id === o.status);
  if (cancelled) {   // how far it got before it was cancelled
    const lastLive = [...hist].reverse().find(h => h.status !== "cancelled");
    idx = lastLive ? STATUSES.findIndex(s => s.id === lastLive.status) : -1;
  }
  return `<ol class="track ${cancelled ? "is-cancelled" : ""}">${STATUSES.map((s, i) => {
    const last = i === STATUSES.length - 1;   // "Delivered" is the end of the line, so it shows as done, not in progress
    const cls = i < idx || (i === idx && (cancelled || last)) ? "done" : i === idx ? "now" : "";
    const h = reached(s.id);
    return `<li class="${cls}"><span class="dot">${icon("check")}</span><div><b>${esc(s.label)}</b>${h && i <= idx ? `<small>${esc(fmtDate(h.at))}${h.by ? ` · ${esc(h.by)}` : ""}</small>` : ""}</div></li>`;
  }).join("")}</ol>`;
}

function statusCard(o) {
  const cancelled = o.status === "cancelled";
  const i = STATUSES.findIndex(s => s.id === o.status);
  const next = !cancelled && i >= 0 && i < STATUSES.length - 1 ? STATUSES[i + 1] : null;
  const cancelledAt = cancelled ? [...(o.history || [])].reverse().find(h => h.status === "cancelled") : null;
  return `<section class="card" aria-labelledby="st-h"><div class="body">
    <h2 class="card-title" id="st-h">${icon("orders")}Status</h2>
    ${cancelled ? `<div class="notice bad">${icon("x")}<p><b>Cancelled</b>${cancelledAt ? ` on ${esc(fmtDate(cancelledAt.at))}` : ""}${cancelledAt?.by ? ` by ${esc(cancelledAt.by)}` : ""}${cancelledAt?.note ? ` — ${esc(cancelledAt.note)}` : ""}</p></div>` : ""}
    <div class="status-grid">
      ${trackHTML(o)}
      <div class="status-forms no-print">
        <form class="stack" data-status-form>
          <div class="field">
            <label for="st-sel">Move to</label>
            <select id="st-sel" name="status">${ALL_STATUSES.map(s => `<option value="${s.id}" ${s.id === o.status ? "selected" : ""}>${esc(s.label)}${s.id === o.status ? " (current)" : ""}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label for="st-note">Note <span class="opt">optional · saved in the history</span></label>
            <input id="st-note" name="note" type="text" maxlength="500" placeholder="e.g. Mockup emailed to Sam">
          </div>
          <div class="row-btns">
            <button class="btn navy" type="submit" disabled data-save-status>${icon("check")}Save status</button>
            ${next ? `<button class="btn ghost" type="button" data-advance="${next.id}">Mark ${esc(next.label.toLowerCase())}${icon("arrow-right")}</button>` : ""}
          </div>
        </form>
        <hr>
        <form class="stack" data-details-form>
          <div class="field">
            <label for="st-track">${icon("truck")} Tracking number</label>
            <input id="st-track" name="tracking" type="text" maxlength="300" value="${esc(o.tracking)}" placeholder="Courier and tracking number">
          </div>
          <div class="field">
            <label for="st-admin">${icon("note")} Internal note <span class="opt">staff only, never shown to the customer</span></label>
            <textarea id="st-admin" name="adminNote" maxlength="4000" rows="3" placeholder="Anything the team should know">${esc(o.adminNote)}</textarea>
          </div>
          <div class="row-btns"><button class="btn" type="submit" disabled data-save-details>${icon("check")}Save details</button></div>
        </form>
      </div>
    </div>
    ${o.tracking || o.adminNote ? `<div class="print-only print-notes">${o.tracking ? `<p><b>Tracking:</b> ${esc(o.tracking)}</p>` : ""}${o.adminNote ? `<p><b>Internal note:</b> ${esc(o.adminNote)}</p>` : ""}</div>` : ""}
  </div></section>`;
}

function historyCard(o) {
  const h = [...(o.history || [])].reverse();
  return `<section class="card" aria-labelledby="hi-h"><div class="body">
    <h2 class="card-title" id="hi-h">${icon("history")}History</h2>
    ${h.length ? `<ol class="history">${h.map(x => `<li>
      <div class="h-top">${pill(x.status, x.label)}<time datetime="${esc(x.at)}">${esc(fmtDate(x.at))}</time></div>
      ${x.by ? `<div class="h-by">${esc(x.by)}</div>` : ""}
      ${x.note ? `<div class="h-note">${esc(x.note)}</div>` : ""}
    </li>`).join("")}</ol>` : `<p class="muted">No changes yet.</p>`}
  </div></section>`;
}

function dl(rows) {
  return `<dl class="dl">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function customerCard(o, account) {
  const c = o.customer || {};
  const same = c.sameDelivery ?? c.deliverySame ?? true;
  const delivery = same ? null : c.delivery;
  const xero = account
    ? account.xeroLinked || account.xeroContactId
      ? `<span class="tag ok">${icon("check")}Linked</span>`
      : account.xeroError ? `<span class="tag bad" title="${esc(account.xeroError)}">Not linked</span>` : `<span class="tag">Not linked yet</span>`
    : `<span class="muted">—</span>`;
  const changedSince = account && (account.tradingName !== c.tradingName || account.abn !== c.abn || account.email !== c.email);
  return `<section class="card" aria-labelledby="cu-h"><div class="body">
    <h2 class="card-title" id="cu-h">${icon("users")}Customer
      <a class="btn small ghost no-print push" href="#/customers/${esc(o.customerId)}">Profile${icon("right")}</a></h2>
    <div class="cust-name"><b>${esc(c.tradingName || "—")}</b>${c.legalName && c.legalName !== c.tradingName ? `<span>${esc(c.legalName)}</span>` : ""}</div>
    ${dl([
      ["ABN", c.abn ? `<span class="mono">${esc(c.abn)}</span>` : `<span class="muted">—</span>`],
      ["Contact", esc(fullName(c)) || `<span class="muted">—</span>`],
      ["Email", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : `<span class="muted">—</span>`],
      ["Phone", c.phone ? `<a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a>` : `<span class="muted">—</span>`],
      ["Billing", addrHTML(c.billing)],
      ["Delivery", delivery ? addrHTML(delivery) : `<span class="muted">Same as billing</span>`],
      ["Xero contact", xero],
    ])}
    ${account?.xeroError ? `<div class="notice bad small">${icon("alert")}<p><b>Xero contact:</b> ${esc(account.xeroError)}</p></div>` : ""}
    ${changedSince ? `<p class="hint-line">${icon("info")}Details shown are as ordered. The customer's profile has changed since.</p>` : ""}
  </div></section>`;
}

function invoiceCard(o) {
  const inv = o.invoice;
  const kind = inv?.kind ? inv.kind[0].toUpperCase() + inv.kind.slice(1) : "Invoice";
  return `<section class="card" aria-labelledby="in-h"><div class="body">
    <h2 class="card-title" id="in-h">${icon("invoice")}${esc(inv ? kind : "Invoice")}</h2>
    ${inv ? dl([
      ["Number", `<span class="mono">${esc(inv.number)}</span>`],
      ["Total", `<b>${money(o.total)}</b>`],
      inv.due ? ["Due", esc(fmtDay(inv.due))] : null,
    ]) : `<p class="muted">No Xero ${o.xeroError ? "document — see the error below" : "document for this order yet"}.</p>`}
    <div class="row-btns no-print">
      ${o.xeroId ? `<a class="btn small" href="https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(o.xeroId)}" target="_blank" rel="noopener">Open in Xero${icon("external")}</a>` : ""}
      ${inv?.payUrl ? `<a class="btn small" href="${esc(inv.payUrl)}" target="_blank" rel="noopener">${icon("link")}Pay link</a><button class="btn small ghost" type="button" data-copy="${esc(inv.payUrl)}">Copy</button>` : ""}
    </div>
    ${o.xeroError ? `<div class="notice bad">${icon("alert")}<p><b>Xero:</b> ${esc(o.xeroError)}</p></div>` : ""}
    ${o.emailError ? `<div class="notice bad">${icon("alert")}<p><b>Email:</b> ${esc(o.emailError)}</p></div>` : ""}
  </div></section>`;
}

function linesCard(o) {
  const q = o.quote || {}, lines = q.lines || [];
  return `<section class="card" aria-labelledby="ln-h"><div class="body">
    <h2 class="card-title" id="ln-h">${icon("invoice")}Order lines</h2>
    ${lines.length ? `<table class="rtable lines">
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
      <tbody>${lines.map(l => `<tr>
        <td class="l-item"><b>${esc(l.label)}</b>${l.note ? `<small>${esc(l.note)}</small>` : ""}</td>
        <td class="num" data-label="Qty">${esc(l.qty)}</td>
        <td class="num" data-label="Unit">${money(l.unit)}</td>
        <td class="num" data-label="Amount"><b>${money(l.amount)}</b></td>
      </tr>`).join("")}</tbody></table>
    <dl class="totals">
      <dt>Subtotal${q.includesGst === false ? "" : " (ex GST)"}</dt><dd>${money(q.subTotal)}</dd>
      <dt>GST</dt><dd>${money(q.gst)}</dd>
      <dt class="grand">Total</dt><dd class="grand">${money(q.total ?? o.total)}</dd>
    </dl>` : `<p class="muted">No priced lines on this order.</p>`}
  </div></section>`;
}

/* ---------- configuration ---------- */
const fieldVal = (k, v) => {
  if (typeof v === "boolean") return v ? `<span class="yes">${icon("check")}Yes</span>` : `<span class="muted">—</span>`;
  if (k === "color" && v) return `<span class="swatch-inline"><i style="background:${esc(v)}"></i><span class="mono">${esc(v)}</span></span>`;
  const s = String(v ?? "");
  return s ? esc(s).replace(/\n/g, "<br>") : `<span class="muted">—</span>`;
};

function sectionBlock(s) {
  const pal = PALETTE[s.color] || PALETTE.orange;
  const keys = ITEM_KEYS[s.kind] || ["label", "price"];
  const flags = [];
  if (s.status === "new") flags.push(`<span class="tag ok">New section</span>`);
  else if (s.status === "changed") flags.push(`<span class="tag warn">Changed: ${esc((s.changedFields || []).map(f => FIELD_NAME[f] || f).join(", "))}</span>`);
  const meta = [s.subtitle && `Subtitle: ${esc(s.subtitle)}`, s.badge && `Badge: ${esc(s.badge)}`, s.footnote && `Footnote: ${esc(s.footnote)}`].filter(Boolean);
  const items = s.items || [];
  return `<div class="sec-block ${s.status ? "is-" + esc(s.status) : ""}">
    <div class="sec-head">
      <span class="swatch" style="background:${esc(pal.bg)}" title="${esc(pal.name)}"></span>
      <div class="sec-title"><b>${esc(s.title || "(untitled)")}</b><small>${esc(KIND_NAME[s.kind] || s.kind)} · ${esc(pal.name)} · ${plural(items.length, "line")}</small></div>
      <div class="sec-flags">${flags.join("")}</div>
    </div>
    ${meta.length ? `<p class="sec-meta">${meta.join(" · ")}</p>` : ""}
    ${items.length ? `<table class="rtable sec-table">
      <thead><tr>${keys.map(k => `<th>${esc(FIELD_NAME[k] || k)}</th>`).join("")}<th class="st-col"><span class="sr">Change</span></th></tr></thead>
      <tbody>${items.map(it => {
        const changed = new Set(it.changedFields || []);
        const tag = it.status === "new" ? `<span class="tag ok">New</span>` : it.status === "changed" ? `<span class="tag warn">Changed</span>` : "";
        return `<tr class="${it.status ? "is-" + esc(it.status) : ""}">${keys.map(k => `<td data-label="${esc(FIELD_NAME[k] || k)}" class="${changed.has(k) ? "cell-changed" : ""}">${fieldVal(k, it[k])}</td>`).join("")}
          <td class="st-col">${tag}${it.status === "changed" && changed.size ? `<small>${esc([...changed].map(f => FIELD_NAME[f] || f).join(", "))}</small>` : ""}</td></tr>`;
      }).join("")}</tbody></table>` : `<p class="muted small">No lines.</p>`}
  </div>`;
}

function configCard(o) {
  const sections = o.sections || [], stores = o.stores || [], changes = o.changes || [];
  const changedLines = sections.reduce((n, s) => n + (s.items || []).filter(i => i.status).length + (s.status ? 1 : 0), 0);
  return `<section class="card config" aria-labelledby="cf-h"><div class="body">
    <h2 class="card-title" id="cf-h">${icon("design")}Configuration <span class="hint">${plural(o.changeCount || 0, "change")}${o.isReorder ? " against the customer's previous design" : " from the template"}</span></h2>

    <div class="cfg-top">
      <div>
        <h3 class="sub-h">${icon("store")}Stores</h3>
        ${stores.length ? `<ul class="stores">${stores.map(s => `<li><b>${esc([s.line1, s.line2].filter(Boolean).join(" ") || "—")}</b><span class="qty">× ${esc(s.qty || 1)}</span></li>`).join("")}</ul>` : `<p class="muted">No stores.</p>`}
      </div>
      <div>
        <h3 class="sub-h">${icon("note")}Notes for the designer</h3>
        ${o.notes ? `<div class="designer-notes">${esc(o.notes).replace(/\n/g, "<br>")}</div>` : `<p class="muted">No notes.</p>`}
      </div>
    </div>

    <h3 class="sub-h">${icon("layers")}Mat</h3>
    ${stores.length > 1 ? `<div class="store-switch no-print" role="group" aria-label="Show store name">${stores.map((s, i) => `<button type="button" class="chip ${i === 0 ? "on" : ""}" data-store="${i}">${esc([s.line1, s.line2].filter(Boolean).join(" ") || `Store ${i + 1}`)}</button>`).join("")}</div>` : ""}
    ${sections.length ? `<div class="mat-render-box" data-mat><div class="mat-render"><div class="mat-wide">${matHTML(sections, stores[0] || {})}</div></div></div>` : `<div class="empty">No design snapshot on this order.</div>`}

    <h3 class="sub-h">${icon("history")}Changes <span class="count">${esc(o.changeCount ?? changes.length)}</span></h3>
    ${changes.length ? `<ol class="changes">${changes.map(c => `<li>${esc(c)}</li>`).join("")}</ol>` : `<p class="muted">No changes — ${o.isReorder ? "a straight reprint of the previous design" : "the standard template"}.</p>`}

    <div class="breakdown-head">
      <h3 class="sub-h">${icon("layers")}Section breakdown</h3>
      <div class="legend"><span class="lg new">New</span><span class="lg changed">Changed</span>${changedLines ? `<label class="check-line no-print"><input type="checkbox" data-only-changed> Only changes</label>` : ""}</div>
    </div>
    <div class="breakdown">${COLUMNS.map(([key, pos, theme]) => {
      const secs = sections.filter(s => s.column === key);
      if (!secs.length) return "";
      return `<div class="col-group"><h4>${esc(theme)} <span>${esc(pos)}</span></h4>${secs.map(sectionBlock).join("")}</div>`;
    }).join("")}
    ${sections.filter(s => !COLUMNS.some(([k]) => k === s.column)).map(sectionBlock).join("")}</div>
    <p class="hint-line">${icon("info")}Removed lines and sections aren't on the mat any more, so they only show in the change list above.</p>
  </div></section>`;
}

/* fit the 1500px mat render to its box */
let matObserver;
function fitMat() {
  const box = $app.querySelector("[data-mat]"); if (!box) return;
  const r = box.querySelector(".mat-render");
  const fit = () => {
    const scale = box.clientWidth / 1500;
    r.style.transform = `scale(${scale})`;
    box.style.height = Math.ceil(r.offsetHeight * scale) + "px";
  };
  fit();
  matObserver?.disconnect();
  matObserver = new ResizeObserver(fit);
  matObserver.observe(box);
  matObserver.observe(r);
}
window.addEventListener("beforeprint", fitMat);
window.addEventListener("afterprint", fitMat);

function bindOrder() {
  const root = $app.querySelector("[data-view=order]"); if (!root) return;
  const o = current.order;
  fitMat();

  root.querySelector("[data-print]")?.addEventListener("click", () => window.print());

  // status
  const sf = root.querySelector("[data-status-form]");
  const sel = sf.querySelector("select"), saveBtn = sf.querySelector("[data-save-status]");
  sel.addEventListener("change", () => { saveBtn.disabled = sel.value === o.status; });
  const saveStatus = async (status, note) => {
    if (status === "cancelled" && !confirm(`Cancel ${o.number}? The customer isn't emailed automatically.`)) return;
    sf.querySelectorAll("button, select, input").forEach(el => el.disabled = true);
    try {
      const r = await api({ id: o.id }, { method: "PATCH", body: { status, note } });
      current.order = r.order;
      renderOrder({ keepScroll: true });
      toast(`Status saved: ${statusInfo(status).label}`);
    } catch (e) {
      if (e.status === 401 || e.status === 403) return showError(e);
      toast(e.message, "bad");
      sf.querySelectorAll("button, select, input").forEach(el => el.disabled = false);
      saveBtn.disabled = sel.value === o.status;
    }
  };
  sf.addEventListener("submit", e => { e.preventDefault(); if (sel.value !== o.status) saveStatus(sel.value, sf.note.value.trim()); });
  sf.querySelector("[data-advance]")?.addEventListener("click", e => saveStatus(e.currentTarget.dataset.advance, sf.note.value.trim()));

  // tracking + internal note
  const df = root.querySelector("[data-details-form]");
  const dBtn = df.querySelector("[data-save-details]");
  const dirty = () => df.tracking.value !== (o.tracking || "") || df.adminNote.value !== (o.adminNote || "");
  df.addEventListener("input", () => { dBtn.disabled = !dirty(); });
  df.addEventListener("submit", async e => {
    e.preventDefault(); if (!dirty()) return;
    dBtn.disabled = true; dBtn.classList.add("busy");
    try {
      const r = await api({ id: o.id }, { method: "PATCH", body: { tracking: df.tracking.value.trim(), adminNote: df.adminNote.value } });
      current.order = r.order;
      renderOrder({ keepScroll: true });
      toast("Details saved");
    } catch (err) {
      if (err.status === 401 || err.status === 403) return showError(err);
      toast(err.message, "bad"); dBtn.disabled = false; dBtn.classList.remove("busy");
    }
  });

  // copy pay link
  root.querySelector("[data-copy]")?.addEventListener("click", async e => {
    try { await navigator.clipboard.writeText(e.currentTarget.dataset.copy); toast("Pay link copied"); }
    catch { toast("Couldn't copy – open the link instead", "bad"); }
  });

  // which store's name is on the mat
  root.querySelector(".store-switch")?.addEventListener("click", e => {
    const b = e.target.closest("[data-store]"); if (!b) return;
    root.querySelectorAll(".store-switch .chip").forEach(c => c.classList.toggle("on", c === b));
    root.querySelector("[data-mat] .mat-wide").innerHTML = matHTML(o.sections || [], (o.stores || [])[+b.dataset.store] || {});
  });

  root.querySelector("[data-only-changed]")?.addEventListener("change", e => {
    root.querySelector(".breakdown").classList.toggle("only-changed", e.target.checked);
  });
}

/* ===================== CUSTOMERS ===================== */
async function viewCustomers(token) {
  const fresh = !$app.querySelector("[data-view=customers]");
  if (fresh) paint(skList("customers"), { title: "Customers" });
  const data = await api({ view: "customers", q: customersState.q });
  if (stale(token)) return;
  if (fresh || !$app.querySelector("[data-view=customers]")) {
    paint(`<section data-view="customers">
      <div class="page-head"><div><div class="eyebrow">Staff</div><h1>Customers</h1><p>Everyone who has signed in to the Mat Builder, most recently active first.</p></div></div>
      <div class="toolbar"><label class="search wide">${icon("search")}<span class="sr">Search customers</span>
        <input type="search" placeholder="Search name, email or ABN" value="${esc(customersState.q)}" data-search autocomplete="off" enterkeyhint="search"></label></div>
      <div data-body></div></section>`, { title: "Customers", focus: fresh });
    const sec = $app.querySelector("[data-view=customers]");
    sec.querySelector("[data-search]").addEventListener("input", debounce(async e => {
      customersState.q = e.target.value.trim();
      history.replaceState(null, "", "#/customers" + (customersState.q ? "?q=" + encodeURIComponent(customersState.q) : ""));
      const t = renderToken, body = sec.querySelector("[data-body]");
      body.classList.add("is-loading");
      try { const d = await api({ view: "customers", q: customersState.q }); if (!stale(t)) renderCustomersBody(d); }
      catch (err) { if (!stale(t)) showError(err); }
      finally { body.classList.remove("is-loading"); }
    }, 280));
    sec.addEventListener("click", e => {
      if (e.target.closest("a, button, input")) return;
      const row = e.target.closest("[data-href]"); if (row) location.hash = row.dataset.href;
    });
    sec.addEventListener("keydown", e => {
      const row = e.target.closest?.("[data-href]");
      if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = row.dataset.href; }
    });
  }
  renderCustomersBody(data);
}

const xeroTag = c => c.xeroLinked || c.xeroContactId ? `<span class="tag ok">${icon("check")}Xero</span>`
  : c.xeroError ? `<span class="tag bad" title="${esc(c.xeroError)}">Xero error</span>` : `<span class="tag">Not linked</span>`;

function renderCustomersBody(data) {
  const body = $app.querySelector("[data-view=customers] [data-body]"); if (!body) return;
  const list = data.customers || [];
  if (!list.length) {
    body.innerHTML = `<div class="empty fade-up">${icon("users", "big")}<b>${customersState.q ? "No customers match" : "No customers yet"}</b><p>${customersState.q ? "Try a different search." : "Customers appear here after their first sign-in."}</p></div>`;
    return;
  }
  body.innerHTML = `<p class="result-count muted">${plural(list.length, "customer")}</p>
  <div class="card table-card"><table class="rtable cust-table">
    <thead><tr><th>Business</th><th>Email</th><th>ABN</th><th class="num">Orders</th><th class="num">Spend</th><th>Last order</th><th>Xero</th><th class="chev-col"><span class="sr">Open</span></th></tr></thead>
    <tbody class="stagger">${list.map(c => `<tr data-href="#/customers/${encodeURIComponent(c.id)}" tabindex="0" aria-label="${esc(c.tradingName || c.email)}">
      <td class="c-cust"><a href="#/customers/${encodeURIComponent(c.id)}"><b>${esc(c.tradingName || c.legalName || fullName(c) || "Not onboarded")}</b></a><small>${esc(c.legalName && c.legalName !== c.tradingName ? c.legalName : fullName(c))}${c.onboarded ? "" : " · details not completed"}</small></td>
      <td class="c-email">${esc(c.email)}</td>
      <td class="c-abn mono">${esc(c.abn || "—")}</td>
      <td class="num c-orders" data-label="Orders">${esc(c.orderCount)}</td>
      <td class="num c-spend" data-label="Spend"><b>${money(c.spend)}</b></td>
      <td class="c-last" data-label="Last order">${c.lastOrder ? esc(relDate(c.lastOrder)) : `<span class="muted">Never</span>`}</td>
      <td class="c-xero">${xeroTag(c)}</td>
      <td class="chev-col">${icon("right")}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

async function viewCustomer(id, token) {
  paint(skDetail(), { title: "Customer" });
  const data = await api({ view: "customer", id });
  if (stale(token)) return;
  const c = data.customer, orders = data.orders || [], designs = data.designs || [];
  const live = orders.filter(o => o.status !== "cancelled");
  const spend = live.reduce((n, o) => n + Number(o.total || 0), 0);
  const delivery = c.deliverySame === false ? c.delivery : null;
  paint(`<article data-view="customer">
    <a class="back" href="#/customers">${icon("left")}All customers</a>
    <header class="od-head">
      <div class="od-title">
        <div class="eyebrow">Customer</div>
        <h1>${esc(c.tradingName || c.legalName || c.email)}</h1>
        <p class="muted">${c.legalName && c.legalName !== c.tradingName ? esc(c.legalName) + " · " : ""}Signed up ${esc(fmtDate(c.createdAt))}</p>
      </div>
      <div class="stat-row">
        <div class="stat"><span>Orders</span><b>${orders.length}</b></div>
        <div class="stat"><span>Spend</span><b>${money(spend)}</b></div>
        <div class="stat"><span>Designs</span><b>${designs.length}</b></div>
      </div>
    </header>
    <section class="cust-orders">
      <h2 class="section-h">${icon("orders")}Orders</h2>
      ${orders.length ? ordersTable(orders, { showCustomer: false }) : `<div class="empty">No orders yet.</div>`}
    </section>
    <div class="od-grid">
      <div class="od-main">
        <section class="card"><div class="body">
          <h2 class="card-title">${icon("design")}Designs</h2>
          ${designs.length ? `<ul class="designs stagger">${designs.map(d => `<li>
            <div class="d-main"><b>${esc(d.name || d.storeNames || "Untitled design")}</b>
              <small>${esc(d.storeNames || "No store names yet")}${d.mats ? ` · ${plural(d.mats, "mat")}` : ""}</small></div>
            <div class="d-meta">
              <span class="pill ${d.status === "ordered" ? "s-delivered" : "draft"}">${d.status === "ordered" ? "Ordered" : "Draft"}</span>
              ${d.isReorder ? `<span class="tag">reorder</span>` : ""}
              <span class="muted small">${plural(d.changes || 0, "change")} · ${money(d.matPrice)} first mat</span>
              <span class="muted small">Updated ${esc(relDate(d.updatedAt))}</span>
            </div></li>`).join("")}</ul>` : `<div class="empty">No designs yet.</div>`}
        </div></section>
      </div>
      <aside class="od-side">
        <section class="card"><div class="body">
          <h2 class="card-title">${icon("users")}Profile</h2>
          ${dl([
            ["Trading name", esc(c.tradingName) || `<span class="muted">—</span>`],
            ["Legal name", esc(c.legalName) || `<span class="muted">—</span>`],
            ["ABN", c.abn ? `<span class="mono">${esc(c.abn)}</span>` : `<span class="muted">—</span>`],
            ["Contact", esc(fullName(c)) || `<span class="muted">—</span>`],
            ["Email", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"],
            ["Phone", c.phone ? `<a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a>` : `<span class="muted">—</span>`],
            ["Billing", addrHTML(c.billing)],
            ["Delivery", delivery ? addrHTML(delivery) : `<span class="muted">Same as billing</span>`],
            ["Details", c.onboarded ? `<span class="tag ok">${icon("check")}Complete</span>` : `<span class="tag warn">Not completed</span>`],
            ["Xero contact", xeroTag(c)],
          ])}
          ${c.xeroError ? `<div class="notice bad small">${icon("alert")}<p><b>Xero:</b> ${esc(c.xeroError)}</p></div>` : ""}
        </div></section>
      </aside>
    </div>
  </article>`, { title: c.tradingName || c.email });
  const root = $app.querySelector("[data-view=customer]");
  root.addEventListener("click", e => {
    if (e.target.closest("a, button")) return;
    const row = e.target.closest("[data-href]"); if (row) location.hash = row.dataset.href;
  });
  root.addEventListener("keydown", e => {
    const row = e.target.closest?.("[data-href]");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = row.dataset.href; }
  });
}

MOBILE.addEventListener?.("change", () => fitMat());

/* start last, so every const above is initialised before the first route runs */
if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start, { once: true }); else start();
