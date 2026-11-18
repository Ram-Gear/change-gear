// v1.6: index gear presets (pure logic) and bundle export/import of presets + manuals. Run: node test/presets.test.mjs
import assert from 'node:assert/strict';
import * as calc from '../js/calc.js';
import { blobToBase64, base64ToBlob } from '../js/manuals.js';
const P = calc.presets;
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n   ', e.message); } };
const inv2088 = Array.from({ length: 69 }, (_, i) => ({ teeth: 20 + i, qty: 1 }));

await t('isPrime', () => { assert.deepEqual([1, 2, 3, 4, 97, 101, 102, 121].map(P.isPrime), [false, true, true, false, true, true, false, false]); });
await t('cleanPreset: 4-gear, 2-gear, bad', () => {
  assert.deepEqual(P.cleanPreset({ z: '101', A: '24', B: '101', C: '', D: '', note: ' x ' }), { preset: { z: 101, A: 24, B: 101, note: 'x' }, errors: [] });
  assert.equal(P.cleanPreset({ z: 40, A: 30, B: 50, C: 40, D: 40 }).preset.D, 40);
  assert.ok(P.cleanPreset({ z: 40, A: 30, B: 50, C: 40 }).errors.length);
  assert.ok(P.cleanPreset({ z: 'x', A: 30, B: 50 }).errors.length);
});
await t('ratio / error: 24/101 for z=101 is exact', () => {
  const p = { z: 101, A: 24, B: 101 };
  assert.equal(P.presetRatio(p), 24 / 101);
  assert.equal(P.presetError(p, 24 / 101), 0);
  assert.equal(P.presetRatio({ A: 30, B: 50, C: 40, D: 40 }), 0.6);
});
await t('prime hint', () => {
  const h = P.primeHint(101, inv2088, []);
  assert.equal(h, 'z = 101 is prime – you need a 101-tooth gear (or a multiple); add a preset.');
  assert.equal(P.primeHint(101, inv2088, [{ z: 101, A: 24, B: 101 }]), null, 'preset exists');
  assert.equal(P.primeHint(101, [...inv2088, { teeth: 101, qty: 1 }], []), null, 'inventory has 101');
  assert.equal(P.primeHint(37, inv2088, []), null, '37 is in the 20-88 list');
  assert.equal(P.primeHint(100, inv2088, []), null, 'not prime');
  assert.equal(P.primeHint(43, [{ teeth: 86, qty: 1 }, { teeth: 20, qty: 1 }], []), null, 'multiple of z');
});
await t('presetFromMatch / upsert / presetsFor', () => {
  let l = P.upsertPreset([], P.presetFromMatch(40, { A: 30, B: 50, C: 40, D: 40 }));
  l = P.upsertPreset(l, { z: 101, A: 24, B: 101, note: 'prime' });
  l = P.upsertPreset(l, { z: 40, A: 30, B: 50, C: 40, D: 40, note: 'again' });
  assert.equal(l.length, 2); assert.equal(l[0].note, 'again'); assert.equal(P.presetsFor(l, 101)[0].B, 101);
});
await t('CSV round trip + bad rows + header-less + semicolons', () => {
  const list = [{ z: 40, A: 30, B: 50, C: 40, D: 40, note: 'a, b' }, { z: 101, A: 24, B: 101, note: '' }];
  const csv = P.presetsToCsv(list);
  assert.ok(csv.startsWith('z,A,B,C,D,E,F,note'));
  const p = P.parsePresetCsv(csv);
  // v1.8.12: export writes E/F (42/42 for presets without E/F), so they come back with an explicit 42/42
  assert.equal(p.header, true); assert.deepEqual(p.rows.map(({ line, ...x }) => x), list.map((x) => ({ ...x, E: 42, F: 42 })));
  const q = P.parsePresetCsv('40;30;50;40;40;x\n101;24;101;;;\nbad;1;2\n57;20;57;30\n');
  assert.equal(q.rows.length, 2); assert.equal(q.bad.length, 2);
});
// ---------------------------------------------------------------- v1.8.12 reversing gears E/F
await t('E/F: three pairs, labels, default 42/42 for old presets', () => {
  assert.deepEqual(P.EF_PAIRS, [[56, 28], [42, 42], [28, 56]]);
  assert.deepEqual(P.EF_PAIRS.map(([e, f]) => P.efLabel(e, f)), ['56/28 (2:1)', '42/42 (1:1)', '28/56 (1:2)']);
  for (const old of [{ z: 17, A: 48, B: 80, C: 80, D: 34 }, { z: 37, A: 48, B: 80, C: 80, D: 74 }, { z: 13, A: 24, B: 13 }]) {
    assert.deepEqual(P.efOf(old), { E: 42, F: 42 });
    const c = P.cleanPreset(old); assert.deepEqual(c.errors, []); assert.equal('E' in c.preset, false, 'old preset gets no E/F written');
    assert.ok(P.presetText(old).endsWith(' × 42/42'));
  }
});
await t('E/F: cleanPreset accepts the 3 pairs, refuses others and half-filled', () => {
  for (const [E, F] of [[56, 28], [42, 42], [28, 56]]) assert.deepEqual(P.cleanPreset({ z: 45, A: 48, B: 70, C: 70, D: 45, E, F }).preset.E, E);
  assert.equal(P.cleanPreset({ z: 45, A: 48, B: 70, C: 70, D: 45, E: '28', F: '56' }).preset.F, 56);
  for (const bad of [{ E: 21, F: 63 }, { E: 28 }, { F: 56 }, { E: 'x', F: 56 }, { E: 56, F: 56 }]) assert.ok(P.cleanPreset({ z: 45, A: 48, B: 70, C: 70, D: 45, ...bad }).errors.some((e) => /E\/F/.test(e)), JSON.stringify(bad));
});
await t('E/F: ratio, num/den and exact integer check use A/B x C/D x E/F (FD-500 table IV.7)', () => {
  // FD-500 manual p.63: z = 45 -> a 48, b = c 70, d 45, e 28, f 56; a/b x c/d x e/f = 24 k / z (k = 1)
  const p45 = { z: 45, A: 48, B: 70, C: 70, D: 45, E: 28, F: 56 };
  assert.ok(Math.abs(P.presetRatio(p45) - 24 / 45) < 1e-15);
  const { num, den } = P.presetNumDen(p45); assert.equal(num * 45, den * 24, 'A*C*E*z = B*D*F*24');
  const exact = calc.exactCheck({ p: 24n, q: 45n });
  assert.equal(exact(num, den), true);
  const nd11 = P.presetNumDen({ ...p45, E: 42, F: 42 }); assert.equal(exact(nd11.num, nd11.den), false, 'same gears at 1:1 are not exact');
  const p12 = { z: 12, A: 48, B: 80, C: 80, D: 48, E: 56, F: 28 }; // table: z = 12 -> 48/80 x 80/48, e/f 56/28
  const nd = P.presetNumDen(p12); assert.equal(calc.exactCheck({ p: 2n, q: 1n })(nd.num, nd.den), true, '24/12 = 2');
  assert.equal(P.presetError(p45, 24 / 45), 0);
  assert.equal(P.presetRatio({ A: 30, B: 50, C: 40, D: 40 }), 0.6, 'missing E/F = 1:1');
});
await t('E/F: presetFromMatch default 42/42, chosen pair, refuses others; upsert keys on E/F', () => {
  const m = { A: 48, B: 70, C: 70, D: 45 };
  assert.deepEqual([P.presetFromMatch(45, m).E, P.presetFromMatch(45, m).F], [42, 42]);
  const p = P.presetFromMatch(45, m, '', 'x', [28, 56]); assert.deepEqual([p.E, p.F, p.label], [28, 56, 'x']);
  assert.throws(() => P.presetFromMatch(45, m, '', '', [21, 63]));
  let l = P.upsertPreset([], P.presetFromMatch(45, m, '', '', [42, 42]));
  l = P.upsertPreset(l, P.presetFromMatch(45, m, '', '', [28, 56]));
  assert.equal(l.length, 2, 'different E/F = different preset');
  l = P.upsertPreset([{ z: 45, ...m, note: 'old' }], P.presetFromMatch(45, m, 'new', '', [42, 42]));
  assert.equal(l.length, 1, 'old preset without E/F = same as 42/42 (replaced, not duplicated)');
});
await t('E/F CSV: new format both ways, old format (header and header-less) = 42/42, bad pair refused', () => {
  const list = [{ z: 45, A: 48, B: 70, C: 70, D: 45, E: 28, F: 56, note: 'tbl', label: 'z45' }, { z: 12, A: 48, B: 80, C: 80, D: 48, E: 56, F: 28, note: '' }, { z: 101, A: 24, B: 101, E: 42, F: 42, note: '' }];
  const csv = P.presetsToCsv(list);
  assert.equal(csv.split('\r\n')[0], 'z,A,B,C,D,E,F,note,name');
  assert.equal(csv.split('\r\n')[1], '45,48,70,70,45,28,56,tbl,z45');
  assert.deepEqual(P.parsePresetCsv(csv).rows.map(({ line, ...x }) => x), list);
  const oldH = P.parsePresetCsv('z,A,B,C,D,note,name\r\n17,48,80,80,34,from v1.8.11,FD17\r\n');
  assert.deepEqual(oldH.rows.map(({ line, ...x }) => x), [{ z: 17, A: 48, B: 80, C: 80, D: 34, note: 'from v1.8.11', label: 'FD17' }]);
  assert.deepEqual(P.efOf(oldH.rows[0]), { E: 42, F: 42 });
  const oldNoH = P.parsePresetCsv('17,48,80,80,34,old note\n101,24,101,,,prime\n');
  assert.equal(oldNoH.rows.length, 2); assert.equal(oldNoH.rows[0].note, 'old note'); assert.equal(oldNoH.rows[0].E, undefined);
  const newNoH = P.parsePresetCsv('45;48;70;70;45;28;56;n\n');
  assert.deepEqual([newNoH.rows[0].E, newNoH.rows[0].F, newNoH.rows[0].note], [28, 56, 'n']);
  const blank = P.parsePresetCsv('z,A,B,C,D,E,F,note\n37,48,80,80,74,,,blank ef\n');
  assert.equal(blank.rows[0].E, undefined, 'blank E/F = 42/42');
  const bad = P.parsePresetCsv('z,A,B,C,D,E,F,note\n45,48,70,70,45,21,63,x\n45,48,70,70,45,28,,y\n');
  assert.equal(bad.rows.length, 0); assert.equal(bad.bad.length, 2); assert.ok(/E\/F/.test(bad.bad[0].reason));
});
await t('E/F stored in cg_presets.result (no schema change); old rows without E/F load as 42/42', async () => {
  const { presetsToRows, rowsToPresets } = await import('../js/cgmap.js');
  const rows = presetsToRows([{ z: 45, A: 48, B: 70, C: 70, D: 45, E: 28, F: 56, note: '', label: 'n' }, { z: 17, A: 48, B: 80, C: 80, D: 34, note: '' }]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['inputs', 'name', 'result']);
  assert.deepEqual([rows[0].result.E, rows[0].result.F, rows[0].result.name], [28, 56, 'n']);
  assert.equal('E' in rows[1].result, false, 'old preset row unchanged (no E/F keys)');
  const back = rowsToPresets(rows); assert.deepEqual([back[1].E, back[1].F], [28, 56]); assert.equal(back[0].E, undefined);
  const v1811 = rowsToPresets([{ name: 'z=37', inputs: { z: 37 }, result: { A: 48, B: 80, C: 80, D: 74, note: '' } }]);
  assert.deepEqual(P.efOf(v1811[0]), { E: 42, F: 42 });
});
await t('bundle: presets on machines + built-in overrides survive export/import; bad presets dropped', () => {
  const m = calc.newMachineTemplate(); m.name = 'P'; m.indexPresets = [{ z: 101, A: 24, B: 101 }, { z: 'x', A: 1, B: 2 }];
  const b = calc.makeBundle({ machines: [m], builtinOverrides: { 'hob-rpm-time': { indexPresets: [{ z: 101, A: 24, B: 101, note: 'n' }] } } });
  const r = calc.parseBundle(JSON.stringify(b));
  assert.equal(r.machines[0].indexPresets.length, 1); assert.equal(r.errors.length, 1);
  assert.equal(r.builtinOverrides['hob-rpm-time'].indexPresets[0].note, 'n');
  assert.equal(b.manuals, undefined, 'no manuals key unless asked');
});
await t('bundle: manuals base64 round trip', async () => {
  const pdf = new Blob(['%PDF-1.4\n%test\n'], { type: 'application/pdf' });
  const data = await blobToBase64(pdf);
  const b = calc.makeBundle({ manuals: { 'tos-fo10-diff': { name: 'fo10.pdf', type: 'application/pdf', size: pdf.size, data } } });
  const r = calc.parseBundle(JSON.stringify(b));
  assert.equal(await base64ToBlob(r.manuals['tos-fo10-diff'].data).text(), '%PDF-1.4\n%test\n');
  const bad = calc.parseBundle(JSON.stringify({ ...b, manuals: { x: { data: '!!' } } }));
  assert.equal(Object.keys(bad.manuals).length, 0); assert.ok(bad.errors.length);
});
// ---------------------------------------------------------------- v1.8.13 E/F only where the machine has it (not Lees Bradner)
await t('machineHasEF: off only for Lees Bradner (id, name, noEF flag); on for FD-500, FO-10, others', () => {
  assert.equal(P.machineHasEF({ id: 'custom-tiblpjl', name: 'Lees Bradner' }), false);
  assert.equal(P.machineHasEF({ id: 'custom-p3bks4m', name: 'Lees Bradner (fixed draft)' }), false);
  assert.equal(P.machineHasEF({ id: 'custom-tiblpjl', name: 'renamed' }), false, 'locked original by id');
  assert.equal(P.machineHasEF({ id: 'custom-x', name: 'Other', noEF: true }), false, 'explicit noEF flag');
  assert.equal(P.machineHasEF({ id: 'custom-uzp78zx', name: 'Overton FD-500' }), true);
  assert.equal(P.machineHasEF({ id: 'custom-z7dft19', name: 'TOS FO-10' }), true);
  assert.equal(P.machineHasEF({ id: 'custom-q', name: 'New machine' }), true);
  assert.equal(P.machineHasEF({ id: 'custom-q', name: 'Fleeson' }), true, 'whole word only');
  assert.equal(P.machineHasEF({ id: 'custom-tiblpjl', name: 'Lees Bradner', hasEF: true }), true, 'explicit hasEF wins');
});
await t('hasEF=false: stored E/F ignored (1:1) for ratio, exact num/den, text; no E/F on new presets', () => {
  const p = { z: 45, A: 48, B: 70, C: 70, D: 45, E: 28, F: 56 };
  assert.equal(P.presetText(p, false), '48/70 × 70/45');
  assert.equal(P.presetText(p), '48/70 × 70/45 × 28/56', 'default unchanged (v1.8.12)');
  const nd = P.presetNumDen(p, false); assert.equal(nd.num * 45, nd.den * 48, 'whole-number ratio = 48/45 (E/F as 42/42)');
  assert.ok(Math.abs(P.presetRatio(p, false) - 48 / 45) < 1e-12);
  assert.ok(Math.abs(P.presetError(p, 48 / 45, false)) < 1e-12);
  const n = P.presetFromMatch(18, { A: 45, B: 54, C: 40, D: 80 }, '', 'x', null, false);
  assert.equal('E' in n || 'F' in n, false);
  assert.deepEqual(P.cleanPreset({ z: 1, A: 2, B: 3, E: 21, F: 63 }, false), { preset: { z: 1, A: 2, B: 3, note: '' }, errors: [] }, 'bad pair dropped, no error');
  assert.equal(P.cleanPreset({ z: 1, A: 2, B: 3, E: 28, F: 56 }, false).preset.E, 28, 'valid stored pair carried along untouched');
});
await t('hasEF=false CSV: export old layout without E,F; import ignores E,F columns', () => {
  const csv = P.presetsToCsv([{ z: 18, A: 45, B: 54, C: 40, D: 80, note: 'n', label: 'L', E: 28, F: 56 }], false);
  assert.equal(csv, 'z,A,B,C,D,note,name\r\n18,45,54,40,80,n,L\r\n');
  const back = P.parsePresetCsv(csv, false); assert.deepEqual(back.rows.map(({ line, ...x }) => x), [{ z: 18, A: 45, B: 54, C: 40, D: 80, note: 'n', label: 'L' }]);
  const ef = P.parsePresetCsv('z,A,B,C,D,E,F,note,name\r\n50,48,70,70,50,28,56,a,b\r\n51,48,70,70,51,21,63,c,d\r\n', false);
  assert.equal(ef.rows.length, 2); assert.equal(ef.bad.length, 0); assert.equal('E' in ef.rows[0], false); assert.equal(ef.rows[1].note, 'c');
  assert.ok(P.presetsToCsv([{ z: 1, A: 2, B: 3 }]).startsWith('z,A,B,C,D,E,F,note,name'), 'default export unchanged');
});
console.log(fails ? `${fails} FAILED` : 'presets: ALL PASSED');
process.exitCode = fails ? 1 : 0;
