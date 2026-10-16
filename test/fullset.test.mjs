// v1.8.5: FULL result-set comparison with the original program's search (A,B,C,D 20-88, .9999 <= PR <= 1.0001).
//  - differential (ranked default + legacy): every train BASIC accepts is offered by the app (every placement)
//  - index: only EXACT trains (Gary's rule) - all of them, checked with BigInt against a brute-force reference
import assert from 'node:assert/strict';
import * as calc from '../js/calc.js';
import { legacyRamgear } from '../js/search.js';
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const ALL = calc.BUILTIN_INVENTORIES.find((x) => x.id === 'legacy-20-88');
const tup = (v) => `${v.A}/${v.B}x${v.C}/${v.D}`;
const basicSet = (res, R) => { const out = []; for (const v of legacyRamgear(R, res.num, { maxD: 88 })) if (!v.progress && Math.max(v.A, v.B, v.C, v.D) <= 88) out.push(v); return out; };
const added = calc.newMachineTemplate(); // an added machine: index KIDX*K/Z, differential like Fauter
const own = [{ id: '__own__', name: 'own', gears: ALL.gears }];
const cases = [
  ['tos-fo10-diff', { B: '30', D: '8', K: '1', Q: '1', Z: '47' }], ['tos-fo10-diff', { B: '15', D: '10', K: '2', Q: '0', Z: '101' }], ['tos-fo10-diff', { B: '5', D: '4', K: '1', Q: '1', Z: '60' }],
  ['fauter-diff', { B: '22.5', D: '6', K: '1', Q: '1' }], ['fauter-diff', { B: '8', D: '12', K: '3', Q: '0' }],
  ['fd500-diff', { B: '18', D: '12', K: '1', Q: '0' }], ['fd500-diff', { B: '35', D: '2.5', K: '1', Q: '1' }],
  [added, { Z: '37', K: '1', B: '20', D: '5', Q: '1' }], [added, { Z: '72', K: '2', B: '12.5', D: '7', Q: '0' }],
];
for (const [mm, inp] of cases) {
  const m = typeof mm === 'string' ? calc.getBuiltin(mm) : mm; const name = typeof mm === 'string' ? mm : 'added machine';
  const res = calc.evaluateMachine(m, inp); if (!res.ok) { console.log(name, 'skip', res.errors); continue; }
  for (const t0 of m.trains) {
    const t = { ...t0, inventory: t0.inventory === '__own__' ? '__own__' : t0.inventory };
    const invs = [...calc.BUILTIN_INVENTORIES, ...own];
    const ratioName = String(t.ratio).toUpperCase(); const R = res.env.get(ratioName);
    const basic = basicSet(res, R); const label = `${name} ${JSON.stringify(inp)} ${t.kind}`;
    if (t.kind === 'differential') {
      const big = calc.rankedSearch(res.num.toJS(R), invs.find((x) => x.id === t.inventory).gears, { gears: 4, maxResults: basic.length * 2 + 50 });
      const have = new Set(big.map(tup)); const miss = basic.filter((v) => !have.has(tup(v)));
      ok(miss.length === 0, `${label}: ranked offers all ${basic.length} BASIC trains (missing ${miss.slice(0, 3).map(tup)})`);
      // and the reroll reaches them in batches of 20 (first 3 batches = the 60 best, all distinct)
      const shown = new Set(); const seen = [];
      for (let k = 0; k < 3; k++) { const b = calc.runTrain(res, t, invs, { shown }); b.list.forEach((v) => { ok(!shown.has(v.key), `${label}: no repeat`); shown.add(v.key); seen.push(v); }); }
      ok(JSON.stringify(seen.map(tup)) === JSON.stringify(big.slice(0, seen.length).map(tup)), `${label}: batches follow the ranking`);
      const leg = []; for (const v of calc.runTrain(res, { ...t, strategy: 'legacy-ramgear' }, invs, { maxD: 88 }).gen) if (!v.progress && Math.max(v.A, v.B, v.C, v.D) <= 88) leg.push(v);
      ok(JSON.stringify(leg.map(tup)) === JSON.stringify(basic.map(tup)), `${label}: legacy mode = BASIC set, same order (${basic.length})`);
      console.log(`${label}: BASIC ${basic.length} trains, all offered`);
    } else {
      const ex = calc.exactRatioOf(res, ratioName); ok(!ex.irrational, `${label}: index ratio is rational (${ex.text})`);
      const ref = []; // brute force, BigInt
      for (let D = 20; D <= 88; D++) for (let C = 20; C <= 88; C++) for (let B = 20; B <= 88; B++) { const num = BigInt(B * D) * ex.p; if (num % ex.q) continue; const ac = Number(num / ex.q); for (let A = 20; A <= 88; A++) if (A * C === ac) ref.push({ A, B, C, D }); }
      const all = calc.exactIndexSearch(ex, ALL.gears, { gears: 4 });
      ok(JSON.stringify(all.map(tup)) === JSON.stringify(ref.map(tup)), `${label}: exact list = brute-force reference (${ref.length})`);
      ok(all.every((v) => BigInt(v.A * v.C) * ex.q === BigInt(v.B * v.D) * ex.p), `${label}: every index train has zero error`);
      const bex = basic.filter((v) => BigInt(v.A * v.C) * ex.q === BigInt(v.B * v.D) * ex.p); const have = new Set(all.map(tup));
      ok(bex.every((v) => have.has(tup(v))), `${label}: every exact BASIC train is offered`);
      const tr = calc.runTrain(res, { ...t, inventory: 'legacy-20-88' }, invs); ok(tr.total === ref.length && tr.list.every((v) => v.err === 0), `${label}: app index list exact`);
      const leg = []; for (const v of calc.runTrain(res, { ...t, strategy: 'legacy-ramgear' }, invs, { maxD: 88 }).gen) if (!v.progress && Math.max(v.A, v.B, v.C, v.D) <= 88) leg.push(v);
      ok(JSON.stringify(leg.map(tup)) === JSON.stringify(bex.map(tup)), `${label}: legacy index = exact part of BASIC set`);
      console.log(`${label}: ratio ${ex.text}, BASIC accepts ${basic.length} (${basic.length - bex.length} not exact, dropped), app shows ${ref.length} exact`);
    }
  }
}
console.log(`fullset: ${pass} checks passed`);
