// Shared browser code: header/footer, API helper, cart, Razorpay launcher.
import { headerHtml, footerHtml, logoHtml, esc, money } from "./render.js";
import { setCategories } from "./categories.js";
export { esc, money };

export async function api(url, { method = "GET", body } = {}) {
  let r;
  try {
    r = await fetch(url, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error("No internet connection. Please check your network and try again."); }
  let d = {};
  try { d = await r.json(); } catch { /* non-JSON error page */ }
  if (!r.ok) { const e = new Error(d.error || "Something went wrong. Please try again."); e.status = r.status; throw e; }
  return d;
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
export const msg = (el, text, kind = "err") => { el.innerHTML = text ? `<div class="msg ${kind}" role="${kind === "err" ? "alert" : "status"}">${esc(text)}</div>` : ""; };
export const STATUS_LABEL = { pending: "Order Placed", confirmed: "Order Confirmed", processing: "Processing", packed: "Packed", shipped: "Shipped", out_for_delivery: "Out for Delivery", delivered: "Delivered", cancellation_requested: "Cancellation Requested", cancelled: "Cancelled" };
export const statusLabel = (s) => STATUS_LABEL[s] || String(s || "").replace(/_/g, " ");
/** Order status badge with the customer-friendly name (Order Placed, Out for Delivery, ...). */
export const statusBadge = (s) => `<span class="badge b-${esc(s)}">${esc(statusLabel(s))}</span>`;
export const badge = (v) => `<span class="badge b-${esc(String(v).split(" ")[0])}">${esc(String(v).replace(/_/g, " "))}</span>`;
export const fmtDate = (d) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

// ---------- cart (ids / option / qty only; prices and stock are ALWAYS re-read from the server) ----------
// item = { id: productId, v: variantId (0 when the product has no variants), size: legacy size text, qty: number of units/packs }
const KEY = "sjc_cart_v2";
const ok = (x) => x && Number.isSafeInteger(x.id) && x.id > 0 && Number.isInteger(x.qty) && x.qty >= 1 && x.qty <= 99 && typeof (x.size ?? "") === "string" && (x.v === undefined || Number.isSafeInteger(x.v));
export const sameItem = (a, b) => a.id === b.id && (a.v || 0) === (b.v || 0) && (a.size || "") === (b.size || "");
export const cart = {
  read() { try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a.filter(ok).map((x) => ({ id: x.id, v: x.v || 0, size: x.size || "", qty: x.qty })) : []; } catch { return []; } },
  write(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode */ } cart.badge(); },
  add(item) {
    const a = cart.read(), x = a.find((i) => sameItem(i, item));
    if (x) x.qty = Math.min(99, x.qty + item.qty); else a.push({ id: item.id, v: item.v || 0, size: item.size || "", qty: Math.min(99, item.qty) });
    cart.write(a);
  },
  setQty(item, qty) { cart.write(cart.read().map((i) => (sameItem(i, item) ? { ...i, qty: Math.max(1, Math.min(99, qty)) } : i))); },
  remove(item) { cart.write(cart.read().filter((i) => !sameItem(i, item))); },
  clear() { cart.write([]); },
  count() { return cart.read().reduce((n, i) => n + i.qty, 0); },
  badge() { const el = $("#cartCount"); if (!el) return; const n = cart.count(); el.textContent = n; el.hidden = !n; },
};

// ---------- Razorpay Checkout ----------
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = res; s.onerror = () => rej(new Error("Could not load the payment window. Please check your internet connection."));
    document.head.appendChild(s);
  });
}
/** Opens Razorpay. The order is only marked paid by the SERVER after it verifies the signature. */
export async function payOnline({ orderNumber, razorpay, prefill, onPaid, onProblem, onDismiss }) {
  await loadRazorpay();
  const rzp = new window.Razorpay({
    key: razorpay.key, amount: razorpay.amount, currency: razorpay.currency, order_id: razorpay.orderId,
    name: "SHRI JI COLLECTION", description: "Order " + orderNumber, prefill, theme: { color: "#6b1523" },
    modal: { ondismiss: onDismiss, confirm_close: true },
    handler: async (r) => {
      try {
        await api("/api/verify-payment", { method: "POST", body: { razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature } });
        onPaid();
      } catch (e) {
        onProblem("We received your payment but could not confirm it yet. Please do NOT pay again. Check My Orders in a few minutes, or call us with order no. " + orderNumber + ".");
      }
    },
  });
  rzp.on("payment.failed", (r) => onProblem((r?.error?.description || "Payment failed") + ". Your order is saved; you can retry from My Orders."));
  rzp.open();
}

// ---------- header / footer ----------
let menuGlobals = false;
function bindMenu() {
  const btn = $("#menuBtn"), panel = $("#menuPanel"), bg = $("#drawerBg"), x = $("#menuClose");
  if (!(btn && panel && bg)) return;
  const set = (open) => {
    panel.hidden = bg.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
    (open ? x : btn).focus();
  };
  btn.addEventListener("click", () => set(panel.hidden));
  x.addEventListener("click", () => set(false));
  bg.addEventListener("click", () => set(false));
  panel.addEventListener("click", (e) => e.target.closest("a") && set(false));
  if (!menuGlobals) {
    menuGlobals = true;
    document.addEventListener("keydown", (e) => { const p = $("#menuPanel"); if (e.key === "Escape" && p && !p.hidden) { p.hidden = true; $("#drawerBg").hidden = true; document.body.style.overflow = ""; } });
    window.matchMedia("(min-width:900px)").addEventListener("change", (m) => { const p = $("#menuPanel"); if (m.matches && p && !p.hidden) { p.hidden = true; $("#drawerBg").hidden = true; document.body.style.overflow = ""; } });
  }
}
function init() {
  const h = $("#hdr"), f = $("#ftr");
  const LK = "sjc_logo_v1", CK = "sjc_cats_v1";
  const rd = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const wr = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } };
  if (h && !h.firstElementChild) {          // static pages (cart, checkout, account, admin): header built here
    try { const c = JSON.parse(rd(CK) || "[]"); if (c.length) setCategories(c); } catch { /* ignore */ }
    h.innerHTML = headerHtml({ logo: rd(LK) });
    fetch("/api/site-settings", { credentials: "same-origin" }).then((r) => r.json()).then((d) => {
      const u = d?.settings?.logo_url || "", cats = JSON.stringify(d?.categories || []);
      const changed = u !== rd(LK) || (d?.categories?.length && cats !== rd(CK));
      if (d?.categories?.length) { setCategories(d.categories); wr(CK, cats); }
      wr(LK, u);
      if (changed) { h.innerHTML = headerHtml({ logo: u }); bindMenu(); cart.badge(); }
    }).catch(() => {});
  } else if (h) wr(LK, $(".logo-img", h)?.getAttribute("src") || "");   // server-rendered pages keep the cache fresh
  if (f && !f.firstElementChild) f.innerHTML = footerHtml();
  bindMenu();
  cart.badge();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
window.addEventListener("storage", () => cart.badge());
window.addEventListener("pageshow", () => cart.badge());
