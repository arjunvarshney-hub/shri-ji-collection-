// Delivery charge rules. SAME rule is implemented in SQL (public.delivery_charge) and checked by tests.
//   subtotal below 499            -> Rs 50
//   subtotal 499 to 999.99        -> Rs 40
//   subtotal 1000 or more         -> FREE
// Subtotal = merchandise total AFTER product discounts (sale prices), BEFORE delivery, tax or fees.
export const TIER_LOW = 499, TIER_FREE = 1000;
export function deliveryCharge(subtotal) {
  const s = Math.round(Number(subtotal) * 100) / 100;
  if (!Number.isFinite(s) || s < 0) return 50;
  if (s >= TIER_FREE) return 0;
  if (s >= TIER_LOW) return 40;
  return 50;
}
/** "Add Rs 200 more to unlock free delivery." (null when already free) */
export function freeDeliveryNote(subtotal) {
  const s = Math.round(Number(subtotal) * 100) / 100;
  if (s >= TIER_FREE) return null;
  const more = Math.round((TIER_FREE - s) * 100) / 100;
  return `Add ₹${Number.isInteger(more) ? more : more.toFixed(2)} more to unlock free delivery.`;
}
export const deliveryRuleText = "Delivery: ₹50 below ₹499 · ₹40 from ₹499 to ₹999.99 · FREE from ₹1,000";
