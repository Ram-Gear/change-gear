// numeric.js - numeric "backends" used by the formula engine and gear searches.
//
//   gwbasic     : GW-BASIC semantics, bit-exact (MBF single/double, see mbf.js).
//                 Used by every built-in machine so results match the old program.
//   ieee-single : QBasic-style approximation: IEEE single precision with rounding
//                 after every operation (Math.fround). Not verified against QBasic.
//   float64     : plain double precision (best accuracy; default for new machines).
//
// All backends expose the same interface; values are opaque objects.
import * as M from './mbf.js';

// ------------------------------------------------ PRINT-style number formatting
// GW-BASIC rules: leading space for positives, no leading zero (".5"), switch to
// E-notation when the number cannot be shown in `digits` significant digits.
export function formatSig(x, digits, expChar = 'E') {
  if (x === 0 || Object.is(x, -0)) return ' 0';
  if (!isFinite(x)) return x > 0 ? ' Infinity' : '-Infinity';
  const sign = x < 0 ? '-' : ' ';
  const [mant, e] = Math.abs(x).toExponential(digits - 1).split('e');
  const digitstr = mant.replace('.', '').replace(/0+$/, '') || '0';
  const exp10 = parseInt(e, 10);
  let val;
  if (exp10 > digits - 1 || digitstr.length - exp10 > digits + 1) {
    val = digitstr[0] + (digitstr.length > 1 ? '.' + digitstr.slice(1) : '') + expChar + (exp10 < 0 ? '-' : '+') + String(Math.abs(exp10)).padStart(2, '0');
  } else {
    const p = exp10 + 1;
    if (p >= digitstr.length) val = digitstr + '0'.repeat(p - digitstr.length);
    else if (p > 0) val = digitstr.slice(0, p) + '.' + digitstr.slice(p);
    else val = '.' + '0'.repeat(-p) + digitstr;
  }
  return sign + val;
}

