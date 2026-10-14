// store.js - the ONLY module app.js uses for persistent data (v1.7: shared Supabase database + logins).
//   Shared (Supabase, QC Form project): machines, each machine's index + differential gear lists, index presets,
//     gear-search settings of the built-in routines. Mapping in cgmap.js.
//   This PC only (localStorage): last inputs, settings, gear lists not used by any machine.
//   This PC only (IndexedDB): manual PDFs.
// Same load()/save() shape as v1.6, plus init / signIn / signOut / auth / uploadLocalData.
// Tests inject a fake client with globalThis.__CG_SUPABASE_MOCK__ = (url, key) => client.
import * as local from './store-local.js';
import { createClient } from './supabase-vendor.js';
import * as M from './cgmap.js';

export const SUPABASE_URL = 'https://dbveedcksommanxshpzx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_GE8oGj58dn6AaFVKGPCM3Q_plAf4TST'; // publishable (public by design)
const LOCAL_KEY = 'ramgear.changegear.v17.local';
const MIGRATED_KEY = 'ramgear.changegear.v17.migrated';
export const backendName = 'shared RAM-GEAR database (Supabase)';

let client = null;
let builtins = [];
let removedIds = [];
export const auth = { signedIn: false, username: '', role: 'none', canView: false, canEdit: false, canDelete: false };
let snap = null;          // last synced remote shape (from cgmap.toRemote) + row ids
let rowIds = {};          // machine key -> uuid ; 'gs:'+key|kind -> uuid ; 'p:'+key|name -> uuid
const syncListeners = [];
export function onSyncState(fn) { syncListeners.push(fn); }
const emit = (s) => syncListeners.forEach((f) => { try { f(s); } catch (e) { console.error(e); } });

export const onProblem = local.onProblem;
export const storageProblem = local.storageProblem;

export function usernameToEmail(username) {
  const bytes = new TextEncoder().encode(String(username).trim().toLowerCase());
  return 'u' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') + '@users.invalid';
}
export const pinToPassword = (pin) => 'rg1:' + String(pin);

function getClient() {
  if (client) return client;
  const mk = globalThis.__CG_SUPABASE_MOCK__;
  client = mk ? mk(SUPABASE_URL, SUPABASE_KEY) : createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ramgear-changegear-auth' } });
  return client;
}
const unwrap = ({ data, error }) => { if (error) throw error; return data; };
const errText = (e) => (e && (e.message || e.error_description || e.msg)) || String(e);

async function loadRole() {
  const c = getClient();
  const [role, view, edit, del] = await Promise.all(['cg_role', 'cg_can_view', 'cg_can_edit', 'cg_can_delete'].map((f) => c.rpc(f)));
  for (const r of [role, view, edit, del]) if (r.error) throw r.error;
  Object.assign(auth, { role: role.data || 'none', canView: view.data === true, canEdit: edit.data === true, canDelete: del.data === true });
}
function nameFromSession(s) {
  const m = /^u([0-9a-f]+)@users\.invalid$/.exec((s && s.user && s.user.email) || '');
  if (!m) return (s && s.user && s.user.email) || '';
  try { return new TextDecoder().decode(new Uint8Array(m[1].match(/../g).map((x) => parseInt(x, 16)))); } catch (e) { return ''; }
}

// Call once at start. Restores a saved session if there is one. Returns auth.
export async function init(builtinMachines, removedBuiltinIds = []) {
  builtins = builtinMachines; removedIds = removedBuiltinIds;
  const c = getClient();
  const { data } = await c.auth.getSession();
  if (data && data.session) {
    auth.signedIn = true; auth.username = nameFromSession(data.session);
    try { await loadRole(); } catch (e) { auth.error = errText(e); auth.canView = auth.canEdit = auth.canDelete = false; auth.role = 'none'; }
  }
  return auth;
}

