// help-practice.js - "Try it" boxes on help.html. Runs only in this browser with the app's own engine
// (formula.js via calc.js, search.js). No sign-in, no database, no keys, nothing sent anywhere.
import * as calc from './calc.js';

const $ = (id) => document.getElementById(id);
const show = (el, ok, html) => { el.className = 'try-result ' + (ok ? 'ok' : 'bad'); el.innerHTML = ''; const b = document.createElement('b'); b.textContent = ok ? 'Correct. ' : 'Incorrect. '; el.append(b, document.createTextNode(html)); };
const num = (s) => { const t = String(s).trim().replace(',', '.'); return t !== '' && Number.isFinite(Number(t)) ? Number(t) : NaN; };

// Evaluate one formula with the real engine (double precision); throws with the engine's own message.
export function evalFormula(expr, vars) {
  const names = Object.keys(vars);
  const def = { id: 'try', name: 'try', numeric: 'float64', inputs: names.map((n) => ({ name: n, label: n })), constants: [],
    formulas: [{ name: 'RESULT', expr }], outputs: [{ name: 'RESULT' }], trains: [], report: [] };
  const c = calc.compileMachine(def);
  if (!c.ok) throw new Error(c.errors.map((e) => e.msg).join('; '));
  const r = calc.evaluateMachine(def, Object.fromEntries(names.map((n) => [n, String(vars[n])])), { compiled: c });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return Number(r.num.format(r.env.get('RESULT')));
}

// ---- a. write a formula
const FORMULA_TASKS = {
  idx30: { text: 'Index ratio for a machine whose index constant is 30. Inputs: K (hob starts) and Z (teeth).', ref: '30 * K / Z', vars: ['K', 'Z'],
    samples: [{ K: 1, Z: 40 }, { K: 2, Z: 101 }, { K: 3, Z: 17 }] },
  diffm: { text: 'Differential ratio for a metric module cutter: machine constant O = 11.9367, inputs B (helix angle, degrees), D (normal module) and K (hob starts). Hint: use SIND for degrees.', ref: '11.9367 * SIND(B) / D / K', vars: ['B', 'D', 'K'],
    samples: [{ B: 30, D: 8, K: 1 }, { B: 22.5, D: 3, K: 2 }, { B: 12, D: 5, K: 1 }] },
  rpm: { text: 'Hob RPM from surface feet SF and hob diameter DA in inches.', ref: 'SF / (DA * PI / 12)', vars: ['SF', 'DA'],
    samples: [{ SF: 100, DA: 3 }, { SF: 250, DA: 2.75 }] },
};
export function checkFormula(taskId, expr) {
  const t = FORMULA_TASKS[taskId];
  if (!String(expr).trim()) return { ok: false, msg: `Type a formula. One right answer: ${t.ref}` };
  try { calc.parseFormula(expr); } catch (e) { return { ok: false, msg: `The formula does not parse: ${e.message}${e.pos !== undefined ? ` (at character ${e.pos + 1})` : ''}. One right answer: ${t.ref}` }; }
  for (const s of t.samples) {
    let got;
    try { got = evalFormula(expr, s); } catch (e) { return { ok: false, msg: `${e.message}. Use only the names ${t.vars.join(', ')}. One right answer: ${t.ref}` }; }
    const want = evalFormula(t.ref, s);
    if (!(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)))) {
      const at = Object.entries(s).map(([k, v]) => `${k} = ${v}`).join(', ');
      return { ok: false, msg: `With ${at} your formula gives ${got}, the right value is ${want}. One right answer: ${t.ref}` };
    }
  }
  return { ok: true, msg: `It matches ${t.ref} on ${t.samples.length} test cases (the app accepts it exactly like that).` };
}

// ---- b. compute a ratio
const RATIO_TASKS = {
  idx101: { text: 'Index: constant 24, hob starts K = 1, part has Z = 101 teeth. Ratio = 24 × K ÷ Z.', expr: '24 * K / Z', vars: { K: 1, Z: 101 } },
  idx40k2: { text: 'Index: constant 24, hob starts K = 2, part has Z = 40 teeth.', expr: '24 * K / Z', vars: { K: 2, Z: 40 } },
  diff: { text: 'Differential (Fauter style, metric): O = 11.9367, helix B = 30°, normal module D = 8, K = 1. Ratio = O × sin(B) ÷ D ÷ K.', expr: '11.9367 * SIND(B) / D / K', vars: { B: 30, D: 8, K: 1 } },
};
export const RATIO_TOL = 0.0001; // relative (0.01 %)
export function checkRatio(taskId, answer) {
  const t = RATIO_TASKS[taskId];
  const want = evalFormula(t.expr, t.vars);
  const a = num(answer);
  if (Number.isNaN(a)) return { ok: false, msg: `Enter a number. The right ratio is ${want.toFixed(7)}.`, want };
  const err = (a - want) / want;
  if (Math.abs(err) <= RATIO_TOL) return { ok: true, msg: `${want.toFixed(7)} (yours is within ${(Math.abs(err) * 100).toFixed(4)} %).`, want };
  return { ok: false, msg: `The right ratio is ${want.toFixed(7)}; yours is off by ${(err * 100).toFixed(4)} % (allowed ±${RATIO_TOL * 100} %). Check the order: multiply by K, divide by Z${taskId === 'diff' ? ', and use degrees for sin' : ''}.`, want };
}

