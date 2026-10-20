import { api, esc, money, $, $$, msg, badge, statusBadge, fmtDate, payOnline } from "./common.js";
import { imgTag } from "./render.js";
import { shrink, upload } from "./admin-shared.js";
import { packNote } from "./cartlogic.js";

const box = $("#box");
const qs = new URLSearchParams(location.search);
// Supabase email links (confirm / reset) land here with tokens in the URL hash.
const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
let user = null;

const nextUrl = () => { const n = qs.get("next"); return n && /^\/[a-z]/i.test(n) && !n.startsWith("//") ? n : null; };

async function start() {
  if (hash.get("type") === "recovery" && hash.get("access_token")) return resetForm(hash.get("access_token"));
  const notice = hash.get("error_description") ? { t: "That link is invalid or has expired. Please request a new one.", k: "err" }
    : hash.get("type") === "signup" || hash.get("access_token") ? { t: "Email confirmed! Please log in.", k: "ok" } : null;
  if (location.hash.length > 1) history.replaceState(null, "", location.pathname + location.search);
  try { const me = await api("/api/auth/me"); user = me.user; var isAdmin = me.isAdmin; } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (!user) return authForm(notice);
  if (nextUrl()) return (location.href = nextUrl());
  if (qs.get("order")) return orderDetail(qs.get("order"));
  home(isAdmin);
}

function authForm(notice, mode = "login") {
  box.innerHTML = `<h1 class="h1">My account</h1><div class="panel"><div class="tabs" role="tablist"><button type="button" class="${mode === "login" ? "on" : ""}" data-m="login">Log in</button><button type="button" class="${mode === "signup" ? "on" : ""}" data-m="signup">Create account</button></div>
  <div id="m">${notice ? `<div class="msg ${notice.k}">${esc(notice.t)}</div>` : ""}</div>
  <form id="f" novalidate>${mode === "signup" ? '<label class="f">Full name<input name="name" autocomplete="name" maxlength="80"></label>' : ""}
  <label class="f">Email<input name="email" type="email" autocomplete="email" inputmode="email" required></label>
  <label class="f">Password ${mode === "signup" ? "<small>(at least 8 characters)</small>" : ""}<input name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required minlength="8"></label>
  <button class="btn primary lg" style="width:100%;margin-top:14px" id="go" type="submit">${mode === "signup" ? "Create account" : "Log in"}</button></form>
  ${mode === "login" ? '<button class="link" type="button" id="forgot">Forgot password?</button>' : ""}</div>`;
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => authForm(null, b.dataset.m)));
  $("#forgot")?.addEventListener("click", forgot);
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, go = $("#go"), body = { email: f.email.value.trim(), password: f.password.value };
    if (mode === "signup") body.name = f.name.value.trim();
    if (!body.email || !body.password) return msg($("#m"), "Please enter your email and password.");
    go.disabled = true; msg($("#m"), "");
    try {
      const d = await api(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", { method: "POST", body });
      if (mode === "signup" && !d.loggedIn) { msg($("#m"), d.message, "ok"); go.disabled = false; return; }
      start();
    } catch (err) { msg($("#m"), err.message); go.disabled = false; }
  });
}
function forgot() {
  box.innerHTML = `<h1 class="h1">Reset password</h1><div class="panel"><div id="m"></div><form id="f" novalidate><label class="f">Your account email<input name="email" type="email" autocomplete="email" required></label><button class="btn primary lg" style="width:100%;margin-top:14px" type="submit">Send reset link</button></form><button class="link" id="back" type="button">Back to log in</button></div>`;
  $("#back").onclick = () => authForm(); 
  $("#f").addEventListener("submit", async (e) => { e.preventDefault(); try { const d = await api("/api/auth/reset-request", { method: "POST", body: { email: e.target.email.value.trim() } }); msg($("#m"), d.message, "ok"); } catch (err) { msg($("#m"), err.message); } });
}
function resetForm(token) {
  history.replaceState(null, "", location.pathname);
  box.innerHTML = `<h1 class="h1">Set a new password</h1><div class="panel"><div id="m"></div><form id="f" novalidate><label class="f">New password <small>(at least 8 characters)</small><input name="p" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn primary lg" style="width:100%;margin-top:14px" type="submit">Update password</button></form></div>`;
  $("#f").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("/api/auth/update-password", { method: "POST", body: { accessToken: token, password: e.target.p.value } }); authForm({ t: "Password updated. Please log in.", k: "ok" }); } catch (err) { msg($("#m"), err.message); } });
}

