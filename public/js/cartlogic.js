// Cart rules shared by the cart page, checkout and the tests. Display only: the server re-checks everything.
import { variantEff, unitsLeft } from "./render.js";
import { deliveryCharge, freeDeliveryNote } from "./delivery.js";

/** "Pack of 3" is shown only when the option label does not already say it. */
export const packNote = (label, pack) => (Number(pack) > 1 && !new RegExp(`pack of ${Number(pack)}\\b`, "i").test(String(label || "")) ? `Pack of ${pack}` : "");
/** Turns one cart item + the fresh product (with variants) from the server into a priced line. */
export function resolveLine(item, p) {
  if (!p) return { bad: "No longer available", item };
  const vs = (p.variants || []).filter((v) => v.active !== false);
  const out = { item, p };
  if (vs.length) {
    const v = vs.find((x) => x.id === item.v);
    if (!v) return { ...out, bad: "Please remove this item and choose the options again" };
    const unit = variantEff(v), pack = Math.max(1, Number(v.pack_qty) || 1);
    Object.assign(out, { variant: v, unit, mrp: unit < Number(v.price) ? Number(v.price) : null, pack, label: v.label, sku: v.sku || p.sku || "", max: unitsLeft(v.stock, pack) });
  } else {
    if (p.sizes?.length && !p.sizes.includes(item.size)) return { ...out, bad: "Please remove this item and choose a size again" };
    const sale = Number(p.sale_price), reg = Number(p.price), unit = sale > 0 && sale < reg ? sale : reg, pack = Math.max(1, Number(p.pack_size) || 1);
    Object.assign(out, { unit, mrp: unit < reg ? reg : null, pack, label: item.size || "", sku: p.sku || "", max: unitsLeft(p.stock, pack) });
  }
  if (out.max < 1) return { ...out, bad: "Sold out" };
  out.qty = Math.min(item.qty, out.max, 99);
  out.trimmed = out.qty < item.qty;
  out.pieces = out.qty * out.pack;
  return out;
}

/** lines: result of resolveLine for every cart item. */
export function summarize(lines) {
  const good = lines.filter((l) => !l.bad);
  const subtotal = Math.round(good.reduce((n, l) => n + l.unit * l.qty, 0) * 100) / 100;
  const perProduct = new Map();
  for (const l of good) perProduct.set(l.p.id, { p: l.p, qty: (perProduct.get(l.p.id)?.qty || 0) + l.qty });
  const moq = [...perProduct.values()].filter(({ p, qty }) => qty < Math.max(1, Number(p.min_order_qty) || 1)).map(({ p, qty }) => ({ name: p.name, min: Number(p.min_order_qty), have: qty, id: p.id }));
  const delivery = good.length ? deliveryCharge(subtotal) : 0;
  return { subtotal, delivery, total: Math.round((subtotal + delivery) * 100) / 100, moq, blocked: lines.some((l) => l.bad) || moq.length > 0, freeNote: good.length ? freeDeliveryNote(subtotal) : null };
}
