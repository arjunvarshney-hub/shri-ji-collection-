// A signed-in customer's OWN orders only (always filtered by the verified user id).
import { route, requireUser, admin, jsonBody, HttpError } from "../../_lib.js";
import { orderNumber, text, imagePrefix } from "../../_validate.js";
import { returnInfo, RETURN_REASONS, ISSUE_REASONS } from "../../_returns.js";
import { notify } from "../../_email.js";

const COLS = "id,order_number,created_at,customer_name,phone,email,address,city,state,pincode,payment_method,payment_status,order_status,items,subtotal,shipping,total,delivered_at,courier_name,tracking_id,tracking_url,refund_status,cancel_reason,cancel_requested_at";
const EVENT_COLS = "event_type,from_status,to_status,note,actor,created_at";

async function ownOrder(db, user, num) {
  const { data, error } = await db.from("orders").select(COLS).eq("user_id", user.id).eq("order_number", orderNumber(num)).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Order not found.");
  return data;
}
async function detail(db, o) {
  const { data: ev } = await db.from("order_events").select(EVENT_COLS).eq("order_id", o.id).eq("internal", false).order("created_at", { ascending: true });
  const { data: rr } = await db.from("return_requests").select("id,item_index,kind,reason,details,qty,status,decision_reason,created_at,updated_at,refund_amount").eq("order_id", o.id).order("created_at", { ascending: true });
  const returns = rr || [];
  const items = (o.items || []).map((it, index) => {
    const info = returnInfo(o, it, Date.now());
    const active = returns.find((r) => r.item_index === index && !["rejected", "cancelled"].includes(r.status));
    return { ...it, index, return_info: { ...info, can_return: info.can_return && !active, can_report_issue: info.can_report_issue && !active }, return_request: active || null };
  });
  const { id, ...order } = o;
  return { order: { ...order, items }, timeline: ev || [], returns, reasons: { return: RETURN_REASONS, issue: ISSUE_REASONS } };
}

export default route(["GET", "POST"], async (req, res) => {
  const user = await requireUser(req, res);
  const db = await admin();
  if (req.method === "GET") {
    const num = req.query?.number;
    if (num) return res.json(await detail(db, await ownOrder(db, user, num)));
    const { data, error } = await db.from("orders").select(COLS).eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return res.json({ orders: (data || []).map(({ id, ...o }) => o) });
  }
  const b = jsonBody(req);

  if (b.action === "cancel") {
    const num = orderNumber(b.orderNumber);
    const reason = text(b.reason, "Reason", { max: 300 }) || null;
    const { data, error } = await db.rpc("set_order_status", { p_order_number: num, p_status: "cancelled", p_user: user.id, p_note: reason, p_actor: user.id, p_actor_type: "customer" });
    if (error) {
      if (/NOT_FOUND/.test(error.message)) throw new HttpError(404, "Order not found.");
      if (/NOT_ALLOWED/.test(error.message)) throw new HttpError(409, "This order can no longer be cancelled online (it may already be shipped). Please contact the shop.");
      throw error;
    }
    const full = await ownOrder(db, user, num);
    if (data.order_status === "cancellation_requested") await notify.cancellationAdmin({ ...full, cancel_reason: reason }, "requested");
    else if (data.order_status === "cancelled") { await notify.cancellationAdmin({ ...full, cancel_reason: reason }, "confirmed"); await notify.statusCustomer(full, "cancelled"); }
    return res.json({ ok: true, order_status: data.order_status, payment_status: data.payment_status, requested: data.order_status === "cancellation_requested" });
  }

  if (b.action === "return") {
    const o = await ownOrder(db, user, b.orderNumber);
    const idx = Number(b.itemIndex);
    const item = Number.isInteger(idx) ? (o.items || [])[idx] : null;
    if (!item) throw new HttpError(400, "Please choose the item.");
    const kind = b.kind === "issue" ? "issue" : "return";
    const info = returnInfo(o, item, Date.now());
    if (kind === "return" && !info.can_return) throw new HttpError(409, info.policy.eligible === false ? "This item is non-returnable. If it arrived damaged, defective or wrong, please use Report a problem." : info.note || "This item cannot be returned now.");
    if (kind === "issue" && !info.can_report_issue) throw new HttpError(409, "The time to report a problem for this order has ended. Please contact the shop.");
    const reason = String(b.reason || "");
    if (!(kind === "issue" ? ISSUE_REASONS : RETURN_REASONS).includes(reason)) throw new HttpError(400, "Please choose a reason.");
    const qty = Number(b.qty ?? item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > Number(item.qty)) throw new HttpError(400, "Quantity is not valid for this item.");
    const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 3);
    for (const u of photos) if (typeof u !== "string" || !u.startsWith(imagePrefix() + "returns/") || u.length > 400) throw new HttpError(400, "Invalid photo. Please upload photos with the Add photo button.");
    const row = { order_id: o.id, item_index: idx, product_id: item.product_id, product_name: item.name, qty, kind, reason, details: text(b.details, "Details", { max: 500 }) || null, photos, user_id: user.id };
    const { data: rr, error } = await db.from("return_requests").insert(row).select().single();
    if (error) { if (error.code === "23505") throw new HttpError(409, "You have already sent a request for this item."); throw error; }
    await db.from("order_events").insert({ order_id: o.id, event_type: kind === "issue" ? "issue_reported" : "return_requested", note: `${item.name}: ${reason}`, actor: "customer", actor_id: user.id });
    await notify.returnAdmin(o, rr);
    return res.status(201).json({ ok: true, request: { id: rr.id, status: rr.status } });
  }
  throw new HttpError(400, "Unknown action.");
});
