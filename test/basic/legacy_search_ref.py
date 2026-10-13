"""Reference for the original change-gear search (BASIC lines 10010-10384).
A literal transliteration of the GOTO logic, using PC-BASIC's own MBF Single
arithmetic for RN = (A / B) * (C / D), PR = RN / R and the comparisons with
.9999 / 1.0001.  To keep run time sane a combination is only evaluated exactly
when its plain float ratio is within 0.1 % of R (ten times wider than the
0.01 % window, so nothing that could pass is skipped).
Input: JSON list of {"id", "rhex"} on stdin; output JSON list with first N matches."""
import sys, json, binascii
from multiprocessing import Pool
from pcbasic.basic.values import values as V

N_MATCHES = int(sys.argv[1]) if len(sys.argv) > 1 else 3
MAX_D = int(sys.argv[2]) if len(sys.argv) > 2 else 400

def work(item):
    vals = V.Values(None, False)
    vals.set_handler(V.FloatErrorHandler(None))
    R = vals.from_bytes(binascii.unhexlify(item['rhex']))
    Rf = R.to_value()
    S = lambda n: V.to_single(vals.from_value(n, b'!'))
    LV = V.to_single(vals.from_repr(b'.9999', False))
    HV = V.to_single(vals.from_repr(b'1.0001', False))
    out = []
    A = B = C = D = 20          # 10010-10040
    passes = 0
    while D <= MAX_D:
        passes += 1                 # 10050
        approx = (A * C) / (B * D) / Rf
        if 0.999 < approx < 1.001:
            RN = V.mul(V.div(S(A), S(B)), V.div(S(C), S(D)))
            PR = V.div(RN, R)       # 10060
            # 10090-10100
            if V._bool_eq(PR, LV): ok = True
            elif V._bool_gt(LV, PR): ok = False
            elif V._bool_gt(PR, HV): ok = False
            elif V._bool_eq(PR, HV): ok = True
            elif V._bool_gt(HV, PR): ok = True
            else: ok = False
            if ok:
                out.append({'A': A, 'B': B, 'C': C, 'D': D, 'pos': passes,
                            'rn': binascii.hexlify(bytes(RN.to_bytes())).decode()})
                if len(out) >= N_MATCHES: break
        A += 1                      # 10110
        if A == 89:                 # 10120 -> 10360
            B += 1; A = 20; continue
        if B == 89:                 # 10130 -> 10370
            C += 1; A = 20; B = 20; continue
        if C == 89:                 # 10140 -> 10380
            D += 1; A = 20; B = 20; C = 20; continue
    return {'id': item['id'], 'matches': out, 'maxD': MAX_D}

if __name__ == '__main__':
    items = json.load(sys.stdin)
    with Pool(int(sys.argv[3]) if len(sys.argv) > 3 else 4) as p:
        res = p.map(work, items, chunksize=1)
    json.dump(res, sys.stdout)
