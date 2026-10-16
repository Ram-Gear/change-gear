// manuals.js - machine user manual PDFs kept in this browser's IndexedDB (v1.6). Never in
// localStorage (too big) and never in the repo. Record: { id: machineId, name, type, size, added, blob }
const DB = 'ramgear-change-gear', STORE = 'manuals';
let dbp = null;
export function available() { try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; } }
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!available()) { reject(new Error('IndexedDB is not available in this browser (private window or blocked site data)')); return; }
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not open IndexedDB'));
    r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode); const s = t.objectStore(STORE);
    const req = fn(s);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  });
}
// v1.8.8: several manuals per machine. New records: { id: '<machineId>/<file name>', machine, name, type, size, added, blob }.
// v1.6-v1.8.7 records ({ id: machineId, name, ... } with no 'machine') are still read as that machine's file and
// are rewritten to the new key the first time they are saved again (migrateLegacy / putManual).
export const keyOf = (machine, name) => `${machine}/${name}`;
export const machineOf = (r) => (r && (r.machine || r.id)) || '';
export const getManual = (id) => tx('readonly', (s) => s.get(id)); // raw get by record key (legacy: machine id)
export const deleteManual = (id) => tx('readwrite', (s) => s.delete(id));
export const listManuals = () => tx('readonly', (s) => s.getAll());
export async function listMachineManuals(machine) { return (await listManuals()).filter((r) => machineOf(r) === machine); }
export async function getManualFile(machine, name) { return (await listMachineManuals(machine)).find((r) => r.name === name) || null; }
export async function putManual(machine, blob, name) {
  name = name || 'manual.pdf';
  for (const r of await listMachineManuals(machine)) if (!r.machine && r.name === name) await deleteManual(r.id); // replace legacy record
  return tx('readwrite', (s) => s.put({ id: keyOf(machine, name), machine, name, type: blob.type || 'application/pdf', size: blob.size, added: new Date().toISOString(), blob }));
}
export async function deleteManualFile(machine, name) { for (const r of await listMachineManuals(machine)) if (r.name === name) await deleteManual(r.id); }
export async function deleteMachineManuals(machine) { for (const r of await listMachineManuals(machine)) await deleteManual(r.id); }
export function looksLikePdf(file) { return !!file && (/pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '')); }

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBlob(b64, type = 'application/pdf') {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
// For JSON export: { '<machine>/<name>': { machine, name, type, size, data(base64) } } (v1.8.8; older files used { machineId: {...} })
export async function exportManuals(ids) {
  const out = {};
  for (const r of await listManuals()) { const mid = machineOf(r); if (!ids || ids.includes(mid)) out[keyOf(mid, r.name)] = { machine: mid, name: r.name, type: r.type, size: r.size, data: await blobToBase64(r.blob) }; }
  return out;
}
export async function importManuals(obj) {
  let n = 0;
  for (const [id, r] of Object.entries(obj || {})) { await putManual(r.machine || id, base64ToBlob(r.data, r.type || 'application/pdf'), r.name); n++; }
  return n;
}
