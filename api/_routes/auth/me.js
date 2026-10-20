import { route, getUser, isAdminUser } from "../../_lib.js";
export default route(["GET"], async (req, res) => {
  const u = await getUser(req, res);
  if (!u) return res.json({ user: null, isAdmin: false });
  res.json({
    user: { id: u.id, email: u.email, name: u.user_metadata?.full_name || "" },
    isAdmin: await isAdminUser(u),
  });
});
