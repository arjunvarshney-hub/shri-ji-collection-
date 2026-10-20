// Browser reports "payment done" -> we verify Razorpay's signature server-side before marking anything paid.
import { route, requireUser, admin, jsonBody, HttpError } from "../../_lib.js";
import { verifyCheckoutSignature } from "../../_razorpay.js";
import { notify } from "../../_email.js";

export default route(["POST"], async (req, res) => {
  const user = await requireUser(req, res);
  const b = jsonBody(req);
  const orderId = String(b.razorpay_order_id || ""), paymentId = String(b.razorpay_payment_id || ""), sig = String(b.razorpay_signature || "");
  if (!/^order_\w{6,40}$/.test(orderId) || !/^pay_\w{6,40}$/.test(paymentId)) throw new HttpError(400, "Invalid payment details.");
  if (!verifyCheckoutSignature(orderId, paymentId, sig, process.env.RAZORPAY_KEY_SECRET)) throw new HttpError(400, "Payment could not be verified.");
  const db = await admin();
  // Ownership check: the Razorpay order must belong to the logged-in customer.
  const { data: o } = await db.from("orders").select("order_number,user_id").eq("razorpay_order_id", orderId).maybeSingle();
  if (!o || o.user_id !== user.id) throw new HttpError(404, "Order not found.");
  const { data, error } = await db.rpc("mark_order_paid", { p_razorpay_order_id: orderId, p_payment_id: paymentId, p_amount_paise: null }); // idempotent
  if (error) throw error;
  await notify.paidAdmin(data);
  res.json({ ok: true, orderNumber: data.order_number, payment_status: data.payment_status });
});
