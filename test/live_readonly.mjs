// Read-only checks against the LIVE Supabase project (network). Writes nothing, creates no users,
// never calls rg-admin. Run: node test/live_readonly.mjs
import { createClient } from '../js/supabase-vendor.js';
import { SUPABASE_URL, SUPABASE_KEY, usernameToEmail, pinToPassword } from '../js/store.js';
const c = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: globalThis.WebSocket || class { } } });
let bad = 0; const check = (cond, m, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${m}${extra ? ' - ' + extra : ''}`); if (!cond) bad++; };
for (const t of ['cg_machines', 'cg_gear_sets', 'cg_presets']) {
  const r = await c.from(t).select('*').limit(5);
  check(!!r.error || (Array.isArray(r.data) && r.data.length === 0), `anon cannot read ${t}`, r.error ? `${r.error.code} ${r.error.message}` : `rows=${r.data.length}`);
}
for (const f of ['cg_role', 'cg_can_view', 'cg_can_edit', 'cg_can_delete']) {
  const r = await c.rpc(f);
  check(!!r.error || r.data === false || r.data === 'none' || r.data === null, `anon ${f}() gives no access`, r.error ? `${r.error.code} ${r.error.message}` : JSON.stringify(r.data));
}
// sign-in error path: a username that cannot exist (reserved characters) -> clean error, no session
const r = await c.auth.signInWithPassword({ email: usernameToEmail('zz-cg-nonexistent-' + Date.now()), password: pinToPassword('000000') });
check(!!r.error && !r.data.session, 'wrong username/PIN is refused', r.error && `${r.error.status} ${r.error.message}`);
const s = await c.auth.getSession();
check(!s.data.session, 'no session after failed sign-in');
console.log(bad ? `${bad} live check(s) FAILED` : 'ALL LIVE READ-ONLY CHECKS PASSED');
process.exitCode = bad ? 1 : 0;
