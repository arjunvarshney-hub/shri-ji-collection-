# Changelog

## 4.0.0: catalogue, variants, delivery rule, order tracking, returns, email (additive; needs `migrations/20261012_catalog_orders_v4.sql`)
* **Thakur Ji Poshak first:** new home page (hero, 10 category cards, collection grid, Ladies Wear secondary), menu/header order.
* **Categories:** 10 Thakur Ji + Kurti, Suit, Dupatta, Plazo. Removed Fall and Astar, Maxi, Gown, Saree, Dress Material (kept inactive, never deleted). Admin **Categories** tab. "Mala" + "Necklace" merged (old products still shown).
* **Product form:** SKU, brand, subcategory, status, short/full description, searchable category + "Others", variants (colour/size/material/design/pack) with own SKU/price/sale/stock/pack quantity, minimum order quantity, pack size (stock in pieces), cost price (admin only), low-stock alert, weight, dimensions, rich-text editor (sanitised), specifications, per-product return policy, photo reorder.
* **Storefront:** swipe gallery with 1/N counter, zoom viewer, option picker, pack/MOQ display, specifications table, return-policy box, delivery rule text.
* **Delivery:** below ₹499 = ₹50, ₹499 to ₹999.99 = ₹40, ₹1,000+ FREE, calculated in the database (browser value ignored); "Add ₹X more to unlock free delivery".
* **Orders:** timeline with times, courier tracking (manual), cancellation request vs immediate cancel, refund status, audit trail, filters/sorts/date range, valid status transitions only.
* **Returns:** item-level eligibility, deadline from the delivery date, problem reports (7 days), customer photos, admin Returns tab, full status flow.
* **Email (Resend):** owner mail on new order / payment / cancellation request / cancellation / returns; customer mails; outbox with no duplicates, retries and a status panel. See `EMAIL_SETUP.md`.
* **Admin product list:** server-side search, 15 filters, 9 sorts, pagination, quick actions (price, stock, in/out of stock, archive, duplicate).
* **Security:** `cost_price` is excluded from the public column grant (re-running `supabase.sql` can no longer re-expose it); customer return-photo upload (login, 3 MB, 12 per hour); admin audit log.
* Fixed: sitemap listed removed-category products; plain-text descriptions lost paragraph breaks.
* Tests: 83 unit/route tests, 202 browser checks.
* Not done: Paytm, courier API integration, drag-and-drop photo ordering, changing a variant inside the cart. See `CURRENT_AUDIT.md`.

## 3.0.0: SHRI JI Assistant + review hardening
* **New: SHRI JI Assistant** (chat). Server-side only, read-only, English/Hindi/Hinglish, real products only, works without an AI key ("store answers" mode), optional live AI through `ANTHROPIC_API_KEY`. Owner can switch it off and write FAQ answers in admin → Site. No new serverless function, no new table. See `AI_ASSISTANT_SETUP.md`.
* **Reviews:** added spam controls (burst limit, 3 per hour and 1 per product per day per visitor; one-way visitor hash), "not purchase-verified" label, and the additive migration `migrations/20261011_review_abuse_controls.sql`.
* Tests: 50 unit/API tests (was 34), 127 browser checks (was 90).
* New docs: `CURRENT_AUDIT.md`, `AI_ASSISTANT_SETUP.md`, `DEPLOYMENT_CHECKLIST.md`, `.env.example`, `.gitignore`.
* Changed files: `api/_assistant.js` (new), `api/_routes/site/chat.js` (new), `api/site.js`, `api/_lib.js`, `api/_validate.js`, `api/_catalog.js`, `api/_layout.js`, `api/products.js`, `api/_routes/admin/settings.js`, `vercel.json`, `public/js/chat.js` (new), `public/js/admin.js`, `public/style.css`, `migrations/20261011_review_abuse_controls.sql` (new), tests.

## 2.0.0: full rebuild on the existing Supabase + Vercel + Razorpay architecture

### 2.0.1
* Vercel Hobby deploy failed ("No more than 12 Serverless Functions"): 19 API files merged into 9 functions via dispatchers + rewrites. URLs unchanged. A test now fails if the count exceeds 12.
* `engines.node` pinned to `24.x` (Vercel discontinued 20.x) (removes the auto-upgrade warning).

### Fixed (critical)
* Storefront never showed products (`public/products.js` was empty; the API was never called). Pages now read the database.
* Order prices came from the browser. The server now recalculates everything from the database.
* No stock handling. Stock is reserved atomically in the database (row locks) and released on cancel/expiry.
* Payment verification: authenticated, ownership-checked, idempotent; webhook added.
* `vercel.json` did not build nested API folders (`api/admin`, `api/auth`, `api/orders`). Replaced with zero-config routing.
* Supabase client was created at import with possibly-undefined env, crashing every function. Now lazy.
* Login cookie expired after 1 h with no refresh. Refresh-token support added; `Secure` flag on HTTPS.
* Admin/storefront used `innerHTML` with unescaped data (stored XSS). All output is escaped; CSP added.
* Admin product API inserted the raw request body (mass assignment). Whitelist validation added.
* Upload accepted any file, any name. Now magic-byte checked, 3 MB cap, server-chosen name.
* Order statuses (`new`/`confirmed`) were inconsistent with the requested six. Constrained in the database.

### Added
* Premium mobile-first design (maroon / cream / white / gold), no external fonts.
* 18 categories in 2 groups; category pages, search, sorting, pagination (server-rendered).
* Product pages: gallery, sizes, quantity, sale price, JSON-LD, canonical, breadcrumbs.
* Cart (server-priced), checkout (COD / Razorpay), idempotent order creation, My Orders + detail, cancel, retry payment.
* Admin: product CRUD, visible switch, sale price, multi-photo upload from phone with preview/remove/cover, order search/filter/detail/status/notes.
* Password reset, email-confirmation handling, friendly auth errors.
* SEO: sitemap.xml, robots.txt, titles/descriptions, Open Graph, LocalBusiness + Product + Breadcrumb data.
* Security headers + CSP, CSRF (Origin) check, stricter RLS and column grants, storage bucket limits.
* Tests: 24 unit/API tests, 77 browser checks.

### Not done / needs live verification
* `supabase.sql` has never been executed against a real PostgreSQL (none available here); run it and re-test.
* Real Supabase Auth, Storage and Razorpay were not reachable; all were simulated (see AUDIT.md).
* `vercel build` / deployment not run. Nothing was deployed.
* No rate limiting beyond Supabase Auth's own limits.
* Shipping policy, returns policy and GST invoice are not built (business decisions needed).
* No real product photos exist in the uploaded project; products show a neutral "Photo coming soon" tile until you upload photos in /admin.
* Existing v1 products with free-text categories / external image URLs must be re-saved once in /admin (the form validates them).
