import { route, anon, jsonBody, siteUrl } from "../../_lib.js";
import { email } from "../../_validate.js";

export default route(["POST"], async (req, res) => {
  const mail = email(jsonBody(req).email, { required: true });
  const db = await anon();
  await db.auth.resetPasswordForEmail(mail, { redirectTo: `${siteUrl(req)}/account` });
  // Same answer whether or not the email exists (no account enumeration).
  res.json({ ok: true, message: "If this email has an account, a password reset link has been sent." });
});
