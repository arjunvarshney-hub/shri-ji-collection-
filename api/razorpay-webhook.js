// Razorpay -> server. Signature is checked against the RAW body; processing is idempotent.
import { admin, readRaw, HttpError } from "./_lib.js";
import { notify } from "./_email.js";
import { verifyWebhookSignature } from "./_razorpay.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: "Webhook not configured" });
    const raw = await readRaw(req, 1024 * 1024);
    if (!verifyWebhookSignature(raw, req.headers["x-razorpay-signature"], secret)) return res.status(400).json({ error: "Invalid signature" });

    let evt;
    try { evt = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Bad payload" }); }
    const db = await admin();
    const eventId = String(req.headers["x-razorpay-event-id"] || "");
    if (eventId) {
      const { data: seen } = await db.from("payment_events").select("event_id").eq("event_id", eventId).maybeSingle();
      if (seen) return res.json({ ok: true, duplicate: true });
    }
    const pay = evt?.payload?.payment?.entity, ord = evt?.payload?.order?.entity;
    const rzpOrderId = pay?.order_id || ord?.id;
    if (rzpOrderId && (evt.event === "payment.captured" || evt.event === "order.paid")) {
      const { data: paidOrder, error } = await db.rpc("mark_order_paid", { p_razorpay_order_id: rzpOrderId, p_payment_id: pay?.id || null, p_amount_paise: pay?.amount ?? ord?.amount_paid ?? null });
      if (error && !/NOT_FOUND/.test(error.message)) throw error;   // AMOUNT_MISMATCH etc. -> 500 so it is visible & retried
      if (paidOrder?.order_number) await notify.paidAdmin(paidOrder);   // one email per order (outbox key)
    } else if (rzpOrderId && evt.event === "payment.failed") {
      const { error } = await db.rpc("mark_payment_failed", { p_razorpay_order_id: rzpOrderId });
      if (error) throw error;
    }
    if (eventId) await db.from("payment_events").upsert({ event_id: eventId, event: evt.event }, { onConflict: "event_id", ignoreDuplicates: true });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error("[razorpay-webhook]", e?.message || e);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}
