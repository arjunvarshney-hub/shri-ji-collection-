// /api/admin/products and /api/admin/orders (rewritten to ?action=). Both re-check admin rights on every call.
import products from "./_routes/admin/products.js";
import orders from "./_routes/admin/orders.js";
import settings from "./_routes/admin/settings.js";
import categories from "./_routes/admin/categories.js";
import returns from "./_routes/admin/returns.js";
import emails from "./_routes/admin/emails.js";
import reviews from "./_routes/admin/reviews.js";
const actions = { products, orders, settings, categories, reviews, returns, emails };
export default (req, res) => {
  const h = Object.hasOwn(actions, req.query?.action) ? actions[req.query.action] : null;
  return h ? h(req, res) : res.status(404).json({ error: "Not found" });
};
