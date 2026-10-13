// mbf.js - GW-BASIC numeric engine (Microsoft Binary Format single/double, 16-bit integer).
//
// This is a line-by-line port of the number code in PC-BASIC 2.0.8
// (pcbasic/basic/values/numbers.py and values.py, (c) Rob Hagemans, GPLv3),
// which emulates GW-BASIC's MBF arithmetic bit-for-bit, including its rounding
// quirks, its decimal<->binary conversions and the PRINT number format.
// Pure JS, no dependencies; works in browsers (ES module) and Node >= 14.
//
// Values are plain objects:
//   { t:'%', v:<int> }                       16-bit integer
//   { t:'!', m:<BigInt 24-bit field>, e:<0..255> }   single (MBF)
//   { t:'#', m:<BigInt 56-bit field>, e:<0..255> }   double (MBF)
// m is the mantissa field exactly as stored in memory (sign bit = top bit), e the
// exponent byte (0 = zero).  Errors that GW-BASIC treats as "soft" (Overflow,
// Division by zero) are reported through ctx.warn(msg) and execution continues
// with the largest representable value, exactly like the interpreter does.

const B = BigInt;

function mkClass(o) { return Object.freeze(o); }

export const SNG = mkClass({
  t: '!', digits: 7, bias: 128 + 24, shift: 128 + 24 - 129, fieldBits: 24,
  denMask: 0x80000000n, denUpper: 0x100000000n, carryMask: 0xffffff00n,
  signMask: 0x800000n, mask: 0xffffffn, posMask: 0x7fffffn,
  one: { m: 0n, e: 0x81 }, ten: { m: 0x200000n, e: 0x84 },
  limTop: { m: 0x18967fn, e: 0x98 }, limBot: { m: 0x7423ffn, e: 0x94 },
  posMax: { m: 0x7fffffn, e: 0xff }, negMax: { m: 0xffffffn, e: 0xff },
  expSign: 'E',
});
export const DBL = mkClass({
  t: '#', digits: 16, bias: 128 + 56, shift: 128 + 56 - 129, fieldBits: 56,
  denMask: 0x8000000000000000n, denUpper: 0x10000000000000000n, carryMask: 0xffffffffffffff00n,
  signMask: 0x80000000000000n, mask: 0xffffffffffffffn, posMask: 0x7fffffffffffffn,
  one: { m: 0n, e: 0x81 }, ten: { m: 0x20000000000000n, e: 0x84 },
  limTop: { m: 0x0e1bc9bf03ffffn, e: 0xb6 }, limBot: { m: 0x635fa9319fffffn, e: 0xb2 },
  posMax: { m: 0x7fffffffffffffn, e: 0xff }, negMax: { m: 0xffffffffffffffn, e: 0xff },
  expSign: 'D',
});
const CLS = { '!': SNG, '#': DBL };

export class BasicError extends Error {
  constructor(msg) { super(msg); this.basicError = msg; }
}

// ---------------------------------------------------------------- basics
const mk = (K, m, e) => ({ t: K.t, m, e });
const zero = (K) => mk(K, 0n, 0);
const isZero = (x) => x.e === 0;
const isNeg = (x) => {
  const K = CLS[x.t];
  return (x.m & K.signMask) !== 0n;
};
export function makeInt(v) {
  if (!(v >= -0x8000 && v <= 0x7fff)) throw new BasicError('Overflow');
  return { t: '%', v: v | 0 };
}

function denormalise(x) {
  const K = CLS[x.t];
  return [x.e, (x.m << 8n) | K.denMask, isNeg(x)];
}

function bringToRange(man, exp, lower, upper) {
  while (man <= lower) { exp -= 1; man <<= 1n; }
  while (man > upper) { exp += 1; man >>= 1n; }
  return [man, exp];
}

// returns value; on overflow calls ctx.overflow
function checkLimits(K, exp, neg, ctx) {
  if (exp > 255) {
    softError(ctx, 'Overflow');
    return 'max';
  } else if (exp <= 0) {
    return 'zero';
  }
  return 'ok';
}

