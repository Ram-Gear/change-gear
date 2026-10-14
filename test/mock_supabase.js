// mock_supabase.js - in-memory fake of the parts of supabase-js the app uses, with the cg_* RLS rules
// (view: viewer|admin; insert/update/delete: admin; anon: nothing). Used by Node and browser tests.
// Install: globalThis.__CG_SUPABASE_MOCK__ = makeMockFactory({ users: { alice: { pin: '1234', role: 'admin' } } })
// Classic script too: sets window.makeCgMock when loaded without modules.
(function (root) {
  function makeMockFactory(opts) {
    const users = opts.users || {};
    const pk = opts.persistKey; // browser tests: keep the fake database across page reloads
    const ls = { get(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { root.localStorage.setItem(k, v); } catch (e) { /* blocked */ } } };
    const db = opts.db || (pk && JSON.parse(ls.get(pk) || 'null')) || { cg_machines: [], cg_gear_sets: [], cg_presets: [] };
    const persist = () => { if (pk) ls.set(pk, JSON.stringify(db)); };
    const sk = pk && pk + '.session';
    if (sk && !opts.session && ls.get(sk)) opts.session = JSON.parse(ls.get(sk));
    const log = opts.log || [];
    let session = opts.session || null; // { username }
    const setSession = (v) => { session = v; if (sk) ls.set(sk, JSON.stringify(v)); };
    let n = (db.cg_machines.length + db.cg_gear_sets.length + db.cg_presets.length) * 7 + Math.floor(Math.random() * 1e6);
    const uuid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
    const emailOf = (u) => 'u' + Array.from(new TextEncoder().encode(String(u).trim().toLowerCase()), (b) => b.toString(16).padStart(2, '0')).join('') + '@users.invalid';
    const roleOf = () => (session && users[session.username] ? users[session.username].role : 'none');
    const unique = { cg_machines: [['name']], cg_gear_sets: [['machine_id', 'kind']], cg_presets: [['machine_id', 'name']] };
    const denied = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
    class Q {
      constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.one = false; this.sel = false; }
      select() { if (this.op === 'select') this.op = 'select'; this.sel = true; return this; }
      insert(r) { this.op = 'insert'; this.row = r; return this; }
      update(r) { this.op = 'update'; this.row = r; return this; }
      upsert(r, o) { this.op = 'upsert'; this.row = r; this.conflict = ((o && o.onConflict) || 'id').split(','); return this; }
      delete() { this.op = 'delete'; return this; }
      eq(k, v) { this.f.push([k, v]); return this; }
      is(k, v) { this.f.push([k, v]); return this; }
      single() { this.one = true; return this; }
      then(a, b) { return Promise.resolve().then(() => this.run()).then(a, b); }
      run() {
        const role = roleOf(), T = db[this.t];
        log.push({ table: this.t, op: this.op, row: this.row, f: this.f, role });
        const match = (r) => this.f.every(([k, v]) => r[k] === v);
        if (this.op === 'select') { if (!session || role === 'none') return { data: [], error: null }; const d = T.filter(match).map((r) => JSON.parse(JSON.stringify(r))); return { data: this.one ? d[0] || null : d, error: null }; }
        if (role !== 'admin') return denied;
        const clash = (row, self) => unique[this.t].some((cols) => T.some((r) => r !== self && cols.every((c) => r[c] === row[c])));
        const now = new Date().toISOString();
        let out;
        if (this.op === 'insert') {
          const row = { id: uuid(), created_at: now, updated_at: now, deleted_at: null, ...JSON.parse(JSON.stringify(this.row)) };
          if (clash(row)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          T.push(row); out = row;
        } else if (this.op === 'upsert') {
          const r0 = JSON.parse(JSON.stringify(this.row));
          const ex = T.find((r) => this.conflict.every((c) => r[c] === r0[c]));
          if (ex) { Object.assign(ex, r0, { updated_at: now }); out = ex; }
          else { out = { id: uuid(), created_at: now, updated_at: now, ...(this.t === 'cg_machines' ? { deleted_at: null } : {}), ...(this.t === 'cg_presets' ? { created_by: 'mock-' + session.username } : {}), ...r0 }; T.push(out); }
        } else if (this.op === 'update') {
          const rows = T.filter(match);
          for (const r of rows) { const nr = { ...r, ...JSON.parse(JSON.stringify(this.row)) }; if (clash(nr, r)) return { data: null, error: { code: '23505', message: 'duplicate key' } }; Object.assign(r, nr, { updated_at: now }); }
          out = rows[0];
        } else if (this.op === 'delete') {
          for (const r of T.filter(match)) T.splice(T.indexOf(r), 1);
          if (this.t === 'cg_machines') out = null;
        }
        persist();
        return { data: out ? JSON.parse(JSON.stringify(out)) : null, error: null };
      }
    }
    const client = {
      _db: db, _log: log,
      auth: {
        async getSession() { return { data: { session: session ? { user: { email: emailOf(session.username) } } : null }, error: null }; },
        async signInWithPassword({ email, password }) {
          log.push({ auth: 'signIn', email, password });
          const u = Object.keys(users).find((k) => emailOf(k) === email && 'rg1:' + users[k].pin === password && users[k].active !== false);
          if (!u) return { data: null, error: { message: 'Invalid login credentials', status: 400 } };
          setSession({ username: u }); return { data: { session: {} }, error: null };
        },
        async signOut() { setSession(null); log.push({ auth: 'signOut' }); return { error: null }; },
      },
      functions: {
        async invoke(name, { body }) {
          log.push({ fn: name, body });
          const u = users[String(body.username).trim().toLowerCase()];
          if (name === 'rg-admin' && body.action === 'activate' && u && 'rg1:' + u.pin === body.password && u.active === false) { u.active = true; return { data: { ok: true }, error: null }; }
          return { data: null, error: { message: 'Edge Function returned a non-2xx status code' } };
        },
      },
      async rpc(fn) {
        const r = roleOf();
        if (!session) return { data: null, error: { message: 'permission denied for function ' + fn } };
        const v = { cg_role: r, cg_can_view: r === 'viewer' || r === 'admin', cg_can_edit: r === 'admin', cg_can_delete: r === 'admin' }[fn];
        return { data: v, error: null };
      },
      from(t) { return new Q(t); },
    };
    return () => client;
  }
  root.makeCgMock = makeMockFactory;
  if (typeof module !== 'undefined') module.exports = { makeMockFactory };
})(typeof globalThis !== 'undefined' ? globalThis : this);
