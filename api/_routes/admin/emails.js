// Admin: email delivery status + retry.
import { route, requireAdmin, admin, jsonBody } from "../../_lib.js";
import { retryOutbox, emailConfigured } from "../../_email.js";

export default route(["GET", "POST"], async (req, res) => {
  await requireAdmin(req, res);
  const db = await admin();
  let retried = null;
  if (req.method === "POST" && jsonBody(req).action === "retry") retried = await retryOutbox(30);
  const { data } = await db.from("email_outbox").select("id,kind,to_email,subject,status,attempts,last_error,created_at,sent_at").order("created_at", { ascending: false }).limit(50);
  const rows = data || [];
  res.json({ configured: emailConfigured(), retried, emails: rows, problems: rows.filter((r) => r.status !== "sent").length });
});
