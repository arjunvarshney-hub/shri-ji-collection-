# CURRENT AUDIT: v4 catalogue / orders upgrade (evidence-based)

**Base:** the repository ZIP supplied by the owner (v3.0.0: assistant + reviews). **Not accessed:** GitHub, Vercel, the live Supabase database, live Razorpay, a real email provider, a real phone.
Status words: `PASS`, `FAIL`, `PARTIALLY IMPLEMENTED`, `NOT TESTABLE`, `NOT IMPLEMENTED`.
"PASS (fake DB)" = tested in a real browser / real handlers against an in-memory fake of Supabase. The real SQL has **not** been executed anywhere.

| # | Requirement | Status | Evidence / notes |
|---|---|---|---|
| 1 | Thakur Ji Poshak is the priority everywhere | PASS (fake DB) | Hero CTA, 10 category cards, "Thakur Ji Collection" grid before Ladies Wear; Thakur Ji first in menu / header; checked on phone and desktop |
| 2A | 10 Thakur Ji categories; admin can add, rename, sort, on/off, delete safely | PASS (fake DB) | Categories tab. Delete is refused while products exist. Old "Mala" and "Necklace" products show under "Mala and Necklace" (alias, data unchanged) |
| 2B | Ladies Wear = Kurti, Suit, Dupatta, Plazo; remove 5 categories | PASS (fake DB) | Removed from menu, filters, home, sitemap, category URLs (404). Kept as **inactive rows**, nothing deleted. **Decision:** products still in a removed category are **hidden from customers** until the owner moves them (Categories tab banner + one-click move, or Products → "Needs category") |
| 3A-C | Product form: SKU, subcategory, brand, status, short/full description; category dropdown + search + "Others" (no duplicates) | PASS (fake DB) | Searchable category box; "Others" reuses a same-name category (any case) |
| 3C | Variants (colour, size, material, design, pack), own SKU / price / sale / stock / pack quantity / availability; custom values; MOQ; pack size ≠ MOQ; stock in pieces | PASS (fake DB) / **SQL NOT TESTABLE** | "Create all combinations" helper; DB function reserves `qty × pack` pieces atomically; unit tests + browser checks |
| 3D | Regular / sale / cost (admin only) / stock / low-stock / MOQ / pack / weight / dimensions | PASS (fake DB) | Cost price excluded from the public column grant, the public API, the page HTML (tests). **Needs the migration to take effect in the real DB** |
| 4 | Images: upload from phone, preview, remove, reorder, main photo, validation, resize | PASS (fake DB) | Reorder is with ◀ ▶ buttons (no drag-and-drop). Progress is "photo 2 of 4" (not a byte bar) |
| 4 | Customer gallery: swipe, thumbnails, zoom, "1/5" counter, lazy loading | PASS (fake DB) / **real-finger swipe + pinch NOT TESTABLE** | Native scroll-snap track; zoom viewer uses the browser's own pinch-zoom. Tested by scrolling the track and clicking |
| 5 | Rich-text editor; formatting preserved; no raw HTML; XSS-safe | PASS (fake DB) | Bold/italic/underline/heading/paragraph/lists/alignment/links/undo/redo/clear. Server-side allow-list sanitiser (11 attack strings + browser test). Uses `document.execCommand`; **not tested with real Android keyboards** |
| 6 | Specifications (custom rows, rename, reorder, hide empty, table) | PASS (fake DB) | Suggested fields for Thakur Ji / Ladies Wear are optional buttons |
| 7 | Delivery: <₹499 = ₹50; ₹499-₹999.99 = ₹40; ≥₹1,000 FREE; server-side; "Add ₹X more" | PASS (fake DB) | Boundaries 498.99 / 499 / 999.99 / 1000 tested in JS, in the real order handler (browser) and by reading the SQL function. Rule is fixed in code (not editable in admin) |
| 8 | Cart / checkout (variants, pack size, MOQ, address parts, no duplicate order) | PASS (fake DB) | House/Flat, Street/Locality, Landmark, City, State, PIN. Variant cannot be changed inside the cart (remove and add again) |
| 9 | Order tracking: stages, timeline with times, own orders only, cancel, return | PASS (fake DB) | Placed → Confirmed → Processing → Packed → Shipped → Out for Delivery → Delivered, Cancellation Requested, Cancelled. Courier ID/link shown only if the owner enters it. **No courier API integration** |
| 10 | Product-specific return policy; item-level eligibility; deadline from delivery date | PASS (fake DB) | Existing products have "not set" until the owner chooses Yes/No. Damaged / defective / wrong items can be reported for **7 days** after delivery even on non-returnable items (fixed in code). **Please get this wording reviewed legally** |
| 10 | Return process + refund status + audit | PASS (fake DB) | requested → approved → pickup → in transit → returned → refund processing → refunded; customer photos (stored in the public bucket under unguessable names) |
| 11 | Admin product tools: duplicate, archive, delete (blocked if in orders), in/out of stock, price, stock, variants, images, specs, returns | PASS (fake DB) | |
| 12 | Admin search / filter / sort (all server-side) | PASS (fake DB) | Name, SKU, ID, category, variant SKU; 15 filters; 9 sorts; pagination; counts. Loads up to 2,000 products at once (enough for a shop of this size) |
| 13 | Admin orders dashboard + valid transitions + audit | PASS (fake DB) | Filters: search, status, delivery, payment status/method, date range; sorts; only valid next buttons; invalid jumps refused by the API and the database function |
| 14 | Email: new order, cancellation request vs cancelled, return/refund, customer mails; outbox, no duplicates, retries, no false "sent" | PASS (simulated provider) / **real delivery NOT TESTABLE** | Resend REST API. The message you sent was cut off after "unless the provider confirms"; I implemented that rule (sent only when the provider returns an id). **Anything you wrote after that point was not seen** |
| – | Reviews + assistant from v3 | PASS | Still working with variants/pack/new categories |
| – | Razorpay + COD preserved | PASS (stubbed gateway) / NOT TESTABLE (real) | Paid-email added to verify + webhook |
| – | Paytm | NOT IMPLEMENTED | Needs your merchant account and approval |
| – | Function count | PASS (static) | 9 files under `api/` (limit 12) |
| – | Migration safety | PASS (static review) / **NOT TESTABLE** (never run on PostgreSQL) | Additive; replaces only the order functions; see `DEPLOYMENT_CHECKLIST.md` |
| – | Vercel Preview / Production, real Supabase, Core Web Vitals | NOT TESTABLE | No access |

## Test evidence (this environment)
* `npm test`: 83 tests, all pass (unit + route-level, in-memory database).
* `npm run test:e2e`: 2 browser suites (Chromium; phone 360 px and 320 px, desktop 1280 px). Suite 1 = catalogue/storefront/delivery (88 checks), suite 2 = orders/returns/email/payments/reviews/assistant (114 checks). All pass.
* Bugs found by these tests and fixed during the work: sitemap listed products of removed categories; plain-text descriptions lost paragraph breaks; "Make main" and the move arrows overlapped on phones; a missing import (caught by a test).

## Known limitations / decisions you should know
1. Products in a removed category are hidden from customers until moved (safe, reversible).
2. Return window and the 7-day problem-report window: the 7 days is fixed in code (`api/_returns.js`).
3. Delivery tiers are fixed in code, not editable in admin.
4. Rate limits (reviews, chat, photo upload) live in server memory: a brake, not a perfect global limit.
5. Return photos use the same public bucket as product photos (long random names, but not private).
6. The AI assistant does not know about variants' stock beyond what the public catalogue shows; it never sees orders.
