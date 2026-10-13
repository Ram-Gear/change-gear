// Unit tests: formula language, validation, BASIC semantics, searches, import/export.
import assert from 'node:assert/strict';
import * as calc from '../js/calc.js';

let n = 0, failed = 0;
function t(name, fn) {
  n++;
  try { fn(); } catch (e) { failed++; console.log(`FAIL ${name}\n   ${e.message}`); }
}
const evalExpr = (expr, numeric = 'gwbasic', inputs = {}) => {
  const def = { name: 'x', numeric, inputs: Object.keys(inputs).map((k) => ({ name: k })), formulas: [{ name: 'OUT#', expr }], outputs: [] };
  const r = calc.evaluateMachine(def, inputs);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.num.toJS(r.env.get('OUT#'));
};
const errorsOf = (def) => calc.compileMachine({ name: 'x', ...def }).errors.map((e) => e.msg).join(' | ');

// --- parsing & precedence (BASIC rules)
t('precedence', () => {
  assert.equal(evalExpr('1 + 2 * 3'), 7);
  assert.equal(evalExpr('(1 + 2) * 3'), 9);
  assert.equal(evalExpr('-2 ^ 2'), -4);          // BASIC: ^ binds tighter than unary minus
  assert.equal(evalExpr('2 ^ 3 ^ 2'), 64);       // BASIC: left associative
  assert.equal(evalExpr('2 ^ -1'), 0.5);
  assert.equal(evalExpr('10 / 4 * 2'), 5);
  assert.equal(evalExpr('8 - 3 - 2'), 3);
});
t('comparisons and IF', () => {
  assert.equal(evalExpr('3 > 2'), -1);
  assert.equal(evalExpr('3 < 2'), 0);
  assert.equal(evalExpr('IF(2 = 2, 10, 20)'), 10);
  assert.equal(evalExpr('IF(2 <> 2, 10, 20)'), 20);
  assert.equal(evalExpr('IF(1, 5, 1 / 0)'), 5);  // lazy: other branch never evaluated
  assert.equal(evalExpr('IF(2 > 1 AND 3 > 2, 1, 0)'), 1);
  assert.equal(evalExpr('IF(NOT (2 > 1), 1, 0)'), 0);
});
t('INT FIX CINT ROUND like BASIC', () => {
  assert.equal(evalExpr('INT(-2.5)'), -3);
  assert.equal(evalExpr('FIX(-2.5)'), -2);
  assert.equal(evalExpr('CINT(2.5)'), 3);
  assert.equal(evalExpr('CINT(-2.5)'), -3);
  assert.equal(evalExpr('ROUND(1234567.5#)'), 1234568);
  assert.throws(() => evalExpr('CINT(40000)'), /Overflow/);
});
t('trig in degrees and radians', () => {
  assert.ok(Math.abs(evalExpr('SIND(30)', 'float64') - 0.5) < 1e-12);
  assert.ok(Math.abs(evalExpr('SIN(PI / 6)', 'float64') - 0.5) < 1e-12);
  assert.ok(Math.abs(evalExpr('ATND(1)', 'float64') - 45) < 1e-12);
  assert.ok(Math.abs(evalExpr('ACOSD(0.5)', 'float64') - 60) < 1e-9);
  assert.equal(evalExpr('SQRT(16)', 'float64'), 4);
  assert.equal(evalExpr('MAX(3, 9, 4) + MIN(3, 9, 4)', 'float64'), 12);
});
t('single precision like the original', () => {
  // 1/3 in a single prints .3333334 (GW-BASIC/PC-BASIC MBF rounding); in a double .3333333333333333
  const r = calc.evaluateMachine({ name: 'x', formulas: [{ name: 'A', expr: '1 / 3' }, { name: 'B#', expr: '1# / 3' }], outputs: [] }, {});
  assert.equal(r.display.A.trim(), '.3333334');
  assert.equal(r.display['B#'].trim(), '.3333333333333333');
  assert.equal(calc.mbf.printNum(calc.mbf.fromRepr('1E7')), ' 1E+07 ');
  assert.equal(calc.mbf.printNum(calc.mbf.fromRepr('.0001')), ' .0001 ');
});
t('division by zero continues like GW-BASIC', () => {
  const r = calc.evaluateMachine({ name: 'x', inputs: [{ name: 'Z' }], formulas: [{ name: 'Q', expr: '1 / Z' }], outputs: [] }, { Z: '0' });
  assert.ok(r.ok);
  assert.deepEqual(r.warnings, ['Division by zero while working out Q']);
  assert.equal(r.display.Q.trim(), '1.701412E+38');
});

