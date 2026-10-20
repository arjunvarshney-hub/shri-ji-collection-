// Razorpay helpers: REST API via fetch (no SDK), signature checks, order preparation.
import crypto from "node:crypto";
import { HttpError, admin } from "./_lib.js";

export const razorpayConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const hmac = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("hex");

/** Checkout success signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export const verifyCheckoutSignature = (orderId, paymentId, signature, secret) =>
  !!secret && !!orderId && !!paymentId && safeEqual(hmac(`${orderId}|${paymentId}`, secret), signature);
/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret). */
export const verifyWebhookSignature = (rawBody, signature, secret) => !!secret && safeEqual(hmac(rawBody, secret), signature);

export async function createRazorpayOrder({ amountPaise, receipt, notes }) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  let r;
  try {
    r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new HttpError(502, "Could not reach the payment gateway. Please try again."); }
  if (!r.ok) { console.error("Razorpay order create failed, status", r.status); throw new HttpError(502, "Could not start the payment. Please try again."); }
  return r.json();
}

/** Returns what Checkout needs. The amount always comes from the DB order total, never from the browser. */
export async function preparePayment(order) {
  if (!razorpayConfigured()) throw new HttpError(503, "Online payment is not available right now. Please choose Cash on Delivery.");
  const amount = Math.round(Number(order.total) * 100);
  let rzpId = order.razorpay_order_id;
  if (!rzpId) {
    const ro = await createRazorpayOrder({ amountPaise: amount, receipt: order.order_number, notes: { order_number: order.order_number } });
    const db = await admin();
    const { data } = await db.from("orders").update({ razorpay_order_id: ro.id }).eq("id", order.id).is("razorpay_order_id", null).select("razorpay_order_id");
    if (data?.length) rzpId = ro.id;
    else { const { data: cur } = await db.from("orders").select("razorpay_order_id").eq("id", order.id).single(); rzpId = cur.razorpay_order_id; }
  }
  return { key: process.env.RAZORPAY_KEY_ID, orderId: rzpId, amount, currency: "INR" };
}
