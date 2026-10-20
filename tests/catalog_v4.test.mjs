import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { sanitizeRichText, htmlToText, plainToHtml } from "../api/_sanitize.js";
import * as v from "../api/_validate.js";
import { filterProducts, paginate, isLowStock } from "../api/_admin_products.js";
import { returnInfo, ISSUE_DAYS } from "../api/_returns.js";
import { deliveryCharge, freeDeliveryNote } from "../public/js/delivery.js";
import { resolveLine, summarize } from "../public/js/cartlogic.js";
import { priceInfo, productInStock } from "../public/js/render.js";
import { PRODUCT_COLS } from "../api/_catalog.js";
import { productPage } from "../api/_layout.js";
import { canonicalSlug, slugsFor, catName } from "../public/js/categories.js";

const PFX = "https://abc.supabase.co/storage/v1/object/public/product-images/";
const bad = (fn, status = 400) => assert.throws(fn, (e) => e.status === status);
const base = { name: "Laddu Gopal Necklace", category: "mala-and-necklace", price: 100, stock: 20, return_eligible: "true", return_window_days: 7 };

/* ---------------- delivery rule ---------------- */
test("delivery charge: exact boundaries (₹499 and ₹1,000) and the examples from the brief", () => {
  const t = [[0, 50], [300, 50], [498.99, 50], [499, 40], [799, 40], [999, 40], [999.99, 40], [1000, 0], [1000.01, 0], [5000, 0]];
  for (const [sub, fee] of t) assert.equal(deliveryCharge(sub), fee, `subtotal ${sub}`);
  assert.equal(freeDeliveryNote(800), "Add ₹200 more to unlock free delivery."); assert.equal(freeDeliveryNote(999.5), "Add ₹0.50 more to unlock free delivery."); assert.equal(freeDeliveryNote(1000), null);
});
test("delivery charge: database function matches the browser/server rule", () => {
  const sql = fs.readFileSync("migrations/20261012_catalog_orders_v4.sql", "utf8");
  const m = sql.match(/create or replace function public\.delivery_charge[\s\S]*?\$\$;/)[0];
  assert.match(m, /p_subtotal >= 1000 then 0::numeric/); assert.match(m, /p_subtotal >= 499 then 40::numeric/); assert.match(m, /else 50::numeric/);
  assert.match(sql, /v_ship := public\.delivery_charge\(v_sub\)/, "create_order must use it");
});

/* ---------------- rich text ---------------- */
test("rich text: formatting survives, every attack is removed", () => {
  assert.equal(sanitizeRichText("<p>Hi <b>bold</b> <i>it</i> <u>u</u></p>"), "<p>Hi <strong>bold</strong> <em>it</em> <u>u</u></p>");
  assert.equal(sanitizeRichText("<h3>PRODUCT HIGHLIGHTS</h3><ul><li>Colour: Blue</li><li>Pack: 1</li></ul><ol><li>a</li></ol>"), "<h3>PRODUCT HIGHLIGHTS</h3><ul><li>Colour: Blue</li><li>Pack: 1</li></ul><ol><li>a</li></ol>");
  assert.equal(sanitizeRichText('<p style="text-align:center">c</p>'), '<p class="ta-center">c</p>');
  for (const evil of ["<script>alert(1)</script>x", "<img src=x onerror=alert(1)>", '<a href="javascript:alert(1)">x</a>', '<a href="  java\tscript:alert(1)">x</a>', "<svg onload=alert(1)>", "<iframe src=//evil></iframe>", '<p onclick="x()">t</p>', "<style>body{display:none}</style>", '<a href="data:text/html;base64,AA">x</a>', "<object data=x></object>", "<<script>script>alert(1)<</script>/script>"]) {
    const out = sanitizeRichText(evil);
    assert.ok(!/<script|onerror|onclick|onload|javascript:|<iframe|<style|<svg|<object|data:text/i.test(out), `${evil} -> ${out}`);
  }
  assert.match(sanitizeRichText('<a href="https://ok.example/x?a=1&b=2">go</a>'), /href="https:\/\/ok\.example\/x\?a=1&amp;b=2" target="_blank" rel="noopener nofollow noreferrer"/);
  assert.equal(sanitizeRichText("5 < 6 & 7 > 3"), "5 &lt; 6 &amp; 7 &gt; 3");
  assert.equal(htmlToText("<p>A &amp; B</p><ul><li>x</li></ul>"), "A & B x"); assert.equal(plainToHtml("one\n\ntwo\nline"), "<p>one</p><p>two<br>line</p>");
});
test("rich text: description is stored sanitised AND a plain-text copy is made", () => {
  const p = v.product({ ...base, description_html: '<p>Beautiful <b>decor</b></p><script>x()</script>' }, PFX);
  assert.equal(p.description_html, "<p>Beautiful <strong>decor</strong></p>"); assert.equal(p.description, "Beautiful decor");
  const legacy = v.product({ ...base, description: "Plain old text\n\nSecond <b>para</b>" }, PFX);
  assert.equal(legacy.description_html, "<p>Plain old text</p><p>Second &lt;b&gt;para&lt;/b&gt;</p>");
});

