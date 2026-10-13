// End-to-end comparison: runs the ORIGINAL BASIC program (test/basic/ramgear_clean.bas,
// = source.bas minus the non-BASIC lines) in the PC-BASIC interpreter with scripted
// keyboard input, and compares every printed result line with what the JS engine
// (built-in machine definitions, same code path as the web app) produces.
//
//   node test/basic_compare.mjs            use cached transcripts (test/fixtures/transcripts)
//   node test/basic_compare.mjs --live     re-run PC-BASIC for every case (slow: gear searches)
//   options: --jobs=6  --only=fd500  --pcbasic=/path/to/pcbasic
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as calc from '../js/calc.js';
import { BUILTIN_MACHINES as V12_MACHINES } from './fixtures/machines_v1.2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const LIVE = !!args.live;
const JOBS = Number(args.jobs || 6);
const PCBASIC = args.pcbasic || path.resolve(here, '../../.venv/bin/pcbasic');
const BAS = path.join(here, 'basic/ramgear_clean.bas');
const TDIR = path.join(here, 'fixtures/transcripts');
fs.mkdirSync(TDIR, { recursive: true });

// ---------------------------------------------------------------- deterministic RNG
let seed = 20261006;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const rdec = (a, b, d) => (a + rnd() * (b - a)).toFixed(d).replace(/^0\./, '.');

// ---------------------------------------------------------------- expected output via JS
// all menus of the original, used only to keep the case generator's RNG sequence unchanged
const ALL_MODULES = { 1: 'bc-index', 2: 'bc-feed', 3: 'fd500-diff', 4: 'fauter-diff', 5: 'tos-ofa71a-diff', 6: 'fd320-diff', 7: 'tos-fo10-diff', 9: 'hob-rpm-time' };
const MODULE = { 3: 'fd500-diff', 4: 'fauter-diff', 7: 'tos-fo10-diff', 9: 'hob-rpm-time' };

function warnLines(res) { return res.warnings.map((w) => w.replace(/ while working out .*$/, '')); }

function buildCase(c) {
  // returns {keys:[...typed lines], expected:[...printed lines], gearMatches}
  const keys = [String(c.menu)];
  const exp = [];
  const def = calc.getBuiltin(MODULE[c.menu]);
  if (c.menu === 1) {
    keys.push(c.so, 'PART');
    if (c.hand === 1) keys.push('Y'); else keys.push('N', 'Y');
    keys.push(c.C, c.N);
    const r = calc.runMachine(def, { HAND: c.hand, C: c.C, N: c.N });
    exp.push(...warnLines(r), ...r.reportText);
    const num = r.num;
    const bd = calc.runTrain(r, def.trains[0]);
    const [Lt, Mt] = bd.tables;
    const zero = num.assign(num.fromInt(0), '!');
    let X = zero, W = zero, J = zero, H = zero;
    if (c.breakdown === 'Y') {
      keys.push('Y');
      exp.push(num.format(Lt.value) + ' ');
      let k;
      for (k = 0; k < Lt.rows.length; k++) {
        exp.push(Lt.rows[k].text);
        if (k === c.k1) { keys.push('Y'); break; }
        keys.push('N');
      }
      if (k === Lt.rows.length) { // ran off the end: W = 121, X = L/120
        X = Lt.rows[Lt.rows.length - 1].X; W = num.assign(num.fromInt(121), '!');
      } else { X = Lt.rows[k].X; W = num.assign(num.fromInt(Lt.rows[k].W), '!'); }
      exp.push(num.format(X) + ' ' + '*' + num.format(W) + ' ');
      exp.push('');
    } else if (c.breakdown === 'N') {
      keys.push('N', 'E'); // back to main menu, then exit
      return { keys, expected: exp.filter((l) => l !== '') };
    } else {
      keys.push('X'); // any other answer: skips straight to the M table with X = W = 0
    }
    exp.push(num.format(Mt.value) + ' ');
    let k;
    for (k = 0; k < Mt.rows.length; k++) {
      exp.push(Mt.rows[k].text);
      if (k === c.k2) { keys.push('Y'); break; }
      keys.push('N');
    }
    if (k === Mt.rows.length) { J = Mt.rows[Mt.rows.length - 1].X; H = num.assign(num.fromInt(121), '!'); }
    else { J = Mt.rows[k].X; H = num.assign(num.fromInt(Mt.rows[k].W), '!'); }
    const F = r.env.get('F');
    exp.push(num.format(X) + ' ' + '*' + num.format(W) + ' ', num.format(F) + ' ', calc.bcSummaryLine(num, X, W, J, H), num.format(F) + ' ');
    keys.push('E');
    return { keys, expected: exp.filter((l) => l !== '') };
  }
  let inputs;
  if (c.menu === 2) {
    keys.push(c.so, 'PART', c.CC, c.CP, c.B);
    inputs = { CC: c.CC, CP: c.CP, B: c.B };
  } else if (c.menu === 9) {
    const order = ['DA', 'HELIX', 'SF', 'NT', 'SN', 'FEED', 'LC', 'NC', 'NP', 'SETUP'];
    order.forEach((k) => keys.push(c[k]));
    inputs = Object.fromEntries(order.map((k) => [k, c[k]]));
  } else {
    keys.push(c.so, 'PART', c.B, c.D, c.K, c.Q);
    inputs = { B: c.B, D: c.D, K: c.K, Q: c.Q === 'M' ? 1 : 0 };
    if (c.menu === 7) inputs.Z = 40; // v1.4 index input: not in the BASIC, does not affect the differential
  }
  const r = calc.runMachine(def, inputs);
  if (!r.ok) throw new Error(`JS evaluation failed for ${c.id}: ${r.errors}`);
  exp.push(...warnLines(r));
  exp.push(...r.reportText.flatMap((t) => t.split('\n')));
  if (c.gear && def.trains.length) {
    keys.push('C');
    const t = calc.runTrain(r, { ...def.trains[0], strategy: 'legacy-ramgear' }); // BASIC search order (still selectable in the UI)
    for (let i = 0; i < c.gear; i++) {
      const m = t.gen.next().value;
      exp.push(...m.lines);
      keys.push(i < c.gear - 1 ? 'C' : 'E');
      c.pos = m.pos;
    }
  } else {
    keys.push('E');
  }
  return { keys, expected: exp.filter((l) => l !== '') };
}