// ---- c. pick gears
export const GEAR_RULES = { min: 20, max: 88, maxEach: 4, tol: 0.0001 };
const GEAR_TASKS = {
  diff: { text: 'Find A/B × C/D for the differential ratio 0.74604375 (Fauter, helix 30°, module 8, 1 start).', target: 11.9367 * Math.sin(Math.PI / 6) / 8 },
  idx47: { text: 'Find A/B × C/D for the index ratio of 24 ÷ 47 (z = 47, 1 start).', target: 24 / 47 },
};
export function checkGears(taskId, A, B, C, D) {
  const t = GEAR_TASKS[taskId];
  const inv = Array.from({ length: GEAR_RULES.max - GEAR_RULES.min + 1 }, (_, i) => ({ teeth: GEAR_RULES.min + i, qty: GEAR_RULES.maxEach }));
  const best = calc.rankedSearch(t.target, inv, { gears: 4, maxResults: 1 })[0];
  const right = `One right answer: ${best.A}/${best.B} × ${best.C}/${best.D} = ${best.ratio.toFixed(8)} (error ${(best.err * 100).toFixed(5)} %).`;
  const g = [A, B, C, D].map((x) => num(x));
  if (g.some((x) => !Number.isInteger(x))) return { ok: false, msg: `Enter whole tooth counts for A, B, C and D. ${right}` };
  const out = g.filter((x) => x < GEAR_RULES.min || x > GEAR_RULES.max);
  if (out.length) return { ok: false, msg: `Only gears with ${GEAR_RULES.min}-${GEAR_RULES.max} teeth are in this practice gear box (you used ${out.join(', ')}). ${right}` };
  const count = {}; g.forEach((x) => { count[x] = (count[x] || 0) + 1; });
  const over = Object.entries(count).filter(([, n]) => n > GEAR_RULES.maxEach);
  if (over.length) return { ok: false, msg: `The box has only ${GEAR_RULES.maxEach} of each gear. ${right}` };
  const ratio = (g[0] / g[1]) * (g[2] / g[3]);
  const err = (ratio - t.target) / t.target;
  if (Math.abs(err) <= GEAR_RULES.tol) return { ok: true, msg: `${g[0]}/${g[1]} × ${g[2]}/${g[3]} = ${ratio.toFixed(8)}, error ${(err * 100).toFixed(5)} % (allowed ±${GEAR_RULES.tol * 100} %).` };
  return { ok: false, msg: `${g[0]}/${g[1]} × ${g[2]}/${g[3]} = ${ratio.toFixed(8)}, error ${(err * 100).toFixed(5)} % - more than the allowed ±${GEAR_RULES.tol * 100} %. ${right}` };
}

// ---- wire up the page
function fillSelect(sel, tasks, textEl) {
  sel.replaceChildren(...Object.entries(tasks).map(([k, t]) => { const o = document.createElement('option'); o.value = k; o.textContent = t.text.split(/\.\s|\s\(/)[0]; return o; }));
  const upd = () => { textEl.textContent = tasks[sel.value].text; };
  sel.addEventListener('change', upd); upd();
}
if (typeof document !== 'undefined' && $('try-formula')) {
  fillSelect($('tf-task'), FORMULA_TASKS, $('tf-text'));
  $('tf-check').addEventListener('click', () => { const r = checkFormula($('tf-task').value, $('tf-input').value); show($('tf-result'), r.ok, r.msg); });
  fillSelect($('tr-task'), RATIO_TASKS, $('tr-text'));
  $('tr-check').addEventListener('click', () => { const r = checkRatio($('tr-task').value, $('tr-input').value); show($('tr-result'), r.ok, r.msg); });
  fillSelect($('tg-task'), GEAR_TASKS, $('tg-text'));
  $('tg-check').addEventListener('click', () => { const r = checkGears($('tg-task').value, ...['A', 'B', 'C', 'D'].map((k) => $('tg-' + k).value)); show($('tg-result'), r.ok, r.msg); });
  document.body.dataset.practiceReady = '1';
}