function softError(ctx, msg) {
  if (ctx && ctx.warn) ctx.warn(msg);
  else throw new BasicError(msg);
}

function normalise(K, exp, man, neg, ctx) {
  if (man === 0n || exp <= 0) return zero(K);
  while (man < K.denMask - 1n) { exp -= 1; man <<= 1n; }
  const low = man & 0xffn;
  const roundUp = (low > 0x80n) || (low === 0x80n && (man & 0x100n) === 0x100n);
  man = (man & K.carryMask) + (roundUp ? 0x100n : 0n);
  if (man >= K.denUpper) { exp += 1; man >>= 1n; }
  const field = (man >> 8n) & (neg ? K.mask : K.posMask);
  const lim = checkLimits(K, exp, neg, ctx);
  if (lim === 'max') return neg ? mk(K, K.negMax.m, K.negMax.e) : mk(K, K.posMax.m, K.posMax.e);
  if (lim === 'zero') return mk(K, field, 0);
  return mk(K, field, exp);
}

function addDen(K, l, r) {
  let [lexp, lman, lneg] = l;
  let [rexp, rman, rneg] = r;
  if (rexp === 0) return [lexp, lman, lneg];
  if (lexp === 0) return [rexp, rman, rneg];
  if (lexp > rexp || (lexp === rexp && lman > rman)) {
    [lexp, lman, lneg, rexp, rman, rneg] = [rexp, rman, rneg, lexp, lman, lneg];
  }
  const sh = B(rexp - lexp);
  const zeroFlag = (lman & ((1n << sh) - 1n)) === 0n;
  const subFlag = lneg !== rneg;
  lman >>= sh;
  lexp = rexp;
  if ((lman < 0x80n || (lman === 0x80n && zeroFlag)) && subFlag) return [rexp, rman, rneg];
  let man, neg;
  if (!subFlag) {
    man = lman + rman; neg = lneg;
    if (man >= K.denUpper) { lexp += 1; man >>= 1n; }
  } else {
    man = rman - lman; neg = rneg;
  }
  if (!zeroFlag && !subFlag) man |= 1n;
  if (subFlag && (man & 0x1c0n) === 0x80n && (man & 0x1dfn) !== 0x80n) man &= (K.carryMask + 0x7fn);
  return [lexp, man, neg];
}

function divDen(K, l, r) {
  let [lexp, lman, lneg] = l;
  let [rexp, rman, rneg] = r;
  lneg = lneg !== rneg;
  lexp -= rexp - K.bias - 8;
  let work = lman;
  lman = 0n;
  lexp += 1;
  while (rman > 0n) {
    lman <<= 1n;
    lexp -= 1;
    if (work > rman) { work -= rman; lman += 1n; }
    rman >>= 1n;
  }
  return [lexp, lman, lneg];
}

function div10Den(K, den) {
  let [exp, man, neg] = divDen(K, den, denormalise(mk(K, K.ten.m, K.ten.e)));
  while (man < K.denMask) { exp -= 1; man <<= 1n; }
  return [exp, man, neg];
}
function mul10Den(K, den) {
  const [exp, man, neg] = den;
  return addDen(K, [exp + 1, man, neg], [exp + 3, man, neg]);
}
function applyCarryDen(K, den) {
  let [exp, man, neg] = den;
  if ((man & 0xffn) > 0x7fn) man += 0x100n;
  if (man >= K.denUpper) { exp += 1; man >>= 1n; }
  man ^= man & 0xffn;
  return [exp, man, neg];
}
function absGtDen(l, r) {
  if (l[0] !== r[0]) return l[0] > r[0];
  return l[1] > r[1];
}