/* ---------------- product fields ---------------- */
test("product v4: MOQ, pack size, SKU, cost price, status, specs, return policy", () => {
  const p = v.product({ ...base, sku: "LG-NECK-001", cost_price: "40", min_order_qty: 5, pack_size: 3, low_stock_threshold: 4, weight_grams: 120, dimensions: "10 x 5 cm", status: "inactive", specs: [{ label: "Colour", value: "Blue" }, { label: "", value: "" }, { label: "Size", value: "" }] }, PFX);
  assert.equal(p.min_order_qty, 5); assert.equal(p.pack_size, 3); assert.equal(p.cost_price, 40); assert.equal(p.active, false); assert.equal(p.archived, false);
  assert.deepEqual(p.specs, [{ label: "Colour", value: "Blue" }, { label: "Size", value: "" }]); assert.equal(p.return_window_days, 7);
  assert.equal(v.product({ ...base, status: "archived" }, PFX).active, false);
  bad(() => v.product({ ...base, min_order_qty: 0 }, PFX)); bad(() => v.product({ ...base, min_order_qty: 100 }, PFX)); bad(() => v.product({ ...base, pack_size: 0 }, PFX));
  bad(() => v.product({ ...base, sku: "bad sku!<>" }, PFX)); bad(() => v.product({ ...base, specs: [{ label: "", value: "x" }] }, PFX));
  bad(() => v.product({ ...base, return_eligible: "true", return_window_days: "" }, PFX));
  const no = v.product({ ...base, return_eligible: "false", return_window_days: 30 }, PFX); assert.equal(no.return_eligible, false); assert.equal(no.return_window_days, null);
  assert.equal(v.product({ ...base, return_eligible: undefined }, PFX).return_eligible, null);       // "not decided yet" stays null
});
test("variants: own SKU/price/sale/stock/pack, duplicate and invalid values rejected, options must be enabled", () => {
  const vs = [{ options: { colour: "Red", pack: "Pack of 3" }, sku: "N-R3", price: 250, sale_price: 199, stock: 30, pack_qty: 3 }, { options: { colour: "Blue", pack: "Single Piece" }, price: 90, stock: 5, pack_qty: 1, active: false }];
  const p = v.product({ ...base, option_types: ["colour", "pack"], variants: vs }, PFX);
  assert.equal(p.variants[0].label, "Red / Pack of 3"); assert.equal(p.variants[0].pack_qty, 3); assert.equal(p.variants[0].sale_price, 199); assert.equal(p.variants[1].active, false); assert.equal(p.variants[0].sku, "N-R3");
  bad(() => v.product({ ...base, option_types: ["colour"], variants: [vs[0], { ...vs[0] }].map((x) => ({ ...x, options: { colour: "Red" } })) }, PFX));       // same label twice
  bad(() => v.product({ ...base, option_types: ["colour"], variants: [{ options: { colour: "Red" }, price: 100, sale_price: 100, stock: 1 }] }, PFX));           // sale not below price
  bad(() => v.product({ ...base, option_types: [], variants: [vs[0]] }, PFX));                                                                                     // options not switched on
  bad(() => v.product({ ...base, option_types: ["colour"], variants: [{ options: {}, price: 5, stock: 1 }] }, PFX)); bad(() => v.product({ ...base, option_types: ["colour"], variants: [{ options: { colour: "R" }, price: 5, stock: -1 }] }, PFX));
  bad(() => v.product({ ...base, option_types: ["colour"], variants: Array.from({ length: 101 }, (_, i) => ({ options: { colour: "C" + i }, price: 5, stock: 1 })) }, PFX));
  assert.equal(v.product({ ...base }, PFX).variants, undefined, "no variants key => variants untouched on update");
});
test("address: House/Flat + Street/Locality + Landmark are combined and validated", () => {
  const c = v.customer({ name: "Ram Kumar", phone: "9927892667", house: "12-B", locality: "Tirth Mandir Road", landmark: "Near gate", city: "Sambhal", state: "UP", pincode: "244303" });
  assert.equal(c.address, "12-B, Tirth Mandir Road, Landmark: Near gate");
  assert.equal(v.customer({ name: "Ram Kumar", phone: "9927892667", house: "12", locality: "Main road", city: "Sambhal", state: "UP", pincode: "244303" }).address, "12, Main road");
  bad(() => v.customer({ name: "Ram Kumar", phone: "9927892667", house: "", locality: "Main road", city: "S", state: "UP", pincode: "244303" }));
});

