import { route, clearAuthCookies } from "../../_lib.js";
export default route(["POST"], async (req, res) => {
  clearAuthCookies(req, res);
  res.json({ ok: true });
});
