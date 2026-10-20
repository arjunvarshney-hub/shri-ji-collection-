import { mockReq, mockRes, fake, cookieFor } from "./helpers.mjs";
import { makeMem } from "./memdb.mjs";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { _resetRateLimits } from "../api/_lib.js";
import { queueEmail, retryOutbox, notify, emailConfigured } from "../api/_email.js";
import { setCategories, DEFAULT_CATEGORIES } from "../public/js/categories.js";

const load = async (p) => (await import(p)).default;
const call = async (h, opts) => { const res = mockRes(); await h(mockReq(opts), res); return res; };
const same = { origin: "https://shop.test" };
const U = { id: "11111111-1111-1111-1111-111111111111", email: "c@example.com", user_metadata: {} };
const U2 = { id: "33333333-3333-3333-3333-333333333333", email: "d@example.com", user_metadata: {} };
const A = { id: "22222222-2222-2222-2222-222222222222", email: "owner@example.com", user_metadata: {} };
const asUser = { ...same, ...cookieFor("tokUser") }, asAdmin = { ...same, ...cookieFor("tokAdmin") }, asOther = { ...same, ...cookieFor("tokOther") };
const PFX = process.env.SUPABASE_URL + "/storage/v1/object/public/product-images/";
const DAY = 86400000;
let mem, db, mails, realFetch;
const ORDER = (o = {}) => ({ id: 1, order_number: "SJC-260101-AB12C", user_id: U.id, customer_name: "Ram <b>Kumar</b>", phone: "9927892667", email: "c@example.com", address: "12-B, Tirth Mandir Road", city: "Sambhal", state: "UP", pincode: "244303", payment_method: "COD", payment_status: "pending", order_status: "confirmed", subtotal: 797, shipping: 40, total: 837, created_at: "2026-10-01T05:00:00Z", delivered_at: null,
  items: [{ product_id: 3, variant_id: 31, name: "Laddu Gopal Necklace", variant_label: "Red / Pack of 3", sku: "N-R3", qty: 2, pack_qty: 3, unit_price: 199, image: null, slug: "n-3", return_policy: { eligible: true, window_days: 7 } }, { product_id: 4, variant_id: null, name: "Gold Mukut", qty: 1, pack_qty: 1, unit_price: 399, slug: "m-4", return_policy: { eligible: false } }], ...o });
beforeEach(() => {
  db = { products: [], product_variants: [], categories: DEFAULT_CATEGORIES.map((c, i) => ({ id: i + 1, slug: c.slug, name: c.name, group_slug: c.group, sort_order: c.sort_order, active: true })), orders: [], order_events: [], return_requests: [], email_outbox: [], admin_audit_log: [], site_settings: [] };
  mem = makeMem(db, { defaults: { email_outbox: (r) => { r.status ??= "pending"; r.attempts ??= 0; }, return_requests: (r) => { r.status ??= "requested"; r.photos ??= []; }, products: (r) => { r.active ??= true; r.archived ??= false; r.slug ??= "p-" + r.id; r.image_urls ??= []; r.sizes ??= []; r.stock ??= 0; r.updated_at ??= r.created_at; }, product_variants: (r) => { r.active ??= true; }, orders: (r) => { r.order_status ??= "pending"; } }, uniques: { products: { products_sku_key: ["sku"] }, email_outbox: { email_outbox_event_key_key: ["event_key"] } } });
  fake.users = { tokUser: U, tokAdmin: A, tokOther: U2 }; fake.admins = new Set([A.id]); fake.rpcCalls = [];
  fake.resolve = (t, o, single) => {
    if (t === "return_requests") { const ins = o.find((x) => x[0] === "insert"); if (ins && db.return_requests.some((r) => r.order_id === ins[1][0].order_id && r.item_index === ins[1][0].item_index && !["rejected", "cancelled"].includes(r.status))) return { data: null, error: { code: "23505", message: "duplicate key" } }; }
    return mem.run(t, o, single);
  };
  fake.rpcImpl = async () => ({ data: null, error: null });
  setCategories(db.categories.map((c) => ({ ...c, group: c.group_slug })));
  Object.assign(process.env, { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "SHRI JI <orders@shop.test>", ADMIN_NOTIFY_EMAIL: "owner@shop.test", SITE_URL: "https://shop.test" });
  mails = []; realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (!String(url).startsWith("https://api.resend.com")) return realFetch(url, init); const b = JSON.parse(init.body); mails.push({ ...b, headers: init.headers }); return { ok: true, status: 200, json: async () => ({ id: "em_" + mails.length }) }; };
  _resetRateLimits();
});
test.afterEach(() => { globalThis.fetch = realFetch; });

