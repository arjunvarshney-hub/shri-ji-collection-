// Local E2E harness: serves public/ + vercel.json rewrites and runs the REAL api/*.js handlers
// against an in-memory fake of Supabase. (SQL functions are mirrored in JS here; the real SQL is NOT executed.)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath, pathToFileURL } from "node:url";
process.env.SJC_TEST_DB = "1"; process.env.SUPABASE_URL = "https://abc.supabase.co";
process.env.RAZORPAY_KEY_ID = "rzp_test_e2e"; process.env.RAZORPAY_KEY_SECRET = "e2e_secret"; process.env.RAZORPAY_WEBHOOK_SECRET = "e2e_wh";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIRM = process.env.CONFIRM === "1";
import { makeMem } from "../memdb.mjs";
import { deliveryCharge } from "../../public/js/delivery.js";
import { DEFAULT_CATEGORIES, RETIRED } from "../../public/js/categories.js";
process.env.RESEND_API_KEY = "re_e2e_key"; process.env.EMAIL_FROM = "SHRI JI <orders@e2e.test>"; process.env.ADMIN_NOTIFY_EMAIL = "owner@e2e.test"; process.env.SITE_URL = "http://localhost:" + (process.env.PORT || 4321);
const db = { products: [], product_variants: [], categories: [], orders: [], order_events: [], return_requests: [], email_outbox: [], admin_audit_log: [], profiles: [], admin_users: [], payment_events: [], site_settings: [], product_reviews: [] };
db.categories = [...DEFAULT_CATEGORIES.map((c, i) => ({ id: i + 1, slug: c.slug, name: c.name, group_slug: c.group, sort_order: c.sort_order, active: true, image_url: null })), ...RETIRED.map(([slug, name], i) => ({ id: 100 + i, slug, name, group_slug: "ladies-wear", sort_order: 900 + i, active: false, image_url: null }))];
const slugify = (n, id) => (n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item") + "-" + id;
const mem = makeMem(db, {
  defaults: {
    products: (r) => { r.slug = slugify(r.name, r.id); r.active ??= true; r.archived ??= false; r.sizes ??= []; r.image_urls ??= []; r.stock ??= 0; r.sale_price ??= null; r.min_order_qty ??= 1; r.pack_size ??= 1; r.low_stock_threshold ??= 5; r.option_types ??= []; r.specs ??= []; r.updated_at = r.created_at; },
    product_variants: (r) => { r.active ??= true; r.updated_at = r.created_at; },
    orders: (r) => { r.order_status ??= "pending"; r.payment_status ??= "pending"; r.stock_restored ??= false; },
    email_outbox: (r) => { r.status ??= "pending"; r.attempts ??= 0; },
    return_requests: (r) => { r.status ??= "requested"; r.photos ??= []; r.updated_at = r.created_at; },
    categories: (r) => { r.active ??= true; },
  },
  uniques: { products: { products_sku_key: ["sku"] }, email_outbox: { k: ["event_key"] }, categories: { c: ["slug"] }, product_variants: { v: ["sku"] } },
});
const users = []; const sessions = {};
const run = (t, ops, single) => {
  if (t === "return_requests") { const ins = ops.find((x) => x[0] === "insert"); if (ins && db.return_requests.some((r) => r.order_id === ins[1][0].order_id && r.item_index === ins[1][0].item_index && !["rejected", "cancelled"].includes(r.status))) return { data: null, error: { code: "23505", message: "duplicate key" } }; }
  return mem.run(t, ops, single);
};
const chain = (t, ops = []) => new Proxy({}, { get(_, p) {
  if (p === "then") return (ok, bad) => Promise.resolve(run(t, ops, false)).then(ok, bad);
  return (...a) => { const o = [...ops, [p, a]]; return p === "single" || p === "maybeSingle" ? Promise.resolve(run(t, o, true)) : chain(t, o); };
} });
const ev = (order_id, event_type, from_status, to_status, note, actor, actor_id) => db.order_events.push({ id: db.order_events.length + 1, order_id, event_type, from_status, to_status, note: note || null, internal: false, actor, actor_id: actor_id || null, created_at: new Date().toISOString() });

// ---- JS mirror of the SQL functions (migrations/20261012_catalog_orders_v4.sql is the real thing) ----
const restore = (o) => { if (o.stock_restored) return; for (const i of o.items) { const pieces = i.qty * (i.pack_qty || 1); if (i.variant_id) { const v = db.product_variants.find((x) => x.id === i.variant_id); if (v) v.stock += pieces; } else { const p = db.products.find((x) => x.id === i.product_id); if (p) p.stock += pieces; } } o.stock_restored = true; };
const ALLOWED = { pending: ["confirmed", "cancelled"], confirmed: ["processing", "packed", "cancelled"], processing: ["packed", "cancelled"], packed: ["shipped", "cancelled"], shipped: ["out_for_delivery", "delivered"], out_for_delivery: ["delivered"] };
const setStatus = ({ p_order_number, p_status, p_user, p_note, p_actor, p_actor_type }) => {
  const o = db.orders.find((x) => x.order_number === p_order_number); if (!o) throw new Error("NOT_FOUND");
  const from = o.order_status; let actor;
  if (p_user) {
    if (o.user_id !== p_user) throw new Error("NOT_FOUND");
    if (p_status !== "cancelled") throw new Error("NOT_ALLOWED");
    if (from === "pending" && o.payment_status !== "paid") actor = "customer";
    else if (["pending", "confirmed", "processing", "packed"].includes(from)) { Object.assign(o, { order_status: "cancellation_requested", status_before_request: from, cancel_reason: p_note || null, cancel_requested_at: new Date().toISOString() }); ev(o.id, "cancellation_requested", from, "cancellation_requested", p_note, "customer", p_user); return o; }
    else throw new Error("NOT_ALLOWED");
  } else {
    actor = p_actor_type || "admin"; if (p_status === from) return o;
    const allowed = from === "cancellation_requested" ? ["cancelled", o.status_before_request || "confirmed"] : ALLOWED[from] || [];
    if (!allowed.includes(p_status)) throw new Error(`INVALID_TRANSITION:${from}:${p_status}`);
  }
  if (["confirmed", "processing", "packed", "shipped", "out_for_delivery", "delivered"].includes(p_status) && o.payment_method === "ONLINE" && o.payment_status !== "paid") throw new Error("PAYMENT_PENDING");
  if (p_status === "cancelled") { restore(o); o.cancel_reason ??= p_note || null; if (["pending", "failed"].includes(o.payment_status) && o.payment_method === "ONLINE") o.payment_status = "cancelled"; else if (o.payment_status === "paid") o.refund_status ??= "processing"; o.order_status = "cancelled"; }
  else { o.order_status = p_status; if (p_status === "delivered") { o.delivered_at = new Date().toISOString(); if (o.payment_method === "COD" && o.payment_status === "pending") { o.payment_status = "paid"; o.paid_at = o.delivered_at; } } }
  ev(o.id, "status", from, p_status, p_note, actor, p_actor || p_user); return o;
};
const effp = (price, sale) => (sale && sale > 0 && sale < price ? sale : price);
const rpcs = {
  get_product_review_summary: ({ p_product_ids }) => p_product_ids.map((id) => { const r = db.product_reviews.filter((x) => x.product_id === id && x.status === "approved"); return r.length ? { product_id: id, review_count: r.length, average_rating: Math.round((r.reduce((n, x) => n + x.rating, 0) / r.length) * 10) / 10 } : null; }).filter(Boolean),
  create_order: ({ p_user, p_customer, p_items, p_method, p_key }) => {
    const ex = p_key && db.orders.find((o) => o.user_id === p_user && o.idempotency_key === p_key); if (ex) return { existing: true, order: ex };
    const agg = {}; p_items.forEach((i) => (agg[i.productId] = (agg[i.productId] || 0) + i.qty));
    const catOk = (c) => db.categories.some((x) => x.slug === (["mala", "necklace"].includes(c) ? "mala-and-necklace" : c) && x.active);
    for (const [pid, q] of Object.entries(agg)) { const p = db.products.find((x) => x.id == pid); if (!p || !p.active || p.archived || !catOk(p.category)) throw new Error("UNAVAILABLE"); if (q < (p.min_order_qty || 1)) throw new Error(`MIN_QTY:${p.name}:${p.min_order_qty}`); }
    const snapshot = db.products.map((p) => p.stock), vsnap = db.product_variants.map((v) => v.stock);
    try {
      let sub = 0; const lines = [];
      for (const it of [...p_items].sort((a, b) => a.productId - b.productId || (a.variantId || 0) - (b.variantId || 0))) {
        const p = db.products.find((x) => x.id === it.productId); const vs = db.product_variants.filter((v) => v.product_id === p.id && v.active);
        let unit, pack, label = null, sku = p.sku, size = it.size || null, vid = null;
        if (vs.length) {
          if (!it.variantId) throw new Error("VARIANT_REQUIRED:" + p.name);
          const v = vs.find((x) => x.id === it.variantId); if (!v) throw new Error("UNAVAILABLE");
          pack = Math.max(v.pack_qty || 1, 1); unit = effp(v.price, v.sale_price); if (v.stock < it.qty * pack) throw new Error("OUT_OF_STOCK:" + p.name + " (" + v.label + ")");
          v.stock -= it.qty * pack; label = v.label; sku = v.sku || p.sku; size = null; vid = v.id;
        } else {
          if (p.sizes.length) { if (!size || !p.sizes.includes(size)) throw new Error("SIZE_REQUIRED:" + p.name); } else size = null;
          pack = Math.max(p.pack_size || 1, 1); unit = effp(p.price, p.sale_price); if (p.stock < it.qty * pack) throw new Error("OUT_OF_STOCK:" + p.name); p.stock -= it.qty * pack;
        }
        sub += unit * it.qty;
        lines.push({ product_id: p.id, variant_id: vid, name: p.name, slug: p.slug, variant_label: label, sku, size, qty: it.qty, pack_qty: pack, unit_price: unit, image: p.image_urls[0], return_policy: { eligible: p.return_eligible, window_days: p.return_window_days, conditions: p.return_conditions, instructions: p.return_instructions, refund_policy: p.refund_policy } });
      }
      const ship = deliveryCharge(sub);
      const row = { user_id: p_user, order_number: "SJC-260101-" + String(db.orders.length + 1).padStart(5, "0"), customer_name: p_customer.name, phone: p_customer.phone, email: p_customer.email || null, address: p_customer.address, city: p_customer.city, state: p_customer.state, pincode: p_customer.pincode, payment_method: p_method, payment_status: "pending", order_status: "pending", items: lines, subtotal: sub, shipping: ship, total: sub + ship, razorpay_order_id: null, razorpay_payment_id: null, idempotency_key: p_key, stock_restored: false, admin_note: null };
      const o = mem.run("orders", [["insert", [row]], ["select", []]], true).data; ev(o.id, "placed", null, "pending", "Order placed", "customer", p_user); return { existing: false, order: o };
    } catch (e) { db.products.forEach((p, i) => (p.stock = snapshot[i])); db.product_variants.forEach((v, i) => (v.stock = vsnap[i])); throw e; }
  },
  set_order_status: setStatus,
  mark_order_paid: ({ p_razorpay_order_id, p_payment_id, p_amount_paise }) => { const o = db.orders.find((x) => x.razorpay_order_id === p_razorpay_order_id); if (!o) throw new Error("NOT_FOUND"); if (p_amount_paise != null && p_amount_paise !== Math.round(o.total * 100)) throw new Error("AMOUNT_MISMATCH"); if (o.payment_status === "paid") return o; o.payment_status = "paid"; o.razorpay_payment_id = p_payment_id; o.paid_at = new Date().toISOString(); if (o.order_status === "pending") o.order_status = "confirmed"; ev(o.id, "payment", null, "paid", "Online payment confirmed by Razorpay", "razorpay"); return o; },
  mark_payment_failed: ({ p_razorpay_order_id }) => { const o = db.orders.find((x) => x.razorpay_order_id === p_razorpay_order_id); if (o && o.payment_status === "pending") o.payment_status = "failed"; return null; },
};
const mkUser = (email, pw, name) => { const u = { id: crypto.randomUUID(), email, pw, confirmed: !CONFIRM, user_metadata: { full_name: name } }; users.push(u); return u; };
const sess = (u) => { const t = "tok_" + crypto.randomUUID(); sessions[t] = u; return { access_token: t, refresh_token: "ref_" + u.id, expires_in: 3600, user: u }; };
globalThis.__SJC_TEST_DB__ = {
  from: (t) => chain(t),
  rpc: async (n, a) => { try { return { data: rpcs[n](a), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
  auth: {
    getUser: async (t) => ({ data: { user: sessions[t] || null }, error: sessions[t] ? null : { message: "bad" } }),
    refreshSession: async ({ refresh_token }) => { const u = users.find((x) => "ref_" + x.id === refresh_token); return u ? { data: { session: sess(u) }, error: null } : { data: {}, error: { message: "bad" } }; },
    signUp: async ({ email, password, options }) => { if (users.some((u) => u.email === email)) return { data: {}, error: { message: "User already registered" } }; const u = mkUser(email, password, options?.data?.full_name); return { data: { user: u, session: CONFIRM ? null : sess(u) }, error: null }; },
    signInWithPassword: async ({ email, password }) => { const u = users.find((x) => x.email === email && x.pw === password); if (!u) return { data: {}, error: { message: "Invalid login credentials" } }; if (!u.confirmed) return { data: {}, error: { message: "Email not confirmed" } }; return { data: { session: sess(u) }, error: null }; },
    resetPasswordForEmail: async () => ({ error: null }),
    admin: { updateUserById: async (id, { password }) => { users.find((u) => u.id === id).pw = password; return { error: null }; } },
  },
  storage: { from: () => ({ upload: async (p, buf) => { db.__files = db.__files || {}; db.__files[p] = buf.length; return { error: null }; }, getPublicUrl: (p) => ({ data: { publicUrl: process.env.SUPABASE_URL + "/storage/v1/object/public/product-images/" + p } }), remove: async () => ({}) }) },
};
// External services: Razorpay REST, Anthropic and Resend are stubbed. Resend answers like the real one (id on success).
const realFetch = globalThis.fetch; let rz = 0; globalThis.__mails = []; globalThis.__mailMode = "ok";
globalThis.fetch = async (u, i) => {
  const url = String(u);
  if (url.startsWith("https://api.anthropic.com/")) return { ok: true, json: async () => ({ content: [{ type: "text", text: "AI-MOCK: here are some options from our store." }] }) };
  if (url.startsWith("https://api.razorpay.com/v1/orders")) return { ok: true, json: async () => ({ id: "order_E2E" + ++rz + "ABCDEF" }) };
  if (url.startsWith("https://api.resend.com/")) { const b = JSON.parse(i.body); if (globalThis.__mailMode === "fail") return { ok: false, status: 500, json: async () => ({ message: "provider down" }) }; globalThis.__mails.push(b); return { ok: true, status: 200, json: async () => ({ id: "em_" + globalThis.__mails.length }) }; }
  return realFetch(u, i);
};
// ---- HTTP server mirroring vercel.json ----
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".txt": "text/plain" };
const handlers = {};
const getH = async (name) => (handlers[name] ??= await import(pathToFileURL(path.join(ROOT, "api", name + ".js")).href));
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"); let p = url.pathname; const query = Object.fromEntries(url.searchParams);
  if (p === "/__admin_grant") { const u = users.find((x) => x.email === query.email); db.admin_users.push({ user_id: u.id }); return res.end("ok"); }
  if (p === "/__seed") {
    const rows = [["Red Velvet Laddu Gopal Poshak", "laddu-gopal-poshak", 650, 499, ["1", "2", "3"], 5], ["Pink Krishna Poshak Set", "krishna-poshak", 850, null, ["2", "3", "4"], 5], ["Gold Mukut", "mukut", 350, 299, [], 5], ["Cotton Printed Kurti", "kurti", 799, null, ["S", "M", "L", "XL"], 5], ["Embroidered Suit Set", "suit", 1450, 1199, ["M", "L", "XL"], 5], ["Chanderi Dupatta", "dupatta", 450, null, [], 5], ["Cotton Plazo", "plazo", 599, null, ["M", "L"], 5], ["Moti Mala", "mala-and-necklace", 199, null, [], 5]];
    rows.forEach(([name, category, price, sale, sizes, stock], n) => mem.run("products", [["insert", [{ name, category, price, sale_price: sale, sizes, stock, description: "Sample", return_eligible: n % 2 === 0, return_window_days: n % 2 === 0 ? 7 : null, created_at: new Date(Date.now() - n * 1000).toISOString() }]]], true));
    return res.end("ok");
  }
  if (p === "/__addprod") { mem.run("products", [["insert", [{ name: query.name, category: query.category, price: Number(query.price || 100), stock: 5, sizes: [], created_at: new Date().toISOString() }]]], true); return res.end("ok"); }
  if (p === "/__mailmode") { globalThis.__mailMode = query.m === "fail" ? "fail" : "ok"; return res.end("ok"); }
  if (p === "/__ai") { if (query.on === "1") { process.env.ANTHROPIC_API_KEY = "sk-e2e-key"; process.env.AI_MODEL = "e2e-model"; } else delete process.env.ANTHROPIC_API_KEY; return res.end("ok"); }
  if (p === "/__confirm") { users.forEach((u) => (u.confirmed = true)); return res.end("ok"); }
  if (p === "/__state") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ products: db.products, variants: db.product_variants, categories: db.categories, orders: db.orders, events: db.order_events, returns: db.return_requests, outbox: db.email_outbox, audit: db.admin_audit_log, files: db.__files, settings: db.site_settings, reviews: db.product_reviews, mails: globalThis.__mails })); }
  if (p === "/__sign") { const s = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(query.order + "|" + query.pay).digest("hex"); return res.end(s); }
  for (const r of cfg.rewrites) { const re = new RegExp("^" + r.source.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"); const m = p.match(re); if (m) { const d = new URL(r.destination.replace(/:(\w+)/g, (_, k) => m.groups[k]), "http://x"); p = d.pathname; d.searchParams.forEach((v, k) => (query[k] = v)); break; } }
  if (p.startsWith("/api/")) {
    const name = p.slice(5); let mod;
    try { mod = await getH(name); } catch { res.statusCode = 404; return res.end("no api"); }
    const chunks = []; if (mod.config?.api?.bodyParser !== false) { for await (const c of req) chunks.push(c); let b; try { b = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { b = {}; } req.body = b; }
    req.query = query; res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
    res.send = (b) => { res.end(typeof b === "string" || Buffer.isBuffer(b) ? b : JSON.stringify(b)); return res; };
    return mod.default(req, res);
  }
  let f = path.join(ROOT, "public", p === "/" ? "index.html" : p); if (!path.extname(f)) f += ".html";
  if (!f.startsWith(path.join(ROOT, "public")) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(fs.readFileSync(path.join(ROOT, "public/404.html"))); }
  res.setHeader("Content-Type", (mime[path.extname(f)] || "application/octet-stream") + "; charset=utf-8"); res.end(fs.readFileSync(f));
}).listen(Number(process.env.PORT || 4321), () => console.log("e2e harness on " + (process.env.PORT || 4321)));
