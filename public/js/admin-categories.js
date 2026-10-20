// Admin: Categories tab.
import { api, esc, $, $$, msg, toast } from "./common.js";
import { GROUPS, setCategories } from "./categories.js";

let cats = [], orphans = 0;
const gname = (g) => GROUPS.find((x) => x.slug === g)?.name || g;

export async function loadCategoriesTab() {
  try { const d = await api("/api/admin/categories"); cats = d.categories; orphans = d.orphans; setCategories(cats); }
  catch (e) { $("#pane").innerHTML = `<div class="msg err">${esc(e.message)}</div><p class="sm muted">If this says a table is missing, run the new SQL file (migrations/20261012_catalog_orders_v4.sql) in Supabase.</p>`; return; }
  draw();
}
const rowHtml = (c, i, list) => `<div class="pcard" style="grid-template-columns:1fr"><div><div class="nm">${esc(c.name)} ${c.active ? '<span class="badge ok">On</span>' : '<span class="badge gray">Off (hidden)</span>'}</div>
  <div class="meta">${esc(gname(c.group_slug))} · ${c.products} product(s) · link: /category/${esc(c.slug)}</div>
  <div class="acts"><button class="btn outline sm" data-cat="up" data-id="${c.id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button><button class="btn outline sm" data-cat="down" data-id="${c.id}" ${i === list.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
  <button class="btn outline sm" data-cat="rename" data-id="${c.id}">Rename</button>
  <label class="sw"><input type="checkbox" data-cat="toggle" data-id="${c.id}" ${c.active ? "checked" : ""}> Show on shop</label>
  <button class="btn danger sm" data-cat="del" data-id="${c.id}">Delete</button></div></div></div>`;

function draw() {
  const active = cats.filter((c) => c.active), off = cats.filter((c) => !c.active);
  const hidden = off.filter((c) => c.products > 0);
  const targets = active.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("");
  $("#pane").innerHTML = `<div class="fpanel"><b>Add a category</b><div class="fgrid2" style="margin-top:6px"><label class="f">Name<input id="cName" maxlength="40" placeholder="e.g. Pagdi"></label><label class="f">Belongs to<select id="cGroup">${GROUPS.map((g) => `<option value="${g.slug}">${esc(g.name)}</option>`).join("")}</select></label></div><div id="cMsg"></div><button class="btn primary" id="cAdd" type="button" style="margin-top:10px">Add category</button></div>
  ${hidden.length ? `<div class="msg info"><b>${hidden.reduce((n, c) => n + c.products, 0)} product(s) are in categories that are switched off</b>, so customers cannot see them. Move them to an active category (nothing is deleted).${hidden.map((c) => `<div style="margin-top:8px"><b>${esc(c.name)}</b> (${c.products}) → <select data-mv="${esc(c.slug)}" style="min-height:40px;width:auto;max-width:60%">${targets}</select> <button class="btn outline sm" data-cat="move" data-from="${esc(c.slug)}">Move</button></div>`).join("")}</div>` : ""}
  ${orphans ? `<div class="msg err">${orphans} product(s) have a category that is not in this list at all. Open them in Products → filter "Needs category" and choose a category.</div>` : ""}
  <h3 style="margin:16px 0 6px">Categories on the shop (${active.length})</h3>${GROUPS.map((g) => { const l = active.filter((c) => c.group_slug === g.slug); return `<h4 class="muted" style="margin:10px 0 4px">${esc(g.name)}</h4>${l.map((c, i) => rowHtml(c, i, l)).join("") || '<p class="muted sm">None</p>'}`; }).join("")}
  <h3 style="margin:16px 0 6px">Switched off (${off.length})</h3>${off.map((c, i) => rowHtml(c, i, off)).join("") || '<p class="muted sm">None</p>'}`;
  $("#cAdd").onclick = async () => {
    msg($("#cMsg"), "");
    try { const d = await api("/api/admin/categories", { method: "POST", body: { name: $("#cName").value, group: $("#cGroup").value } }); cats = d.categories; orphans = d.orphans; setCategories(cats); toast("Category saved"); draw(); }
    catch (e) { msg($("#cMsg"), e.message); }
  };
}
async function send(method, body, okText) {
  try { const d = await api("/api/admin/categories", { method, body }); cats = d.categories; orphans = d.orphans; setCategories(cats); if (okText) toast(okText); draw(); }
  catch (e) { alert(e.message); draw(); }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cat]"); if (!b || !$("#pane") || !$("#cAdd")) return;
  const id = Number(b.dataset.id), c = cats.find((x) => x.id === id), a = b.dataset.cat;
  if (a === "rename" && c) { const n = prompt("New name for this category:", c.name); if (n && n.trim() && n.trim() !== c.name) send("PATCH", { id, name: n.trim() }, "Renamed"); }
  if (a === "del" && c && confirm(`Delete the category "${c.name}"?\n\nThis only works if it has no products. To hide it instead, switch "Show on shop" off.`)) send("DELETE", { id }, "Deleted");
  if ((a === "up" || a === "down") && c) {
    const same = cats.filter((x) => x.group_slug === c.group_slug && x.active === c.active); const i = same.findIndex((x) => x.id === id); const j = a === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= same.length) return;
    [same[i], same[j]] = [same[j], same[i]];
    const full = [...cats], slots = full.map((x, n) => (x.group_slug === c.group_slug && x.active === c.active ? n : -1)).filter((n) => n >= 0);
    slots.forEach((n, k) => { full[n] = same[k]; });
    send("PATCH", { order: full.map((x) => x.id) }, "Order saved");
  }
  if (a === "move") {
    const to = $(`[data-mv="${b.dataset.from}"]`)?.value; if (!to) return;
    if (!confirm("Move all these products to the chosen category?")) return;
    try { const r = await api("/api/admin/products", { method: "PATCH", body: { action: "reassign", from: b.dataset.from, to } }); toast(`${r.moved} product(s) moved`); loadCategoriesTab(); } catch (err) { alert(err.message); }
  }
});
document.addEventListener("change", (e) => {
  const t = e.target.closest('[data-cat="toggle"]'); if (!t || !$("#cAdd")) return;
  const id = Number(t.dataset.id), c = cats.find((x) => x.id === id);
  if (!t.checked && c?.products && !confirm(`Switching off "${c.name}" hides its ${c.products} product(s) from customers. Continue?`)) { t.checked = true; return; }
  send("PATCH", { id, active: t.checked }, t.checked ? "Category is on" : "Category is off");
});