/* ---------------------------------- email ---------------------------------- */
test("email: not configured => kept pending, never reported as sent", async () => {
  delete process.env.RESEND_API_KEY; assert.equal(emailConfigured(), false);
  assert.equal(await queueEmail({ key: "k1", to: "a@b.com", kind: "t", subject: "S", html: "<p>x</p>" }), "not_configured");
  assert.equal(db.email_outbox[0].status, "pending"); assert.equal(db.email_outbox[0].provider_id, undefined); assert.equal(db.email_outbox[0].last_error, "email_not_configured"); assert.equal(mails.length, 0);
});
test("email: sent only after the provider confirms; same event never sends twice; failures are recorded and retried", async () => {
  assert.equal(await queueEmail({ key: "e1", to: "a@b.com", kind: "t", subject: "S", html: "<p>x</p>" }), "sent");
  assert.equal(db.email_outbox[0].status, "sent"); assert.equal(db.email_outbox[0].provider_id, "em_1"); assert.equal(mails[0].headers["Idempotency-Key"], "e1"); assert.match(mails[0].headers.Authorization, /^Bearer /);
  assert.equal(await queueEmail({ key: "e1", to: "a@b.com", kind: "t", subject: "S", html: "<p>x</p>" }), "duplicate"); assert.equal(mails.length, 1);
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: "boom" }) });
  assert.equal(await queueEmail({ key: "e2", to: "a@b.com", kind: "t", subject: "S2", html: "x" }), "failed");
  const row = db.email_outbox.find((r) => r.event_key === "e2"); assert.equal(row.status, "failed"); assert.equal(row.attempts, 1); assert.match(row.last_error, /provider_status_500/); assert.equal(row.provider_id, undefined);
  globalThis.fetch = async () => { throw new Error("network down"); }; const r2 = await retryOutbox(); assert.equal(r2.sent, 0); assert.equal(row.attempts, 2); assert.equal(row.last_error, "network_or_timeout");
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: "em_retry" }) }); const r3 = await retryOutbox(); assert.equal(r3.sent, 1); assert.equal(row.status, "sent"); assert.equal(row.provider_id, "em_retry");
  assert.equal(JSON.stringify(db.email_outbox).includes("re_test_key"), false, "API key never stored");
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });        // 200 without an id is NOT a confirmation
  assert.equal(await queueEmail({ key: "e3", to: "a@b.com", kind: "t", subject: "S", html: "x" }), "failed");
});
test("email: admin new-order mail has every required detail and escapes customer text", async () => {
  await notify.newOrderAdmin(ORDER({ payment_method: "ONLINE", payment_status: "pending" }));
  const m = mails[0]; assert.deepEqual(m.to, ["owner@shop.test"]); assert.match(m.subject, /New order SJC-260101-AB12C/);
  for (const t of ["SJC-260101-AB12C", "Laddu Gopal Necklace", "Red / Pack of 3", "Pack of 3", "SKU N-R3", "₹797", "₹40", "₹837", "Online payment", "pending", "12-B, Tirth Mandir Road", "9927892667", "Sambhal"]) assert.ok(m.html.includes(t), "html: " + t);
  assert.ok(m.text.includes("Laddu Gopal Necklace") && m.text.includes("Total ₹837"));
  assert.ok(!m.html.includes("<b>Kumar</b>") && m.html.includes("&lt;b&gt;Kumar&lt;/b&gt;"), "customer name escaped");
  assert.ok(!/razorpay_payment_id|key_secret|re_test/.test(m.html + m.text));
});
test("email: cancellation REQUEST and completed CANCELLATION are clearly different", async () => {
  await notify.cancellationAdmin(ORDER({ cancel_reason: "Ordered by mistake" }), "requested"); await notify.cancellationAdmin(ORDER({ order_status: "cancelled" }), "confirmed");
  assert.match(mails[0].subject, /CANCELLATION REQUESTED/); assert.match(mails[0].html, /NOT cancelled yet/); assert.ok(mails[0].html.includes("Ordered by mistake"));
  assert.match(mails[1].subject, /ORDER CANCELLED/); assert.match(mails[1].html, /Order cancelled \(confirmed\)/); assert.doesNotMatch(mails[1].subject, /REQUESTED/);
});
test("email: customer emails only when an address exists; shipment mail shows real tracking only", async () => {
  await notify.orderConfirmedCustomer(ORDER({ email: null })); assert.equal(mails.length, 0);
  await notify.statusCustomer(ORDER({ order_status: "shipped", email: "c@example.com", courier_name: "DTDC", tracking_id: "D123", tracking_url: "https://track.example/D123" }), "shipped");
  assert.deepEqual(mails[0].to, ["c@example.com"]); assert.ok(mails[0].html.includes("D123") && mails[0].html.includes("DTDC"));
  await notify.statusCustomer(ORDER({ order_status: "confirmed" }), "confirmed"); assert.equal(mails.length, 1, "no mail for stages that have no template");
  await notify.statusCustomer(ORDER(), "shipped"); assert.equal(mails.length, 1, "same event not repeated");
});

