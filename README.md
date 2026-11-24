# Mister Minit Mat Builder

Store owners sign in, enter their business details once, then build their price mat step by step:
stores → each part of the mat → review & order. Ordering saves the order to their account, raises a
**Xero invoice** and emails the brief to the Ankor'd design team (and a copy with the invoice to the store)
from **marketing@ankord.com.au** via Microsoft 365. Staff follow and update every order at
**/misterminit/admin**.

```
index.html          customer app shell (no build step, ES modules)
assets/app.js       sign-in landing, onboarding, My mats, account, order tracking (hash routes)
assets/builder.js   the guided builder: drag & drop (SortableJS), autosaved drafts, live pricing
admin.html          staff dashboard shell → assets/admin.js / admin.css
assets/*.css        base.css (tokens + components), app.css, mat.css (the mat render), admin.css
shared/mat.js       used by browser AND server: template, change counting, price tiers, statuses, mat render
api/auth.js         WorkOS AuthKit sign-in / callback / sign-out (sealed-session cookie)
api/me.js           the signed-in account + business details (creates the Xero contact on first save)
api/designs.js      drafts and ordered designs (create from template or as a reorder, autosave, delete)
api/orders.js       the customer's orders (marks invoices paid in Xero as "Paid")
api/submit.js       place an order: recount changes → price → save → Xero invoice → emails
api/admin.js        staff only: all orders and customers, status / tracking / notes updates
api/pricing.js      freight / GST settings and the price tiers
api/xero.js         one-time Xero connect / callback, status, and the daily keep-alive cron
lib/                auth, db (Neon), orders, designs, profile, xero, brief + checklist emails, graph mail
db/schema.sql       Postgres schema (customers, designs, orders) – apply with scripts/migrate.js
tests/              node --test
```

## Accounts (WorkOS AuthKit)

Sign-in uses **WorkOS AuthKit** (free tier: email + password, magic code, Google/Microsoft sign-in) in its
own WorkOS project, **Mister Minit Mats**, so nothing is shared with other WorkOS apps. The callback seals
the WorkOS session into an HttpOnly `mm_session` cookie (30 days, refreshed automatically).

- First sign-in asks for the business details: legal and trading name, ABN (ATO checksum), contact, phone,
  billing and optional delivery address. Saving them finds or creates the **Xero contact** (by ABN, email,
  then name) and stores its id on the account, so every invoice goes to the same contact.
- Staff are the emails listed in `ADMIN_EMAILS` (comma-separated). They get an **Admin** link.
- WorkOS settings per environment: redirect URI `https://<host>/misterminit/api/auth/callback`,
  sign-out redirect `https://<host>/misterminit/`.

## Pricing

The first mat is priced by how many changes the store makes; each extra mat of the same design is $150;
freight is $25 per order. Prices include GST.

| Changes | ≤10 | 11–20 | 21–30 | 31–40 | 41–50 | 51–60 | 61–70 | 71+ |
|---|---|---|---|---|---|---|---|---|
| First mat | $150 | $165 | $180 | $195 | $210 | $225 | $240 | $250 |

**What counts as a change** (`designChanges` in `shared/mat.js`): each line edited, added or removed = 1;
each section setting (title, subtitle, badge, footnote, colour, column) = 1; a new section = 1 per line;
a removed section = 1; reordering lines in a section = 1; reordering sections in a column = 1. Store names
don't count. **Reorders** (from *My mats*) count changes against the customer's previous design, so a
straight reprint or up to 10 changes is $150. The server always recounts from the saved baseline; the
browser's number is only for display.

## Order statuses

Requested (invoice sent) → Paid (set automatically when Xero shows the invoice paid) → In design →
Mockup sent → Approved → Printing → Shipped → Delivered, or Cancelled. Staff change the status, tracking
number and internal note on the admin page; every change is logged with who and when, and the customer
sees the progress on their order page.

## Xero

On submit the endpoint looks the customer up in Xero by **ABN**, then **email**, then **name**. If one
matches, that contact is used untouched; otherwise a new contact is created with the business details,
billing (postal) and delivery (street) addresses. The store never sees which happened. Only the design
team's email says "existing contact" or "new contact".