// ---------------------------------------------------------------- conversions
export function fromIntF(K, n, ctx) {
  // n: JS integer (Number or BigInt)
  let N = B(n);
  if (N === 0n) return zero(K);
  const neg = N < 0n;
  if (neg) N = -N;
  const [man, exp] = bringToRange(N, K.bias, K.posMask, K.mask);
  const lim = checkLimits(K, exp, neg, ctx);
  if (lim === 'max') return neg ? mk(K, K.negMax.m, K.negMax.e) : mk(K, K.posMax.m, K.posMax.e);
  if (lim === 'zero') return zero(K);
  return mk(K, man & (neg ? K.mask : K.posMask), exp);
}

export function toNumber(x) {
  // exact value as JS double (like PC-BASIC to_value; doubles round to 53 bits)
  if (x.t === '%') return x.v;
  const K = CLS[x.t];
  const exp = x.e - K.bias;
  if (x.e === 0) return 0;
  let man = x.m;
  if (man & K.signMask) man = -man; else man |= K.signMask;
  return Number(man) * Math.pow(2, exp);
}

export function fromNumber(K, f, ctx) {
  // like PC-BASIC Float.from_value (used for results of SIN, COS, SQR ...): truncates
  if (f === 0) return zero(K);
  if (!isFinite(f)) { softError(ctx, 'Overflow'); return f < 0 ? mk(K, K.negMax.m, K.negMax.e) : mk(K, K.posMax.m, K.posMax.e); }
  const neg = f < 0;
  const a = Math.abs(f);
  let exp = Math.trunc(Math.log(a) / Math.log(2) - K.shift);
  let man = B(Math.trunc(a * Math.pow(2, -exp)));
  exp += K.bias;
  [man, exp] = bringToRange(man, exp, K.posMask, K.mask);
  const lim = checkLimits(K, exp, neg, ctx);
  if (lim === 'max') return neg ? mk(K, K.negMax.m, K.negMax.e) : mk(K, K.posMax.m, K.posMax.e);
  if (lim === 'zero') return zero(K); // PC-BASIC returns the untouched (all-zero) buffer
  return mk(K, man & (neg ? K.mask : K.posMask), exp);
}

function toIntDen(x) {
  const K = CLS[x.t];
  let [exp, man, neg] = denormalise(x);
  exp -= K.bias;
  if (exp > 0) man <<= B(exp); else man >>= B(-exp);
  return [man, neg];
}
// round to integer, halves away from zero (as BigInt)
export function floatToIntRound(x) {
  if (isZero(x)) return 0n;
  let [man, neg] = toIntDen(x);
  if (man & 0x80n) man += 0x80n;
  return neg ? -(man >> 8n) : (man >> 8n);
}
export function floatToIntTrunc(x) {
  if (isZero(x)) return 0n;
  const [man, neg] = toIntDen(x);
  return neg ? -(man >> 8n) : (man >> 8n);
}

export function sngToDbl(x) { return { t: '#', m: x.m << 32n, e: x.e }; }
export function dblToSng(x, ctx) {
  const s = { t: '!', m: x.m >> 32n, e: x.e };
  if (s.e === 0) {
    // zero exponent: PC-BASIC still runs it through normalise -> zero
    return zero(SNG);
  }
  let [exp, man, neg] = denormalise(s);
  man += (x.m >> 24n) & 0xffn;
  return normalise(SNG, exp, man, neg, ctx);
}

export function toSingle(x, ctx) {
  if (x.t === '!') return x;
  if (x.t === '#') return dblToSng(x, ctx);
  return fromIntF(SNG, x.v, ctx);
}
export function toDouble(x, ctx) {
  if (x.t === '#') return x;
  if (x.t === '!') return sngToDbl(x);
  return fromIntF(DBL, x.v, ctx);
}
export function toInteger(x) {
  if (x.t === '%') return x;
  const n = floatToIntRound(x);
  if (n < -0x8000n || n > 0x7fffn) throw new BasicError('Overflow');
  return makeInt(Number(n));
}
export function toFloat(x, ctx) { return x.t === '%' ? fromIntF(SNG, x.v, ctx) : x; }

