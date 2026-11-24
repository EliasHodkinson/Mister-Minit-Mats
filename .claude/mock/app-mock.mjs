// Local mock of the customer API for UI checks only (no WorkOS / Neon / Xero). Not deployed.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TEMPLATE_SECTIONS, clone, newDesignState, designChanges, quoteLines, statusInfo } from "../../shared/mat.js";
import { summary, cleanState } from "../../lib/designs.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const PORT = +process.env.PORT || 8790;
const profile = { email: "test@example.com", firstName: "Sam", lastName: "Lee", legalName: "Lee Family Holdings Pty Ltd", tradingName: "Mister Minit Penrith", abn: "51 824 753 556", phone: "0400 000 000", billing: { street: "1 High St", suburb: "Penrith", state: "NSW", postcode: "2750" }, deliverySame: true, delivery: {}, onboarded: true, xeroLinked: true };
const designs = new Map(), orders = [];
const row = d => d;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"); let p = u.pathname;
  let body = ""; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  if (p.startsWith("/misterminit/api/")) {
    const fn = p.split("/")[3], id = u.searchParams.get("id");
    if (fn === "me") return send(res, 200, { ok: true, isAdmin: true, user: { id: "u1", email: profile.email, firstName: "Sam", lastName: "Lee" }, profile, onboarded: true });
    if (fn === "pricing") return send(res, 200, { ok: true, freight: 25 });
    if (fn === "designs") {
      if (req.method === "GET" && !id) return send(res, 200, { ok: true, designs: [...designs.values()].map(summary) });
      if (req.method === "GET") { const d = designs.get(id); return d ? send(res, 200, { ok: true, design: { ...summary(d), state: d.state, baseSections: d.base_sections } }) : send(res, 404, { ok: false, error: "Not found" }); }
      if (req.method === "POST") {
        const src = body.reorder && designs.get(body.reorder);
        const d = { id: randomUUID(), customer_id: "u1", name: src ? "Reorder" : "New mat", status: "draft", state: src ? { ...clone(src.state), ui: { step: 0, done: [] } } : newDesignState(clone(TEMPLATE_SECTIONS)), base_design_id: src?.id || null, base_sections: src ? clone(src.state.sections) : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        designs.set(d.id, d); return send(res, 200, { ok: true, design: summary(d) });
      }
      if (req.method === "PUT") { const d = designs.get(id); d.state = cleanState(body.state); d.updated_at = new Date().toISOString(); return send(res, 200, { ok: true, design: summary(d) }); }
      if (req.method === "DELETE") { designs.delete(id); return send(res, 200, { ok: true }); }
    }
    if (fn === "orders") {
      const j = o => ({ ...o, statusLabel: statusInfo(o.status).label });
      if (id) return send(res, 200, { ok: true, order: j(orders.find(o => o.id === id)) });
      return send(res, 200, { ok: true, orders: orders.map(j) });
    }
    if (fn === "submit") {
      const d = designs.get(body.designId), ch = designChanges(body.state.sections, d.base_sections || TEMPLATE_SECTIONS);
      const quote = quoteLines(body.state.stores, {}, { changeCount: ch.count, isReorder: !!d.base_design_id });
      d.state = body.state; d.status = "ordered";
      const o = { id: randomUUID(), number: "MM-" + (1001 + orders.length), status: "requested", createdAt: new Date().toISOString(), designId: d.id, stores: body.state.stores, storeNames: body.state.stores.map(s => s.line1).join(", "), mats: quote.mats, changeCount: ch.count, isReorder: !!d.base_design_id, total: quote.total, quote, invoice: { kind: "invoice", number: "INV-0" + (200 + orders.length), payUrl: "https://example.com/pay", due: "2026-12-08" }, tracking: "", history: [{ status: "requested", label: "Requested", at: new Date().toISOString() }], sections: body.state.sections, changes: ch.list.map(c => c.text), notes: body.state.notes, imageBytes: body.image?.dataUrl?.length || 0 };
      orders.unshift(o);
      await new Promise(r => setTimeout(r, 1500));
      return send(res, 200, { ok: true, customerCopy: true, order: { id: o.id, number: o.number, total: o.total, changeCount: o.changeCount, invoice: o.invoice } });
    }
    return send(res, 404, { ok: false, error: "no mock" });
  }
  if (p === "/" || p === "/misterminit" || p === "/misterminit/") p = "/index.html";
  else if (p === "/misterminit/admin") p = "/admin.html";
  else p = p.replace(/^\/misterminit/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" }); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log("mock on " + PORT));