/* ---------------- cost price must never reach customers ---------------- */
test("cost price: not in public columns, not in SSR HTML, never selected with * by public code", () => {
  assert.ok(!PRODUCT_COLS.includes("cost_price"));
  const html = productPage("https://shop.test", { id: 1, slug: "x-1", name: "X", category: "kurti", price: 100, stock: 3, cost_price: 41.5, image_urls: [], variants: [] }, [], {});
  assert.ok(!html.includes("41.5") && !/cost_price/.test(html));
  const sql = fs.readFileSync("migrations/20261012_catalog_orders_v4.sql", "utf8");
  const grant = sql.match(/grant select \(([^)]*)\)\s+on public\.products to anon/)[1];
  assert.ok(!/cost_price/.test(grant)); assert.match(sql, /revoke select on public\.products from anon, authenticated/);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk("api").filter((x) => !/_routes[\\/]admin|_admin_products|upload|razorpay|_routes[\\/]orders|cron/.test(x)))
    assert.ok(!/from\("products"\)\s*\.select\("\*"/.test(fs.readFileSync(f, "utf8")), `${f} selects * from products`);
});

/* ---------------- admin list: filters really filter, sorts really sort ---------------- */
const mk = (id, o) => ({ id, name: "P" + id, sku: null, category: "kurti", active: true, archived: false, price: 100, sale_price: null, stock: 10, pack_size: 1, low_stock_threshold: 5, min_order_qty: 1, return_eligible: null, created_at: new Date(Date.UTC(2026, 0, id)).toISOString(), updated_at: new Date(Date.UTC(2026, 5, 10 - id)).toISOString(), sizes: [], variants: [], ...o });
const PRODS = [
  mk(1, { name: "Red Laddu Gopal Poshak", sku: "LG-001", category: "laddu-gopal-poshak", price: 650, sale_price: 499, return_eligible: true, return_window_days: 7 }),
  mk(2, { name: "Gold Mukut", sku: "MK-002", category: "mukut", price: 300, stock: 0 }),
  mk(3, { name: "Blue Kurti", category: "kurti", price: 799, stock: 3, sizes: ["M", "L"], return_eligible: false }),
  mk(4, { name: "Necklace Set", category: "necklace", price: 120, variants: [{ id: 41, sku: "NK-RED-3", options: { colour: "Red", pack: "Pack of 3" }, price: 120, stock: 30, pack_qty: 3, active: true }, { id: 42, sku: "NK-BLU-1", options: { colour: "Blue", pack: "Single Piece" }, price: 50, stock: 2, pack_qty: 1, active: true }] }),
  mk(5, { name: "Old Maxi", category: "maxi", active: false }),
  mk(6, { name: "Archived Dupatta", category: "dupatta", archived: true, active: false }),
];
const ids = (l) => l.map((p) => p.id);
test("admin list: search by name / SKU / id / category / variant SKU", () => {
  assert.deepEqual(ids(filterProducts(PRODS, { q: "gopal" })), [1]); assert.deepEqual(ids(filterProducts(PRODS, { q: "mk-002" })), [2]); assert.ok(ids(filterProducts(PRODS, { q: "3" })).includes(3), "exact id");
  assert.deepEqual(ids(filterProducts(PRODS, { q: "nk-blu" })), [4]); assert.deepEqual(ids(filterProducts(PRODS, { q: "mukut" })), [2]); assert.deepEqual(ids(filterProducts(PRODS, { q: "nothing-here" })), []);
});
test("admin list: every filter changes the result set (and they combine)", () => {
  assert.deepEqual(ids(filterProducts(PRODS, { category: "mala-and-necklace" })), [4]);                 // old "necklace" products live under the merged category
  assert.deepEqual(ids(filterProducts(PRODS, { status: "archived" })), [6]); assert.deepEqual(ids(filterProducts(PRODS, { status: "inactive" })), [5]); assert.deepEqual(ids(filterProducts(PRODS, { status: "active" })).sort(), [1, 2, 3, 4]);
  assert.deepEqual(ids(filterProducts(PRODS, { stock: "out", status: "active" })), [2]); assert.deepEqual(ids(filterProducts(PRODS, { stock: "low" })), [3]); assert.deepEqual(ids(filterProducts(PRODS, { stock: "in", status: "active" })).sort(), [1, 3, 4]);
  assert.equal(filterProducts(PRODS, {}).length, 6, "no filter returns everything");
});
test("admin list: price range uses the effective (sale / lowest variant) price; sale/returns/variant filters", () => {
  assert.deepEqual(ids(filterProducts(PRODS, { price_min: 600 })), [3]); assert.deepEqual(ids(filterProducts(PRODS, { price_max: 100, status: "active" })), [4]); assert.deepEqual(ids(filterProducts(PRODS, { price_min: 400, price_max: 500 })), [1]);
  assert.deepEqual(ids(filterProducts(PRODS, { sale: "1" })), [1]); assert.deepEqual(ids(filterProducts(PRODS, { returns: "yes" })), [1]); assert.deepEqual(ids(filterProducts(PRODS, { returns: "no" })), [3]);
  assert.deepEqual(ids(filterProducts(PRODS, { colour: "blue" })), [4]); assert.deepEqual(ids(filterProducts(PRODS, { size: "m" })), [3]); assert.deepEqual(ids(filterProducts(PRODS, { pack: "3" })), [4]); assert.deepEqual(ids(filterProducts(PRODS, { pack: "pack of 3" })), [4]);
  assert.deepEqual(ids(filterProducts(PRODS, { needs_category: "1" })), [5]);
  assert.deepEqual(ids(filterProducts(PRODS, { category: "kurti", status: "active", price_min: 500 })), [3]);                  // filters combine
  assert.deepEqual(ids(filterProducts(PRODS, { recent: "1" }, Date.UTC(2026, 0, 9, 12))).sort(), [3, 4, 5, 6]);               // only products added in the last 7 days
});
test("admin list: sorting really changes the order; pagination works", () => {
  const order = (sort) => ids(filterProducts(PRODS, { sort, status: "active" }));
  assert.deepEqual(order("newest"), [4, 3, 2, 1]); assert.deepEqual(order("oldest"), [1, 2, 3, 4]);
  assert.deepEqual(order("name_asc"), [3, 2, 4, 1]); assert.deepEqual(order("name_desc"), [1, 4, 2, 3]);
  assert.deepEqual(order("price_asc"), [4, 2, 1, 3]); assert.deepEqual(order("price_desc"), [3, 1, 2, 4]);
  assert.deepEqual(order("stock_asc"), [2, 3, 1, 4]); assert.deepEqual(order("stock_desc"), [4, 1, 3, 2]);
  assert.deepEqual(order("updated"), [1, 2, 3, 4]);
  const pg = paginate(filterProducts(PRODS, {}), 2, 4); assert.equal(pg.items.length, 2); assert.equal(pg.pages, 2); assert.equal(pg.total, 6);
});
test("stock: pack size and variants count in pieces", () => {
  assert.equal(productInStock({ stock: 2, pack_size: 3, variants: [] }), false); assert.equal(productInStock({ stock: 3, pack_size: 3, variants: [] }), true);
  assert.equal(productInStock(PRODS[3]), true); assert.equal(isLowStock(PRODS[2]), true); assert.equal(isLowStock(PRODS[1]), false, "out of stock is not 'low'");
  const info = priceInfo(PRODS[3]); assert.equal(info.price, 50); assert.equal(info.from, true);
});