// ---------------------------------------------------------------- arithmetic
function fadd(a, b, ctx) {
  const K = CLS[a.t];
  return normalise(K, ...addDen(K, denormalise(a), denormalise(b)), ctx);
}
function fsub(a, b, ctx) {
  const K = CLS[a.t];
  const [rexp, rman, rneg] = denormalise(b);
  return normalise(K, ...addDen(K, denormalise(a), [rexp, rman, !rneg]), ctx);
}
function fmul(a, b, ctx) {
  const K = CLS[a.t];
  if (isZero(a) || isZero(b)) return zero(K);
  let [lexp, lman, lneg] = denormalise(a);
  const [rexp, rman, rneg] = denormalise(b);
  lexp += rexp - K.bias - 8;
  lneg = lneg !== rneg;
  lman *= rman;
  if (lexp < -31) return zero(K);
  [lman, lexp] = bringToRange(lman, lexp, K.denMask >> 4n, K.denUpper >> 4n);
  if ((lman & 0xfn) === 0x9n) lman &= (K.carryMask + 0xfen);
  return normalise(K, lexp, lman, lneg, ctx);
}
function fdiv(a, b, ctx) {
  const K = CLS[a.t];
  if (isZero(b)) {
    softError(ctx, 'Division by zero');
    return isNeg(a) ? mk(K, K.negMax.m, K.negMax.e) : mk(K, K.posMax.m, K.posMax.e);
  }
  if (isZero(a)) return a;
  return normalise(K, ...divDen(K, denormalise(a), denormalise(b)), ctx);
}

function matchTypes(a, b, ctx) {
  if (a.t === '#' || b.t === '#') return [toDouble(a, ctx), toDouble(b, ctx)];
  if (a.t === '!' || b.t === '!') return [toSingle(a, ctx), toSingle(b, ctx)];
  return [a, b];
}

export function add(a, b, ctx) {
  [a, b] = matchTypes(toFloat(a, ctx), b, ctx);
  return fadd(a, b, ctx);
}
export function sub(a, b, ctx) {
  [a, b] = matchTypes(toFloat(a, ctx), b, ctx);
  return fsub(a, b, ctx);
}
export function mul(a, b, ctx) {
  if (a.t === '#' || b.t === '#') return fmul(toDouble(a, ctx), toDouble(b, ctx), ctx);
  return fmul(toSingle(a, ctx), toSingle(b, ctx), ctx);
}
export function div(a, b, ctx) {
  if (a.t === '#' || b.t === '#') return fdiv(toDouble(a, ctx), toDouble(b, ctx), ctx);
  return fdiv(toSingle(a, ctx), toSingle(b, ctx), ctx);
}
export function neg(a, ctx) {
  const x = toFloat(a, ctx);
  const K = CLS[x.t];
  // flips sign bit of the stored field (also on zero, harmless)
  return mk(K, x.m ^ K.signMask, x.e);
}
export function abs(a, ctx) {
  const x = toFloat(a, ctx);
  const K = CLS[x.t];
  return mk(K, x.m & ~K.signMask & K.mask, x.e);
}

function ipowInt(x, n, ctx) {
  const K = CLS[x.t];
  if (n < 0) {
    const r = ipowInt(x, -n, ctx);
    return fdiv(mk(K, K.one.m, K.one.e), r, ctx);
  } else if (n > 1) {
    if (n % 2 === 0) {
      const y = ipowInt(x, Math.floor(n / 2), ctx);
      return fmul(y, y, ctx);
    } else {
      const y = ipowInt(x, Math.floor((n - 1) / 2), ctx);
      return fmul(fmul(y, y, ctx), x, ctx);
    }
  } else if (n === 0) {
    return mk(K, K.one.m, K.one.e);
  }
  return x;
}
export function pow(a, b, ctx) {
  if (b.t === '%') return ipowInt(toSingle(a, ctx), b.v, ctx);
  return floatFn((p, q) => Math.pow(p, q), [a, b], ctx);
}

