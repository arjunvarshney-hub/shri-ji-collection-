// (Re)start payment for one of the customer's own unpaid online orders.
import { route, requireUser, admin, jsonBody, HttpError } from "../../_lib.js";
import { orderNumber } from "../../_validate.js";
import { preparePayment } from "../../_razorpay.js";

export default route(["POST"], async (req, res) => {
  const user = await requireUser(req, res);
  const num = orderNumber(jsonBody(req).orderNumber);
  const db = await admin();
  const { data: o, error } = await db.from("orders").select("*").eq("order_number", num).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!o) throw new HttpError(404, "Order not found.");
  if (o.payment_method !== "ONLINE" || !["pending", "failed"].includes(o.payment_status) || o.order_status !== "pending")
    throw new HttpError(409, "This order does not need a payment.");
  res.json({ orderNumber: o.order_number, razorpay: await preparePayment(o) });
});