/* ------------------------------- order creation ------------------------------- */
const body = { customer: { name: "Ram Kumar", phone: "9927892667", house: "12-B", locality: "Tirth Mandir Road", city: "Sambhal", state: "UP", pincode: "244303", email: "c@example.com" }, items: [{ productId: 3, variantId: 31, qty: 2 }], paymentMethod: "COD", idempotencyKey: "abcdefgh-0001" };
test("create order: admin + customer emails queued once; mail trouble never blocks the order; friendly MOQ / variant errors", async () => {
  const h = await load("../api/_routes/orders/create.js");
  fake.rpcImpl = async (name, args) => { assert.equal(name, "create_order"); assert.deepEqual(args.p_items, [{ productId: 3, variantId: 31, qty: 2, size: "" }]); assert.equal(args.p_customer.address, "12-B, Tirth Mandir Road"); return { data: { existing: false, order: ORDER() }, error: null }; };
  const r = await call(h, { method: "POST", headers: asUser, body });
  assert.equal(r.statusCode, 201); assert.equal(r.body.shipping, 40); assert.equal(r.body.subtotal, 797); assert.equal(r.body.total, 837);
  assert.deepEqual(db.email_outbox.map((e) => e.kind).sort(), ["order_confirmation", "order_new"]); assert.equal(mails.length, 2);
  fake.rpcImpl = async () => ({ data: { existing: true, order: ORDER() }, error: null });
  await call(h, { method: "POST", headers: asUser, body }); assert.equal(db.email_outbox.length, 2, "a retried (existing) order sends no new mail");
  globalThis.fetch = async () => { throw new Error("mail server down"); }; db.email_outbox.length = 0;
  fake.rpcImpl = async () => ({ data: { existing: false, order: ORDER({ id: 2, order_number: "SJC-260101-ZZZZZ" }) }, error: null });
  const ok = await call(h, { method: "POST", headers: asUser, body: { ...body, idempotencyKey: "abcdefgh-0002" } });
  assert.equal(ok.statusCode, 201); assert.ok(db.email_outbox.every((e) => e.status === "failed"), "kept for retry");
  fake.rpcImpl = async () => ({ data: null, error: { message: "MIN_QTY:Laddu Gopal Necklace:5" } });
  const m = await call(h, { method: "POST", headers: asUser, body }); assert.equal(m.statusCode, 400); assert.match(m.body.error, /Minimum order quantity for "Laddu Gopal Necklace" is 5/);
  fake.rpcImpl = async () => ({ data: null, error: { message: "VARIANT_REQUIRED:Laddu Gopal Necklace" } });
  assert.match((await call(h, { method: "POST", headers: asUser, body })).body.error, /choose the options/);
});

