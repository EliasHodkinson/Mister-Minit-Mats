/*
 * Neon (serverless Postgres over HTTP). DATABASE_URL is the pooled connection string of the Neon branch for this
 * Vercel environment (production → main, preview → staging). Schema: db/schema.sql, applied by scripts/migrate.js.
 */
import { neon } from "@neondatabase/serverless";

let client = null;
export function db(env = process.env) {
  if (!env.DATABASE_URL) throw Object.assign(new Error("The database isn't configured yet (DATABASE_URL)"), { status: 500 });
  return client ||= neon(env.DATABASE_URL);
}
