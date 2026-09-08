/*
 * POST /api/submit — receives the brief from the Mat Builder and emails it:
 *   1. to the design team (MAIL_TO) with the render, tables, and .txt / .csv / .json attachments
 *   2. a copy to the store contact (meta.contactEmail)
 * Both are sent from MAIL_FROM through Microsoft Graph (see lib/graph.js).
 *
 * Runs as a Vercel serverless function. The handler is tiny on purpose – the same
 * `processSubmission` works from an Azure Function or Express route too.
 */
import { buildBrief } from "../lib/brief.js";
import { sendMail } from "../lib/graph.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMAGE_CHARS = 3_200_000;      // ~2.4 MB decoded; Graph's sendMail request must stay under 4 MB
const DEFAULT_MAILBOX = "marketing@ankord.com.au";

/* Settings come from the environment (.env.local locally, project env vars on Vercel). */
const ENV_NAMES = { MS_TENANT_ID: "MS_DIRECTORY_TENANT_ID", MS_CLIENT_ID: "MS_APPLICATION_CLIENT_ID", MS_CLIENT_SECRET: "MS_APP_CLIENT_SECRET" };
function readEnv(env = process.env) {
  const pick = k => env[ENV_NAMES[k]] || env[k] || "";     // preferred name first, short name as a fallback
  const out = {
    MS_TENANT_ID: pick("MS_TENANT_ID"), MS_CLIENT_ID: pick("MS_CLIENT_ID"), MS_CLIENT_SECRET: pick("MS_CLIENT_SECRET"),
    MAIL_FROM: env.MAIL_FROM || DEFAULT_MAILBOX,
    MAIL_TO: (env.MAIL_TO || DEFAULT_MAILBOX).split(",").map(s => s.trim()).filter(Boolean),
    ALLOWED_ORIGIN: env.ALLOWED_ORIGIN || "",
  };
  const missing = Object.keys(ENV_NAMES).filter(k => !out[k]).map(k => ENV_NAMES[k]);
  if (missing.length) throw Object.assign(new Error(`Email isn't configured yet (missing ${missing.join(", ")})`), { status: 500 });
  return out;
}

function validate(body) {
  const bad = msg => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (!body || typeof body !== "object") bad("No brief received");
  const m = body.meta;
  if (!m || typeof m !== "object") bad("Store details are missing");
  if (!String(m.store1 || "").trim()) bad("Store name is missing");
  if (!EMAIL_RE.test(String(m.contactEmail || "").trim())) bad("Contact email is missing or invalid");
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
const textAttachment = (name, text, contentType) => ({ name, contentType, contentBytes: Buffer.from(text, "utf8").toString("base64") });

/** Builds and sends both emails. Returns { customerCopy: boolean, warning?: string }. */
export async function processSubmission(body, env) {
  validate(body);
  const brief = buildBrief(body);
  const render = imageAttachment(body.image);
  const contact = String(body.meta.contactEmail).trim();

  await sendMail(env, {
    to: env.MAIL_TO,
    replyTo: [contact],
    subject: brief.subject,
    html: brief.designerHtml,
    attachments: [
      render,
      textAttachment(`${brief.fileBase}.txt`, brief.text, "text/plain"),
      textAttachment(`${brief.fileBase}.csv`, brief.csv, "text/csv"),
      textAttachment(`${brief.fileBase}.json`, brief.json, "application/json"),
    ].filter(Boolean),
  });

  try {
    await sendMail(env, {
      to: [contact],
      replyTo: [env.MAIL_FROM],
      subject: brief.customerSubject,
      html: brief.customerHtml,
      attachments: [render].filter(Boolean),
    });
    return { customerCopy: true };
  } catch (e) {
    // The design team already has the brief; don't fail the whole submission over the courtesy copy.
    return { customerCopy: false, warning: `Copy to ${contact} failed: ${e.message}` };
  }
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
    const result = await processSubmission(body, env);
    if (result.warning) console.warn(result.warning);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 502;
    if (status >= 500) console.error("submit failed:", e);
    return res.status(status).json({ ok: false, error: e.message });
  }
}
