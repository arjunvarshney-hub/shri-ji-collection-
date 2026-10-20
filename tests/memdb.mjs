// Tiny in-memory stand-in for the Supabase query builder (enough for these tests and the browser harness).
const eqv = (a, b) => (a === null || a === undefined ? b === null || b === undefined : String(a) === String(b));
const ilike = (v, pat) => new RegExp("^" + String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i").test(String(v ?? ""));
const subset = (want, have) => (Array.isArray(want) ? want.every((w) => Array.isArray(have) && have.some((h) => subset(w, h))) : want && typeof want === "object" ? have && typeof have === "object" && Object.entries(want).every(([k, x]) => subset(x, have[k])) : eqv(want, have));

export function makeMem(db, { defaults = {}, uniques = {} } = {}) {
  const seq = {};
  const nextId = (t) => (seq[t] = (seq[t] || Math.max(0, ...(db[t] || []).map((r) => Number(r.id) || 0))) + 1);
  function run(table, ops, single) {
    if (!db[table]) return { data: null, error: { message: `no table ${table}` } };
    let mode = "select", payload, order, range, lim, count = false, head = false, selected = false, conflict, cols = null; const filters = [];
    for (const [op, a] of ops) {
      if (op === "select") { selected = true; if (a[1]?.count) count = true; if (a[1]?.head) head = true; const c = typeof a[0] === "string" ? a[0].trim() : "*"; cols = c && c !== "*" ? c.split(",").map((x) => x.trim()) : null; }
      else if (["insert", "update", "upsert"].includes(op)) { mode = op; payload = a[0]; if (op === "upsert") conflict = a[1]?.onConflict; }
      else if (op === "delete") mode = "delete";
      else if (op === "eq") filters.push((r) => eqv(r[a[0]], a[1]));
      else if (op === "in") filters.push((r) => a[1].map(String).includes(String(r[a[0]])));
      else if (op === "is") filters.push((r) => eqv(r[a[0]], a[1]));
      else if (op === "lt") filters.push((r) => Number(r[a[0]]) < Number(a[1]));
      else if (op === "gte") filters.push((r) => (typeof r[a[0]] === "string" ? String(new Date(r[a[0]]).getTime()) >= String(new Date(a[1]).getTime()) && new Date(r[a[0]]) >= new Date(a[1]) : Number(r[a[0]]) >= Number(a[1])));
      else if (op === "lte") filters.push((r) => (typeof r[a[0]] === "string" ? new Date(r[a[0]]) <= new Date(a[1]) : Number(r[a[0]]) <= Number(a[1])));
      else if (op === "contains") filters.push((r) => subset(a[1], r[a[0]]));
      else if (op === "or") { const parts = a[0].split(/,(?=\w+\.ilike\.)/).map((x) => x.match(/^(\w+)\.ilike\.(.*)$/)); filters.push((r) => parts.some((m) => m && ilike(r[m[1]], m[2]))); }
      else if (op === "order") order = [a[0], a[1]?.ascending !== false];
      else if (op === "range") range = a; else if (op === "limit") lim = a[0];
    }
    const match = (r) => filters.every((f) => f(r));
    if (mode === "insert") {
      const out = [];
      for (const p of [].concat(payload)) {
        const row = { id: nextId(table), created_at: new Date().toISOString(), ...p };
        defaults[table]?.(row);
        for (const [name, cols] of Object.entries(uniques[table] || {})) if (row[cols[0]] != null && db[table].some((r) => cols.every((c) => eqv(r[c], row[c])))) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${name}"` } };
        db[table].push(row); out.push(row);
      }
      return { data: single ? out[0] : selected ? out : null, error: null };
    }
    if (mode === "upsert") {
      for (const row of [].concat(payload)) { const pk = conflict || Object.keys(row)[0]; const ex = db[table].find((r) => eqv(r[pk], row[pk])); if (ex) Object.assign(ex, row); else db[table].push({ id: nextId(table), ...row }); }
      return { data: null, error: null };
    }
    let out = db[table].filter(match);
    if (mode === "update") { out.forEach((r) => Object.assign(r, payload)); return { data: single ? out[0] ?? null : selected ? out : null, error: null }; }
    if (mode === "delete") { db[table] = db[table].filter((r) => !match(r)); return { data: null, error: null }; }
    if (order) out = out.slice().sort((x, y) => (x[order[0]] > y[order[0]] ? 1 : x[order[0]] < y[order[0]] ? -1 : 0) * (order[1] ? 1 : -1));
    const total = out.length;
    const proj = (r) => (cols ? Object.fromEntries(cols.filter((k) => k in r).map((k) => [k, r[k]])) : r);
    if (range) out = out.slice(range[0], range[1] + 1); if (lim) out = out.slice(0, lim);
    if (head) return { data: null, error: null, count: total };
    if (single) return { data: out[0] ? proj(out[0]) : null, error: null };
    return { data: out.map(proj), error: null, count: count ? total : null };
  }
  return { run, db };
}
