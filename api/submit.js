/*
 * POST /api/submit — receives the brief from the Mat Builder, raises a Xero invoice (or quote) for the mats and emails it:
 *   1. to the Ankor'd design team (MAIL_TO) with the render inline + attached, a .csv of every line and the invoice PDF
 *   2. a copy to the store contact (meta.contactEmail) with their invoice attached and a "pay now" link
 * Both are sent from MAIL_FROM through Microsoft Graph (see lib/graph.js). The Xero step (lib/xero.js) is
 * optional – when it isn't configured or fails, the brief still goes out and the team is told to raise it by hand.
 *
 * Abuse protection: per-IP / per-email / global rate limits (lib/ratelimit.js) and a
 * reCAPTCHA v3 check (lib/recaptcha.js) before anything is emailed.
 *
 * Runs as a Vercel serverless function. The handler is tiny on purpose – the same
 * `processSubmission` works from an Azure Function or Express route too.
 */
import { buildBrief } from "../lib/brief.js";
import { sendMail } from "../lib/graph.js";
import { verifyRecaptcha } from "../lib/recaptcha.js";
import { createLimiter, rateLimitError } from "../lib/ratelimit.js";
import { ANKORD_LOGO_PNG } from "../lib/brand.js";
import { docKind, orderProblems, quoteLines, readCustomer, readPricing, readStores, storeLabel } from "../lib/order.js";
import { raiseXeroDocument, xeroConfigured } from "../lib/xero.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMAGE_CHARS = 3_200_000;      // ~2.4 MB decoded; Graph's sendMail request must stay under 4 MB
const DEFAULT_MAILBOX = "marketing@ankord.com.au";

/* Settings come from the environment (.env.local locally, project env vars on Vercel). */
const ENV_NAMES = { MS_TENANT_ID: "MS_DIRECTORY_TENANT_ID", MS_CLIENT_ID: "MS_APPLICATION_CLIENT_ID", MS_CLIENT_SECRET: "MS_APP_CLIENT_SECRET" };
const num = (v, d) => (v !== undefined && v !== "" && !Number.isNaN(Number(v))) ? Number(v) : d;
export function readEnv(env = process.env) {
  const pick = k => env[ENV_NAMES[k]] || env[k] || "";     // preferred name first, short name as a fallback
  const out = {
    MS_TENANT_ID: pick("MS_TENANT_ID"), MS_CLIENT_ID: pick("MS_CLIENT_ID"), MS_CLIENT_SECRET: pick("MS_CLIENT_SECRET"),
    MAIL_FROM: env.MAIL_FROM || DEFAULT_MAILBOX,
    MAIL_TO: (env.MAIL_TO || DEFAULT_MAILBOX).split(",").map(s => s.trim()).filter(Boolean),
    ALLOWED_ORIGIN: env.ALLOWED_ORIGIN || "",
    RECAPTCHA_SECRET_KEY: env.RECAPTCHA_SECRET_KEY || "",
    RECAPTCHA_MIN_SCORE: num(env.RECAPTCHA_MIN_SCORE, 0.5),
    RECAPTCHA_HOSTNAMES: (env.RECAPTCHA_HOSTNAMES || "").split(",").map(s => s.trim()).filter(Boolean),
    // rate limits: submissions per window
    LIMIT_IP: num(env.RATE_LIMIT_IP, 5),            LIMIT_IP_WINDOW: num(env.RATE_LIMIT_IP_WINDOW_SEC, 600),
    LIMIT_EMAIL: num(env.RATE_LIMIT_EMAIL, 3),      LIMIT_EMAIL_WINDOW: num(env.RATE_LIMIT_EMAIL_WINDOW_SEC, 3600),
    LIMIT_GLOBAL: num(env.RATE_LIMIT_GLOBAL, 100),  LIMIT_GLOBAL_WINDOW: num(env.RATE_LIMIT_GLOBAL_WINDOW_SEC, 3600),
    UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    KV_REST_API_URL: env.KV_REST_API_URL, KV_REST_API_TOKEN: env.KV_REST_API_TOKEN,
    PRICING: readPricing(env),
  };
  // Xero settings are passed through as-is (see lib/xero.js and .env.example)
  for (const k of Object.keys(env)) if (k.startsWith("XERO_")) out[k] = env[k];
  const missing = Object.keys(ENV_NAMES).filter(k => !out[k]).map(k => ENV_NAMES[k]);
  if (!out.RECAPTCHA_SECRET_KEY) missing.push("RECAPTCHA_SECRET_KEY");
  if (missing.length) throw Object.assign(new Error(`Email isn't configured yet (missing ${missing.join(", ")})`), { status: 500 });
  return out;
}

function validate(body) {
  const bad = msg => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (!body || typeof body !== "object") bad("No brief received");
  const m = body.meta;
  if (!m || typeof m !== "object") bad("Store details are missing");
  if (!EMAIL_RE.test(String(m.contactEmail || "").trim())) bad("Contact email is missing or invalid");
  const problems = orderProblems(body);
  if (problems.length) bad(problems.join(". "));
  if (!Array.isArray(body.sections) || body.sections.length > 200) bad("Sections are missing or malformed");
  const img = body.image;
  if (img && img.dataUrl) {
    if (typeof img.dataUrl !== "string" || !/^data:image\/(png|jpeg);base64,/.test(img.dataUrl)) bad("Layout image is not a PNG or JPEG");
    if (img.dataUrl.length > MAX_IMAGE_CHARS) bad("Layout image is too large");
  }
}

