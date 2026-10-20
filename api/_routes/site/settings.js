import { route } from "../../_lib.js";
import { getSettings } from "../../_catalog.js";
import { loadCategories } from "../../_categories.js";
import { CATEGORIES } from "../../../public/js/categories.js";
// Public: logo/home picture/assistant flag + the ACTIVE category list (so cart, checkout and account pages show the same menu).
export default route(["GET"], async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  await loadCategories();
  res.json({ settings: await getSettings(), categories: CATEGORIES.map((c) => ({ slug: c.slug, name: c.name, group: c.group, sort_order: c.sort_order, active: true, image_url: c.image_url })) });
});
