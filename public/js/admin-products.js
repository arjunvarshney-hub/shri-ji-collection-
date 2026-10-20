// Admin: Products tab (list + search/filter/sort + full product form).
import { api, esc, money, $, $$, msg, toast } from "./common.js";
import { imgTag, priceInfo, unitsLeft } from "./render.js";
import { GROUPS, CATEGORIES, setCategories, catName, canonicalSlug } from "./categories.js";
import { shrink, upload, openSheet, debounce } from "./admin-shared.js";

const OPTIONS = [["colour", "Colour"], ["size", "Size"], ["material", "Material"], ["design", "Design"], ["pack", "Pack size"]];
const SUGGEST = {
  colour: ["Red", "Maroon", "Blue", "Green", "Yellow", "Orange", "Pink", "White", "Gold", "Multicolour"],
  size: ["0", "1", "2", "3", "4", "5", "6", "S", "M", "L", "XL", "XXL", "Free Size"],
  material: ["Velvet", "Cotton", "Silk", "Zari", "Brass", "Metal", "Wood"],
  design: ["Plain", "Embroidered", "Stone work", "Gota work", "Printed"],
  pack: ["Single Piece", "Pack of 2", "Pack of 3", "Pack of 4", "Pack of 5", "Pack of 6", "Pack of 12"],
};
const SPEC_PRESETS = {
  "Thakur Ji": ["Product Type", "Colour", "Material", "Design", "Size", "Length", "Width", "Weight", "Pack Size", "Package Contents", "Suitable Idol Size"],
  "Ladies Wear": ["Fabric", "Colour", "Size", "Pattern", "Sleeve Type", "Fit", "Material", "Pack Contents"],
};
const FKEYS = ["price_min", "price_max", "subcategory", "sale", "returns", "colour", "size", "pack", "recent", "needs_category"];
let S = { q: "", category: "", status: "", stock: "", sort: "newest", page: 1, open: false, f: {} };
let data = { products: [], total: 0, pages: 1, counts: {} };

/* ------------------------------ LIST ------------------------------ */
const query = () => {
  const p = new URLSearchParams();
  for (const k of ["q", "category", "status", "stock", "sort"]) if (S[k]) p.set(k, S[k]);
  for (const k of FKEYS) if (S.f[k]) p.set(k, S.f[k]);
  p.set("page", S.page); p.set("pageSize", 20);
  return p.toString();
};
const activeFilters = () => ["category", "stock"].filter((k) => S[k]).length + FKEYS.filter((k) => S.f[k]).length;

