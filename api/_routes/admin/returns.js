// Admin: customer return / problem requests.
import { route, requireAdmin, admin, jsonBody, HttpError } from "../../_lib.js";
import { text } from "../../_validate.js";
import { audit } from "../../_admin_products.js";
import { notify } from "../../_email.js";
import { RETURN_NEXT, RETURN_STATUSES } from "../../_returns.js";

export default route(["GET", "PATCH"], async (req, res) => {
  const user = await requireAdmin(req, res);
  const db = await admin();
  if (req.method === "GET") {
    const q = req.query || {};
    let qb = db.from("return_requests").select("*").order("created_at", { ascending: false }).limit(200);
    if (RETURN_STATUSES.includes(q.status)) qb = qb.eq("status", q.status);
    const { data, error } = await qb;
    if (error) throw error;
    const rows = data || [];
    const ids = [...new Set(rows.map((r) => r.order_id))];
    const { data: orders } = ids.length ? await db.from("orders").select("id,order_number,customer_name,phone,payment_method,payment_status,order_status,delivered_at,total").in("id", ids) : { data: [] };
    const by = new Map((orders || []).map((o) => [o.id, o]));
    return res.json({ returns: rows.map((r) => ({ ...r, order: by.get(r.order_id) || null })) });
  }
  const b = jsonBody(req);
  const id = Number(b.id);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, "Invalid request.");
  const { data: cur } = await db.from("return_requests").select("*").eq("id", id).maybeSingle();
  if (!cur) throw new HttpError(404, "Request not found.");
  const patch = { updated_at: new Date().toISOString() };
  if (b.status !== undefined && b.status !== cur.status) {
    if (!(RETURN_NEXT[cur.status] || []).includes(b.status)) throw new HttpError(409, `A request that is "${cur.status.replace(/_/g, " ")}" cannot be changed to "${String(b.status).replace(/_/g, " ")}".`);
    patch.status = b.status;
    if (b.status === "rejected" && !text(b.decision_reason, "Reason", { max: 400 })) throw new HttpError(400, "Please write the reason for rejecting (the customer will see it).");
  }
  if (b.decision_reason !== undefined) patch.decision_reason = text(b.decision_reason, "Reason", { max: 400 }) || null;
  if (b.admin_note !== undefined) patch.admin_note = text(b.admin_note, "Note", { max: 500 }) || null;
  if (b.refund_amount !== undefined && b.refund_amount !== "") { const n = Number(b.refund_amount); if (!(n >= 0 && n <= 1000000)) throw new HttpError(400, "Refund amount is not valid."); patch.refund_amount = Math.round(n * 100) / 100; }
  const { data, error } = await db.from("return_requests").update(patch).eq("id", id).select().single();
  if (error) throw error;
  const { data: order } = await db.from("orders").select("*").eq("id", cur.order_id).single();
  if (patch.status) {
    await db.from("order_events").insert({ order_id: cur.order_id, event_type: "return_status", from_status: cur.status, to_status: patch.status, note: `${cur.product_name}${patch.decision_reason ? ": " + patch.decision_reason : ""}`, actor: "admin", actor_id: user.id });
    await notify.returnStatusCustomer(order, data);
    await audit(db, user, "return_status", "return", id, `${cur.status} -> ${patch.status}`);
  }
  res.json({ request: data });
});
