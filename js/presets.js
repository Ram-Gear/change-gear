// presets.js - saved index gear sets per machine (v1.6). Pure, no DOM; tested in test/presets.test.mjs.
// A preset: { z, A, B, C, D, note }  (C and D empty for a 2-gear A/B set).

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
  if (!posInt(p.z)) errors.push('z must be a whole number above 0');
  if (!posInt(p.A)) errors.push('A must be a whole number above 0');
  if (!posInt(p.B)) errors.push('B must be a whole number above 0');
  if (blank(p.C) && blank(p.D)) { /* 2-gear set */ }
  else if (!posInt(p.C) || !posInt(p.D)) errors.push('C and D must both be whole numbers (or both empty for a 2-gear set)');
  else { out.C = Number(p.C); out.D = Number(p.D); }
  return { preset: out, errors };
}

export function presetRatio(p) {
  const r = Number(p.A) / Number(p.B);
  return p.C && p.D ? r * (Number(p.C) / Number(p.D)) : r;
}
export function presetError(p, target) { return presetRatio(p) / target - 1; }
export function presetsFor(presets, z) { return (presets || []).filter((p) => Number(p.z) === Number(z)); }
export function presetText(p) { return `${p.A}/${p.B}${p.C ? ` × ${p.C}/${p.D}` : ''}`; }

// Hint for a prime z with no preset and no inventory gear whose tooth count is a multiple of z.
export function primeHint(z, inventoryGears, presets) {
  z = Number(z);
  if (!isPrime(z) || presetsFor(presets, z).length) return null;
  if ((inventoryGears || []).some((g) => Number(g.qty ?? 1) > 0 && Number(g.teeth) % z === 0)) return null;
  return `z = ${z} is prime – you need a ${z}-tooth gear (or a multiple); add a preset.`;
}

// From a ranked search match {A,B,C,D}
export function presetFromMatch(z, m, note = '') {
  const p = { z: Number(z), A: m.A, B: m.B, note };
  if (m.C && m.D) { p.C = m.C; p.D = m.D; }
  return p;
}

// Add or replace (same z and same gears -> replace note; otherwise append). Sorted by z.
export function upsertPreset(presets, p) {
  const list = [...(presets || [])];
  const k = list.findIndex((x) => Number(x.z) === p.z && presetText(x) === presetText(p));
  if (k >= 0) list[k] = p; else list.push(p);
  return list.sort((a, b) => a.z - b.z);
}

// ---------------------------------------------------------------- CSV: z,A,B,C,D,note
const q = (s) => (/[",;\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
export function presetsToCsv(presets) {
  return ['z,A,B,C,D,note', ...(presets || []).map((p) => [p.z, p.A, p.B, p.C ?? '', p.D ?? '', q(p.note || '')].join(','))].join('\r\n') + '\r\n';
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
  let col = { z: 0, A: 1, B: 2, C: 3, D: 4, note: 5 }, header = false, seen = false;
  const rows = [], bad = [];
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw, sep);
    if (!seen) {
      seen = true;
      if (!/^\d/.test(cells[0] || '') && /[a-z]/i.test(cells.join(''))) {
        header = true;
        const f = (re, d) => { const k = cells.findIndex((c) => re.test(c)); return k >= 0 ? k : d; };
        col = { z: f(/^(z|teeth|tooth count)$/i, 0), A: f(/^a$/i, 1), B: f(/^b$/i, 2), C: f(/^c$/i, 3), D: f(/^d$/i, 4), note: f(/^(notes?|comment)$/i, 5) };
        return;
      }
    }
    if (cells.every((c) => !c)) return;
    const get = (k) => cells[col[k]] ?? '';
    const { preset, errors } = cleanPreset({ z: get('z'), A: get('A'), B: get('B'), C: get('C'), D: get('D'), note: get('note') });
    if (errors.length) bad.push({ line: i + 1, text: raw, reason: errors.join('; ') });
    else rows.push({ ...preset, line: i + 1 });
  });
  return { rows, bad, header };
}
