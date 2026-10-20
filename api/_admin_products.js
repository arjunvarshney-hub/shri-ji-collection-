// Admin product helpers: server-side search / filter / sort (so filters really change the result set), audit log, image safety.
import { catName, isActiveCategory, canonicalSlug } from "../public/js/categories.js";
import { priceInfo, variantInStock, unitsLeft } from "../public/js/render.js";
import { imagePrefix } from "./_validate.js";

const low = (s) => String(s ?? "").toLowerCase();
export const totalPieces = (p) => (p.variants?.length ? p.variants.filter((v) => v.active !== false).reduce((n, v) => n + Number(v.stock || 0), 0) : Number(p.stock || 0));
export const inStock = (p) => (p.variants?.length ? p.variants.some(variantInStock) : unitsLeft(p.stock, p.pack_size) >= 1);
export const isLowStock = (p) => inStock(p) && totalPieces(p) <= Number(p.low_stock_threshold ?? 5);
export const needsCategory = (p) => !isActiveCategory(canonicalSlug(p.category));

const SORTS = {
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  name_asc: (a, b) => low(a.name).localeCompare(low(b.name)),
  name_desc: (a, b) => low(b.name).localeCompare(low(a.name)),
  price_asc: (a, b) => priceInfo(a).price - priceInfo(b).price,
  price_desc: (a, b) => priceInfo(b).price - priceInfo(a).price,
  stock_asc: (a, b) => totalPieces(a) - totalPieces(b),
  stock_desc: (a, b) => totalPieces(b) - totalPieces(a),
  updated: (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at),
};
export const SORT_KEYS = Object.keys(SORTS);

/** products: rows with `variants` attached. All filters work together (AND). */
export function filterProducts(products, q = {}, now = Date.now()) {
  const term = low(q.q).trim();
  const num = (v) => (v === undefined || v === "" || v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const pmin = num(q.price_min), pmax = num(q.price_max);
  const colour = low(q.colour).trim(), size = low(q.size).trim(), pack = low(q.pack).trim();
  let list = products.filter((p) => {
    if (term) {
      const hit = low(p.name).includes(term) || low(p.sku).includes(term) || String(p.id) === term || low(catName(p.category)).includes(term) || low(p.category).includes(term) ||
        low(p.subcategory).includes(term) || (p.variants || []).some((v) => low(v.sku).includes(term));
      if (!hit) return false;
    }
    if (q.category && canonicalSlug(p.category) !== canonicalSlug(q.category)) return false;
    if (q.subcategory && low(p.subcategory) !== low(q.subcategory)) return false;
    const st = p.archived ? "archived" : p.active ? "active" : "inactive";
    if (q.status && q.status !== "all" && st !== q.status) return false;
    if (q.stock === "in" && !inStock(p)) return false;
    if (q.stock === "out" && inStock(p)) return false;
    if (q.stock === "low" && !isLowStock(p)) return false;
    const price = priceInfo(p).price;
    if (pmin !== null && price < pmin) return false;
    if (pmax !== null && price > pmax) return false;
    if (q.sale === "1" || q.sale === true) { if (priceInfo(p).mrp === null) return false; }
    if (q.returns === "yes" && p.return_eligible !== true) return false;
    if (q.returns === "no" && p.return_eligible !== false) return false;
    if (q.returns === "unset" && p.return_eligible !== null && p.return_eligible !== undefined) return false;
    const vs = p.variants || [];
    if (colour && !vs.some((v) => low(v.options?.colour).includes(colour))) return false;
    if (size && !(vs.some((v) => low(v.options?.size).includes(size)) || (p.sizes || []).some((s) => low(s) === size))) return false;
    if (pack && !vs.some((v) => low(v.options?.pack).includes(pack) || (Number(v.pack_qty) > 1 && String(v.pack_qty) === pack))) return false;
    if (q.needs_category === "1" && !needsCategory(p)) return false;
    if (q.recent === "1" && now - new Date(p.created_at) > 7 * 86400000) return false;
    return true;
  });
  list.sort(SORTS[q.sort] || SORTS.newest);
  return list;
}
export function paginate(list, page, pageSize) {
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const pg = Math.min(Math.max(Number(page) || 1, 1), pages);
  return { items: list.slice((pg - 1) * size, pg * size), page: pg, pageSize: size, total: list.length, pages };
}

/** Best-effort audit trail. Never blocks the action if the table is missing. */
export async function audit(db, user, action, entity, entityId, summary) {
  try { await db.from("admin_audit_log").insert({ actor_id: user?.id || null, actor_email: user?.email || null, action, entity, entity_id: String(entityId ?? ""), summary: String(summary || "").slice(0, 300) }); } catch { /* ignore */ }
}

/** Storage files that no other product still uses (duplicated products share photos). */
export async function unusedImagePaths(db, urls, excludeProductId) {
  const prefix = imagePrefix();
  const mine = urls.filter((u) => typeof u === "string" && u.startsWith(prefix));
  if (!mine.length) return [];
  const { data } = await db.from("products").select("id,image_urls");
  const used = new Set((data || []).filter((r) => r.id !== excludeProductId).flatMap((r) => r.image_urls || []));
  return mine.filter((u) => !used.has(u)).map((u) => u.slice(prefix.length));
}
