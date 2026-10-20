import { api, cart, sameItem, esc, money, $ } from "./common.js";
import { imgTag } from "./render.js";
import { resolveLine, summarize, packNote } from "./cartlogic.js";
import { deliveryRuleText } from "./delivery.js";

const box = $("#box");
let products = {};

async function load() {
  const items = cart.read();
  if (!items.length) { products = {}; return draw(); }
  try {
    const d = await api("/api/products?ids=" + [...new Set(items.map((i) => i.id))].join(","));
    products = Object.fromEntries(d.products.map((p) => [p.id, p]));
    draw();
  } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div><button class="btn outline" id="retry">Try again</button>`; $("#retry").onclick = load; }
}
function draw() {
  const items = cart.read();
  if (!items.length) { box.innerHTML = `<div class="empty"><p>Your cart is empty.</p><a class="btn primary" href="/category/thakur-ji-poshak">Shop Thakur Ji Poshak</a></div>`; return; }
  const lines = items.map((i) => resolveLine(i, products[i.id]));
  const sum = summarize(lines);
  const rows = lines.map((l, idx) => {
    const p = l.p, name = p?.name || "Unavailable product", i = l.item;
    const attrs = `data-i="${idx}"`;
    return `<div class="row"><div>${imgTag(p?.image_urls?.[0], name, { w: 76, h: 76 })}</div><div><div class="nm">${p ? `<a href="/product/${esc(p.slug)}">${esc(name)}</a>` : esc(name)}</div>
      <div class="muted sm">${[l.label, packNote(l.label, l.pack), l.sku ? "SKU " + l.sku : ""].filter(Boolean).map(esc).join(" · ")}${l.bad ? ` <span class="warn">${esc(l.bad)}</span>` : ""}</div>
      ${l.bad ? "" : `<div><b>${money(l.unit)}</b>${l.mrp ? ` <s class="muted sm">${money(l.mrp)}</s>` : ""} <span class="muted sm">× ${l.qty}${l.pack > 1 ? ` pack${l.qty > 1 ? "s" : ""} (${l.pieces} pieces)` : ""}</span></div><div class="sm"><b>Line total: ${money(l.unit * l.qty)}</b></div>${p.min_order_qty > 1 ? `<div class="muted sm">Minimum order: ${p.min_order_qty}</div>` : ""}`}
      <div class="ctl">${l.bad ? "" : `<div class="qty"><button type="button" data-a="dec" ${attrs} aria-label="Decrease quantity">−</button><output>${l.qty}</output><button type="button" data-a="inc" ${attrs} aria-label="Increase quantity" ${l.qty >= l.max ? "disabled" : ""}>+</button></div>`}
      <button class="rm" type="button" data-a="rm" ${attrs}>Remove</button></div></div></div>`;
  }).join("");
  const trimmed = lines.some((l) => l.trimmed);
  box.innerHTML = `<div class="cartgrid"><div class="panel">${rows}</div><div class="panel"><h2>Order summary</h2>
    ${trimmed ? '<div class="msg info">Some quantities were reduced to the stock we have.</div>' : ""}
    ${sum.moq.map((m) => `<div class="msg err">“${esc(m.name)}”: minimum order is ${m.min} (you have ${m.have}). Please increase the quantity.</div>`).join("")}
    <div class="tot"><span>Item subtotal</span><span>${money(sum.subtotal)}</span></div>
    <div class="tot"><span>Delivery</span><span>${sum.delivery ? money(sum.delivery) : "FREE"}</span></div>
    <div class="tot big"><span>Total payable</span><span>${money(sum.total)}</span></div>
    ${sum.freeNote ? `<p class="sm" style="color:var(--m)"><b>${esc(sum.freeNote)}</b></p>` : '<p class="sm" style="color:var(--ok)"><b>You get FREE delivery on this order.</b></p>'}
    <p class="sm muted">${esc(deliveryRuleText)}. The final price and stock are confirmed when you place the order.</p>
    ${sum.blocked && !sum.moq.length ? '<div class="msg err">Please remove the unavailable item(s) to continue.</div>' : ""}
    <a class="btn primary lg" style="width:100%;${sum.blocked ? "pointer-events:none;opacity:.55" : ""}" href="/checkout" ${sum.blocked ? 'aria-disabled="true"' : ""}>Proceed to checkout</a>
    <a class="btn outline" style="width:100%;margin-top:8px" href="/shop">Continue shopping</a></div></div>`;
  box._lines = lines;
}
box.addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const l = box._lines?.[Number(b.dataset.i)]; if (!l) return;
  const cur = cart.read().find((x) => sameItem(x, l.item));
  if (b.dataset.a === "rm") cart.remove(l.item);
  else if (cur) cart.setQty(l.item, cur.qty + (b.dataset.a === "inc" ? 1 : -1));
  draw();
});
load();
