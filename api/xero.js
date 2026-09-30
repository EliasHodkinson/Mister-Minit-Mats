/*
 * The Xero web-app connection, done once by someone at Ankor'd:
 *   GET /misterminit/api/xero/connect?key=XERO_ADMIN_KEY  → sends you to Xero to approve the app
 *   GET /misterminit/api/xero/callback                     → Xero sends you back here; the login is saved
 *   GET /misterminit/api/xero/status?key=XERO_ADMIN_KEY    → which organisation is connected, and when it last refreshed
 *   GET /api/xero?action=refresh                            → daily Vercel cron, keeps the 60-day refresh token alive
 * The login (refresh token + organisation id) lives in the key/value store, never in the browser.
 */
import crypto from "node:crypto";
import { kvStore } from "../lib/store.js";
import { DEFAULT_SCOPES, TOKEN_KEY, refreshConnection, resetXeroToken, tokenRequest, xeroConfigured } from "../lib/xero.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const page = (res, status, title, body) => res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title>
  <body style="font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1c2826">
  <h1 style="font-size:20px;color:#08393a">${esc(title)}</h1>${body}</body>`);

const redirectUri = (req, env) => env.XERO_REDIRECT_URI || `https://${req.headers["x-forwarded-host"] || req.headers.host}/misterminit/api/xero/callback`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const env = process.env, action = String(req.query?.action || "");
  if (!xeroConfigured(env)) return page(res, 500, "Xero isn't set up", "<p>Set XERO_CLIENT_ID and XERO_CLIENT_SECRET first.</p>");
  const store = kvStore(env);
  if (!store) return page(res, 500, "No key/value store", "<p>Add <b>Upstash for Redis</b> to this project from the Vercel Marketplace, then redeploy.</p>");
  const admin = () => env.XERO_ADMIN_KEY && safeEqual(req.query?.key || "", env.XERO_ADMIN_KEY);

  if (action === "connect") {
    if (!admin()) return page(res, 403, "Not allowed", "<p>Open this link with <code>?key=</code> set to XERO_ADMIN_KEY.</p>");
    const state = crypto.randomBytes(24).toString("hex");
    await store.set(`xero:state:${state}`, { at: Date.now() }, 600);
    const url = new URL("https://login.xero.com/identity/connect/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: env.XERO_CLIENT_ID, redirect_uri: redirectUri(req, env), scope: env.XERO_SCOPES || DEFAULT_SCOPES, state }).toString();
    return res.redirect(302, url.toString());
  }

  if (action === "callback") {
    const { code, state, error, error_description } = req.query || {};
    if (error) return page(res, 400, "Xero didn't connect", `<p>${esc(error_description || error)}</p>`);
    if (!state || !(await store.get(`xero:state:${state}`))) return page(res, 400, "Link expired", "<p>Start again from the connect link.</p>");
    await store.del(`xero:state:${state}`);
    try {
      const t = await tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri(req, env) });
      const r = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${t.access_token}` } });
      const orgs = (await r.json().catch(() => [])).filter(c => c.tenantType === "ORGANISATION");
      const want = (env.XERO_ORG_NAME || "").toLowerCase();
      const org = want ? orgs.find(o => o.tenantName.toLowerCase().includes(want)) : orgs.length === 1 ? orgs[0] : null;
      if (!org) return page(res, 400, "Pick one organisation", `<p>This login can see ${orgs.map(o => `<b>${esc(o.tenantName)}</b>`).join(", ") || "no organisations"}. Set XERO_ORG_NAME to the one to use (e.g. Ankor'd), or only tick that organisation when connecting, then start again.</p>`);
      await store.set(TOKEN_KEY, { refreshToken: t.refresh_token, tenantId: org.tenantId, tenantName: org.tenantName, connectedAt: new Date().toISOString() });
      resetXeroToken();
      return page(res, 200, "Xero connected", `<p>Quotes will now be raised in <b>${esc(org.tenantName)}</b>. You can close this tab.</p>`);
    } catch (e) { return page(res, 502, "Xero didn't connect", `<p>${esc(e.message)}</p>`); }
  }

  if (action === "status") {
    if (!admin()) return res.status(403).json({ ok: false, error: "Not allowed" });
    const c = await store.get(TOKEN_KEY);
    return res.status(200).json({ ok: true, connected: !!c?.refreshToken, organisation: c?.tenantName || null, connectedAt: c?.connectedAt || null, refreshedAt: c?.refreshedAt || null });
  }

  if (action === "refresh") {
    // Vercel cron sends "Authorization: Bearer $CRON_SECRET"
    if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) return res.status(401).json({ ok: false });
    try { resetXeroToken(); await refreshConnection(env, store); return res.status(200).json({ ok: true }); }
    catch (e) { console.error("xero keep-alive failed:", e.message); return res.status(502).json({ ok: false, error: e.message }); }
  }
  return res.status(404).json({ ok: false, error: "Unknown action" });
}