// Same sign-in as the QC Form: try the password; if that fails, ask rg-admin to activate the account once, then retry once.
export async function signIn(username, pin) {
  const c = getClient();
  username = String(username || '').trim();
  if (!username || !String(pin || '')) throw new Error('Enter your username and PIN.');
  const email = usernameToEmail(username), password = pinToPassword(pin);
  let r = await c.auth.signInWithPassword({ email, password });
  if (r.error) {
    const a = await c.functions.invoke('rg-admin', { body: { action: 'activate', username, password } });
    if (a.error) throw new Error('Wrong username or PIN, or the account is not set up.');
    r = await c.auth.signInWithPassword({ email, password });
    if (r.error) throw new Error('Wrong username or PIN, or the account is not set up.');
  }
  auth.signedIn = true; auth.username = username;
  await loadRole();
  return auth;
}
export async function signOut() {
  try { await getClient().auth.signOut(); } finally { Object.assign(auth, { signedIn: false, username: '', role: 'none', canView: false, canEdit: false, canDelete: false }); snap = null; }
}

async function fetchRows() {
  const c = getClient();
  const [m, g, p] = await Promise.all([c.from('cg_machines').select('*'), c.from('cg_gear_sets').select('*'), c.from('cg_presets').select('*')]);
  return { machines: unwrap(m) || [], gearSets: unwrap(g) || [], presets: unwrap(p) || [] };
}
function rememberRowIds(rows, mapped) {
  rowIds = { ...mapped.rowIdByKey };
  const keyOfMachine = Object.fromEntries(Object.entries(mapped.rowIdByKey).map(([k, v]) => [v, k]));
  for (const g of rows.gearSets) if (keyOfMachine[g.machine_id]) rowIds[`gs:${keyOfMachine[g.machine_id]}|${g.kind}`] = g.id;
  for (const p of rows.presets) if (keyOfMachine[p.machine_id]) rowIds[`p:${keyOfMachine[p.machine_id]}|${p.name}`] = p.id;
}

// -> { machines, inventories, builtinOverrides, lastInputs, settings }
export async function load() {
  if (!auth.canView) throw new Error('Not signed in');
  const rows = await fetchRows();
  const mapped = M.fromRemote(rows, builtins);
  for (const id of removedIds) delete mapped.builtinOverrides[id];
  rememberRowIds(rows, mapped);
  const loc = local.readJson(LOCAL_KEY) || {};
  const data = { machines: mapped.machines, inventories: [...mapped.inventories, ...(loc.inventories || [])], builtinOverrides: mapped.builtinOverrides, lastInputs: loc.lastInputs || {}, settings: loc.settings || {} };
  snap = M.toRemote(data, builtins);
  data.skipped = mapped.skipped;
  return data;
}