// comparisons -> JS boolean
function fEq(a, b) {
  if (isZero(a)) return isZero(b);
  return a.m === b.m && a.e === b.e;
}
function absGt(a, b) {
  if (isZero(a)) return false;
  if (a.e !== b.e) return a.e > b.e;
  const K = CLS[a.t];
  // sign bits equal when called; compare mantissa fields
  const am = a.m, bm = b.m & (a.m | ~K.signMask);
  return am > bm;
}
function fGt(a, b) {
  const rneg = isNeg(b);
  if (isZero(a)) return rneg && !isZero(b);
  const aneg = isNeg(a);
  if (aneg !== rneg) return !aneg;
  if (aneg) return absGt(b, a);
  return absGt(a, b);
}
export function eq(a, b, ctx) {
  [a, b] = matchTypes(a, b, ctx);
  if (a.t === '%') return a.v === b.v;
  return fEq(a, b);
}
export function gt(a, b, ctx) {
  [a, b] = matchTypes(a, b, ctx);
  if (a.t === '%') return a.v > b.v;
  return fGt(a, b);
}
export const lt = (a, b, ctx) => gt(b, a, ctx);
export const gte = (a, b, ctx) => !gt(b, a, ctx);
export const lte = (a, b, ctx) => !gt(a, b, ctx);
export const ne = (a, b, ctx) => !eq(a, b, ctx);
export const fromBool = (b) => makeInt(b ? -1 : 0);
export function isTrue(x) { return x.t === '%' ? x.v !== 0 : !isZero(x); }

// INT (floor), FIX (truncate), CINT
export function intFloor(a, ctx) {
  if (a.t === '%') return a;
  const K = CLS[a.t];
  const wasNeg = isNeg(a);
  const t = fromIntF(K, floatToIntTrunc(a), ctx);
  if (!fEq(t, a) && wasNeg) return fsub(t, mk(K, K.one.m, K.one.e), ctx);
  return t;
}
export function fix(a, ctx) {
  if (a.t === '%') return a;
  return fromIntF(CLS[a.t], floatToIntTrunc(a), ctx);
}
export function cint(a) { return toInteger(a); }
export function roundHalfAway(a, ctx) {
  // like CINT without the 16-bit range limit; keeps float type
  if (a.t === '%') return a;
  return fromIntF(CLS[a.t], floatToIntRound(a), ctx);
}
export function sgn(a) {
  if (a.t === '%') return makeInt(Math.sign(a.v));
  return makeInt(isZero(a) ? 0 : (isNeg(a) ? -1 : 1));
}

// Transcendental functions: like PC-BASIC (double_math off): argument converted to
// single, evaluated in IEEE double, result truncated back into a single.
export function floatFn(fn, args, ctx) {
  const sargs = args.map((x) => toSingle(x, ctx));
  const r = fn(...sargs.map(toNumber));
  if (Number.isNaN(r)) throw new BasicError('Illegal function call');
  return fromNumber(SNG, r, ctx);
}
const TRIG_MAX = 5e16;
export const sin = (a, ctx) => floatFn((x) => (Math.abs(x) < TRIG_MAX ? Math.sin(x) : 0), [a], ctx);
export const cos = (a, ctx) => floatFn((x) => (Math.abs(x) < TRIG_MAX ? Math.cos(x) : 1), [a], ctx);
export const tan = (a, ctx) => floatFn((x) => (Math.abs(x) < TRIG_MAX ? Math.tan(x) : 0), [a], ctx);
export const atn = (a, ctx) => floatFn(Math.atan, [a], ctx);
export const sqr = (a, ctx) => floatFn((x) => (x < 0 ? NaN : Math.sqrt(x)), [a], ctx);
export const exp = (a, ctx) => floatFn(Math.exp, [a], ctx);
export const log = (a, ctx) => floatFn((x) => (x <= 0 ? NaN : Math.log(x)), [a], ctx);

