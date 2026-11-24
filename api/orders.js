/*
 * /misterminit/api/orders – the signed-in customer's orders
 *   GET        → list, newest first (invoices paid in Xero move to "Paid" as they're listed)
 *   GET ?id=   → one order with what was ordered (sections, changes) and its status history
 */
import { handle, requireUser, fail } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { UUID } from "../lib/designs.js";
import { orderJson, syncPayments } from "../lib/orders.js";

export default handle(async (req, res) => {
  if (req.method !== "GET") throw fail(405, "Method not allowed");
  const who = await requireUser(req, res); if (!who) return;
  const sql = db(), me = who.customer.id, id = req.query?.id;
  if (id) {
    if (!UUID.test(id)) throw fail(404, "Order not found");
    let rows = await sql`select * from orders where id = ${id} and customer_id = ${me}`;
    if (!rows.length) throw fail(404, "Order not found");
    rows = await syncPayments(sql, rows);
    return res.status(200).json({ ok: true, order: orderJson(rows[0], { full: true }) });
  }
  let rows = await sql`select * from orders where customer_id = ${me} order by created_at desc limit 200`;
  rows = await syncPayments(sql, rows);
  return res.status(200).json({ ok: true, orders: rows.map(o => orderJson(o)) });
});