/* ---------------- cart logic ---------------- */
const vp = { id: 4, name: "Necklace", slug: "n-4", price: 120, min_order_qty: 2, pack_size: 1, stock: 0, variants: PRODS[3].variants, sizes: [] };
test("cart: variant price, pack stock in pieces, MOQ and delivery totals", () => {
  const l = resolveLine({ id: 4, v: 41, size: "", qty: 5 }, vp);                 // stock 30 pieces, pack of 3 => max 10 packs
  assert.equal(l.unit, 120); assert.equal(l.pack, 3); assert.equal(l.max, 10); assert.equal(l.qty, 5); assert.equal(l.pieces, 15);
  const trimmed = resolveLine({ id: 4, v: 42, size: "", qty: 5 }, vp); assert.equal(trimmed.qty, 2); assert.equal(trimmed.trimmed, true);
  assert.ok(resolveLine({ id: 4, v: 0, size: "", qty: 1 }, vp).bad); assert.ok(resolveLine({ id: 4, v: 999, size: "", qty: 1 }, vp).bad); assert.ok(resolveLine({ id: 9, v: 0, size: "", qty: 1 }, undefined).bad);
  const s1 = summarize([resolveLine({ id: 4, v: 41, size: "", qty: 1 }, vp)]); assert.equal(s1.moq.length, 1, "min order 2 not met"); assert.equal(s1.blocked, true);
  const s2 = summarize([resolveLine({ id: 4, v: 41, size: "", qty: 2 }, vp)]); assert.equal(s2.subtotal, 240); assert.equal(s2.delivery, 50); assert.equal(s2.total, 290); assert.match(s2.freeNote, /Add ₹760 more/);
  const s3 = summarize([resolveLine({ id: 4, v: 41, size: "", qty: 9 }, vp)]); assert.equal(s3.subtotal, 1080); assert.equal(s3.delivery, 0); assert.equal(s3.freeNote, null);
  const plain = { id: 7, name: "Poshak", price: 650, sale_price: 499, pack_size: 1, stock: 4, sizes: ["1", "2"], variants: [] };
  assert.ok(resolveLine({ id: 7, v: 0, size: "", qty: 1 }, plain).bad, "size required"); assert.equal(resolveLine({ id: 7, v: 0, size: "2", qty: 1 }, plain).unit, 499);
});

