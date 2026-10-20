import { siteUrl, anon } from "../../_lib.js";
import { loadCategories } from "../../_categories.js";
import { CATEGORIES, GROUPS, publicSlugs } from "../../../public/js/categories.js";
const x = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

export default async function handler(req, res) {
  const site = siteUrl(req);
  try {
    await loadCategories();
    const db = await anon();
    const rows = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await db.from("products").select("slug,updated_at").eq("active", true).eq("archived", false).in("category", publicSlugs()).order("id").range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const urls = [["/", null], ["/shop", null], ...GROUPS.map((g) => ["/category/" + g.slug, null]), ...CATEGORIES.map((c) => ["/category/" + c.slug, null]),
      ...rows.map((p) => ["/product/" + encodeURIComponent(p.slug), p.updated_at])];
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(([p, m]) => `<url><loc>${x(site + p)}</loc>${m ? `<lastmod>${new Date(m).toISOString()}</lastmod>` : ""}</url>`).join("")}</urlset>`);
  } catch (e) {
    console.error("[sitemap]", e?.message || e);
    res.status(500).setHeader("Cache-Control", "no-store").send("sitemap unavailable");
  }
}
