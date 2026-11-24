/*
 * POST /api/submit — a signed-in customer orders one of their draft designs:
 *   1. saves the design as submitted, recounts its changes (against the template, or their previous design for a
 *      reorder) and prices it (shared/mat.js – the page shows the same numbers)
 *   2. records the order in Neon (status "requested") so it shows in their account and the admin view
 *   3. raises a Xero invoice (or quote) against the contact made when they set up their account
 *   4. emails the brief to the Ankor'd design team (render, checklist PDF, .csv, invoice) and the invoice to the customer
 * Xero and email problems never lose the order: it's saved first, and the problem is recorded on it for the admin view.
 *
 * Business details come from the customer's account, not the request.
 */
import { buildBrief } from "../lib/brief.js";
import { checklistPdf } from "../lib/checklist.js";
import { sendMail } from "../lib/graph.js";
import { createLimiter, rateLimitError } from "../lib/ratelimit.js";
import { ANKORD_LOGO_PNG } from "../lib/brand.js";
import { appUrl, fail, requireUser } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { cleanState, UUID } from "../lib/designs.js";
import { customerFromRow, docKind, profileProblems, readPricing, readStores, storeLabel } from "../lib/order.js";
import { raiseXeroDocument, xeroConfigured } from "../lib/xero.js";
import { annotate, COLUMNS, designChanges, HEADER, KIND_NAME, PALETTE, quoteLines, storeProblems, TEMPLATE_SECTIONS } from "../shared/mat.js";

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
    // rate limits: orders per signed-in customer, and overall
    LIMIT_USER: num(env.RATE_LIMIT_USER, 6),        LIMIT_USER_WINDOW: num(env.RATE_LIMIT_USER_WINDOW_SEC, 3600),
    LIMIT_GLOBAL: num(env.RATE_LIMIT_GLOBAL, 100),  LIMIT_GLOBAL_WINDOW: num(env.RATE_LIMIT_GLOBAL_WINDOW_SEC, 3600),
    UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    KV_REST_API_URL: env.KV_REST_API_URL, KV_REST_API_TOKEN: env.KV_REST_API_TOKEN,
    PRICING: readPricing(env),
  };
  for (const k of Object.keys(env)) if (k.startsWith("XERO_")) out[k] = env[k];
  out.mailConfigured = Object.keys(ENV_NAMES).every(k => out[k]);
  return out;
}

function checkImage(img) {
  if (!img?.dataUrl) return null;
  if (typeof img.dataUrl !== "string" || !/^data:image\/(png|jpeg);base64,/.test(img.dataUrl)) throw fail(400, "Layout image is not a PNG or JPEG");
  if (img.dataUrl.length > MAX_IMAGE_CHARS) throw fail(400, "Layout image is too large");
  return img;
}
function imageAttachment(image) {
  if (!image?.dataUrl) return null;
  const [, type, b64] = image.dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/s);
  return { name: `layout.${type === "png" ? "png" : "jpg"}`, contentType: `image/${type}`, contentBytes: b64, isInline: true, contentId: "layout" };
}
const logoAttachment = () => ({ name: "ankord-logo.png", contentType: "image/png", contentBytes: ANKORD_LOGO_PNG, isInline: true, contentId: "ankord-logo" });
const textAttachment = (name, text, contentType) => ({ name, contentType, contentBytes: Buffer.from(text, "utf8").toString("base64") });
const pdfAttachment = doc => doc?.pdf ? { name: `${doc.kind === "invoice" ? "Invoice" : "Quote"} ${doc.number}.pdf`, contentType: "application/pdf", contentBytes: doc.pdf.toString("base64") } : null;

/** The brief in the shape lib/brief.js and lib/checklist.js read */
export function briefPayload({ state, customer, changes, sections, submittedAt, image, orderNumber }) {
  return {
    meta: { ...HEADER, notes: state.notes || "", contactEmail: customer.email },
    customer, orderNumber,
    stores: readStores(state),
    sections, changes: changes.list.map(c => c.text), changeCount: changes.count,
    lookup: { columns: COLUMNS.map(([key, name, theme]) => ({ key, name, theme })), colors: Object.fromEntries(Object.entries(PALETTE).map(([k, p]) => [k, p.name])), kinds: KIND_NAME },
    template: "Mister Minit Mat-CMYK-Outlined.pdf",
    submittedAt, image,
  };
}

/**
 * Everything after the checks: price, record, invoice, email.
 * `deps` lets tests swap the database and network calls.
 */
