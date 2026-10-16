// cgmap.js - pure mapping between the app's in-memory data and the shared Supabase tables (v1.7).
// No DOM, no network; unit-tested in test/cgmap.test.mjs. See notes.md "Shared database mapping".
//
//   cg_machines.formulas (jsonb)  { app:'ramgear-changegear', schema:1, def:<whole machine definition> }      custom machine
//                                 { app:'ramgear-changegear', schema:1, builtin:<id>, override:{trains:{..}} } built-in routine
//                                 v1.8 locked machine adds locked:true, lockedAt, lockedBy next to def
//   cg_gear_sets (machine_id, kind 'indexing'|'differential')  teeth int[] = each tooth count repeated qty times
//                                 notes = JSON {format:'rg-gears-1', name, note, gears:[{teeth,qty,note}]} - per-gear notes and
//                                 any qty-0 rows (teeth[] cannot hold those); teeth[] stays the source of truth for quantities.
//   cg_presets (machine_id, name 'z=<n>' (2nd+ set for the same z: 'z=<n>#2'...), inputs {z}, result {A,B,C,D,note,name?})
// Trains that use the machine's own list point at '@own:index' / '@own:differential' inside formulas.

export const APP_TAG = 'ramgear-changegear';
export const SCHEMA = 1;
export const KIND_TO_DB = { index: 'indexing', differential: 'differential' };
export const DB_TO_KIND = { indexing: 'index', differential: 'differential' };
const OWN = '@own:';
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export const machineKey = (m) => (m.builtin ? 'b:' + m.id : 'c:' + m.id);
export const invIdFor = (rowId, kind) => `cg-${rowId}-${kind}`;

// ---------------------------------------------------------------- gear lists
export function gearsToTeeth(gears) {
  const out = [];
  for (const g of gears || []) { const q = Number(g.qty === undefined ? 1 : g.qty); for (let i = 0; i < q; i++) out.push(Number(g.teeth)); }
  return out.sort((a, b) => a - b);
}
export function gearsToNotes(inv) {
  const gears = (inv.gears || []).filter((g) => (g.note && String(g.note).trim()) || Number(g.qty) === 0)
    .map((g) => ({ teeth: Number(g.teeth), qty: Number(g.qty === undefined ? 1 : g.qty), ...(g.note ? { note: String(g.note) } : {}) }));
  return JSON.stringify({ format: 'rg-gears-1', name: inv.name || '', ...(inv.note ? { note: inv.note } : {}), gears });
}
export function parseNotes(s) {
  try { const o = JSON.parse(s || ''); if (o && o.format === 'rg-gears-1') return o; } catch (e) { /* plain text */ }
  return { name: '', note: s || '', gears: [] };
}
export function teethToGears(teeth, notes) {
  const n = parseNotes(notes);
  const m = new Map();
  for (const t of teeth || []) m.set(Number(t), (m.get(Number(t)) || 0) + 1);
  for (const g of n.gears || []) if (!m.has(Number(g.teeth))) m.set(Number(g.teeth), 0);
  const noteOf = new Map((n.gears || []).filter((g) => g.note).map((g) => [Number(g.teeth), g.note]));
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([teeth, qty]) => ({ teeth, qty, ...(noteOf.has(teeth) ? { note: noteOf.get(teeth) } : {}) }));
}

