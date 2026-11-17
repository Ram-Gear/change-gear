// presets.js - saved index gear sets per machine (v1.6). Pure, no DOM; tested in test/presets.test.mjs.
// A preset: { z, A, B, C, D, E?, F?, note }  (C and D empty for a 2-gear A/B set).
// v1.8.12: E/F = the machine's reversing gears (FD-500 manual 3.2.2 / 4.5: a/b x c/d = 24 u k / z, u = f/e),
// one of three fixed pairs 56/28 (2:1), 42/42 (1:1), 28/56 (1:2). Missing E/F = 42/42 (1:1, the old behaviour).
// Train ratio = A/B x C/D x E/F.

export const EF_PAIRS = [[56, 28], [42, 42], [28, 56]];
export const EF_DEFAULT = [42, 42];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function efLabel(E, F) { const g = gcd(E, F); return `${E}/${F} (${E / g}:${F / g})`; }
export function efOf(p) { return p && p.E && p.F ? { E: Number(p.E), F: Number(p.F) } : { E: EF_DEFAULT[0], F: EF_DEFAULT[1] }; }
export function isEfPair(E, F) { return EF_PAIRS.some(([e, f]) => e === Number(E) && f === Number(F)); }
// whole-number numerator / denominator of A/B x C/D x E/F
export function presetNumDen(p) {
  const { E, F } = efOf(p);
  const n = Number(p.A) * (p.C ? Number(p.C) : 1) * E, d = Number(p.B) * (p.D ? Number(p.D) : 1) * F;
  return { num: n, den: d };
}

