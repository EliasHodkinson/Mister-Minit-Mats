# Mister Minit Mat Builder

A guided, eight-step form that walks a Mister Minit store through the price mat, then emails the
finished brief to the Ankor'd design team (and a copy to the store) from **marketing@ankord.com.au**
via Microsoft 365.

```
index.html        the builder (single page, no build step)
api/submit.js     serverless endpoint: validates the brief, builds the emails, sends them
lib/brief.js      turns the brief into HTML emails, a tab-separated .txt, .csv and .json
lib/graph.js      Microsoft Graph sender (App Registration, client-credentials)
tests/            node --test
```

## What you receive

Each submission sends **marketing@ankord.com.au** one email with:

- the store, contact, mat size, submission time and any notes from the store
- a high-resolution render of their layout (inline and attached as `layout.png`, 3000 px wide)
- the list of changes from the template
- every section on the mat as a table: item, price, red-price flag, packages, tiers, combo deals,
  with changed rows highlighted orange and added rows green
- attachments: `…txt` (tab-separated, paste straight into Illustrator), `…csv`, `…json`

Reply-to is set to the store contact, so replying goes to them. The store gets a friendlier copy
with the same render and tables, reply-to marketing@.

## One-time setup: Microsoft 365 App Registration

1. **Microsoft Entra admin center → App registrations → New registration.**
   Name it something like `Mister Minit Mat Builder`, single tenant, no redirect URI.
   Copy the **Application (client) ID** and **Directory (tenant) ID**.
2. **Certificates & secrets → New client secret.** Copy the secret **Value** straight away
   (it is only shown once). Note the expiry and set a reminder to rotate it.
3. **API permissions → Add a permission → Microsoft Graph → Application permissions → `Mail.Send`**,
   then **Grant admin consent**.
4. **Limit the app to the marketing mailbox.** `Mail.Send` as an application permission can
   otherwise send as *any* mailbox in the tenant. In PowerShell (`pwsh`):

   ```powershell
   Install-Module ExchangeOnlineManagement -Scope CurrentUser   # first time only
   Connect-ExchangeOnline -UserPrincipalName you@ankord.com.au
   New-DistributionGroup -Name "Mat Builder Senders" -Alias matbuildersenders -Type Security `
     -Members marketing@ankord.com.au
   New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId matbuildersenders@ankord.com.au `
     -AccessRight RestrictAccess -Description "Mat Builder may only send as marketing@"
   Test-ApplicationAccessPolicy -Identity marketing@ankord.com.au -AppId <client id>   # expect: Granted
   Test-ApplicationAccessPolicy -Identity you@ankord.com.au -AppId <client id>         # expect: Denied
   Disconnect-ExchangeOnline -Confirm:$false
   ```

   The policy can take up to an hour to apply.

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
