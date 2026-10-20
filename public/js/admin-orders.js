// Admin: Orders dashboard + Returns tab.
import { api, esc, money, $, $$, msg, badge, statusBadge, fmtDate, toast } from "./common.js";
import { imgTag } from "./render.js";
import { openSheet, label, debounce } from "./admin-shared.js";
import { packNote } from "./cartlogic.js";

// Same rules as the database function (the server is the authority; this only hides impossible buttons).
const NEXT = { pending: ["confirmed", "cancelled"], confirmed: ["processing", "packed", "cancelled"], processing: ["packed", "cancelled"], packed: ["shipped", "cancelled"], shipped: ["out_for_delivery", "delivered"], out_for_delivery: ["delivered"], delivered: [], cancellation_requested: ["cancelled"], cancelled: [] };
const RETURN_NEXT = { requested: ["approved", "rejected"], approved: ["pickup_scheduled", "returned", "refund_processing", "rejected"], pickup_scheduled: ["in_transit", "returned"], in_transit: ["returned"], returned: ["refund_processing", "refunded"], refund_processing: ["refunded"], rejected: [], refunded: [], cancelled: [] };
const rl = (s) => String(s || "").replace(/_/g, " ");
let F = { search: "", status: "", delivery: "", payment: "", method: "", from: "", to: "", sort: "date_desc", page: 1 };
let list = { orders: [], total: 0, pages: 1 };