/* ------------------------------- categories admin ------------------------------- */
test("categories admin: add (no duplicates), rename, sort, switch off, delete only when empty", async () => {
  const h = await load("../api/_routes/admin/categories.js");
  assert.equal((await call(h, { method: "POST", headers: asUser, body: { name: "Pagdi", group: "thakur-ji-poshak" } })).statusCode, 403);
  assert.equal((await call(h, { method: "GET" })).statusCode, 401);
  const n0 = db.categories.length;
  const r = await call(h, { method: "POST", headers: asAdmin, body: { name: "  Pagdi  ", group: "thakur-ji-poshak" } }); assert.equal(r.statusCode, 200); assert.equal(db.categories.length, n0 + 1);
  await call(h, { method: "POST", headers: asAdmin, body: { name: "pagdi", group: "thakur-ji-poshak" } }); await call(h, { method: "POST", headers: asAdmin, body: { name: "PAGDI!", group: "ladies-wear" } });
  assert.equal(db.categories.length, n0 + 1, "same name (any case / punctuation) is reused, not duplicated");
  assert.equal((await call(h, { method: "POST", headers: asAdmin, body: { name: "X", group: "thakur-ji-poshak" } })).statusCode, 400); assert.equal((await call(h, { method: "POST", headers: asAdmin, body: { name: "Valid name", group: "bad" } })).statusCode, 400);
  const pagdi = db.categories.find((c) => c.slug === "pagdi"), mukut = db.categories.find((c) => c.slug === "mukut");
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { id: pagdi.id, name: "Mukut" } })).statusCode, 409);
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { id: pagdi.id, name: "Safa / Pagdi" } })).statusCode, 200); assert.equal(pagdi.name, "Safa / Pagdi"); assert.equal(pagdi.slug, "pagdi", "slug (links) never changes on rename");
  await call(h, { method: "PATCH", headers: asAdmin, body: { id: mukut.id, active: false } }); assert.equal(mukut.active, false);
  await call(h, { method: "PATCH", headers: asAdmin, body: { order: [pagdi.id, mukut.id] } }); assert.equal(pagdi.sort_order, 10); assert.equal(mukut.sort_order, 20);
  db.products.push({ id: 1, category: "pagdi", name: "P" });
  const del = await call(h, { method: "DELETE", headers: asAdmin, body: { id: pagdi.id } }); assert.equal(del.statusCode, 409); assert.match(del.body.error, /1 product/); assert.ok(db.categories.includes(pagdi));
  db.products.length = 0; assert.equal((await call(h, { method: "DELETE", headers: asAdmin, body: { id: pagdi.id } })).statusCode, 200); assert.ok(!db.categories.includes(pagdi));
  assert.ok(db.admin_audit_log.length >= 4, "audit trail written");
});

/* ------------------------------- products admin ------------------------------- */
const prodBody = (o = {}) => ({ name: "Laddu Gopal Necklace", category: "mala-and-necklace", price: 100, stock: 0, return_eligible: "true", return_window_days: 7, option_types: ["colour", "pack"], sku: "NECK-1",
  variants: [{ options: { colour: "Red", pack: "Pack of 3" }, sku: "N-R3", price: 250, sale_price: 199, stock: 30, pack_qty: 3 }, { options: { colour: "Blue", pack: "Single Piece" }, sku: "N-B1", price: 90, stock: 5, pack_qty: 1 }], ...o });
