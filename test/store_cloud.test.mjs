// v1.7: shared-database mapping (cgmap.js) and store.js against an in-memory Supabase fake (no network).
import assert from 'node:assert/strict';
await import('./mock_supabase.js');
const makeMockFactory = globalThis.makeCgMock;
const mem = {}; globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const calc = await import('../js/calc.js');
const M = await import('../js/cgmap.js');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; };
const B = calc.BUILTIN_MACHINES;

// ---- gear list encoding
const gears = [{ teeth: 20, qty: 2, note: 'worn' }, { teeth: 24, qty: 1 }, { teeth: 30, qty: 0, note: 'on order' }, { teeth: 101, qty: 1 }];
eq(M.gearsToTeeth(gears), [20, 20, 24, 101], 'teeth repeated by qty, qty 0 left out');
const notes = M.gearsToNotes({ name: 'FO-10 index gears', gears });
eq(M.teethToGears(M.gearsToTeeth(gears), notes), gears, 'gear list round trip incl. notes and qty 0');
eq(M.teethToGears([40, 40], 'plain text'), [{ teeth: 40, qty: 2 }], 'non-JSON notes tolerated');
// ---- presets
const pre = [{ z: 101, A: 24, B: 101, note: 'prime' }, { z: 40, A: 30, B: 40, C: 32, D: 40, note: '' }, { z: 40, A: 24, B: 40, note: 'alt' }];
const pr = M.presetsToRows(pre);
eq(pr.map((r) => r.name), ['z=101', 'z=40', 'z=40#2'], 'preset names');
eq(pr[0].inputs, { z: 101 }); eq(pr[0].result, { A: 24, B: 101, C: null, D: null, note: 'prime' });
eq(M.rowsToPresets(pr), [pre[1], pre[2], pre[0]].map((p) => ({ ...p })), 'preset round trip (sorted by z)');

// ---- whole data set round trip
const fo10 = B.find((m) => m.id === 'tos-fo10-diff');
const custom = { id: 'm-abc', name: 'Pfauter P400', description: 'test', builtin: false, inputs: [{ name: 'Z', label: 'z' }, { name: 'K', label: 'K' }], constants: [{ name: 'KIDX', expr: '24' }],
  formulas: [{ name: 'RIDX', expr: 'KIDX * K / Z' }], outputs: [{ name: 'RIDX' }], report: [],
  trains: [{ kind: 'index', label: 'Index', ratio: 'RIDX', strategy: 'ranked', inventory: 'inv-1', gears: 4, maxResults: 20 }],
  ownInventories: { index: 'inv-1' }, indexPresets: [{ z: 101, A: 24, B: 101, note: '' }] };
const data = { machines: [custom], inventories: [{ id: 'inv-1', name: 'Pfauter P400 index gears', gears }, { id: 'inv-2', name: 'FO-10 diff box', gears: [{ teeth: 50, qty: 3 }] }, { id: 'inv-loose', name: 'spare', gears: [{ teeth: 77, qty: 1 }] }],
  builtinOverrides: { 'tos-fo10-diff': { trains: { 0: { inventory: 'inv-2', strategy: 'ranked' } }, indexPresets: [{ z: 97, A: 24, B: 97, note: '' }] }, 'fd500-diff': { trains: {} } } };
