// Input validation. Pure functions: easy to unit-test, never trust the browser.
import { HttpError } from "./_lib.js";
import { bySlug, canonicalSlug } from "../public/js/categories.js";
import { sanitizeRichText, htmlToText, plainToHtml } from "./_sanitize.js";

const CTRL = /[\u0000-\u001f\u007f]/g;
export function text(v, field, { min = 0, max = 200, required = false } = {}) {
  const s = typeof v === "string" ? v.replace(CTRL, " ").replace(/\s+/g, " ").trim() : v == null ? "" : null;
  if (s === null) throw new HttpError(400, `${field} is invalid.`);
  if (!s && !required) return "";
  if (s.length < Math.max(min, required ? 1 : 0)) throw new HttpError(400, `${field} is too short.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`);
  return s;
}
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
export function email(v, { required = false } = {}) {
  const s = text(v, "Email", { max: 120, required }).toLowerCase();
  if (s && !EMAIL_RE.test(s)) throw new HttpError(400, "Please enter a valid email address.");
  return s;
}
export function indianPhone(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) throw new HttpError(400, "Please enter a valid 10-digit mobile number.");
  return d;
}
export function customer(c) {
  if (!c || typeof c !== "object") throw new HttpError(400, "Delivery details are missing.");
  const pin = String(c.pincode ?? "").trim();
  if (!/^[1-9]\d{5}$/.test(pin)) throw new HttpError(400, "Please enter a valid 6-digit pincode.");
  let address;
  if (c.house !== undefined || c.locality !== undefined) {              // checkout form: House/Flat + Street/Locality + Landmark
    const house = text(c.house, "House / Flat number", { min: 1, max: 80, required: true });
    const locality = text(c.locality, "Street / Locality", { min: 3, max: 120, required: true });
    const landmark = text(c.landmark, "Landmark", { max: 80 });
    address = `${house}, ${locality}${landmark ? `, Landmark: ${landmark}` : ""}`;
  } else address = text(c.address, "Address", { min: 10, max: 300, required: true });
  return {
    name: text(c.name, "Name", { min: 2, max: 80, required: true }),
    phone: indianPhone(c.phone),
    email: email(c.email),
    address,
    city: text(c.city, "City", { min: 2, max: 60, required: true }),
    state: text(c.state, "State", { min: 2, max: 60, required: true }),
    pincode: pin,
  };
}
export function orderItems(items) {
  if (!Array.isArray(items) || items.length < 1) throw new HttpError(400, "Your cart is empty.");
  if (items.length > 20) throw new HttpError(400, "Too many different items in one order (max 20).");
  return items.map((it) => {
    const productId = Number(it?.productId), qty = Number(it?.qty);
    if (!Number.isSafeInteger(productId) || productId < 1) throw new HttpError(400, "Invalid product in cart.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new HttpError(400, "Quantity must be between 1 and 99.");
    const vRaw = it?.variantId;
    const variantId = vRaw === undefined || vRaw === null || vRaw === "" ? null : Number(vRaw);
    if (variantId !== null && !(Number.isSafeInteger(variantId) && variantId > 0)) throw new HttpError(400, "Invalid product option in cart.");
    return { productId, variantId, qty, size: text(it?.size, "Size", { max: 20 }) };
  });
}
export function idempotencyKey(v) {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) throw new HttpError(400, "Invalid request key.");
  return v;
}
export function orderNumber(v) {
  if (typeof v !== "string" || !/^SJC-[0-9A-Z-]{6,30}$/.test(v)) throw new HttpError(400, "Invalid order number.");
  return v;
}
/** Only images that live in OUR storage bucket are accepted as product images. */
export const imagePrefix = (supabaseUrl = process.env.SUPABASE_URL || "") =>
  `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/product-images/`;