/* ---------------- returns ---------------- */
const item = (pol) => ({ name: "I", return_policy: pol });
const order = (delivered) => ({ order_status: "delivered", delivered_at: delivered });
const DAY = 86400000, NOW = Date.UTC(2026, 9, 20);
test("returns: decided per item, deadline from the real delivery date", () => {
  const o = order(new Date(NOW - 3 * DAY).toISOString());
  const ret = returnInfo(o, item({ eligible: true, window_days: 7 }), NOW), non = returnInfo(o, item({ eligible: false }), NOW), unset = returnInfo(o, item({}), NOW);
  assert.equal(ret.can_return, true); assert.equal(new Date(ret.return_deadline).getTime(), NOW - 3 * DAY + 7 * DAY);
  assert.equal(non.can_return, false); assert.equal(non.can_report_issue, true); assert.match(non.note, /Non-returnable/);
  assert.equal(unset.can_return, false); assert.match(unset.note, /not set/);
  const late = returnInfo(order(new Date(NOW - 9 * DAY).toISOString()), item({ eligible: true, window_days: 7 }), NOW);
  assert.equal(late.can_return, false); assert.equal(late.can_report_issue, false); assert.match(late.note, /ended/);
  assert.equal(returnInfo(order(new Date(NOW - (ISSUE_DAYS - 1) * DAY).toISOString()), item({ eligible: false }), NOW).can_report_issue, true);
  const notYet = returnInfo({ order_status: "shipped", delivered_at: null }, item({ eligible: true, window_days: 7 }), NOW); assert.equal(notYet.can_return, false); assert.equal(notYet.can_report_issue, false);
});

