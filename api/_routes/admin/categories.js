// Admin-only category manager: add, rename, sort, activate/deactivate, delete (only when empty).
import { route, requireAdmin, admin, jsonBody, HttpError } from "../../_lib.js";
import { loadAllCategories, resolveCustomCategory, slugify } from "../../_categories.js";
import { slugsFor, groupBySlug, canonicalSlug } from "../../../public/js/categories.js";
import { audit } from "../../_admin_products.js";

const nameOf = (n) => String(n ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
async function counts(db, cats) {
  const { data } = await db.from("products").select("id,category,archived");
  const n = {};
  for (const p of data || []) { const c = canonicalSlug(p.category); n[c] = (n[c] || 0) + 1; }
  const known = new Set(cats.flatMap((c) => slugsFor(c.slug)));
  return { perCategory: n, orphans: (data || []).filter((p) => !known.has(p.category)).length };
}

export default route(["GET", "POST", "PATCH", "DELETE"], async (req, res) => {
  const user = await requireAdmin(req, res);
  const db = await admin();
  const b = req.method === "GET" ? {} : jsonBody(req);

  if (req.method === "POST") {
    const slug = await resolveCustomCategory(b.name, b.group);
    await audit(db, user, "create", "category", slug, nameOf(b.name));
    if (b.image_url) await db.from("categories").update({ image_url: String(b.image_url).slice(0, 400) }).eq("slug", slug);
  } else if (req.method === "PATCH") {
    if (Array.isArray(b.order)) {                                   // "sort": ids in the wanted order
      const ids = b.order.map(Number).filter(Number.isSafeInteger).slice(0, 200);
      for (const [i, id] of ids.entries()) await db.from("categories").update({ sort_order: (i + 1) * 10, updated_at: new Date().toISOString() }).eq("id", id);
      await audit(db, user, "sort", "category", "", `${ids.length} categories re-ordered`);
    } else {
      const id = Number(b.id);
      if (!Number.isSafeInteger(id)) throw new HttpError(400, "Invalid category.");
      const { data: cur } = await db.from("categories").select("*").eq("id", id).maybeSingle();
      if (!cur) throw new HttpError(404, "Category not found.");
      const patch = { updated_at: new Date().toISOString() };
      if (b.name !== undefined) {
        const n = nameOf(b.name);
        if (n.length < 2 || n.length > 40) throw new HttpError(400, "Category name must be 2 to 40 characters.");
        const { data: all } = await db.from("categories").select("id,name,slug");
        if ((all || []).some((c) => c.id !== id && (c.name.toLowerCase() === n.toLowerCase() || slugify(c.name) === slugify(n)))) throw new HttpError(409, "Another category already has this name.");
        patch.name = n;                                             // slug stays the same, so products and links keep working
      }
      if (b.group !== undefined) { if (!groupBySlug[b.group]) throw new HttpError(400, "Invalid group."); patch.group_slug = b.group; }
      if (b.sort_order !== undefined) { const s = Number(b.sort_order); if (!Number.isFinite(s)) throw new HttpError(400, "Invalid sort number."); patch.sort_order = Math.round(s); }
      if (b.active !== undefined) patch.active = b.active === true || b.active === "true";
      if (b.image_url !== undefined) patch.image_url = b.image_url ? String(b.image_url).slice(0, 400) : null;
      const { error } = await db.from("categories").update(patch).eq("id", id);
      if (error) throw error;
      await audit(db, user, "update", "category", cur.slug, Object.keys(patch).filter((k) => k !== "updated_at").join(", "));
    }
  } else if (req.method === "DELETE") {
    const id = Number(b.id);
    const { data: cur } = await db.from("categories").select("*").eq("id", id).maybeSingle();
    if (!cur) throw new HttpError(404, "Category not found.");
    const { count } = await db.from("products").select("id", { count: "exact", head: true }).in("category", slugsFor(cur.slug));
    if ((count || 0) > 0) throw new HttpError(409, `${count} product(s) are in this category. Move them to another category (or archive them) first. You can also just turn the category off.`);
    const { error } = await db.from("categories").delete().eq("id", id);
    if (error) throw error;
    await audit(db, user, "delete", "category", cur.slug, cur.name);
  }

  const cats = await loadAllCategories();
  const c = await counts(db, cats);
  res.json({ categories: cats.map((x) => ({ ...x, products: c.perCategory[x.slug] || 0 })), orphans: c.orphans });
});
