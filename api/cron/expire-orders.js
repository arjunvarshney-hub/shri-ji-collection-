// Daily Vercel Cron: cancels unpaid online orders older than 24h and releases their reserved stock.
import { route, admin, HttpError } from "../_lib.js";
export default route(["GET"], async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, "CRON_SECRET is not set");
  if (req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized");
  const { data, error } = await (await admin()).rpc("expire_unpaid_orders", { p_hours: 24 });
  if (error) throw error;
  const { retryOutbox } = await import("../_email.js");
  res.json({ ok: true, cancelled: data, emails: await retryOutbox(30) });
});
