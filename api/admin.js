/*
 * /misterminit/api/admin – Ankor'd staff only (ADMIN_EMAILS)
 *   GET ?view=orders[&status=][&q=]  → every order, newest first (paid invoices are picked up from Xero)
 *   GET ?view=order&id=              → one order: customer, configuration, changes, history
 *   GET ?view=customers[&q=]         → every customer with their order count and spend
 *   GET ?view=customer&id=           → one customer with their designs and orders
 *   PATCH ?id=                       → { status?, note?, tracking?, adminNote? } update an order (status changes are logged)
 */
import { handle, requireUser, fail } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { summary, UUID } from "../lib/designs.js";
import { orderJson, syncPayments } from "../lib/orders.js";
import { profileJson } from "../lib/profile.js";
import { isStatus, STATUSES, CANCELLED } from "../shared/mat.js";

const like = q => `%${String(q).replace(/[%_\\]/g, m => "\\" + m)}%`;

export default handle(async (req, res) => {
  const who = await requireUser(req, res, { admin: true }); if (!who) return;
  const sql = db(), q = req.query || {};

  if (req.method === "GET") {
    if (q.view === "orders" || !q.view) {
      const status = isStatus(q.status) ? q.status : null, search = q.q ? like(q.q) : null;
      let rows = await sql`
        select * from orders
        where (${status}::text is null or status = ${status})
          and (${search}::text is null or number ilike ${search} or customer->>'tradingName' ilike ${search}
               or customer->>'legalName' ilike ${search} or customer->>'email' ilike ${search} or snapshot::text ilike ${search})
        order by created_at desc limit 500`;
      rows = await syncPayments(sql, rows);
      const counts = await sql`select status, count(*)::int as n from orders group by status`;
      return res.status(200).json({ ok: true, orders: rows.map(o => orderJson(o, { admin: true })), counts: Object.fromEntries(counts.map(c => [c.status, c.n])),
        statuses: [...STATUSES, CANCELLED] });
    }
    if (q.view === "order") {
      if (!UUID.test(String(q.id || ""))) throw fail(404, "Order not found");
      let rows = await sql`select * from orders where id = ${q.id}`;
      if (!rows.length) throw fail(404, "Order not found");
      rows = await syncPayments(sql, rows);
      const [c] = await sql`select * from customers where id = ${rows[0].customer_id}`;
      return res.status(200).json({ ok: true, order: orderJson(rows[0], { full: true, admin: true }), account: c ? { id: c.id, ...profileJson(c), xeroContactId: c.xero_contact_id, xeroError: c.xero_error, createdAt: c.created_at } : null,
        statuses: [...STATUSES, CANCELLED] });
    }
    if (q.view === "customers") {
      const search = q.q ? like(q.q) : null;
      const rows = await sql`
        select c.*, count(o.id)::int as order_count, coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)::float as spend, max(o.created_at) as last_order
        from customers c left join orders o on o.customer_id = c.id
        where (${search}::text is null or c.email ilike ${search} or c.trading_name ilike ${search} or c.legal_name ilike ${search} or c.abn ilike ${search})
        group by c.id order by coalesce(max(o.created_at), c.created_at) desc limit 500`;
      return res.status(200).json({ ok: true, customers: rows.map(c => ({ id: c.id, ...profileJson(c), xeroContactId: c.xero_contact_id, xeroError: c.xero_error,
        createdAt: c.created_at, orderCount: c.order_count, spend: c.spend, lastOrder: c.last_order })) });
    }
    if (q.view === "customer") {
      const [c] = await sql`select * from customers where id = ${String(q.id || "")}`;
      if (!c) throw fail(404, "Customer not found");
      const designs = await sql`select * from designs where customer_id = ${c.id} order by updated_at desc`;
      const orders = await sql`select * from orders where customer_id = ${c.id} order by created_at desc`;
      return res.status(200).json({ ok: true, customer: { id: c.id, ...profileJson(c), xeroContactId: c.xero_contact_id, xeroError: c.xero_error, createdAt: c.created_at },
        designs: designs.map(summary), orders: orders.map(o => orderJson(o, { admin: true })) });
    }
    throw fail(404, "Unknown view");
  }

  if (req.method === "PATCH") {
    if (!UUID.test(String(q.id || ""))) throw fail(404, "Order not found");
    const b = req.body || {};
    const [o] = await sql`select * from orders where id = ${q.id}`;
    if (!o) throw fail(404, "Order not found");
    let status = o.status, history = o.history || [];
    if (b.status !== undefined && b.status !== o.status) {
      if (!isStatus(b.status)) throw fail(400, "Unknown status");
      status = b.status;
      history = [...history, { status, at: new Date().toISOString(), by: who.user.email, note: String(b.note || "").slice(0, 500) }];
    } else if (String(b.note || "").trim()) {
      // a note on its own: logged for staff, kept out of the customer's timeline
      history = [...history, { status, at: new Date().toISOString(), by: who.user.email, note: String(b.note).trim().slice(0, 500), noteOnly: true }];
    }
    const tracking = b.tracking !== undefined ? String(b.tracking).slice(0, 300) : o.tracking;
    const adminNote = b.adminNote !== undefined ? String(b.adminNote).slice(0, 4000) : o.admin_note;
    const [u] = await sql`update orders set status = ${status}, history = ${JSON.stringify(history)}::jsonb, tracking = ${tracking},
      admin_note = ${adminNote}, updated_at = now() where id = ${o.id} returning *`;
    return res.status(200).json({ ok: true, order: orderJson(u, { full: true, admin: true }) });
  }
  throw fail(405, "Method not allowed");
});
