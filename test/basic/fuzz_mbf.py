"""Generate reference results for the MBF number engine using PC-BASIC's own
number classes (pcbasic.basic.values).  Output: JSON lines consumed by
app/test/mbf_fuzz.test.mjs.  Usage: .venv/bin/python fuzz_mbf.py N > out.jsonl"""
import sys, json, random, binascii
from pcbasic.basic.values import values as V
from pcbasic.basic.values import numbers as Nm
from pcbasic.basic.base import error

vals = V.Values(None, False)
vals.set_handler(V.FloatErrorHandler(None))

def rnd_num_str(r):
    kind = r.random()
    sign = '-' if r.random() < 0.2 else ''
    if kind < 0.25:
        return sign + str(r.randint(0, 40000))
    if kind < 0.5:
        return sign + ('%.*f' % (r.randint(0, 6), r.uniform(0, 200)))
    if kind < 0.7:
        return sign + ('%.*g' % (r.randint(1, 9), 10 ** r.uniform(-8, 9)))
    if kind < 0.8:
        return sign + ('%.*f' % (r.randint(1, 9), r.uniform(0, 3))) + '#'
    if kind < 0.9:
        return sign + ('%.*g' % (r.randint(1, 15), 10 ** r.uniform(-30, 30)))
    return sign + '.' + str(r.randint(0, 99999)).rjust(5, '0')

def hx(v):
    return binascii.hexlify(bytes(v.to_bytes())).decode()

def rep(v):
    if v is None: return None
    return {'t': v.sigil.decode(), 'hex': hx(v), 'str': V.to_repr(v, True, False).decode()}

def parse(s):
    # program-literal semantics: sign handled as unary minus
    neg = s.startswith('-')
    v = vals.from_repr(s.lstrip('-').encode(), allow_nonnum=False)
    if neg: v = V.neg(v)
    return v

OPS = {
    'add': V.add, 'sub': V.sub, 'mul': V.mul, 'div': V.div, 'pow': V.pow,
    'gt': lambda a, b: V.gt(a, b), 'eq': lambda a, b: V.eq(a, b),
}
UN = {
    'sin': lambda a: V.sin_([a]), 'cos': lambda a: V.cos_([a]), 'tan': lambda a: V.tan_([a]),
    'atn': lambda a: V.atn_([a]), 'sqr': lambda a: V.sqr_([a]), 'int': lambda a: V.int_([a]),
    'fix': lambda a: V.fix_([a]), 'cint': lambda a: V.cint_([a]), 'csng': lambda a: V.csng_([a]),
    'cdbl': lambda a: V.cdbl_([a]), 'abs': lambda a: V.abs_([a]), 'neg': lambda a: V.neg(a),
    'exp': lambda a: V.exp_([a]), 'log': lambda a: V.log_([a]),
}
r = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 1234)
n = int(sys.argv[1])
for i in range(n):
    a_s, b_s = rnd_num_str(r), rnd_num_str(r)
    rec = {'a': a_s, 'b': b_s}
    try:
        a = parse(a_s); b = parse(b_s)
    except Exception as e:
        rec['parseError'] = type(e).__name__
        print(json.dumps(rec)); continue
    rec['A'] = rep(a); rec['B'] = rep(b)
    # INPUT semantics into a single variable
    try:
        rec['inputA'] = rep(V.to_single(vals.from_repr(a_s.encode(), allow_nonnum=False)))
    except Exception as e:
        rec['inputA'] = {'err': type(e).__name__}
    res = {}
    for name, f in OPS.items():
        if name == 'pow' and r.random() < 0.5:
            bb = vals.new_integer().from_int(r.randint(-6, 6)); rec['powInt'] = bb.to_int()
            try:
                res['powi'] = rep(f(a, bb))
            except Exception as e:
                res['powi'] = {'err': type(e).__name__}
        try:
            res[name] = rep(f(a, b))
        except Exception as e:
            res[name] = {'err': type(e).__name__}
    for name, f in UN.items():
        try:
            res[name] = rep(f(a))
        except Exception as e:
            res[name] = {'err': type(e).__name__}
    rec['res'] = res
    print(json.dumps(rec))
