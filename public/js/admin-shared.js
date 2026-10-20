// Helpers shared by the admin screens.
import { $, STATUS_LABEL as SL } from "./common.js";
/* Phone photos are 3-8 MB: shrink to max 1600px JPEG (~300 KB) in the browser before uploading. */
export async function shrink(file, { max = 1600, png = false } = {}) {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error(`“${file.name}” is not a JPG, PNG or WebP photo.`);
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bmp = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error(`Could not read “${file.name}”.`)); im.src = URL.createObjectURL(file); }); }
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight, k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const ctx = c.getContext("2d"); if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); } ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((ok) => png ? c.toBlob(ok, "image/png") : c.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not process the photo.");
  return blob;
}
export async function upload(blob, endpoint = "/api/admin/upload-image") {
  let r;
  try { r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": blob.type }, body: blob, credentials: "same-origin" }); } catch { throw new Error("Upload failed: no internet connection."); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Photo upload failed.");
  return d.url;
}

/** Full-screen sheet (used for forms and details). Returns {el, close}. */
export function openSheet(html, { onClose } = {}) {
  const el = document.createElement("div");
  el.className = "sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = html;
  document.body.appendChild(el); document.body.style.overflow = "hidden";
  const close = () => { onClose?.(); el.remove(); if (!document.querySelector(".sheet")) document.body.style.overflow = ""; };
  return { el, close };
}
export const STATUS_LABEL = SL;
export const label = (s) => STATUS_LABEL[s] || String(s || "").replace(/_/g, " ");
export const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