export async function loadOrders() {
  $("#pane").innerHTML = `<div class="fpanel"><div class="fgrid2">
   <label class="f">Search<input id="os" type="search" placeholder="Order no., name, mobile…" value="${esc(F.search)}"></label>
   <label class="f">Order status<select id="of"><option value="">All</option>${Object.keys(NEXT).map((s) => `<option value="${s}" ${F.status === s ? "selected" : ""}>${label(s)}</option>`).join("")}</select></label>
   <label class="f">Delivery<select id="od"><option value="">All</option>${[["not_shipped", "Not shipped yet"], ["in_transit", "On the way"], ["delivered", "Delivered"], ["cancelled", "Cancelled / requested"]].map(([v, t]) => `<option value="${v}" ${F.delivery === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
   <label class="f">Payment status<select id="op"><option value="">All</option>${["pending", "paid", "failed", "cancelled"].map((s) => `<option ${F.payment === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
   <label class="f">Payment method<select id="om"><option value="">All</option><option value="COD" ${F.method === "COD" ? "selected" : ""}>Cash on Delivery</option><option value="ONLINE" ${F.method === "ONLINE" ? "selected" : ""}>Online</option></select></label>
   <label class="f">Sort<select id="osort">${[["date_desc", "Newest first"], ["date_asc", "Oldest first"], ["total_desc", "Total high to low"], ["total_asc", "Total low to high"]].map(([v, t]) => `<option value="${v}" ${F.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
   <label class="f">From date<input id="ofrom" type="date" value="${esc(F.from)}"></label><label class="f">To date<input id="oto" type="date" value="${esc(F.to)}"></label></div>
   <button class="btn outline sm" id="oclear" type="button" style="margin-top:10px">Clear filters</button></div><p class="sm muted" id="ocount"></p><div id="ol"><p class="muted">Loading…</p></div><div id="opg"></div>`;
  const go = () => { F.page = 1; fetchOrders(); };
  $("#os").addEventListener("input", debounce((e) => { F.search = e.target.value.trim(); go(); }));
  for (const [id, k] of [["of", "status"], ["od", "delivery"], ["op", "payment"], ["om", "method"], ["osort", "sort"], ["ofrom", "from"], ["oto", "to"]]) $("#" + id).addEventListener("change", (e) => { F[k] = e.target.value; go(); });
  $("#oclear").onclick = () => { F = { search: "", status: "", delivery: "", payment: "", method: "", from: "", to: "", sort: "date_desc", page: 1 }; loadOrders(); };
  fetchOrders();
}
async function fetchOrders() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(F)) if (v !== "" && k !== "page") p.set(k, v);
  p.set("page", F.page);
  try { list = await api("/api/admin/orders?" + p); } catch (e) { $("#ol").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  $("#ocount").textContent = list.total ? `${list.total} order(s)` : "";
  $("#ol").innerHTML = list.orders.map((o) => `<button class="pcard" style="display:block;width:100%;text-align:left;font:inherit;cursor:pointer" data-o="${esc(o.order_number)}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(o.order_number)}</b><b>${money(o.total)}</b></div>
   <div class="meta">${esc(o.customer_name)} · ${esc(o.phone)} · ${o.items_count} item(s) · ${fmtDate(o.created_at)}</div>
   <div style="margin-top:6px">${statusBadge(o.order_status)} <span class="badge b-${esc(o.payment_status)}">pay: ${esc(o.payment_status)}</span> <span class="badge">${o.payment_method === "COD" ? "COD" : "Online"}</span>${o.returns_open ? ` <span class="badge warn">${o.returns_open} return(s)</span>` : ""}${o.refund_status ? ` <span class="badge warn">refund ${esc(o.refund_status)}</span>` : ""}</div></button>`).join("") || '<p class="empty">No orders found.</p>';
  $("#opg").innerHTML = list.pages > 1 ? `<div class="pager2"><button class="btn outline sm" data-opg="-1" ${list.page <= 1 ? "disabled" : ""}>‹ Previous</button><span class="sm muted">Page ${list.page} of ${list.pages}</span><button class="btn outline sm" data-opg="1" ${list.page >= list.pages ? "disabled" : ""}>Next ›</button></div>` : "";
}
document.addEventListener("click", (e) => {
  const pg = e.target.closest("[data-opg]"); if (pg && $("#ol")) { F.page += Number(pg.dataset.opg); fetchOrders(); window.scrollTo(0, 0); return; }
  const b = e.target.closest("[data-o]"); if (b && $("#ol")) orderSheet(b.dataset.o);
});

async function orderSheet(num) {
  let d;
  try { d = await api("/api/admin/orders?number=" + encodeURIComponent(num)); } catch (e) { return alert(e.message); }
  const sh = openSheet(""); const el = sh.el;
  const draw = () => {
    const o = d.order, next = NEXT[o.order_status] || [];
    const nextBtns = o.order_status === "cancellation_requested"
      ? `<button class="btn primary sm" data-act="status" data-v="cancelled">Approve cancellation</button><button class="btn outline sm" data-act="decline">Decline (restore “${esc(label(o.status_before_request || "confirmed"))}”)</button>`
      : next.map((s) => `<button class="btn ${s === "cancelled" ? "danger" : "primary"} sm" data-act="status" data-v="${s}">${s === "cancelled" ? "Cancel order" : "Mark: " + esc(label(s))}</button>`).join("") || '<span class="muted sm">No further status changes.</span>';
    el.innerHTML = `<div class="sheet-in"><div class="sheet-h"><h2>${esc(o.order_number)}</h2><button class="btn outline sm" id="x" type="button">Close</button></div><div id="m"></div>
    <div class="panel"><div>${statusBadge(o.order_status)} <span class="badge b-${esc(o.payment_status)}">payment: ${esc(o.payment_status)}</span> ${o.refund_status ? `<span class="badge warn">refund: ${esc(o.refund_status)}</span>` : ""}</div>
     <dl class="dl"><div><dt>Placed</dt><dd>${fmtDate(o.created_at)}</dd></div><div><dt>Payment</dt><dd>${o.payment_method === "COD" ? "Cash on Delivery" : "Online (Razorpay)"}</dd></div>${o.razorpay_payment_id ? `<div><dt>Payment ID</dt><dd>${esc(o.razorpay_payment_id)}</dd></div>` : ""}${o.delivered_at ? `<div><dt>Delivered</dt><dd>${fmtDate(o.delivered_at)}</dd></div>` : ""}${o.cancel_reason ? `<div><dt>Cancel reason</dt><dd>${esc(o.cancel_reason)}</dd></div>` : ""}</dl>
     ${o.order_status === "cancellation_requested" ? '<div class="msg info"><b>Customer asked to cancel.</b> The order is NOT cancelled until you approve.</div>' : ""}
     ${o.admin_note && /PAID AFTER CANCELLATION/.test(o.admin_note) ? '<div class="msg err">Customer paid after this order was cancelled. Refund in Razorpay.</div>' : ""}</div>
    <div class="panel"><h2>Update status</h2><div class="stbtns">${nextBtns}</div><label class="f">Note for the customer timeline <small>(optional)</small><input id="stnote" maxlength="300"></label>
     <p class="sm muted">Only valid next steps are shown. Cancelling returns the stock. COD orders become “paid” when delivered.</p></div>
    <div class="panel"><h2>Courier tracking</h2><div class="fgrid2"><label class="f">Courier<input id="tc" maxlength="60" value="${esc(o.courier_name || "")}"></label><label class="f">Tracking ID<input id="tid" maxlength="80" value="${esc(o.tracking_id || "")}"></label><label class="f">Tracking link<input id="tu" maxlength="300" value="${esc(o.tracking_url || "")}" placeholder="https://…"></label></div>
     <button class="btn outline sm" data-act="tracking" type="button" style="margin-top:8px">Save tracking</button><p class="sm muted">Customers see this only if you fill it in. No fake tracking is shown.</p></div>
    ${o.payment_status === "paid" || o.order_status === "cancelled" ? `<div class="panel"><h2>Refund</h2><p class="sm muted">Refund the money yourself in the Razorpay dashboard, then record it here.</p><div class="stbtns"><button class="btn outline sm" data-act="refund" data-v="processing">Mark: refund processing</button><button class="btn primary sm" data-act="refund" data-v="refunded">Mark: refunded</button></div></div>` : ""}
    <div class="panel"><h2>Customer</h2><dl class="dl"><div><dt>Name</dt><dd>${esc(o.customer_name)}</dd></div><div><dt>Phone</dt><dd><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · <a href="https://wa.me/91${esc(o.phone)}" target="_blank" rel="noopener">WhatsApp</a></dd></div>${o.email ? `<div><dt>Email</dt><dd>${esc(o.email)}</dd></div>` : ""}<div><dt>Address</dt><dd>${esc(o.address)}<br>${esc(o.city || "")}, ${esc(o.state || "")} - ${esc(o.pincode || "")}</dd></div></dl></div>
    <div class="panel"><h2>Items</h2>${o.items.map((i) => `<div class="row"><div>${imgTag(i.image, i.name, { w: 76, h: 76 })}</div><div><div class="nm">${esc(i.name)}</div><div class="muted sm">${[i.variant_label || i.size, packNote(i.variant_label, i.pack_qty), i.sku ? "SKU " + i.sku : ""].filter(Boolean).map(esc).join(" · ")}</div><div class="muted sm">Qty ${i.qty ?? 1} × ${money(i.unit_price ?? i.price ?? 0)} = <b>${money((i.unit_price ?? 0) * (i.qty ?? 1))}</b></div>${i.pack_qty > 1 ? `<div class="muted sm">Stock used: ${i.qty * i.pack_qty} pieces</div>` : ""}<div class="muted sm">Return: ${i.return_policy?.eligible === true ? `allowed, ${i.return_policy.window_days} days` : i.return_policy?.eligible === false ? "non-returnable" : "not set"}</div></div></div>`).join("")}
     <div class="tot"><span>Item subtotal</span><span>${money(o.subtotal)}</span></div><div class="tot"><span>Delivery</span><span>${Number(o.shipping) ? money(o.shipping) : "FREE"}</span></div><div class="tot big"><span>Final total</span><span>${money(o.total)}</span></div></div>
    ${d.returns.length ? `<div class="panel"><h2>Return requests</h2>${d.returns.map((r) => `<p style="margin:0 0 8px"><b>${esc(r.product_name)}</b> × ${r.qty} · ${r.kind === "issue" ? "problem" : "return"} · <span class="badge b-${esc(r.status)}">${esc(rl(r.status))}</span><br><small>${esc(r.reason)}</small></p>`).join("")}<p class="sm muted">Manage them in the Returns tab.</p></div>` : ""}
    <div class="panel"><h2>History (admin view)</h2><ul class="tl">${d.events.map((ev) => `<li><b>${esc(ev.to_status ? label(ev.to_status) : rl(ev.event_type))}</b> <small>${esc(ev.actor)} · ${fmtDate(ev.created_at)}</small>${ev.note ? `<br>${esc(ev.note)}` : ""}</li>`).join("") || "<li>No history yet</li>"}</ul></div>
    <div class="panel"><h2>Internal note</h2><textarea id="note" maxlength="500" placeholder="Only you can see this">${esc(o.admin_note || "")}</textarea><button class="btn outline sm" data-act="note" type="button" style="margin-top:8px">Save note</button></div></div>`;
    $("#x", el).onclick = sh.close;
  };
  draw();
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, body = { orderNumber: num, action: act }, v = b.dataset.v;
    if (act === "status") { body.status = v; body.note = $("#stnote", el).value; if (v === "cancelled" && !confirm("Cancel this order? Stock will be returned. If the customer already paid, you must refund them.")) return; }
    if (act === "decline") { body.action = "decline_cancellation"; body.note = $("#stnote", el).value; }
    if (act === "tracking") Object.assign(body, { courier_name: $("#tc", el).value, tracking_id: $("#tid", el).value, tracking_url: $("#tu", el).value });
    if (act === "refund") body.refund_status = v;
    if (act === "note") body.note = $("#note", el).value;
    b.disabled = true;
    try {
      await api("/api/admin/orders", { method: "PATCH", body });
      d = await api("/api/admin/orders?number=" + encodeURIComponent(num)); draw(); toast("Saved"); if ($("#ol")) fetchOrders();
    } catch (err) { b.disabled = false; msg($("#m", el), err.message); el.scrollTo(0, 0); }
  });
}

/* ------------------------------ RETURNS ------------------------------ */
let RS = "";
export async function loadReturns() {
  $("#pane").innerHTML = `<div class="fchips" id="rchips">${[["", "All"], ["requested", "New"], ["approved", "Approved"], ["pickup_scheduled", "Pickup"], ["in_transit", "In transit"], ["returned", "Returned"], ["refund_processing", "Refund processing"], ["refunded", "Refunded"], ["rejected", "Rejected"]].map(([v, t]) => `<button type="button" data-rs="${v}" class="${RS === v ? "on" : ""}">${t}</button>`).join("")}</div><div id="rl"><p class="muted">Loading…</p></div>`;
  $("#rchips").addEventListener("click", (e) => { const b = e.target.closest("[data-rs]"); if (b) { RS = b.dataset.rs; loadReturns(); } });
  let d;
  try { d = await api("/api/admin/returns" + (RS ? "?status=" + RS : "")); } catch (e) { $("#rl").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  $("#rl").innerHTML = d.returns.map((r) => `<div class="pcard" style="grid-template-columns:1fr" data-rid="${r.id}"><div><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(r.product_name)} × ${r.qty}</b><span class="badge b-${esc(r.status)}">${esc(rl(r.status))}</span></div>
   <div class="meta">${r.kind === "issue" ? "Problem report (damaged / defective / wrong)" : "Return request"} · order ${esc(r.order?.order_number || "")} · ${esc(r.order?.customer_name || "")} ${esc(r.order?.phone || "")}</div>
   <div class="meta">Reason: <b>${esc(r.reason)}</b>${r.details ? ` · ${esc(r.details)}` : ""} · ${fmtDate(r.created_at)}</div>
   ${(r.photos || []).length ? `<div style="display:flex;gap:6px;margin:6px 0">${r.photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Customer photo" width="64" height="64" loading="lazy" style="width:64px;height:64px;object-fit:cover;border-radius:8px"></a>`).join("")}</div>` : ""}
   ${r.decision_reason ? `<div class="meta">Message to customer: ${esc(r.decision_reason)}</div>` : ""}
   ${(RETURN_NEXT[r.status] || []).length ? `<label class="f">Message to customer (required when rejecting)<input data-dr maxlength="400" value=""></label>${r.status === "returned" || r.status === "refund_processing" ? `<label class="f">Refund amount ₹<input data-ra type="number" inputmode="decimal" value="${esc(r.refund_amount ?? "")}"></label>` : ""}
   <div class="acts">${RETURN_NEXT[r.status].map((s) => `<button class="btn ${s === "rejected" ? "danger" : "primary"} sm" data-rn="${s}">${s === "rejected" ? "Reject" : "Mark: " + esc(rl(s))}</button>`).join("")}</div>` : ""}</div></div>`).join("") || '<p class="empty">No requests here.</p>';
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-rn]"); if (!b || !$("#rl")) return;
  const card = b.closest("[data-rid]"), id = Number(card.dataset.rid), status = b.dataset.rn;
  const body = { id, status, decision_reason: $("[data-dr]", card)?.value || undefined };
  const ra = $("[data-ra]", card); if (ra && ra.value !== "") body.refund_amount = ra.value;
  if (status === "rejected" && !body.decision_reason) return alert("Please write the reason for rejecting. The customer will see it.");
  if (!confirm(`Change this request to “${rl(status)}”? The customer is notified.`)) return;
  b.disabled = true;
  try { await api("/api/admin/returns", { method: "PATCH", body }); toast("Updated"); loadReturns(); } catch (err) { b.disabled = false; alert(err.message); }
});
