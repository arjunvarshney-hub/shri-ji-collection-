import { route, anon, jsonBody, setAuthCookies, HttpError, friendlyAuthError } from "../../_lib.js";
import { email } from "../../_validate.js";

export default route(["POST"], async (req, res) => {
  const b = jsonBody(req);
  const mail = email(b.email, { required: true });
  const password = String(b.password ?? "");
  if (!password || password.length > 72) throw new HttpError(400, "Please enter your password.");
  const db = await anon();
  const { data, error } = await db.auth.signInWithPassword({ email: mail, password });
  if (error || !data?.session) throw new HttpError(401, friendlyAuthError(error, "Could not log in. Please try again."));
  setAuthCookies(req, res, data.session);
  res.json({ ok: true });
});
