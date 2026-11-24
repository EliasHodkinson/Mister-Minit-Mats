/*
 * /misterminit/api/designs – the signed-in customer's mat designs (drafts and ordered designs)
 *   GET            → list, newest first, with a summary (stores, mats, changes, price)
 *   GET ?id=       → one design with its full state and what it started from
 *   POST           → { from: "template" } a new draft from the template
 *                    { reorder: <designId> } a draft that starts from an ordered design (changes priced against it)
 *   PUT ?id=       → { state, name? } save a draft (autosave)
 *   DELETE ?id=    → delete a draft
 */
import { handle, requireUser, fail } from "../lib/auth.js";
import { db } from "../lib/db.js";
import { clone, newDesignState, storeLabel } from "../shared/mat.js";
import { cleanState, summary, UUID } from "../lib/designs.js";

export default handle(async (req, res) => {
  const who = await requireUser(req, res); if (!who) return;
  const me = who.customer.id, sql = db();
  const id = req.query?.id;
  if (id && !UUID.test(id)) throw fail(404, "Design not found");

  if (req.method === "GET" && !id) {
    const rows = await sql`select * from designs where customer_id = ${me} order by updated_at desc limit 200`;
    return res.status(200).json({ ok: true, designs: rows.map(summary) });
  }
  if (req.method === "GET") {
    const [d] = await sql`select * from designs where id = ${id} and customer_id = ${me}`;
    if (!d) throw fail(404, "Design not found");
    return res.status(200).json({ ok: true, design: { ...summary(d), state: d.state, baseSections: d.base_sections } });
  }
  if (req.method === "POST") {
    const b = req.body || {};
    let state = newDesignState(), base = null, baseId = null, name = "New mat design";
    if (b.reorder) {
      if (!UUID.test(b.reorder)) throw fail(404, "Design not found");
      const [src] = await sql`select * from designs where id = ${b.reorder} and customer_id = ${me}`;
      if (!src) throw fail(404, "Design not found");
      if (src.status !== "ordered") throw fail(400, "Only a design you've ordered can be reordered");
      state = { stores: clone(src.state.stores || []), sections: clone(src.state.sections || []), notes: "" };
      base = clone(src.state.sections || []); baseId = src.id;
      name = `Reorder – ${(src.state.stores || []).map(storeLabel).filter(Boolean).join(", ") || src.name}`;
    }
    state.ui = { step: 0, done: [] };
    const [d] = await sql`
      insert into designs (customer_id, name, status, state, base_design_id, base_sections)
      values (${me}, ${name.slice(0, 120)}, 'draft', ${JSON.stringify(state)}::jsonb, ${baseId}, ${base ? JSON.stringify(base) : null}::jsonb)
      returning *`;
    return res.status(201).json({ ok: true, design: { ...summary(d), state: d.state, baseSections: d.base_sections } });
  }
  if (req.method === "PUT") {
    if (!id) throw fail(400, "Which design?");
    const state = cleanState(req.body?.state);
    const name = String(req.body?.name || state.stores.map(storeLabel).filter(Boolean).join(", ") || "New mat design").slice(0, 120);
    const [d] = await sql`
      update designs set state = ${JSON.stringify(state)}::jsonb, name = ${name}, updated_at = now()
      where id = ${id} and customer_id = ${me} and status = 'draft' returning *`;
    if (!d) throw fail(409, "This design has already been ordered. Start a reorder to change it.");
    return res.status(200).json({ ok: true, design: summary(d) });
  }
  if (req.method === "DELETE") {
    const rows = await sql`delete from designs where id = ${id} and customer_id = ${me} and status = 'draft' returning id`;
    if (!rows.length) throw fail(404, "Draft not found");
    return res.status(200).json({ ok: true });
  }
  throw fail(405, "Method not allowed");
});

