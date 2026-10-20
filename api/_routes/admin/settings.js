// Admin: logo + home picture. Public read happens via /api/site-settings.
import { route, requireAdmin, admin, jsonBody } from "../../_lib.js";
import { siteSettings, imagePrefix, SETTING_KEYS, IMAGE_SETTING_KEYS } from "../../_validate.js";

const load = async (db) => {
  const { data, error } = await db.from("site_settings").select("key,value");
  if (error) throw error;
  return Object.fromEntries((data || []).filter((r) => SETTING_KEYS.includes(r.key)).map((r) => [r.key, r.value || ""]));
};
export default route(["GET", "PATCH"], async (req, res) => {
  await requireAdmin(req, res);
  const db = await admin();
  if (req.method === "GET") return res.json({ settings: await load(db) });
  const clean = siteSettings(jsonBody(req));
  const before = await load(db);
  const rows = Object.entries(clean).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  const { error } = await db.from("site_settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
  const pfx = imagePrefix();
  const old = Object.keys(clean).filter((k) => IMAGE_SETTING_KEYS.includes(k)).map((k) => [before[k], clean[k]]).filter(([u, n]) => u && u !== n && u.startsWith(pfx)).map(([u]) => u.slice(pfx.length));
  if (old.length) await db.storage.from("product-images").remove(old).catch(() => {});   // best effort
  res.json({ settings: { ...before, ...clean } });
});