export function sizes(v) {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out = [...new Set(arr.map((s) => text(s, "Size", { max: 20 })).filter(Boolean))];
  if (out.length > 15) throw new HttpError(400, "Too many sizes (max 15).");
  return out;
}
/** Plain multi-line text (keeps line breaks, removes control characters). */
export function multiline(v, field, max) {
  const s = typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : v == null ? "" : null;
  if (s === null) throw new HttpError(400, `${field} is invalid.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`);
  return s;
}
export const OPTION_TYPES = ["colour", "size", "material", "design", "pack"];
const intIn = (v, field, min, max, dflt) => {
  if (v === undefined || v === null || v === "") { if (dflt !== undefined) return dflt; throw new HttpError(400, `${field} is required.`); }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}.`);
  return n;
};
const moneyIn = (v, field, { required = false, max = 1000000 } = {}) => {
  if (v === undefined || v === null || v === "") { if (required) throw new HttpError(400, `${field} is required.`); return null; }
  const n = Number(v);
  if (!(n >= 0 && n <= max)) throw new HttpError(400, `${field} is not a valid amount.`);
  return Math.round(n * 100) / 100;
};
export function specsList(v) {
  const arr = Array.isArray(v) ? v : [];
  if (arr.length > 30) throw new HttpError(400, "Maximum 30 specification rows.");
  return arr.map((r) => ({ label: text(r?.label, "Specification name", { max: 60 }), value: text(r?.value, "Specification value", { max: 200 }) }))
    .filter((r) => r.label || r.value)
    .map((r) => { if (!r.label) throw new HttpError(400, "Each specification needs a name (the value alone is not enough)."); return r; });
}
export function variantList(v, optionTypes, productPrice) {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [];
  if (arr.length > 100) throw new HttpError(400, "Maximum 100 variants per product.");
  if (arr.length && !optionTypes.length) throw new HttpError(400, "Turn on at least one option (Colour, Size, Material, Design or Pack size) to use variants.");
  const seen = new Set();
  return arr.map((x, i) => {
    const row = i + 1;
    const options = {};
    for (const t of optionTypes) { const val = text(x?.options?.[t], `Variant ${row} ${t}`, { max: 40 }); if (val) options[t] = val; }
    if (!Object.keys(options).length) throw new HttpError(400, `Variant ${row}: fill at least one option value.`);
    const label = optionTypes.map((t) => options[t]).filter(Boolean).join(" / ");
    if (seen.has(label.toLowerCase())) throw new HttpError(400, `Variant "${label}" is entered twice.`);
    seen.add(label.toLowerCase());
    const price = moneyIn(x?.price ?? productPrice, `Variant ${row} price`, { required: true });
    if (!(price > 0)) throw new HttpError(400, `Variant ${row} price must be more than 0.`);
    const sale = moneyIn(x?.sale_price, `Variant ${row} sale price`);
    if (sale !== null && !(sale > 0 && sale < price)) throw new HttpError(400, `Variant ${row}: sale price must be less than its price.`);
    const sku = text(x?.sku, `Variant ${row} SKU`, { max: 40 });
    if (sku && !SKU_RE.test(sku)) throw new HttpError(400, `Variant ${row} SKU may use letters, numbers, - _ . / only.`);
    const id = x?.id === undefined || x?.id === null || x?.id === "" ? null : Number(x.id);
    if (id !== null && !(Number.isSafeInteger(id) && id > 0)) throw new HttpError(400, `Variant ${row} is invalid.`);
    return { id, sku: sku || null, label, options, price, sale_price: sale, stock: intIn(x?.stock, `Variant ${row} stock`, 0, 1000000, 0), pack_qty: intIn(x?.pack_qty, `Variant ${row} pack quantity`, 1, 1000, 1), active: x?.active === undefined ? true : x.active === true || x.active === "true", sort_order: i };
  });
}
export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._\-\/ ]{0,39}$/;

/**
 * Validates a full product payload and returns ONLY whitelisted columns.
 * The returned object has an extra `variants` array when the payload included one (the route stores it separately).
 * `isActiveCategory` lets the caller decide which category slugs are allowed.
 */
export function product(b, prefix = imagePrefix(), { isActiveCategory = (s) => !!bySlug[s] } = {}) {
  b = b && typeof b === "object" ? b : {};
  const category = canonicalSlug(String(b.category ?? ""));
  if (!isActiveCategory(category)) throw new HttpError(400, "Please choose a valid category.");
  const price = Number(b.price);
  if (!(price > 0 && price <= 1000000)) throw new HttpError(400, "Price must be greater than 0.");
  let sale_price = null;
  if (b.sale_price !== null && b.sale_price !== undefined && b.sale_price !== "") {
    sale_price = Number(b.sale_price);
    if (!(sale_price > 0 && sale_price < price)) throw new HttpError(400, "Sale price must be less than the regular price.");
  }
  const stock = intIn(b.stock, "Stock", 0, 1000000, 0);
  const imgs = Array.isArray(b.image_urls) ? b.image_urls : [];
  if (imgs.length > 10) throw new HttpError(400, "Maximum 10 photos per product.");
  for (const u of imgs) if (typeof u !== "string" || !u.startsWith(prefix) || u.length > 400) throw new HttpError(400, "Invalid image. Please upload photos using the uploader.");

  const optionTypes = [...new Set((Array.isArray(b.option_types) ? b.option_types : []).map(String))].filter((t) => OPTION_TYPES.includes(t));
  const variants = variantList(b.variants, optionTypes, price);
  const sku = text(b.sku, "Product SKU", { max: 40 });
  if (sku && !SKU_RE.test(sku)) throw new HttpError(400, "SKU may use letters, numbers, - _ . / only.");

  // Rich text: stored sanitised. `description` keeps a plain-text copy for search, SEO and chat.
  const html = b.description_html !== undefined && b.description_html !== null ? sanitizeRichText(String(b.description_html)) : plainToHtml(multiline(b.description, "Description", 3000));
  if (html.length > 20000) throw new HttpError(400, "Description is too long.");

  const status = b.status ? String(b.status) : null;
  if (status && !["active", "inactive", "archived"].includes(status)) throw new HttpError(400, "Invalid product status.");
  let archived = b.archived === true || b.archived === "true" || status === "archived";
  let active = b.active === undefined && !status ? true : b.active === true || b.active === "true" || status === "active";
  if (archived) active = false;

  const eligible = b.return_eligible === undefined || b.return_eligible === null || b.return_eligible === "" ? null : b.return_eligible === true || b.return_eligible === "true";
  let windowDays = null;
  if (eligible === true) windowDays = intIn(b.return_window_days, "Return window (days)", 1, 365);
  const row = {
    name: text(b.name, "Product name", { min: 2, max: 120, required: true }),
    sku: sku || null,
    category,
    subcategory: text(b.subcategory, "Subcategory", { max: 60 }) || null,
    brand: text(b.brand, "Brand", { max: 60 }) || null,
    price: Math.round(price * 100) / 100,
    sale_price: sale_price === null ? null : Math.round(sale_price * 100) / 100,
    cost_price: moneyIn(b.cost_price, "Cost price"),
    short_description: text(b.short_description, "Short description", { max: 300 }) || null,
    description_html: html || null,
    description: htmlToText(html, 3000) || null,
    material: text(b.material, "Material", { max: 100 }) || null,
    sizes: sizes(b.sizes),
    image_urls: imgs,
    stock,
    low_stock_threshold: intIn(b.low_stock_threshold, "Low stock alert", 0, 1000000, 5),
    min_order_qty: intIn(b.min_order_qty, "Minimum order quantity", 1, 99, 1),
    pack_size: intIn(b.pack_size, "Pack size", 1, 1000, 1),
    weight_grams: moneyIn(b.weight_grams, "Weight", { max: 1000000 }),
    dimensions: text(b.dimensions, "Dimensions", { max: 100 }) || null,
    specs: specsList(b.specs),
    option_types: optionTypes,
    return_eligible: eligible,
    return_window_days: windowDays,
    return_conditions: text(b.return_conditions, "Return conditions", { max: 1000 }) || null,
    return_instructions: text(b.return_instructions, "Return instructions", { max: 1000 }) || null,
    refund_policy: text(b.refund_policy, "Refund policy", { max: 1000 }) || null,
    active, archived,
  };
  if (variants !== undefined) row.variants = variants;
  return row;
}
export function imageKind(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

/** Site settings (logo / home picture): empty string = remove, otherwise must be an image from OUR bucket. */
export const IMAGE_SETTING_KEYS = ["logo_url", "hero_url"];
export const SETTING_KEYS = [...IMAGE_SETTING_KEYS, "chat_enabled", "chat_faq"];
/** Parses/cleans the FAQ list the owner edits in the admin (max 30 entries). Returns an array of {q,a}. */
export function faqList(input) {
  let arr = input;
  if (typeof input === "string") { try { arr = JSON.parse(input || "[]"); } catch { throw new HttpError(400, "FAQ format is invalid."); } }
  if (!Array.isArray(arr)) throw new HttpError(400, "FAQ format is invalid.");
  if (arr.length > 30) throw new HttpError(400, "Maximum 30 FAQ answers.");
  return arr.map((x) => ({ q: text(x?.q, "FAQ question", { min: 3, max: 200, required: true }), a: text(x?.a, "FAQ answer", { min: 3, max: 600, required: true }) }));
}
/** Site settings: images must live in OUR bucket (or "" to remove); chat_enabled is "1"/"0"; chat_faq is a validated list. */
export function siteSettings(b, prefix = imagePrefix()) {
  b = b && typeof b === "object" ? b : {};
  const out = {};
  for (const k of IMAGE_SETTING_KEYS) {
    if (b[k] === undefined) continue;
    const v = b[k] === null ? "" : b[k];
    if (typeof v !== "string" || (v !== "" && (!v.startsWith(prefix) || v.length > 400))) throw new HttpError(400, "Invalid image. Please upload it using the uploader.");
    out[k] = v;
  }
  if (b.chat_enabled !== undefined) {
    if (!["0", "1", 0, 1, true, false].includes(b.chat_enabled)) throw new HttpError(400, "Invalid assistant setting.");
    out.chat_enabled = b.chat_enabled === "1" || b.chat_enabled === 1 || b.chat_enabled === true ? "1" : "0";
  }
  if (b.chat_faq !== undefined) out.chat_faq = JSON.stringify(faqList(b.chat_faq));
  if (!Object.keys(out).length) throw new HttpError(400, "Nothing to update.");
  return out;
}
