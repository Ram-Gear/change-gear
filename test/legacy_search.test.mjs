// Compares the JS legacy change-gear search (first 3 matches, search depth up to
// D = 40) with test/basic/legacy_search_ref.py, a literal transliteration of the
// BASIC GOTO logic running on PC-BASIC's MBF arithmetic. Needed ratios come from
// random inputs to the built-in feed/differential machines.
//   node test/legacy_search.test.mjs           (uses cached fixture)
//   node test/legacy_search.test.mjs --regen   (re-runs the Python reference, ~minutes)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as calc from '../js/calc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures/legacy_search_ref.json');
const PY = path.resolve(here, '../../.venv/bin/python');
let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const dec = (a, b, d) => (a + rnd() * (b - a)).toFixed(d);
const items = [];
const ids = ['bc-feed', 'fd500-diff', 'fauter-diff', 'tos-ofa71a-diff', 'fd320-diff', 'tos-fo10-diff'];
for (let i = 0; items.length < 150 && i < 5000; i++) {
  const id = ids[i % ids.length];
  const metric = rnd() < 0.5;
  const inputs = id === 'bc-feed' ? { CC: dec(1, 6, 2), CP: dec(.1, 1.2, 4), B: dec(5, 45, 2) } : { B: dec(1, 45, 2), D: metric ? dec(1, 10, 1) : String(Math.floor(2 + rnd() * 30)), K: rnd() < .8 ? '1' : '2', Q: metric ? 1 : 0 };
  const r = calc.runMachine(id, inputs);
  const R = r.env.get('R');
  // keep ratios whose first 3 matches lie within D <= 40 so the slow Python reference finishes
  const first = calc.legacyFirstN(R, r.num, 3, { maxD: 40 });
  if (first.length < 3) continue;
  items.push({ id: `${id}-${i}`, machine: id, inputs, R, rhex: calc.mbf.toHex(R) });
}
if (process.argv.includes('--regen') || !fs.existsSync(FIX)) {
  const out = execFileSync(PY, [path.join(here, 'basic/legacy_search_ref.py'), '3', '40', '4'], { input: JSON.stringify(items.map(({ id, rhex }) => ({ id, rhex }))), maxBuffer: 1 << 26 });
  fs.writeFileSync(FIX, out);
}
const ref = new Map(JSON.parse(fs.readFileSync(FIX, 'utf8')).map((x) => [x.id, x]));
let cases = 0, matches = 0, bad = 0;
for (const it of items) {
  const r = calc.runMachine(it.machine, it.inputs);
  const got = calc.legacyFirstN(it.R, r.num, 3, { maxD: 40 });
  const exp = ref.get(it.id).matches;
  cases++;
  const same = got.length === exp.length && got.every((g, k) => g.A === exp[k].A && g.B === exp[k].B && g.C === exp[k].C && g.D === exp[k].D && g.pos === exp[k].pos && calc.mbf.toHex(g.RN) === exp[k].rn);
  if (!same) { bad++; console.log('MISMATCH', it.id, JSON.stringify(it.inputs), JSON.stringify(got.map((g) => [g.A, g.B, g.C, g.D, g.pos])), JSON.stringify(exp)); }
  else matches += got.length;
}
console.log(`Legacy search vs BASIC-logic reference: ${cases} ratios, ${matches} matches compared (bit-exact ratio + same A,B,C,D + same loop position), ${bad} mismatches`);
if (bad) process.exitCode = 1;
