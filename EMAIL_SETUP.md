# Email notifications: setup guide (simple English)

You get an email when a customer **places an order** (also when an online payment is received) and when a customer **asks to cancel** or an order is **cancelled**. Return requests also email you. Customers get emails for order confirmation, shipped, out for delivery, delivered, cancelled, return updates and refund updates (only if they typed an email at checkout).

## How it works (so you can trust it)
* Emails are sent **by the server** through **Resend** (resend.com). Keys are only in Vercel, never in the website.
* Every email is first saved in a list (`email_outbox`) with a unique key, so **one event never sends two emails**, even if something retries.
* An email is marked **sent only after Resend confirms it** (it returns an id). If Resend says no, or the network fails, it stays **failed** with the reason, and is retried every night and when you press **Retry failed emails**.
* If email is broken, **orders and admin actions still work**. Nothing is lost: waiting emails are sent after you fix the setup.
* Emails never contain passwords, API keys or payment secrets.

## Set it up (about 10 minutes)
1. Create a free account at **resend.com**.
2. Resend → **Domains** → add your own domain and add the DNS records they show (without a verified domain Resend only lets you test with your own email).
3. Resend → **API Keys** → create a key.
4. Vercel → Settings → Environment Variables (all **Sensitive**, never paste them in chat):
   * `RESEND_API_KEY` = the key
   * `EMAIL_FROM` = for example `SHRI JI COLLECTION <orders@your-domain.com>` (must be on your verified domain)
   * `ADMIN_NOTIFY_EMAIL` = your email. More than one? Separate with commas.
   * `SITE_URL` = your shop address (used for the "view your order" links)
5. Run `migrations/20261012_catalog_orders_v4.sql` in Supabase (creates the email list table).
6. **Redeploy** in Vercel.
7. Test: place a COD test order. You should get "New order …" within a minute. Look at **/admin → Site → Email notifications**: it must say "Email is set up".

## If emails do not arrive
* /admin → Site → Email notifications shows the list and the error for each email (for example `provider_status_403` = sender domain not verified).
* Fix the setting, redeploy, then press **Retry failed emails**.
* Also check the spam folder the first time.

## Not tested yet
Real delivery through Resend was **not tested** (no account/key was available while building). The code was tested against a simulated Resend that answers like the real one (success with an id, failure with an error, network failure). Please do step 7 and tell me what you see.

## Limits
Resend's free plan has daily/monthly limits; check their pricing page. If you send more emails than the plan allows, the extra ones stay "failed" until the limit resets or you upgrade.