export function isPrime(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

const posInt = (v) => /^\d+$/.test(String(v ?? '').trim()) && Number(v) > 0;
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// Normalise + validate one preset. Returns { preset, errors }
export function cleanPreset(p) {
  const errors = [];
  const out = { z: Number(p.z), A: Number(p.A), B: Number(p.B), note: String(p.note || '').trim() };
  if (String(p.label || '').trim()) out.label = String(p.label).trim();
  if (!posInt(p.z)) errors.push('z must be a whole number above 0');
  if (!posInt(p.A)) errors.push('A must be a whole number above 0');
  if (!posInt(p.B)) errors.push('B must be a whole number above 0');
  if (blank(p.C) && blank(p.D)) { /* 2-gear set */ }
  else if (!posInt(p.C) || !posInt(p.D)) errors.push('C and D must both be whole numbers (or both empty for a 2-gear set)');
  else { out.C = Number(p.C); out.D = Number(p.D); }
  if (blank(p.E) && blank(p.F)) { /* no E/F stored = 42/42 */ }
  else if (!posInt(p.E) || !posInt(p.F) || !isEfPair(p.E, p.F)) errors.push(`E/F must be ${EF_PAIRS.map(([e, f]) => `${e}/${f}`).join(', ').replace(/, ([^,]*)$/, ' or $1')} (or both empty for 42/42)`);
  else { out.E = Number(p.E); out.F = Number(p.F); }
  return { preset: out, errors };
}

export function presetRatio(p) {
  const { E, F } = efOf(p);
  const r = Number(p.A) / Number(p.B);
  return (p.C && p.D ? r * (Number(p.C) / Number(p.D)) : r) * (E / F);
}
export function presetError(p, target) { return presetRatio(p) / target - 1; }
export function presetsFor(presets, z) { return (presets || []).filter((p) => Number(p.z) === Number(z)); }
export function presetText(p) { const { E, F } = efOf(p); return `${p.A}/${p.B}${p.C ? ` × ${p.C}/${p.D}` : ''} × ${E}/${F}`; }

// Hint for a prime z with no preset and no inventory gear whose tooth count is a multiple of z.
export function primeHint(z, inventoryGears, presets) {
  z = Number(z);
  if (!isPrime(z) || presetsFor(presets, z).length) return null;
  if ((inventoryGears || []).some((g) => Number(g.qty ?? 1) > 0 && Number(g.teeth) % z === 0)) return null;
  return `z = ${z} is prime – you need a ${z}-tooth gear (or a multiple); add a preset.`;
}

// From a ranked search match {A,B,C,D}
// v1.8.12: ef = [E, F] (one of EF_PAIRS); default 42/42
export function presetFromMatch(z, m, note = '', label = '', ef = null) {
  const p = { z: Number(z), A: m.A, B: m.B, note };
  if (String(label || '').trim()) p.label = String(label).trim();
  if (m.C && m.D) { p.C = m.C; p.D = m.D; }
  const [E, F] = ef || (m.E && m.F ? [m.E, m.F] : EF_DEFAULT);
  if (!isEfPair(E, F)) throw new Error(`E/F ${E}/${F} is not one of the allowed pairs`);
  p.E = Number(E); p.F = Number(F);
  return p;
}

// Add or replace (same z and same gears -> replace note; otherwise append). Sorted by z.
export function upsertPreset(presets, p) {
  const list = [...(presets || [])];
  const k = list.findIndex((x) => Number(x.z) === p.z && presetText(x) === presetText(p));
  if (k >= 0) list[k] = p; else list.push(p);
  return list.sort((a, b) => a.z - b.z);
}

// ---------------------------------------------------------------- CSV: z,A,B,C,D,E,F,note,name (v1.8.12; old z,A,B,C,D,note,name still imports, E/F = 42/42)
const q = (s) => (/[",;\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
export function presetsToCsv(presets) {
  return ['z,A,B,C,D,E,F,note,name', ...(presets || []).map((p) => { const { E, F } = efOf(p); return [p.z, p.A, p.B, p.C ?? '', p.D ?? '', E, F, q(p.note || ''), q(p.label || '')].join(','); })].join('\r\n') + '\r\n';
}
function splitLine(line, sep) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map((s) => s.trim());
}
// Returns { rows: [preset+line], bad: [{line,text,reason}], header }
export function parsePresetCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const lines = src.split(/\r?\n/);
  const first = lines.find((l) => l.trim()) || '';
  const sep = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const OLD = { z: 0, A: 1, B: 2, C: 3, D: 4, E: -1, F: -1, note: 5, label: 6 };
  const NEW = { z: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, note: 7, label: 8 };
  let col = null, header = false, seen = false;
  const rows = [], bad = [];
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw, sep);
    if (!seen) {
      seen = true;
      if (!/^\d/.test(cells[0] || '') && /[a-z]/i.test(cells.join(''))) {
        header = true;
        const f = (re, d) => { const k = cells.findIndex((c) => re.test(c)); return k >= 0 ? k : d; };
        const hasE = cells.some((c) => /^e$/i.test(c));
        col = { z: f(/^(z|teeth|tooth count)$/i, 0), A: f(/^a$/i, 1), B: f(/^b$/i, 2), C: f(/^c$/i, 3), D: f(/^d$/i, 4),
          E: hasE ? f(/^e$/i, 5) : -1, F: hasE ? f(/^f$/i, 6) : -1, note: f(/^(notes?|comment)$/i, hasE ? 7 : 5), label: f(/^(name|preset|preset name|label)$/i, hasE ? 8 : 6) };
        return;
      }
    }
    if (cells.every((c) => !c)) return;
    // no header: new layout when columns 6 and 7 are both whole numbers (E, F), else the old z,A,B,C,D,note,name
    const c = col || (/^\d+$/.test(cells[5] || '') && /^\d+$/.test(cells[6] || '') ? NEW : OLD);
    const get = (k) => (c[k] < 0 ? '' : cells[c[k]] ?? '');
    const { preset, errors } = cleanPreset({ z: get('z'), A: get('A'), B: get('B'), C: get('C'), D: get('D'), E: get('E'), F: get('F'), note: get('note'), label: get('label') });
    if (errors.length) bad.push({ line: i + 1, text: raw, reason: errors.join('; ') });
    else rows.push({ ...preset, line: i + 1 });
  });
  return { rows, bad, header };
}
