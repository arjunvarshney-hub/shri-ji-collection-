# Audit of the uploaded project (before changes)

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Critical | `public/products.js` empty → storefront shows no products; `/api/products` unused | Fixed |
| 2 | Critical | Order total/prices taken from the browser (`subtotal`) → anyone can buy for ₹1 | Fixed |
| 3 | Critical | `verify-payment`: no login, no ownership, not idempotent, no webhook, crashes on missing body | Fixed |
| 4 | Critical | `vercel.json` `api/*.js` pattern excludes nested routes → admin/auth/orders-my 404 in production | Fixed |
| 5 | High | Stored XSS: product/order fields injected via `innerHTML` (admin + storefront) | Fixed |
| 6 | High | Admin products API inserts raw body (mass assignment, bad prices/stock/image URLs) | Fixed |
| 7 | High | Upload: any file type/size, user-controlled name, base64-in-JSON exceeds Vercel's 4.5 MB limit for phone photos | Fixed |
| 8 | High | No stock control (overselling); no duplicate-order protection | Fixed |
| 9 | High | Supabase clients created at import; missing env crashes all routes | Fixed |
| 10 | Medium | Cookie auth: no refresh (logout after 1 h), no `Secure`, login error leaks raw message | Fixed |
| 11 | Medium | Storage policy allowed anyone to LIST the whole bucket | Fixed |
| 12 | Medium | Orders readable with internal columns; statuses unconstrained | Fixed |
| 13 | Medium | No CSRF defence for cookie-authenticated writes | Fixed |
| 14 | Medium | No SEO (no sitemap/robots/canonical/structured data), client-rendered only | Fixed |
| 15 | Medium | Not mobile-optimised (modal checkout, desktop admin sidebar, external fonts) | Fixed |
| 16 | Low | Categories were only a few; no sizes validation; README claimed features that were not wired | Fixed |

## What was actually tested
| Area | Method | Result |
|---|---|---|
| Validation, signatures, escaping, SSR output, JSON-LD | `npm test` (24 tests) | PASS |
| Route authorization, CSRF, order/payment/webhook handlers | `npm test` against an in-memory fake DB | PASS |
| Full customer + admin flows on 360 px and 320 px Android-sized viewport (Chromium) | `npm run test:e2e` (77 checks, 3 consecutive runs) | PASS |
| `supabase.sql` | Static check only (balanced quoting/parentheses) | **NOT TESTABLE** here: must be run in Supabase |
| Real Supabase Auth / email confirmation / Storage / RLS enforcement | no network | **NOT TESTABLE** |
| Real Razorpay (order create, Checkout, UPI/GPay, webhook delivery) | no network; REST call and Checkout were stubbed, signature maths used the real code | **NOT TESTABLE** live |
| `vercel build`, deployment, custom domain | no access | **NOT DONE** |
| Lighthouse / real Android device | not available | **NOT TESTABLE** |

The E2E harness mirrors the SQL functions in JavaScript. It proves the UI and API logic, **not** the SQL itself.