// ---------------------------------------------------------------- decimal
function justUnder(K, x) {
  const [lexp, lman, lneg] = denormalise(x);
  return normalise(K, lexp, lman - 0x100n, lneg);
}
function toDecimal(x, digits) {
  const K = CLS[x.t];
  let limBot, limTop;
  if (digits >= K.digits) {
    limBot = mk(K, K.limBot.m, K.limBot.e);
    limTop = mk(K, K.limTop.m, K.limTop.e);
  } else if (digits > 0) {
    limBot = justUnder(K, fromIntF(K, 10n ** B(digits - 1)));
    limTop = justUnder(K, fromIntF(K, 10n ** B(digits)));
  } else {
    limBot = fromIntF(K, 0);
    limTop = justUnder(K, fromIntF(K, 1));
  }
  const tden = denormalise(limTop);
  const bden = denormalise(limBot);
  let exp10 = 0;
  let den = denormalise(x);
  while (absGtDen(den, tden)) { den = div10Den(K, den); exp10 += 1; }
  den = applyCarryDen(K, den);
  while (absGtDen(bden, den)) { den = mul10Den(K, den); exp10 -= 1; }
  den = applyCarryDen(K, den);
  let [exp, man, neg] = den;
  exp -= K.bias;
  if (exp > 0) man <<= B(exp); else man >>= B(-exp);
  if (man & 0x80n) man += 0x80n;
  const num = neg ? -(man >> 8n) : (man >> 8n);
  return [num, exp10];
}

function getDigits(mant, minDigits) {
  let s = (mant < 0n ? -mant : mant).toString();
  while (s.length < minDigits) s = '0' + s;
  return s;
}
function scientific(K, digitstr, exp10, digitsToDot, forceDot) {
  let valstr = digitstr.slice(0, digitsToDot);
  if (digitstr.length > digitsToDot) valstr += '.' + digitstr.slice(digitsToDot);
  else if (digitstr.length === digitsToDot && forceDot) valstr += '.';
  const exponent = exp10 - digitsToDot + 1;
  valstr += K.expSign + (exponent < 0 ? '-' : '+') + getDigits(B(Math.abs(exponent)), 2);
  return valstr;
}
function decimalNotation(K, digitstr, exp10, typeSign) {
  const ts = typeSign ? K.t : '';
  exp10 += 1;
  let valstr;
  if (exp10 >= digitstr.length) valstr = digitstr + '0'.repeat(exp10 - digitstr.length);
  else if (exp10 > 0) valstr = digitstr.slice(0, exp10) + '.' + digitstr.slice(exp10);
  else valstr = '.' + '0'.repeat(-exp10) + digitstr;
  if (!valstr.includes('.') || ts === '#') valstr += ts;
  return valstr;
}

// STR$-style representation (leading space for positives)
export function toStr(x, leadingSpace = true, typeSign = false) {
  if (x.t === '%') {
    const s = String(x.v);
    return (x.v >= 0 && leadingSpace ? ' ' : '') + s + (typeSign ? '%' : '');
  }
  const K = CLS[x.t];
  if (isZero(x)) return (leadingSpace ? ' ' : '') + '0' + (typeSign ? K.t : '');
  let sign = '';
  if (isNeg(x)) sign = '-'; else if (leadingSpace) sign = ' ';
  let [mantissa, exp10] = toDecimal(x, K.digits);
  const digitstr = getDigits(mantissa, K.digits).replace(/0+$/, '');
  exp10 += K.digits - 1;
  let valstr;
  if (exp10 > K.digits - 1 || digitstr.length - exp10 > K.digits + 1) {
    valstr = scientific(K, digitstr, exp10, 1, false);
  } else {
    valstr = decimalNotation(K, digitstr, exp10, typeSign);
  }
  return sign + valstr;
}
// what PRINT x; outputs: leading space/sign, number, trailing space
export const printNum = (x) => toStr(x, true, false) + ' ';