function imageAttachment(image) {
  if (!image?.dataUrl) return null;
  const [, type, b64] = image.dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/s);
  return { name: `layout.${type === "png" ? "png" : "jpg"}`, contentType: `image/${type}`, contentBytes: b64, isInline: true, contentId: "layout" };
}
const logoAttachment = () => ({ name: "ankord-logo.png", contentType: "image/png", contentBytes: ANKORD_LOGO_PNG, isInline: true, contentId: "ankord-logo" });
const textAttachment = (name, text, contentType) => ({ name, contentType, contentBytes: Buffer.from(text, "utf8").toString("base64") });
const pdfAttachment = doc => doc?.pdf ? { name: `${doc.kind === "invoice" ? "Invoice" : "Quote"} ${doc.number}.pdf`, contentType: "application/pdf", contentBytes: doc.pdf.toString("base64") } : null;

export const clientIp = req => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";

/**
 * Validates, rate-limits, checks reCAPTCHA, then builds and sends both emails.
 * `deps` lets tests swap the network calls.
 * Returns { customerCopy: boolean, order, doc?: Xero document, warning?: string, score?: number }.
 */
export async function processSubmission(body, env, { ip = "unknown", limiter = createLimiter(env), verify = verifyRecaptcha, send = sendMail, raise = raiseXeroDocument } = {}) {
  const byIp = await limiter.hit(`ip:${ip}`, env.LIMIT_IP, env.LIMIT_IP_WINDOW);
  if (!byIp.allowed) throw rateLimitError(byIp.retryAfter);

  validate(body);
  const contact = String(body.meta.contactEmail).trim().toLowerCase();

  const { score } = await verify({ secret: env.RECAPTCHA_SECRET_KEY, token: body.recaptchaToken, ip: ip === "unknown" ? undefined : ip, minScore: env.RECAPTCHA_MIN_SCORE, hostnames: env.RECAPTCHA_HOSTNAMES });

  const byEmail = await limiter.hit(`email:${contact}`, env.LIMIT_EMAIL, env.LIMIT_EMAIL_WINDOW);
  if (!byEmail.allowed) throw rateLimitError(byEmail.retryAfter);
  const global = await limiter.hit("global", env.LIMIT_GLOBAL, env.LIMIT_GLOBAL_WINDOW);
  if (!global.allowed) throw Object.assign(new Error("The builder is unusually busy right now – please try again in a little while"), { status: 429, retryAfter: global.retryAfter });

  const stores = readStores(body);
  const customer = readCustomer(body.meta);
  const order = { stores, customer, quote: quoteLines(stores, env.PRICING) };

  // Raise the invoice / quote before emailing so both emails can carry it. A Xero problem never loses the brief.
  let doc = null, xeroError = null;
  if (xeroConfigured(env)) {
    try { doc = await raise(env, { ...order, reference: `Mat brief – ${stores.map(storeLabel).join(", ")}` }); }
    catch (e) { xeroError = e.message; console.error("xero failed:", e); }
  } else xeroError = "Xero isn't connected yet (XERO_CLIENT_ID / XERO_CLIENT_SECRET not set)";

  const brief = buildBrief(body, { order, doc, xeroError, docKind: docKind(env) });
  const render = imageAttachment(body.image);
  const quotePdf = pdfAttachment(doc);

  await send(env, {
    to: env.MAIL_TO,
    replyTo: [contact],
    subject: brief.subject,
    html: brief.designerHtml,
    attachments: [logoAttachment(), render, textAttachment(`${brief.fileBase}.csv`, brief.csv, "text/csv"), quotePdf].filter(Boolean),
  });

  try {
    await send(env, {
      to: [contact],
      replyTo: [env.MAIL_FROM],
      subject: brief.customerSubject,
      html: brief.customerHtml,
      attachments: [logoAttachment(), render, quotePdf].filter(Boolean),
    });
    return { customerCopy: true, score, order, doc, xeroError };
  } catch (e) {
    // The design team already has the brief; don't fail the whole submission over the courtesy copy.
    return { customerCopy: false, score, order, doc, xeroError, warning: `Copy to ${contact} failed: ${e.message}` };
  }
}

/* What the page shows after submitting: the numbers, the PDF to download and (for invoices) the pay link.
   Whether the customer was already in Xero is deliberately left out. */
export function publicQuote({ order, doc }, env) {
  const q = order.quote;
  return {
    kind: doc?.kind || env.PRICING.document,
    number: doc?.number || null,
    lines: q.lines.map(({ description, qty, unit, amount }) => ({ description, qty, unit, amount })),
    subTotal: doc?.subTotal ?? q.subTotal, gst: doc?.tax ?? q.gst, total: doc?.total ?? q.total, includesGst: q.includesGst,
    pdf: doc?.pdf ? doc.pdf.toString("base64") : null,
    payUrl: doc?.payUrl || null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  let env;
  try { env = readEnv(); } catch (e) { return res.status(e.status || 500).json({ ok: false, error: e.message }); }

  if (env.ALLOWED_ORIGIN) {
    const origin = req.headers.origin || "";
    const allowed = env.ALLOWED_ORIGIN.split(",").map(s => s.trim()).includes(origin);
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return res.status(allowed ? 204 : 403).end();
    if (origin && !allowed) return res.status(403).json({ ok: false, error: "This site isn't allowed to submit briefs" });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }

  try {
    const result = await processSubmission(body, env, { ip: clientIp(req) });
    if (result.warning) console.warn(result.warning);
    return res.status(200).json({ ok: true, customerCopy: result.customerCopy, quote: publicQuote(result, env) });
  } catch (e) {
    const status = e.status || 502;
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    if (status >= 500) console.error("submit failed:", e);
    return res.status(status).json({ ok: false, error: e.message });
  }
}