async function home(isAdmin) {
  box.innerHTML = `<h1 class="h1">My account</h1><div class="panel"><b>${esc(user.name || "Welcome")}</b><div class="muted sm">${esc(user.email)}</div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${isAdmin ? '<a class="btn outline sm" href="/admin">Admin panel</a>' : ""}<button class="btn outline sm" id="out" type="button">Log out</button></div></div>
  <div class="panel"><h2>My orders</h2><div id="orders"><p class="muted">Loading…</p></div></div>`;
  $("#out").onclick = async () => { try { await api("/api/auth/logout", { method: "POST" }); } catch {} location.href = "/"; };
  try {
    const { orders } = await api("/api/orders/my");
    $("#orders").innerHTML = orders.length ? orders.map((o) => `<a class="ocard" href="/account?order=${encodeURIComponent(o.order_number)}"><div class="top2"><span>${esc(o.order_number)}</span><span>${money(o.total)}</span></div><div class="sm muted">${fmtDate(o.created_at)} · ${o.items.reduce((n, i) => n + (i.qty || 0), 0)} item(s)</div><div style="margin-top:4px">${statusBadge(o.order_status)} ${badge(o.payment_status === "paid" ? "paid" : o.payment_method === "COD" ? "COD · pay on delivery" : o.payment_status)}</div></a>`).join("") : '<p class="muted">You have not placed any orders yet.</p><a class="btn primary" href="/shop">Start shopping</a>';
  } catch (e) { $("#orders").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

const STAGES = [["pending", "Order Placed"], ["confirmed", "Order Confirmed"], ["processing", "Processing"], ["packed", "Packed"], ["shipped", "Shipped"], ["out_for_delivery", "Out for Delivery"], ["delivered", "Delivered"]];
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");
const RET_LABEL = { requested: "Request sent", approved: "Approved", rejected: "Rejected", pickup_scheduled: "Pickup scheduled", in_transit: "Return in transit", returned: "Returned", refund_processing: "Refund processing", refunded: "Refunded", cancelled: "Cancelled" };

function timelineHtml(o, events) {
  const at = {};
  for (const e of events) if (e.to_status && !at[e.to_status]) at[e.to_status] = e.created_at;
  at.pending = at.pending || o.created_at;
  const idx = STAGES.findIndex(([k]) => k === o.order_status);
  const ended = o.order_status === "cancelled";
  const reachedIdx = Math.max(-1, ...STAGES.map(([k], i) => (at[k] ? i : -1)));
  const cur = o.order_status === "cancellation_requested" ? reachedIdx : idx;
  const steps = STAGES.filter(([k], i) => at[k] || (!ended && i > cur));            // skipped stages are not shown
  const html = steps.map(([k, name]) => { const done = !!at[k]; const isCur = done && STAGES.findIndex(([x]) => x === k) === cur && !ended; return `<li class="${done ? "done" : ""}${isCur ? " cur" : ""}"><b>${esc(name)}</b>${done ? `<small>${esc(when(at[k]))}</small>` : '<small>Pending</small>'}</li>`; }).join("");
  const extra = (o.order_status === "cancellation_requested" ? `<li class="cur warnstep"><b>Cancellation requested</b><small>${esc(when(o.cancel_requested_at))} · waiting for the shop to confirm</small></li>` : "") + (ended ? `<li class="bad"><b>Order Cancelled</b><small>${esc(when(at.cancelled))}${o.cancel_reason ? " · " + esc(o.cancel_reason) : ""}</small></li>` : "");
  return `<ol class="steps">${html}${extra}</ol>`;
}

async function orderDetail(num) {
  box.innerHTML = '<p class="muted">Loading order…</p>';
  let d;
  try { d = await api("/api/orders/my?number=" + encodeURIComponent(num)); } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div><a class="btn outline" href="/account">My orders</a>`; return; }
  const o = d.order;
  const placed = qs.get("placed");
  const banner = placed === "paid" ? ["Payment received. Your order is confirmed. Thank you!", "ok"] : placed === "cod" ? ["Order placed. You will pay in cash on delivery. Thank you!", "ok"] : placed === "unpaid" ? ["Your order is saved but the payment could not be started. You can pay below or cancel the order.", "info"] : null;
  const canPay = o.payment_method === "ONLINE" && ["pending", "failed"].includes(o.payment_status) && o.order_status === "pending";
  const canCancel = ["pending", "confirmed", "processing", "packed"].includes(o.order_status);
  const instant = o.order_status === "pending" && o.payment_status !== "paid";
  box.innerHTML = `<a class="link" href="/account">‹ My orders</a><h1 class="h1">Order ${esc(o.order_number)}</h1>${banner ? `<div class="msg ${banner[1]}">${esc(banner[0])}</div>` : ""}<div id="m"></div>
  <div class="panel"><div>${statusBadge(o.order_status)} ${badge(o.payment_status === "paid" ? "paid" : o.payment_status)} ${o.refund_status ? `<span class="badge warn">Refund ${esc(o.refund_status)}</span>` : ""}</div><p class="sm muted">Placed ${fmtDate(o.created_at)} · ${o.payment_method === "COD" ? "Cash on Delivery" : "Online payment"} · payment ${esc(o.payment_status)}</p>
   ${o.tracking_id ? `<p class="sm"><b>Courier:</b> ${esc(o.courier_name || "")} · <b>Tracking ID:</b> ${esc(o.tracking_id)}${/^https?:\/\//i.test(o.tracking_url || "") ? ` · <a href="${esc(o.tracking_url)}" target="_blank" rel="noopener">Track on courier site</a>` : ""}</p>` : '<p class="sm muted">Courier tracking will appear here once the shop adds it.</p>'}
   ${canPay ? '<button class="btn primary lg" style="width:100%" id="pay" type="button">Pay now</button>' : ""}
   ${canCancel ? '<button class="btn danger" style="width:100%;margin-top:8px" id="cancelBtn" type="button">Cancel order</button><div id="cancelBox" hidden></div>' : ""}</div>
  <div class="panel"><h2>Order status</h2>${timelineHtml(o, d.timeline)}</div>
  <div class="panel"><h2>Items</h2>${o.items.map((i) => itemHtml(i, o)).join("")}
   <div class="tot"><span>Item subtotal</span><span>${money(o.subtotal)}</span></div><div class="tot"><span>Delivery</span><span>${Number(o.shipping) ? money(o.shipping) : "FREE"}</span></div><div class="tot big"><span>Final total</span><span>${money(o.total)}</span></div></div>
  <div class="panel"><h2>Delivery address</h2><p style="margin:0">${esc(o.customer_name)}<br>${esc(o.address)}<br>${esc(o.city || "")}, ${esc(o.state || "")} - ${esc(o.pincode || "")}<br>📞 ${esc(o.phone)}</p></div>
  <p class="sm muted">Need help? <a href="https://wa.me/919927892667" target="_blank" rel="noopener">WhatsApp us</a> with order no. ${esc(o.order_number)}.</p>`;
  $("#pay")?.addEventListener("click", async (e) => {
    e.target.disabled = true; msg($("#m"), "");
    try {
      const r = await api("/api/pay", { method: "POST", body: { orderNumber: o.order_number } });
      await payOnline({ orderNumber: o.order_number, razorpay: r.razorpay, prefill: { name: o.customer_name, contact: o.phone, email: o.email || undefined },
        onPaid: () => (location.href = `/account?order=${encodeURIComponent(o.order_number)}&placed=paid`),
        onProblem: (t) => { msg($("#m"), t); e.target.disabled = false; }, onDismiss: () => { e.target.disabled = false; } });
    } catch (err) { msg($("#m"), err.message); e.target.disabled = false; }
  });
  $("#cancelBtn")?.addEventListener("click", () => {
    const cb = $("#cancelBox"); cb.hidden = false; $("#cancelBtn").hidden = true;
    cb.innerHTML = `<p class="sm" style="margin:10px 0">${instant ? "This order is not paid or confirmed yet, so it will be <b>cancelled immediately</b>." : "This is a <b>cancellation request</b>. Your order is cancelled only after the shop confirms it. If you already paid, your refund is handled by the shop."}</p>
     <label class="f">Reason <small>(optional)</small><input id="cReason" maxlength="300"></label><div class="stbtns"><button class="btn danger" id="cYes" type="button">${instant ? "Yes, cancel order" : "Send cancellation request"}</button><button class="btn outline" id="cNo" type="button">Keep order</button></div>`;
    $("#cNo").onclick = () => { cb.hidden = true; $("#cancelBtn").hidden = false; };
    $("#cYes").onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api("/api/orders/my", { method: "POST", body: { action: "cancel", orderNumber: o.order_number, reason: $("#cReason").value.trim() } });
        await orderDetail(num); msg($("#m"), r.requested ? "Cancellation request sent. We will confirm it shortly." : "Your order has been cancelled.", "ok"); }
      catch (err) { msg($("#m"), err.message); e.target.disabled = false; }
    };
  });
  box.querySelectorAll("[data-ret]").forEach((b) => b.addEventListener("click", () => returnForm(o, d, Number(b.dataset.idx), b.dataset.ret, num)));
}

function itemHtml(i, o) {
  const ri = i.return_info || {}, pol = ri.policy || {}, rr = i.return_request;
  const line = pol.eligible === true ? `Returnable${ri.return_deadline ? ` until ${new Date(ri.return_deadline).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ` within ${pol.window_days} days of delivery`}`
    : pol.eligible === false ? "Non-Returnable" : "Return policy: ask the shop";
  return `<div class="row"><div>${imgTag(i.image, i.name, { w: 76, h: 76 })}</div><div><div class="nm">${i.slug ? `<a href="/product/${esc(i.slug)}">${esc(i.name)}</a>` : esc(i.name)}</div>
   <div class="muted sm">${[i.variant_label || i.size, packNote(i.variant_label, i.pack_qty), i.sku ? "SKU " + i.sku : ""].filter(Boolean).map(esc).join(" · ")}</div>
   <div class="sm">Qty ${i.qty ?? 1} × ${money(i.unit_price ?? i.price ?? 0)} = <b>${money((i.unit_price ?? i.price ?? 0) * (i.qty ?? 1))}</b></div>
   <div class="sm ${pol.eligible === false ? "" : "muted"}"><b>${esc(line)}</b>${pol.conditions ? ` · ${esc(pol.conditions)}` : ""}</div>${ri.note && !rr ? `<div class="muted sm">${esc(ri.note)}</div>` : ""}
   ${rr ? `<div class="sm" style="margin-top:4px"><span class="badge b-${esc(rr.status)}">${esc(RET_LABEL[rr.status] || rr.status)}</span> ${rr.kind === "issue" ? "Problem report" : "Return request"}${rr.decision_reason ? ` · ${esc(rr.decision_reason)}` : ""}</div>` : ""}
   <div class="ctl">${ri.can_return ? `<button class="btn outline sm" type="button" data-ret="return" data-idx="${i.index}">Return item</button>` : ""}${ri.can_report_issue ? `<button class="btn outline sm" type="button" data-ret="issue" data-idx="${i.index}">Report a problem</button>` : ""}</div><div id="rf${i.index}"></div></div></div>`;
}

function returnForm(o, d, idx, kind, num) {
  const it = o.items[idx], host = $("#rf" + idx), reasons = kind === "issue" ? d.reasons.issue : d.reasons.return;
  const photos = [];
  host.innerHTML = `<div class="fpanel"><b>${kind === "issue" ? "Report a problem (damaged / defective / wrong item)" : "Request a return"}</b>
   <label class="f">Reason *<select id="rr${idx}"><option value="">Choose…</option>${reasons.map((r) => `<option>${esc(r)}</option>`).join("")}</select></label>
   ${Number(it.qty) > 1 ? `<label class="f">How many? <input id="rq${idx}" type="number" min="1" max="${it.qty}" value="${it.qty}"></label>` : ""}
   <label class="f">Details <small>(optional)</small><textarea id="rd${idx}" maxlength="500" rows="2"></textarea></label>
   <label class="f">Photos <small>(optional, up to 3)</small><input id="rp${idx}" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="rpv${idx}" class="sm muted"></div>
   <div id="rm${idx}"></div><div class="stbtns"><button class="btn primary" type="button" id="rs${idx}">Send request</button><button class="btn outline" type="button" id="rc${idx}">Close</button></div></div>`;
  $("#rc" + idx).onclick = () => { host.innerHTML = ""; };
  $("#rp" + idx).addEventListener("change", async (e) => {
    const files = [...e.target.files].slice(0, 3 - photos.length); e.target.value = "";
    for (const f of files) { try { photos.push(await shrink(f)); } catch (err) { msg($("#rm" + idx), err.message); } }
    $("#rpv" + idx).textContent = photos.length ? `${photos.length} photo(s) ready` : "";
  });
  $("#rs" + idx).onclick = async (e) => {
    const reason = $("#rr" + idx).value; if (!reason) return msg($("#rm" + idx), "Please choose a reason.");
    e.target.disabled = true; msg($("#rm" + idx), "");
    try {
      const urls = []; for (const b of photos) urls.push(await upload(b, "/api/upload-return-photo"));
      await api("/api/orders/my", { method: "POST", body: { action: "return", orderNumber: o.order_number, itemIndex: idx, kind, reason, qty: Number($("#rq" + idx)?.value || it.qty), details: $("#rd" + idx).value.trim(), photos: urls } });
      await orderDetail(num); msg($("#m"), "Your request was sent to the shop. You can follow it on this page.", "ok");
    } catch (err) { msg($("#rm" + idx), err.message); e.target.disabled = false; }
  };
}

start();