const r = M.toRemote(data, B);
eq(Object.keys(r.machines).sort(), ['b:tos-fo10-diff', 'c:m-abc'], 'empty built-in override makes no row');
eq(r.machines['b:tos-fo10-diff'].name, fo10.name, 'built-in row keyed by its name');
eq(r.machines['c:m-abc'].formulas.def.trains[0].inventory, '@own:index');
ok(!('indexPresets' in r.machines['c:m-abc'].formulas.def), 'presets not duplicated into formulas');
eq(r.gearSets['c:m-abc|indexing'].teeth, [20, 20, 24, 101]);
eq(r.gearSets['b:tos-fo10-diff|differential'].teeth, [50, 50, 50]);
eq(r.localInventories.map((x) => x.id), ['inv-loose'], 'unused gear list stays local');
eq(data.machines[0].trains[0].inventory, 'inv-1', 'toRemote does not mutate the app data');
// simulate rows coming back
let id = 0; const rows = { machines: [], gearSets: [], presets: [] }; const ids = {};
for (const [k, m] of Object.entries(r.machines)) { ids[k] = 'id' + (++id); rows.machines.push({ id: ids[k], deleted_at: null, ...m }); }
for (const g of Object.values(r.gearSets)) rows.gearSets.push({ id: 'g' + (++id), machine_id: ids[g.key], kind: g.kind, teeth: g.teeth, notes: g.notes });
for (const p of Object.values(r.presets)) rows.presets.push({ id: 'p' + (++id), machine_id: ids[p.key], name: p.name, inputs: p.inputs, result: p.result });
rows.machines.push({ id: 'x', name: 'Old gone', deleted_at: '2026-01-01', formulas: {} }, { id: 'y', name: 'Not ours', deleted_at: null, formulas: { foo: 1 } });
const back = M.fromRemote(rows, B);
eq(back.skipped, ['Not ours']);
eq(back.machines.length, 1);
eq(back.machines[0].trains[0].inventory, `cg-${ids['c:m-abc']}-index`);
eq(back.machines[0].ownInventories, { index: `cg-${ids['c:m-abc']}-index` });
eq(back.machines[0].indexPresets, custom.indexPresets);
eq(back.builtinOverrides['tos-fo10-diff'].trains[0], { inventory: `cg-${ids['b:tos-fo10-diff']}-differential`, strategy: 'ranked' });
eq(back.inventories.find((x) => x.id.endsWith('-index')).gears, gears);
eq(back.inventories.find((x) => x.id.endsWith('-index')).name, 'Pfauter P400 index gears');
// stable: mapping the loaded data again gives the same rows
const again = M.toRemote({ ...back, inventories: back.inventories }, B);
eq(JSON.stringify(again.machines), JSON.stringify(r.machines), 'stable machines');
eq(JSON.stringify(again.gearSets), JSON.stringify(r.gearSets), 'stable gear sets');
eq(JSON.stringify(again.presets), JSON.stringify(r.presets), 'stable presets');
// calculations identical after a round trip
const inputs = { Z: '101', K: '1' };
const r1 = calc.evaluateMachine(custom, inputs), r2 = calc.evaluateMachine(back.machines[0], inputs);
eq(r2.num.format(r2.env.get('RIDX')), r1.num.format(r1.env.get('RIDX')), 'same ratio after round trip');

