/* Design summaries and state validation, shared by api/designs.js, api/submit.js and api/admin.js */
import { fail } from "./auth.js";
import { designChanges, matPrice, storeLabel, TEMPLATE_SECTIONS, totalMats } from "../shared/mat.js";

const MAX_STATE_CHARS = 600_000;
export const UUID = /^[0-9a-f-]{36}$/i;

export function summary(d) {
  const st = d.state || {};
  const sections = Array.isArray(st.sections) ? st.sections : [];
  const changes = designChanges(sections, d.base_sections || TEMPLATE_SECTIONS).count;
  return {
    id: d.id, name: d.name, status: d.status, createdAt: d.created_at, updatedAt: d.updated_at,
    isReorder: !!d.base_design_id, baseDesignId: d.base_design_id,
    stores: (st.stores || []).map(s => ({ line1: s.line1, line2: s.line2, qty: s.qty })),
    storeNames: (st.stores || []).map(storeLabel).filter(Boolean).join(", "),
    mats: totalMats(st.stores), changes, matPrice: matPrice(changes),
    step: st.ui?.step ?? 0,
  };
}

export function cleanState(state) {
  if (!state || typeof state !== "object" || !Array.isArray(state.sections) || !Array.isArray(state.stores)) throw fail(400, "That design is malformed");
  if (state.sections.length > 200 || state.stores.length > 50) throw fail(400, "That design is too large");
  const out = { stores: state.stores, sections: state.sections, notes: String(state.notes || "").slice(0, 4000), ui: state.ui && typeof state.ui === "object" ? { step: state.ui.step | 0, done: Array.isArray(state.ui.done) ? state.ui.done.slice(0, 20) : [] } : undefined };
  if (JSON.stringify(out).length > MAX_STATE_CHARS) throw fail(400, "That design is too large");
  return out;
}