// --- validation
t('syntax errors', () => {
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: '2 * (3 + ' }] }), /Formula error/);
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: '2 $ 3' }] }), /Unexpected character/);
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: 'SIN 3' }] }), /needs brackets/);
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: 'IF(1, 2)' }] }), /takes 3 values/);
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: '' }] }), /empty/);
});
t('unknown names, reserved names, duplicates, text inputs', () => {
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: 'B + 1' }] }), /Unknown name "B"/);
  assert.match(errorsOf({ formulas: [{ name: 'SIN', expr: '1' }] }), /reserved/);
  assert.match(errorsOf({ inputs: [{ name: 'A' }], formulas: [{ name: 'a', expr: '1' }] }), /used twice/);
  assert.match(errorsOf({ inputs: [{ name: 'SO', type: 'text' }], formulas: [{ name: 'A', expr: 'SO * 2' }] }), /text field/);
  assert.match(errorsOf({ formulas: [{ name: '1A', expr: '1' }] }), /not a valid name/);
});
t('circular references', () => {
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: 'B + 1' }, { name: 'B', expr: 'C * 2' }, { name: 'C', expr: 'A' }] }), /Circular reference: A → B → C → A/);
  assert.match(errorsOf({ formulas: [{ name: 'A', expr: 'A + 1' }] }), /Circular/);
});
t('formulas may reference each other in any order', () => {
  const r = calc.evaluateMachine({ name: 'x', numeric: 'float64', inputs: [{ name: 'N' }], formulas: [{ name: 'C', expr: 'B * 2' }, { name: 'B', expr: 'A + 1' }, { name: 'A', expr: 'N * 10' }], outputs: [] }, { N: '3' });
  assert.equal(r.num.toJS(r.env.get('C')), 62);
});
t('built-in definitions compile and are read-only', () => {
  for (const m of calc.BUILTIN_MACHINES) assert.ok(calc.compileMachine(m).ok, m.id);
  assert.throws(() => { calc.BUILTIN_MACHINES[2].formulas[0].expr = 'x'; });
});

