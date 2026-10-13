// v1.5: simple Index / Differential setup and gear-list CSV import. Run: node test/simple_csv.test.mjs
import assert from 'node:assert/strict';
import * as calc from '../js/calc.js';
const { simple, gearcsv } = calc;
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n   ', e.message); } };
const inv = [{ id: '__own__', name: 'own', gears: Array.from({ length: 69 }, (_, i) => ({ teeth: 20 + i, qty: 1 })) }];

t('new machine template: index 24*K/Z and Fauter-like differential', () => {
  const m = calc.newMachineTemplate();
  assert.ok(calc.compileMachine(m).ok);
  assert.deepEqual(m.inputs.map((i) => i.name), ['Z', 'K', 'B', 'D', 'Q']);
  const r = calc.runMachine(m, { Z: '40', K: '1', B: '30', D: '8', Q: 1 });
  assert.ok(r.ok, String(r.errors));
  assert.equal(r.num.toJS(r.env.get('RIDX')), 0.6);
  const f = calc.runMachine('fauter-diff', { B: '30', D: '8', K: '1', Q: 1 });
  assert.ok(Math.abs(r.num.toJS(r.env.get('RDIFF')) - f.num.toJS(f.env.get('R'))) < 1e-6);
  const ri = r.num.toJS(r.env.get('RIDX'));
  for (const kind of ['index', 'differential']) {
    const tr = calc.runTrain(r, simple.trainOf(m, kind), inv);
    assert.ok(tr.list.length > 0, kind);
  }
  assert.ok(ri);
});
t('remove and re-add sections', () => {
  const m = calc.newMachineTemplate();
  simple.removeSection(m, 'index');
  assert.ok(!simple.trainOf(m, 'index')); assert.ok(!m.inputs.some((i) => i.name === 'Z'));
  assert.ok(calc.compileMachine(m).ok);
  simple.removeSection(m, 'differential');
  assert.equal(m.inputs.length, 0); assert.equal(m.formulas.length, 0);
  simple.addIndex(m, '30');
  const r = calc.runMachine(m, { Z: '60', K: '2' });
  assert.equal(r.num.toJS(r.env.get('RIDX')), 1);
});
t('copy of Fauter + index keeps the Fauter differential result exactly', () => {
  const b = calc.BUILTIN_MACHINES.find((x) => x.id === 'fauter-diff');
  const m = JSON.parse(JSON.stringify(b)); m.id = 'custom-x'; m.builtin = false;
  assert.equal(simple.sectionInfo(m, 'differential').constant.name, 'O');
  simple.addIndex(m);
  const inp = { B: '22.5', D: '3', K: '1', Q: 1, Z: '40' };
  const r = calc.runMachine(m, inp), f = calc.runMachine('fauter-diff', inp);
  assert.equal(r.num.format(r.env.get('R')), f.num.format(f.env.get('R')));
  assert.deepEqual(r.reportText, f.reportText);
  assert.equal(r.num.format(r.env.get('RIDX')).trim(), '.6');
});
t('copy of FO-10: index constant pulled into a box, same result', () => {
  const b = calc.BUILTIN_MACHINES.find((x) => x.id === 'tos-fo10-diff');
  const m = simple.normalizeIndex(JSON.parse(JSON.stringify(b)));
  assert.equal(simple.sectionInfo(m, 'index').constant.expr, '24');
  const inp = { B: '30', D: '8', K: '3', Q: 1, Z: '41' };
  const r = calc.runMachine({ ...m, id: 'c', builtin: false }, inp), f = calc.runMachine('tos-fo10-diff', inp);
  assert.equal(r.num.format(r.env.get('RIDX')), f.num.format(f.env.get('RIDX')));
});
t('CSV: header, qty default, notes, quotes', () => {
  const p = gearcsv.parseGearCsv('\uFEFFteeth,qty,note\r\n20,2,spare\r\n24\r\n30,,"worn, ok"\r\n');
  assert.ok(p.header); assert.equal(p.bad.length, 0);
  assert.deepEqual(p.rows.map(({ teeth, qty, note }) => [teeth, qty, note]), [[20, 2, 'spare'], [24, 1, ''], [30, 1, 'worn, ok']]);
});
t('CSV: single column, no header; semicolons (Excel); bad rows flagged', () => {
  assert.deepEqual(gearcsv.parseGearCsv('20\n24\n\n36\n').rows.map((r) => r.teeth), [20, 24, 36]);
  const s = gearcsv.parseGearCsv('Teeth;Qty;Note\n40;3;\n44;x;\nabc;1\n0;1\n48;1;new');
  assert.equal(s.sep, ';'); assert.deepEqual(s.rows.map((r) => [r.teeth, r.qty]), [[40, 3], [48, 1]]);
  assert.deepEqual(s.bad.map((b) => b.line), [3, 4, 5]);
  const q = gearcsv.parseGearCsv('Qty,Teeth\n2,50\n');
  assert.deepEqual(q.rows.map((r) => [r.teeth, r.qty]), [[50, 2]]);
});
t('CSV: export round trip, sample parses, merge adds quantities', () => {
  const g = [{ teeth: 20, qty: 2, note: 'a, b' }, { teeth: 31, qty: 1 }];
  assert.deepEqual(gearcsv.parseGearCsv(gearcsv.gearsToCsv(g)).rows.map(({ teeth, qty, note }) => ({ teeth, qty, ...(note ? { note } : {}) })), g);
  const s = gearcsv.parseGearCsv(gearcsv.SAMPLE_CSV); assert.equal(s.bad.length, 0); assert.ok(s.rows.length >= 5);
  assert.deepEqual(gearcsv.mergeGears([{ teeth: 20, qty: 1 }], [{ teeth: 20, qty: 2 }, { teeth: 22, qty: 1 }]), [{ teeth: 20, qty: 3 }, { teeth: 22, qty: 1 }]);
  assert.deepEqual(calc.validateInventory({ id: 'x', name: 'x', gears: g }), []);
});
console.log(fails ? `${fails} FAILED` : 'all simple/csv tests passed');
process.exitCode = fails ? 1 : 0;
