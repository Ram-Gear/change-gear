// simple.js - the "simple setup" of the machine editor (v1.5): an Index section and a
// Differential section, each with one constant box, a pre-built formula and its own gear
// train. Pure functions on a machine definition (no DOM) so they can be unit tested.

export const OWN_INV = '__own__'; // placeholder: "this machine's own gear list", created on save

const DEF_INPUTS = {
  Z: { name: 'Z', label: 'Number of teeth in gear (z)', unit: 'teeth', example: '40' },
  K: { name: 'K', label: 'Hob starts (K)', unit: 'starts', example: '1' },
  B: { name: 'B', label: 'Helix angle', unit: 'degrees', example: '30' },
  D: { name: 'D', label: 'Normal module (metric) or normal DP (inch)', unit: 'module or DP', example: '8' },
  Q: { name: 'Q', type: 'choice', label: 'Inch or metric', default: 1, options: [{ value: 0, label: 'Inch - cutter normal diametral pitch (DP)' }, { value: 1, label: 'Metric - cutter normal module' }] },
};
const up = (s) => String(s || '').toUpperCase();
const has = (arr, n) => (arr || []).some((x) => up(x.name) === n);

export function trainOf(m, kind) { return (m.trains || []).find((t) => t.kind === kind) || null; }

// Which constant is "the" constant of a section, and the formula behind it.
export function sectionInfo(m, kind) {
  const t = trainOf(m, kind);
  if (!t) return null;
  const f = (m.formulas || []).find((x) => up(x.name) === up(t.ratio)) || null;
  const names = kind === 'index' ? ['KIDX'] : ['KDIFF', 'O'];
  const c = (m.constants || []).find((x) => names.includes(up(x.name)) && f && new RegExp(`\\b${x.name}\\b`, 'i').test(f.expr)) || null;
  return { train: t, formula: f, constant: c };
}

// FO-10 (and copies) write the index constant into the formula (24 * K / Z); pull it out
// into an "Index constant" box. Gives the same number (24 is exact in any precision).
export function normalizeIndex(m) {
  const t = trainOf(m, 'index'); if (!t) return m;
  const f = (m.formulas || []).find((x) => up(x.name) === up(t.ratio));
  const mm = f && /^\s*(\d+(?:\.\d+)?)\s*\*\s*K\s*\/\s*Z\s*$/i.exec(f.expr);
  if (mm && !has(m.constants, 'KIDX')) {
    m.constants.push({ name: 'KIDX', expr: mm[1], label: 'Index constant' });
    f.expr = 'KIDX * K / Z';
  }
  return m;
}

function ensureInputs(m, names) {
  m.inputs = m.inputs || [];
  for (const n of names) if (!has(m.inputs, n)) m.inputs.push(JSON.parse(JSON.stringify(DEF_INPUTS[n])));
}

export function addIndex(m, constant = '24') {
  m.constants = m.constants || []; m.formulas = m.formulas || []; m.outputs = m.outputs || []; m.trains = m.trains || [];
  if (trainOf(m, 'index')) return m;
  ensureInputs(m, ['Z', 'K']);
  if (!has(m.constants, 'KIDX')) m.constants.push({ name: 'KIDX', expr: String(constant), label: 'Index constant' });
  if (!has(m.formulas, 'RIDX')) m.formulas.push({ name: 'RIDX', expr: 'KIDX * K / Z', label: 'Index ratio = index constant × hob starts ÷ z' });
  if (!has(m.outputs, 'RIDX')) m.outputs.push({ name: 'RIDX', label: 'Index ratio', format: m.numeric === 'gwbasic' ? 'basic' : 'fixed:6' });
  m.trains.push({ kind: 'index', label: 'Index change gears (A/B × C/D)', ratio: 'RIDX', strategy: 'ranked', inventory: OWN_INV, gears: 4, maxResults: 20 });
  return m;
}

