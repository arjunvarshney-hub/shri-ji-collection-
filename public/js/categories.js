// Category registry shared by the server and the browser.
// The DEFAULT list below is used until the database `categories` table is available.
// After that the server calls setCategories(rows) with the owner's list (see api/_categories.js).
export const GROUPS = [
  { slug: "thakur-ji-poshak", name: "Thakur Ji Poshak" },
  { slug: "ladies-wear", name: "Ladies Wear" },
];
const d = (slug, name, group, sort) => ({ slug, name, group, sort_order: sort, active: true, image_url: null });
export const DEFAULT_CATEGORIES = [
  d("laddu-gopal-poshak", "Laddu Gopal Poshak", "thakur-ji-poshak", 10),
  d("krishna-poshak", "Krishna Poshak", "thakur-ji-poshak", 20),
  d("devi-poshak", "Devi Poshak", "thakur-ji-poshak", 30),
  d("mukut", "Mukut", "thakur-ji-poshak", 40),
  d("mala-and-necklace", "Mala and Necklace", "thakur-ji-poshak", 50),
  d("bansuri", "Bansuri", "thakur-ji-poshak", 60),
  d("jhula", "Jhula", "thakur-ji-poshak", 70),
  d("singhasan", "Singhasan", "thakur-ji-poshak", 80),
  d("thakur-ji-shringar", "Thakur Ji Shringar", "thakur-ji-poshak", 90),
  d("other-thakur-ji-accessories", "Other Thakur Ji Accessories", "thakur-ji-poshak", 100),
  d("kurti", "Kurti", "ladies-wear", 110),
  d("suit", "Suit", "ladies-wear", 120),
  d("dupatta", "Dupatta", "ladies-wear", 130),
  d("plazo", "Plazo", "ladies-wear", 140),
];
// Categories the owner removed. They are kept as INACTIVE rows (never deleted) so old products/orders keep their names.
export const RETIRED = [["fall-and-astar", "Fall and Astar"], ["maxi", "Maxi"], ["gown", "Gown"], ["saree", "Saree"], ["dress-material", "Dress Material"]];
// Old separate "Mala" and "Necklace" products are shown under the merged "Mala and Necklace" category (no data is changed).
export const ALIASES = { mala: "mala-and-necklace", necklace: "mala-and-necklace" };
export const canonicalSlug = (slug) => ALIASES[slug] || slug;
/** Every stored slug that belongs to this category (itself + its aliases). */
export const slugsFor = (slug) => [slug, ...Object.keys(ALIASES).filter((a) => ALIASES[a] === slug)];

export let CATEGORIES = DEFAULT_CATEGORIES;                 // ACTIVE categories, in display order (navigation, filters, validation)
export let ALL_CATEGORIES = DEFAULT_CATEGORIES;             // including inactive (names for old products/orders)
export let bySlug = Object.fromEntries(CATEGORIES.map((x) => [x.slug, x]));
let allBySlug = bySlug;
export const groupBySlug = Object.fromEntries(GROUPS.map((x) => [x.slug, x]));

export function setCategories(rows) {
  const ok = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.slug === "string" && typeof r.name === "string" && groupBySlug[r.group || r.group_slug]);
  if (!ok.length) return;
  const norm = ok.map((r) => ({ slug: r.slug, name: r.name, group: r.group || r.group_slug, sort_order: Number(r.sort_order) || 0, active: r.active !== false, image_url: r.image_url || null, id: r.id }));
  ALL_CATEGORIES = [...norm].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  CATEGORIES = ALL_CATEGORIES.filter((c) => c.active);
  bySlug = Object.fromEntries(CATEGORIES.map((x) => [x.slug, x]));
  allBySlug = Object.fromEntries(ALL_CATEGORIES.map((x) => [x.slug, x]));
}
export const catName = (slug) => { const c = canonicalSlug(slug); return allBySlug[c]?.name || RETIRED.find((r) => r[0] === c)?.[1] || c || ""; };
export const isActiveCategory = (slug) => !!bySlug[canonicalSlug(slug)];
export const slugsInGroup = (g) => CATEGORIES.filter((x) => x.group === g).flatMap((x) => slugsFor(x.slug));
/** All stored slugs that the public shop may show (active categories + their aliases). */
export const publicSlugs = () => CATEGORIES.flatMap((x) => slugsFor(x.slug));
