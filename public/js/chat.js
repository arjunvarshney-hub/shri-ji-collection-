// SHRI JI Assistant widget (loaded only on storefront pages, never on cart/checkout/admin).
import { api } from "./common.js";
import { esc, money, safeUrl } from "./render.js";

const KEY = "sjc_chat_v1";
const STARTERS = ["Laddu Gopal poshak dikhao", "Kurti under 800", "Payment options", "Delivery charges", "Order kaise karein?", "Shop contact number"];
const WELCOME = "Namaste! I am SHRI JI Assistant. I can help you find products and answer shopping questions in English, Hindi or Hinglish. What are you looking for?";
let msgs = [], open = false, busy = false;
try { msgs = JSON.parse(sessionStorage.getItem(KEY) || "[]").filter((m) => m && typeof m.text === "string").slice(-30); } catch { msgs = []; }
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* private mode */ } };

const root = document.createElement("div");
root.id = "sjcChat";
root.innerHTML = `<button type="button" class="chat-fab" id="chatFab" aria-label="Open SHRI JI Assistant chat" aria-expanded="false" aria-controls="chatPanel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z"/></svg><span>Ask us</span></button>
<div class="chat-bg" id="chatBg" hidden></div>
<section class="chat-panel" id="chatPanel" role="dialog" aria-label="SHRI JI Assistant" hidden>
 <header class="chat-h"><div><b>SHRI JI Assistant</b><small>Product help &amp; shop questions</small></div><button type="button" class="chat-x" id="chatClose" aria-label="Close chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
 <div class="chat-log" id="chatLog" role="log" aria-live="polite"></div>
 <div class="chat-starters" id="chatStarters"></div>
 <form class="chat-form" id="chatForm" autocomplete="off"><label class="sr" for="chatInput">Your message</label><input id="chatInput" maxlength="500" placeholder="Type your question…" enterkeyhint="send"><button type="submit" class="btn primary" id="chatSend">Send</button></form>
 <p class="chat-foot">Automatic assistant. It cannot see or change orders.</p>
</section>`;
document.body.appendChild(root);
const $ = (s) => root.querySelector(s);
const fab = $("#chatFab"), panel = $("#chatPanel"), bg = $("#chatBg"), log = $("#chatLog"), input = $("#chatInput"), send = $("#chatSend");

const star = (r) => (r ? `<span class="cm-rate" aria-label="${esc(r.average)} out of 5 from ${esc(r.count)} reviews">★ ${esc(Number(r.average).toFixed(1))} (${esc(r.count)})</span>` : "");
const card = (p) => {
  const img = safeUrl(p.image);
  return `<a class="cm" href="/product/${encodeURIComponent(p.slug)}">${img ? `<img src="${esc(img)}" alt="" width="56" height="56" loading="lazy">` : '<span class="cm-ph" aria-hidden="true"></span>'}<span class="cm-t"><b>${esc(p.name)}</b><span class="cm-p">${p.from ? "From " : ""}${money(p.price)}${p.mrp ? ` <s>${money(p.mrp)}</s>` : ""}</span><span class="cm-s${p.in_stock ? "" : " out"}">${p.in_stock ? esc(p.category) : "Sold out"}</span>${star(p.rating)}</span></a>`;
};
function draw() {
  const all = [{ role: "assistant", text: WELCOME, welcome: true }, ...msgs];
  log.innerHTML = all.map((m) => `<div class="cb ${m.role === "user" ? "me" : "bot"}"><span class="sr">${m.role === "user" ? "You said:" : "Assistant said:"}</span><p>${esc(m.text).replace(/\n/g, "<br>")}</p>${(m.products || []).map(card).join("")}${m.note ? `<small class="cb-note">${esc(m.note)}</small>` : ""}</div>`).join("") + (busy ? '<div class="cb bot typing" aria-label="Assistant is typing"><span></span><span></span><span></span></div>' : "");
  $("#chatStarters").hidden = msgs.length > 0;
  log.scrollTop = log.scrollHeight;
}
$("#chatStarters").innerHTML = STARTERS.map((s) => `<button type="button" class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join("");

function setOpen(v) {
  open = v; panel.hidden = bg.hidden = !v; fab.setAttribute("aria-expanded", String(v)); fab.hidden = v && window.matchMedia("(max-width:700px)").matches;
  document.documentElement.classList.toggle("chat-open", v && window.matchMedia("(max-width:700px)").matches);
  if (v) { draw(); input.focus({ preventScroll: true }); fit(); } else { fab.hidden = false; fab.focus({ preventScroll: true }); }
}
// Android keyboard: keep the input visible by following the visual viewport.
function fit() {
  const vv = window.visualViewport;
  if (!open || !vv || !window.matchMedia("(max-width:700px)").matches) { panel.style.height = panel.style.bottom = ""; return; }
  panel.style.height = Math.min(vv.height * 0.92, 640) + "px";
  panel.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px";
}
window.visualViewport?.addEventListener("resize", fit);
window.visualViewport?.addEventListener("scroll", fit);

async function ask(text) {
  text = text.trim().slice(0, 500);
  if (!text || busy) return;
  const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.text }));
  msgs.push({ role: "user", text }); busy = true; send.disabled = true; input.value = ""; draw(); save();
  try {
    const d = await api("/api/chat", { method: "POST", body: { message: text, history } });
    msgs.push({ role: "assistant", text: String(d.reply || ""), products: Array.isArray(d.products) ? d.products.slice(0, 5) : [], note: d.mode === "ai" ? "" : "Automatic answer from store information" });
  } catch (e) {
    msgs.push({ role: "assistant", text: e.message || "Sorry, something went wrong. Please try again, or browse the shop.", note: "Could not get an answer" });
  }
  busy = false; send.disabled = false; draw(); save(); if (open) input.focus({ preventScroll: true });
}
fab.addEventListener("click", () => setOpen(true));
$("#chatClose").addEventListener("click", () => setOpen(false));
bg.addEventListener("click", () => setOpen(false));
document.addEventListener("keydown", (e) => e.key === "Escape" && open && setOpen(false));
$("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
$("#chatStarters").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) ask(b.dataset.q); });
log.addEventListener("click", (e) => { if (e.target.closest("a.cm")) setOpen(false); });

// Never cover the buy buttons: hide the launcher while Add to cart / View cart is on screen.
const buy = [document.getElementById("addBtn"), document.getElementById("goCart")].filter(Boolean);
if (buy.length && "IntersectionObserver" in window) {
  const vis = new Set();
  const io = new IntersectionObserver((entries) => { for (const e of entries) (e.isIntersecting ? vis.add(e.target) : vis.delete(e.target)); fab.classList.toggle("dodge", vis.size > 0); }, { rootMargin: "0px 0px 20px 0px" });
  buy.forEach((b) => io.observe(b));
}