// ---- store.js with the fake Supabase
const users = { gary: { pin: '4321', role: 'admin' }, vic: { pin: '1111', role: 'viewer' }, nora: { pin: '2222', role: 'none' }, newbie: { pin: '3333', role: 'viewer', active: false } };
const db = { cg_machines: [], cg_gear_sets: [], cg_presets: [] };
async function freshStore(session) {
  const log = [];
  globalThis.__CG_SUPABASE_MOCK__ = makeMockFactory({ users, db, log, session });
  const s = await import('../js/store.js?' + Math.random());
  return { s, log };
}
{
  const { s } = await freshStore(null);
  eq(s.usernameToEmail('  Gary '), 'u67617279@users.invalid', 'QC email rule');
  eq(s.usernameToEmail('José'), 'u6a6f73c3a9@users.invalid', 'utf-8 hex');
  const a = await s.init(B, calc.REMOVED_BUILTIN_IDS);
  ok(!a.signedIn && !a.canView, 'not signed in -> no access');
  await assert.rejects(() => s.load(), /Not signed in/); pass++;
  await assert.rejects(() => s.signIn('gary', '0000'), /Wrong username or PIN/); pass++;
}
{ // wrong pin -> activate attempted once -> retry not made when activate fails
  const { s, log } = await freshStore(null);
  await s.init(B);
  await assert.rejects(() => s.signIn('vic', '9'), /Wrong/); pass++;
  eq(log.filter((l) => l.auth === 'signIn').length, 1, 'no retry after failed activate');
  eq(log.filter((l) => l.fn === 'rg-admin').map((l) => l.body), [{ action: 'activate', username: 'vic', password: 'rg1:9' }]);
}
{ // first sign-in of a not-yet-activated account: activate then retry once
  const { s, log } = await freshStore(null);
  await s.init(B);
  const a = await s.signIn('Newbie', '3333');
  ok(a.canView && !a.canEdit && a.role === 'viewer', 'activated viewer');
  eq(log.filter((l) => l.auth === 'signIn').length, 2);
}
{ // role none
  const { s } = await freshStore(null);
  await s.init(B);
  const a = await s.signIn('nora', '2222');
  ok(a.signedIn && !a.canView && a.role === 'none', 'role none cannot view');
}
let adminData;
{ // admin writes
  const { s, log } = await freshStore(null);
  await s.init(B);
  const a = await s.signIn('gary', '4321');
  ok(a.canEdit && a.canDelete && a.role === 'admin');
  const d = await s.load();
  eq(d.machines, []);
  d.machines.push(JSON.parse(JSON.stringify(custom))); d.inventories.push(...JSON.parse(JSON.stringify(data.inventories)));
  d.builtinOverrides = JSON.parse(JSON.stringify(data.builtinOverrides));
  d.lastInputs = { 'tos-fo10-diff': { B: '30' } };
  await s.save(d); await s.whenSynced();
  eq(db.cg_machines.map((m) => m.name).sort(), [fo10.name, 'Pfauter P400'].sort());
  eq(db.cg_gear_sets.length, 2); eq(db.cg_presets.map((p) => p.name).sort(), ['z=101', 'z=97']);
  const n = log.length;
  await s.save(d); await s.whenSynced();
  eq(log.length, n, 'no writes when nothing changed');
  // edit gear list, delete preset, rename machine
  d.inventories.find((x) => x.id === 'inv-1').gears.push({ teeth: 60, qty: 1 });
  d.builtinOverrides['tos-fo10-diff'].indexPresets = [];
  d.machines[0].name = 'Pfauter P400 #2';
  await s.save(d); await s.whenSynced();
  ok(db.cg_gear_sets.some((g) => g.teeth.includes(60)), 'gear list updated');
  eq(db.cg_presets.map((p) => p.name), ['z=101'], 'preset deleted');
  ok(db.cg_machines.some((m) => m.name === 'Pfauter P400 #2'), 'renamed');
  // delete machine -> soft delete, name freed, children removed; recreate same name works
  const before = db.cg_machines.length;
  d.machines = [];
  await s.save(d); await s.whenSynced();
  eq(db.cg_machines.length, before, 'soft delete keeps row');
  ok(db.cg_machines.find((m) => m.deleted_at).name.startsWith('Pfauter P400 #2 [deleted '), 'name freed');
  eq(db.cg_presets.length, 0); eq(db.cg_gear_sets.length, 1);
  d.machines.push({ ...JSON.parse(JSON.stringify(custom)), id: 'm-new', name: 'Pfauter P400 #2' });
  await s.save(d); await s.whenSynced();
  eq(db.cg_machines.filter((m) => !m.deleted_at && m.name === 'Pfauter P400 #2').length, 1, 'name reusable');
  eq(JSON.parse(localStorage.getItem('ramgear.changegear.v17.local')).lastInputs, { 'tos-fo10-diff': { B: '30' } }, 'last inputs local');
  eq(JSON.parse(localStorage.getItem('ramgear.changegear.v17.local')).inventories.map((x) => x.id), ['inv-loose'], 'loose list local');
  adminData = d;
}
{ // viewer: reads shared data, writes nothing
  const { s, log } = await freshStore({ username: 'vic' });
  const a = await s.init(B);
  ok(a.signedIn && a.username === 'vic' && a.canView && !a.canEdit, 'session restored as viewer');
  const d = await s.load();
  eq(d.machines.map((m) => m.name), ['Pfauter P400 #2']);
  ok(d.builtinOverrides['tos-fo10-diff'].trains[0].inventory.startsWith('cg-'), 'built-in gear list shared');
  const n = log.length;
  d.machines = []; d.builtinOverrides = {};
  await s.save(d); await s.whenSynced();
  eq(log.slice(n).filter((l) => l.op && l.op !== 'select').length, 0, 'viewer save sends no writes');
}
{ // RLS in the fake also blocks a viewer write directly
  const { s } = await freshStore({ username: 'vic' });
  const c = globalThis.__CG_SUPABASE_MOCK__();
  const r = await c.from('cg_machines').insert({ name: 'x', formulas: {} });
  eq(r.error.code, '42501');
}
{ // one-time upload of v1.6 browser data by an admin
  localStorage.setItem('ramgear.changegear.v1', JSON.stringify({ machines: [{ ...custom, id: 'm-old', name: 'Old PC machine' }], inventories: [data.inventories[0]], builtinOverrides: { 'fauter-diff': { trains: { 0: { inventory: 'inv-1', strategy: 'ranked' } } } }, lastInputs: {} }));
  const { s } = await freshStore({ username: 'gary' });
  await s.init(B);
  ok(s.hasLocalData() && !s.localDataUploaded());
  const d = await s.load();
  const n = await s.uploadLocalData(d);
  eq(n, { machines: 1, inventories: 1, builtins: 1 });
  ok(db.cg_machines.some((m) => m.name === 'Old PC machine' && !m.deleted_at));
  ok(db.cg_machines.some((m) => m.formulas.builtin === 'fauter-diff'));
  ok(s.localDataUploaded());
  const { s: sv } = await freshStore({ username: 'vic' }); await sv.init(B);
  await assert.rejects(() => sv.uploadLocalData({ machines: [], inventories: [], builtinOverrides: {}, lastInputs: {} }), /admin/); pass++;
}
{ // v1.8 draft -> Verify & lock -> frozen definition; gear lists still editable; delete train on draft; admin deletes locked machine
  const { s } = await freshStore({ username: 'gary' });
  await s.init(B);
  const d = await s.load();
  const dm = { ...JSON.parse(JSON.stringify(custom)), id: 'm-lock', name: 'Lock Test Hobber', ownInventories: { index: 'inv-L' } };
  dm.trains[0].inventory = 'inv-L';
  dm.trains.push({ kind: 'differential', label: 'Diff', ratio: 'RIDX', strategy: 'ranked', inventory: 'legacy-20-88', gears: 4, maxResults: 20 });
  d.machines.push(dm); d.inventories.push({ id: 'inv-L', name: 'Lock Test Hobber index gears', gears: [{ teeth: 24, qty: 1 }, { teeth: 101, qty: 1 }] });
  await s.save(d); await s.whenSynced();
  const row = () => db.cg_machines.find((m) => m.name === 'Lock Test Hobber' && !m.deleted_at);
  ok(row() && !row().formulas.locked, 'saved as draft (no lock)');
  // delete the differential train while still a draft
  dm.trains = dm.trains.filter((t) => t.kind !== 'differential');
  await s.save(d); await s.whenSynced();
  eq(row().formulas.def.trains.map((t) => t.kind), ['index'], 'train removed from draft');
  // lock
  dm.lock = { locked: true, lockedAt: '2026-10-14T15:00:00.000Z', lockedBy: 'gary' };
  await s.save(d); await s.whenSynced();
  eq([row().formulas.locked, row().formulas.lockedAt, row().formulas.lockedBy], [true, '2026-10-14T15:00:00.000Z', 'gary'], 'lock stored in formulas');
  ok(!('lock' in row().formulas.def), 'lock not duplicated inside def');
  // attempt to change formulas / constants / name of locked machine -> not written
  dm.formulas[0].expr = '99 * K / Z'; dm.constants[0].expr = '48'; dm.name = 'Renamed';
  await s.save(d); await s.whenSynced();
  eq(row().formulas.def.formulas[0].expr, 'KIDX * K / Z', 'locked formula unchanged in DB');
  eq(row().formulas.def.constants[0].expr, '24', 'locked constant unchanged');
  ok(db.cg_machines.some((m) => m.name === 'Lock Test Hobber' && !m.deleted_at), 'locked name unchanged');
  // gear list of a locked machine: edit, clear
  const gs = () => db.cg_gear_sets.find((g) => g.machine_id === row().id && g.kind === 'indexing');
  d.inventories.find((x) => x.id === 'inv-L').gears.push({ teeth: 60, qty: 2 });
  await s.save(d); await s.whenSynced();
  eq(gs().teeth, [24, 60, 60, 101], 'locked machine gear list editable');
  d.inventories.find((x) => x.id === 'inv-L').gears = [];
  await s.save(d); await s.whenSynced();
  eq(gs().teeth, [], 'gear list cleared');
  // delete the gear list entirely (app points the train at the built-in list)
  d.inventories = d.inventories.filter((x) => x.id !== 'inv-L'); dm.trains[0].inventory = 'legacy-20-88'; delete dm.ownInventories.index;
  await s.save(d); await s.whenSynced();
  ok(!gs(), 'gear list row deleted');
  eq(row().formulas.def.trains[0].inventory, 'legacy-20-88', 'locked train re-linked to built-in list');
  // reload: lock comes back
  const { s: s2 } = await freshStore({ username: 'vic' }); await s2.init(B);
  const dv = await s2.load();
  const lm = dv.machines.find((m) => m.name === 'Lock Test Hobber');
  eq(lm.lock, { locked: true, lockedAt: '2026-10-14T15:00:00.000Z', lockedBy: 'gary' }, 'viewer loads lock info');
  // viewer cannot delete
  const id = row().id;
  const c = globalThis.__CG_SUPABASE_MOCK__();
  eq((await c.from('cg_machines').delete().eq('id', id)).error.code, '42501', 'viewer delete refused by RLS');
  // admin deletes the locked machine
  const { s: s3 } = await freshStore({ username: 'gary' }); await s3.init(B);
  const d3 = await s3.load();
  d3.machines = d3.machines.filter((m) => m.name !== 'Lock Test Hobber');
  await s3.save(d3); await s3.whenSynced();
  ok(!row(), 'admin deleted locked machine (soft delete)');
  ok(db.cg_machines.some((m) => m.id === id && m.deleted_at), 'row soft-deleted');
}
console.log(`store_cloud: ${pass} checks passed`);
