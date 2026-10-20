# SHRI JI Assistant: setup guide (simple English)

## What it is
A chat button on the shop pages (home, shop, category, product). Customers can ask in English, Hindi or Hinglish:
* "Laddu Gopal poshak dikhao", "kurti 500 tak", "red mukut", "size L kurti"
* payment options, delivery charge, how to order, shop contact

It shows **real products only** (name, current price, sold-out status, link) read live from your database.
It does **not** appear on cart, checkout, account or admin pages (so it never distracts from buying).

## What it can NOT do (by design)
* It cannot see, change or cancel orders, change prices or stock, mark payments, or refund. It is read-only.
* For order status it tells the customer to log in and open **My Orders**. It never looks up an order by number.
* It does not promise delivery days or a return policy. If you have not written one in the admin, it says "not published, please ask the shop".
* It does not save chats on the server. The chat is kept only in the customer's own browser tab until they close it.

## Two modes
| Mode | When | What the customer sees |
|---|---|---|
| **Store answers** (no AI) | No `ANTHROPIC_API_KEY` in Vercel, or the AI service is down, or the daily limit is reached | Real products + fixed answers + your own FAQ. Each message is labelled "Automatic answer from store information". It is never shown as AI. |
| **AI replies** | `ANTHROPIC_API_KEY` is set and working | Natural replies in the customer's language. Product cards still come from your database. |

**Live AI has NOT been tested** (no key was available while building). Test it yourself with the checklist below.

## Turn on live AI (optional)
1. Create an account at the Anthropic Console and create an API key (this is your own paid account; set a monthly spend limit there).
2. Vercel → your project → **Settings → Environment Variables** → add:
   * `ANTHROPIC_API_KEY` = your key (mark as Sensitive). **Never paste the key in chat, GitHub or the admin panel.**
   * `AI_MODEL` (optional) = the model name. Default is `claude-haiku-5-5` (small and cheap). Check the current name in Anthropic's docs; if a model is retired, change it here, no code change needed.
3. **Redeploy** (Deployments → latest → ⋯ → Redeploy).
4. Test (below).

### Cost and limits
* Each customer message = one small AI call (about 400 output tokens max). Typical cost is very small, but it is pay-per-use.
* Limits built in: 500 characters per message; 12 messages per 5 minutes and 100 per day per visitor; `CHAT_DAILY_AI_LIMIT` AI replies per day per server instance (default 300), after that it quietly switches to Store answers.
* These limits live in server memory, so they are a brake, not a perfect global cap. Set a spending limit in the Anthropic Console too.

## Manage it from the admin panel (no code)
`/admin` → **Site** tab → **SHRI JI Assistant (chat)**
* Tick / untick **Show the chat assistant on the shop** (off = button disappears and the API refuses).
* **Your answers**: one per line as `Question | Answer`, up to 30. Examples:
  * `Shop timing? | We are open 10 AM to 8 PM every day.`
  * `Do you accept returns? | (write your real policy here)`
  Only write facts that are true. Your answers are used word for word and beat the built-in ones.

## Privacy and safety
* The AI key stays on the server. It is never in the website files or in any response.
* Product text and your FAQ are treated as **untrusted data**: the assistant is told never to follow instructions found inside them.
* Server logs contain only error codes, never customer messages or keys.
* Visitors are identified for rate limits only by a one-way hash (never the raw IP).

## Test checklist after adding the key
1. Open the shop on your phone, tap **Ask us**, ask "kurti dikhao". You should get a natural reply **and** product cards. The reply must NOT carry the grey label "Automatic answer from store information".
2. Ask for a sold-out product. It must say sold out.
3. Ask "return policy?". It must say it is not published (unless you wrote one).
4. Ask "mera order kahan hai". It must send you to My Orders.
5. In Vercel → Logs, check there are no `[assistant] provider failed` lines. If there are, the key or model name is wrong; the shop keeps working in Store answers mode meanwhile.

## For developers
* Code: `api/_assistant.js` (logic), `api/_routes/site/chat.js` (route, dispatched by `api/site.js`; rewrite `/api/chat`), `public/js/chat.js` (widget).
* No new serverless function and no new database table: settings live in the existing `site_settings` table (`chat_enabled`, `chat_faq`).
* Provider adapter is `callProvider()` in `_assistant.js`; swap it to change AI vendor.
