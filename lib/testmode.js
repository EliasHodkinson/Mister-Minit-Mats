/**
 * Test mode: orders are saved as normal, but nothing reaches Xero (no contacts, no invoices, no payment checks)
 * and no emails are sent. On by default for Vercel Preview (staging) and local `vercel dev`;
 * set TEST_MODE=true to force it on anywhere, or TEST_MODE=false to turn it off on staging.
 */
export function testMode(env = process.env) {
  const v = env.TEST_MODE;
  if (v === true || v === "true" || v === "1") return true;
  if (v === false || v === "false" || v === "0") return false;
  return env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development";
}
