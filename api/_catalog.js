// Public catalogue queries. Uses the ANON key so Row Level Security applies (active products only).
import { anon } from "./_lib.js";
import { slugsInGroup, slugsFor, publicSlugs, isActiveCategory, canonicalSlug } from "../public/js/categories.js";
import { loadCategories } from "./_categories.js";

// ONLY columns granted to the public (anon) key. cost_price and other admin-only columns are deliberately absent.
export const PRODUCT_COLS = "id,slug,name,category,subcategory,brand,price,sale_price,description,description_html,short_description,material,sizes,image_urls,stock,sku,min_order_qty,pack_size,weight_grams,dimensions,specs,option_types,return_eligible,return_window_days,return_conditions,return_instructions,refund_policy,created_at,updated_at";
export const VARIANT_COLS = "id,product_id,sku,label,options,price,sale_price,stock,pack_qty,active,sort_order";

export async function queryProducts({ ids, slug, category, group, q, sort = "new", page = 1, pageSize = 24, limit } = {}) {
  const db = await anon();
  await loadCategories();
  let qb = db.from("products").select(PRODUCT_COLS, { count: "exact" }).eq("active", true).eq("archived", false);
  if (ids) qb = qb.in("id", ids);
  if (slug) qb = qb.eq("slug", slug);
  // Products whose category was removed/deactivated are hidden from the shop until the owner reassigns them.
  if (category && isActiveCategory(category)) qb = qb.in("category", slugsFor(canonicalSlug(category)));
  else if (group) qb = qb.in("category", slugsInGroup(group));
  else qb = qb.in("category", publicSlugs());
  const term = String(q || "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (term) qb = qb.or(`name.ilike.%${term}%,material.ilike.%${term}%,description.ilike.%${term}%`);
  qb = sort === "price_asc" ? qb.order("price", { ascending: true }) : sort === "price_desc" ? qb.order("price", { ascending: false }) : qb.order("created_at", { ascending: false });
  const size = Math.min(Math.max(Number(limit || pageSize) || 24, 1), 60);
  const from = (Math.max(Number(page) || 1, 1) - 1) * size;
  const { data, error, count } = await qb.range(from, from + size - 1);
  if (error) throw error;
  const products = data || [];
  if (products.length) {                                   // attach active variants (public columns only)
    try {
      const { data: vs } = await db.from("product_variants").select(VARIANT_COLS).in("product_id", products.map((p) => p.id)).eq("active", true).order("sort_order", { ascending: true });
      const by = new Map();
      for (const v of vs || []) { if (!by.has(v.product_id)) by.set(v.product_id, []); by.get(v.product_id).push(v); }
      for (const p of products) p.variants = by.get(p.id) || [];
    } catch { for (const p of products) p.variants = []; }   // variants table not migrated yet: old behaviour
  }
  // Ratings are optional until the additive product_reviews migration is applied. A review-feature
  // setup problem must never take the core product catalogue offline.
  if (products.length) {
    try {
      const { data: summaries, error: summaryError } = await db.rpc("get_product_review_summary", {
        p_product_ids: products.map((p) => Number(p.id)).filter(Number.isSafeInteger),
      });
      if (!summaryError && Array.isArray(summaries)) {
        const byId = new Map(summaries.map((r) => [Number(r.product_id), r]));
        for (const p of products) {
          const summary = byId.get(Number(p.id));
          p.reviews_enabled = true;
          p.review_count = Number(summary?.review_count || 0);
          p.average_rating = summary?.average_rating == null ? null : Number(summary.average_rating);
        }
      }
    } catch { /* review migration not yet applied or temporarily unavailable */ }
  }
  for (const p of products) { p.reviews_enabled ??= false; p.review_count ??= 0; p.average_rating ??= null; }
  return { products, total: count ?? products.length, page: Math.max(Number(page) || 1, 1), pageSize: size };
}

/** Read only public/approved reviews. Missing review schema is reported as not configured, never as a fake zero rating. */
export async function getProductReviewData(productId) {
  try {
    const db = await anon();
    const { data, error } = await db.from("product_reviews")
      .select("id,product_id,customer_name,rating,comment,created_at")
      .eq("product_id", Number(productId)).eq("status", "approved")
      .order("created_at", { ascending: false }).limit(20);
    if (error) return { configured: false, reviews: [], summary: null };
    const { data: summaries, error: summaryError } = await db.rpc("get_product_review_summary", { p_product_ids: [Number(productId)] });
    if (summaryError || !Array.isArray(summaries)) return { configured: false, reviews: [], summary: null };
    const summary = summaries.find((r) => Number(r.product_id) === Number(productId));
    return {
      configured: true,
      reviews: data || [],
      summary: { count: Number(summary?.review_count || 0), average: summary?.average_rating == null ? null : Number(summary.average_rating) },
    };
  } catch {
    return { configured: false, reviews: [], summary: null };
  }
}

/** Logo + home picture. Never throws: if the table is missing the site simply shows the text logo. */
export async function getSettings() {
  try {
    const db = await anon();
    const { data, error } = await db.from("site_settings").select("key,value");
    if (error || !data) return {};
    const o = {};
    for (const r of data) if (["logo_url", "hero_url", "chat_enabled"].includes(r.key) && r.value) o[r.key] = r.value;
    return o;
  } catch { return {}; }
}