// ---------------------------------------------------------------- transcript filtering
const SRC = fs.readFileSync(BAS, 'latin1');
const LITERALS = [...SRC.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim()).filter((s) => s.length > 2);
function keepLine(line) {
  if (line.trim() === '') return false;
  if (line.includes('?')) return false; // INPUT prompt + echoed answer
  if (line.trim() === 'PRINTING.......') return false;
  const t = line.trim();
  if (LITERALS.some((L) => L === t || (t.length >= 20 && L.startsWith(t)))) return false; // titles / wrapped prompts
  return true;
}
function resultLines(transcript) {
  return transcript.split(/\r?\n/).map((l) => l.replace(/\r$/, '')).filter(keepLine);
}

// ---------------------------------------------------------------- run PC-BASIC
function runBasic(c, keys, timeoutMs) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync('/tmp/rgcase-');
    const inp = path.join(dir, 'in.txt');
    fs.writeFileSync(inp, keys.map((k) => k + '\r').join(''));
    const p = spawn(PCBASIC, ['-n', '-q', `--input=${inp}`, `--lpt1=FILE:${path.join(dir, 'lpt.txt')}`, BAS], { cwd: dir });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString('latin1'); });
    p.stderr.on('data', (d) => { out += d.toString('latin1'); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, timeoutMs);
    p.on('close', (code, sig) => { clearTimeout(timer); fs.rmSync(dir, { recursive: true, force: true }); resolve({ out, timedOut: sig === 'SIGKILL' }); });
  });
}

// position (loop passes) of the n-th legacy match, used to keep PC-BASIC runs short
const GEAR_POS_LIMIT = Number(args.gearlimit || 100000);
function gearPos(c, n) {
  const def = V12_MACHINES.find((m) => m.id === ALL_MODULES[c.menu]);
  const inputs = c.menu === 2 ? { CC: c.CC, CP: c.CP, B: c.B } : { B: c.B, D: c.D, K: c.K, Q: c.Q === 'M' ? 1 : 0 };
  const r = calc.runMachine(def, inputs);
  if (!r.ok || !(r.num.toJS(r.env.get('R')) > 0)) return Infinity;
  const t = calc.runTrain(r, def.trains[0], undefined, { maxD: 30 });
  let m;
  for (let i = 0; i < n; i++) { m = t.gen.next().value; if (!m || m.pos > GEAR_POS_LIMIT) return Infinity; }
  return m.pos;
}

