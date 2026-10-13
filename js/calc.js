// calc.js - pure calculation API (no DOM). Usable from the browser and from Node:
//   import * as calc from './js/calc.js'
export * as mbf from './mbf.js';
export { makeBackend, formatSig } from './numeric.js';
export { compileMachine, evaluateMachine, parseFormula, parsePrintLine, formatPrintLine, FUNCTIONS, RESERVED, FormulaError, sigilOf } from './formula.js';
export { legacyRamgear, legacyFirstN, rankedSearch, bcBreakdown, bcSummaryLine, LEGACY } from './search.js';
export { BUILTIN_MACHINES, BUILTIN_INVENTORIES } from './machines.js';

import { compileMachine, evaluateMachine } from './formula.js';
import { legacyRamgear, rankedSearch, bcBreakdown } from './search.js';
import { BUILTIN_MACHINES, BUILTIN_INVENTORIES } from './machines.js';

export const BUNDLE_FORMAT = 'ramgear-change-gear';
export const BUNDLE_VERSION = 1;

export function getBuiltin(id) { return BUILTIN_MACHINES.find((m) => m.id === id || m.menu === id); }

// Convenience: run a built-in (or any) machine with inputs given as text.
export function runMachine(defOrId, inputs, opts = {}) {
  const def = typeof defOrId === 'string' ? getBuiltin(defOrId) : defOrId;
  if (!def) throw new Error(`No machine "${defOrId}"`);
  return evaluateMachine(def, inputs, opts);
}

// Merge a train definition with an optional user override {inventory, strategy, useInventory, gears, maxResults, tolerance}
export function effectiveTrain(train, override) {
  return { ...train, ...(override || {}) };
}

export function inventoryMap(inv) {
  const m = new Map();
  for (const g of (inv && inv.gears) || []) m.set(Number(g.teeth), (m.get(Number(g.teeth)) || 0) + Number(g.qty === undefined ? 1 : g.qty));
  return m;
}

// Run one gear train of an evaluated machine.
//  - legacy-ramgear returns a generator (call next() for each "CONTINUE")
//  - ranked returns {list}
//  - bc-breakdown returns {tables:[{name, value, rows}]}
export function runTrain(result, train, inventories = BUILTIN_INVENTORIES, opts = {}) {
  const num = result.num;
  if (train.strategy === 'bc-breakdown') {
    return {
      type: 'bc-breakdown',
      tables: (train.values || []).map((n) => {
        const name = n.toUpperCase();
        const value = result.env.get(name);
        return { name, value, text: num.format(value).trim(), rows: bcBreakdown(value, num, train.from || 20, train.to || 120) };
      }),
    };
  }
  const name = String(train.ratio).toUpperCase();
  const R = result.env.get(name);
  const inv = inventories.find((i) => i.id === train.inventory);
  if (train.strategy === 'legacy-ramgear') {
    const useInv = train.useInventory && inv ? inventoryMap(inv) : null;
    return { type: 'legacy', R, gen: legacyRamgear(R, num, { inventory: useInv, maxD: opts.maxD, yieldEvery: opts.yieldEvery }) };
  }
  if (train.strategy === 'ranked') {
    if (!inv) throw new Error(`Inventory "${train.inventory}" not found`);
    return { type: 'ranked', R, list: rankedSearch(num.toJS(R), inv.gears, { gears: train.gears || 4, maxResults: train.maxResults || 20, tolerance: train.tolerance }) };
  }
  throw new Error(`Unknown strategy ${train.strategy}`);
}

// ------------------------------------------------------------ import / export
export function makeBundle({ machines = [], builtinOverrides = {}, inventories = [] }) {
  return {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: new Date().toISOString(),
    machines: machines.filter((m) => !m.builtin),
    builtinOverrides,
    inventories: inventories.filter((i) => !i.builtin),
  };
}

export function validateInventory(inv) {
  const errs = [];
  if (!inv || typeof inv !== 'object') return ['not an object'];
  if (!inv.id) errs.push('missing id');
  if (!inv.name) errs.push('missing name');
  if (!Array.isArray(inv.gears)) errs.push('gears must be a list');
  else inv.gears.forEach((g, i) => {
    if (!(Number.isInteger(Number(g.teeth)) && Number(g.teeth) > 0)) errs.push(`gear ${i + 1}: teeth must be a whole number > 0`);
    if (g.qty !== undefined && !(Number.isInteger(Number(g.qty)) && Number(g.qty) >= 0)) errs.push(`gear ${i + 1}: qty must be a whole number`);
  });
  return errs;
}

// Returns {ok, errors, machines, inventories, builtinOverrides}
export function parseBundle(json) {
  let data;
  const errors = [];
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return { ok: false, errors: ['File is not valid JSON: ' + e.message] }; }
  if (!data || data.format !== BUNDLE_FORMAT) return { ok: false, errors: [`Not a ${BUNDLE_FORMAT} file (missing "format")`] };
  if (data.version > BUNDLE_VERSION) errors.push(`File version ${data.version} is newer than this app (${BUNDLE_VERSION})`);
  const machines = [], inventories = [];
  for (const m of data.machines || []) {
    if (BUILTIN_MACHINES.some((b) => b.id === m.id)) { errors.push(`Machine "${m.name}": id "${m.id}" belongs to a built-in machine`); continue; }
    const c = compileMachine(m);
    if (!m.id) errors.push(`Machine "${m.name}": missing id`);
    else if (!c.ok) errors.push(...c.errors.map((e) => `Machine "${m.name}": ${e.where}: ${e.msg}`));
    else machines.push({ ...m, builtin: false });
  }
  for (const inv of data.inventories || []) {
    const e = validateInventory(inv);
    if (BUILTIN_INVENTORIES.some((b) => b.id === inv.id)) e.push('id belongs to a built-in inventory');
    if (e.length) errors.push(...e.map((x) => `Inventory "${inv.name}": ${x}`));
    else inventories.push({ ...inv, builtin: false });
  }
  const builtinOverrides = {};
  for (const [id, ov] of Object.entries(data.builtinOverrides || {})) {
    if (!BUILTIN_MACHINES.some((b) => b.id === id)) { errors.push(`Override for unknown built-in "${id}" ignored`); continue; }
    builtinOverrides[id] = ov;
  }
  return { ok: errors.length === 0, errors, machines, inventories, builtinOverrides };
}

// A fresh custom machine skeleton
export function newMachineTemplate() {
  return {
    id: 'custom-' + Math.random().toString(36).slice(2, 9),
    name: 'New machine', builtin: false, numeric: 'float64',
    description: '',
    inputs: [
      { name: 'HELIX', label: 'Helix angle', unit: 'degrees', example: '20' },
      { name: 'MN', label: 'Normal module', unit: 'mm', example: '3' },
      { name: 'STARTS', label: 'Hob starts', unit: 'starts', example: '1' },
    ],
    constants: [{ name: 'KDIFF', expr: '7.95775', label: 'Differential constant (example only - use your machine plate value)' }],
    formulas: [{ name: 'RDIFF', expr: 'KDIFF * SIND(HELIX) / (MN * STARTS)', label: 'Differential ratio' }],
    outputs: [{ name: 'RDIFF', label: 'Differential ratio needed', format: 'fixed:6' }],
    report: [],
    trains: [{ kind: 'differential', label: 'Differential change gears', ratio: 'RDIFF', strategy: 'ranked', inventory: 'legacy-20-88', gears: 4, maxResults: 20 }],
  };
}
