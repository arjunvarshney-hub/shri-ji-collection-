// Create an order. The server re-reads every product from the database; the browser only sends product ids,
// quantities and sizes. Prices, stock and the payable total can NOT be influenced by the client.
import { route, requireUser, admin, jsonBody, HttpError } from "../../_lib.js";
import { notify } from "../../_email.js";
import * as v from "../../_validate.js";
import { preparePayment, razorpayConfigured } from "../../_razorpay.js";

const rpcMessage = (e) => String(e?.message || "");

export default route(["POST"], async (req, res) => {
  const user = await requireUser(req, res);
  const b = jsonBody(req);
  const method = b.paymentMethod;
  if (method !== "COD" && method !== "ONLINE") throw new HttpError(400, "Please choose a payment method.");
  if (method === "ONLINE" && !razorpayConfigured()) throw new HttpError(503, "Online payment is not available right now. Please choose Cash on Delivery.");
  const cust = v.customer(b.customer);
  const items = v.orderItems(b.items);
  const key = v.idempotencyKey(b.idempotencyKey);

  const db = await admin();
  const { data, error } = await db.rpc("create_order", {
    p_user: user.id, p_customer: cust, p_items: items, p_method: method, p_key: key,
    p_shipping_flat: 0, p_free_above: null,           // ignored by the database: delivery is computed there from the subtotal
  });
  let result = data;
  if (error) {
    const m = rpcMessage(error);
    if (error.code === "23505" && key) {            // double-tap race: same key already inserted
      const { data: ex } = await db.from("orders").select("*").eq("user_id", user.id).eq("idempotency_key", key).maybeSingle();
      if (ex) result = { existing: true, order: ex };
    }
    if (!result) {
      if (m.includes("OUT_OF_STOCK:")) throw new HttpError(409, `Sorry, "${m.split("OUT_OF_STOCK:")[1]}" does not have enough stock. Please reduce the quantity in your cart.`);
      if (m.includes("MIN_QTY:")) { const [, name, min] = m.match(/MIN_QTY:([^:]*):(\d+)/) || []; throw new HttpError(400, `Minimum order quantity for "${name}" is ${min}.`); }
      if (m.includes("VARIANT_REQUIRED:")) throw new HttpError(400, `Please choose the options (colour / size / pack) for "${m.split("VARIANT_REQUIRED:")[1]}".`);
      if (m.includes("SIZE_REQUIRED:")) throw new HttpError(400, `Please choose a size for "${m.split("SIZE_REQUIRED:")[1]}".`);
      if (m.includes("UNAVAILABLE")) throw new HttpError(409, "One of the products in your cart is no longer available. Please review your cart.");
      if (m.includes("INVALID_ITEMS")) throw new HttpError(400, "Your cart has an invalid item.");
      throw error;
    }
  }
  const order = result.order;
  if (!result.existing) { await notify.newOrderAdmin(order); await notify.orderConfirmedCustomer(order); }   // never throws; failures are kept in the outbox for retry
  const out = { orderNumber: order.order_number, subtotal: Number(order.subtotal), shipping: Number(order.shipping), total: Number(order.total), paymentMethod: order.payment_method, existing: !!result.existing };
  if (order.payment_method === "ONLINE" && order.payment_status !== "paid") {
    try { out.razorpay = await preparePayment(order); }
    catch (e) { out.paymentError = e instanceof HttpError ? e.message : "Could not start the payment."; }   // order is saved; customer can retry from My Orders
  }
  res.status(201).json(out);
});
