// Admin-only product management. Every request re-checks admin_users server-side.
import { route, requireAdmin, admin, jsonBody, HttpError } from "../../_lib.js";
import { product } from "../../_validate.js";
import { isActiveCategory, slugsFor, canonicalSlug } from "../../../public/js/categories.js";
import { loadAllCategories, resolveCustomCategory } from "../../_categories.js";
import { filterProducts, paginate, audit, unusedImagePaths, needsCategory, isLowStock, inStock } from "../../_admin_products.js";

const VCOLS = "id,product_id,sku,label,options,price,sale_price,stock,pack_qty,active,sort_order";
const dupMessage = (e) => (e?.code === "23505" || /duplicate key/i.test(e?.message || "")) ? new HttpError(409, /sku/i.test(e.message || e.details || "") ? "That SKU is already used by another product or variant." : "That name or code already exists.") : e;

async function attachVariants(db, products) {
  if (!products.length) return products;
  const { data, error } = await db.from("product_variants").select(VCOLS).in("product_id", products.map((p) => p.id)).order("sort_order", { ascending: true });
  const by = new Map();
  if (!error) for (const v of data || []) { if (!by.has(v.product_id)) by.set(v.product_id, []); by.get(v.product_id).push(v); }
  for (const p of products) p.variants = by.get(p.id) || [];
  return products;
}
async function referencedByOrders(db, key, id) {
  const { count } = await db.from("orders").select("id", { count: "exact", head: true }).contains("items", [{ [key]: id }]);
  return (count || 0) > 0;
}
async function saveVariants(db, productId, incoming) {
  if (incoming === undefined) return;
  const { data: cur } = await db.from("product_variants").select("id").eq("product_id", productId);
  const have = new Set((cur || []).map((v) => v.id));
  const keep = new Set();
  for (const v of incoming) {
    const row = { sku: v.sku, label: v.label, options: v.options, price: v.price, sale_price: v.sale_price, stock: v.stock, pack_qty: v.pack_qty, active: v.active, sort_order: v.sort_order, updated_at: new Date().toISOString() };
    if (v.id && have.has(v.id)) { const { error } = await db.from("product_variants").update(row).eq("id", v.id); if (error) throw dupMessage(error); keep.add(v.id); }
    else { const { data, error } = await db.from("product_variants").insert({ ...row, product_id: productId }).select("id").single(); if (error) throw dupMessage(error); if (data?.id) keep.add(data.id); }
  }
  for (const id of have) if (!keep.has(id)) {            // removed in the form: delete, or just hide if old orders mention it
    if (await referencedByOrders(db, "variant_id", id)) await db.from("product_variants").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    else await db.from("product_variants").delete().eq("id", id);
  }
}
const withBase = (row) => {                                // products with variants: base price = lowest variant price
  if (row.variants?.length) { row.price = Math.min(...row.variants.map((v) => v.price)); row.sale_price = null; }
  const { variants, ...cols } = row;
  return { cols, variants: row.variants };
};