// ---- string -> number (tokeniser literals, INPUT, VAL)
const BLANKS = ' \t\n';
export function strToDecimal(s, allowNonnum) {
  let foundSign = false, foundPoint = false, foundExp = false;
  let foundExpSign = false, expNeg = false, negv = false;
  let exp10 = 0, exponent = 0, mantissa = 0n, digits = 0, zeros = 0;
  let isDouble = false, isSingle = false;
  for (const c of s) {
    if (BLANKS.includes(c)) continue;
    if ('\x1c\x1d\x1f'.includes(c)) return [false, 0n, 0];
    if (!foundSign) {
      foundSign = true;
      if (c === '+' || c === '-') { negv = c === '-'; continue; }
    }
    if (!foundExp) {
      if (c >= '0' && c <= '9') {
        mantissa = mantissa * 10n + B(c.charCodeAt(0) - 48);
        if (foundPoint) exp10 -= 1;
        if (mantissa !== 0n) {
          digits += 1;
          if (foundPoint && c === '0') zeros += 1; else zeros = 0;
        }
        continue;
      } else if (c === '.') { foundPoint = true; continue; }
      else if ('DE'.includes(c.toUpperCase())) { foundExp = true; isDouble = c.toUpperCase() === 'D'; continue; }
      else if (c === '!') { isSingle = true; break; }
      else if (c === '#') { isDouble = true; break; }
      else { if (allowNonnum) break; throw new BasicError('Illegal function call'); }
    } else if (!foundExpSign) {
      foundExpSign = true;
      if (c === '+' || c === '-') { expNeg = c === '-'; continue; }
    }
    if (c >= '0' && c <= '9') { exponent = exponent * 10 + (c.charCodeAt(0) - 48); continue; }
    else { if (allowNonnum) break; throw new BasicError('Illegal function call'); }
  }
  exp10 += expNeg ? -exponent : exponent;
  if (digits - zeros > 7 && !isSingle) isDouble = true;
  return [isDouble, negv ? -mantissa : mantissa, exp10];
}
export function fromDecimal(K, mantissa, exp10, ctx) {
  let den = denormalise(fromIntF(K, mantissa, ctx));
  while (exp10 < 0) { den = div10Den(K, den); exp10 += 1; }
  while (exp10 > 0) { den = mul10Den(K, den); exp10 -= 1; }
  return normalise(K, ...den, ctx);
}
// PC-BASIC Values.from_repr: how literals in program text and INPUT answers are read.
export function fromRepr(word, allowNonnum = false, ctx) {
  word = word.replace(/^[ \n]+/, '').toUpperCase();
  if (!word) return makeInt(0);
  const v = word.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
  if (/^[0-9]+$/.test(v)) {
    const n = parseInt(v, 10);
    if (n <= 0x7fff) return makeInt(n);
  }
  const [isDouble, mantissa, exp10] = strToDecimal(word, allowNonnum);
  return fromDecimal(isDouble ? DBL : SNG, mantissa, exp10, ctx);
}
// INPUT into a variable with the given type sigil ('!' default, '#', '%')
export function inputValue(text, sigil = '!', ctx) {
  const v = fromRepr(String(text), false, ctx);
  return convertTo(v, sigil, ctx);
}
export function convertTo(v, sigil, ctx) {
  if (sigil === '#') return toDouble(v, ctx);
  if (sigil === '%') return toInteger(v);
  return toSingle(v, ctx);
}
export const SNG_ONE = Object.freeze(mk(SNG, SNG.one.m, SNG.one.e));

// debugging: MKS$/MKD$ bytes as hex (little endian like memory)
export function toHex(x) {
  if (x.t === '%') { const u = x.v & 0xffff; return (u & 0xff).toString(16).padStart(2, '0') + (u >> 8).toString(16).padStart(2, '0'); }
  const K = CLS[x.t];
  const n = K.fieldBits / 8;
  const out = [];
  for (let i = 0; i < n; i++) out.push(Number((x.m >> B(8 * i)) & 0xffn).toString(16).padStart(2, '0'));
  out.push(x.e.toString(16).padStart(2, '0'));
  return out.join('');
}