export function addDifferential(m, constant = '11.9367') {
  m.constants = m.constants || []; m.formulas = m.formulas || []; m.outputs = m.outputs || []; m.trains = m.trains || [];
  if (trainOf(m, 'differential')) return m;
  ensureInputs(m, ['B', 'D', 'K', 'Q']);
  if (!has(m.constants, 'KDIFF')) m.constants.push({ name: 'KDIFF', expr: String(constant), label: 'Differential constant' });
  if (!has(m.constants, 'MM')) m.constants.push({ name: 'MM', expr: '25.4', label: 'Millimetres per inch' });
  if (!has(m.formulas, 'RDIFF')) m.formulas.push({ name: 'RDIFF', expr: 'IF(Q = 1, KDIFF * SIND(B) / D / K, (KDIFF / MM) * SIND(B) * D / K)', label: 'Differential ratio (same form as Fauter / FD-500)' });
  if (!has(m.outputs, 'RDIFF')) m.outputs.push({ name: 'RDIFF', label: 'Differential ratio', format: m.numeric === 'gwbasic' ? 'basic' : 'fixed:6' });
  m.trains.push({ kind: 'differential', label: 'Differential change gears (A/B × C/D)', ratio: 'RDIFF', strategy: 'ranked', inventory: OWN_INV, gears: 4, maxResults: 20 });
  return m;
}

const refs = (m, n) => [...(m.formulas || []), ...(m.constants || [])].some((x) => new RegExp(`\\b${n}\\b`, 'i').test(x.expr || ''))
  || (m.report || []).some((l) => new RegExp(`\\b${n}\\b`, 'i').test(l.replace(/"[^"]*"/g, '')));

// Remove a section: its train, its result line, and its formula/constant/inputs when nothing else uses them.
export function removeSection(m, kind) {
  const t = trainOf(m, kind); if (!t) return m;
  const R = up(t.ratio);
  m.trains = m.trains.filter((x) => x !== t);
  if (!m.trains.some((x) => up(x.ratio) === R)) {
    m.outputs = (m.outputs || []).filter((o) => up(o.name) !== R);
    m.report = (m.report || []).filter((l) => !new RegExp(`\\b${R}\\b`, 'i').test(l.replace(/"[^"]*"/g, '')));
    const f = (m.formulas || []).find((x) => up(x.name) === R);
    if (f && !refs({ ...m, formulas: m.formulas.filter((x) => x !== f) }, R)) m.formulas = m.formulas.filter((x) => x !== f);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of [...(m.constants || [])]) if (!refs(m, up(c.name)) && !(m.outputs || []).some((o) => up(o.name) === up(c.name))) { m.constants = m.constants.filter((x) => x !== c); changed = true; }
    for (const f of [...(m.formulas || [])]) if (!refs(m, up(f.name)) && !(m.outputs || []).some((o) => up(o.name) === up(f.name)) && !m.trains.some((x) => up(x.ratio) === up(f.name))) { m.formulas = m.formulas.filter((x) => x !== f); changed = true; }
  }
  m.inputs = (m.inputs || []).filter((i) => i.type === 'text' || !DEF_INPUTS[up(i.name)] || refs(m, up(i.name)));
  return m;
}

export function simpleTemplate() {
  const m = {
    id: 'custom-' + Math.random().toString(36).slice(2, 9),
    name: 'New machine', builtin: false, numeric: 'float64', description: '',
    inputs: [], constants: [], formulas: [], outputs: [], report: [], trains: [],
  };
  addIndex(m); addDifferential(m);
  // inputs in the order Gary listed them
  const order = ['Z', 'K', 'B', 'D', 'Q'];
  m.inputs.sort((a, b) => order.indexOf(up(a.name)) - order.indexOf(up(b.name)));
  return m;
}

export function ownInventoryName(machineName, kind) { return `${machineName || 'Machine'} ${kind === 'index' ? 'index' : 'differential'} gears`; }
