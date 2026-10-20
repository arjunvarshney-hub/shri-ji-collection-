import { route, anon, admin, jsonBody, HttpError } from "../../_lib.js";

// Called from the password-reset page with the one-time token from the Supabase email link.
export default route(["POST"], async (req, res) => {
  const b = jsonBody(req);
  const password = String(b.password ?? "");
  if (password.length < 8 || password.length > 72) throw new HttpError(400, "Password must be 8 to 72 characters.");
  if (typeof b.accessToken !== "string" || b.accessToken.length < 20) throw new HttpError(400, "Reset link is invalid or expired.");
  const { data, error } = await (await anon()).auth.getUser(b.accessToken);
  if (error || !data?.user) throw new HttpError(400, "Reset link is invalid or expired. Please request a new one.");
  const { error: e2 } = await (await admin()).auth.admin.updateUserById(data.user.id, { password });
  if (e2) throw new HttpError(400, "Could not update the password. Try a stronger one.");
  res.json({ ok: true, message: "Password updated. Please log in." });
});
