// search.js - change-gear search strategies.
//
//  legacy-ramgear : the original program's search (lines 10010-10384), same loop
//                   order, same single-precision arithmetic and the same
//                   .9999 <= (A/B*C/D)/R <= 1.0001 acceptance test, so the first
//                   match (and every "CONTINUE" match after it) is identical.
//  ranked         : searches a gear inventory (with quantities) and returns the
//                   best matches sorted by error.  2-gear (A/B) or 4-gear (A/B x C/D).
//  bc-breakdown   : Barber-Colman index "break the numbers down" table (lines 1430-1600).

// ---------------------------------------------------------------- legacy
export const LEGACY = { first: 20, wrap: 89, lv: '.9999', hv: '1.0001' };

// Order of evaluation of the original loop (A fastest, then B, C, D; the
// IF A=89 / IF B=89 / IF C=89 tests make (A=20,B=89) and (A=20,B=20,C=89)
// appear once per wrap, and D is never bounded).
function* legacyOrder(maxD, Rj, filterOk) {
  const F = 20, W = 89;
  for (let D = F; D <= maxD; D++) {
    if (Rj !== null) {
      if (Rj * 0.9997 > (W * W) / (F * D)) return; // no larger D can ever match
      if (Rj * 1.0003 < (F * F) / (W * D)) continue; // this D cannot match
    }
    for (let C = F; C < W; C++) {
      const skipC = Rj !== null && (Rj * 1.0003 < (F * C) / (W * D) || Rj * 0.9997 > (W * C) / (F * D));
      if (!skipC) {
        for (let B = F; B < W; B++) for (let A = F; A < W; A++) yield [A, B, C, D];
        yield [F, W, C, D];
      }
    }
    yield [F, F, W, D];
  }
}

// Returns a generator of matches. Each match: {A,B,C,D,RN,PR,ratioText,lines,errorPct}
export function* legacyRamgear(R, num, opts = {}) {
  const Rj = num.toJS(R);
  if (!(Rj > 0)) {
    throw new Error(Rj === 0
      ? 'Needed ratio is 0 - the original program would divide by zero forever (endless loop).'
      : 'Needed ratio is negative - the original program would search forever (endless loop). Enter the helix angle as a positive number.');
  }
  const maxD = opts.maxD || 5000;
  const inv = opts.inventory || null; // Map teeth -> qty, or null = original behaviour
  const S = (n) => num.assign(num.fromInt(n), '!');
  const LV = num.assign(num.lit(LEGACY.lv), '!');
  const HV = num.assign(num.lit(LEGACY.hv), '!');
  const qcache = new Map();
  const q = (a, b) => {
    const k = a * 100000 + b;
    let v = qcache.get(k);
    if (!v) { v = num.div(S(a), S(b)); qcache.set(k, v); }
    return v;
  };
  let evals = 0;
  const every = opts.yieldEvery || 0; // >0: also yield {progress:true} markers so a UI can stay responsive
  for (const [A, B, C, D] of legacyOrder(maxD, Rj)) {
    evals++;
    if (every && evals % every === 0) yield { progress: true, evals, A, B, C, D, pos: legacyPosition(A, B, C, D) };
    const approx = (A * C) / (B * D) / Rj;
    if (approx < 0.9997 || approx > 1.0003) continue; // cannot pass the exact test
    if (inv && !inventoryHas(inv, [A, B, C, D])) continue;
    const RN = num.assign(num.mul(q(A, B), q(C, D)), '!');
    const PR = num.assign(num.div(RN, R), '!');
    // 10090-10100: accept when PR = LV, or LV < PR and not PR > HV
    if (num.lt(PR, LV) || num.gt(PR, HV)) continue;
    yield {
      A, B, C, D, RN, PR, evals, pos: legacyPosition(A, B, C, D),
      ratioText: num.format(RN).trim(),
      errorPct: ((num.toJS(RN) / Rj) - 1) * 100,
      odd: [A, B, C, D].some((t) => t > 88) ? 'uses a gear outside 20-88 (quirk of the original loop)' : '',
      lines: [
        'NEEDED RATIO' + num.format(R) + ' ',
        '',
        'GEARTRAIN RATIO' + num.format(RN) + ' ',
        'A;' + num.format(S(A)) + ' ' + '  B;' + num.format(S(B)) + ' ' + '  C;' + num.format(S(C)) + ' ' + '  D;' + num.format(S(D)) + ' ',
      ],
    };
  }
}

// 1-based number of passes through the original loop (line 10050) up to this combination
const PER_C = 69 * 69 + 1, PER_D = 69 * PER_C + 1;
export function legacyPosition(A, B, C, D) {
  let p = (D - 20) * PER_D;
  if (C === 89) return p + 69 * PER_C + 1;
  p += (C - 20) * PER_C;
  if (B === 89) return p + 69 * 69 + 1;
  return p + (B - 20) * 69 + (A - 20) + 1;
}

function inventoryHas(inv, teeth) {
  const need = new Map();
  for (const t of teeth) need.set(t, (need.get(t) || 0) + 1);
  for (const [t, n] of need) if ((inv.get(t) || 0) < n) return false;
  return true;
}

export function legacyFirstN(R, num, n = 1, opts = {}) {
  const out = [];
  const it = legacyRamgear(R, num, opts);
  for (const m of it) { if (m.progress) continue; out.push(m); if (out.length >= n) break; }
  return out;
}

