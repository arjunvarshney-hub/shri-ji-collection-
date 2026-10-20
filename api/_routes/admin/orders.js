import { route, requireAdmin, admin, jsonBody, HttpError } from "../../_lib.js";
import { orderNumber, text } from "../../_validate.js";
import { audit } from "../../_admin_products.js";
import { notify } from "../../_email.js";

const STATUSES = ["pending", "confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered", "cancellation_requested", "cancelled"];
const PAYMENTS = ["pending", "paid", "failed", "cancelled"];
const DELIVERY = { not_shipped: ["pending", "confirmed", "processing", "packed"], in_transit: ["shipped", "out_for_delivery"], delivered: ["delivered"], cancelled: ["cancelled", "cancellation_requested"] };
const SORTS = { date_desc: ["created_at", false], date_asc: ["created_at", true], total_desc: ["total", false], total_asc: ["total", true] };
const LIST_COLS = "id,order_number,created_at,customer_name,phone,email,city,items,subtotal,shipping,total,payment_method,payment_status,order_status,refund_status,delivered_at,tracking_id";
const istStart = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? `${d}T00:00:00+05:30` : null);
const istEnd = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? `${d}T23:59:59.999+05:30` : null);
const RPC_ERRORS = {
  NOT_FOUND: [404, "Order not found."],
  PAYMENT_PENDING: [409, "This online order is not paid yet, so it cannot move forward."],
  INVALID_STATUS: [400, "Invalid status."],
};
const url = (v, field) => { const s = text(v, field, { max: 300 }); if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw new HttpError(400, `${field} must start with http:// or https://`); return s; };

async function applyStatus(db, user, num, status, note) {
  const { data, error } = await db.rpc("set_order_status", { p_order_number: num, p_status: String(status), p_user: null, p_note: note || null, p_actor: user.id, p_actor_type: "admin" });
  if (error) {
    const t = String(error.message || "").match(/INVALID_TRANSITION:([a-z_]+):([a-z_]+)/);
    if (t) throw new HttpError(409, `An order that is "${t[1].replace(/_/g, " ")}" cannot be changed to "${t[2].replace(/_/g, " ")}".`);
    const k = Object.keys(RPC_ERRORS).find((x) => String(error.message).includes(x));
    if (k) throw new HttpError(RPC_ERRORS[k][0], RPC_ERRORS[k][1]);
    throw error;
  }
  return data;
}

