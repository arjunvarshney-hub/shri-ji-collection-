// Transactional email. Server-side only. Provider: Resend (https://resend.com), over its REST API (no SDK).
//  * Every email is first saved in `email_outbox` with a unique event_key -> the same event can never produce two emails.
//  * An email is marked SENT only after the provider answers 2xx with an id. Otherwise it stays pending/failed with the error.
//  * Failed emails are retried by the daily cron and by the "Retry failed emails" button in /admin.
//  * A mail problem NEVER breaks checkout or an admin action: notify functions swallow errors (and record them).
import { admin, siteUrl } from "./_lib.js";
import { esc, money } from "../public/js/render.js";

export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const adminTo = () => String(process.env.ADMIN_NOTIFY_EMAIL || "").split(",").map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
const MAX_ATTEMPTS = 5;

async function attempt(db, row) {
  if (!emailConfigured()) {
    await db.from("email_outbox").update({ last_error: "email_not_configured" }).eq("id", row.id);
    return "not_configured";
  }
  let r, data = {};
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": String(row.event_key).slice(0, 250) },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [row.to_email], subject: row.subject, html: row.body_html, text: row.body_text || undefined }),
      signal: AbortSignal.timeout(8000),
    });
    data = await r.json().catch(() => ({}));
  } catch (e) {
    await db.from("email_outbox").update({ status: "failed", attempts: (row.attempts || 0) + 1, last_error: "network_or_timeout" }).eq("id", row.id);
    console.error("[email] send failed (network/timeout) for", row.kind);
    return "failed";
  }
  if (r.ok && data?.id) {
    await db.from("email_outbox").update({ status: "sent", attempts: (row.attempts || 0) + 1, provider_id: String(data.id), sent_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
    return "sent";
  }
  await db.from("email_outbox").update({ status: "failed", attempts: (row.attempts || 0) + 1, last_error: `provider_status_${r.status}${data?.message ? ": " + String(data.message).slice(0, 120) : ""}` }).eq("id", row.id);
  console.error("[email] provider rejected email, status", r.status);
  return "failed";
}

/** Queue + try to send one email. Returns 'sent' | 'failed' | 'not_configured' | 'duplicate' | 'skipped'. Never throws. */
export async function queueEmail({ key, to, kind, subject, html, text }) {
  try {
    if (!to) return "skipped";
    const db = await admin();
    const { data: ex } = await db.from("email_outbox").select("id,status").eq("event_key", key).maybeSingle();
    if (ex) return "duplicate";
    const { data: row, error } = await db.from("email_outbox").insert({ event_key: key, to_email: to, kind, subject: subject.slice(0, 200), body_html: html, body_text: text }).select().single();
    if (error) { if (error.code === "23505") return "duplicate"; throw error; }
    return await attempt(db, row);
  } catch (e) { console.error("[email] queue failed:", e?.message); return "skipped"; }
}

/** Retry pending/failed emails (cron + admin button). */
export async function retryOutbox(limit = 20) {
  if (!emailConfigured()) return { tried: 0, sent: 0, reason: "email_not_configured" };
  const db = await admin();
  const { data } = await db.from("email_outbox").select("*").in("status", ["pending", "failed"]).lt("attempts", MAX_ATTEMPTS).order("created_at", { ascending: true }).limit(limit);
  let sent = 0;
  for (const row of data || []) if ((await attempt(db, row)) === "sent") sent++;
  return { tried: (data || []).length, sent };
}

/* ------------------------------- templates ------------------------------- */
const PAY = { COD: "Cash on Delivery", ONLINE: "Online payment (Razorpay)" };
const itemsRows = (o) => (o.items || []).map((i) => {
  const extra = [i.variant_label || i.size, i.pack_qty > 1 ? `Pack of ${i.pack_qty}` : "", i.sku ? `SKU ${i.sku}` : ""].filter(Boolean).join(" · ");
  return `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.name)}${extra ? `<br><small style="color:#777">${esc(extra)}</small>` : ""}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${esc(i.qty)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(i.unit_price)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(Number(i.unit_price) * Number(i.qty))}</td></tr>`;
}).join("");
const itemsText = (o) => (o.items || []).map((i) => `- ${i.name}${i.variant_label ? ` (${i.variant_label})` : i.size ? ` (${i.size})` : ""}${i.pack_qty > 1 ? ` [Pack of ${i.pack_qty}]` : ""} x ${i.qty} @ ${money(i.unit_price)}`).join("\n");
const dt = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const wrap = (title, body) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;color:#2b1c1c"><div style="background:#6b1523;color:#fff;padding:14px 18px;font-size:18px;letter-spacing:1px">SHRI JI COLLECTION</div><div style="padding:18px;border:1px solid #eee;border-top:0"><h2 style="margin:0 0 12px;color:#6b1523;font-size:20px">${esc(title)}</h2>${body}</div></div>`;
const summary = (o) => `<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#faf5ec"><th align="left" style="padding:6px 8px">Item</th><th style="padding:6px 8px">Qty</th><th align="right" style="padding:6px 8px">Price</th><th align="right" style="padding:6px 8px">Total</th></tr>${itemsRows(o)}</table>
<p style="font-size:14px;line-height:1.7;margin:12px 0">Item subtotal: <b>${money(o.subtotal)}</b><br>Delivery: <b>${Number(o.shipping) ? money(o.shipping) : "FREE"}</b><br>Final total: <b style="font-size:16px">${money(o.total)}</b></p>`;
const customerBlock = (o) => `<p style="font-size:14px;line-height:1.7;margin:0 0 10px"><b>Order:</b> ${esc(o.order_number)} · ${esc(dt(o.created_at))}<br><b>Customer:</b> ${esc(o.customer_name)} · ${esc(o.phone)}${o.email ? ` · ${esc(o.email)}` : ""}<br><b>Payment:</b> ${esc(PAY[o.payment_method] || o.payment_method)} · status: ${esc(o.payment_status)}<br><b>Delivery address:</b> ${esc(o.address)}, ${esc(o.city || "")}, ${esc(o.state || "")} - ${esc(o.pincode || "")}</p>`;
const link = (path) => { try { return `${process.env.SITE_URL ? process.env.SITE_URL.replace(/\/+$/, "") : ""}${path}`; } catch { return path; } };
const orderUrl = (o) => link(`/account?order=${encodeURIComponent(o.order_number)}`);
const adminOrderText = (o) => `Order ${o.order_number} (${dt(o.created_at)})\nCustomer: ${o.customer_name}, ${o.phone}\nPayment: ${PAY[o.payment_method] || o.payment_method} / ${o.payment_status}\nAddress: ${o.address}, ${o.city}, ${o.state} - ${o.pincode}\n\n${itemsText(o)}\n\nSubtotal ${money(o.subtotal)}; Delivery ${Number(o.shipping) ? money(o.shipping) : "FREE"}; Total ${money(o.total)}`;

const toAdmins = async (key, kind, subject, html, text) => {
  const list = adminTo();
  if (!list.length) return [await queueEmail({ key: `${key}:noadmin`, to: process.env.ADMIN_NOTIFY_EMAIL || "", kind, subject, html, text })];
  const out = []; for (const [i, to] of list.entries()) out.push(await queueEmail({ key: `${key}:${i}`, to, kind, subject, html, text })); return out;
};
const safe = async (fn) => { try { return await fn(); } catch (e) { console.error("[email] notify error:", e?.message); return null; } };

export const notify = {
  newOrderAdmin: (o) => safe(() => toAdmins(`order_new_admin:${o.id}`, "order_new", `New order ${o.order_number} - ${money(o.total)} (${o.payment_method === "COD" ? "COD" : "Online, payment " + o.payment_status})`,
    wrap("New order received", customerBlock(o) + summary(o)), `NEW ORDER\n${adminOrderText(o)}`)),
  paidAdmin: (o) => safe(() => toAdmins(`order_paid_admin:${o.id}`, "order_paid", `Payment received: order ${o.order_number} (${money(o.total)})`, wrap("Online payment received", customerBlock(o) + summary(o)), `PAYMENT RECEIVED\n${adminOrderText(o)}`)),
  cancellationAdmin: (o, kind) => safe(() => toAdmins(`order_cancel_${kind}_admin:${o.id}`, `order_cancel_${kind}`,
    kind === "requested" ? `CANCELLATION REQUESTED: order ${o.order_number}` : `ORDER CANCELLED: ${o.order_number}`,
    wrap(kind === "requested" ? "Customer requested cancellation (NOT cancelled yet)" : "Order cancelled (confirmed)", `<p style="font-size:14px"><b>Status:</b> ${kind === "requested" ? "Cancellation requested. Please approve or decline in the admin panel." : "Cancelled"}<br><b>Reason:</b> ${esc(o.cancel_reason || "not given")}</p>` + customerBlock(o) + summary(o)),
    `${kind === "requested" ? "CANCELLATION REQUESTED (not cancelled yet)" : "ORDER CANCELLED"}\nReason: ${o.cancel_reason || "not given"}\n${adminOrderText(o)}`)),
  returnAdmin: (o, r) => safe(() => toAdmins(`return_new_admin:${r.id}`, "return_new", `${r.kind === "issue" ? "PROBLEM REPORTED" : "RETURN REQUESTED"}: order ${o.order_number}`,
    wrap(r.kind === "issue" ? "Customer reported a problem" : "Customer requested a return", `<p style="font-size:14px"><b>Item:</b> ${esc(r.product_name)} × ${esc(r.qty)}<br><b>Reason:</b> ${esc(r.reason)}<br>${r.details ? `<b>Details:</b> ${esc(r.details)}<br>` : ""}Photos: ${(r.photos || []).length}</p>` + customerBlock(o)),
    `${r.kind === "issue" ? "PROBLEM REPORTED" : "RETURN REQUESTED"}\nItem: ${r.product_name} x ${r.qty}\nReason: ${r.reason}\n${adminOrderText(o)}`)),
  orderConfirmedCustomer: (o) => safe(() => o.email && queueEmail({ key: `order_new_cust:${o.id}`, to: o.email, kind: "order_confirmation", subject: `Your order ${o.order_number} is placed - SHRI JI COLLECTION`,
    html: wrap("Thank you for your order!", `<p style="font-size:14px">We have received your order. You can follow it here: <a href="${esc(orderUrl(o))}">${esc(orderUrl(o))}</a></p>` + customerBlock(o) + summary(o)), text: `Thank you for your order ${o.order_number}.\n${adminOrderText(o)}\nTrack: ${orderUrl(o)}` })),
  statusCustomer: (o, status) => safe(() => o.email && ["shipped", "delivered", "cancelled", "out_for_delivery"].includes(status) && queueEmail({ key: `order_${status}_cust:${o.id}`, to: o.email, kind: `order_${status}`,
    subject: ({ shipped: "Your order has been shipped", out_for_delivery: "Your order is out for delivery", delivered: "Your order was delivered", cancelled: "Your order was cancelled" })[status] + ` - ${o.order_number}`,
    html: wrap(({ shipped: "Your order has been shipped", out_for_delivery: "Your order is out for delivery", delivered: "Your order was delivered", cancelled: "Your order was cancelled" })[status],
      `<p style="font-size:14px">Order ${esc(o.order_number)}.${o.tracking_id ? `<br>Courier: ${esc(o.courier_name || "")} · Tracking ID: <b>${esc(o.tracking_id)}</b>${o.tracking_url ? ` · <a href="${esc(o.tracking_url)}">Track</a>` : ""}` : ""}<br><a href="${esc(orderUrl(o))}">View your order</a></p>`),
    text: `Order ${o.order_number}: ${status}. ${o.tracking_id ? `Tracking ${o.courier_name || ""} ${o.tracking_id}. ` : ""}${orderUrl(o)}` })),
  returnStatusCustomer: (o, r) => safe(() => o.email && queueEmail({ key: `return_status_cust:${r.id}:${r.status}`, to: o.email, kind: "return_update", subject: `Update on your ${r.kind === "issue" ? "problem report" : "return"} - order ${o.order_number}`,
    html: wrap("Return update", `<p style="font-size:14px">Item: ${esc(r.product_name)}<br>Status: <b>${esc(String(r.status).replace(/_/g, " "))}</b>${r.decision_reason ? `<br>Note from the shop: ${esc(r.decision_reason)}` : ""}<br><a href="${esc(orderUrl(o))}">View order</a></p>`),
    text: `Return update for order ${o.order_number}: ${r.status}${r.decision_reason ? ` (${r.decision_reason})` : ""}` })),
  refundCustomer: (o, status) => safe(() => o.email && queueEmail({ key: `refund_cust:${o.id}:${status}`, to: o.email, kind: "refund_update", subject: `Refund ${status === "refunded" ? "completed" : "in process"} - order ${o.order_number}`,
    html: wrap("Refund update", `<p style="font-size:14px">Order ${esc(o.order_number)}: refund ${status === "refunded" ? "has been completed" : "is being processed"}. Bank/card timelines depend on your bank.</p>`), text: `Refund ${status} for order ${o.order_number}` })),
};