export default route(["GET", "POST", "PATCH", "DELETE"], async (req, res) => {
  const user = await requireAdmin(req, res);
  const db = await admin();
  await loadAllCategories().catch(() => {});
  const b = req.method === "GET" ? {} : jsonBody(req);

  if (req.method === "GET") {
    const q = req.query || {};
    if (q.id) {
      const { data, error } = await db.from("products").select("*").eq("id", Number(q.id)).maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "Product not found.");
      await attachVariants(db, [data]);
      return res.json({ product: { ...data, needs_category: needsCategory(data) } });
    }
    const { data, error } = await db.from("products").select("*").order("created_at", { ascending: false }).limit(2000);
    if (error) throw error;
    const all = await attachVariants(db, data || []);
    const page = paginate(filterProducts(all, q), q.page, q.pageSize);
    const counts = { all: all.length, active: all.filter((p) => p.active && !p.archived).length, inactive: all.filter((p) => !p.active && !p.archived).length, archived: all.filter((p) => p.archived).length, out: all.filter((p) => !p.archived && !inStock(p)).length, low: all.filter((p) => !p.archived && isLowStock(p)).length, needs_category: all.filter(needsCategory).length };
    return res.json({ products: page.items.map((p) => ({ ...p, needs_category: needsCategory(p) })), total: page.total, page: page.page, pages: page.pages, pageSize: page.pageSize, counts });
  }

  const resolveCategory = async (body) => {                // "Others": reuse or create the category
    if (body.category === "__other__" || body.new_category_name) body.category = await resolveCustomCategory(body.new_category_name, body.new_category_group);
  };

  if (req.method === "POST") {
    if (b.action === "duplicate") {
      const { data: src } = await db.from("products").select("*").eq("id", Number(b.id)).maybeSingle();
      if (!src) throw new HttpError(404, "Product not found.");
      const [full] = await attachVariants(db, [src]);
      const { id, slug, created_at, updated_at, variants, ...cols } = src;
      const { data, error } = await db.from("products").insert({ ...cols, name: `${src.name} (copy)`.slice(0, 120), sku: null, active: false, archived: false }).select().single();
      if (error) throw dupMessage(error);
      for (const v of full.variants || []) await db.from("product_variants").insert({ product_id: data.id, label: v.label, options: v.options, price: v.price, sale_price: v.sale_price, stock: v.stock, pack_qty: v.pack_qty, active: v.active, sort_order: v.sort_order });
      await audit(db, user, "duplicate", "product", data.id, `Copied product #${src.id}`);
      return res.status(201).json({ product: data });
    }
    await resolveCategory(b);
    const { cols, variants } = withBase(product(b, undefined, { isActiveCategory }));
    const { data, error } = await db.from("products").insert(cols).select().single();
    if (error) throw dupMessage(error);
    try { await saveVariants(db, data.id, variants); } catch (e) { await db.from("products").delete().eq("id", data.id); throw e; }
    await audit(db, user, "create", "product", data.id, cols.name);
    return res.status(201).json({ product: data });
  }

  if (req.method === "PATCH" && b.action === "reassign") {    // move every product of an old category to another one
    const to = canonicalSlug(String(b.to || ""));
    if (!isActiveCategory(to)) throw new HttpError(400, "Choose an active category to move the products to.");
    const from = String(b.from || "");
    if (!from) throw new HttpError(400, "Choose the category to move from.");
    const { data, error } = await db.from("products").update({ category: to, updated_at: new Date().toISOString() }).in("category", slugsFor(from)).select("id");
    if (error) throw error;
    await audit(db, user, "reassign", "category", from, `${(data || []).length} product(s) moved from ${from} to ${to}`);
    return res.json({ moved: (data || []).length });
  }

  const id = Number(b.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "Invalid product id.");
  const { data: cur, error: e0 } = await db.from("products").select("*").eq("id", id).maybeSingle();
  if (e0) throw e0;
  if (!cur) throw new HttpError(404, "Product not found.");

  if (req.method === "PATCH") {
    await resolveCategory(b);
    await attachVariants(db, [cur]);
    const incoming = b.variants !== undefined ? b.variants : undefined;
    // partial updates (e.g. {id, active}) are merged with the stored product and fully re-validated
    const merged = { ...cur, ...b, variants: incoming !== undefined ? incoming : cur.variants.map((v) => ({ id: v.id, sku: v.sku, options: v.options, price: v.price, sale_price: v.sale_price, stock: v.stock, pack_qty: v.pack_qty, active: v.active })) };
    if (b.option_types === undefined) merged.option_types = cur.option_types || [];
    const { cols, variants } = withBase(product(merged, undefined, { isActiveCategory }));
    const { data, error } = await db.from("products").update({ ...cols, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw dupMessage(error);
    if (incoming !== undefined || cols.option_types.length !== (cur.option_types || []).length) await saveVariants(db, id, variants);
    const removed = (cur.image_urls || []).filter((u) => !cols.image_urls.includes(u));
    const gone = await unusedImagePaths(db, removed, id);
    if (gone.length) await db.storage.from("product-images").remove(gone).catch(() => {});
    await audit(db, user, "update", "product", id, Object.keys(b).filter((k) => k !== "id").slice(0, 12).join(", "));
    return res.json({ product: data });
  }

  // DELETE: products that appear in old orders are never deleted (archive them instead)
  if (await referencedByOrders(db, "product_id", id)) throw new HttpError(409, "This product is in past orders, so it cannot be deleted. Use Archive instead (it hides the product but keeps order history).");
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) throw error;
  const gone = await unusedImagePaths(db, cur.image_urls || [], id);
  if (gone.length) await db.storage.from("product-images").remove(gone).catch(() => {});
  await audit(db, user, "delete", "product", id, cur.name);
  res.json({ ok: true });
});
