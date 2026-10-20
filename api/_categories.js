// Server side category loading / management. The browser-visible registry lives in public/js/categories.js.
import { anon, admin, HttpError } from "./_lib.js";
import { setCategories, groupBySlug } from "../public/js/categories.js";

let loadedAt = 0;
/** Refreshes the shared registry from the database (cached 30 s). Falls back to the built-in list if the table is not there yet. */
export async function loadCategories(force = false) {
  if (!force && Date.now() - loadedAt < 30000) return;
  try {
    const db = await anon();
    const { data, error } = await db.from("categories").select("id,slug,name,group_slug,sort_order,active,image_url");
    if (!error && Array.isArray(data) && data.length) setCategories(data.map((r) => ({ ...r, active: r.active !== false })));
  } catch { /* categories table not created yet: keep the built-in list */ }
  loadedAt = Date.now();
}
/** Admin: all categories including inactive ones (service role). */
export async function loadAllCategories() {
  const { data, error } = await (await admin()).from("categories").select("*").order("sort_order", { ascending: true });
  if (error) throw error;
  setCategories(data || []);
  loadedAt = Date.now();
  return data || [];
}
export const slugify = (name) => String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const cleanName = (n) => String(n ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();

/**
 * "Others" in the product form: reuse an existing category with the same name/slug, otherwise create it.
 * Prevents accidental duplicates (case-insensitive, punctuation-insensitive).
 */
export async function resolveCustomCategory(name, group) {
  const n = cleanName(name);
  if (n.length < 2 || n.length > 40) throw new HttpError(400, "Category name must be 2 to 40 characters.");
  if (!groupBySlug[group]) throw new HttpError(400, "Please choose where the new category belongs (Thakur Ji Poshak or Ladies Wear).");
  const slug = slugify(n);
  if (!slug) throw new HttpError(400, "Please use letters or numbers in the category name.");
  const db = await admin();
  const { data: all, error } = await db.from("categories").select("id,slug,name,active,group_slug");
  if (error) throw error;
  const same = (all || []).find((c) => c.slug === slug || slugify(c.name) === slug);
  if (same) {
    if (!same.active) await db.from("categories").update({ active: true, updated_at: new Date().toISOString() }).eq("id", same.id);
    await loadAllCategories();
    return same.slug;
  }
  const { error: e2 } = await db.from("categories").insert({ slug, name: n, group_slug: group, sort_order: 500 + (all || []).length, active: true });
  if (e2) throw e2;
  await loadAllCategories();
  return slug;
}