test("products admin: create with variants, safe duplicates, archive, delete rules", async () => {
  const h = await load("../api/_routes/admin/products.js");
  assert.equal((await call(h, { method: "POST", headers: asUser, body: prodBody() })).statusCode, 403);
  const r = await call(h, { method: "POST", headers: asAdmin, body: prodBody() }); assert.equal(r.statusCode, 201);
  const p = db.products[0]; assert.equal(p.price, 90, "base price = lowest variant price"); assert.equal(p.sale_price, null); assert.equal(p.cost_price, null);
  assert.deepEqual(db.product_variants.map((v) => [v.label, v.pack_qty, v.stock, v.sku]), [["Red / Pack of 3", 3, 30, "N-R3"], ["Blue / Single Piece", 1, 5, "N-B1"]]);
  const dup = await call(h, { method: "POST", headers: asAdmin, body: prodBody({ name: "Another" }) }); assert.equal(dup.statusCode, 409); assert.match(dup.body.error, /SKU/); assert.equal(db.products.length, 1, "no half-saved product");
  const ar = await call(h, { method: "PATCH", headers: asAdmin, body: { id: p.id, archived: true } }); assert.equal(ar.statusCode, 200); assert.equal(p.archived, true); assert.equal(p.active, false); assert.equal(db.product_variants.length, 2, "variants kept");
  const pr = await call(h, { method: "PATCH", headers: asAdmin, body: { id: p.id, archived: false, active: true } }); assert.equal(p.archived, false); assert.equal(p.active, true);
  const cp = await call(h, { method: "POST", headers: asAdmin, body: { action: "duplicate", id: p.id } }); assert.equal(cp.statusCode, 201); const copy = db.products[1]; assert.equal(copy.active, false); assert.equal(copy.sku, null); assert.match(copy.name, /\(copy\)/); assert.equal(db.product_variants.length, 4);
  db.orders.push(ORDER({ items: [{ product_id: p.id, variant_id: db.product_variants[0].id, name: "x", qty: 1 }] }));
  const rm = await call(h, { method: "PATCH", headers: asAdmin, body: { id: p.id, option_types: ["colour", "pack"], variants: [{ id: db.product_variants[1].id, options: { colour: "Blue", pack: "Single Piece" }, price: 90, stock: 5, pack_qty: 1 }] } });
  assert.equal(rm.statusCode, 200); const old = db.product_variants.find((v) => v.label === "Red / Pack of 3" && v.product_id === p.id); assert.ok(old && old.active === false, "variant used by an old order is hidden, not deleted");
  const del = await call(h, { method: "DELETE", headers: asAdmin, body: { id: p.id } }); assert.equal(del.statusCode, 409); assert.match(del.body.error, /Archive/); assert.ok(db.products.includes(p));
  assert.equal((await call(h, { method: "DELETE", headers: asAdmin, body: { id: copy.id } })).statusCode, 200); assert.ok(!db.products.includes(copy));
});
test("products admin: 'Others' creates/reuses a category; removed categories need reassigning; bulk move", async () => {
  const h = await load("../api/_routes/admin/products.js");
  const r = await call(h, { method: "POST", headers: asAdmin, body: prodBody({ category: "__other__", new_category_name: "Pagdi", new_category_group: "thakur-ji-poshak", option_types: [], variants: [], sku: "" }) });
  assert.equal(r.statusCode, 201); assert.equal(db.products[0].category, "pagdi"); assert.ok(db.categories.some((c) => c.slug === "pagdi" && c.active));
  const maxi = await call(h, { method: "POST", headers: asAdmin, body: prodBody({ category: "maxi", option_types: [], variants: [], sku: "" }) }); assert.equal(maxi.statusCode, 400);
  db.categories.push({ id: 99, slug: "maxi", name: "Maxi", group_slug: "ladies-wear", sort_order: 900, active: false }); setCategories(db.categories.map((c) => ({ ...c, group: c.group_slug })));
  db.products.push({ id: 50, name: "Old Maxi", category: "maxi", price: 100, stock: 1, active: true, archived: false, created_at: new Date().toISOString(), image_urls: [] });
  const list = await call(h, { method: "GET", headers: asAdmin, query: { needs_category: "1" } }); assert.deepEqual(list.body.products.map((x) => x.id), [50]); assert.equal(list.body.counts.needs_category, 1);
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { action: "reassign", from: "maxi", to: "maxi" } })).statusCode, 400, "cannot move into an inactive category");
  const mv = await call(h, { method: "PATCH", headers: asAdmin, body: { action: "reassign", from: "maxi", to: "kurti" } }); assert.equal(mv.body.moved, 1); assert.equal(db.products.find((x) => x.id === 50).category, "kurti");
});
test("products admin: server-side search, filter and sort (not just UI)", async () => {
  const h = await load("../api/_routes/admin/products.js");
  for (const [i, n] of [["Zed", 300], ["Alpha", 100], ["Mid", 200]].entries()) db.products.push({ id: i + 1, name: n[0], category: "kurti", price: n[1], stock: 5, active: true, archived: false, created_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), image_urls: [], sizes: [] });
  const names = async (q) => (await call(h, { method: "GET", headers: asAdmin, query: q })).body.products.map((p) => p.name);
  assert.deepEqual(await names({ sort: "name_asc" }), ["Alpha", "Mid", "Zed"]); assert.deepEqual(await names({ sort: "price_desc" }), ["Zed", "Mid", "Alpha"]); assert.deepEqual(await names({ price_min: 150, sort: "price_asc" }), ["Mid", "Zed"]); assert.deepEqual(await names({ q: "alp" }), ["Alpha"]);
  const res = await call(h, { method: "GET", headers: asAdmin, query: { pageSize: 2, page: 2, sort: "name_asc" } }); assert.deepEqual(res.body.products.map((p) => p.name), ["Zed"]); assert.equal(res.body.pages, 2); assert.equal(res.body.total, 3);
  assert.equal((await call(h, { method: "GET", headers: asUser })).statusCode, 403);
});

