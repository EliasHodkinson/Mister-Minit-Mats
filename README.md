# Mister Minit Mat Builder

A guided, eight-step form that walks a Mister Minit store through the price mat, then emails the
finished brief to the Ankor'd design team (and a copy to the store) from **marketing@ankord.com.au**
via Microsoft 365.

```
index.html        the builder (single page, no build step)
api/submit.js     serverless endpoint: rate limit → validate → reCAPTCHA → build → send
lib/brief.js      turns the brief into the Ankor'd-branded HTML emails and a .csv
lib/brand.js      Ankor'd colours, details and the embedded logo used in the emails
lib/graph.js      Microsoft Graph sender (App Registration, client-credentials)
lib/recaptcha.js  reCAPTCHA v3 server-side verification
lib/ratelimit.js  fixed-window rate limiter (in-memory, or Redis when configured)
tests/            node --test
```

## What you receive

Each submission sends **marketing@ankord.com.au** one email with:

- the store, contact, mat size, submission time and any notes from the store
- a high-resolution render of their layout (inline and attached as `layout.png`, 3000 px wide)
- the list of changes from the template
- every section on the mat as a table: item, price, red-price flag, packages, tiers, combo deals,
  with changed rows highlighted orange and added rows green
- attached: the render and a `.csv` of every line (for Illustrator)

Both emails carry the Ankor'd header, colours and footer. Reply-to on the designer copy is the
store contact, so replying goes to them. The store gets a friendlier copy with the same render
and tables, reply-to marketing@.

## Abuse protection

- **reCAPTCHA v3.** The page fetches a token on submit (action `submit_brief`); the endpoint
  verifies it with Google and rejects scores below `RECAPTCHA_MIN_SCORE` (default 0.5). The
  badge is hidden, so the required disclosure text sits in the site footer. Keys live in the
  Google reCAPTCHA admin console; the secret goes in `RECAPTCHA_SECRET_KEY`.
- **Rate limits.** Per IP (5 / 10 min), per contact email (3 / hour) and overall (100 / hour),
  all tunable via `RATE_LIMIT_*`. Exceeding one returns HTTP 429 with a friendly message.
  Out of the box the counters are in-memory per serverless instance, which stops bursts but is
  not a global guarantee; add **Upstash for Redis** from the Vercel Marketplace (free tier is
  plenty) and the limits become global automatically.
- **Payload checks.** Image type and size, section counts, email format, and a 4 MB body cap.

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

## Deploy (Vercel)

The project is laid out for Vercel: `index.html` is served as the site and `api/submit.js` becomes
the endpoint at `/api/submit`. There are no npm dependencies.

```bash
vercel login
vercel link
vercel env add MS_DIRECTORY_TENANT_ID
vercel env add MS_APPLICATION_CLIENT_ID
vercel env add MS_APP_CLIENT_SECRET
vercel env add MAIL_FROM        # marketing@ankord.com.au
vercel env add MAIL_TO          # marketing@ankord.com.au (comma-separate for more)
vercel env add RECAPTCHA_SECRET_KEY
vercel --prod
```

The app is served at **/misterminit** (see the rewrites in `vercel.json`); `/` redirects there.
Live URL: https://apps.ankord.com.au/misterminit

**Embedding on the main website instead?** Host this project on Vercel anyway, then either link
or iframe `https://apps.ankord.com.au/misterminit`, or copy `index.html` into the website and set
`SUBMIT_URL` at the top of its script to the full API URL. In that case also set
`ALLOWED_ORIGIN=https://www.ankord.com.au` on the Vercel project so the browser allows the
cross-origin request.

**Another host?** `processSubmission(body, env)` in `api/submit.js` is framework-free. Wrap it in
an Azure Function or Express route and it works the same.

## Run locally

```bash
cp .env.example .env.local     # fill in the real values
vercel dev                     # http://localhost:3000/misterminit
npm test                       # unit tests for the email builder and validation (no mail sent)
```

Without `.env.local` the page still works for filling in; only the final Submit fails with a clear
"Email isn't configured yet" message.

## Notes

- The builder captures the render in the browser with html2canvas (loaded from cdnjs at submit
  time), so the page needs to be allowed to load that script.
- Microsoft Graph's `sendMail` request is capped at about 4 MB. The builder keeps the render under
  that by switching from PNG to a high-quality JPEG when the PNG would be too large.
- The header (FIXED WHILE YOU WAIT, services strip, GST line) is fixed and not editable in the form.
- A store's progress is saved in their browser, so they can come back and finish later.
