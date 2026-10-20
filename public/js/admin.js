import { api, esc, money, $, $$, msg, badge, fmtDate, toast } from "./common.js";
import { imgTag, effPrice } from "./render.js";
import { shrink, upload } from "./admin-shared.js";
import { loadProducts } from "./admin-products.js";
import { loadCategoriesTab } from "./admin-categories.js";
import { loadOrders, loadReturns } from "./admin-orders.js";

const R = $("#root");
let tab = "products", reviewStatus = "pending";

async function boot() {
  try {
    const me = await api("/api/auth/me");
    if (!me.user) { R.innerHTML = `<div class="panel"><h2>Please log in</h2><p class="muted">Log in with the shop owner account.</p><a class="btn primary" href="/account?next=/admin">Log in</a></div>`; return; }
    if (!me.isAdmin) { R.innerHTML = `<div class="panel"><h2>Access denied</h2><p class="muted">${esc(me.user.email)} is not an administrator.</p><a class="btn outline" href="/">Back to shop</a></div>`; return; }
  } catch (e) { R.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  show("products");
}
const TABS = [["products", "Products"], ["categories", "Categories"], ["orders", "Orders"], ["returns", "Returns"], ["reviews", "Reviews"], ["site", "Site"]];
function shell(inner) {
  R.innerHTML = `<div class="atabs" role="tablist">${TABS.map(([k, n]) => `<button class="${tab === k ? "on" : ""}" data-t="${k}" role="tab" aria-selected="${tab === k}">${n}</button>`).join("")}</div><div id="pane">${inner}</div>`;
  $$(".atabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.t)));
  $(".atabs button.on")?.scrollIntoView?.({ inline: "center", block: "nearest" });
}
function show(t) {
  tab = t; shell('<p class="muted">Loading…</p>');
  const loaders = { products: loadProducts, categories: loadCategoriesTab, orders: loadOrders, returns: loadReturns, reviews: loadReviews, site: loadSite };
  (loaders[t] || loadProducts)();
}

/* -------------------------------- SITE (logo + home picture) -------------------------------- */
function faqToText(json) { try { return (JSON.parse(json || "[]") || []).map((x) => `${x.q} | ${x.a}`).join("\n"); } catch { return ""; } }
function textToFaq(text) {
  const out = [];
  for (const [i, line] of String(text || "").split("\n").entries()) {
    if (!line.trim()) continue;
    const k = line.indexOf("|");
    if (k < 1 || !line.slice(k + 1).trim()) throw new Error(`Line ${i + 1}: write it as  Question | Answer`);
    out.push({ q: line.slice(0, k).trim(), a: line.slice(k + 1).trim() });
  }
  if (out.length > 30) throw new Error("Maximum 30 answers.");
  return out;
}
async function loadEmailPanel() {
  const box = $("#emailPanel"); if (!box) return;
  try {
    const d = await api("/api/admin/emails");
    box.innerHTML = `<h2>Email notifications</h2>${d.configured ? '<div class="msg ok">Email is set up. You get an email for every new order and every cancellation.</div>' : '<div class="msg err"><b>Email is NOT set up yet.</b> No emails can be sent. Add RESEND_API_KEY, EMAIL_FROM and ADMIN_NOTIFY_EMAIL in Vercel (see EMAIL_SETUP.md). Orders still work; waiting emails are kept and sent after you set it up.</div>'}
      <p class="sm">${d.problems ? `<b>${d.problems}</b> email(s) not delivered yet.` : "No pending or failed emails."}</p>
      ${d.problems && d.configured ? '<button class="btn outline sm" id="retryMail" type="button">Retry failed emails</button>' : ""}<div id="rmMsg"></div>
      <ul class="tl">${d.emails.slice(0, 8).map((m) => `<li><b>${esc(m.subject)}</b><br><small>${esc(m.to_email)} · ${m.status === "sent" ? "sent" : esc(m.status)}${m.last_error && m.status !== "sent" ? " · " + esc(m.last_error) : ""} · ${fmtDate(m.created_at)}</small></li>`).join("") || "<li>No emails yet</li>"}</ul>`;
    $("#retryMail")?.addEventListener("click", async () => { try { const r = await api("/api/admin/emails", { method: "POST", body: { action: "retry" } }); toast(`Tried ${r.retried?.tried ?? 0}, sent ${r.retried?.sent ?? 0}`); loadEmailPanel(); } catch (e) { msg($("#rmMsg"), e.message); } });
  } catch (e) { box.innerHTML = `<h2>Email notifications</h2><div class="msg err">${esc(e.message)}</div><p class="sm muted">Run the new SQL file in Supabase if the email table is missing.</p>`; }
}
async function loadSite() {
  let cur;
  try { cur = (await api("/api/admin/settings")).settings; } catch (e) { $("#pane").innerHTML = `<div class="msg err">${esc(e.message)}</div><p class="sm muted">If this keeps failing, run the new SQL (site_settings table) in Supabase once.</p>`; return; }
  // state per slot: {url} existing | {blob, preview} new | null removed/empty
  const slots = { logo_url: cur.logo_url ? { url: cur.logo_url } : null, hero_url: cur.hero_url ? { url: cur.hero_url } : null };
  const box = (key, title, help, extra) => `<div class="panel"><h2>${title}</h2><p class="sm muted">${help}</p><div class="sprev ${extra}" id="pv_${key}"></div><input type="file" id="f_${key}" accept="image/png,image/jpeg,image/webp"><button class="btn danger sm" type="button" id="rm_${key}" style="margin-top:8px">Remove picture</button></div>`;
  $("#pane").innerHTML = box("logo_url", "Logo (top header)", "Shown at the top of every page instead of the text. A PNG with a transparent background looks best (wide, about 400 × 120).", "logo") +
    box("hero_url", "Home page picture", "The picture next to “Thakur Ji Poshak & Ladies Wear” on the home page. Use a wide photo (4:3). If empty, the plain “SJC” card is shown.", "hero") +
    '<div id="m"></div><button class="btn primary lg" id="saveSite" type="button" style="width:100%">Save logo &amp; picture</button><p class="sm muted">Changes appear on the website within about a minute.</p>' +
    `<div class="panel" style="margin-top:18px"><h2>SHRI JI Assistant (chat)</h2><p class="sm muted">The chat button on the shop. It answers from your products and from the answers you write below. It never sees orders.</p>
     <label class="sw"><input type="checkbox" id="chatOn" ${cur.chat_enabled === "0" ? "" : "checked"}> Show the chat assistant on the shop</label>
     <label class="f">Your answers <small>(one per line: Question | Answer)</small><textarea id="chatFaq" rows="8" placeholder="Do you give returns? | Write your real return policy here&#10;Shop timing? | 10 AM to 8 PM">${esc(faqToText(cur.chat_faq))}</textarea></label>
     <p class="sm muted" id="faqCount"></p><div id="mc"></div>
     <button class="btn primary" id="saveChat" type="button" style="width:100%">Save assistant settings</button>
     <p class="sm muted">Only write policies and facts that are true. The assistant will not make up delivery times or return rules; it says "ask the shop" if there is no answer here.</p></div>
    <div class="panel" id="emailPanel"><h2>Email notifications</h2><p class="muted sm">Loading…</p></div>`;
  loadEmailPanel();
  const draw = () => { for (const k of Object.keys(slots)) { const s = slots[k]; $("#pv_" + k).innerHTML = s ? `<img src="${esc(s.preview || s.url)}" alt="${k === "logo_url" ? "Logo" : "Home picture"} preview">` : '<span class="muted sm">No picture (default is shown)</span>'; $("#rm_" + k).hidden = !s; } };
  draw();
  const countFaq = () => { try { $("#faqCount").textContent = `${textToFaq($("#chatFaq").value).length} answer(s) ready`; } catch (e) { $("#faqCount").textContent = e.message; } };
  $("#chatFaq").addEventListener("input", countFaq); countFaq();
  $("#saveChat").addEventListener("click", async () => {
    const b = $("#saveChat"); b.disabled = true; msg($("#mc"), "");
    try {
      const faq = textToFaq($("#chatFaq").value);
      const d = await api("/api/admin/settings", { method: "PATCH", body: { chat_enabled: $("#chatOn").checked ? "1" : "0", chat_faq: faq } });
      Object.assign(cur, d.settings); toast("Assistant settings saved"); msg($("#mc"), "Saved. Changes appear within about a minute.", "ok");
    } catch (err) { msg($("#mc"), err.message); }
    b.disabled = false;
  });
  for (const k of Object.keys(slots)) {
    $("#f_" + k).addEventListener("change", async (e) => {
      const file = e.target.files[0]; e.target.value = ""; if (!file) return; msg($("#m"), "");
      try { const blob = await shrink(file, k === "logo_url" ? { max: 600, png: file.type === "image/png" } : { max: 1600 }); if (slots[k]?.preview) URL.revokeObjectURL(slots[k].preview); slots[k] = { blob, preview: URL.createObjectURL(blob) }; draw(); }
      catch (err) { msg($("#m"), err.message); }
    });
    $("#rm_" + k).addEventListener("click", () => { slots[k] = null; draw(); });
  }
  let saving = false;
  $("#saveSite").addEventListener("click", async () => {
    if (saving) return; saving = true; const btn = $("#saveSite"); btn.disabled = true; msg($("#m"), "");
    try {
      const body = {};
      for (const k of Object.keys(slots)) { const s = slots[k]; if (!s) { if (cur[k]) body[k] = ""; continue; } if (s.blob) { btn.textContent = "Uploading…"; s.url = await upload(s.blob); body[k] = s.url; } }
      if (!Object.keys(body).length) { msg($("#m"), "Nothing changed.", "info"); }
      else { btn.textContent = "Saving…"; const d = await api("/api/admin/settings", { method: "PATCH", body }); Object.assign(cur, d.settings); toast("Saved"); }
    } catch (err) { msg($("#m"), err.message); }
    saving = false; btn.disabled = false; btn.textContent = "Save changes";
  });
}
boot();


/* --------------------------- CUSTOMER REVIEWS --------------------------- */
async function loadReviews() {
  const pane = $("#pane");
  pane.innerHTML = `<div class="tools"><label class="sm muted" for="reviewFilter">Show reviews by status</label><select id="reviewFilter"><option value="pending" ${reviewStatus === "pending" ? "selected" : ""}>Pending approval</option><option value="approved" ${reviewStatus === "approved" ? "selected" : ""}>Approved / public</option><option value="rejected" ${reviewStatus === "rejected" ? "selected" : ""}>Rejected / hidden</option><option value="all" ${reviewStatus === "all" ? "selected" : ""}>All reviews</option></select></div><p class="sm muted">New reviews stay private until you approve them. Only approved reviews appear on product pages and in public rating totals.</p><div id="reviewList"><p class="muted">Loading reviews…</p></div>`;
  $("#reviewFilter", pane).addEventListener("change", (e) => { reviewStatus = e.target.value; loadReviews(); });
  let data;
  try { data = await api(`/api/admin/reviews?status=${encodeURIComponent(reviewStatus)}`); }
  catch (error) { $("#reviewList", pane).innerHTML = `<div class="msg err">${esc(error.message)}</div><p class="sm muted">If this says reviews are not configured, run <code>migrations/20261010_product_reviews.sql</code> in Supabase SQL Editor.</p>`; return; }
  const rows = data.reviews || [];
  $("#reviewList", pane).innerHTML = rows.map((r) => {
    const n = Math.max(0, Math.min(5, Number(r.rating) || 0));
    const product = r.product ? `<a href="/product/${encodeURIComponent(r.product.slug)}" target="_blank" rel="noopener">${esc(r.product.name)}</a>` : `Product #${Number(r.product_id)}`;
    return `<article class="review-admin-card"><div class="review-head"><div><b>${esc(r.customer_name)}</b><div class="muted sm">${product} · ${fmtDate(r.created_at)}</div></div>${badge(r.status)}</div><div class="review-rating"><span class="stars" role="img" aria-label="${n} out of 5 stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</span> <b>${n}/5</b></div><p class="review-copy">${esc(r.comment).replace(/\n/g, "<br>")}</p><div class="acts">${r.status !== "approved" ? `<button class="btn primary sm" data-review-act="approve" data-review-id="${Number(r.id)}">Approve &amp; publish</button>` : `<button class="btn outline sm" data-review-act="pending" data-review-id="${Number(r.id)}">Hide / pending</button>`}${r.status !== "rejected" ? `<button class="btn outline sm" data-review-act="reject" data-review-id="${Number(r.id)}">Reject</button>` : ""}<button class="btn danger sm" data-review-act="delete" data-review-id="${Number(r.id)}">Delete</button></div></article>`;
  }).join("") || '<p class="empty">No reviews in this status yet.</p>';
  $("#reviewList", pane).addEventListener("click", async (event) => {
    const button = event.target.closest("[data-review-act]"); if (!button) return;
    const id = Number(button.dataset.reviewId), action = button.dataset.reviewAct;
    if (action === "delete" && !confirm("Delete this customer review permanently? This cannot be undone.")) return;
    button.disabled = true;
    try {
      if (action === "delete") await api("/api/admin/reviews", { method: "DELETE", body: { id } });
      else await api("/api/admin/reviews", { method: "PATCH", body: { id, status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending" } });
      toast(action === "approve" ? "Review published" : action === "delete" ? "Review deleted" : action === "reject" ? "Review rejected" : "Review moved to pending");
      loadReviews();
    } catch (error) { alert(error.message); button.disabled = false; }
  });
}
