import { siteUrl } from "../../_lib.js";
export default function handler(req, res) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600");
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /cart\nDisallow: /checkout\nDisallow: /account\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
}
