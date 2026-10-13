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
  assert.ok(csv.startsWith('z,A,B,C,D,note'));
  const p = P.parsePresetCsv(csv);
  assert.equal(p.header, true); assert.deepEqual(p.rows.map(({ line, ...x }) => x), list);
  const q = P.parsePresetCsv('40;30;50;40;40;x\n101;24;101;;;\nbad;1;2\n57;20;57;30\n');
  assert.equal(q.rows.length, 2); assert.equal(q.bad.length, 2);
});
await t('bundle: presets on machines + built-in overrides survive export/import; bad presets dropped', () => {
  const m = calc.newMachineTemplate(); m.name = 'P'; m.indexPresets = [{ z: 101, A: 24, B: 101 }, { z: 'x', A: 1, B: 2 }];
  const b = calc.makeBundle({ machines: [m], builtinOverrides: { 'tos-fo10-diff': { indexPresets: [{ z: 101, A: 24, B: 101, note: 'n' }] } } });
  const r = calc.parseBundle(JSON.stringify(b));
  assert.equal(r.machines[0].indexPresets.length, 1); assert.equal(r.errors.length, 1);
  assert.equal(r.builtinOverrides['tos-fo10-diff'].indexPresets[0].note, 'n');
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
console.log(fails ? `${fails} FAILED` : 'presets: ALL PASSED');
process.exitCode = fails ? 1 : 0;
