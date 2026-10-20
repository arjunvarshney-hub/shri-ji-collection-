// POST raw image bytes (the browser already shrank the photo).
//  * default: ADMIN only -> products/<uuid>.<ext>
//  * ?kind=return: any logged-in customer, for return/problem photos -> returns/<uuid>.<ext> (small per-hour limit)
import { route, requireAdmin, requireUser, admin, readRaw, randomId, rateLimit, HttpError } from "./_lib.js";
import { imageKind } from "./_validate.js";

export const config = { api: { bodyParser: false } };
const MAX = 3 * 1024 * 1024;   // matches the bucket limit; under Vercel's 4.5 MB request cap

export default route(["POST"], async (req, res) => {
  const isReturn = req.query?.kind === "return";
  let folder = "products";
  if (isReturn) {
    const user = await requireUser(req, res);
    if (!rateLimit(`retphoto:${user.id}`, 12, 60 * 60 * 1000)) throw new HttpError(429, "Too many photos. Please try again later.");
    folder = "returns";
  } else await requireAdmin(req, res);
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX) throw new HttpError(413, "Photo is too large (max 3 MB). Please choose a smaller photo.");
  const buf = await readRaw(req, MAX);
  const kind = imageKind(buf);                       // magic-byte check: SVG/HTML/anything else is rejected
  if (!kind) throw new HttpError(400, "Only JPG, PNG or WebP photos are allowed.");
  const path = `${folder}/${randomId()}.${kind.ext}`; // server-chosen name: no user-controlled path
  const db = await admin();
  const { error } = await db.storage.from("product-images").upload(path, buf, { contentType: kind.type, upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  res.status(201).json({ url: db.storage.from("product-images").getPublicUrl(path).data.publicUrl });
});
