/*
 * Applies db/schema.sql to the database in DATABASE_URL. Every statement is idempotent, so it's safe to re-run.
 *   node --env-file=.env.local scripts/migrate.js
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL first"); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const text = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
const statements = text.split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
for (const s of statements) {
  await sql.query(s);
  console.log("✓", s.split("\n")[0].slice(0, 80));
}
console.log(`Applied ${statements.length} statements.`);