// ---------------------------------------------------------------- save = diff against the last synced state
let pending = null, running = null;
export function save(data) {
  const remote = M.toRemote(data, builtins);
  const kept = local.writeJson(LOCAL_KEY, { lastInputs: data.lastInputs || {}, settings: data.settings || {}, inventories: remote.localInventories });
  if (!auth.canEdit || !snap) return Promise.resolve(kept);
  pending = remote;
  if (!running) running = (async () => {
    try { while (pending) { const want = pending; pending = null; await sync(want); } emit({ ok: true }); }
    catch (e) { console.error(e); emit({ ok: false, error: errText(e) }); }
    finally { running = null; }
  })();
  return running.then(() => kept);
}
export const whenSynced = () => running || Promise.resolve();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function sync(want) {
  const c = getClient();
  const have = snap;
  // 1. machines removed (first, so a new machine can reuse the name): soft delete (deleted_at) and free the unique name; built-in rows are kept, their override just emptied
  for (const key of Object.keys(have.machines)) {
    if (want.machines[key]) continue;
    const id = rowIds[key];
    if (id && key.startsWith('c:')) {
      const at = new Date().toISOString();
      unwrap(await c.from('cg_machines').update({ deleted_at: at, name: `${have.machines[key].name} [deleted ${at}]` }).eq('id', id));
    } else if (id) unwrap(await c.from('cg_machines').update({ formulas: { app: M.APP_TAG, schema: M.SCHEMA, builtin: key.slice(2), override: { trains: {} } } }).eq('id', id));
    delete rowIds[key]; delete have.machines[key];
  }
  // 2. machines (insert / update)
  for (let [key, row] of Object.entries(want.machines)) {
    if (rowIds[key] && same(have.machines[key], row)) continue;
    let id = rowIds[key];
    const was = have.machines[key];
    if (id && was && was.formulas && was.formulas.locked === true && was.formulas.def) {
      // v1.8 locked machine: definition frozen; only its gear-list links (train.inventory) may change
      const def = JSON.parse(JSON.stringify(was.formulas.def));
      const wd = (row.formulas && row.formulas.def) || {};
      (def.trains || []).forEach((t, i) => { const w = (wd.trains || [])[i]; if (w && w.kind === t.kind && w.inventory !== undefined) t.inventory = w.inventory; });
      row = { name: was.name, notes: was.notes, formulas: { ...was.formulas, def } };
    }
    if (id) unwrap(await c.from('cg_machines').update({ name: row.name, notes: row.notes, formulas: row.formulas, deleted_at: null }).eq('id', id));
    else if (key.startsWith('b:')) {
      // built-in routine: one row per routine, keyed by name, created by the first admin who changes its gear lists/presets
      id = unwrap(await c.from('cg_machines').upsert({ name: row.name, notes: row.notes, formulas: row.formulas, deleted_at: null }, { onConflict: 'name' }).select('id').single()).id;
    } else {
      const r = await c.from('cg_machines').insert({ name: row.name, notes: row.notes, formulas: row.formulas }).select('id').single();
      if (r.error && r.error.code === '23505') throw new Error(`A machine named "${row.name}" already exists in the shared database. Rename it and save again.`);
      id = unwrap(r).id;
    }
    rowIds[key] = id; have.machines[key] = row;
  }
  // 3. gear sets and presets (upsert changed, delete removed)
  for (const [tbl, wantMap, haveMap, conflict, pre, fields] of [
    ['cg_gear_sets', want.gearSets, have.gearSets, 'machine_id,kind', 'gs:', (r) => ({ kind: r.kind, teeth: r.teeth, notes: r.notes })],
    ['cg_presets', want.presets, have.presets, 'machine_id,name', 'p:', (r) => ({ name: r.name, inputs: r.inputs, result: r.result })]]) {
    for (const [k, r] of Object.entries(haveMap)) {
      if (wantMap[k]) continue;
      const id = rowIds[pre + k];
      if (id) unwrap(await c.from(tbl).delete().eq('id', id));
      delete rowIds[pre + k]; delete haveMap[k];
    }
    for (const [k, r] of Object.entries(wantMap)) {
      if (rowIds[pre + k] && same(haveMap[k], r)) continue;
      const row = unwrap(await c.from(tbl).upsert({ machine_id: rowIds[r.key], ...fields(r) }, { onConflict: conflict }).select('id').single());
      rowIds[pre + k] = row.id; haveMap[k] = r;
    }
  }
}

// ---------------------------------------------------------------- one-time upload of the v1.6 browser data (admin)
export const hasLocalData = local.hasLegacyData;
export const localDataUploaded = () => !!local.readJson(MIGRATED_KEY);
// Merges the v1.6 browser data into the shared data (same ids/names are replaced), saves, returns counts.
export async function uploadLocalData(current) {
  if (!auth.canEdit) throw new Error('Only an admin can upload data.');
  const old = await local.load(removedIds);
  const up = (arr, items, eq) => items.forEach((x) => { const k = arr.findIndex((y) => eq(x, y)); if (k >= 0) arr[k] = x; else arr.push(x); });
  up(current.machines, old.machines, (a, b) => a.id === b.id || a.name === b.name);
  up(current.inventories, old.inventories, (a, b) => a.id === b.id);
  for (const [id, ov] of Object.entries(old.builtinOverrides)) current.builtinOverrides[id] = ov;
  for (const [id, v] of Object.entries(old.lastInputs || {})) if (!current.lastInputs[id]) current.lastInputs[id] = v;
  await save(current);
  await whenSynced();
  local.writeJson(MIGRATED_KEY, { at: new Date().toISOString(), by: auth.username });
  return { machines: old.machines.length, inventories: old.inventories.length, builtins: Object.keys(old.builtinOverrides).length };
}

export const manualsAvailable = local.manualsAvailable;
export const getManual = local.getManual;
export const putManual = local.putManual;
export const deleteManual = local.deleteManual;
export const listManuals = local.listManuals;
export const exportManuals = local.exportManuals;
export const importManuals = local.importManuals;
export const looksLikePdf = local.looksLikePdf;
