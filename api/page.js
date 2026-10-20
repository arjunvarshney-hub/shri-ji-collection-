// Server-rendered public pages (home, shop, category, product) so Google and slow phones get real HTML.
import { siteUrl } from "./_lib.js";
import { queryProducts, getSettings, getProductReviewData } from "./_catalog.js";
import { loadCategories } from "./_categories.js";
import { homePage, listingPage, productPage, notFoundPage } from "./_layout.js";
import { bySlug, groupBySlug, canonicalSlug } from "../public/js/categories.js";

const one = (v) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req, res) {
  const site = siteUrl(req);
  const q = req.query || {};
  const type = one(q.type), slug = String(one(q.slug) || "").toLowerCase();
  const send = (status, html, cache = "public, s-maxage=60, stale-while-revalidate=600") => {
    res.status(status).setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", status === 200 ? cache : "no-store");
    res.send(html);
  };
  try {
    await loadCategories();
    const settings = await getSettings();
    if (type === "product") {
      const { products } = await queryProducts({ slug });
      const p = products[0];
      if (!p) return send(404, notFoundPage(site, "Product", settings));
      const rel = (await queryProducts({ category: p.category, limit: 5 })).products.filter((x) => x.id !== p.id).slice(0, 4);
      const reviewData = await getProductReviewData(Number(p.id));
      return send(200, productPage(site, p, rel, settings, reviewData));
    }
    if (type === "category" || type === "shop") {
      const category = type === "category" && bySlug[canonicalSlug(slug)] ? canonicalSlug(slug) : undefined;
      const group = type === "category" && groupBySlug[slug] ? slug : undefined;
      if (type === "category" && !category && !group) return send(404, notFoundPage(site, "Category", settings));
      const qs = String(one(q.q) || "").slice(0, 60), sort = ["price_asc", "price_desc"].includes(one(q.sort)) ? one(q.sort) : "new";
      const r = await queryProducts({ category, group, q: qs, sort, page: one(q.page), pageSize: 24 });
      return send(200, listingPage(site, { ...r, category, group, q: qs, sort, settings }));
    }
    const thakur = (await queryProducts({ group: "thakur-ji-poshak", limit: 40 })).products;
    const ladies = (await queryProducts({ group: "ladies-wear", limit: 8 })).products;
    return send(200, homePage(site, { thakur, ladies, settings }));
  } catch (e) {
    console.error("[page]", e?.message || e);
    res.status(500).setHeader("Content-Type", "text/html; charset=utf-8").setHeader("Cache-Control", "no-store");
    res.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Temporarily unavailable</title><body style="font-family:sans-serif;padding:2rem;text-align:center"><h1>SHRI JI COLLECTION</h1><p>The shop is temporarily unavailable. Please try again in a minute.</p>');
  }
}
