/*
 * Google reCAPTCHA v3 – server-side verification of the token the page obtained with
 * grecaptcha.execute(siteKey, { action: "submit_brief" }).
 */

const fail = (status, message) => Object.assign(new Error(message), { status });

/**
 * @param {object} o
 * @param {string} o.secret          reCAPTCHA secret key
 * @param {string} o.token           token from the browser
 * @param {string} [o.ip]            client IP, improves scoring
 * @param {string} [o.expectedAction="submit_brief"]
 * @param {number} [o.minScore=0.5]  0 = certainly a bot … 1 = certainly a person
 * @param {string[]} [o.hostnames]   if given, the token must have been issued on one of these hosts
 */
export async function verifyRecaptcha({ secret, token, ip, expectedAction = "submit_brief", minScore = 0.5, hostnames = [] }) {
  if (!secret) throw fail(500, "Security check isn't configured (RECAPTCHA_SECRET_KEY missing)");
  if (!token || typeof token !== "string" || token.length > 4096) throw fail(400, "Security check missing – please refresh the page and try again");

  const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  const d = await r.json().catch(() => ({}));

  if (!d.success) {
    const codes = (d["error-codes"] || []).join(", ");
    // timeout-or-duplicate = token older than 2 minutes or reused; ask the user to try again
    if (/timeout-or-duplicate/.test(codes)) throw fail(400, "The security check expired – please press Submit again");
    throw fail(400, `Security check failed${codes ? ` (${codes})` : ""}`);
  }
  if (d.action !== expectedAction) throw fail(400, "Security check did not match this form");
  if (typeof d.score === "number" && d.score < minScore) throw fail(403, "This submission looked automated and was blocked. If you're a real person, please try again in a few minutes or email us directly.");
  if (hostnames.length && !hostnames.includes(d.hostname)) throw fail(403, "Security check came from an unexpected site");
  return { score: d.score, hostname: d.hostname };
}