export async function loadProducts() {
  try {
    const c = await api("/api/admin/categories"); setCategories(c.categories);
  } catch { /* categories tab SQL not run yet: the built-in list is used */ }
  await fetchList(true);
}
async function fetchList(full) {
  try { data = await api("/api/admin/products?" + query()); }
  catch (e) { $("#pane").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (full || !$("#pl")) drawShell(); drawList();
}
function drawShell() {
  const c = data.counts || {}, chip = (k, v, n, t) => `<button type="button" data-chip="${k}:${v}" class="${(k === "status" ? S.status : "") === v && k === "status" ? "on" : ""}">${t}${n !== undefined ? ` (${n})` : ""}</button>`;
  $("#pane").innerHTML = `<div class="tools"><input id="ps" type="search" placeholder="Search name, SKU, ID, category…" value="${esc(S.q)}" aria-label="Search products"><button class="btn primary" id="add" type="button">+ Add product</button></div>
  <div class="fchips" id="chips">${chip("status", "", c.all, "All")}${chip("status", "active", c.active, "Active")}${chip("status", "inactive", c.inactive, "Inactive")}${chip("status", "archived", c.archived, "Archived")}
    <button type="button" data-chip="stock:low" class="${S.stock === "low" ? "on" : ""}">Low stock (${c.low ?? 0})</button><button type="button" data-chip="stock:out" class="${S.stock === "out" ? "on" : ""}">Out of stock (${c.out ?? 0})</button>${c.needs_category ? `<button type="button" data-chip="needs:1" class="${S.f.needs_category ? "on" : ""}">Needs category (${c.needs_category})</button>` : ""}</div>
  <div style="display:flex;gap:8px;margin:6px 0"><button class="btn outline sm" id="ftog" type="button">Filters${activeFilters() ? ` (${activeFilters()})` : ""}</button>
   <select id="sortSel" aria-label="Sort products" style="min-height:38px">${[["newest", "Newest first"], ["oldest", "Oldest first"], ["name_asc", "Name A-Z"], ["name_desc", "Name Z-A"], ["price_asc", "Price low to high"], ["price_desc", "Price high to low"], ["stock_asc", "Stock low to high"], ["stock_desc", "Stock high to low"], ["updated", "Recently updated"]].map(([v, t]) => `<option value="${v}" ${S.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
  <div class="fpanel" id="fp" ${S.open ? "" : "hidden"}><div class="fgrid2">
   <label class="f">Category<select id="fCat"><option value="">All categories</option>${CATEGORIES.map((c) => `<option value="${esc(c.slug)}" ${S.category === c.slug ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
   <label class="f">Subcategory<input id="fSub" value="${esc(S.f.subcategory || "")}"></label>
   <label class="f">Stock<select id="fStock"><option value="">Any</option>${[["in", "In stock"], ["out", "Out of stock"], ["low", "Low stock"]].map(([v, t]) => `<option value="${v}" ${S.stock === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
   <label class="f">Min price ₹<input id="fPmin" type="number" inputmode="decimal" value="${esc(S.f.price_min || "")}"></label><label class="f">Max price ₹<input id="fPmax" type="number" inputmode="decimal" value="${esc(S.f.price_max || "")}"></label>
   <label class="f">Returns<select id="fRet"><option value="">Any</option>${[["yes", "Returnable"], ["no", "Non-returnable"], ["unset", "Not set yet"]].map(([v, t]) => `<option value="${v}" ${S.f.returns === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
   <label class="f">Colour<input id="fCol" value="${esc(S.f.colour || "")}"></label><label class="f">Size<input id="fSize" value="${esc(S.f.size || "")}"></label><label class="f">Pack size<input id="fPack" value="${esc(S.f.pack || "")}" placeholder="e.g. Pack of 3 or 3"></label></div>
   <label class="sw" style="margin:8px 12px 0 0"><input type="checkbox" id="fSale" ${S.f.sale ? "checked" : ""}> Sale products only</label> <label class="sw"><input type="checkbox" id="fRecent" ${S.f.recent ? "checked" : ""}> Added in last 7 days</label>
   <div style="margin-top:10px"><button class="btn outline sm" id="fClear" type="button">Clear filters</button></div></div>
  <p class="sm muted" id="pcount"></p><div id="pl"></div><div id="pg"></div>`;
  $("#add").onclick = () => productForm();
  $("#ps").addEventListener("input", debounce((e) => { S.q = e.target.value.trim(); S.page = 1; fetchList(false); }));
  $("#sortSel").onchange = (e) => { S.sort = e.target.value; S.page = 1; fetchList(false); };
  $("#ftog").onclick = () => { S.open = !S.open; $("#fp").hidden = !S.open; };
  const apply = () => { S.category = $("#fCat").value; S.stock = $("#fStock").value; Object.assign(S.f, { subcategory: $("#fSub").value.trim(), price_min: $("#fPmin").value, price_max: $("#fPmax").value, returns: $("#fRet").value, colour: $("#fCol").value.trim(), size: $("#fSize").value.trim(), pack: $("#fPack").value.trim(), sale: $("#fSale").checked ? "1" : "", recent: $("#fRecent").checked ? "1" : "" }); S.page = 1; fetchList(true); };
  $("#fp").addEventListener("change", apply);
  $("#fp").addEventListener("input", debounce((e) => e.target.type !== "checkbox" && e.target.tagName !== "SELECT" && apply(), 600));
  $("#fClear").onclick = () => { S = { ...S, category: "", stock: "", status: "", f: {}, page: 1, q: "" }; fetchList(true); };
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]"); if (!b) return; const [k, v] = b.dataset.chip.split(":");
    if (k === "status") S.status = v; else if (k === "stock") S.stock = S.stock === v ? "" : v; else if (k === "needs") S.f.needs_category = S.f.needs_category ? "" : "1";
    S.page = 1; fetchList(true);
  });
}
const flag = (cls, t) => `<span class="badge ${cls}">${t}</span>`;
function cardHtml(p) {
  const info = priceInfo(p), vs = (p.variants || []).filter((v) => v.active !== false);
  const pieces = vs.length ? vs.reduce((n, v) => n + Number(v.stock || 0), 0) : Number(p.stock || 0);
  const out = vs.length ? !vs.some((v) => unitsLeft(v.stock, v.pack_qty) >= 1) : unitsLeft(p.stock, p.pack_size) < 1;
  const low = !out && pieces <= Number(p.low_stock_threshold ?? 5);
  const flags = [p.archived ? flag("gray", "Archived") : p.active ? flag("ok", "Active") : flag("warn", "Inactive"), out ? flag("bad", "Out of stock") : low ? flag("warn", "Low stock") : "", info.mrp ? flag("ok", "Sale") : "",
    p.return_eligible === true ? flag("ok", `Returns ${p.return_window_days}d`) : p.return_eligible === false ? flag("gray", "Non-returnable") : flag("warn", "Return not set"), p.needs_category ? flag("bad", "Needs category") : ""].join(" ");
  return `<div class="pcard"><div>${imgTag(p.image_urls?.[0], p.name, { w: 72, h: 72 })}</div><div><div class="nm">${esc(p.name)}</div>
   <div class="meta">${p.sku ? `SKU ${esc(p.sku)} · ` : ""}#${p.id} · ${esc(p.needs_category ? `${catName(p.category)} (removed)` : catName(p.category))}${p.subcategory ? ` › ${esc(p.subcategory)}` : ""}</div>
   <div class="meta">${info.from ? "From " : ""}${money(info.price)}${info.mrp ? ` <s>${money(info.mrp)}</s>` : ""} · ${pieces} piece(s)${vs.length ? ` · ${vs.length} variant(s)` : ""}${p.min_order_qty > 1 ? ` · min ${p.min_order_qty}` : ""}${!vs.length && p.pack_size > 1 ? ` · pack of ${p.pack_size}` : ""}</div><div style="margin:4px 0">${flags}</div>
   <div class="acts"><button class="btn outline sm" data-pa="edit" data-id="${p.id}">Edit</button><button class="btn outline sm" data-pa="dup" data-id="${p.id}">Duplicate</button>
   <button class="btn outline sm" data-pa="price" data-id="${p.id}">Price</button><button class="btn outline sm" data-pa="stock" data-id="${p.id}">Stock</button>
   <button class="btn outline sm" data-pa="${out ? "instock" : "outstock"}" data-id="${p.id}">${out ? "Mark in stock" : "Mark out of stock"}</button>
   <label class="sw"><input type="checkbox" data-pa="toggle" data-id="${p.id}" ${p.active && !p.archived ? "checked" : ""} ${p.archived ? "disabled" : ""}> Visible</label>
   <button class="btn outline sm" data-pa="${p.archived ? "unarchive" : "archive"}" data-id="${p.id}">${p.archived ? "Restore" : "Archive"}</button><button class="btn danger sm" data-pa="del" data-id="${p.id}">Delete</button></div></div></div>`;
}
function drawList() {
  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0, to = Math.min(data.total, data.page * data.pageSize);
  $("#pcount").textContent = data.total ? `Showing ${from}–${to} of ${data.total} product(s)` : "";
  $("#pl").innerHTML = data.products.map(cardHtml).join("") || `<p class="empty">${S.q || activeFilters() || S.status ? "No products match these filters." : "No products yet. Tap “+ Add product”."}</p>`;
  $("#pg").innerHTML = data.pages > 1 ? `<div class="pager2"><button class="btn outline sm" data-pgo="-1" ${data.page <= 1 ? "disabled" : ""}>‹ Previous</button><span class="sm muted">Page ${data.page} of ${data.pages}</span><button class="btn outline sm" data-pgo="1" ${data.page >= data.pages ? "disabled" : ""}>Next ›</button></div>` : "";
}
async function patch(id, body, ok) {
  try { await api("/api/admin/products", { method: "PATCH", body: { id, ...body } }); if (ok) toast(ok); await fetchList(true); } catch (e) { alert(e.message); await fetchList(true); }
}
document.addEventListener("click", async (e) => {
  const pgo = e.target.closest("[data-pgo]"); if (pgo && $("#pl")) { S.page += Number(pgo.dataset.pgo); fetchList(false); window.scrollTo(0, 0); return; }
  const b = e.target.closest("[data-pa]"); if (!b || b.tagName === "INPUT" || !$("#pl")) return;
  const id = Number(b.dataset.id), p = data.products.find((x) => x.id === id), a = b.dataset.pa; if (!p) return;
  if (a === "edit") { try { const d = await api("/api/admin/products?id=" + id); productForm(d.product); } catch (err) { alert(err.message); } }
  if (a === "dup") { try { await api("/api/admin/products", { method: "POST", body: { action: "duplicate", id } }); toast("Copy created (inactive). Edit it and switch it on."); fetchList(true); } catch (err) { alert(err.message); } }
  if (a === "price") {
    if (p.variants?.length) return alert("This product has variants. Open Edit to change each variant's price.");
    const v = prompt("Regular price (₹):", p.price); if (v === null) return; const sale = prompt("Sale price (₹), leave empty for no sale:", p.sale_price ?? ""); if (sale === null) return;
    patch(id, { price: v, sale_price: sale === "" ? null : sale }, "Price updated");
  }
  if (a === "stock") {
    if (p.variants?.length) return alert("This product has variants. Open Edit to change each variant's stock.");
    const v = prompt("Stock quantity (in individual pieces):", p.stock); if (v !== null) patch(id, { stock: v }, "Stock updated");
  }
  if (a === "outstock") { if (confirm("Mark this product out of stock? (stock becomes 0)")) patch(id, p.variants?.length ? { variants: p.variants.map((v) => ({ ...v, stock: 0 })) } : { stock: 0 }, "Marked out of stock"); }
  if (a === "instock") { const v = prompt("How many pieces are in stock now?", "10"); if (v === null) return; patch(id, p.variants?.length ? { variants: p.variants.map((x) => ({ ...x, stock: Number(v) })) } : { stock: v }, "Marked in stock"); }
  if (a === "archive" && confirm("Archive this product? It is hidden from the shop but kept (order history stays safe).")) patch(id, { archived: true }, "Archived");
  if (a === "unarchive") patch(id, { archived: false, active: false }, "Restored (inactive). Switch it on when ready.");
  if (a === "del" && confirm(`Delete “${p.name}” permanently?\n\nIf it is in past orders it cannot be deleted; use Archive then.`)) { try { await api("/api/admin/products", { method: "DELETE", body: { id } }); toast("Deleted"); fetchList(true); } catch (err) { alert(err.message); } }
});
document.addEventListener("change", (e) => {
  const t = e.target.closest('[data-pa="toggle"]'); if (!t || !$("#pl")) return;
  patch(Number(t.dataset.id), { active: t.checked }, t.checked ? "Product is now visible" : "Product hidden");
});

/* ------------------------------ FORM ------------------------------ */
const rteHtml = (p) => p?.description_html || (p?.description ? p.description.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, "<br>")}</p>`).join("") : "");
export function productForm(p) {
  const edit = !!p;
  const d = {
    images: (p?.image_urls || []).map((url) => ({ url })),
    optionTypes: [...(p?.option_types || [])],
    variants: (p?.variants || []).map((v) => ({ id: v.id, options: { ...(v.options || {}) }, sku: v.sku || "", price: v.price, sale_price: v.sale_price ?? "", stock: v.stock, pack_qty: v.pack_qty, active: v.active !== false })),
    specs: (p?.specs || []).map((x) => ({ ...x })),
    catSlug: p ? canonicalSlug(p.category) : "", otherMode: false,
  };
  const catOK = (s) => CATEGORIES.some((c) => c.slug === s);
  if (p && !catOK(d.catSlug)) d.catSlug = "";                       // removed category: owner must pick a new one
  const v = (x) => esc(x ?? "");
  const sh = openSheet(`<div class="sheet-in"><div class="sheet-h"><h2>${edit ? "Edit product" : "Add product"}</h2><button class="btn outline sm" id="x" type="button">Close</button></div>
  ${p?.needs_category ? '<div class="msg err">This product is in a category that was removed. Choose a new category below.</div>' : ""}
  <form id="pf" novalidate>
  <details class="sec2" open><summary>1. Basic information</summary><div class="in">
   <label class="f">Product name *<input name="name" maxlength="120" value="${v(p?.name)}"></label>
   <div class="fgrid2"><label class="f">Product SKU / code<input name="sku" maxlength="40" value="${v(p?.sku)}" placeholder="e.g. LG-NECK-001"></label><label class="f">Brand <small>(if any)</small><input name="brand" maxlength="60" value="${v(p?.brand)}"></label><label class="f">Subcategory<input name="subcategory" maxlength="60" value="${v(p?.subcategory)}"></label></div>
   <label class="f">Status<select name="status"><option value="active" ${!p || (p.active && !p.archived) ? "selected" : ""}>Active (visible on shop)</option><option value="inactive" ${p && !p.active && !p.archived ? "selected" : ""}>Inactive (hidden)</option><option value="archived" ${p?.archived ? "selected" : ""}>Archived (hidden, kept)</option></select></label>
   <label class="f">Short description <small>(shown in lists, max 300)</small><textarea name="short_description" maxlength="300" rows="2">${v(p?.short_description)}</textarea></label>
   <div class="f"><b style="font-size:14px">Category *</b><div class="combo" id="combo"><input id="catIn" autocomplete="off" placeholder="Search or choose a category…" value="${v(d.catSlug ? catName(d.catSlug) : "")}" aria-label="Category"><div class="combo-list" id="catList" hidden></div></div>
    <div id="otherBox" hidden><div class="fgrid2"><label class="f">New category name<input id="newCatName" maxlength="40" placeholder="e.g. Pagdi"></label><label class="f">Belongs to<select id="newCatGroup">${GROUPS.map((g) => `<option value="${g.slug}">${esc(g.name)}</option>`).join("")}</select></label></div><p class="sm muted">It will be saved and can be reused. If a category with the same name already exists, that one is used.</p></div></div></div></details>

  <details class="sec2" open><summary>2. Pricing, stock and ordering</summary><div class="in">
   <div class="fgrid2"><label class="f">Regular price ₹ *<input name="price" type="number" inputmode="decimal" min="1" step="0.01" value="${v(p?.price)}"></label><label class="f">Sale price ₹ <small>(optional)</small><input name="sale_price" type="number" inputmode="decimal" min="1" step="0.01" value="${v(p?.sale_price)}"></label>
   <label class="f">Cost price ₹ <small>(only you see this)</small><input name="cost_price" type="number" inputmode="decimal" min="0" step="0.01" value="${v(p?.cost_price)}"></label></div>
   <div class="fgrid2" id="plain"><label class="f">Stock (pieces) *<input name="stock" type="number" inputmode="numeric" min="0" step="1" value="${v(p?.stock ?? 1)}"></label><label class="f">Pack size <small>(pieces in one pack)</small><input name="pack_size" type="number" inputmode="numeric" min="1" value="${v(p?.pack_size ?? 1)}"></label>
   <label class="f">Low stock alert at<input name="low_stock_threshold" type="number" inputmode="numeric" min="0" value="${v(p?.low_stock_threshold ?? 5)}"></label></div>
   <div class="fgrid2"><label class="f">Minimum order quantity<input name="min_order_qty" type="number" inputmode="numeric" min="1" max="99" value="${v(p?.min_order_qty ?? 1)}"></label><label class="f">Weight (grams)<input name="weight_grams" type="number" inputmode="decimal" min="0" value="${v(p?.weight_grams)}"></label><label class="f">Dimensions<input name="dimensions" maxlength="100" placeholder="e.g. 10 x 5 x 2 cm" value="${v(p?.dimensions)}"></label></div>
   <p class="sm muted"><b>Stock is counted in single pieces.</b> If one pack has 3 pieces, ordering 1 pack reduces stock by 3. <b>Minimum order quantity</b> = least number of packs a customer must buy. If you add variants below, price and stock are set per variant.</p></div></details>

  <details class="sec2" ${d.optionTypes.length ? "open" : ""}><summary>3. Options and variants <small class="muted">(colour, size, pack…)</small></summary><div class="in">
   <p class="sm muted">Turn on only what this product needs. Leave all off for a simple product.</p>
   <div id="optSw">${OPTIONS.map(([k, n]) => `<label class="sw" style="margin-right:14px"><input type="checkbox" data-opt="${k}" ${d.optionTypes.includes(k) ? "checked" : ""}> ${n}</label>`).join("")}</div>
   <div id="vArea"></div></div></details>

  <details class="sec2" open><summary>4. Photos</summary><div class="in"><p class="sm muted">First photo is the main photo. Add front, back, side and close-up photos (up to 10).</p>
   <input id="files" type="file" accept="image/jpeg,image/png,image/webp" multiple><div class="imgs" id="imgs"></div></div></details>

  <details class="sec2" open><summary>5. Description</summary><div class="in">
   <div class="rte-bar" id="rteBar" role="toolbar" aria-label="Text formatting">${[["bold", "B", "Bold"], ["italic", "I", "Italic"], ["underline", "U", "Underline"], ["h3", "H", "Heading"], ["p", "¶", "Paragraph"], ["ul", "• List", "Bullet list"], ["ol", "1. List", "Numbered list"], ["left", "⬅", "Align left"], ["center", "↔", "Align centre"], ["right", "➡", "Align right"], ["link", "🔗", "Add link"], ["undo", "↶", "Undo"], ["redo", "↷", "Redo"], ["clear", "Tx", "Clear formatting"]].map(([c, t, a]) => `<button type="button" data-cmd="${c}" aria-label="${a}" title="${a}">${t}</button>`).join("")}</div>
   <div class="rte" id="rte" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Product description">${rteHtml(p)}</div>
   <p class="sm muted">Tip: type a heading like “PRODUCT HIGHLIGHTS”, tap <b>H</b>, then add bullets with <b>• List</b>. Customers see exactly this formatting.</p></div></details>

  <details class="sec2"><summary>6. Specifications</summary><div class="in"><p class="sm muted">Add only the rows that apply. Empty rows are hidden from customers.</p><div id="specs"></div>
   <button class="btn outline sm" type="button" id="specAdd">+ Add row</button><div style="margin:8px 0">${Object.keys(SPEC_PRESETS).map((k) => `<button class="btn outline sm" type="button" data-preset="${k}" style="margin:0 6px 6px 0">Add ${k} fields</button>`).join("")}</div></div></details>

  <details class="sec2" open><summary>7. Return policy for this product</summary><div class="in">
   <label class="f">Can customers return this product? *<select name="return_eligible"><option value="">Choose…</option><option value="true" ${p?.return_eligible === true ? "selected" : ""}>Yes, returnable</option><option value="false" ${p?.return_eligible === false ? "selected" : ""}>No, non-returnable</option></select></label>
   <div id="retBox"><label class="f">Return window (days after delivery)<input name="return_window_days" type="number" inputmode="numeric" min="1" max="365" value="${v(p?.return_window_days)}"></label>
   <label class="f">Return conditions<textarea name="return_conditions" maxlength="1000" rows="2" placeholder="e.g. Unused, in original packing">${v(p?.return_conditions)}</textarea></label>
   <label class="f">Return instructions<textarea name="return_instructions" maxlength="1000" rows="2">${v(p?.return_instructions)}</textarea></label>
   <label class="f">Refund policy<textarea name="refund_policy" maxlength="1000" rows="2" placeholder="e.g. Refund to original payment method in 5-7 working days">${v(p?.refund_policy)}</textarea></label></div>
   <p class="sm muted">Customers always see this on the product page and in their order. Damaged / defective / wrong items can still be reported by customers, as the law may require.</p></div></details>
  <div id="m"></div></form>
  <div class="sheet-f"><button class="btn outline" id="cancel" type="button">Cancel</button><button class="btn primary" id="save" type="button">Save product</button></div></div>`, { onClose: () => d.images.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)) });
  const root = sh.el, f = $("#pf", root), $r = (s) => $(s, root);
  $r("#x").onclick = $r("#cancel").onclick = sh.close;
  document.execCommand("defaultParagraphSeparator", false, "p");

  /* category combobox */
  const catIn = $r("#catIn"), list = $r("#catList");
  const drawCats = () => {
    const t = catIn.value.trim().toLowerCase();
    const rows = GROUPS.map((g) => { const items = CATEGORIES.filter((c) => c.group === g.slug && (!t || c.name.toLowerCase().includes(t))); return items.length ? `<div class="grp">${esc(g.name)}</div>${items.map((c) => `<button type="button" data-cat="${esc(c.slug)}">${esc(c.name)}</button>`).join("")}` : ""; }).join("");
    list.innerHTML = rows + '<button type="button" data-cat="__other__"><b>Others…</b> (add a new category)</button>'; list.hidden = false;
  };
  catIn.addEventListener("focus", () => { catIn.select(); drawCats(); });
  catIn.addEventListener("input", () => { d.catSlug = ""; d.otherMode = false; $r("#otherBox").hidden = true; drawCats(); });
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    if (b.dataset.cat === "__other__") { d.otherMode = true; d.catSlug = ""; catIn.value = "Others"; $r("#otherBox").hidden = false; $r("#newCatName").focus(); }
    else { d.catSlug = b.dataset.cat; d.otherMode = false; catIn.value = catName(d.catSlug); $r("#otherBox").hidden = true; }
    list.hidden = true;
  });
  catIn.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 150));

  /* options + variants */
  const base = () => Number(f.price.value) || "";
  const packFromLabel = (s) => { const m = String(s || "").match(/(\d+)/); return /single/i.test(s) ? 1 : m ? Number(m[1]) : null; };
  const drawVariants = () => {
    const has = d.optionTypes.length > 0;
    $r("#plain").style.opacity = has ? ".5" : "1";
    $r("#vArea").innerHTML = !has ? "" : `<div class="fpanel"><b class="sm">Quick way:</b> <span class="sm muted">type the values for each option (comma separated), then create all combinations.</span>
     ${d.optionTypes.map((k) => `<label class="f">${OPTIONS.find((o) => o[0] === k)[1]} values<input data-vals="${k}" placeholder="${esc(SUGGEST[k].slice(0, 4).join(", "))}" list="dl_${k}"></label><datalist id="dl_${k}">${SUGGEST[k].map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`).join("")}
     <button class="btn outline sm" type="button" id="combos" style="margin-top:8px">Create all combinations</button></div>
     ${d.variants.map((x, i) => `<div class="vrow" data-vi="${i}"><h4>Variant ${i + 1}: ${esc(d.optionTypes.map((k) => x.options[k]).filter(Boolean).join(" / ") || "(fill the options)")} <button type="button" data-vdel="${i}" class="rm" aria-label="Remove variant ${i + 1}">Remove</button></h4>
      <div class="vgrid">${d.optionTypes.map((k) => `<label>${OPTIONS.find((o) => o[0] === k)[1]}<input data-vf="opt:${k}" value="${esc(x.options[k] || "")}" list="dl_${k}"></label>`).join("")}
       <label>SKU<input data-vf="sku" value="${esc(x.sku)}"></label><label>Price ₹<input data-vf="price" type="number" inputmode="decimal" value="${esc(x.price)}"></label><label>Sale ₹<input data-vf="sale_price" type="number" inputmode="decimal" value="${esc(x.sale_price)}"></label>
       <label>Stock (pieces)<input data-vf="stock" type="number" inputmode="numeric" value="${esc(x.stock)}"></label><label>Pieces per pack<input data-vf="pack_qty" type="number" inputmode="numeric" min="1" value="${esc(x.pack_qty)}"></label>
       <label style="display:flex;align-items:end;gap:6px"><input type="checkbox" data-vf="active" ${x.active ? "checked" : ""} style="width:22px;min-height:22px"> Available</label></div></div>`).join("")}
     <button class="btn outline sm" type="button" id="vAdd">+ Add one variant</button>`;
  };
  const newVariant = () => ({ id: null, options: {}, sku: "", price: base(), sale_price: "", stock: 0, pack_qty: 1, active: true });
  drawVariants();
  $r("#optSw").addEventListener("change", (e) => {
    const k = e.target.dataset.opt; if (!k) return;
    d.optionTypes = OPTIONS.map((o) => o[0]).filter((o) => (o === k ? e.target.checked : d.optionTypes.includes(o)));
    if (!d.optionTypes.length && d.variants.length && !confirm("Turning off all options removes the variants you entered. Continue?")) { e.target.checked = true; d.optionTypes.push(k); return; }
    if (!d.optionTypes.length) d.variants = [];
    drawVariants();
  });
  $r("#vArea").addEventListener("input", (e) => {
    const t = e.target, row = t.closest("[data-vi]"), fld = t.dataset.vf; if (!row || !fld) return;
    const x = d.variants[Number(row.dataset.vi)];
    if (fld.startsWith("opt:")) { const k = fld.slice(4); x.options[k] = t.value; if (k === "pack") { const n = packFromLabel(t.value); if (n) { x.pack_qty = n; const pq = row.querySelector('[data-vf="pack_qty"]'); if (pq) pq.value = n; } } }
    else if (fld === "active") x.active = t.checked; else x[fld] = t.value;
  });
  $r("#vArea").addEventListener("click", (e) => {
    if (e.target.closest("#vAdd")) { d.variants.push(newVariant()); drawVariants(); }
    const del = e.target.closest("[data-vdel]"); if (del) { d.variants.splice(Number(del.dataset.vdel), 1); drawVariants(); }
    if (e.target.closest("#combos")) {
      const sets = d.optionTypes.map((k) => [k, ($r(`[data-vals="${k}"]`).value || "").split(",").map((s) => s.trim()).filter(Boolean)]).filter(([, a]) => a.length);
      if (!sets.length) return msg($r("#m"), "Type at least one value first (for example: Red, Blue).");
      let combos = [{}]; for (const [k, arr] of sets) combos = combos.flatMap((c) => arr.map((val) => ({ ...c, [k]: val })));
      if (combos.length > 60) return msg($r("#m"), "That would create more than 60 variants. Please use fewer values.");
      const have = new Set(d.variants.map((x) => JSON.stringify(x.options)));
      for (const o of combos) if (!have.has(JSON.stringify(o))) d.variants.push({ ...newVariant(), options: o, pack_qty: packFromLabel(o.pack) || 1 });
      msg($r("#m"), ""); drawVariants();
    }
  });

  /* images */
  const drawImgs = () => {
    $r("#imgs").innerHTML = d.images.map((im, i) => `<div class="im ${i === 0 ? "cover" : ""}"><img src="${esc(im.preview || im.url)}" alt="Photo ${i + 1}">${im.blob ? '<span class="pend">NEW</span>' : ""}<button class="x" type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button>
      <div class="im-bar">${i === 0 ? '<span class="cv">Main photo</span>' : `<button class="mk" type="button" data-cover="${i}">Make main</button>`}<span class="im-mv"><button type="button" data-mv="${i}:-1" ${i === 0 ? "disabled" : ""} aria-label="Move photo left">◀</button><button type="button" data-mv="${i}:1" ${i === d.images.length - 1 ? "disabled" : ""} aria-label="Move photo right">▶</button></span></div></div>`).join("");
  };
  drawImgs();
  $r("#imgs").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"), cv = e.target.closest("[data-cover]"), mv = e.target.closest("[data-mv]");
    if (rm) { const [g] = d.images.splice(Number(rm.dataset.rm), 1); if (g.preview) URL.revokeObjectURL(g.preview); drawImgs(); }
    if (cv) { const [g] = d.images.splice(Number(cv.dataset.cover), 1); d.images.unshift(g); drawImgs(); }
    if (mv) { const [i, dir] = mv.dataset.mv.split(":").map(Number); const j = i + dir; if (j >= 0 && j < d.images.length) { [d.images[i], d.images[j]] = [d.images[j], d.images[i]]; drawImgs(); } }
  });
  $r("#files").addEventListener("change", async (e) => {
    const files = [...e.target.files]; e.target.value = ""; msg($r("#m"), "");
    for (const file of files) {
      if (d.images.length >= 10) { msg($r("#m"), "Maximum 10 photos per product."); break; }
      try { const blob = await shrink(file); d.images.push({ blob, preview: URL.createObjectURL(blob) }); drawImgs(); } catch (err) { msg($r("#m"), err.message); }
    }
  });

  /* rich text editor */
  const rte = $r("#rte");
  const cmds = { bold: ["bold"], italic: ["italic"], underline: ["underline"], h3: ["formatBlock", "<h3>"], p: ["formatBlock", "<p>"], ul: ["insertUnorderedList"], ol: ["insertOrderedList"], left: ["justifyLeft"], center: ["justifyCenter"], right: ["justifyRight"], undo: ["undo"], redo: ["redo"] };
  $r("#rteBar").addEventListener("mousedown", (e) => e.preventDefault());
  $r("#rteBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]"); if (!b) return; rte.focus();
    const c = b.dataset.cmd;
    if (c === "link") { let u = prompt("Link address (https://…):", "https://"); if (!u) return; if (!/^(https?:|mailto:|tel:)/i.test(u)) u = "https://" + u; document.execCommand("createLink", false, u); }
    else if (c === "clear") { document.execCommand("removeFormat"); document.execCommand("unlink"); document.execCommand("formatBlock", false, "<p>"); }
    else document.execCommand(cmds[c][0], false, cmds[c][1]);
  });
  rte.addEventListener("paste", (e) => { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain")); });

  /* specifications */
  const drawSpecs = () => {
    $r("#specs").innerHTML = d.specs.map((s, i) => `<div class="srow" data-si="${i}"><input data-sf="label" value="${esc(s.label)}" placeholder="Name (e.g. Colour)" maxlength="60" aria-label="Specification name"><input data-sf="value" value="${esc(s.value)}" placeholder="Value" maxlength="200" aria-label="Specification value"><span style="display:flex;gap:3px"><button type="button" data-sm="${i}:-1" aria-label="Move up">▲</button><button type="button" data-sm="${i}:1" aria-label="Move down">▼</button><button type="button" data-sd="${i}" aria-label="Remove row">×</button></span></div>`).join("");
  };
  drawSpecs();
  $r("#specs").addEventListener("input", (e) => { const row = e.target.closest("[data-si]"); if (row && e.target.dataset.sf) d.specs[Number(row.dataset.si)][e.target.dataset.sf] = e.target.value; });
  $r("#specs").addEventListener("click", (e) => {
    const del = e.target.closest("[data-sd]"), mv = e.target.closest("[data-sm]");
    if (del) { d.specs.splice(Number(del.dataset.sd), 1); drawSpecs(); }
    if (mv) { const [i, dir] = mv.dataset.sm.split(":").map(Number), j = i + dir; if (j >= 0 && j < d.specs.length) { [d.specs[i], d.specs[j]] = [d.specs[j], d.specs[i]]; drawSpecs(); } }
  });
  $r("#specAdd").onclick = () => { d.specs.push({ label: "", value: "" }); drawSpecs(); };
  root.addEventListener("click", (e) => { const pr = e.target.closest("[data-preset]"); if (!pr) return; for (const n of SPEC_PRESETS[pr.dataset.preset]) if (!d.specs.some((s) => s.label.toLowerCase() === n.toLowerCase())) d.specs.push({ label: n, value: "" }); drawSpecs(); });
  const retSync = () => { $r("#retBox").style.display = f.return_eligible.value === "false" ? "none" : ""; };
  f.return_eligible.addEventListener("change", retSync); retSync();

  /* save */
  let saving = false;
  $r("#save").addEventListener("click", async () => {
    if (saving) return;
    const m = $r("#m"), btn = $r("#save"), val = (n) => f.elements[n].value.trim();
    if (val("name").length < 2) return msg(m, "Please enter the product name.");
    if (!d.catSlug && !(d.otherMode && $r("#newCatName").value.trim())) return msg(m, "Please choose a category (or choose Others and type a new one).");
    if (!d.variants.length && !(Number(val("price")) > 0)) return msg(m, "Please enter the regular price.");
    if (!f.return_eligible.value) return msg(m, "Please choose whether this product is returnable (Yes or No).");
    if (f.return_eligible.value === "true" && !(Number(val("return_window_days")) >= 1)) return msg(m, "Please enter the return window in days.");
    if (d.optionTypes.length && !d.variants.length) return msg(m, "You turned on options. Add at least one variant, or turn the options off.");
    const sale = val("sale_price") === "" ? null : Number(val("sale_price"));
    if (!d.variants.length && sale !== null && !(sale > 0 && sale < Number(val("price")))) return msg(m, "Sale price must be lower than the regular price.");
    saving = true; btn.disabled = true; msg(m, "");
    try {
      const urls = []; let n = 0; const total = d.images.filter((i) => i.blob).length;
      for (const im of d.images) { if (im.blob) { btn.textContent = `Uploading photo ${++n} of ${total}…`; im.url = await upload(im.blob); } urls.push(im.url); }
      btn.textContent = "Saving…";
      const status = val("status");
      const body = {
        name: val("name"), sku: val("sku"), brand: val("brand"), subcategory: val("subcategory"), status, short_description: val("short_description"),
        category: d.otherMode ? "__other__" : d.catSlug, new_category_name: d.otherMode ? $r("#newCatName").value.trim() : undefined, new_category_group: d.otherMode ? $r("#newCatGroup").value : undefined,
        price: d.variants.length ? Math.min(...d.variants.map((x) => Number(x.price) || Infinity)) : val("price"), sale_price: d.variants.length ? null : sale, cost_price: val("cost_price"),
        stock: val("stock") || 0, pack_size: val("pack_size") || 1, low_stock_threshold: val("low_stock_threshold") || 5, min_order_qty: val("min_order_qty") || 1, weight_grams: val("weight_grams"), dimensions: val("dimensions"),
        option_types: d.optionTypes, variants: d.optionTypes.length ? d.variants : [], image_urls: urls, description_html: rte.innerHTML, specs: d.specs.filter((s) => s.label.trim() || s.value.trim()),
        return_eligible: f.return_eligible.value, return_window_days: f.return_eligible.value === "true" ? val("return_window_days") : null,
        return_conditions: val("return_conditions"), return_instructions: val("return_instructions"), refund_policy: val("refund_policy"),
      };
      if (edit) body.id = p.id;
      await api("/api/admin/products", { method: edit ? "PATCH" : "POST", body });
      sh.close(); toast("Product saved"); loadProducts();
    } catch (err) { msg(m, err.message); m.scrollIntoView({ block: "center" }); saving = false; btn.disabled = false; btn.textContent = "Save product"; }
  });
}
