import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as v from "../api/_validate.js";
import { verifyCheckoutSignature, verifyWebhookSignature } from "../api/_razorpay.js";
import { esc, effPrice, safeUrl, cardHtml } from "../public/js/render.js";
import { CATEGORIES, GROUPS } from "../public/js/categories.js";
import { productPage, listingPage, homePage } from "../api/_layout.js";

const throwsStatus = (fn, status = 400) => assert.throws(fn, (e) => e.status === status);
const PFX = "https://abc.supabase.co/storage/v1/object/public/product-images/";
const goodCustomer = { name: "Ram Kumar", phone: "+91 99278 92667", email: "R@Example.com", address: "House 4, Tirth Mandir road", city: "Sambhal", state: "Uttar Pradesh", pincode: "244303" };

test("categories: 14 active (10 Thakur Ji + 4 Ladies Wear); removed ones are not in the shop list", () => {
  assert.equal(CATEGORIES.length, 14); assert.equal(GROUPS.length, 2);
  assert.equal(CATEGORIES.filter((c) => c.group === "thakur-ji-poshak").length, 10); assert.equal(CATEGORIES.filter((c) => c.group === "ladies-wear").length, 4);
  for (const n of ["Laddu Gopal Poshak", "Mala and Necklace", "Other Thakur Ji Accessories", "Thakur Ji Shringar", "Kurti", "Suit", "Dupatta", "Plazo"]) assert.ok(CATEGORIES.some((c) => c.name === n), n);
  for (const s of ["fall-and-astar", "maxi", "gown", "saree", "dress-material"]) assert.ok(!CATEGORIES.some((c) => c.slug === s), s);
  assert.equal(CATEGORIES[0].group, "thakur-ji-poshak");      // Thakur Ji first everywhere
});
test("customer validation: normalises phone/email, rejects bad input", () => {
  const c = v.customer(goodCustomer);
  assert.equal(c.phone, "9927892667"); assert.equal(c.email, "r@example.com");
  throwsStatus(() => v.customer({ ...goodCustomer, phone: "12345" }));
  throwsStatus(() => v.customer({ ...goodCustomer, pincode: "0123" }));
  throwsStatus(() => v.customer({ ...goodCustomer, name: "A" }));
  throwsStatus(() => v.customer({ ...goodCustomer, address: "short" }));
  throwsStatus(() => v.customer({ ...goodCustomer, email: "not-an-email" }));
  throwsStatus(() => v.customer(null));
  throwsStatus(() => v.customer({ ...goodCustomer, name: { $ne: 1 } }));
});
test("order items: only ids/variant/qty/size are accepted; qty bounds enforced", () => {
  assert.deepEqual(v.orderItems([{ productId: "5", variantId: "9", qty: 2, size: "M", price: 1 }]), [{ productId: 5, variantId: 9, qty: 2, size: "M" }]);   // client price is dropped
  assert.deepEqual(v.orderItems([{ productId: 5, qty: 1 }]), [{ productId: 5, variantId: null, qty: 1, size: "" }]);
  throwsStatus(() => v.orderItems([])); throwsStatus(() => v.orderItems([{ productId: 1, qty: 0 }]));
  throwsStatus(() => v.orderItems([{ productId: 1, qty: 100 }])); throwsStatus(() => v.orderItems([{ productId: -1, qty: 1 }]));
  throwsStatus(() => v.orderItems([{ productId: 1, qty: 1.5 }])); throwsStatus(() => v.orderItems(Array(21).fill({ productId: 1, qty: 1 })));
  throwsStatus(() => v.orderItems([{ productId: 1, variantId: "abc", qty: 1 }]));
});
test("product validation: whitelist, category, sale<price, image host", () => {
  const ok = { name: "Red Velvet Poshak", category: "laddu-gopal-poshak", price: 500, sale_price: 399, stock: 5, sizes: "1, 2, 3", image_urls: [PFX + "products/a.jpg"], active: "true", evil: "x", id: 99, return_eligible: "false" };
  const p = v.product(ok, PFX);
  assert.deepEqual(p.sizes, ["1", "2", "3"]); assert.equal(p.evil, undefined); assert.equal(p.id, undefined); assert.equal(p.active, true);
  throwsStatus(() => v.product({ ...ok, category: "weapons" }, PFX)); throwsStatus(() => v.product({ ...ok, category: "maxi" }, PFX));   // removed category
  throwsStatus(() => v.product({ ...ok, sale_price: 600 }, PFX)); throwsStatus(() => v.product({ ...ok, price: 0 }, PFX));
  throwsStatus(() => v.product({ ...ok, price: -5 }, PFX)); throwsStatus(() => v.product({ ...ok, stock: -1 }, PFX));
  throwsStatus(() => v.product({ ...ok, image_urls: ["javascript:alert(1)"] }, PFX));
  throwsStatus(() => v.product({ ...ok, image_urls: ["https://evil.example/x.jpg"] }, PFX));
  throwsStatus(() => v.product({ ...ok, image_urls: Array(11).fill(PFX + "a.jpg") }, PFX));
});
test("image magic bytes: jpg/png/webp pass; svg/html/exe rejected", () => {
  assert.equal(v.imageKind(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])).ext, "jpg");
  assert.equal(v.imageKind(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)])).ext, "png");
  assert.equal(v.imageKind(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)])).ext, "webp");
  assert.equal(v.imageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), null);
  assert.equal(v.imageKind(Buffer.from("<html><script>alert(1)</script></html>")), null);
});
test("razorpay signatures verify correctly and reject tampering", () => {
  const secret = "s3cret", sig = crypto.createHmac("sha256", secret).update("order_A1b2C3d4|pay_X9y8Z7w6").digest("hex");
  assert.ok(verifyCheckoutSignature("order_A1b2C3d4", "pay_X9y8Z7w6", sig, secret));
  assert.ok(!verifyCheckoutSignature("order_A1b2C3d4", "pay_OTHER00", sig, secret));
  assert.ok(!verifyCheckoutSignature("order_A1b2C3d4", "pay_X9y8Z7w6", sig.slice(0, -1) + "0", secret));
  assert.ok(!verifyCheckoutSignature("order_A1b2C3d4", "pay_X9y8Z7w6", "", secret));
  assert.ok(!verifyCheckoutSignature("order_A1b2C3d4", "pay_X9y8Z7w6", sig, ""));         // no secret configured => never valid
  const body = Buffer.from('{"event":"payment.captured"}'), ws = crypto.createHmac("sha256", "w").update(body).digest("hex");
  assert.ok(verifyWebhookSignature(body, ws, "w")); assert.ok(!verifyWebhookSignature(Buffer.from("{}"), ws, "w")); assert.ok(!verifyWebhookSignature(body, undefined, "w"));
});
test("render: escaping + safe URLs + price logic", () => {
  assert.equal(esc(`<img src=x onerror="a('b')">`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;");
  assert.equal(safeUrl("javascript:alert(1)"), ""); assert.equal(safeUrl("data:text/html,x"), ""); assert.equal(safeUrl("//evil.com/x"), ""); assert.equal(safeUrl("https://a.b/c.jpg"), "https://a.b/c.jpg");
  assert.equal(effPrice({ price: 500, sale_price: 399 }), 399); assert.equal(effPrice({ price: 500, sale_price: 600 }), 500); assert.equal(effPrice({ price: 500, sale_price: null }), 500);
});
const prod = { id: 7, slug: "red-poshak-7", name: `Red <script>alert(1)</script> Poshak`, category: "laddu-gopal-poshak", price: 500, sale_price: 400, description: "Soft velvet\n<b>x</b>", material: "Velvet", sizes: ["1", "2"], image_urls: ["https://abc.supabase.co/storage/v1/object/public/product-images/products/a.jpg", "javascript:alert(1)"], stock: 3 };
test("SSR product page: XSS escaped, JSON-LD valid, no invented ratings", () => {
  const html = productPage("https://shop.test", prod, [prod]);
  assert.ok(!html.includes("<script>alert(1)</script>")); assert.ok(!html.includes('src="javascript:'));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const p = ld.find((x) => x["@type"] === "Product");
  assert.equal(p.offers.price, "400.00"); assert.equal(p.offers.priceCurrency, "INR"); assert.equal(p.offers.availability, "https://schema.org/InStock");
  assert.ok(!("aggregateRating" in p) && !("review" in p));
  assert.ok(html.includes('<link rel="canonical" href="https://shop.test/product/red-poshak-7">'));
  assert.match(html, /<title>.*Buy Online \| SHRI JI COLLECTION<\/title>/);
});
test("SSR listing/home: canonical, noindex on search, product links", () => {
  const l = listingPage("https://shop.test", { products: [prod], total: 1, page: 1, pageSize: 24, category: "kurti", q: "", sort: "new" });
  assert.ok(l.includes('href="https://shop.test/category/kurti"') && l.includes("/product/red-poshak-7") && l.includes('content="index,follow"'));
  const s = listingPage("https://shop.test", { products: [], total: 0, page: 1, pageSize: 24, q: `"><script>x</script>`, sort: "new" });
  assert.ok(s.includes('content="noindex,follow"') && !s.includes("<script>x</script>"));
  const h = homePage("https://shop.test", { products: [prod] });
  assert.ok(h.includes("ClothingStore") && h.includes("Sarai Tareen") && h.includes("244303"));
  assert.ok(cardHtml(prod).includes("/product/red-poshak-7"));
});

test("product ratings: real averages render on cards; no reviews are not fabricated", () => {
  const rated = cardHtml({ ...prod, review_count: 3, average_rating: 4.7 });
  assert.match(rated, /4\.7/); assert.match(rated, /3 reviews/); assert.match(rated, /★/);
  const unrated = cardHtml({ ...prod, reviews_enabled: true, review_count: 0, average_rating: null });
  assert.match(unrated, /No reviews yet/); assert.doesNotMatch(unrated, /0\.0/);
  assert.match(cardHtml({ ...prod, reviews_enabled: false, review_count: 0 }), /Ratings coming soon/);
});

test("SSR reviews: approved customer text is escaped and only real aggregates enter Product JSON-LD", () => {
  const reviews = [{ id: 1, product_id: 7, customer_name: "Neha <script>alert(1)</script>", rating: 5, comment: "Beautiful product <img src=x onerror=alert(1)>", created_at: "2026-10-09T10:00:00.000Z" }];
  const html = productPage("https://shop.test", prod, [], {}, { configured: true, reviews, summary: { count: 1, average: 5 } });
  assert.ok(html.includes("Ratings &amp; reviews")); assert.ok(html.includes("Write a review"));
  assert.ok(!html.includes("<script>alert(1)</script>")); assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const p = ld.find((x) => x["@type"] === "Product");
  assert.equal(p.aggregateRating.ratingValue, "5.0"); assert.equal(p.aggregateRating.reviewCount, "1");
  assert.equal(p.review[0].reviewRating.ratingValue, 5);
});