// ---------------------------------------------------------------- ranked
// gears: [{teeth, qty}] ; target: JS number ; returns sorted list
export function rankedSearch(target, gears, opts = {}) {
  const nGears = Number(opts.gears || 4);
  const maxResults = opts.maxResults || 20;
  const tol = opts.tolerance ? Number(opts.tolerance) : Infinity; // relative, e.g. 0.0001
  if (!(target > 0)) throw new Error('Needed ratio must be greater than 0');
  const inv = new Map();
  for (const g of gears || []) {
    const t = Math.round(Number(g.teeth));
    const qn = g.qty === undefined ? 1 : Math.max(0, Math.round(Number(g.qty)));
    if (t > 0 && qn > 0) inv.set(t, (inv.get(t) || 0) + qn);
  }
  const teeth = [...inv.keys()].sort((a, b) => a - b);
  if (teeth.length === 0) throw new Error('Inventory is empty');
  const pairs = [];
  for (const a of teeth) for (const b of teeth) {
    if (a === b && inv.get(a) < 2) continue;
    pairs.push({ a, b, r: a / b });
  }
  pairs.sort((x, y) => x.r - y.r);
  const best = []; // sorted by err asc
  const seen = new Set();
  let worst = Infinity;
  const consider = (A, B, C, D) => {
    const ratio = nGears === 2 ? A / B : (A * C) / (B * D);
    const err = ratio / target - 1;
    const ae = Math.abs(err);
    if (ae > tol || (best.length >= maxResults && ae >= worst)) return;
    if (nGears === 4 && !inventoryHas(inv, [A, B, C, D])) return;
    const key = nGears === 2 ? `${A}/${B}` : `${Math.min(A, C)},${Math.max(A, C)}/${Math.min(B, D)},${Math.max(B, D)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rec = nGears === 2 ? { A, B, ratio, err } : { A, B, C, D, ratio, err };
    let i = best.length;
    while (i > 0 && Math.abs(best[i - 1].err) > ae) i--;
    best.splice(i, 0, rec);
    if (best.length > maxResults) { const drop = best.pop(); seen.delete(keyOf(drop, nGears)); }
    if (best.length >= maxResults) worst = Math.abs(best[best.length - 1].err);
  };
  const lowerBound = (x) => { let lo = 0, hi = pairs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pairs[m].r < x) lo = m + 1; else hi = m; } return lo; };
  if (nGears === 2) {
    for (const p of pairs) consider(p.a, p.b);
  } else {
    for (const p of pairs) {
      const t = target / p.r;
      const i0 = lowerBound(t);
      for (let j = i0; j < pairs.length; j++) {
        if (best.length >= maxResults && pairs[j].r / t - 1 > worst) break;
        if (pairs[j].r / t - 1 > tol) break;
        consider(p.a, p.b, pairs[j].a, pairs[j].b);
      }
      for (let j = i0 - 1; j >= 0; j--) {
        if (best.length >= maxResults && 1 - pairs[j].r / t > worst) break;
        if (1 - pairs[j].r / t > tol) break;
        consider(p.a, p.b, pairs[j].a, pairs[j].b);
      }
    }
  }
  return best;
}
// v1.8.4 reroll: the next batch of distinct trains after the ones already shown (keys in `shown`), in the
// same ranking order. The first batch (empty `shown`) is exactly rankedSearch(target, gears, opts).
export function rankedNextBatch(target, gears, opts = {}, shown = new Set(), pageSize) {
  const n = Number(opts.gears || 4);
  const size = Number(pageSize || opts.maxResults || 20);
  let want = shown.size + size;
  for (;;) {
    const all = rankedSearch(target, gears, { ...opts, maxResults: want });
    const left = all.filter((r) => !shown.has(keyOf(r, n)));
    const done = all.length < want; // the search found fewer trains than asked for: nothing beyond these exists
    if (left.length >= size || done) return { list: left.slice(0, size), exhausted: done && left.length <= size };
    want += size;
  }
}
export function trainKey(r, n = 4) { return keyOf(r, n); }
function keyOf(r, n) {
  return n === 2 ? `${r.A}/${r.B}` : `${Math.min(r.A, r.C)},${Math.max(r.A, r.C)}/${Math.min(r.B, r.D)},${Math.max(r.B, r.D)}`;
}

// ---------------------------------------------------------------- bc-breakdown
// For each W from..to: X = value / W (single precision), as the original
// prints "X * W" one line at a time and lets the operator pick one.
export function bcBreakdown(value, num, from = 20, to = 120) {
  const rows = [];
  for (let w = from; w <= to; w++) {
    const W = num.assign(num.fromInt(w), '!');
    const X = num.assign(num.div(value, W), '!');
    rows.push({ W: w, X, text: num.format(X) + ' ' + '*' + num.format(W) + ' ', xText: num.format(X).trim(), whole: num.eq(X, num.fn.INT(X)) });
  }
  return rows;
}
// the summary line 1600: PRINT X; "*"; W; "/"; J; "*"; H
export function bcSummaryLine(num, X, W, J, H) {
  const f = (v) => num.format(v) + ' ';
  return f(X) + '*' + f(W) + '/' + f(J) + '*' + f(H);
}
