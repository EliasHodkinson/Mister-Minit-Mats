/*
 * Prints an existing Xero quote (default QU-0003) with the settings the builder needs to copy it:
 * account codes, tax types, item codes, branding theme and terms. Read-only.
 * For the web app, connect Xero first (/misterminit/api/xero/connect) and have the KV_* / UPSTASH_* store
 * variables in .env.local (`vercel env pull .env.local`).
 *
 *   node --env-file=.env.local scripts/xero-inspect.js QU-0003
 */
import { getXeroToken } from "../lib/xero.js";

const number = process.argv[2] || "QU-0003";
const env = process.env;
if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) { console.error("Set XERO_CLIENT_ID and XERO_CLIENT_SECRET first (e.g. in .env.local)"); process.exit(1); }

const get = async path => {
  const { token, tenantId } = await getXeroToken(env);
  const r = await fetch("https://api.xero.com/api.xro/2.0" + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(tenantId ? { "Xero-tenant-id": tenantId } : {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${d.Detail || d.Message || d.Title || r.status}`);
  return d;
};

const org = (await get("/Organisation")).Organisations?.[0];
console.log(`Connected to: ${org?.Name} (${org?.CountryCode})\n`);

const quote = (await get(`/Quotes?QuoteNumber=${encodeURIComponent(number)}`)).Quotes?.[0];
if (!quote) { console.error(`No quote numbered ${number}`); process.exit(1); }
console.log(`${quote.QuoteNumber} · ${quote.Contact?.Name} · ${quote.Status} · amounts ${quote.LineAmountTypes} · total ${quote.Total}`);
console.log(`Title:   ${quote.Title || "-"}\nSummary: ${quote.Summary || "-"}\nTerms:   ${quote.Terms || "-"}\nBranding theme: ${quote.BrandingThemeID || "-"}\n`);
console.table(quote.LineItems.map(l => ({ Description: l.Description, Qty: l.Quantity, Unit: l.UnitAmount, ItemCode: l.ItemCode || "", AccountCode: l.AccountCode, TaxType: l.TaxType })));

const themes = (await get("/BrandingThemes")).BrandingThemes || [];
console.log("\nBranding themes:"); for (const t of themes) console.log(`  ${t.BrandingThemeID}  ${t.Name}`);