// ---------------------------------------------------------------- cases
function makeCases() {
  const cases = [];
  const so = () => String(rint(10000, 999999));
  // (1) Barber-Colman index
  const consts = ['1', '2', '3', '4', '5', '6', '8', '10', '2.5', '1.25', '7.5', '.5'];
  for (let i = 0; i < 36; i++) {
    const bd = i === 0 ? 'N' : i === 1 ? 'X' : 'Y';
    cases.push({ id: `m1-${i}`, menu: 1, so: so(), hand: i % 2 ? 1 : 2, C: pick(consts), N: String(rint(6, 160)), breakdown: bd, k1: i === 2 ? 999 : rint(0, 12), k2: i === 3 ? 999 : rint(0, 12) });
  }
  // (2) Barber-Colman feed
  for (let i = 0; i < 36; i++) {
    cases.push({ id: `m2-${i}`, menu: 2, so: so(), CC: pick(['1', '2', '.5', '1.5', '3', '2.25', '4']), CP: pick(['.3927', '.5236', '.7854', '.2618', rdec(.1, 1.5, 4), rdec(.1, 1, 3)]), B: pick([rdec(5, 45, 0), rdec(5, 45, 1), rdec(5, 45, 3), '15', '22.5', '30', '45']), gear: i < 8 ? 1 : 0 });
  }
  cases.push({ id: 'm2-zero-helix', menu: 2, so: so(), CC: '1', CP: '.5', B: '0', gear: 0 });
  for (const c of cases) if (c.menu === 2 && c.gear && gearPos(c, c.gear) > GEAR_POS_LIMIT) c.gear = 0;
  // extra feed cases chosen so the original program finds its first change gears quickly
  for (let i = 0, found = 0; found < 6 && i < 3000; i++) {
    const c = { id: `m2-g${found}`, menu: 2, so: so(), CC: pick(['1', '2', '.5', '1.5', '3', '2.25', '4', rdec(.5, 4, 2)]), CP: rdec(.05, 1.5, 4), B: rdec(5, 45, 2), gear: found === 0 ? 3 : 1 };
    if (gearPos(c, c.gear) <= GEAR_POS_LIMIT) { cases.push(c); found++; }
  }
  // (3)-(7) differentials
  for (const menu of [3, 4, 5, 6, 7]) {
    for (let i = 0; i < 36; i++) {
      const metric = i % 2 === 1;
      cases.push({
        id: `m${menu}-${i}`, menu, so: so(),
        B: pick([rdec(.5, 45, 0), rdec(.5, 45, 2), rdec(5, 40, 4), '10', '15', '20', '22.5', '25', '30', '35', '45', '12.3456789']),
        D: metric ? pick(['1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', rdec(1, 12, 2)]) : pick(['2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32', rdec(2, 32, 1)]),
        K: pick(['1', '1', '1', '2', '3']), Q: metric ? 'M' : pick(['I', 'I', 'm', 'X']),
        gear: i < 6 ? (i === 0 ? 3 : 1) : 0,
      });
    }
    cases.push({ id: `m${menu}-zero-helix`, menu, so: so(), B: '0', D: '8', K: '1', Q: 'I', gear: 0 });
    for (const c of cases) if (c.menu === menu && c.gear && gearPos(c, c.gear) > GEAR_POS_LIMIT) c.gear = 0;
    for (let i = 0, found = 0; found < 6 && i < 3000; i++) {
      const metric = i % 2 === 1;
      const c = { id: `m${menu}-g${found}`, menu, so: so(), B: rdec(1, 45, pick([0, 1, 2, 3])), D: metric ? rdec(1, 10, pick([0, 1, 2])) : String(rint(2, 32)), K: pick(['1', '1', '2']), Q: metric ? 'M' : 'I', gear: found === 0 ? 3 : 1 };
      if (gearPos(c, c.gear) <= GEAR_POS_LIMIT) { cases.push(c); found++; }
    }
  }
  // (9) hob rpm & time
  for (let i = 0; i < 36; i++) {
    cases.push({
      id: `m9-${i}`, menu: 9,
      DA: pick(['2.5', '3', '3.5', '4', '4.5', '5', rdec(1, 8, 3)]), HELIX: pick(['0', '15', '20', '22.5', '30', rdec(0, 45, 2)]),
      SF: pick(['80', '100', '120', '150', '200', '300', rdec(50, 400, 0)]), NT: String(rint(10, 200)), SN: pick(['1', '1', '2', '3']),
      FEED: pick(['.04', '.06', '.08', '.1', '.125', rdec(.01, .2, 3)]), LC: pick(['1', '1.5', '2', '3', '4.75', rdec(.25, 12, 3)]),
      NC: pick(['1', '1', '2', '3']), NP: pick(['1', '5', '10', '25', '100', String(rint(1, 500))]), SETUP: pick(['30', '45', '60', '90', '120', String(rint(0, 480))]),
    });
  }
  cases.push({ id: 'm9-zero-parts', menu: 9, DA: '3', HELIX: '20', SF: '100', NT: '40', SN: '1', FEED: '.08', LC: '2', NC: '1', NP: '0', SETUP: '60' });
  cases.push({ id: 'm9-big', menu: 9, DA: '.5', HELIX: '0', SF: '100', NT: '200', SN: '1', FEED: '.0001', LC: '120', NC: '9', NP: '5000', SETUP: '480' });
  // v1.3: menus 1, 2, 5, 6 removed at Gary's request. Cases are still generated (same RNG
  // sequence, so the cached transcripts stay valid) and then dropped.
  return cases.filter((c) => MODULE[c.menu]);
}

