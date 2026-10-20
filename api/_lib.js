// Shared server helpers. Files starting with "_" are NOT exposed as routes by Vercel.
import crypto from "node:crypto";

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const must = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Server is not configured: missing environment variable ${k}`);
  return v;
};
let _admin, _anon;
// Lazy import: the SDK is only loaded by routes that need it.
// Test seam: only active when the test runner sets SJC_TEST_DB=1 (never in production).
const seam = () => (process.env.SJC_TEST_DB === "1" ? globalThis.__SJC_TEST_DB__ : null);
export async function admin() {
  if (seam()) return seam();
  if (!_admin) {
    const { createClient } = await import("@supabase/supabase-js");
    _admin = createClient(must("SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _admin;
}
export async function anon() {
  if (seam()) return seam();
  if (!_anon) {
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || must("SUPABASE_ANON_KEY");
    _anon = createClient(must("SUPABASE_URL"), key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _anon;
}

export const siteUrl = (req) =>
  (process.env.SITE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`).replace(/\/+$/, "");
const isHttps = (req) => String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";

// ---------- cookies / session ----------
const ACCESS = "sjc_access", REFRESH = "sjc_refresh";
export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } }
  }
  return out;
}
const mk = (name, val, maxAge, secure) =>
  `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
export function setAuthCookies(req, res, session) {
  const s = isHttps(req);
  res.setHeader("Set-Cookie", [mk(ACCESS, session.access_token, Math.max(60, session.expires_in || 3600), s), mk(REFRESH, session.refresh_token, 60 * 60 * 24 * 30, s)]);
}
export function clearAuthCookies(req, res) {
  const s = isHttps(req);
  res.setHeader("Set-Cookie", [mk(ACCESS, "", 0, s), mk(REFRESH, "", 0, s)]);
}
/** Returns the signed-in Supabase user or null. Silently refreshes an expired access token. */
export async function getUser(req, res) {
  const c = parseCookies(req);
  if (!c[ACCESS] && !c[REFRESH]) return null;
  const db = await anon();
  if (c[ACCESS]) {
    const { data } = await db.auth.getUser(c[ACCESS]);
    if (data?.user) return data.user;
  }
  if (c[REFRESH]) {
    const { data } = await db.auth.refreshSession({ refresh_token: c[REFRESH] });
    if (data?.session?.user) { setAuthCookies(req, res, data.session); return data.session.user; }
    clearAuthCookies(req, res);
  }
  return null;
}
export async function requireUser(req, res) {
  const u = await getUser(req, res);
  if (!u) throw new HttpError(401, "Please log in to continue.");
  return u;
}
export async function isAdminUser(user) {
  if (!user) return false;
  const db = await admin();
  const { data, error } = await db.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return !!data;
}
export async function requireAdmin(req, res) {
  const u = await requireUser(req, res);
  if (!(await isAdminUser(u))) throw new HttpError(403, "Administrator access required.");
  return u;
}

// ---------- request helpers ----------
/** CSRF defence for cookie auth: browsers always send Origin/Sec-Fetch-Site on cross-site writes. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) { try { return new URL(origin).host === req.headers.host; } catch { return false; } }
  const sfs = req.headers["sec-fetch-site"];
  return !sfs || sfs === "same-origin" || sfs === "none";
}
export function jsonBody(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  if (typeof b === "string") { try { const o = JSON.parse(b); return o && typeof o === "object" ? o : {}; } catch { return {}; } }
  return {};
}
export async function readRaw(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, "File is too large.");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** Wraps a route: method check, CSRF check, no-store caching, uniform error output. */
export function route(methods, fn, { csrf = true } = {}) {
  return async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (!methods.includes(req.method)) {
        res.setHeader("Allow", methods.join(", "));
        throw new HttpError(405, "Method not allowed");
      }
      if (csrf && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameOrigin(req)) throw new HttpError(403, "Blocked cross-site request.");
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
      console.error(`[${req.method} ${String(req.url).split("?")[0]}]`, e?.message || e);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };
}

export const shippingRule = () => ({
  flat: Math.max(0, Number(process.env.SHIPPING_FLAT || 0) || 0),
  freeAbove: process.env.FREE_SHIPPING_ABOVE ? Number(process.env.FREE_SHIPPING_ABOVE) || null : null,
});

/** Maps Supabase auth errors to messages a customer can act on. */
export function friendlyAuthError(e, fallback) {
  const m = String(e?.message || "");
  if (/invalid login/i.test(m)) return "Incorrect email or password.";
  if (/not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox (and spam folder) for the link.";
  if (/already (registered|been registered)/i.test(m)) return "This email is already registered. Please log in.";
  if (/rate limit|too many|security purposes/i.test(m)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/password/i.test(m)) return "Password is too weak. Use at least 8 characters.";
  return fallback;
}
export const randomId = () => crypto.randomUUID();

// ---------- abuse controls ----------
/** One-way hash of the caller (IP + user agent). We never store or log the raw IP. */
export function callerHash(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_URL || "sjc";
  return crypto.createHash("sha256").update(`${salt}|${ip}|${String(req.headers["user-agent"] || "").slice(0, 80)}`).digest("hex").slice(0, 32);
}
const hits = new Map();
/**
 * Best-effort sliding-window limiter. Serverless instances do not share memory, so this is a cost/abuse
 * brake per instance, not a perfect global limit (reviews additionally use a database check).
 * Returns true when the request is allowed.
 */
export function rateLimit(key, max, windowMs, now = Date.now()) {
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return true;
}
export const _resetRateLimits = () => hits.clear();