// --- searches
t('legacy search reproduces the original first answer', () => {
  const r = calc.runMachine('fd500-diff', { B: '30', D: '8', K: '1', Q: 0 });
  const [m1, m2] = calc.legacyFirstN(r.env.get('R'), r.num, 2);
  assert.deepEqual([m1.A, m1.B, m1.C, m1.D, m1.ratioText], [67, 78, 22, 20, '.9448718']);  // = PC-BASIC run of source.bas
  assert.deepEqual([m2.A, m2.B, m2.C, m2.D], [22, 78, 67, 20]);
  assert.equal(calc.legacyFirstN(calc.mbf.fromRepr('25'), r.num, 1).length, 0); // above 19.8: the original never stops
  assert.throws(() => calc.legacyFirstN(calc.mbf.fromRepr('0'), r.num, 1), /endless loop/);
});
t('ranked search equals brute force', () => {
  const inv = [20, 24, 25, 30, 32, 36, 40, 45, 48, 50, 55, 60, 64, 70, 72, 80, 90, 100].map((teeth) => ({ teeth, qty: teeth % 20 === 0 ? 2 : 1 }));
  for (const target of [0.3183, 0.9449, 1.5227, 2.2, 3.7]) {
    const got = calc.rankedSearch(target, inv, { gears: 4, maxResults: 5 });
    let best = Infinity;
    for (const a of inv) for (const b of inv) for (const c of inv) for (const d of inv) {
      const cnt = new Map();
      for (const g of [a, b, c, d]) cnt.set(g.teeth, (cnt.get(g.teeth) || 0) + 1);
      if ([...cnt].some(([tt, k]) => k > inv.find((g) => g.teeth === tt).qty)) continue;
      best = Math.min(best, Math.abs((a.teeth * c.teeth) / (b.teeth * d.teeth) / target - 1));
    }
    assert.ok(Math.abs(Math.abs(got[0].err) - best) < 1e-15, `target ${target}`);
    for (let i = 1; i < got.length; i++) assert.ok(Math.abs(got[i].err) >= Math.abs(got[i - 1].err));
  }
  const two = calc.rankedSearch(0.5, inv, { gears: 2, maxResults: 3 });
  assert.equal(two[0].err, 0);
});
t('bc-breakdown strategy still works for custom machines (Barber-Colman built-in removed in v1.3)', () => {
  const def = { id: 'custom-bc', name: 'BC copy', builtin: false, numeric: 'gwbasic', inputs: [{ name: 'HAND' }, { name: 'C' }, { name: 'N' }], constants: [],
    formulas: [{ name: 'L', expr: '15 * C' }, { name: 'M', expr: 'IF(HAND = 1, ((N * C) - 1), ((N * C) + 1))' }], outputs: [{ name: 'L' }, { name: 'M' }], report: [],
    trains: [{ kind: 'index', label: 'x', strategy: 'bc-breakdown', values: ['L', 'M'], from: 20, to: 120 }] };
  const r = calc.runMachine(def, { HAND: 1, C: '4', N: '40' });
  const tr = calc.runTrain(r, def.trains[0]);
  assert.equal(tr.tables[0].rows.length, 101);
  assert.deepEqual(tr.tables[0].rows.filter((x) => x.whole).map((x) => x.W), [20, 30, 60]);
});
t('removed built-ins: old backups import cleanly', () => {
  for (const id of ['bc-index', 'bc-feed', 'tos-ofa71a-diff', 'fd320-diff']) assert.ok(!calc.getBuiltin(id));
  assert.deepEqual(calc.BUILTIN_MACHINES.map((m) => m.id), ['fd500-diff', 'fauter-diff', 'tos-fo10-diff', 'hob-rpm-time']);
  const copy = { ...calc.newMachineTemplate(), id: 'custom-copyofa', name: 'TOS OFA-71A (copy)' };
  const old = { ...calc.makeBundle({ machines: [copy], inventories: [], builtinOverrides: {} }),
    builtinOverrides: { 'bc-index': { trains: { 0: { from: 30 } } }, 'fd320-diff': { trains: { 0: { strategy: 'ranked' } } }, 'fauter-diff': { trains: { 0: { strategy: 'ranked' } } } } };
  const p = calc.parseBundle(JSON.stringify(old));
  assert.ok(p.ok, p.errors.join());
  assert.deepEqual(Object.keys(p.builtinOverrides), ['fauter-diff']);
  assert.equal(p.machines[0].name, 'TOS OFA-71A (copy)');
});

// --- import / export
t('bundle round trip and validation', () => {
  const m = calc.newMachineTemplate();
  const inv = { id: 'inv-a', name: 'Box A', gears: [{ teeth: 20, qty: 2 }, { teeth: 40, qty: 1 }] };
  const b = calc.makeBundle({ machines: [m, calc.BUILTIN_MACHINES[0]], inventories: [inv], builtinOverrides: { 'fd500-diff': { trains: { 0: { strategy: 'ranked' } } } } });
  assert.equal(b.machines.length, 1); // built-ins are never exported, only their overrides
  const p = calc.parseBundle(JSON.stringify(b));
  assert.ok(p.ok, p.errors.join());
  assert.equal(p.machines[0].id, m.id);
  assert.equal(p.inventories[0].name, 'Box A');
  assert.equal(p.builtinOverrides['fd500-diff'].trains[0].strategy, 'ranked');
  const bad = calc.parseBundle(JSON.stringify({ ...b, machines: [{ ...m, formulas: [{ name: 'X', expr: 'X+1' }] }] }));
  assert.ok(!bad.ok && /Circular/.test(bad.errors.join()));
  assert.ok(!calc.parseBundle('{"hello":1}').ok);
});

console.log(`engine tests: ${n - failed}/${n} passed`);
if (failed) process.exitCode = 1;