// literal typing shared by the BASIC-like backends: '%' int, '!' single, '#' double
function literalType(text) {
  const t = text.toUpperCase();
  if (/^[0-9]+$/.test(t) && parseInt(t, 10) <= 32767) return '%';
  const [isDouble] = M.strToDecimal(t, false);
  return isDouble ? '#' : '!';
}
function literalNumber(text) {
  return Number(text.toUpperCase().replace(/[!#]$/, '').replace('D', 'E'));
}

// ------------------------------------------------ gwbasic (MBF)
export function gwbasicBackend(ctx) {
  const c = ctx || {};
  const one = M.SNG_ONE;
  return {
    id: 'gwbasic',
    lit: (text) => M.fromRepr(text, false, c),
    input: (text, sigil = '!') => M.inputValue(text, sigil, c),
    assign: (v, sigil = '!') => M.convertTo(v, sigil, c),
    fromInt: (n) => (n >= -32768 && n <= 32767 ? M.makeInt(n) : M.fromIntF(M.SNG, n, c)),
    fromJS: (x) => M.fromNumber(M.DBL, x, c),
    add: (a, b) => M.add(a, b, c), sub: (a, b) => M.sub(a, b, c),
    mul: (a, b) => M.mul(a, b, c), div: (a, b) => M.div(a, b, c),
    pow: (a, b) => M.pow(a, b, c), neg: (a) => M.neg(a, c),
    eq: (a, b) => M.eq(a, b, c), lt: (a, b) => M.lt(a, b, c), gt: (a, b) => M.gt(a, b, c),
    le: (a, b) => M.lte(a, b, c), ge: (a, b) => M.gte(a, b, c), ne: (a, b) => M.ne(a, b, c),
    bool: (b) => M.fromBool(b), truthy: (v) => M.isTrue(v),
    and: (a, b) => M.makeInt(M.toInteger(a).v & M.toInteger(b).v),
    or: (a, b) => M.makeInt(M.toInteger(a).v | M.toInteger(b).v),
    not: (a) => M.makeInt(~M.toInteger(a).v),
    fn: {
      SIN: (a) => M.sin(a, c), COS: (a) => M.cos(a, c), TAN: (a) => M.tan(a, c),
      ATN: (a) => M.atn(a, c), SQR: (a) => M.sqr(a, c), EXP: (a) => M.exp(a, c), LOG: (a) => M.log(a, c),
      ABS: (a) => M.abs(a, c), SGN: (a) => M.sgn(a), INT: (a) => M.intFloor(a, c), FIX: (a) => M.fix(a, c),
      CINT: (a) => M.cint(a), CSNG: (a) => M.toSingle(a, c), CDBL: (a) => M.toDouble(a, c),
      ROUND: (a) => M.roundHalfAway(a, c),
      // extensions (not in the original BASIC): evaluated in IEEE double from the
      // exact argument, result stored as a single like other BASIC functions
      ASIN: (a) => M.floatFn((x) => Math.asin(x), [a], c),
      ACOS: (a) => M.floatFn((x) => Math.acos(x), [a], c),
      SIND: (a) => M.floatFn((x) => Math.sin(x * Math.PI / 180), [a], c),
      COSD: (a) => M.floatFn((x) => Math.cos(x * Math.PI / 180), [a], c),
      TAND: (a) => M.floatFn((x) => Math.tan(x * Math.PI / 180), [a], c),
      ASIND: (a) => M.floatFn((x) => Math.asin(x) * 180 / Math.PI, [a], c),
      ACOSD: (a) => M.floatFn((x) => Math.acos(x) * 180 / Math.PI, [a], c),
      ATND: (a) => M.floatFn((x) => Math.atan(x) * 180 / Math.PI, [a], c),
    },
    pi: () => M.fromRepr('3.141592653589793#', false, c),
    toJS: (v) => M.toNumber(v),
    format: (v) => M.toStr(v, true, false),
    typeOf: (v) => v.t,
    one,
  };
}

// ------------------------------------------------ IEEE single (QBasic-like)
export function ieeeSingleBackend(ctx) {
  const c = ctx || {};
  const fr = Math.fround;
  const V = (t, v) => ({ t, v: t === '!' ? fr(v) : t === '%' ? v : v });
  const warn = (m) => { if (c.warn) c.warn(m); else throw new M.BasicError(m); };
  const flt = (a) => (a.t === '%' ? V('!', a.v) : a);
  const top = (a, b) => (a.t === '#' || b.t === '#' ? '#' : '!');
  const conv = (a, s) => {
    if (s === '#') return V('#', a.v);
    if (s === '%') {
      const r = Math.sign(a.v) * Math.round(Math.abs(a.v)); // halves away from zero
      if (r < -32768 || r > 32767) throw new M.BasicError('Overflow');
      return V('%', r);
    }
    return V('!', a.v);
  };
  const chk = (t, v) => {
    if (!isFinite(v)) { warn('Overflow'); return V(t, (v < 0 ? -1 : 1) * (t === '#' ? Number.MAX_VALUE : 3.4028234663852886e38)); }
    return V(t, v);
  };
  const ff = (f) => (a) => { const r = f(fr(a.v)); if (Number.isNaN(r)) throw new M.BasicError('Illegal function call'); return chk('!', r); };
  const D2R = Math.PI / 180;
  return {
    id: 'ieee-single',
    lit: (text) => { const t = literalType(text); return V(t, literalNumber(text)); },
    input: (text, sigil = '!') => { const n = Number(String(text).trim()); if (String(text).trim() === '') return conv(V('%', 0), sigil); if (!isFinite(n)) throw new M.BasicError('Redo from start'); return conv(V('#', n), sigil); },
    assign: (v, sigil = '!') => conv(v, sigil),
    fromInt: (n) => (n >= -32768 && n <= 32767 ? V('%', n) : V('!', n)),
    fromJS: (x) => V('#', x),
    add: (a, b) => { const t = top(flt(a), b); return chk(t, a.v + b.v); },
    sub: (a, b) => { const t = top(flt(a), b); return chk(t, a.v - b.v); },
    mul: (a, b) => chk(top(a, b), a.v * b.v),
    div: (a, b) => {
      const t = top(a, b);
      if (b.v === 0) { warn('Division by zero'); return V(t, (a.v < 0 ? -1 : 1) * 3.4028234663852886e38); }
      return chk(t, a.v / b.v);
    },
    pow: (a, b) => { const r = Math.pow(a.v, b.v); if (Number.isNaN(r)) throw new M.BasicError('Illegal function call'); return chk(top(a, b), r); },
    neg: (a) => V(flt(a).t, -a.v),
    eq: (a, b) => a.v === b.v, lt: (a, b) => a.v < b.v, gt: (a, b) => a.v > b.v,
    le: (a, b) => a.v <= b.v, ge: (a, b) => a.v >= b.v, ne: (a, b) => a.v !== b.v,
    bool: (b) => V('%', b ? -1 : 0), truthy: (v) => v.v !== 0,
    and: (a, b) => V('%', conv(a, '%').v & conv(b, '%').v),
    or: (a, b) => V('%', conv(a, '%').v | conv(b, '%').v),
    not: (a) => V('%', ~conv(a, '%').v),
    fn: {
      SIN: ff(Math.sin), COS: ff(Math.cos), TAN: ff(Math.tan), ATN: ff(Math.atan),
      SQR: ff((x) => (x < 0 ? NaN : Math.sqrt(x))), EXP: ff(Math.exp), LOG: ff((x) => (x <= 0 ? NaN : Math.log(x))),
      ABS: (a) => V(flt(a).t, Math.abs(a.v)), SGN: (a) => V('%', Math.sign(a.v)),
      INT: (a) => (a.t === '%' ? a : V(a.t, Math.floor(a.v))), FIX: (a) => (a.t === '%' ? a : V(a.t, Math.trunc(a.v))),
      CINT: (a) => conv(a, '%'), CSNG: (a) => V('!', a.v), CDBL: (a) => V('#', a.v),
      ROUND: (a) => (a.t === '%' ? a : V(a.t, Math.sign(a.v) * Math.round(Math.abs(a.v)))),
      ASIN: ff(Math.asin), ACOS: ff(Math.acos),
      SIND: ff((x) => Math.sin(x * D2R)), COSD: ff((x) => Math.cos(x * D2R)), TAND: ff((x) => Math.tan(x * D2R)),
      ASIND: ff((x) => Math.asin(x) / D2R), ACOSD: ff((x) => Math.acos(x) / D2R), ATND: ff((x) => Math.atan(x) / D2R),
    },
    pi: () => V('#', Math.PI),
    toJS: (v) => v.v,
    format: (v) => (v.t === '%' ? (v.v >= 0 ? ' ' : '') + v.v : formatSig(v.v, v.t === '#' ? 16 : 7, v.t === '#' ? 'D' : 'E')),
    typeOf: (v) => v.t,
  };
}

// ------------------------------------------------ float64
export function float64Backend(ctx) {
  const c = ctx || {};
  const warn = (m) => { if (c.warn) c.warn(m); else throw new M.BasicError(m); };
  const N = (v) => ({ t: '#', v });
  const chk = (v) => { if (Number.isNaN(v)) throw new M.BasicError('Illegal function call'); if (!isFinite(v)) { warn('Overflow'); } return N(v); };
  const ff = (f) => (a) => chk(f(a.v));
  const D2R = Math.PI / 180;
  const rnd = (x) => Math.sign(x) * Math.round(Math.abs(x));
  return {
    id: 'float64',
    lit: (text) => N(literalNumber(text)),
    input: (text, sigil) => {
      const s = String(text).trim();
      if (s === '') return N(0);
      const n = Number(s);
      if (!isFinite(n)) throw new M.BasicError('Redo from start');
      return sigil === '%' ? N(rnd(n)) : N(n);
    },
    assign: (v, sigil) => (sigil === '%' ? N(rnd(v.v)) : v),
    fromInt: (n) => N(n),
    fromJS: (x) => N(x),
    add: (a, b) => chk(a.v + b.v), sub: (a, b) => chk(a.v - b.v), mul: (a, b) => chk(a.v * b.v),
    div: (a, b) => { if (b.v === 0) { warn('Division by zero'); return N(a.v < 0 ? -Number.MAX_VALUE : Number.MAX_VALUE); } return chk(a.v / b.v); },
    pow: (a, b) => chk(Math.pow(a.v, b.v)), neg: (a) => N(-a.v),
    eq: (a, b) => a.v === b.v, lt: (a, b) => a.v < b.v, gt: (a, b) => a.v > b.v,
    le: (a, b) => a.v <= b.v, ge: (a, b) => a.v >= b.v, ne: (a, b) => a.v !== b.v,
    bool: (b) => N(b ? -1 : 0), truthy: (v) => v.v !== 0,
    and: (a, b) => N(rnd(a.v) & rnd(b.v)), or: (a, b) => N(rnd(a.v) | rnd(b.v)), not: (a) => N(~rnd(a.v)),
    fn: {
      SIN: ff(Math.sin), COS: ff(Math.cos), TAN: ff(Math.tan), ATN: ff(Math.atan),
      SQR: ff((x) => (x < 0 ? NaN : Math.sqrt(x))), EXP: ff(Math.exp), LOG: ff((x) => (x <= 0 ? NaN : Math.log(x))),
      ABS: ff(Math.abs), SGN: ff(Math.sign), INT: ff(Math.floor), FIX: ff(Math.trunc),
      CINT: ff(rnd), CSNG: ff(Math.fround), CDBL: ff((x) => x), ROUND: ff(rnd),
      ASIN: ff(Math.asin), ACOS: ff(Math.acos),
      SIND: ff((x) => Math.sin(x * D2R)), COSD: ff((x) => Math.cos(x * D2R)), TAND: ff((x) => Math.tan(x * D2R)),
      ASIND: ff((x) => Math.asin(x) / D2R), ACOSD: ff((x) => Math.acos(x) / D2R), ATND: ff((x) => Math.atan(x) / D2R),
    },
    pi: () => N(Math.PI),
    toJS: (v) => v.v,
    format: (v) => formatSig(v.v, 10),
    typeOf: () => '#',
  };
}


// v1.8.5: exact rational backend (BigInt fractions). Used only to check index trains for ZERO error.
// Values are {p,q} (q>0, reduced) or {irr:true,v} once a non-rational step (SIN, SQR, PI, ^ fraction...) is used.
export function rationalBackend() {
  const ga = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
  const R = (p, q = 1n) => { if (q === 0n) throw new M.BasicError('Division by zero'); if (q < 0n) { p = -p; q = -q; } const g = ga(p, q) || 1n; return { p: p / g, q: q / g }; };
  const I = (v) => ({ irr: true, v });
  const js = (a) => (a.irr ? a.v : Number(a.p) / Number(a.q));
  const dec = (text) => {
    const s = String(text).trim().replace(/[!#%]$/, '').replace(/d/i, 'e');
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!m || (m[2] === '' && (m[3] || '') === '')) { const n = Number(s); if (!isFinite(n)) throw new M.BasicError('Redo from start'); return I(n); }
    let p = BigInt((m[2] || '0') + (m[3] || '')), q = 10n ** BigInt((m[3] || '').length); const e = Number(m[4] || 0);
    if (e > 0) p *= 10n ** BigInt(e); else if (e < 0) q *= 10n ** BigInt(-e);
    return R(m[1] === '-' ? -p : p, q);
  };
  const bin = (f, g) => (a, b) => (a.irr || b.irr ? I(g(js(a), js(b))) : f(a, b));
  const cmp = (a, b) => (a.irr || b.irr ? Math.sign(js(a) - js(b)) : Number(a.p * b.q - b.p * a.q > 0n) - Number(a.p * b.q - b.p * a.q < 0n));
  const floor = (a) => { const f = a.p / a.q; return R(a.p < 0n && f * a.q !== a.p ? f - 1n : f); };
  const exactFn = (f, g) => (a) => (a.irr ? I(g(a.v)) : f(a));
  const irrFn = (g) => (a) => I(g(js(a)));
  const D2R = Math.PI / 180;
  const round = (a) => { const t = R(2n * a.p + (a.p < 0n ? -a.q : a.q), 2n * a.q); return R(t.p / t.q); };
  return {
    id: 'rational', exact: true,
    lit: dec, input: (text) => (String(text).trim() === '' ? R(0n) : dec(text)), assign: (v) => v,
    fromInt: (n) => R(BigInt(n)), fromJS: (x) => (Number.isInteger(x) ? R(BigInt(x)) : I(x)),
    add: bin((a, b) => R(a.p * b.q + b.p * a.q, a.q * b.q), (x, y) => x + y),
    sub: bin((a, b) => R(a.p * b.q - b.p * a.q, a.q * b.q), (x, y) => x - y),
    mul: bin((a, b) => R(a.p * b.p, a.q * b.q), (x, y) => x * y),
    div: bin((a, b) => R(a.p * b.q, a.q * b.p), (x, y) => x / y),
    pow: (a, b) => { if (!a.irr && !b.irr && b.q === 1n && b.p >= -64n && b.p <= 64n) { const e = b.p < 0n ? -b.p : b.p; let r = R(a.p ** e, a.q ** e); return b.p < 0n ? R(r.q, r.p) : r; } return I(Math.pow(js(a), js(b))); },
    neg: (a) => (a.irr ? I(-a.v) : R(-a.p, a.q)),
    eq: (a, b) => cmp(a, b) === 0, ne: (a, b) => cmp(a, b) !== 0, lt: (a, b) => cmp(a, b) < 0, gt: (a, b) => cmp(a, b) > 0, le: (a, b) => cmp(a, b) <= 0, ge: (a, b) => cmp(a, b) >= 0,
    bool: (b) => R(b ? -1n : 0n), truthy: (v) => js(v) !== 0,
    and: (a, b) => R(BigInt(Math.round(js(a)) & Math.round(js(b)))), or: (a, b) => R(BigInt(Math.round(js(a)) | Math.round(js(b)))), not: (a) => R(BigInt(~Math.round(js(a)))),
    fn: {
      ABS: exactFn((a) => R(a.p < 0n ? -a.p : a.p, a.q), Math.abs), SGN: exactFn((a) => R(BigInt(Math.sign(Number(a.p)))), Math.sign),
      INT: exactFn(floor, Math.floor), FIX: exactFn((a) => R(a.p / a.q), Math.trunc), CINT: exactFn(round, Math.round), ROUND: exactFn(round, Math.round),
      CSNG: (a) => a, CDBL: (a) => a,
      SIN: irrFn(Math.sin), COS: irrFn(Math.cos), TAN: irrFn(Math.tan), ATN: irrFn(Math.atan), SQR: irrFn(Math.sqrt), EXP: irrFn(Math.exp), LOG: irrFn(Math.log),
      ASIN: irrFn(Math.asin), ACOS: irrFn(Math.acos), SIND: irrFn((x) => Math.sin(x * D2R)), COSD: irrFn((x) => Math.cos(x * D2R)), TAND: irrFn((x) => Math.tan(x * D2R)),
      ASIND: irrFn((x) => Math.asin(x) / D2R), ACOSD: irrFn((x) => Math.acos(x) / D2R), ATND: irrFn((x) => Math.atan(x) / D2R),
    },
    pi: () => I(Math.PI), toJS: js, format: (v) => (v.irr ? String(v.v) : v.q === 1n ? String(v.p) : `${v.p}/${v.q}`), typeOf: () => '#',
  };
}

export const BACKENDS = { rational: rationalBackend, gwbasic: gwbasicBackend, 'ieee-single': ieeeSingleBackend, float64: float64Backend };
export function makeBackend(id, ctx) {
  const f = BACKENDS[id || 'gwbasic'];
  if (!f) throw new Error(`Unknown numeric mode "${id}"`);
  return f(ctx);
}