// ---------------------------------------------------------------- main
const only = args.only ? String(args.only) : null;
const cases = makeCases().filter((c) => (!only || c.id.startsWith(only) || MODULE[c.menu] === only) && !(args.nogear && c.gear) && !(args.gearonly && !c.gear));
const prepared = cases.map((c) => ({ c, ...buildCase(c) }));
const results = [];
let idx = 0;
async function worker() {
  while (idx < prepared.length) {
    const p = prepared[idx++];
    const file = path.join(TDIR, `${p.c.id}.txt`);
    let out;
    if (!LIVE && !fs.existsSync(file) && args.cachedonly) { results.push({ p, status: 'skip', why: 'no cached transcript' }); continue; }
    if (LIVE || !fs.existsSync(file)) {
      if (!fs.existsSync(PCBASIC)) { results.push({ p, status: 'skip', why: 'PC-BASIC not installed and no cached transcript' }); continue; }
      const timeout = 90000 + (p.c.pos || 0) * 8; // PC-BASIC needs ~3 ms per pass of the gear loop
      const r = await runBasic(p.c, p.keys, timeout);
      if (r.timedOut) { results.push({ p, status: 'timeout' }); continue; }
      out = r.out;
      fs.writeFileSync(file, `# keys: ${JSON.stringify(p.keys)}\n` + out);
    } else {
      out = fs.readFileSync(file, 'latin1').replace(/^# keys:.*\n/, '');
    }
    const got = resultLines(out);
    const exp = p.expected.filter(keepLine); // same filter on both sides
    let ok = got.length === exp.length && got.every((g, i) => g === exp[i]);
    results.push({ p, status: ok ? 'ok' : 'MISMATCH', got, exp });
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));

const byModule = {};
let bad = 0;
for (const r of results) {
  const m = MODULE[r.p.c.menu];
  byModule[m] = byModule[m] || { cases: 0, ok: 0, lines: 0, gearMatches: 0, mismatch: 0, other: 0 };
  const b = byModule[m];
  b.cases++;
  if (r.status === 'ok') { b.ok++; b.lines += r.exp.length; b.gearMatches += r.p.c.gear || 0; }
  else if (r.status === 'MISMATCH') {
    b.mismatch++; bad++;
    console.log(`\nMISMATCH ${r.p.c.id} keys=${JSON.stringify(r.p.keys)}`);
    const n = Math.max(r.got.length, r.exp.length);
    for (let i = 0; i < n; i++) if (r.got[i] !== r.exp[i]) console.log(`  line ${i + 1}\n    BASIC: ${JSON.stringify(r.got[i])}\n    JS:    ${JSON.stringify(r.exp[i])}`);
  } else { b.other++; console.log(`${r.status.toUpperCase()} ${r.p.c.id} ${r.why || ''}`); }
}
console.log('\nmodule               cases  identical  result-lines  gear-matches  mismatches  skipped/timeout');
for (const [m, b] of Object.entries(byModule)) console.log(`${m.padEnd(20)} ${String(b.cases).padStart(5)}  ${String(b.ok).padStart(9)}  ${String(b.lines).padStart(12)}  ${String(b.gearMatches).padStart(12)}  ${String(b.mismatch).padStart(10)}  ${String(b.other).padStart(15)}`);
if (bad) process.exitCode = 1;
