import { api, cart, esc, money, $, msg, payOnline } from "./common.js";
import { imgTag } from "./render.js";
import { resolveLine, summarize, packNote } from "./cartlogic.js";
import { deliveryRuleText } from "./delivery.js";

const box = $("#box");
const SAVED = "sjc_addr_v2", IDEM = "sjc_idem_v1";
let user, lines = [], sum = null, busy = false;

const saved = () => { try { return JSON.parse(localStorage.getItem(SAVED) || "{}"); } catch { return {}; } };
const sig = (items) => items.map((i) => `${i.id}:${i.v}:${i.size}:${i.qty}`).sort().join("|");
function idemKey(items, pm) {   // same key for retries of the SAME cart => the server never creates a duplicate order
  const s = pm + "#" + sig(items);
  try { const c = JSON.parse(sessionStorage.getItem(IDEM) || "{}"); if (c.sig === s && c.key) return c.key; } catch {}
  const key = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2, 12);
  try { sessionStorage.setItem(IDEM, JSON.stringify({ sig: s, key })); } catch {}
  return key;
}

async function start() {
  try {
    const me = await api("/api/auth/me"); user = me.user;
    if (!user) { box.innerHTML = `<div class="panel"><h2>Please log in to place your order</h2><p class="muted">Logging in lets you track your order and see it later in My Orders.</p><a class="btn primary lg" style="width:100%" href="/account?next=/checkout">Log in / Create account</a></div>`; return; }
    const items = cart.read();
    if (!items.length) { box.innerHTML = `<div class="empty"><p>Your cart is empty.</p><a class="btn primary" href="/category/thakur-ji-poshak">Shop Thakur Ji Poshak</a></div>`; return; }
    const d = await api("/api/products?ids=" + [...new Set(items.map((i) => i.id))].join(","));
    const by = Object.fromEntries(d.products.map((p) => [p.id, p]));
    lines = items.map((i) => resolveLine(i, by[i.id]));
    sum = summarize(lines);
    if (sum.blocked) {
      const bad = lines.filter((l) => l.bad).map((l) => `${l.p?.name || "An item"}: ${l.bad}`).concat(sum.moq.map((m) => `${m.name}: minimum order is ${m.min}`));
      box.innerHTML = `<div class="msg err">${bad.map(esc).join("<br>")}</div><a class="btn primary" href="/cart">Back to cart</a>`; return;
    }
    draw();
  } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div><button class="btn outline" id="retry">Try again</button>`; $("#retry").onclick = start; }
}

function draw() {
  const s = saved();
  box.innerHTML = `<form id="f" novalidate class="cartgrid"><div>
  <div class="panel"><h2>Contact</h2>
   <label class="f">Full name *<input name="name" autocomplete="name" required maxlength="80" value="${esc(s.name || user.name || "")}"></label>
   <label class="f">Mobile number *<input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" required maxlength="14" placeholder="10-digit mobile number" value="${esc(s.phone || "")}"></label>
   <label class="f">Email <small>(optional, for order updates)</small><input name="email" type="email" autocomplete="email" maxlength="120" value="${esc(s.email || user.email || "")}"></label></div>
  <div class="panel"><h2>Delivery address</h2>
   <label class="f">House / Flat number *<input name="house" autocomplete="address-line1" required maxlength="80" value="${esc(s.house || "")}"></label>
   <label class="f">Street / Locality *<input name="locality" autocomplete="address-line2" required maxlength="120" value="${esc(s.locality || "")}"></label>
   <label class="f">Landmark <small>(optional)</small><input name="landmark" maxlength="80" value="${esc(s.landmark || "")}"></label>
   <div class="two"><label class="f">City / Town *<input name="city" autocomplete="address-level2" required maxlength="60" value="${esc(s.city || "")}"></label>
   <label class="f">State *<input name="state" autocomplete="address-level1" required maxlength="60" value="${esc(s.state || "Uttar Pradesh")}"></label></div>
   <label class="f">PIN code *<input name="pincode" inputmode="numeric" autocomplete="postal-code" required maxlength="6" pattern="[0-9]{6}" value="${esc(s.pincode || "")}"></label></div>
  <div class="panel"><h2>Payment</h2><div class="paybox">
   <label class="pay"><input type="radio" name="pm" value="COD" checked><span><b>Cash on Delivery</b><small>Pay in cash when your order arrives</small></span></label>
   <label class="pay"><input type="radio" name="pm" value="ONLINE"><span><b>Pay online</b><small>UPI / Google Pay / PhonePe / cards / netbanking via Razorpay</small></span></label></div>
   <p class="note">Never share your UPI PIN or card OTP with anyone. We never ask for it.</p></div></div>
  <div class="panel"><h2>Review your order</h2>${lines.map((l) => `<div class="row"><div>${imgTag(l.p.image_urls?.[0], l.p.name, { w: 76, h: 76 })}</div><div><div class="nm">${esc(l.p.name)}</div><div class="muted sm">${[l.label, packNote(l.label, l.pack)].filter(Boolean).map(esc).join(" · ")}</div>
    <div class="sm">${money(l.unit)}${l.mrp ? ` <s class="muted">${money(l.mrp)}</s>` : ""} × ${l.qty} = <b>${money(l.unit * l.qty)}</b></div>
    <div class="muted sm">${l.p.return_eligible === true ? `Returnable within ${esc(l.p.return_window_days)} days of delivery` : l.p.return_eligible === false ? "Non-returnable" : "Return policy: ask the shop"}</div></div></div>`).join("")}
   <div class="tot" style="margin-top:8px"><span>Item subtotal</span><span>${money(sum.subtotal)}</span></div><div class="tot"><span>Delivery</span><span>${sum.delivery ? money(sum.delivery) : "FREE"}</span></div>
   <div class="tot big"><span>Total payable</span><span>${money(sum.total)}</span></div>
   ${sum.freeNote ? `<p class="sm" style="color:var(--m)"><b>${esc(sum.freeNote)}</b></p>` : ""}<p class="sm muted">${esc(deliveryRuleText)}</p>
   <div id="m"></div><button class="btn primary lg" style="width:100%" id="go" type="submit">Place order</button>
   <p class="sm muted">By placing the order you confirm the details above are correct.</p></div></form>`;
  $("#f").addEventListener("submit", submit);
}

function fail(text) { msg($("#m"), text); busy = false; const b = $("#go"); if (b) { b.disabled = false; b.textContent = "Place order"; } }
function finish(num, text) { cart.clear(); try { sessionStorage.removeItem(IDEM); } catch {} location.href = `/account?order=${encodeURIComponent(num)}&placed=${text}`; }

async function submit(e) {
  e.preventDefault();
  if (busy) return;
  const f = e.target, v = (n) => f.elements[n].value.trim();
  const c = { name: v("name"), phone: v("phone"), email: v("email"), house: v("house"), locality: v("locality"), landmark: v("landmark"), city: v("city"), state: v("state"), pincode: v("pincode") };
  if (c.name.length < 2) return fail("Please enter your name.");
  if (!/^(\+?91|0)?[6-9]\d{9}$/.test(c.phone.replace(/[\s-]/g, ""))) return fail("Please enter a valid 10-digit mobile number.");
  if (!c.house) return fail("Please enter your house / flat number.");
  if (c.locality.length < 3) return fail("Please enter your street / locality.");
  if (c.city.length < 2 || c.state.length < 2) return fail("Please enter your city and state.");
  if (!/^[1-9]\d{5}$/.test(c.pincode)) return fail("Please enter a valid 6-digit PIN code.");
  const pm = f.elements.pm.value;
  busy = true; $("#go").disabled = true; $("#go").textContent = "Placing order…"; msg($("#m"), "");
  try { localStorage.setItem(SAVED, JSON.stringify(c)); } catch {}
  const items = lines.map((l) => ({ productId: l.p.id, variantId: l.item.v || null, qty: l.qty, size: l.item.size }));
  try {
    const d = await api("/api/orders", { method: "POST", body: { customer: c, items, paymentMethod: pm, idempotencyKey: idemKey(lines.map((l) => ({ id: l.p.id, v: l.item.v || 0, size: l.item.size, qty: l.qty })), pm) } });
    if (pm === "COD") return finish(d.orderNumber, "cod");
    if (!d.razorpay) return finish(d.orderNumber, "unpaid");
    $("#go").textContent = "Opening payment…";
    await payOnline({
      orderNumber: d.orderNumber, razorpay: d.razorpay, prefill: { name: c.name, contact: c.phone, email: c.email },
      onPaid: () => finish(d.orderNumber, "paid"),
      onProblem: (t) => { cart.clear(); box.innerHTML = `<div class="msg err">${esc(t)}</div><p>Order no: <b>${esc(d.orderNumber)}</b></p><a class="btn primary" href="/account?order=${encodeURIComponent(d.orderNumber)}">Open this order</a>`; },
      onDismiss: () => { cart.clear(); box.innerHTML = `<div class="msg info">Payment was not completed. Your order <b>${esc(d.orderNumber)}</b> is saved, and you can pay or cancel it from My Orders.</div><a class="btn primary" href="/account?order=${encodeURIComponent(d.orderNumber)}">Go to my order</a>`; },
    });
  } catch (err) { fail(err.message); }
}
start();