// ---------------------------------------------------------------- presets
export function presetsToRows(list) {
  const seen = {};
  return (list || []).map((p) => {
    const k = seen[p.z] = (seen[p.z] || 0) + 1;
    return { name: k === 1 ? `z=${p.z}` : `z=${p.z}#${k}`, inputs: { z: Number(p.z) },
      result: { A: Number(p.A), B: Number(p.B), C: p.C ? Number(p.C) : null, D: p.D ? Number(p.D) : null, note: p.note || '', ...(p.label ? { name: String(p.label) } : {}) } };
  });
}
export function rowsToPresets(rows) {
  return (rows || []).map((r) => {
    const z = Number((r.inputs && r.inputs.z) ?? String(r.name).replace(/^z=/, '').replace(/#.*/, ''));
    const res = r.result || {};
    const p = { z, A: Number(res.A), B: Number(res.B), note: res.note || '' };
    if (res.C && res.D) { p.C = Number(res.C); p.D = Number(res.D); }
    if (res.name) p.label = String(res.name); // v1.8.6 preset name (cg_presets.result.name, no schema change)
    return { p, name: r.name };
  }).sort((a, b) => a.p.z - b.p.z || String(a.name).localeCompare(String(b.name), 'en', { numeric: true })).map((x) => x.p);
}

// ---------------------------------------------------------------- whole data set -> rows
// data = { machines, inventories, builtinOverrides }; builtins = calc.BUILTIN_MACHINES
// Returns { machines: {key: {name, notes, formulas}}, gearSets: {key|kind: {key, kind, teeth, notes}}, presets: {key|name: {...}},
//           localInventories: [inventories not used by any machine - they stay in this browser] }
export function toRemote(data, builtins) {
  const out = { machines: {}, gearSets: {}, presets: {}, localInventories: [] };
  const invs = data.inventories || [];
  const used = new Set();
  const ownTrains = (trains, base, key) => {
    (trains || []).forEach((t, i) => {
      const b = base ? base[i] : t; const kind = b && b.kind;
      if (!KIND_TO_DB[kind]) return;
      const invId = (t && t.inventory) !== undefined ? t.inventory : b.inventory;
      const inv = invs.find((x) => x.id === invId);
      if (!inv) return;
      used.add(inv.id);
      const db = KIND_TO_DB[kind];
      if (!out.gearSets[`${key}|${db}`]) out.gearSets[`${key}|${db}`] = { key, kind: db, teeth: gearsToTeeth(inv.gears), notes: gearsToNotes(inv) };
      t.inventory = OWN + kind;
    });
  };
  const addPresets = (key, list) => presetsToRows(list).forEach((r) => { out.presets[`${key}|${r.name}`] = { key, ...r }; });
  for (const b of builtins) {
    const ov = (data.builtinOverrides || {})[b.id];
    if (!ov) continue;
    const key = machineKey(b);
    const trains = clone(ov.trains || {});
    // trains override is sparse {i: {...}}; resolve gear lists with the built-in default as fallback
    const tmp = (b.trains || []).map((bt, i) => ({ ...(trains[i] || {}) }));
    ownTrains(tmp, b.trains, key);
    const trOut = {};
    tmp.forEach((t, i) => { if (Object.keys(t).length) trOut[i] = t; });
    const hasPresets = (ov.indexPresets || []).length > 0;
    if (!Object.keys(trOut).length && !hasPresets) continue;
    out.machines[key] = { name: b.name, notes: null, formulas: { app: APP_TAG, schema: SCHEMA, builtin: b.id, override: { trains: trOut } } };
    addPresets(key, ov.indexPresets);
  }
  for (const m of data.machines || []) {
    const key = machineKey(m);
    const def = clone(m);
    const presets = def.indexPresets; delete def.indexPresets; delete def.ownInventories;
    const lock = def.lock; delete def.lock;
    ownTrains(def.trains, null, key);
    // v1.8: Verify & lock -> {locked:true, lockedAt, lockedBy} at the top of formulas (not enforced by RLS - see notes.md)
    const lk = lock && lock.locked ? { locked: true, lockedAt: lock.lockedAt || null, lockedBy: lock.lockedBy || null } : {};
    out.machines[key] = { name: m.name, notes: m.description || null, formulas: { app: APP_TAG, schema: SCHEMA, ...lk, def } };
    addPresets(key, presets);
  }
  out.localInventories = invs.filter((x) => !used.has(x.id));
  // drop gear sets / presets whose machine row is not wanted (cannot happen, but keep rows consistent)
  for (const k of Object.keys(out.gearSets)) if (!out.machines[out.gearSets[k].key]) delete out.gearSets[k];
  return out;
}

// ---------------------------------------------------------------- rows -> whole data set
// rows = { machines: [cg_machines], gearSets: [cg_gear_sets], presets: [cg_presets] }
// Returns { machines, inventories, builtinOverrides, rowIdByKey: {key: uuid}, skipped: [names not made by this app] }
export function fromRemote(rows, builtins) {
  const res = { machines: [], inventories: [], builtinOverrides: {}, rowIdByKey: {}, skipped: [] };
  const live = (rows.machines || []).filter((r) => !r.deleted_at);
  for (const r of live) {
    const f = r.formulas || {};
    const sets = (rows.gearSets || []).filter((g) => g.machine_id === r.id);
    const presets = rowsToPresets((rows.presets || []).filter((p) => p.machine_id === r.id));
    const invFor = (kind, name) => {
      const g = sets.find((s) => s.kind === KIND_TO_DB[kind]);
      if (!g) return null;
      const id = invIdFor(r.id, kind);
      if (!res.inventories.some((x) => x.id === id)) {
        const n = parseNotes(g.notes);
        res.inventories.push({ id, name: n.name || `${name} ${kind} gears`, ...(n.note ? { note: n.note } : {}), gears: teethToGears(g.teeth, g.notes) });
      }
      return id;
    };
    const fixTrain = (t, fallback, name) => {
      if (typeof t.inventory === 'string' && t.inventory.startsWith(OWN)) {
        const id = invFor(t.inventory.slice(OWN.length), name);
        if (id) t.inventory = id; else if (fallback !== undefined) t.inventory = fallback; else delete t.inventory;
      }
    };
    if (f.app === APP_TAG && f.builtin) {
      const b = builtins.find((x) => x.id === f.builtin);
      if (!b) { res.skipped.push(r.name); continue; }
      const key = machineKey(b);
      res.rowIdByKey[key] = r.id;
      const trains = clone((f.override && f.override.trains) || {});
      for (const [i, t] of Object.entries(trains)) fixTrain(t, undefined, b.name);
      res.builtinOverrides[b.id] = { trains, ...(presets.length ? { indexPresets: presets } : {}) };
    } else if (f.app === APP_TAG && f.def && f.def.id) {
      const def = clone(f.def);
      def.name = r.name; def.builtin = false; delete def.lock;
      if (f.locked === true) def.lock = { locked: true, lockedAt: f.lockedAt || null, lockedBy: f.lockedBy || null };
      if (r.notes !== null && r.notes !== undefined) def.description = r.notes;
      const own = {};
      for (const t of def.trains || []) { const wasOwn = typeof t.inventory === 'string' && t.inventory.startsWith(OWN); fixTrain(t, 'legacy-20-88', def.name); if (wasOwn && t.inventory.startsWith('cg-')) own[t.kind] = t.inventory; }
      if (Object.keys(own).length) def.ownInventories = own;
      if (presets.length) def.indexPresets = presets;
      res.rowIdByKey[machineKey(def)] = r.id;
      res.machines.push(def);
    } else res.skipped.push(r.name);
  }
  res.machines.sort((a, b) => a.name.localeCompare(b.name));
  return res;
}