export async function processOrder({ customerRow, design, state, image }, env, { sql, send = sendMail, raise = raiseXeroDocument, accountUrl = "" }) {
  const customer = customerFromRow(customerRow);
  const stores = readStores(state);
  const base = design.base_sections || TEMPLATE_SECTIONS;
  const changes = designChanges(state.sections, base);
  const isReorder = !!design.base_design_id;
  const quote = quoteLines(stores, env.PRICING, { changeCount: changes.count, isReorder });
  const sections = annotate(state.sections, base);
  const submittedAt = new Date().toISOString();
  const snapshot = { stores, sections, changes: changes.list.map(c => c.text), notes: state.notes || "", baseDesignId: design.base_design_id || null };

  // 1. the order, before anything that can fail outside our control
  const history = [{ status: "requested", at: submittedAt, by: customer.email, note: "Order placed" }];
  const [order] = await sql`
    insert into orders (customer_id, design_id, status, snapshot, customer, change_count, is_reorder, quote, total, history)
    values (${customerRow.id}, ${design.id}, 'requested', ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(customer)}::jsonb,
            ${changes.count}, ${isReorder}, ${JSON.stringify(quote)}::jsonb, ${quote.total}, ${JSON.stringify(history)}::jsonb)
    returning *`;
  await sql`update designs set state = ${JSON.stringify(state)}::jsonb, status = 'ordered',
    name = ${stores.map(storeLabel).join(", ").slice(0, 120) || design.name}, updated_at = now() where id = ${design.id}`;

  // 2. Xero
  let doc = null, xeroError = null;
  if (xeroConfigured(env)) {
    try {
      doc = await raise(env, { customer, stores, quote, contactId: customerRow.xero_contact_id, reference: `${order.number} – Mat brief – ${stores.map(storeLabel).join(", ")}` });
      if (!customerRow.xero_contact_id && doc.contact?.contactId) await sql`update customers set xero_contact_id = ${doc.contact.contactId}, xero_error = null where id = ${customerRow.id}`;
    } catch (e) { xeroError = e.message; console.error("xero failed:", e); }
  } else xeroError = "Xero isn't connected (XERO_CLIENT_ID / XERO_CLIENT_SECRET not set)";
  await sql`update orders set xero_kind = ${doc?.kind || null}, xero_id = ${doc?.id || null}, xero_number = ${doc?.number || null},
    pay_url = ${doc?.payUrl || null}, due_date = ${doc?.due || null}, total = ${doc?.total ?? quote.total}, xero_error = ${xeroError}, updated_at = now()
    where id = ${order.id}`;

  // 3. emails
  const payload = briefPayload({ state, customer, changes, sections, submittedAt, image, orderNumber: order.number });
  const extra = { order: { stores, customer, quote, number: order.number }, doc, xeroError, docKind: docKind(env), accountUrl: accountUrl ? accountUrl + order.id : "" };
  const emailErrors = [];
  let customerCopy = false;
  if (!env.mailConfigured) emailErrors.push("Email isn't configured (MS_* settings missing)");
  else {
    const brief = buildBrief(payload, extra);
    const render = imageAttachment(image), invoicePdf = pdfAttachment(doc);
    let checklist = null;
    try { checklist = { name: brief.checklistName, contentType: "application/pdf", contentBytes: (await checklistPdf(payload, extra)).toString("base64") }; }
    catch (e) { console.error("checklist pdf failed:", e); }
    try {
      await send(env, { to: env.MAIL_TO, replyTo: [customer.email], subject: brief.subject, html: brief.designerHtml,
        attachments: [logoAttachment(), render, checklist, textAttachment(`${brief.fileBase}.csv`, brief.csv, "text/csv"), invoicePdf].filter(Boolean) });
    } catch (e) { emailErrors.push(`Design team email failed: ${e.message}`); console.error(e); }
    try {
      await send(env, { to: [customer.email], replyTo: [env.MAIL_FROM], subject: brief.customerSubject, html: brief.customerHtml,
        attachments: [logoAttachment(), render, invoicePdf].filter(Boolean) });
      customerCopy = true;
    } catch (e) { emailErrors.push(`Customer email failed: ${e.message}`); console.error(e); }
  }
  if (emailErrors.length) await sql`update orders set email_error = ${emailErrors.join(" · ")} where id = ${order.id}`;

  return { order, doc, quote, changes, xeroError, customerCopy };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw fail(405, "Method not allowed");
    const who = await requireUser(req, res); if (!who) return;
    const env = readEnv();
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || !UUID.test(String(body.designId || ""))) throw fail(400, "Which design are you ordering?");

    const limiter = createLimiter(env);
    const mine = await limiter.hit(`user:${who.customer.id}`, env.LIMIT_USER, env.LIMIT_USER_WINDOW);
    if (!mine.allowed) throw rateLimitError(mine.retryAfter);
    const global = await limiter.hit("global", env.LIMIT_GLOBAL, env.LIMIT_GLOBAL_WINDOW);
    if (!global.allowed) throw Object.assign(new Error("The builder is unusually busy right now – please try again in a little while"), { status: 429, retryAfter: global.retryAfter });

    const sql = db();
    if (!who.customer.onboarded_at) throw fail(400, "Add your business details first");
    const problems = profileProblems(customerFromRow(who.customer));
    if (problems.length) throw fail(400, "Your business details are incomplete – update them in your account");

    const [design] = await sql`select * from designs where id = ${body.designId} and customer_id = ${who.customer.id}`;
    if (!design) throw fail(404, "Design not found");
    if (design.status !== "draft") throw fail(409, "This design has already been ordered");
    const state = cleanState(body.state);
    const storeErr = storeProblems(state.stores);
    if (storeErr.length) throw fail(400, storeErr.join(". "));
    const image = checkImage(body.image);

    const r = await processOrder({ customerRow: who.customer, design, state, image }, env, { sql, accountUrl: `${appUrl(req)}/misterminit/#/orders/` });
    const d = r.doc;
    return res.status(200).json({ ok: true, customerCopy: r.customerCopy, order: {
      id: r.order.id, number: r.order.number, total: d?.total ?? r.quote.total, changeCount: r.changes.count,
      invoice: d ? { kind: d.kind, number: d.number, payUrl: d.payUrl, due: d.due, pdf: d.pdf ? d.pdf.toString("base64") : null } : null,
      xeroProblem: !!r.xeroError,
    } });
  } catch (e) {
    const status = e.status || 502;
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    if (status >= 500) console.error("submit failed:", e);
    return res.status(status).json({ ok: false, error: e.message });
  }
}
