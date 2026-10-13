// gearcsv.js - gear-list CSV import/export (pure, no DOM; tested in test/gearcsv.test.mjs).
// Format: teeth,qty,note  - qty defaults to 1, note optional, header row optional,
// a single column of tooth counts is fine, comma / semicolon / tab separators (Excel exports).

function splitLine(line, sep) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function detectSeparator(text) {
  const first = String(text).split(/\r?\n/).find((l) => l.trim()) || '';
  if (first.includes(';')) return ';';
  if (first.includes('\t')) return '\t';
  return ',';
}

const isWhole = (s) => /^\d+$/.test(s);

// Returns { rows: [{line, teeth, qty, note}], bad: [{line, text, reason}], header: bool, sep }
export function parseGearCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const sep = detectSeparator(src);
  const lines = src.split(/\r?\n/);
  const rows = [], bad = [];
  let col = { teeth: 0, qty: 1, note: 2 }, header = false, seenFirst = false;
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cells = splitLine(raw, sep);
    if (!seenFirst) {
      seenFirst = true;
      if (cells.length && !/^\d/.test(cells[0]) && /[a-z]/i.test(cells.join(''))) {
        header = true;
        const find = (re, d) => { const k = cells.findIndex((c) => re.test(c)); return k >= 0 ? k : d; };
        col = { teeth: find(/^(teeth|tooth|tooth ?count|t|z|n)$/i, 0), qty: find(/^(qty|quantity|count|number|how many|pcs)$/i, 1), note: find(/^(notes?|comment|remarks?)$/i, 2) };
        return;
      }
    }
    const t = cells[col.teeth] ?? '';
    const qs = (cells[col.qty] ?? '').trim();
    const note = (cells[col.note] ?? '').trim();
    if (cells.every((c) => !c)) return;
    if (!isWhole(t) || Number(t) <= 0) { bad.push({ line, text: raw, reason: `tooth count "${t}" is not a whole number above 0` }); return; }
    if (qs && !isWhole(qs)) { bad.push({ line, text: raw, reason: `quantity "${qs}" is not a whole number` }); return; }
    rows.push({ line, teeth: Number(t), qty: qs ? Number(qs) : 1, note });
  });
  return { rows, bad, header, sep };
}

const q = (s) => (/[",;\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
export function gearsToCsv(gears) {
  return ['teeth,qty,note', ...(gears || []).map((g) => `${g.teeth},${g.qty === undefined ? 1 : g.qty},${q(g.note || '')}`)].join('\r\n') + '\r\n';
}

export const SAMPLE_CSV = 'teeth,qty,note\r\n20,1,\r\n24,2,one is chipped\r\n30,1,\r\n36,1,\r\n40,2,\r\n48,1,\r\n60,1,\r\n72,1,\r\n';

// Merge two gear lists: same tooth count -> quantities add, notes are joined.
export function mergeGears(a, b) {
  const m = new Map();
  for (const g of [...(a || []), ...(b || [])]) {
    const k = Number(g.teeth);
    const cur = m.get(k);
    if (!cur) m.set(k, { teeth: k, qty: Number(g.qty ?? 1), note: g.note || '' });
    else { cur.qty += Number(g.qty ?? 1); if (g.note && !cur.note.split('; ').includes(g.note)) cur.note = cur.note ? `${cur.note}; ${g.note}` : g.note; }
  }
  return [...m.values()].sort((x, y) => x.teeth - y.teeth).map((g) => (g.note ? g : { teeth: g.teeth, qty: g.qty }));
}