/* ---------------- migration safety ---------------- */
test("migration: additive, replaces only the order functions, locks them to service_role", () => {
  const sql = fs.readFileSync("migrations/20261012_catalog_orders_v4.sql", "utf8");
  assert.ok(!/drop table|truncate table|delete from|drop column/i.test(sql.replace(/--.*$/gm, "")), "must not delete data");
  assert.equal(sql.split("$$").length % 2, 1, "balanced $$"); const body = sql.replace(/--.*$/gm, ""); assert.equal(body.split("(").length, body.split(")").length, "balanced parentheses");
  for (const t of ["categories", "product_variants", "order_events", "return_requests", "email_outbox", "admin_audit_log"]) assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
  assert.match(sql, /alter table public\.categories enable row level security/); assert.match(sql, /revoke all on public\.order_events, public\.return_requests, public\.email_outbox, public\.admin_audit_log from anon, authenticated/);
  assert.match(sql, /grant execute on function public\.create_order\([^)]*\) to service_role/); assert.match(sql, /revoke all on function public\.set_order_status\(text, text, uuid, text, uuid, text\) from public, anon, authenticated/);
  for (const c of ["fall-and-astar", "maxi", "gown", "saree", "dress-material"]) assert.match(sql, new RegExp(`'${c}'[^\\n]*false\\)`), `${c} kept as inactive`);
  assert.match(sql, /stock >= v_pieces/); assert.match(sql, /MIN_QTY/); assert.match(sql, /v_qty \* v_pack/);
  assert.equal(canonicalSlug("necklace"), "mala-and-necklace"); assert.deepEqual(slugsFor("mala-and-necklace").sort(), ["mala", "mala-and-necklace", "necklace"]); assert.equal(catName("maxi"), "Maxi");
});
test("supabase.sql: re-running the base file cannot re-expose cost_price", () => {
  const base = fs.readFileSync("supabase.sql", "utf8");
  assert.match(base, /column_name <> 'cost_price'/); assert.match(base, /revoke select on public\.products from anon, authenticated;\s*select string_agg/);
  assert.equal(base.split("$$").length % 2, 1);
});
