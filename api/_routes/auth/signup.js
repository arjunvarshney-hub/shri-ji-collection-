import { route, anon, jsonBody, setAuthCookies, siteUrl, HttpError, friendlyAuthError } from "../../_lib.js";
import { email, text } from "../../_validate.js";

export default route(["POST"], async (req, res) => {
  const b = jsonBody(req);
  const mail = email(b.email, { required: true });
  const name = text(b.name, "Name", { max: 80 });
  const password = String(b.password ?? "");
  if (password.length < 8 || password.length > 72) throw new HttpError(400, "Password must be 8 to 72 characters.");
  const db = await anon();
  const { data, error } = await db.auth.signUp({
    email: mail, password,
    options: { data: { full_name: name }, emailRedirectTo: `${siteUrl(req)}/account` },
  });
  if (error) throw new HttpError(400, friendlyAuthError(error, "Could not create the account. Please try again."));
  // Email confirmation OFF in Supabase -> a session is returned and the customer is logged in.
  if (data.session) {
    setAuthCookies(req, res, data.session);
    return res.json({ ok: true, loggedIn: true, message: "Account created. Welcome!" });
  }
  res.json({ ok: true, loggedIn: false, message: "Account created. We have sent a confirmation link to your email. Please confirm it, then log in." });
});