/* ------------------------------- orders admin ------------------------------- */
test("orders admin: filters/sort/date range, valid transitions only, tracking, refund, decline cancellation", async () => {
  const h = await load("../api/_routes/admin/orders.js");
  db.orders.push(ORDER({ id: 1, order_number: "SJC-260101-AAAAA", total: 500, created_at: "2026-10-01T05:00:00Z", order_status: "confirmed" }), ORDER({ id: 2, order_number: "SJC-260102-BBBBB", total: 900, created_at: "2026-10-05T05:00:00Z", order_status: "shipped", payment_method: "ONLINE", payment_status: "paid", phone: "9000000002" }), ORDER({ id: 3, order_number: "SJC-260103-CCCCC", total: 300, created_at: "2026-10-09T05:00:00Z", order_status: "pending" }));
  const nums = async (q) => (await call(h, { method: "GET", headers: asAdmin, query: q })).body.orders.map((o) => o.order_number.slice(-5));
  assert.deepEqual(await nums({ sort: "date_asc" }), ["AAAAA", "BBBBB", "CCCCC"]); assert.deepEqual(await nums({ sort: "total_desc" }), ["BBBBB", "AAAAA", "CCCCC"]); assert.deepEqual(await nums({ status: "shipped" }), ["BBBBB"]); assert.deepEqual(await nums({ method: "ONLINE" }), ["BBBBB"]);
  assert.deepEqual(await nums({ payment: "paid" }), ["BBBBB"]); assert.deepEqual(await nums({ delivery: "not_shipped", sort: "date_asc" }), ["AAAAA", "CCCCC"]); assert.deepEqual(await nums({ delivery: "in_transit" }), ["BBBBB"]);
  assert.deepEqual(await nums({ from: "2026-10-04", to: "2026-10-06" }), ["BBBBB"]); assert.deepEqual(await nums({ search: "9000000002" }), ["BBBBB"]); assert.deepEqual(await nums({ search: "ccccc" }), ["CCCCC"]);
  assert.equal((await call(h, { method: "GET", headers: asUser })).statusCode, 403);
  fake.rpcImpl = async () => ({ data: null, error: { message: "INVALID_TRANSITION:delivered:packed" } });
  const bad = await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260101-AAAAA", status: "packed" } }); assert.equal(bad.statusCode, 409); assert.match(bad.body.error, /"delivered" cannot be changed to "packed"/);
  fake.rpcImpl = async (n, a) => ({ data: ORDER({ order_status: a.p_status }), error: null });
  const ok = await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260101-AAAAA", status: "shipped", note: "Dispatched" } }); assert.equal(ok.statusCode, 200); assert.deepEqual(fake.rpcCalls.at(-1)[1], { p_order_number: "SJC-260101-AAAAA", p_status: "shipped", p_user: null, p_note: "Dispatched", p_actor: A.id, p_actor_type: "admin" });
  assert.ok(mails.some((m) => /shipped/i.test(m.subject)), "customer told about shipment");
  const t = await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260101-AAAAA", action: "tracking", courier_name: "DTDC", tracking_id: "D1", tracking_url: "javascript:alert(1)" } }); assert.equal(t.statusCode, 400);
  const t2 = await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260101-AAAAA", action: "tracking", courier_name: "DTDC", tracking_id: "D1", tracking_url: "https://track.example/D1" } }); assert.equal(t2.statusCode, 200); assert.equal(db.orders[0].tracking_id, "D1"); assert.ok(db.order_events.some((e) => e.event_type === "tracking"));
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260103-CCCCC", action: "refund", refund_status: "refunded" } })).statusCode, 409, "unpaid COD order has no refund");
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260102-BBBBB", action: "refund", refund_status: "processing" } })).statusCode, 200); assert.equal(db.orders[1].refund_status, "processing");
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260101-AAAAA", action: "decline_cancellation" } })).statusCode, 409, "nothing to decline");
  db.orders[0].order_status = "cancellation_requested"; db.orders[0].status_before_request = "packed";
  await call(h, { method: "PATCH", headers: asAdmin, body: { orderNumber: "SJC-260101-AAAAA", action: "decline_cancellation" } }); assert.equal(fake.rpcCalls.at(-1)[1].p_status, "packed");
  assert.equal((await call(h, { method: "PATCH", headers: asUser, body: { orderNumber: "SJC-260101-AAAAA", status: "delivered" } })).statusCode, 403);
  assert.ok(db.admin_audit_log.some((a) => a.action === "order_status"));
});

