/* Orders as the pages see them, and moving paid invoices along from "requested" to "paid". */
import { statusInfo } from "../shared/mat.js";
import { invoiceStatuses, xeroConfigured } from "./xero.js";

/** full: include the brief snapshot (sections, changes) for the order page / admin view */
export function orderJson(o, { full = false, admin = false } = {}) {
  const snap = o.snapshot || {};
  const out = {
    id: o.id, number: o.number, status: o.status, statusLabel: statusInfo(o.status).label,
    createdAt: o.created_at, updatedAt: o.updated_at, designId: o.design_id,
    stores: snap.stores || [], storeNames: (snap.stores || []).map(s => [s.line1, s.line2].filter(Boolean).join(" ")).join(", "),
    mats: o.quote?.mats ?? 0, changeCount: o.change_count, isReorder: o.is_reorder,
    total: Number(o.total), quote: o.quote,
    invoice: o.xero_number ? { kind: o.xero_kind, number: o.xero_number, payUrl: o.pay_url, due: o.due_date } : null,
    tracking: o.tracking || "",
    history: (o.history || []).filter(h => !h.noteOnly).map(h => ({ status: h.status, label: statusInfo(h.status).label, at: h.at, note: h.note || "" })),
  };
  if (full) Object.assign(out, { sections: snap.sections || [], changes: snap.changes || [], notes: snap.notes || "" });
  if (admin) Object.assign(out, {
    customer: o.customer, customerId: o.customer_id, adminNote: o.admin_note || "",
    xeroError: o.xero_error, emailError: o.email_error, xeroId: o.xero_id,
    history: (o.history || []).map(h => ({ ...h, label: statusInfo(h.status).label })),
    customerName: o.customer?.tradingName || o.customer?.legalName || "",
  });
  return out;
}

/**
 * Checks Xero for "requested" orders whose invoice has since been paid and marks them paid.
 * Best effort: a Xero problem is logged and the orders are returned as they were.
 * @returns the rows, with any that changed replaced by their updated version
 */
export async function syncPayments(sql, rows, env = process.env) {
  const waiting = rows.filter(o => o.status === "requested" && o.xero_kind === "invoice" && o.xero_id);
  if (!waiting.length || !xeroConfigured(env)) return rows;
  try {
    const st = await invoiceStatuses(env, waiting.map(o => o.xero_id));
    const paid = waiting.filter(o => st.get(o.xero_id)?.status === "PAID");
    const updated = new Map();
    for (const o of paid) {
      const entry = { status: "paid", at: new Date().toISOString(), by: "Xero", note: "Invoice paid" };
      const [u] = await sql`update orders set status = 'paid', history = history || ${JSON.stringify([entry])}::jsonb, updated_at = now()
        where id = ${o.id} and status = 'requested' returning *`;
      if (u) updated.set(u.id, u);
    }
    return rows.map(o => updated.get(o.id) || o);
  } catch (e) {
    console.warn("payment sync failed:", e.message);
    return rows;
  }
}
