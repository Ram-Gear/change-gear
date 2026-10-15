import { simpleTemplate } from './simple.js';
export * as simple from './simple.js';
export * as gearcsv from './gearcsv.js';
export * as presets from './presets.js';
// calc.js - pure calculation API (no DOM). Usable from the browser and from Node:
//   import * as calc from './js/calc.js'
export * as mbf from './mbf.js';
export { makeBackend, formatSig } from './numeric.js';
export { compileMachine, evaluateMachine, parseFormula, parsePrintLine, formatPrintLine, FUNCTIONS, RESERVED, FormulaError, sigilOf } from './formula.js';
export { rankedNextBatch, trainKey } from './search.js';
export { legacyRamgear, legacyFirstN, rankedSearch, bcBreakdown, bcSummaryLine, LEGACY } from './search.js';
export { BUILTIN_MACHINES, BUILTIN_INVENTORIES } from './machines.js';

import { compileMachine, evaluateMachine } from './formula.js';
import { rankedNextBatch, legacyRamgear, rankedSearch, bcBreakdown } from './search.js';
import { cleanPreset } from './presets.js';
import { BUILTIN_MACHINES, BUILTIN_INVENTORIES, REMOVED_BUILTIN_IDS } from './machines.js';
export { REMOVED_BUILTIN_IDS };

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
    const ro = { gears: train.gears || 4, maxResults: train.maxResults || 20, tolerance: train.tolerance };
    if (opts.shown) { const nb = rankedNextBatch(num.toJS(R), inv.gears, ro, opts.shown); return { type: 'ranked', R, list: nb.list, exhausted: nb.exhausted }; }
    return { type: 'ranked', R, list: rankedSearch(num.toJS(R), inv.gears, ro) };
  }
  throw new Error(`Unknown strategy ${train.strategy}`);
}

// ------------------------------------------------------------ import / export
export function makeBundle({ machines = [], builtinOverrides = {}, inventories = [], manuals }) {
  const b = {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: new Date().toISOString(),
    machines: machines.filter((m) => !m.builtin),
    builtinOverrides,
    inventories: inventories.filter((i) => !i.builtin),
  };
  if (manuals && Object.keys(manuals).length) b.manuals = manuals; // base64 PDFs, only when asked for
  return b;
}

// Validate a list of index gear presets; returns { presets, errors }
export function cleanPresets(list, where) {
  const presets = [], errors = [];
  if (list === undefined) return { presets: undefined, errors };
  if (!Array.isArray(list)) return { presets: [], errors: [`${where}: index presets must be a list`] };
  list.forEach((p, i) => { const c = cleanPreset(p || {}); if (c.errors.length) errors.push(`${where}: preset ${i + 1} skipped (${c.errors.join('; ')})`); else presets.push(c.preset); });
  return { presets, errors };
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
    else {
      const cp = cleanPresets(m.indexPresets, `Machine "${m.name}"`); errors.push(...cp.errors);
      machines.push(cp.presets ? { ...m, builtin: false, indexPresets: cp.presets } : { ...m, builtin: false });
    }
  }
  for (const inv of data.inventories || []) {
    const e = validateInventory(inv);
    if (BUILTIN_INVENTORIES.some((b) => b.id === inv.id)) e.push('id belongs to a built-in inventory');
    if (e.length) errors.push(...e.map((x) => `Inventory "${inv.name}": ${x}`));
    else inventories.push({ ...inv, builtin: false });
  }
  const builtinOverrides = {};
  for (const [id, ov] of Object.entries(data.builtinOverrides || {})) {
    if (REMOVED_BUILTIN_IDS.includes(id)) continue; // settings for a removed original program: silently dropped
    if (!BUILTIN_MACHINES.some((b) => b.id === id)) { errors.push(`Override for unknown built-in "${id}" ignored`); continue; }
    const cp = cleanPresets(ov && ov.indexPresets, `Built-in "${id}"`); errors.push(...cp.errors);
    builtinOverrides[id] = cp.presets ? { ...ov, indexPresets: cp.presets } : ov;
  }
  const manuals = {};
  for (const [id, r] of Object.entries(data.manuals || {})) {
    if (!r || typeof r.data !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(r.data)) { errors.push(`Manual for "${id}" is damaged and was skipped`); continue; }
    manuals[id] = { name: String(r.name || 'manual.pdf'), type: String(r.type || 'application/pdf'), size: r.size, data: r.data.replace(/\s+/g, '') };
  }
  return { ok: errors.length === 0, errors, machines, inventories, builtinOverrides, manuals };
}

// A fresh custom machine skeleton
export function newMachineTemplate() { return simpleTemplate(); }
