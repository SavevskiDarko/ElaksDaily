/* A stand-in for supabase-js, for the browser tests.
 *
 * tests/harness.js serves this file in place of
 *   https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js
 * so index.html's `supabase.createClient(...)` gets a client that keeps its
 * tables in memory instead of talking to a server.
 *
 * What it reads, all set by the harness's init script before the app starts:
 *   window.__db        { table: [rows] }. Reads and writes go here, so a test
 *                      seeds it and later looks in it to see what was saved.
 *                      A table that is not there yet starts out empty.
 *   window.__missing   ["table", ...]: these answer as Postgres does for a
 *                      relation that does not exist (code 42P01), for the
 *                      app's "the migration has not been run yet" paths.
 *   window.__user      the signed-in user (default { id: "u1" }).
 *   window.__rpc       { name: (args) => data }  optional answers for db.rpc
 *   window.__functions { name: (body) => data }  optional answers for functions.invoke
 *
 * The query builder covers what index.html uses. `or` and `not` are accepted
 * and ignored — the rows come back unfiltered — so a test must not depend on
 * what they would have filtered out.
 */
(function () {
  "use strict";

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const tables = () => (window.__db = window.__db || {});
  const rowsOf = (name) => (tables()[name] = tables()[name] || []);
  const isMissing = (name) => (window.__missing || []).includes(name);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    }));
  // like the network: the answer comes on a later turn of the event loop
  const later = (v) => new Promise((ok) => setTimeout(() => ok(v), 0));

  // ---- comparing values the way PostgREST would, near enough ----
  const isNum = (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  function order(a, b) {
    if (isNum(a) && isNum(b)) return Number(a) - Number(b);
    const x = String(a), y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const likeRe = (pattern, flags) => new RegExp("^" + String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", flags);

  // ---- select("a, b, other(x, y)") ----
  // top-level commas only: "*, clients(name)" is two parts, not three
  function splitCols(s) {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of String(s)) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // an embedded table: "clients(name)" on offers follows offers.client_id
  function embed(row, rel, cols) {
    const fk = rel.replace(/ies$/, "y").replace(/s$/, "") + "_id";
    if (!(fk in row)) return null;
    const hit = rowsOf(rel).find((r) => same(r.id, row[fk]));
    return hit ? project(hit, cols) : null;
  }
  function project(row, cols) {
    const parts = splitCols(cols || "*");
    if (!parts.length) parts.push("*");
    let out = {};
    for (const p of parts) {
      const m = p.match(/^(?:(\w+):)?(\w+)\s*\((.*)\)$/s);
      if (p === "*") out = { ...out, ...clone(row) };
      else if (m) out[m[1] || m[2]] = embed(row, m[2], m[3]);
      else {
        const [alias, name] = p.includes(":") ? p.split(":").map((x) => x.trim()) : [p, p];
        out[alias] = row[name] === undefined ? null : clone(row[name]);
      }
    }
    return out;
  }

  const fail = (code, message, status) => ({ data: null, error: { code, message, details: null, hint: null }, count: null, status, statusText: "" });
  const ok = (data, status) => ({ data, error: null, count: null, status: status || 200, statusText: "OK" });

  class Query {
    constructor(table) {
      this.table = table;
      this.op = "select";
      this.cols = "*";
      this.returning = false;     // .select() after a write
      this.tests = [];
      this.sorts = [];
      this.max = null;
      this.from = 0;
      this.to = null;
      this.one = null;             // "single" | "maybe"
      this.payload = null;
      this.opts = {};
    }

    // ---- what to do ----
    select(cols) {
      if (this.op === "select") this.cols = cols || "*";
      else { this.returning = true; this.cols = cols || "*"; }
      return this;
    }
    insert(rows, opts) { this.op = "insert"; this.payload = rows; this.opts = opts || {}; return this; }
    upsert(rows, opts) { this.op = "upsert"; this.payload = rows; this.opts = opts || {}; return this; }
    update(patch) { this.op = "update"; this.payload = patch; return this; }
    delete() { this.op = "delete"; return this; }

    // ---- which rows ----
    where(fn) { this.tests.push(fn); return this; }
    eq(c, v) { return this.where((r) => same(r[c], v)); }
    neq(c, v) { return this.where((r) => r[c] != null && v != null && !same(r[c], v)); }
    gt(c, v) { return this.where((r) => r[c] != null && order(r[c], v) > 0); }
    gte(c, v) { return this.where((r) => r[c] != null && order(r[c], v) >= 0); }
    lt(c, v) { return this.where((r) => r[c] != null && order(r[c], v) < 0); }
    lte(c, v) { return this.where((r) => r[c] != null && order(r[c], v) <= 0); }
    in(c, list) { return this.where((r) => (list || []).some((v) => same(r[c], v))); }
    is(c, v) { return this.where((r) => (v === null ? r[c] == null : r[c] === v)); }
    like(c, p) { const re = likeRe(p); return this.where((r) => r[c] != null && re.test(String(r[c]))); }
    ilike(c, p) { const re = likeRe(p, "i"); return this.where((r) => r[c] != null && re.test(String(r[c]))); }
    match(obj) { for (const [c, v] of Object.entries(obj || {})) this.eq(c, v); return this; }
    or() { return this; }
    not() { return this; }
    abortSignal() { return this; }

    // ---- how many, in what order ----
    order(c, o) { this.sorts.push({ c, asc: !o || o.ascending !== false, nullsFirst: o && o.nullsFirst }); return this; }
    limit(n) { this.max = n; return this; }
    range(a, b) { this.from = a; this.to = b; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }

    then(onOk, onErr) { return later(this.run()).then(onOk, onErr); }

    // ---- doing it ----
    matches(r) { return this.tests.every((t) => t(r)); }
    sorted(list) {
      if (!this.sorts.length) return list;
      return list.slice().sort((a, b) => {
        for (const s of this.sorts) {
          const x = a[s.c], y = b[s.c];
          // Postgres: nulls last going up, first going down, unless told
          const nullsFirst = s.nullsFirst !== undefined ? s.nullsFirst : !s.asc;
          if (x == null && y == null) continue;
          if (x == null) return nullsFirst ? -1 : 1;
          if (y == null) return nullsFirst ? 1 : -1;
          const d = order(x, y);
          if (d) return s.asc ? d : -d;
        }
        return 0;
      });
    }
    page(list) {
      let out = list.slice(this.from, this.to == null ? undefined : this.to + 1);
      if (this.max != null) out = out.slice(0, this.max);
      return out;
    }
    answer(list, status) {
      if (this.op !== "select" && !this.returning) return ok(null, status);
      const data = list.map((r) => project(r, this.cols));
      if (this.one === "single" && data.length !== 1)
        return fail("PGRST116", "JSON object requested, multiple (or no) rows returned", 406);
      if (this.one === "maybe" && data.length > 1)
        return fail("PGRST116", "JSON object requested, multiple (or no) rows returned", 406);
      if (this.one) return ok(data[0] || null, status);
      return ok(data, status);
    }
    fresh(row) {
      const r = clone(row);
      if (r.id == null) r.id = uuid();
      if (r.created_at == null) r.created_at = new Date().toISOString();
      return r;
    }
    run() {
      if (isMissing(this.table))
        return fail("42P01", `relation "public.${this.table}" does not exist`, 404);
      const all = rowsOf(this.table);
      const many = [].concat(this.payload || []);

      if (this.op === "select") return this.answer(this.page(this.sorted(all.filter((r) => this.matches(r)))));

      if (this.op === "insert") {
        const made = many.map((r) => this.fresh(r));
        const ids = new Set(all.map((r) => String(r.id)));
        for (const r of made) {
          if (ids.has(String(r.id)))
            return fail("23505", `duplicate key value violates unique constraint "${this.table}_pkey"`, 409);
          ids.add(String(r.id));
        }
        all.push(...made);
        return this.answer(made, 201);
      }

      if (this.op === "upsert") {
        const keys = String(this.opts.onConflict || "id").split(",").map((k) => k.trim());
        const out = [];
        for (const row of many) {
          const have = all.find((r) => keys.every((k) => same(r[k], row[k])));
          if (have && this.opts.ignoreDuplicates) continue;
          if (have) { Object.assign(have, clone(row)); out.push(have); }
          else { const r = this.fresh(row); all.push(r); out.push(r); }
        }
        return this.answer(out, 201);
      }

      if (this.op === "update") {
        const hit = all.filter((r) => this.matches(r));
        for (const r of hit) Object.assign(r, clone(this.payload));
        return this.answer(hit);
      }

      if (this.op === "delete") {
        const hit = all.filter((r) => this.matches(r));
        tables()[this.table] = all.filter((r) => !hit.includes(r));
        return this.answer(hit);
      }
      return fail("STUB", "unknown operation " + this.op, 400);
    }
  }

  function createClient() {
    const user = () => window.__user || { id: "u1", email: "owner@example.test" };
    let signedIn = true;
    const session = () => (signedIn ? { user: user(), access_token: "test-token", refresh_token: "test-refresh",
      token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 } : null);
    const listeners = [];
    const tell = (ev) => listeners.forEach((fn) => { try { fn(ev, session()); } catch (e) { console.warn(e); } });

    const channel = (name) => {
      const ch = {
        topic: name,
        on() { return ch; },
        subscribe(cb) { if (cb) setTimeout(() => cb("SUBSCRIBED"), 0); return ch; },
        unsubscribe() { return later("ok"); },
        send() { return later("ok"); },
      };
      return ch;
    };

    return {
      from: (table) => new Query(table),
      rpc: (name, args) => {
        const fn = (window.__rpc || {})[name];
        try { return later(ok(fn ? clone(fn(args)) ?? null : null)); }
        catch (e) { return later(fail("P0001", String((e && e.message) || e), 400)); }
      },
      channel,
      removeChannel: () => later("ok"),
      removeAllChannels: () => later([]),
      functions: {
        invoke: (name, opts) => {
          const fn = (window.__functions || {})[name];
          try { return later({ data: fn ? clone(fn(opts && opts.body)) ?? null : null, error: null }); }
          catch (e) { return later({ data: null, error: { message: String((e && e.message) || e) } }); }
        },
      },
      auth: {
        getSession: () => later({ data: { session: session() }, error: null }),
        getUser: () => later({ data: { user: signedIn ? user() : null }, error: null }),
        onAuthStateChange: (fn) => {
          listeners.push(fn);
          setTimeout(() => { try { fn("INITIAL_SESSION", session()); } catch (e) { console.warn(e); } }, 0);
          return { data: { subscription: { unsubscribe: () => listeners.splice(listeners.indexOf(fn), 1) } } };
        },
        signInWithPassword: () => { signedIn = true; tell("SIGNED_IN"); return later({ data: { user: user(), session: session() }, error: null }); },
        signOut: () => { signedIn = false; tell("SIGNED_OUT"); return later({ error: null }); },
        resetPasswordForEmail: () => later({ data: {}, error: null }),
        updateUser: (attrs) => later({ data: { user: { ...user(), ...(attrs || {}) } }, error: null }),
      },
    };
  }

  window.supabase = { createClient };
})();
