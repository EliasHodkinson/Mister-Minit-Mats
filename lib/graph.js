/*
 * Sends mail through Microsoft Graph as a mailbox in the M365 tenant, using an App Registration
 * (client-credentials flow, application permission Mail.Send). Node 18+ – uses the built-in fetch.
 */

let cached = { token: null, expires: 0 };

export async function getToken(env) {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`Microsoft sign-in failed: ${data.error_description || data.error || r.status}`);
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

const recipients = list => [].concat(list).filter(Boolean).map(address => ({ emailAddress: { address } }));

/**
 * @param {object} env  MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM
 * @param {object} msg  { to, cc?, replyTo?, subject, html, attachments: [{ name, contentType, contentBytes(base64), isInline?, contentId? }] }
 */
export async function sendMail(env, msg) {
  const token = await getToken(env);
  const body = {
    message: {
      subject: msg.subject,
      body: { contentType: "HTML", content: msg.html },
      toRecipients: recipients(msg.to),
      ccRecipients: recipients(msg.cc || []),
      replyTo: recipients(msg.replyTo || []),
      attachments: (msg.attachments || []).map(a => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.contentType,
        contentBytes: a.contentBytes,
        isInline: !!a.isInline,
        ...(a.contentId ? { contentId: a.contentId } : {}),
      })),
    },
    saveToSentItems: true,
  };
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_FROM)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 202) return true;
  const err = await r.json().catch(() => ({}));
  throw new Error(`Graph sendMail failed (${r.status}): ${err?.error?.message || r.statusText}`);
}
