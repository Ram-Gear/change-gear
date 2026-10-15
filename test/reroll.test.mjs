// v1.8.4 reroll: next batches of distinct trains, same ranking order, first batch unchanged.
import assert from 'node:assert/strict';
const calc = await import('../js/calc.js');
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const inv = calc.BUILTIN_INVENTORIES.find((x) => x.id === 'legacy-20-88').gears;
const small = [20, 24, 30, 36, 40, 45, 48, 50, 60, 72].map((t) => ({ teeth: t, qty: 1 }));
for (const [target, gears, n, tol, label] of [[0.74604375, inv, 4, undefined, 'diff 20-88'], [24 / 101, inv, 4, undefined, 'index z=101'], [0.6, small, 4, undefined, 'small box'], [0.6, small, 2, undefined, '2-gear'], [0.74604375, small, 4, 0.02, 'tolerance 2 %']]) {
  const o = { gears: n, maxResults: 20, tolerance: tol };
  const shown = new Set(); const all = [];
  let b = calc.rankedNextBatch(target, gears, o, shown);
  ok(JSON.stringify(b.list) === JSON.stringify(calc.rankedSearch(target, gears, o)), `${label}: first batch identical to rankedSearch`);
  let rounds = 0;
  while (b.list.length && rounds < 60) {
    for (const r of b.list) { const k = calc.trainKey(r, n); ok(!shown.has(k), `${label}: no repeat (${k})`); shown.add(k); all.push(r); }
    if (b.exhausted) break;
    b = calc.rankedNextBatch(target, gears, o, shown); rounds++;
  }
  for (let i = 1; i < all.length; i++) ok(Math.abs(all[i].err) >= Math.abs(all[i - 1].err) - 1e-15, `${label}: ranking order continues`);
  const big = calc.rankedSearch(target, gears, { ...o, maxResults: all.length });
  ok(JSON.stringify(big.map((r) => calc.trainKey(r, n)).sort()) === JSON.stringify(all.map((r) => calc.trainKey(r, n)).sort()) || rounds >= 60, `${label}: batches = top ${all.length} of one big search`);
  if (rounds < 60) { const after = calc.rankedNextBatch(target, gears, o, shown); ok(after.list.length === 0, `${label}: runs out (${all.length} trains)`); }
  console.log(`${label}: ${all.length} distinct trains in ${rounds + 1} batch(es)${rounds >= 60 ? ' (stopped after 60)' : ''}`);
}
// runTrain with opts.shown (what the app calls)
const m = calc.BUILTIN_MACHINES.find((x) => x.id === 'tos-fo10-diff');
const res = calc.evaluateMachine(m, { B: '30', D: '8', K: '1', Q: '1', Z: '40' });
for (const t of m.trains.filter((x) => x.strategy === 'ranked')) {
  const tr = { ...t, strategy: 'ranked' };
  const a = calc.runTrain(res, tr), s = new Set();
  const b1 = calc.runTrain(res, tr, undefined, { shown: s });
  ok(JSON.stringify(a.list) === JSON.stringify(b1.list), `FO-10 ${t.kind}: app first batch unchanged`);
  b1.list.forEach((r) => s.add(calc.trainKey(r, tr.gears || 4)));
  const b2 = calc.runTrain(res, tr, undefined, { shown: s });
  ok(b2.list.length > 0 && b2.list.every((r) => !s.has(calc.trainKey(r, tr.gears || 4))), `FO-10 ${t.kind}: second batch all new`);
}
// legacy: batch 2 continues the original order exactly (20 more from the same generator, no repeats)
const R = res.env.get('R'); const first40 = calc.legacyFirstN(R, res.num, 40, { maxD: 120 });
const g = calc.runTrain(res, { ...m.trains[0], strategy: 'legacy-ramgear' }, undefined, { maxD: 120 }).gen; const got = [];
for (let r = g.next(); !r.done && got.length < 40; r = g.next()) if (!r.value.progress) got.push(r.value);
ok(JSON.stringify(got.slice(0, 20).map((v) => [v.A, v.B, v.C, v.D])) === JSON.stringify(first40.slice(0, 20).map((v) => [v.A, v.B, v.C, v.D])), 'legacy: first 20 = original order');
ok(JSON.stringify(got.slice(20).map((v) => [v.A, v.B, v.C, v.D])) === JSON.stringify(first40.slice(20).map((v) => [v.A, v.B, v.C, v.D])), 'legacy: next 20 continue the original order');
ok(new Set(got.map((v) => `${v.A},${v.B},${v.C},${v.D}`)).size === got.length, 'legacy: no repeats');
console.log(`reroll: ${pass} checks passed`);
