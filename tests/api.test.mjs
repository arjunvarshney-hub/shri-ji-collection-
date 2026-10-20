import { mockReq, mockRes, fake, cookieFor } from "./helpers.mjs";
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const load = async (p) => (await import(p)).default;
const call = async (h, opts) => { const res = mockRes(); await h(mockReq(opts), res); return res; };
const USER = { id: "11111111-1111-1111-1111-111111111111", email: "c@example.com", user_metadata: {} };
const ADMIN = { id: "22222222-2222-2222-2222-222222222222", email: "owner@example.com", user_metadata: {} };
const same = { origin: "https://shop.test" };
beforeEach(() => {
  fake.users = { tokUser: USER, tokAdmin: ADMIN }; fake.admins = new Set([ADMIN.id]); fake.rpcCalls = [];
  fake.resolve = () => ({ data: null, error: null }); fake.rpcImpl = async () => ({ data: null, error: null });
  process.env.RAZORPAY_KEY_ID = "rzp_test_abc"; process.env.RAZORPAY_KEY_SECRET = "sec"; process.env.RAZORPAY_WEBHOOK_SECRET = "whsec";
});

test("admin endpoints: anonymous=401, customer=403, admin=200", async () => {
  for (const f of ["products", "orders"]) {
    const h = await load(`../api/_routes/admin/${f}.js`);
    assert.equal((await call(h, { method: "GET" })).statusCode, 401);
    assert.equal((await call(h, { method: "GET", headers: cookieFor("tokUser") })).statusCode, 403);
    assert.equal((await call(h, { method: "GET", headers: cookieFor("tokAdmin") })).statusCode, 200);
  }
  const up = await load("../api/upload-image.js");
  assert.equal((await call(up, { method: "POST", headers: { ...same } })).statusCode, 401);
  assert.equal((await call(up, { method: "POST", headers: { ...same, ...cookieFor("tokUser") } })).statusCode, 403);
});
test("customer cannot create/edit/delete products", async () => {
  const h = await load("../api/_routes/admin/products.js");
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const r = await call(h, { method, headers: { ...same, ...cookieFor("tokUser") }, body: { id: 1, name: "x" } });
    assert.equal(r.statusCode, 403, method);
  }
});
test("CSRF: cross-site write is blocked even with a valid admin cookie", async () => {
  const h = await load("../api/_routes/admin/products.js");
  const r = await call(h, { method: "POST", headers: { origin: "https://evil.example", ...cookieFor("tokAdmin") }, body: {} });
  assert.equal(r.statusCode, 403); assert.match(r.body.error, /cross-site/);
  const r2 = await call(h, { method: "DELETE", headers: { "sec-fetch-site": "cross-site", ...cookieFor("tokAdmin") }, body: { id: 1 } });
  assert.equal(r2.statusCode, 403);
});
test("admin product create ignores unknown fields and rejects bad data", async () => {
  const h = await load("../api/_routes/admin/products.js"); let inserted;
  fake.resolve = (t, ops) => { const ins = ops.find((o) => o[0] === "insert"); if (ins && t === "products") inserted = ins[1][0]; return { data: { id: 1, ...inserted }, error: null }; };
  const hd = { ...same, ...cookieFor("tokAdmin") };
  const bad = await call(h, { method: "POST", headers: hd, body: { name: "A product", category: "nope", price: 10 } });
  assert.equal(bad.statusCode, 400);
  const good = await call(h, { method: "POST", headers: hd, body: { name: "Kurti Blue", category: "kurti", price: 799, stock: 4, sizes: ["M", "L"], is_admin: true, id: 5 } });
  assert.equal(good.statusCode, 201); assert.equal(inserted.is_admin, undefined); assert.equal(inserted.id, undefined); assert.equal(inserted.price, 799);
});
test("admin upload: valid JPEG stored under a server-chosen name; SVG rejected", async () => {
  const h = await load("../api/upload-image.js");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const hd = { ...same, ...cookieFor("tokAdmin"), "content-length": String(jpg.length) };
  const ok = await call(h, { method: "POST", headers: hd, raw: jpg });
  assert.equal(ok.statusCode, 201); assert.match(fake.uploaded, /^products\/[0-9a-f-]{36}\.jpg$/);
  const svg = Buffer.from('<svg onload="alert(1)"/>');
  const bad = await call(h, { method: "POST", headers: { ...same, ...cookieFor("tokAdmin") }, raw: svg });
  assert.equal(bad.statusCode, 400);
  const big = await call(h, { method: "POST", headers: { ...same, ...cookieFor("tokAdmin"), "content-length": String(5 * 1024 * 1024) }, raw: jpg });
  assert.equal(big.statusCode, 413);
});
test("create order: login required; prices come from DB (rpc gets ids only); COD", async () => {
  const h = await load("../api/_routes/orders/create.js");
  const body = { customer: { name: "Ram Kumar", phone: "9927892667", address: "House 4, Tirth Mandir road", city: "Sambhal", state: "UP", pincode: "244303" }, items: [{ productId: 3, qty: 2, size: "M", price: 1, total: 1 }], paymentMethod: "COD", idempotencyKey: "abcdefgh-1234", subtotal: 1, total: 1 };
  assert.equal((await call(h, { method: "POST", headers: same, body })).statusCode, 401);
  fake.rpcImpl = async () => ({ data: { existing: false, order: { id: 9, order_number: "SJC-260101-AB12C", total: 1598, payment_method: "COD", payment_status: "pending" } }, error: null });
  const r = await call(h, { method: "POST", headers: { ...same, ...cookieFor("tokUser") }, body });
  assert.equal(r.statusCode, 201); assert.equal(r.body.orderNumber, "SJC-260101-AB12C"); assert.equal(r.body.razorpay, undefined);
  const [name, args] = fake.rpcCalls[0];
  assert.equal(name, "create_order"); assert.equal(args.p_user, USER.id); assert.deepEqual(args.p_items, [{ productId: 3, variantId: null, qty: 2, size: "M" }]);
  assert.ok(!JSON.stringify(args).includes('"price"') && !JSON.stringify(args).includes("subtotal"));
});
test("create order: out-of-stock and invalid input map to clear errors", async () => {
  const h = await load("../api/_routes/orders/create.js"); const hd = { ...same, ...cookieFor("tokUser") };
  const cust = { name: "Ram Kumar", phone: "9927892667", address: "House 4, Tirth Mandir road", city: "Sambhal", state: "UP", pincode: "244303" };
  fake.rpcImpl = async () => ({ data: null, error: { message: "OUT_OF_STOCK:Red Poshak" } });
  const r = await call(h, { method: "POST", headers: hd, body: { customer: cust, items: [{ productId: 1, qty: 1 }], paymentMethod: "COD" } });
  assert.equal(r.statusCode, 409); assert.match(r.body.error, /Red Poshak/);
  assert.equal((await call(h, { method: "POST", headers: hd, body: { customer: { ...cust, phone: "1" }, items: [{ productId: 1, qty: 1 }], paymentMethod: "COD" } })).statusCode, 400);
  assert.equal((await call(h, { method: "POST", headers: hd, body: { customer: cust, items: [{ productId: 1, qty: 1 }], paymentMethod: "FREE" } })).statusCode, 400);
});
test("create order ONLINE: server creates Razorpay order for the DB total", async () => {
  const h = await load("../api/_routes/orders/create.js"); const realFetch = globalThis.fetch; let sent;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); assert.match(init.headers.Authorization, /^Basic /); return { ok: true, json: async () => ({ id: "order_TEST123456" }) }; };
  fake.rpcImpl = async () => ({ data: { existing: false, order: { id: 9, order_number: "SJC-260101-AB12C", total: "1598.00", payment_method: "ONLINE", payment_status: "pending", razorpay_order_id: null } }, error: null });
  fake.resolve = () => ({ data: [{ razorpay_order_id: "order_TEST123456" }], error: null });
  try {
    const r = await call(h, { method: "POST", headers: { ...same, ...cookieFor("tokUser") }, body: { customer: { name: "Ram Kumar", phone: "9927892667", address: "House 4, Tirth Mandir road", city: "Sambhal", state: "UP", pincode: "244303" }, items: [{ productId: 3, qty: 2, size: "" }], paymentMethod: "ONLINE", amount: 1 } });
    assert.equal(r.statusCode, 201); assert.equal(sent.amount, 159800); assert.equal(sent.currency, "INR");
    assert.equal(r.body.razorpay.orderId, "order_TEST123456"); assert.equal(r.body.razorpay.amount, 159800);
    assert.ok(!JSON.stringify(r.body).includes("sec"), "secret must never be returned");
  } finally { globalThis.fetch = realFetch; }
});
test("verify-payment: needs login, valid signature and ownership; never trusts the browser", async () => {
  const h = await load("../api/_routes/orders/verify.js"), hd = { ...same, ...cookieFor("tokUser") };
  const sig = crypto.createHmac("sha256", "sec").update("order_TEST123456|pay_ABC123456").digest("hex");
  const body = { razorpay_order_id: "order_TEST123456", razorpay_payment_id: "pay_ABC123456", razorpay_signature: sig };
  assert.equal((await call(h, { method: "POST", headers: same, body })).statusCode, 401);
  assert.equal((await call(h, { method: "POST", headers: hd, body: { ...body, razorpay_signature: "deadbeef" } })).statusCode, 400);
  assert.equal(fake.rpcCalls.length, 0, "no DB write on bad signature");
  fake.resolve = () => ({ data: { order_number: "SJC-1", user_id: "someone-else" }, error: null });
  assert.equal((await call(h, { method: "POST", headers: hd, body })).statusCode, 404);        // someone else's order
  assert.equal(fake.rpcCalls.length, 0);
  fake.resolve = () => ({ data: { order_number: "SJC-1", user_id: USER.id }, error: null });
  fake.rpcImpl = async () => ({ data: { order_number: "SJC-1", payment_status: "paid" }, error: null });
  const ok = await call(h, { method: "POST", headers: hd, body });
  assert.equal(ok.statusCode, 200); assert.equal(fake.rpcCalls[0][0], "mark_order_paid"); assert.equal(fake.rpcCalls[0][1].p_payment_id, "pay_ABC123456");
});
test("webhook: bad/missing signature rejected; valid payment.captured marks paid once", async () => {
  const h = await load("../api/razorpay-webhook.js");
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_ABC123456", order_id: "order_TEST123456", amount: 159800 } } } });
  const sig = crypto.createHmac("sha256", "whsec").update(raw).digest("hex");
  assert.equal((await call(h, { method: "POST", raw, headers: { "x-razorpay-signature": "bad" } })).statusCode, 400);
  assert.equal((await call(h, { method: "POST", raw })).statusCode, 400);
  assert.equal(fake.rpcCalls.length, 0);
  let seen = false; fake.resolve = (t, ops) => (ops.some((o) => o[0] === "upsert") ? { data: null } : { data: seen ? { event_id: "e1" } : null, error: null });
  const ok = await call(h, { method: "POST", raw, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": "e1" } });
  assert.equal(ok.statusCode, 200); assert.deepEqual(fake.rpcCalls[0], ["mark_order_paid", { p_razorpay_order_id: "order_TEST123456", p_payment_id: "pay_ABC123456", p_amount_paise: 159800 }]);
  seen = true;
  const dup = await call(h, { method: "POST", raw, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": "e1" } });
  assert.equal(dup.body.duplicate, true); assert.equal(fake.rpcCalls.length, 1, "duplicate event is not processed twice");
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  assert.equal((await call(h, { method: "POST", raw, headers: { "x-razorpay-signature": sig } })).statusCode, 503);
});
test("webhook: payment.failed marks failed (never paid)", async () => {
  const h = await load("../api/razorpay-webhook.js");
  const raw = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_F1", order_id: "order_TEST123456", amount: 1 } } } });
  const sig = crypto.createHmac("sha256", "whsec").update(raw).digest("hex");
  await call(h, { method: "POST", raw, headers: { "x-razorpay-signature": sig } });
  assert.equal(fake.rpcCalls[0][0], "mark_payment_failed");
});
test("customer orders: login required; always scoped to the logged-in user; cancel uses user scope", async () => {
  const h = await load("../api/_routes/orders/my.js"); let eqs = [];
  assert.equal((await call(h, { method: "GET" })).statusCode, 401);
  fake.resolve = (t, ops) => { eqs = ops.filter((o) => o[0] === "eq").map((o) => o[1]); return { data: [], error: null }; };
  await call(h, { method: "GET", headers: cookieFor("tokUser") });
  assert.deepEqual(eqs[0], ["user_id", USER.id]);
  fake.resolve = () => ({ data: null, error: null });
  assert.equal((await call(h, { method: "GET", headers: cookieFor("tokUser"), query: { number: "SJC-260101-AB12C" } })).statusCode, 404);
  assert.equal((await call(h, { method: "GET", headers: cookieFor("tokUser"), query: { number: "x' or 1=1" } })).statusCode, 400);
  fake.rpcImpl = async () => ({ data: { order_status: "cancelled", payment_status: "cancelled" }, error: null });
  fake.resolve = (t) => (t === "orders" ? { data: { id: 9, order_number: "SJC-260101-AB12C", order_status: "cancelled", items: [] }, error: null } : { data: null, error: null });
  const r = await call(h, { method: "POST", headers: { ...same, ...cookieFor("tokUser") }, body: { action: "cancel", orderNumber: "SJC-260101-AB12C" } });
  assert.equal(r.statusCode, 200); assert.equal(fake.rpcCalls.at(-1)[1].p_user, USER.id);
});
test("admin order status goes through the atomic DB function; errors are friendly", async () => {
  const h = await load("../api/_routes/admin/orders.js"), hd = { ...same, ...cookieFor("tokAdmin") };
  fake.rpcImpl = async () => ({ data: { order_status: "packed" }, error: null });
  const r = await call(h, { method: "PATCH", headers: hd, body: { orderNumber: "SJC-260101-AB12C", status: "packed" } });
  assert.equal(r.statusCode, 200); assert.deepEqual(fake.rpcCalls[0], ["set_order_status", { p_order_number: "SJC-260101-AB12C", p_status: "packed", p_user: null, p_note: null, p_actor: ADMIN.id, p_actor_type: "admin" }]);
  fake.rpcImpl = async () => ({ data: null, error: { message: "PAYMENT_PENDING" } });
  assert.equal((await call(h, { method: "PATCH", headers: hd, body: { orderNumber: "SJC-260101-AB12C", status: "shipped" } })).statusCode, 409);
  assert.equal((await call(h, { method: "PATCH", headers: { ...same, ...cookieFor("tokUser") }, body: { orderNumber: "SJC-260101-AB12C", status: "shipped" } })).statusCode, 403);
});
test("cron: requires CRON_SECRET bearer", async () => {
  const h = await load("../api/cron/expire-orders.js");
  delete process.env.CRON_SECRET; assert.equal((await call(h, {})).statusCode, 503);
  process.env.CRON_SECRET = "cr0n"; assert.equal((await call(h, {})).statusCode, 401);
  fake.rpcImpl = async () => ({ data: 2, error: null });
  assert.equal((await call(h, { headers: { authorization: "Bearer cr0n" } })).body.cancelled, 2);
});
test("auth/me, methods, and error responses leak nothing", async () => {
  const me = await load("../api/_routes/auth/me.js");
  assert.deepEqual((await call(me, {})).body, { user: null, isAdmin: false });
  const r = await call(me, { headers: cookieFor("tokAdmin") }); assert.equal(r.body.isAdmin, true); assert.deepEqual(Object.keys(r.body.user).sort(), ["email", "id", "name"]);
  assert.equal((await call(await load("../api/_routes/orders/create.js"), { method: "GET" })).statusCode, 405);
  const h = await load("../api/_routes/admin/products.js"); fake.resolve = () => ({ data: null, error: { message: "relation public.secret_table SECRETDETAIL" } });
  const e = await call(h, { method: "GET", headers: cookieFor("tokAdmin") });
  assert.equal(e.statusCode, 500); assert.ok(!JSON.stringify(e.body).includes("SECRETDETAIL"));
});

import fs from "node:fs"; import path from "node:path";
test("Vercel Hobby limit: at most 12 serverless functions", () => {
  const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith("_")) continue; const p = path.join(d, e.name); e.isDirectory() ? walk(p) : /\.(js|mjs|ts)$/.test(e.name) && out.push(p); } };
  walk("api"); assert.ok(out.length <= 12, `${out.length} functions: ${out.join(", ")}`);
});
test("dispatchers route to the right handler and reject unknown actions", async () => {
  const auth = await load("../api/auth.js"), orders = await load("../api/orders.js"), admin = await load("../api/admin.js");
  assert.equal((await call(auth, { query: { action: "me" } })).body.user, null);
  assert.equal((await call(auth, { query: { action: "constructor" } })).statusCode, 404);
  assert.equal((await call(auth, { query: {} })).statusCode, 404);
  assert.equal((await call(orders, { method: "POST", headers: same, query: { action: "my" } })).statusCode, 401);   // customer route requires login
  assert.equal((await call(orders, { method: "POST", headers: same, query: { action: "nope" } })).statusCode, 404);
  assert.equal((await call(orders, { method: "POST", headers: same, body: {} })).statusCode, 401);                  // no action = create order, needs login
  assert.equal((await call(admin, { query: { action: "products" } })).statusCode, 401);
  assert.equal((await call(admin, { query: { action: "orders" }, headers: cookieFor("tokUser") })).statusCode, 403);
});

test("product review submission validates content and stores new reviews as pending", async () => {
  const h = await load("../api/products.js"); let inserted = null;
  fake.resolve = (table, ops) => {
    if (table === "products") return { data: { id: 7 }, error: null };
    const op = ops.find((o) => o[0] === "insert");
    if (table === "product_reviews" && op) inserted = op[1][0];
    return { data: null, error: null };
  };
  const headers = { ...same };
  const invalid = await call(h, { method: "POST", headers, query: { action: "reviews" }, body: { productId: 7, name: "Asha", rating: 6, comment: "Nice product" } });
  assert.equal(invalid.statusCode, 400); assert.equal(inserted, null);
  const ok = await call(h, { method: "POST", headers, query: { action: "reviews" }, body: { productId: 7, name: "Asha", rating: 5, comment: "Lovely poshak", status: "approved", is_admin: true } });
  assert.equal(ok.statusCode, 201); assert.equal(inserted.status, "pending"); assert.equal(inserted.rating, 5);
  assert.equal(inserted.is_admin, undefined); assert.equal(inserted.product_id, 7); assert.equal(inserted.customer_name, "Asha");
});

test("product reviews: honeypot is ignored and public GET filters to approved reviews", async () => {
  const h = await load("../api/products.js"); let dbCalls = 0, reviewOps = [];
  fake.resolve = (table, ops) => {
    dbCalls++;
    if (table === "products") return { data: { id: 7 }, error: null };
    if (table === "product_reviews") { reviewOps = ops; return { data: [{ id: 2, product_id: 7, customer_name: "Riya", rating: 4, comment: "Good fabric", created_at: "2026-10-09T12:00:00Z" }], error: null }; }
    return { data: null, error: null };
  };
  fake.rpcImpl = async (name, args) => ({ data: [{ product_id: 7, review_count: 1, average_rating: 4 }], error: null });
  const spam = await call(h, { method: "POST", headers: same, query: { action: "reviews" }, body: { productId: 7, name: "Bot", rating: 5, comment: "Automated review", website: "spam" } });
  assert.equal(spam.statusCode, 202); assert.equal(dbCalls, 0);
  const result = await call(h, { method: "GET", query: { action: "reviews", productId: "7" } });
  assert.equal(result.statusCode, 200); assert.equal(result.body.summary.count, 1); assert.equal(result.body.reviews.length, 1);
  assert.ok(reviewOps.some((o) => o[0] === "eq" && o[1][0] === "status" && o[1][1] === "approved"), "only approved reviews are public");
  assert.ok(reviewOps.some((o) => o[0] === "eq" && o[1][0] === "product_id" && o[1][1] === 7), "reviews are scoped to the requested product");
});

test("admin review moderation requires an admin and only allows known statuses", async () => {
  const h = await load("../api/_routes/admin/reviews.js");
  assert.equal((await call(h, { method: "GET", headers: { ...same, ...cookieFor("tokUser") } })).statusCode, 403);
  const denied = await call(h, { method: "PATCH", headers: { ...same, ...cookieFor("tokAdmin") }, body: { id: 1, status: "published" } });
  assert.equal(denied.statusCode, 400);
  let update;
  fake.resolve = (table, ops) => {
    const op = ops.find((o) => o[0] === "update"); if (table === "product_reviews" && op) update = op[1][0];
    return { data: { id: 1, product_id: 7, customer_name: "Riya", rating: 4, comment: "Good fabric", status: "approved" }, error: null };
  };
  const approved = await call(h, { method: "PATCH", headers: { ...same, ...cookieFor("tokAdmin") }, body: { id: 1, status: "approved" } });
  assert.equal(approved.statusCode, 200); assert.equal(update.status, "approved");
});


test("product SSR route actually loads approved reviews into the product page", async () => {
  const h = await load("../api/page.js");
  const product = { id: 7, slug: "red-poshak-7", name: "Red Poshak", category: "laddu-gopal-poshak", price: 500, sale_price: 400, description: "Soft velvet", material: "Velvet", sizes: ["1", "2"], image_urls: [], stock: 3, active: true, created_at: "2026-10-09T10:00:00Z" };
  const review = { id: 2, product_id: 7, customer_name: "Riya", rating: 5, comment: "Lovely fabric", created_at: "2026-10-09T12:00:00Z" };
  fake.resolve = (table, ops) => {
    if (table === "site_settings") return { data: [], error: null };
    if (table === "products") {
      const slug = ops.find((op) => op[0] === "eq" && op[1][0] === "slug");
      return { data: [product], count: 1, error: null };
    }
    if (table === "product_reviews") return { data: [review], error: null };
    return { data: null, error: null };
  };
  fake.rpcImpl = async (name) => name === "get_product_review_summary"
    ? { data: [{ product_id: 7, review_count: 1, average_rating: 5 }], error: null }
    : { data: null, error: null };
  const res = await call(h, { query: { type: "product", slug: "red-poshak-7" } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Ratings &amp; reviews/);
  assert.match(res.body, /Lovely fabric/);
  assert.match(res.body, /5\.0\/5/);
});

test("Vercel rewrites route admin review moderation to the existing admin dispatcher", () => {
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  const matches = config.rewrites.filter((r) => r.source === "/api/admin/reviews" && r.destination === "/api/admin?action=reviews");
  assert.equal(matches.length, 1, "review endpoint should have exactly one rewrite");
});

test("product SSR remains available when the optional reviews migration has not been applied", async () => {
  const h = await load("../api/page.js");
  const product = { id: 7, slug: "red-poshak-7", name: "Red Poshak", category: "laddu-gopal-poshak", price: 500, sale_price: null, description: "Soft velvet", material: "Velvet", sizes: [], image_urls: [], stock: 3, active: true, created_at: "2026-10-09T10:00:00Z" };
  fake.resolve = (table) => {
    if (table === "site_settings") return { data: [], error: null };
    if (table === "products") return { data: [product], count: 1, error: null };
    if (table === "product_reviews") return { data: null, error: { code: "PGRST205", message: "table not found in schema cache" } };
    return { data: null, error: null };
  };
  fake.rpcImpl = async () => ({ data: null, error: { code: "PGRST202", message: "function not found in schema cache" } });
  const res = await call(h, { query: { type: "product", slug: "red-poshak-7" } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Customer ratings coming soon/);
  assert.match(res.body, /Ratings and reviews are temporarily unavailable/);
  assert.doesNotMatch(res.body, /id="reviewForm"/);
});