/* ------------------------------- customer cancel + returns ------------------------------- */
test("customer cancel: request vs immediate cancel, with the right admin email", async () => {
  const h = await load("../api/_routes/orders/my.js");
  db.orders.push(ORDER({ order_status: "confirmed" }));
  fake.rpcImpl = async () => ({ data: ORDER({ order_status: "cancellation_requested" }), error: null });
  const r = await call(h, { method: "POST", headers: asUser, body: { action: "cancel", orderNumber: "SJC-260101-AB12C", reason: "Changed mind" } });
  assert.equal(r.body.requested, true); assert.deepEqual(fake.rpcCalls[0][1], { p_order_number: "SJC-260101-AB12C", p_status: "cancelled", p_user: U.id, p_note: "Changed mind", p_actor: U.id, p_actor_type: "customer" });
  assert.match(mails[0].subject, /CANCELLATION REQUESTED/); mails.length = 0;
  fake.rpcImpl = async () => ({ data: ORDER({ order_status: "cancelled" }), error: null }); db.orders[0].order_status = "cancelled";
  const r2 = await call(h, { method: "POST", headers: asUser, body: { action: "cancel", orderNumber: "SJC-260101-AB12C" } }); assert.equal(r2.body.requested, false);
  assert.ok(mails.some((m) => /ORDER CANCELLED/.test(m.subject))); assert.ok(mails.some((m) => /cancelled/i.test(m.subject) && m.to[0] === "c@example.com"));
  assert.equal((await call(h, { method: "POST", headers: asOther, body: { action: "cancel", orderNumber: "SJC-260101-AB12C" } })).statusCode, 404, "other customers cannot touch it");
});
test("returns: per item, policy snapshot, window from delivery date, problem reports for non-returnable items", async () => {
  const h = await load("../api/_routes/orders/my.js");
  const dayAgo = (d) => new Date(Date.now() - d * DAY).toISOString();
  db.orders.push(ORDER({ order_status: "delivered", delivered_at: dayAgo(3) }));
  const ret = (o) => call(h, { method: "POST", headers: asUser, body: { action: "return", orderNumber: "SJC-260101-AB12C", itemIndex: 0, kind: "return", reason: "Not as described", ...o } });
  const det = await call(h, { method: "GET", headers: asUser, query: { number: "SJC-260101-AB12C" } });
  assert.equal(det.body.order.items[0].return_info.can_return, true); assert.equal(det.body.order.items[1].return_info.can_return, false); assert.equal(det.body.order.items[1].return_info.can_report_issue, true); assert.equal(det.body.order.id, undefined);
  const nr = await call(h, { method: "POST", headers: asUser, body: { action: "return", orderNumber: "SJC-260101-AB12C", itemIndex: 1, kind: "return", reason: "Changed my mind" } }); assert.equal(nr.statusCode, 409); assert.match(nr.body.error, /non-returnable/i);
  const isu = await call(h, { method: "POST", headers: asUser, body: { action: "return", orderNumber: "SJC-260101-AB12C", itemIndex: 1, kind: "issue", reason: "Damaged", photos: [PFX + "returns/a.jpg"] } }); assert.equal(isu.statusCode, 201);
  assert.equal((await ret({ photos: ["https://evil.example/x.jpg"] })).statusCode, 400); assert.equal((await ret({ photos: [PFX + "products/a.jpg"] })).statusCode, 400, "only return-photo folder accepted");
  assert.equal((await ret({ reason: "Because" })).statusCode, 400); assert.equal((await ret({ qty: 9 })).statusCode, 400);
  const good = await ret({ qty: 1, details: "Colour is different" }); assert.equal(good.statusCode, 201); assert.equal(db.return_requests.find((r) => r.item_index === 0).status, "requested");
  assert.equal((await ret({})).statusCode, 409, "second request for the same item");
  assert.ok(mails.filter((m) => /RETURN REQUESTED|PROBLEM REPORTED/.test(m.subject)).length === 2, "admin notified");
  assert.equal((await call(h, { method: "POST", headers: asOther, body: { action: "return", orderNumber: "SJC-260101-AB12C", itemIndex: 0, kind: "return", reason: "Damaged" } })).statusCode, 404);
  db.return_requests.length = 0; db.orders[0].delivered_at = dayAgo(9); assert.equal((await ret({})).statusCode, 409, "window (7 days) has passed");
  assert.equal((await call(h, { method: "POST", headers: asUser, body: { action: "return", orderNumber: "SJC-260101-AB12C", itemIndex: 1, kind: "issue", reason: "Damaged" } })).statusCode, 409, "problem window (7 days) passed");
  db.orders[0].order_status = "shipped"; db.orders[0].delivered_at = null; assert.equal((await ret({})).statusCode, 409, "not delivered yet");
});
test("returns admin: ordered transitions, reason required to reject, customer notified, audit", async () => {
  const h = await load("../api/_routes/admin/returns.js");
  db.orders.push(ORDER({ order_status: "delivered" })); db.return_requests.push({ id: 1, order_id: 1, item_index: 0, product_name: "Laddu Gopal Necklace", qty: 1, kind: "return", reason: "Not as described", photos: [], status: "requested", created_at: new Date().toISOString() });
  assert.equal((await call(h, { method: "GET", headers: asUser })).statusCode, 403);
  const list = await call(h, { method: "GET", headers: asAdmin }); assert.equal(list.body.returns[0].order.order_number, "SJC-260101-AB12C");
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { id: 1, status: "refunded" } })).statusCode, 409, "cannot skip steps");
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { id: 1, status: "rejected" } })).statusCode, 400, "reason required");
  assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { id: 1, status: "approved", decision_reason: "Send it back" } })).statusCode, 200); assert.equal(db.return_requests[0].status, "approved");
  assert.ok(mails.some((m) => /return/i.test(m.subject) && m.to[0] === "c@example.com")); assert.ok(db.order_events.some((e) => e.event_type === "return_status" && e.to_status === "approved"));
  for (const s of ["pickup_scheduled", "in_transit", "returned", "refund_processing", "refunded"]) assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { id: 1, status: s, refund_amount: 199 } })).statusCode, 200, s);
  assert.equal(db.return_requests[0].refund_amount, 199); assert.equal((await call(h, { method: "PATCH", headers: asAdmin, body: { id: 1, status: "approved" } })).statusCode, 409, "final state");
});

