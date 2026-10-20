// Product page: swipe gallery + zoom, option/variant selection, MOQ-aware quantity, add to cart.
import { cart, api, msg, $, $$, toast, esc, money } from "./common.js";
import { variantEff, unitsLeft } from "./render.js";

const pdp = $("#pdp");
if (pdp) {
  let D = {};
  try { D = JSON.parse($("#pdpData").textContent); } catch { /* page still works without JS data */ }
  const vs = D.variants || [], types = D.optionTypes || [];
  const msg = $("#pdpMsg"), out = $("#qVal");
  const moq = Math.max(1, D.moq || 1);
  let qty = moq;

  /* ---------- gallery: native swipe (scroll-snap), 1/N counter, thumbnails, zoom ---------- */
  const track = $("#galTrack"), count = $("#galCount"), ths = $$(".th", pdp);
  const n = (D.images || []).length;
  const goto = (i) => { if (track) track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" }); };
  let cur = 0;
  const mark = () => {
    if (!track) return; cur = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (count) count.textContent = `${cur + 1}/${n}`;
    ths.forEach((t, k) => t.classList.toggle("on", k === cur));
    ths[cur]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  track?.addEventListener("scroll", () => { clearTimeout(track._t); track._t = setTimeout(mark, 60); }, { passive: true });
  ths.forEach((t) => t.addEventListener("click", () => goto(Number(t.dataset.idx))));
  track?.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" && cur < n - 1) goto(cur + 1); if (e.key === "ArrowLeft" && cur > 0) goto(cur - 1); });
  // zoom: full-screen viewer. Pinch to zoom on phones (native), tap again to close.
  const zoom = (i) => {
    const box = document.createElement("div"); box.className = "zoom"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Zoomed photo");
    box.innerHTML = `<button type="button" class="zoom-x" aria-label="Close zoom">×</button><div class="zoom-body"><img alt="${esc(D.name || "Product photo")}"></div><div class="zoom-nav"><button type="button" data-d="-1" aria-label="Previous photo">‹</button><span></span><button type="button" data-d="1" aria-label="Next photo">›</button></div>`;
    document.body.appendChild(box); document.body.style.overflow = "hidden";
    let k = i; const img = $("img", box), label = $("span", box);
    const show = () => { img.src = D.images[k]; label.textContent = `${k + 1}/${n}`; img.classList.remove("z2"); };
    show();
    const close = () => { box.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", key); goto(k); };
    const key = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") { k = (k + 1) % n; show(); } if (e.key === "ArrowLeft") { k = (k - 1 + n) % n; show(); } };
    document.addEventListener("keydown", key);
    $(".zoom-x", box).onclick = close;
    img.addEventListener("click", () => img.classList.toggle("z2"));          // desktop: click to zoom in/out
    box.addEventListener("click", (e) => { const d = e.target.closest("[data-d]"); if (d) { k = (k + Number(d.dataset.d) + n) % n; show(); } else if (e.target === box || e.target.classList.contains("zoom-body")) close(); });
    // swipe between photos while not zoomed
    let x0 = null; box.addEventListener("touchstart", (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    box.addEventListener("touchend", (e) => { if (x0 === null || img.classList.contains("z2")) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 60) { k = (k + (dx < 0 ? 1 : -1) + n) % n; show(); } x0 = null; }, { passive: true });
    $(".zoom-x", box).focus();
  };
  $$(".gal-zoom", pdp).forEach((b) => b.addEventListener("click", () => zoom(Number(b.dataset.zoom))));

  /* ---------- options / variants ---------- */
  const chosen = () => Object.fromEntries(types.map((t) => [t, $(`input[name="opt_${t}"]:checked`, pdp)?.value || ""]));
  const current = () => { const c = chosen(); return types.length && types.every((t) => c[t]) ? vs.find((v) => types.every((t) => v.options[t] === c[t])) || null : null; };
  const maxFor = (v) => (v ? Math.min(99, unitsLeft(v.stock, v.pack)) : types.length ? 0 : Math.min(99, unitsLeft(D.stock, D.pack)));
  const sync = () => {
    const v = current(), c = chosen();
    // grey out option values that no in-stock variant offers together with the other chosen options
    for (const t of types) $$(`input[name="opt_${t}"]`, pdp).forEach((inp) => {
      const possible = vs.some((x) => x.options[t] === inp.value && types.every((u) => u === t || !c[u] || x.options[u] === c[u]) && unitsLeft(x.stock, x.pack) >= 1);
      inp.parentElement.classList.toggle("na", !possible);
    });
    const price = $("#pPrice"), pack = $("#pPack"), sku = $("#pSku"), stock = $("#pStock");
    if (v) {
      const eff = variantEff({ price: v.price, sale_price: v.sale }), off = eff < v.price ? Math.round((1 - eff / v.price) * 100) : 0;
      price.innerHTML = `<b>${money(eff)}</b>${off ? ` <s>${money(v.price)}</s> <span class="off">${off}% off</span>` : ""}`;
      pack.textContent = v.pack > 1 ? `Pack of ${v.pack} (${v.pack} pieces in one pack)` : "";
      sku.textContent = v.sku ? `SKU: ${v.sku}` : "";
      const m = maxFor(v); stock.className = "sm" + (m < 1 ? " warn" : ""); stock.textContent = m < 1 ? "This option is sold out" : m <= 5 ? `Only ${m} left` : "In stock";
    } else if (types.length) { stock.className = "sm"; stock.textContent = "Choose your options to see availability"; }
    const max = maxFor(v); if (qty > max && max >= 1) qty = max; if (qty < moq) qty = moq;
    if (out) out.textContent = qty;
  };
  $$("input[type=radio]", pdp).forEach((r) => r.addEventListener("change", sync)); sync();

  $("#qMinus")?.addEventListener("click", () => { if (qty > moq) qty--; else toast(`Minimum order is ${moq}`); out.textContent = qty; });
  $("#qPlus")?.addEventListener("click", () => { const m = maxFor(current()); if (qty < m) qty++; else toast(m ? `Only ${m} available` : "Choose your options first"); out.textContent = qty; });
  $("#addBtn")?.addEventListener("click", () => {
    const fail = (t, el) => { msg.textContent = t; msg.className = "sm warn"; (el || $(".sizes", pdp))?.scrollIntoView({ block: "center", behavior: "smooth" }); };
    let item = { id: D.id, v: 0, size: "", qty };
    if (types.length) {
      const c = chosen(), miss = types.find((t) => !c[t]);
      if (miss) return fail(`Please select ${miss === "pack" ? "a pack size" : "a " + miss}.`, $(`[data-opt="${miss}"]`, pdp));
      const v = current(); if (!v) return fail("This combination is not available. Please choose different options.");
      if (unitsLeft(v.stock, v.pack) < qty) return fail("Not enough stock for this option.");
      item.v = v.id;
    } else if ((D.sizes || []).length) {
      const s = $('input[name="size"]:checked', pdp)?.value; if (!s) return fail("Please select a size.");
      item.size = s;
    }
    if (qty < moq) return fail(`Minimum order quantity is ${moq}.`);
    cart.add(item);
    msg.textContent = "Added to your cart."; msg.className = "sm";
    $("#goCart").hidden = false; toast("Added to cart");
  });
}
// Product reviews are guest-friendly, server-validated, and held for moderation before publication.
const reviewForm = $("#reviewForm");
if (reviewForm) {
  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#reviewMsg"), button = $("#reviewSubmit");
    const form = new FormData(reviewForm);
    const name = String(form.get("name") || "").trim();
    const rating = Number(form.get("rating"));
    const comment = String(form.get("comment") || "").trim();
    if (name.length < 2 || name.length > 80) { msg(status, "Enter your name (2–80 characters)."); return; }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) { msg(status, "Choose a rating from 1 to 5 stars."); return; }
    if (comment.length < 5 || comment.length > 1000) { msg(status, "Write a review of 5–1,000 characters."); return; }
    button.disabled = true; button.textContent = "Submitting…"; msg(status, "");
    try {
      const result = await api("/api/products?action=reviews", {
        method: "POST",
        body: { productId: Number($("#pdp")?.dataset.id), name, rating, comment, website: String(form.get("website") || "") },
      });
      msg(status, result.message || "Thank you. Your review has been submitted for approval.", "ok");
      reviewForm.reset();
      toast("Review submitted");
    } catch (error) {
      msg(status, error.message);
    } finally {
      button.disabled = false; button.textContent = "Submit review";
    }
  });
}
