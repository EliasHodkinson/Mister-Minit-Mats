/*
 * /misterminit/api/auth/:action – sign-in with WorkOS AuthKit (see lib/auth.js)
 *   login    → AuthKit sign-in page        signup → AuthKit sign-up page
 *   callback → AuthKit returns here         logout → ends the session (also at WorkOS)
 */
import { finishSignIn, signOut, startSignIn } from "../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = req.query?.action;
  try {
    if (action === "login") return startSignIn(req, res);
    if (action === "signup") return startSignIn(req, res, { signUp: true });
    if (action === "callback") return await finishSignIn(req, res);
    if (action === "logout") return await signOut(req, res);
    return res.status(404).json({ ok: false, error: "Unknown action" });
  } catch (e) {
    console.error("auth failed:", e);
    res.statusCode = 302;
    res.setHeader("Location", `/misterminit/?signin_error=${encodeURIComponent("Sign-in didn't work. Please try again.")}`);
    res.end();
  }
}
