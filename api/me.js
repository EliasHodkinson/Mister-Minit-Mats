/*
 * /misterminit/api/me
 *   GET → who's signed in: { user, profile, onboarded, isAdmin } (401 when signed out)
 *   PUT → save the business details (first sign-in onboarding, or editing them later). On the first save the
 *         customer is found or created in Xero (by ABN, then email, then name) and the contact id is kept, so every
 *         invoice goes to the same contact. A Xero problem never blocks the save; it's retried on the first order.
 */
import { handle, requireUser, fail } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { profileProblems, readProfile } from "../lib/order.js";
import { profileJson } from "../lib/profile.js";
import { findOrCreateContact, xeroConfigured } from "../lib/xero.js";
import { testMode } from "../lib/testmode.js";

export default handle(async (req, res) => {
  const who = await requireUser(req, res); if (!who) return;
  const { user, customer, isAdmin } = who;
  const sql = db();
  const reply = row => res.status(200).json({ testMode: testMode(),
    ok: true, isAdmin,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, emailVerified: user.emailVerified },
    profile: profileJson(row), onboarded: !!row.onboarded_at,
  });

  if (req.method === "GET") return reply(customer);
  if (req.method !== "PUT") throw fail(405, "Method not allowed");

  const p = readProfile(req.body || {}, user.email);
  const problems = profileProblems(p);
  if (problems.length) return res.status(400).json({ ok: false, error: "Some details need another look", problems });

  let [row] = await sql`
    update customers set
      first_name = ${p.firstName}, last_name = ${p.lastName}, legal_name = ${p.legalName}, trading_name = ${p.tradingName},
      abn = ${p.abn}, phone = ${p.phone}, billing = ${JSON.stringify(p.billing)}::jsonb, delivery_same = ${p.sameDelivery},
      delivery = ${JSON.stringify(p.sameDelivery ? {} : p.delivery)}::jsonb,
      onboarded_at = coalesce(onboarded_at, now()), updated_at = now()
    where id = ${user.id} returning *`;

  if (!row.xero_contact_id && xeroConfigured(process.env)) {
    try {
      const contact = await findOrCreateContact(process.env, p);
      [row] = await sql`update customers set xero_contact_id = ${contact.contactId}, xero_error = null where id = ${user.id} returning *`;
    } catch (e) {
      console.error("xero contact failed:", e);
      [row] = await sql`update customers set xero_error = ${e.message} where id = ${user.id} returning *`;
    }
  }
  return reply(row);
});
