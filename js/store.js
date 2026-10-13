// store.js - the ONLY module that touches persistent storage (v1.6).
// Everything is async so the localStorage/IndexedDB backend here can later be swapped for a
// server backend (e.g. Supabase with logins and an admin role) without changing app.js.
//   load()  -> { machines, inventories, builtinOverrides, lastInputs, settings }
//   save(data) -> true if kept, false if this browser blocks storage (data stays in memory)
//   manuals: getManual / putManual / deleteManual / listManuals / exportManuals / importManuals
import * as idb from './manuals.js';

const STORE_KEY = 'ramgear.changegear.v1';
let problem = null;
const listeners = [];
export function onProblem(fn) { listeners.push(fn); if (problem) fn(problem); }
function report(e) { const first = !problem; problem = problem || e; if (first) listeners.forEach((f) => f(problem)); }
export const storageProblem = () => problem;
export const backendName = 'this browser (localStorage + IndexedDB)';

const empty = () => ({ machines: [], inventories: [], builtinOverrides: {}, lastInputs: {}, settings: {} });

export async function load(removedBuiltinIds = []) {
  let raw = null;
  try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { report(e); }
  try {
    const s = JSON.parse(raw || '{}') || {};
    const ov = (s.builtinOverrides && typeof s.builtinOverrides === 'object') ? s.builtinOverrides : {};
    for (const id of removedBuiltinIds) delete ov[id];
    return { machines: s.machines || [], inventories: s.inventories || [], builtinOverrides: ov, lastInputs: s.lastInputs || {}, settings: s.settings || {} };
  } catch (e) { return empty(); }
}

export async function save(data) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(data)); return true; } catch (e) { report(e); return false; }
}

export const manualsAvailable = idb.available;
export const getManual = idb.getManual;
export const putManual = idb.putManual;
export const deleteManual = idb.deleteManual;
export const listManuals = idb.listManuals;
export const exportManuals = idb.exportManuals;
export const importManuals = idb.importManuals;
export const looksLikePdf = idb.looksLikePdf;
