// Public catalogue and product-review API. Customer submissions are moderated before becoming public.
import { route, shippingRule, HttpError, anon, admin, jsonBody, callerHash, rateLimit } from "./_lib.js";
import { queryProducts, getProductReviewData } from "./_catalog.js";

const reviewSetupMessage = "Customer reviews are not available right now. Please try again later. If this continues, the shop owner may need to finish the reviews database setup.";
const missingReviewSchema = (e) => {
  const message = String(e?.message || "");
  return ["42P01", "PGRST205", "42883", "PGRST202"].includes(String(e?.code || ""))
    || (/relation .*product_reviews.*does not exist/i.test(message))
    || (/could not find (the )?(table|function).*schema cache/i.test(message) && /product_reviews|get_product_review_summary/i.test(message));
};

function validReview(body) {
  const productId = Number(body.productId);
  if (!Number.isSafeInteger(productId) || productId < 1) throw new HttpError(400, "Invalid product.");
  const customerName = String(body.name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (customerName.length < 2 || customerName.length > 80) throw new HttpError(400, "Enter your name (2–80 characters).");
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Choose a rating from 1 to 5 stars.");
  const comment = String(body.comment ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (comment.length < 5 || comment.length > 1000) throw new HttpError(400, "Write a review of 5–1,000 characters.");
  return { productId, customerName, rating, comment };
}

export default route(["GET", "POST"], async (req, res) => {
  const q = req.query || {};
  if (String(q.action || "") === "reviews") {
    if (req.method === "GET") {
      const productId = Number(q.productId);
      if (!Number.isSafeInteger(productId) || productId < 1) throw new HttpError(400, "Invalid product.");
      const publicDb = await anon();
      const { data: product, error: productError } = await publicDb.from("products").select("id")
        .eq("id", productId).eq("active", true).maybeSingle();
      if (productError) throw productError;
      if (!product) throw new HttpError(404, "Product not found.");
      const result = await getProductReviewData(productId);
      if (!result.configured) throw new HttpError(503, reviewSetupMessage);
      return res.json({ reviews: result.reviews, summary: result.summary });
    }

    const body = jsonBody(req);
    // Honeypot field: ignore obvious bot submissions while returning a non-revealing response.
    if (String(body.website || "").trim()) {
      return res.status(202).json({ ok: true, message: "Thank you. Your review has been submitted for approval." });
    }
    const clean = validReview(body);
    const who = callerHash(req);
    // Layer 1 (per server instance): burst brake. Layer 2 (database, below): hourly / per-product limits.
    if (!rateLimit(`review:${who}`, 5, 60 * 60 * 1000)) throw new HttpError(429, "You have sent several reviews recently. Please try again later.");
    try {
      const db = await admin();
      const { data: product, error: productError } = await db.from("products").select("id")
        .eq("id", clean.productId).eq("active", true).maybeSingle();
      if (productError) throw productError;
      if (!product) throw new HttpError(404, "This product is unavailable for review.");
      // Database-backed limits need the optional submitter_hash column (migrations/20261011_review_abuse_controls.sql).
      let hashColumn = true;
      const since = (ms) => new Date(Date.now() - ms).toISOString();
      const recent = await db.from("product_reviews").select("id", { count: "exact", head: true }).eq("submitter_hash", who).gte("created_at", since(60 * 60 * 1000));
      if (recent.error) hashColumn = false;
      else if ((recent.count || 0) >= 3) throw new HttpError(429, "You have sent several reviews recently. Please try again later.");
      if (hashColumn) {
        const same = await db.from("product_reviews").select("id", { count: "exact", head: true }).eq("submitter_hash", who).eq("product_id", clean.productId).gte("created_at", since(24 * 60 * 60 * 1000));
        if (!same.error && (same.count || 0) >= 1) throw new HttpError(429, "You have already sent a review for this product. Thank you! It will appear after our shop approves it.");
      }
      const row = { product_id: clean.productId, customer_name: clean.customerName, rating: clean.rating, comment: clean.comment, status: "pending" };
      let { error } = await db.from("product_reviews").insert(hashColumn ? { ...row, submitter_hash: who } : row);
      if (error && hashColumn && /submitter_hash/i.test(String(error.message || ""))) ({ error } = await db.from("product_reviews").insert(row));
      if (error) throw error;
      return res.status(201).json({ ok: true, status: "pending", message: "Thank you. Your review has been sent to SHRI JI COLLECTION for approval before it appears publicly." });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (missingReviewSchema(error)) throw new HttpError(503, reviewSetupMessage);
      throw error;
    }
  }

  if (req.method !== "GET") throw new HttpError(404, "Unknown product API action.");
  const ids = q.ids ? String(q.ids).split(",").map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 30) : undefined;
  if (q.ids && !ids?.length) throw new HttpError(400, "Invalid ids");
  const out = await queryProducts({ ids, slug: q.slug, category: q.category, group: q.group, q: q.q, sort: q.sort, page: q.page, pageSize: 24 });
  res.setHeader("Cache-Control", ids ? "no-store" : "public, s-maxage=30, stale-while-revalidate=300");
  res.json({ ...out, shipping: shippingRule() });
});