It then raises an approved **invoice** (or a **quote** with `XERO_DOCUMENT=quote`) on the "Ankor'd
Branding" theme, due in `XERO_INVOICE_DUE_DAYS` (7), fetches the PDF and attaches it to both emails. The
page shows the invoice number and total with **Pay invoice** (Xero's online invoice) and **Download
invoice** buttons, and the customer email has a **View & pay** button. Card payment on the online
invoice comes from the payment service set up on that branding theme in Xero (Stripe, etc.).

Line items copy QU-0003: item `80x40cm Mat` on account 220 (first mat $250, reprints $150) and item
`FREIGHT` on account 280 ($25), GST on Income, tax inclusive.

If Xero isn't configured or returns an error, the brief is **still emailed**. The design team's copy is
marked `NO INVOICE` with the reason, and the store is told their invoice will follow.

### One-time setup: Xero Web app

1. **developer.xero.com → My Apps → New app → Web app.**
   - Company or application URL: `https://apps.ankord.com.au`
   - Redirect URI: `https://apps.ankord.com.au/misterminit/api/xero/callback`
2. Copy the **Client id** and generate a **Client secret** into `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`
   on Vercel. Also set `XERO_ADMIN_KEY` and `CRON_SECRET` (long random strings) and `XERO_ORG_NAME=Ankor'd`.
3. **Vercel → Storage / Marketplace → Upstash for Redis → connect to this project.** It sets
   `KV_REST_API_URL` / `KV_REST_API_TOKEN`. The Xero login is kept there, and the rate limits also become
   global. Redeploy.
4. **Connect once:** open `https://apps.ankord.com.au/misterminit/api/xero/connect?key=<XERO_ADMIN_KEY>`,
   sign in to Xero and allow access to the **Ankor'd** organisation. You'll land on "Xero connected".
   `…/api/xero/status?key=<XERO_ADMIN_KEY>` shows which organisation is connected.
5. Match the new quotes to your existing template:
   ```bash
   vercel env pull .env.local
   node --env-file=.env.local scripts/xero-inspect.js QU-0003
   ```
   It prints QU-0003's line items with their account codes, tax types and item codes, plus your
   branding themes. Copy the values into `XERO_ACCOUNT_CODE`, `XERO_TAX_TYPE`, `XERO_ITEM_CODE_*`,
   `XERO_BRANDING_THEME_ID` and `XERO_QUOTE_TERMS`.

The scopes requested are `offline_access accounting.contacts accounting.invoices accounting.settings.read`
(plus `openid profile email`). Since March 2026 `accounting.invoices` covers quotes. Xero refresh tokens
rotate on every use and lapse after 60 days unused. The endpoint saves each new one, and a daily Vercel
cron (`vercel.json → crons`) refreshes it so it never lapses. If the connection is ever lost (someone
disconnects the app in Xero, or the store is cleared), briefs still email with **NO INVOICE** and the
reason. Run the connect link again to fix it.

Prefer a paid **Custom connection** instead? Set `XERO_MODE=custom`. It uses client credentials, and no
store or connect step is needed.

## One-time setup: Microsoft 365 App Registration

1. **Microsoft Entra admin center → App registrations → New registration.**
   Name it something like `Mister Minit Mat Builder`, single tenant, no redirect URI.
   Copy the **Application (client) ID** and **Directory (tenant) ID**.
2. **Certificates & secrets → New client secret.** Copy the secret **Value** straight away
   (it is only shown once). Note the expiry and set a reminder to rotate it.
3. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Mail.Send`**,
   then **Grant admin consent**.
4. **Limit the app to the marketing mailbox with Exchange RBAC for Applications.** `Mail.Send` as
   an application permission can otherwise send as *any* mailbox in the tenant. Exchange's RBAC
   for Applications scopes the app to one mailbox. In PowerShell (`pwsh`), as an account that is an
   explicit member of the Exchange **Organization Management** role group (being a Global Admin
   alone is not enough for the delegating check):

   ```powershell
   Install-Module ExchangeOnlineManagement, Microsoft.Graph.Applications -Scope CurrentUser   # first time only

   # Run the Graph and Exchange modules in SEPARATE pwsh sessions – they clash when loaded together.
   # Session A – look up the app's service principal (Enterprise Application) object id
   Connect-MgGraph -Scopes "Application.Read.All" -NoWelcome
   (Get-MgServicePrincipal -Filter "appId eq '<client id>'").Id

   # Session B – Exchange Online
   Connect-ExchangeOnline -UserPrincipalName you@ankord.com.au
   Enable-OrganizationCustomization                     # one-time, only if the tenant has never been customised
   New-ServicePrincipal -AppId <client id> -ObjectId <service principal object id> -DisplayName "Mister Minit Mat Builder"
   New-ManagementScope -Name "Mat Builder mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'marketing@ankord.com.au'"
   New-ManagementRoleAssignment -App <client id> -Role "Application Mail.Send" -CustomResourceScope "Mat Builder mailbox"
   Test-ServicePrincipalAuthorization -Identity <client id> -Resource marketing@ankord.com.au   # expect InScope True
   Test-ServicePrincipalAuthorization -Identity <client id> -Resource you@ankord.com.au         # expect InScope False
   Disconnect-ExchangeOnline -Confirm:$false
   ```

   Then, in Entra, remove the tenant-wide Microsoft Graph `Mail.Send` application permission from
   the App Registration: the Exchange role assignment is what authorises the app from here on, and
   leaving the broad permission in place would bypass the mailbox scope. Sends can take a few
   minutes to start working after the assignment.

   (The older `New-ApplicationAccessPolicy` approach was tried first and blocked every send at
   runtime with a RAOP 403 even though `Test-ApplicationAccessPolicy` reported Granted.)

## What the design team receives

Each order emails **marketing@ankord.com.au** with the order number, stores and quantities, business and
delivery details, the Xero invoice, the number of changes and the mat price, a high-resolution render of
the layout, the list of changes, and every section as a table (changed rows orange, added green). Attached:
the render, a printable **checklist PDF**, a `.csv` of every line (for Illustrator) and the invoice PDF.
The store gets a short email with a **Pay invoice** button and a link to the order in their account.

If Xero or email fails, the order is still saved; the error shows on the admin order page.

## Abuse protection

Ordering needs a signed-in account with complete business details. Orders are rate limited per account
(6 / hour) and overall (100 / hour) via `RATE_LIMIT_*`, globally when Upstash Redis is configured.

## Deploy (Vercel)

Production is the `main` branch (https://apps.ankord.com.au/misterminit); **staging** is the `staging`
branch's Preview deployment. Environment variables (see `.env.example`), per environment:

```bash
vercel env add DATABASE_URL preview staging          # Neon "staging" branch, pooled connection string
vercel env add WORKOS_API_KEY preview staging        # WorkOS dashboard → Mister Minit Mats → Staging → API keys
vercel env add WORKOS_CLIENT_ID preview staging
vercel env add WORKOS_COOKIE_PASSWORD preview staging   # 32+ random characters: openssl rand -base64 48
vercel env add ADMIN_EMAILS preview staging
```

Database: one Neon project (**mister-minit-mats**) with a `production` and a `staging` branch. Apply the
schema with `DATABASE_URL=… node scripts/migrate.js` (safe to re-run).

## Run locally

```bash
npm test                                   # change counting, pricing, order flow, Xero payloads (no network)
node .claude/mock/app-mock.mjs             # UI only: http://localhost:8790/misterminit/ with a fake API
vercel dev                                 # full stack with .env.local
```

## Notes

- The layout image for the designer is captured in the browser with html2canvas (cdnjs) and kept under
  Microsoft Graph's ~4 MB limit by switching to JPEG when needed.
- Drafts autosave to the account about a second after each edit, with a backup in the browser in case the
  connection drops.
- The header (FIXED WHILE YOU WAIT, services strip, GST line) is fixed and not editable.
