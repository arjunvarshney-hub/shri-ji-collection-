// Return / problem-report rules (pure functions: easy to test). Eligibility is ALWAYS decided per item, on the server.
export const ISSUE_DAYS = 7;   // damaged / defective / wrong item can be reported for this many days after delivery
export const RETURN_REASONS = ["Wrong size / does not fit", "Not as described", "Changed my mind", "Damaged", "Defective", "Wrong item received", "Other"];
export const ISSUE_REASONS = ["Damaged", "Defective", "Wrong item received", "Other"];
export const RETURN_STATUSES = ["requested", "approved", "rejected", "pickup_scheduled", "in_transit", "returned", "refund_processing", "refunded", "cancelled"];
// What the admin may do next (keeps the process honest and in order).
export const RETURN_NEXT = {
  requested: ["approved", "rejected"],
  approved: ["pickup_scheduled", "returned", "refund_processing", "rejected"],
  pickup_scheduled: ["in_transit", "returned"],
  in_transit: ["returned"],
  returned: ["refund_processing", "refunded"],
  refund_processing: ["refunded"],
  rejected: [], refunded: [], cancelled: [],
};
const DAY = 86400000;

/** Per order line: policy snapshot (as it was when ordered), deadline, and what the customer may do now. */
export function returnInfo(order, item, now = Date.now()) {
  const p = item?.return_policy || {};
  const policy = { eligible: p.eligible === true ? true : p.eligible === false ? false : null, window_days: Number(p.window_days) || null, conditions: p.conditions || null, instructions: p.instructions || null, refund_policy: p.refund_policy || null };
  const delivered = order?.delivered_at ? new Date(order.delivered_at).getTime() : null;
  const out = { policy, delivered_at: order?.delivered_at || null, return_deadline: null, issue_deadline: null, can_return: false, can_report_issue: false, note: "" };
  if (order?.order_status !== "delivered" || !delivered) { out.note = "Return options appear after the order is delivered."; return out; }
  out.issue_deadline = new Date(delivered + ISSUE_DAYS * DAY).toISOString();
  out.can_report_issue = now <= delivered + ISSUE_DAYS * DAY;
  if (policy.eligible === true && policy.window_days) {
    out.return_deadline = new Date(delivered + policy.window_days * DAY).toISOString();
    out.can_return = now <= delivered + policy.window_days * DAY;
    out.note = out.can_return ? "" : "The return window for this item has ended.";
  } else if (policy.eligible === false) out.note = "Non-returnable item. If it arrived damaged, defective or wrong, use Report a problem.";
  else out.note = "The shop has not set a return policy for this item. Please contact the shop.";
  return out;
}
