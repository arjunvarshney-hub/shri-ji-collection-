import { Readable } from "node:stream";
process.env.SJC_TEST_DB = "1";
process.env.SUPABASE_URL = "https://abc.supabase.co";

export function mockRes() {
  return { headers: {}, statusCode: 200, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; } };
}
export function mockReq({ method = "GET", headers = {}, body, query = {}, url = "/x", raw } = {}) {
  const base = raw !== undefined ? Readable.from([Buffer.from(raw)]) : {};
  return Object.assign(base, { method, headers: { host: "shop.test", ...headers }, body, query, url });
}
/** In-memory stand-in for the Supabase client. Each test sets fake.* hooks. */
export const fake = {
  users: {},                       // access_token -> user
  admins: new Set(),
  rpcCalls: [], resolve: () => ({ data: null, error: null }), rpcImpl: async () => ({ data: null, error: null }),
};
const chain = (table, ops = []) => new Proxy({}, { get(_, prop) {
  if (prop === "then") return (ok, bad) => Promise.resolve(fake.resolve(table, ops, false)).then(ok, bad);
  return (...args) => {
    const o = [...ops, [prop, args]];
    return prop === "maybeSingle" || prop === "single" ? Promise.resolve(fake.resolve(table, o, true)) : chain(table, o);
  };
} });
globalThis.__SJC_TEST_DB__ = {
  auth: { getUser: async (t) => ({ data: { user: fake.users[t] || null }, error: fake.users[t] ? null : new Error("bad") }), refreshSession: async () => ({ data: {}, error: new Error("no") }) },
  from: (t) => { if (t === "admin_users") return { select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: fake.admins.has(id) ? { user_id: id } : null, error: null }) }) }) }; return chain(t); },
  rpc: async (name, args) => { fake.rpcCalls.push([name, args]); return fake.rpcImpl(name, args); },
  storage: { from: () => ({ upload: async (path) => { fake.uploaded = path; return { error: null }; }, getPublicUrl: (p) => ({ data: { publicUrl: "https://abc.supabase.co/storage/v1/object/public/product-images/" + p } }), remove: async () => ({}) }) },
};
export const cookieFor = (token) => ({ cookie: `sjc_access=${token}` });
