// Rich-text sanitiser (no dependencies). ONLY a small allow-list of tags survives; everything else is removed.
// Text is always re-escaped, attributes are rebuilt from scratch (never copied), links must be http/https/mailto/tel.
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENT[m]).replace(/&#(\d{1,6});/g, (m, n) => (Number(n) >= 32 && Number(n) < 0x10ffff ? String.fromCodePoint(Number(n)) : " ")).replace(/&#x([0-9a-f]{1,6});/gi, (m, n) => (parseInt(n, 16) >= 32 && parseInt(n, 16) < 0x10ffff ? String.fromCodePoint(parseInt(n, 16)) : " "));
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ALIAS = { b: "strong", i: "em", div: "p", h1: "h2", h5: "h4", h6: "h4" };
const ALLOWED = new Set(["p", "br", "strong", "em", "u", "ul", "ol", "li", "h2", "h3", "h4", "a", "blockquote"]);
const BLOCK_TEXT_ALIGN = new Set(["p", "h2", "h3", "h4", "li", "blockquote"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript", "textarea", "select", "head", "title", "form"]);
const VOID = new Set(["br"]);
const safeHref = (h) => {
  const v = decode(String(h || "")).replace(/[\u0000-\u0020\u007f-\u009f]+/g, "");
  return /^(https?:\/\/|mailto:|tel:)/i.test(v) && v.length <= 500 ? v : null;
};

export function sanitizeRichText(input, maxLen = 20000) {
  let src = String(input ?? "").slice(0, maxLen * 2).replace(/<!--[\s\S]*?-->/g, "").replace(/<![^>]*>/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const re = /<\/?[a-zA-Z][^>]*>|<|>/g;
  const out = []; const stack = []; let last = 0, skipUntil = null, m;
  const text = (t) => { if (skipUntil || !t) return; const d = decode(t).replace(/\u00a0/g, " "); if (d) out.push(esc(d)); };
  const closeTo = (name) => { while (stack.length) { const t = stack.pop(); out.push(`</${t}>`); if (t === name) break; } };
  while ((m = re.exec(src))) {
    text(src.slice(last, m.index)); last = re.lastIndex;
    const tag = m[0];
    if (tag === "<" || tag === ">") { text(tag); continue; }
    const closing = tag[1] === "/";
    const name0 = tag.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/)[1].toLowerCase();
    if (skipUntil) { if (closing && name0 === skipUntil) skipUntil = null; continue; }
    if (DROP_WITH_CONTENT.has(name0)) { if (!closing && !/\/>$/.test(tag)) skipUntil = name0; continue; }
    const name = ALIAS[name0] || name0;
    if (!ALLOWED.has(name)) continue;
    if (closing) { if (stack.includes(name)) closeTo(name); continue; }
    if (name === "br") { out.push("<br>"); continue; }
    // a block start closes an open <p> (browsers do the same), lists can't sit inside <p>
    if (["p", "h2", "h3", "h4", "ul", "ol", "blockquote"].includes(name) && stack[stack.length - 1] === "p") closeTo("p");
    if (name === "li" && stack[stack.length - 1] === "li") closeTo("li");
    let attrs = "";
    if (name === "a") {
      const href = safeHref((tag.match(/\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[2] ?? (tag.match(/\shref\s*=\s*(?:'([^']*)'|([^\s>"']+))/i) || [])[1] ?? (tag.match(/\shref\s*=\s*(?:'([^']*)'|([^\s>"']+))/i) || [])[2]);
      if (!href) continue;                                    // a link without a safe URL is dropped (its text stays)
      attrs = ` href="${esc(href)}" target="_blank" rel="noopener nofollow noreferrer"`;
    } else if (BLOCK_TEXT_ALIGN.has(name)) {
      const style = (tag.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i) || [])[2] ?? (tag.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i) || [])[3] ?? "";
      const al = (style.match(/text-align\s*:\s*(left|center|right|justify)/i) || [])[1];
      const cls = (tag.match(/\salign\s*=\s*"?(left|center|right|justify)/i) || [])[1];
      const a = (al || cls || "").toLowerCase();
      if (a && a !== "left") attrs = ` class="ta-${a}"`;
    }
    out.push(`<${name}${attrs}>`);
    if (!VOID.has(name)) stack.push(name);
  }
  text(src.slice(last));
  while (stack.length) out.push(`</${stack.pop()}>`);
  let html = out.join("").replace(/<p>(\s|<br>)*<\/p>/g, "").trim();
  if (html.length > maxLen) html = html.slice(0, maxLen);
  // Plain text typed without any tags: keep line breaks readable.
  return html;
}

/** Plain text version (for search, cards, SEO, chat): tags removed, entities decoded, spaces collapsed. */
export function htmlToText(html, max = 500) {
  return decode(String(html ?? "").replace(/<\/(p|li|h[1-6]|ul|ol|blockquote)>|<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Old products only have plain-text descriptions: turn them into safe paragraphs. */
export function plainToHtml(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  return t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}
