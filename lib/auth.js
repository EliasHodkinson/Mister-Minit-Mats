/*
 * Sign-in with WorkOS AuthKit (free tier: hosted sign-in / sign-up, email + password, Google / Microsoft / Apple).
 *
 * The flow: /api/auth?action=login redirects to AuthKit → AuthKit redirects back to /api/auth?action=callback with a
 * code → we swap it for a session and keep it in an encrypted, HttpOnly cookie (sealed with WORKOS_COOKIE_PASSWORD).
 * Every API call loads that cookie, and refreshes it when the short-lived access token has expired.
 *
 * Env: WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD (32+ random characters),
 *      ADMIN_EMAILS (comma-separated; those accounts can open /misterminit/admin), APP_URL (optional, e.g. https://apps.ankord.com.au)
 */
import { WorkOS } from "@workos-inc/node";
import crypto from "node:crypto";
import { db } from "./db.js";

export const SESSION_COOKIE = "mm_session";
const STATE_COOKIE = "mm_auth_state";
const BASE_PATH = "/misterminit";
const SESSION_DAYS = 30;

let workos = null;
export function authConfigured(env = process.env) {
  return !!(env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID && env.WORKOS_COOKIE_PASSWORD);
}
function client(env = process.env) {
  if (!authConfigured(env)) throw Object.assign(new Error("Sign-in isn't configured yet (WORKOS_API_KEY / WORKOS_CLIENT_ID / WORKOS_COOKIE_PASSWORD)"), { status: 500 });
  return workos ||= new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID });
}

/* ---------- cookies ---------- */
export function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(name, value, { maxAge, path = "/" } = {}) {
  const secure = process.env.VERCEL_ENV || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax${secure}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ""}`;
}
function addCookie(res, c) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [prev] : []), c]);
}
const setSession = (res, sealed) => addCookie(res, cookie(SESSION_COOKIE, sealed, { maxAge: SESSION_DAYS * 86400 }));
const clearSession = res => addCookie(res, cookie(SESSION_COOKIE, "", { maxAge: 0 }));

/* ---------- URLs ---------- */
export function appUrl(req, env = process.env) {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}
export const appHome = req => `${appUrl(req)}${BASE_PATH}/`;
const callbackUrl = req => `${appUrl(req)}${BASE_PATH}/api/auth/callback`;
/* only same-site paths under the app, so the sign-in can't be used to bounce people elsewhere */
const safeReturn = p => (typeof p === "string" && p.startsWith(BASE_PATH) && !p.startsWith("//") && !/[\r\n]/.test(p)) ? p : `${BASE_PATH}/`;

function redirect(res, url) { res.statusCode = 302; res.setHeader("Location", url); res.setHeader("Cache-Control", "no-store"); res.end(); }

/* ---------- sign in / out ---------- */
export function startSignIn(req, res, { signUp = false } = {}) {
  const state = crypto.randomBytes(18).toString("base64url");
  const returnTo = safeReturn(req.query?.returnTo);
  addCookie(res, cookie(STATE_COOKIE, `${state}|${returnTo}`, { maxAge: 600 }));
  const url = client().userManagement.getAuthorizationUrl({
    provider: "authkit", clientId: process.env.WORKOS_CLIENT_ID, redirectUri: callbackUrl(req), state,
    ...(signUp ? { screenHint: "sign-up" } : {}),
  });
  redirect(res, url);
}

export async function finishSignIn(req, res) {
  const { code, state, error, error_description } = req.query || {};
  const [expected, returnTo] = String(readCookies(req)[STATE_COOKIE] || "").split("|");
  addCookie(res, cookie(STATE_COOKIE, "", { maxAge: 0 }));
  if (error) return redirect(res, `${appHome(req)}?signin_error=${encodeURIComponent(error_description || error)}`);
  if (!code || !state || state !== expected) return redirect(res, `${appHome(req)}?signin_error=${encodeURIComponent("That sign-in link expired. Please try again.")}`);
  const auth = await client().userManagement.authenticateWithCode({
    clientId: process.env.WORKOS_CLIENT_ID, code,
    session: { sealSession: true, cookiePassword: process.env.WORKOS_COOKIE_PASSWORD },
  });
  setSession(res, auth.sealedSession);
  await ensureCustomer(auth.user);
  redirect(res, `${appUrl(req)}${safeReturn(returnTo)}`);
}

export async function signOut(req, res) {
  const sealed = readCookies(req)[SESSION_COOKIE];
  clearSession(res);
  if (!sealed || !authConfigured()) return redirect(res, appHome(req));
  try {
    const session = client().userManagement.loadSealedSession({ sessionData: sealed, cookiePassword: process.env.WORKOS_COOKIE_PASSWORD });
    return redirect(res, await session.getLogoutUrl({ returnTo: appHome(req) }));
  } catch { return redirect(res, appHome(req)); }
}

/* ---------- the signed-in user ---------- */
/** @returns the WorkOS user, or null. Refreshes (and re-sets) the cookie when the access token has expired. */
export async function currentUser(req, res) {
  const sealed = readCookies(req)[SESSION_COOKIE];
  if (!sealed || !authConfigured()) return null;
  const session = client().userManagement.loadSealedSession({ sessionData: sealed, cookiePassword: process.env.WORKOS_COOKIE_PASSWORD });
  const a = await session.authenticate();
  if (a.authenticated) return a.user;
  if (a.reason === "no_session_cookie_provided" || a.reason === "invalid_session_cookie") { clearSession(res); return null; }
  const r = await session.refresh({ cookiePassword: process.env.WORKOS_COOKIE_PASSWORD });
  if (r.authenticated) { setSession(res, r.sealedSession); return r.user; }
  if (!r.retryable) clearSession(res);
  return null;
}

export const isAdminEmail = (email, env = process.env) =>
  (env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean).includes(String(email || "").toLowerCase());

/** Makes sure there's a customers row for this WorkOS user; returns it. */
export async function ensureCustomer(user) {
  const sql = db();
  const rows = await sql`
    insert into customers (id, email, first_name, last_name)
    values (${user.id}, ${user.email}, ${user.firstName || ""}, ${user.lastName || ""})
    on conflict (id) do update set email = excluded.email
    returning *`;
  return rows[0];
}

/**
 * For API handlers: the signed-in user and their customers row, or a 401 sent for you (returns null).
 * { admin: true } also requires an ADMIN_EMAILS account (403 otherwise).
 */
export async function requireUser(req, res, { admin = false } = {}) {
  let user;
  try { user = await currentUser(req, res); }
  catch (e) { console.error("session check failed:", e); user = null; }
  if (!user) { res.status(401).json({ ok: false, error: "Please sign in again", signIn: true }); return null; }
  const isAdmin = isAdminEmail(user.email);
  if (admin && !isAdmin) { res.status(403).json({ ok: false, error: "This page is for Ankor'd staff only" }); return null; }
  const customer = await ensureCustomer(user);
  return { user, customer, isAdmin };
}

/** Shared JSON-handler wrapper: no caching, errors as { ok:false, error }. */
export const handle = fn => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (typeof req.body === "string") { try { req.body = JSON.parse(req.body); } catch { req.body = null; } }
    await fn(req, res);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) res.status(status).json({ ok: false, error: e.message });
  }
};
export const fail = (status, message) => Object.assign(new Error(message), { status });
