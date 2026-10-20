// One serverless function for all /api/auth/* routes (Vercel Hobby allows max 12 functions).
// vercel.json rewrites /api/auth/:action -> /api/auth?action=:action
import login from "./_routes/auth/login.js";
import logout from "./_routes/auth/logout.js";
import me from "./_routes/auth/me.js";
import signup from "./_routes/auth/signup.js";
import resetRequest from "./_routes/auth/reset-request.js";
import updatePassword from "./_routes/auth/update-password.js";
const actions = { login, logout, me, signup, "reset-request": resetRequest, "update-password": updatePassword };
export default (req, res) => {
  const h = Object.hasOwn(actions, req.query?.action) ? actions[req.query.action] : null;
  return h ? h(req, res) : res.status(404).json({ error: "Not found" });
};
