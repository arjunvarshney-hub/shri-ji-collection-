// Admin-only customer review moderation. All writes are verified server-side against admin_users.
import { route, requireAdmin, admin, jsonBody, HttpError } from "../../_lib.js";

const STATUSES = ["pending", "approved", "rejected"];
const missingSchema = (e) => {
  const message = String(e?.message || "");
  return ["42P01", "PGRST205"].includes(String(e?.code || ""))
    || /relation .*product_reviews.*does not exist/i.test(message)
    || (/could not find (the )?table.*schema cache/i.test(message) && /product_reviews/i.test(message));
};
const setupError = () => new HttpError(503, "Customer reviews are not configured yet. Apply migrations/20261010_product_reviews.sql in the Supabase SQL Editor first.");

export default route(["GET", "PATCH", "DELETE"], async (req, res) => {
  await requireAdmin(req, res);
  const db = await admin();
  try {
    if (req.method === "GET") {
      const requested = String(req.query?.status || "pending");
      if (requested !== "all" && !STATUSES.includes(requested)) throw new HttpError(400, "Invalid review status.");
      let qb = db.from("product_reviews").select("id,product_id,customer_name,rating,comment,status,created_at,updated_at").order("created_at", { ascending: false }).limit(200);
      if (requested !== "all") qb = qb.eq("status", requested);
      const { data, error } = await qb;
      if (error) throw error;
      const reviews = data || [];
      const ids = [...new Set(reviews.map((r) => Number(r.product_id)).filter(Number.isSafeInteger))];
      let names = new Map();
      if (ids.length) {
        const { data: products, error: productError } = await db.from("products").select("id,name,slug").in("id", ids);
        if (productError) throw productError;
        names = new Map((products || []).map((p) => [Number(p.id), p]));
      }
      return res.json({ reviews: reviews.map((r) => ({ ...r, product: names.get(Number(r.product_id)) || null })), total: reviews.length, status: requested });
    }

    const body = jsonBody(req);
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "Invalid review id.");
    if (req.method === "PATCH") {
      if (!STATUSES.includes(String(body.status))) throw new HttpError(400, "Choose Pending, Approved, or Rejected.");
      const { data, error } = await db.from("product_reviews").update({ status: body.status, updated_at: new Date().toISOString() }).eq("id", id)
        .select("id,product_id,customer_name,rating,comment,status,created_at,updated_at").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, "Review not found.");
      return res.json({ review: data });
    }
    const { data, error } = await db.from("product_reviews").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Review not found.");
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (missingSchema(error)) throw setupError();
    throw error;
  }
});