/* ------------------------------- uploads ------------------------------- */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
test("upload: customers may upload ONLY return photos (limited); products stay admin-only", async () => {
  const h = await load("../api/upload-image.js");
  const up = (headers, query) => call(h, { method: "POST", headers: { ...headers, "content-length": String(JPG.length) }, query, raw: JPG });
  assert.equal((await up({ ...same }, { kind: "return" })).statusCode, 401);
  assert.equal((await up(asUser, {})).statusCode, 403, "customer cannot add product photos");
  const ok = await up(asUser, { kind: "return" }); assert.equal(ok.statusCode, 201); assert.match(fake.uploaded, /^returns\/[0-9a-f-]{36}\.jpg$/);
  assert.equal((await up(asAdmin, {})).statusCode, 201); assert.match(fake.uploaded, /^products\//);
  const svg = await call(h, { method: "POST", headers: asUser, query: { kind: "return" }, raw: Buffer.from("<svg onload=alert(1)/>") }); assert.equal(svg.statusCode, 400);
  _resetRateLimits(); let last; for (let i = 0; i < 13; i++) last = await up(asUser, { kind: "return" }); assert.equal(last.statusCode, 429);
});
test("function count stays within the Hobby limit and the new admin actions are routed", async () => {
  const admin = await load("../api/admin.js");
  for (const a of ["products", "categories", "orders", "returns", "emails", "settings", "reviews"]) assert.notEqual((await call(admin, { query: { action: a } })).statusCode, 404, a);
  assert.equal((await call(admin, { query: { action: "nope" } })).statusCode, 404);
  const emails = await load("../api/_routes/admin/emails.js"); assert.equal((await call(emails, { method: "GET", headers: asUser })).statusCode, 403);
  const r = await call(emails, { method: "GET", headers: asAdmin }); assert.equal(r.body.configured, true); assert.ok(Array.isArray(r.body.emails));
});