export default route(["GET", "PATCH"], async (req, res) => {
  const user = await requireAdmin(req, res);
  const db = await admin();
  if (req.method === "GET") {
    const q = req.query || {};
    if (q.number) {
      const { data: o, error } = await db.from("orders").select("*").eq("order_number", orderNumber(q.number)).maybeSingle();
      if (error) throw error;
      if (!o) throw new HttpError(404, "Order not found.");
      const { data: events } = await db.from("order_events").select("*").eq("order_id", o.id).order("created_at", { ascending: true });
      const { data: returns } = await db.from("return_requests").select("*").eq("order_id", o.id).order("created_at", { ascending: true });
      return res.json({ order: o, events: events || [], returns: returns || [] });
    }
    let qb = db.from("orders").select(LIST_COLS, { count: "exact" });
    if (STATUSES.includes(q.status)) qb = qb.eq("order_status", q.status);
    if (DELIVERY[q.delivery]) qb = qb.in("order_status", DELIVERY[q.delivery]);
    if (PAYMENTS.includes(q.payment)) qb = qb.eq("payment_status", q.payment);
    if (["COD", "ONLINE"].includes(q.method)) qb = qb.eq("payment_method", q.method);
    if (istStart(q.from)) qb = qb.gte("created_at", istStart(q.from));
    if (istEnd(q.to)) qb = qb.lte("created_at", istEnd(q.to));
    const s = String(q.search || "").replace(/[^\p{L}\p{N} -]/gu, " ").trim().slice(0, 50);
    if (s) qb = qb.or(`order_number.ilike.%${s}%,customer_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
    const [col, asc] = SORTS[q.sort] || SORTS.date_desc;
    qb = qb.order(col, { ascending: asc });
    const page = Math.max(Number(q.page) || 1, 1), size = 25;
    const { data, error, count } = await qb.range((page - 1) * size, page * size - 1);
    if (error) throw error;
    const orders = data || [];
    let open = new Map();
    if (orders.length) {
      const { data: rr } = await db.from("return_requests").select("order_id,status").in("order_id", orders.map((o) => o.id));
      for (const r of rr || []) if (["requested", "approved", "pickup_scheduled", "in_transit", "returned", "refund_processing"].includes(r.status)) open.set(r.order_id, (open.get(r.order_id) || 0) + 1);
    }
    return res.json({ orders: orders.map((o) => ({ ...o, items_count: (o.items || []).reduce((n, i) => n + Number(i.qty || 0), 0), returns_open: open.get(o.id) || 0 })), total: count ?? 0, page, pageSize: size, pages: Math.max(1, Math.ceil((count ?? 0) / size)) });
  }

  const b = jsonBody(req);
  const num = orderNumber(b.orderNumber);
  const action = b.action || (b.status !== undefined ? "status" : b.note !== undefined ? "note" : "");
  let order;
  if (action === "status") {
    const before = (await db.from("orders").select("order_status").eq("order_number", num).maybeSingle()).data;
    order = await applyStatus(db, user, num, b.status, text(b.note, "Note", { max: 300 }));
    if (before && before.order_status !== order.order_status) await notify.statusCustomer(order, order.order_status);
    if (order.order_status === "cancelled") await notify.cancellationAdmin(order, "confirmed");
    await audit(db, user, "order_status", "order", num, `${before?.order_status} -> ${order.order_status}`);
  } else if (action === "decline_cancellation") {
    const { data: cur } = await db.from("orders").select("order_status,status_before_request").eq("order_number", num).maybeSingle();
    if (!cur || cur.order_status !== "cancellation_requested") throw new HttpError(409, "This order has no pending cancellation request.");
    order = await applyStatus(db, user, num, cur.status_before_request || "confirmed", text(b.note, "Note", { max: 300 }) || "Cancellation request declined");
    await audit(db, user, "decline_cancellation", "order", num, "");
  } else if (action === "tracking") {
    const patch = { courier_name: text(b.courier_name, "Courier name", { max: 60 }) || null, tracking_id: text(b.tracking_id, "Tracking ID", { max: 80 }) || null, tracking_url: url(b.tracking_url, "Tracking link") || null, updated_at: new Date().toISOString() };
    const { data, error } = await db.from("orders").update(patch).eq("order_number", num).select().single();
    if (error) throw error;
    order = data;
    await db.from("order_events").insert({ order_id: order.id, event_type: "tracking", note: patch.tracking_id ? `Courier: ${patch.courier_name || "-"}, Tracking ID: ${patch.tracking_id}` : "Tracking removed", actor: "admin", actor_id: user.id });
    await audit(db, user, "tracking", "order", num, patch.tracking_id || "");
  } else if (action === "refund") {
    if (!["processing", "refunded"].includes(b.refund_status)) throw new HttpError(400, "Invalid refund status.");
    const { data: cur } = await db.from("orders").select("*").eq("order_number", num).maybeSingle();
    if (!cur) throw new HttpError(404, "Order not found.");
    if (cur.payment_status !== "paid" && cur.order_status !== "cancelled") throw new HttpError(409, "Only paid or cancelled orders can have a refund status.");
    const { data, error } = await db.from("orders").update({ refund_status: b.refund_status, updated_at: new Date().toISOString() }).eq("order_number", num).select().single();
    if (error) throw error;
    order = data;
    await db.from("order_events").insert({ order_id: order.id, event_type: "refund", to_status: b.refund_status, note: text(b.note, "Note", { max: 300 }) || null, actor: "admin", actor_id: user.id });
    await notify.refundCustomer(order, b.refund_status);
    await audit(db, user, "refund", "order", num, b.refund_status);
  } else if (action === "note") {
    const note = text(b.note, "Note", { max: 500 }) || null;
    const { data, error } = await db.from("orders").update({ admin_note: note, updated_at: new Date().toISOString() }).eq("order_number", num).select().single();
    if (error) throw error;
    order = data;
    await audit(db, user, "note", "order", num, "internal note changed");
  } else throw new HttpError(400, "Nothing to update.");
  res.json({ order });
});
