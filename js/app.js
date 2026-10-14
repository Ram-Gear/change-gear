// app.js - browser UI. All maths lives in calc.js (and the modules it re-exports).
import * as calc from './calc.js';

import * as dataStore from './store.js';
export const APP_VERSION = 'RAM-GEAR web v1.8 (2026-10-14)';
// Browser storage can be blocked (Edge/Chrome "block site data", some file:// policies, private
// windows, full quota). Never let that stop a calculation: fall back to memory and say so.
function showStorageBanner(problem) {
  if (document.getElementById('storage-banner')) return;
  const d = document.createElement('div'); d.id = 'storage-banner'; d.className = 'msg warn';
  d.textContent = 'This browser is blocking saved data for this page (' + ((problem && problem.message) || 'storage unavailable') + '). Calculations still work, but gear inventories, your machines and last inputs will not be kept after you close the page. Use Import / export to save a backup, or allow site data for this file in browser settings.';
  const main = document.getElementById('main'); if (main && main.parentNode) main.parentNode.insertBefore(d, main); else document.body.prepend(d);
}
const $main = document.getElementById('main');
const $nav = document.getElementById('nav');

// ------------------------------------------------------------------ storage (all access via store.js)
// v1.7: sign in first (same accounts as the QC Form). Role none / signed out sees only the login screen.
const canEdit = () => dataStore.auth.canEdit === true;
const canDelete = () => dataStore.auth.canDelete === true;
// v1.8 Verify & lock: a locked machine's definition (inputs, constants, formulas, outputs, trains) is frozen for everyone.
const isLocked = (m) => !!(m && m.lock && m.lock.locked);
const lockText = (m) => `Locked${m.lock.lockedBy ? ' by ' + m.lock.lockedBy : ''}${m.lock.lockedAt ? ' on ' + new Date(m.lock.lockedAt).toLocaleString() : ''}`;
function lockBadge(m) { return isLocked(m) ? h('span', { class: 'badge locked', id: 'lock-badge', title: lockText(m) }, '🔒 ' + lockText(m)) : (m.builtin ? null : h('span', { class: 'badge draft', id: 'draft-badge' }, 'Draft')); }
function lockSummary(m) {
  const lines = [`Verify & lock "${m.name}"?`, '', 'Constants:', ...(m.constants || []).map((c) => `  ${c.name} = ${c.expr}`), 'Formulas:', ...(m.formulas || []).map((f) => `  ${f.name} = ${f.expr}`),
    'Inputs: ' + (m.inputs || []).map((i) => i.name).join(', '), 'Gear trains: ' + (m.trains || []).map((t) => `${t.kind} (${t.ratio || ''})`).join(', '), '',
    'After locking, NOBODY (admins included) can change these formulas, constants, inputs or trains.', 'Gear lists and index presets stay editable by admins. You can still copy it to a new draft.'];
  return lines.join('\n');
}
function verifyAndLock(m) {
  const mm = store.machines.find((x) => x.id === m.id); if (!mm || isLocked(mm) || !canEdit()) return;
  const c = calc.compileMachine(mm);
  if (!c.ok) { alert('This machine has formula errors - fix them before locking.'); return; }
  if (!confirm(lockSummary(mm))) return;
  mm.lock = { locked: true, lockedAt: new Date().toISOString(), lockedBy: dataStore.auth.username || 'admin' };
  saveStore(); route();
}
function deleteMachine(m) {
  const mm = store.machines.find((x) => x.id === m.id); if (!mm || mm.builtin || !canDelete()) return;
  if (!confirm(`Delete machine "${mm.name}"${isLocked(mm) ? ' (LOCKED)' : ''} for everyone (shared database)? This cannot be undone here - export first if you want a backup.`)) return;
  const own = Object.values(mm.ownInventories || {}).filter((iid) => store.inventories.some((x) => x.id === iid));
  if (own.length && confirm(`Also delete its gear lists (${own.map((iid) => store.inventories.find((x) => x.id === iid).name).join(', ')})?\nOK = delete them too, Cancel = keep them.`)) store.inventories = store.inventories.filter((x) => !own.includes(x.id));
  store.machines = store.machines.filter((x) => x.id !== mm.id); saveStore();
  dataStore.getManual(mm.id).then((rec) => {
    if (rec && confirm(`This machine has a manual attached (${rec.name}). Delete the manual too?\nOK = delete it, Cancel = keep it in this browser.`)) return dataStore.deleteManual(mm.id);
  }).catch(() => {}).finally(() => { location.hash = '#/'; });
}
// Remove an index / differential train from a DRAFT machine (its gear list is kept unless the admin also deletes it).
function removeTrain(m, kind) {
  const mm = store.machines.find((x) => x.id === m.id); if (!mm || isLocked(mm) || !canDelete()) return;
  if (!confirm(`Remove the ${kind} gear train (and its ratio formula) from "${mm.name}"?`)) return;
  S.removeSection(mm, kind);
  const iid = (mm.ownInventories || {})[kind];
  if (iid) { delete mm.ownInventories[kind]; const inv = store.inventories.find((x) => x.id === iid);
    if (inv && confirm(`Also delete its gear list "${inv.name}"?\nOK = delete it, Cancel = keep it under Gear inventories.`)) store.inventories = store.inventories.filter((x) => x !== inv); }
  saveStore(); route();
}
// Delete a gear list; any machine train using it falls back to the built-in 20-88 list.
function deleteInventory(inv) {
  if (!canDelete()) return false;
  const users = store.machines.filter((m) => (m.trains || []).some((t) => t.inventory === inv.id));
  if (!confirm(`Delete gear list "${inv.name}"?${users.length ? `\nUsed by: ${users.map((m) => m.name).join(', ')} - they will use the built-in 20-88 list until you give them a new one.` : ''}`)) return false;
  for (const m of store.machines) {
    for (const t of m.trains || []) if (t.inventory === inv.id) t.inventory = 'legacy-20-88';
    for (const [k, v] of Object.entries(m.ownInventories || {})) if (v === inv.id) delete m.ownInventories[k];
  }
  for (const o of Object.values(store.builtinOverrides || {})) for (const t of Object.values(o.trains || {})) if (t.inventory === inv.id) delete t.inventory;
  store.inventories = store.inventories.filter((x) => x !== inv); saveStore(); return true;
}
function clearInventory(inv) {
  if (!canDelete() || !confirm(`Clear every gear from "${inv.name}"? The list itself is kept (empty).`)) return false;
  inv.gears = []; saveStore(); return true;
}
let auth;
try { auth = await dataStore.init(calc.BUILTIN_MACHINES, calc.REMOVED_BUILTIN_IDS); }
catch (e) { auth = dataStore.auth; auth.error = 'Could not reach the shared database: ' + ((e && e.message) || e); }
let store = null;
while (!store) {
  while (!auth.canView) auth = await loginScreen(auth);
  try { store = await dataStore.load(); }
  catch (e) { auth = { ...dataStore.auth, canView: false, error: 'Could not load the shared data: ' + ((e && e.message) || e) }; }
}
dataStore.onProblem((p) => setTimeout(() => showStorageBanner(p), 0));
dataStore.onSyncState((s) => showSyncState(s));
function saveStore() { dataStore.save(store).catch((e) => console.error(e)); }
window.__rgData = async () => { await dataStore.whenSynced(); return JSON.parse(JSON.stringify(store)); }; // read-only snapshot for the browser tests
function showSyncState(s) {
  let d = document.getElementById('sync-banner');
  if (s.ok) { if (d) d.remove(); return; }
  if (!d) { d = document.createElement('div'); d.id = 'sync-banner'; d.className = 'msg err'; const main = document.getElementById('main'); main.parentNode.insertBefore(d, main); }
  d.textContent = 'Your last change was NOT saved to the shared database: ' + s.error + '. Reload the page to see what is saved.';
}
function loginScreen(a) {
  const main = document.getElementById('main');
  document.getElementById('nav').replaceChildren();
  return new Promise((resolve) => {
    const err = document.createElement('div');
    const card = document.createElement('div'); card.className = 'card login-card'; card.id = 'login';
    if (a.signedIn && !a.error) {
      card.innerHTML = '<h2>No access to Change Gear</h2><p>You are signed in as <b></b>, but your account has no Change Gear access (role: none). Ask an admin to give you the viewer or admin role in QC Form admin.</p>';
      card.querySelector('b').textContent = a.username;
      const b = document.createElement('button'); b.textContent = 'Sign out'; b.id = 'login-signout';
      b.onclick = async () => { await dataStore.signOut().catch(() => {}); resolve(dataStore.auth); };
      card.append(b); main.replaceChildren(card); return;
    }
    card.innerHTML = '<h2>Sign in</h2><p class="muted">Use your RAM-GEAR username and PIN (the same as the QC Form).</p>' +
      '<form class="grid-form" id="login-form"><label for="login-user">Username</label><input id="login-user" type="text" autocomplete="username"><div></div>' +
      '<label for="login-pin">PIN</label><input id="login-pin" type="password" inputmode="numeric" autocomplete="current-password"><div></div>' +
      '<div></div><div class="row"><button class="primary" type="submit" id="login-go">Sign in</button></div><div></div></form>';
    card.append(err);
    if (a.error) { err.className = 'msg err'; err.textContent = a.error; }
    const form = card.querySelector('form');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const go = card.querySelector('#login-go'); go.disabled = true; err.className = 'small muted'; err.textContent = 'Signing in…';
      try { const r = await dataStore.signIn(card.querySelector('#login-user').value, card.querySelector('#login-pin').value); resolve({ ...r }); }
      catch (e) { err.className = 'msg err'; err.id = 'login-error'; err.textContent = (e && e.message) || String(e); go.disabled = false; }
    };
    main.replaceChildren(card);
    card.querySelector('#login-user').focus();
  });
}
(function userBox() {
  const bar = document.querySelector('.topbar') || document.body;
  const d = document.createElement('div'); d.id = 'user-box'; d.className = 'user-box';
  const who = document.createElement('span'); who.id = 'user-name'; who.textContent = dataStore.auth.username;
  const role = document.createElement('span'); role.id = 'user-role'; role.className = 'badge ' + (canEdit() ? 'admin' : 'viewer'); role.textContent = dataStore.auth.role === 'admin' ? 'admin' : 'viewer (calculate and view only)';
  const out = document.createElement('button'); out.id = 'sign-out'; out.textContent = 'Sign out';
  out.onclick = async () => { await dataStore.whenSynced(); await dataStore.signOut().catch(() => {}); location.hash = '#/'; location.reload(); };
  d.append('Signed in: ', who, ' ', role, ' ', out);
  bar.append(d);
})();
(function stampVersion() {
  const brand = document.querySelector('.brand');
  const v = document.createElement('span'); v.id = 'app-version'; v.className = 'version-stamp'; v.textContent = APP_VERSION;
  (brand || document.body).append(v);
})();
window.addEventListener('error', (ev) => showFatal(ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => showFatal(ev.reason));
function showFatal(e) {
  const d = document.createElement('div'); d.className = 'msg err';
  d.textContent = 'Something went wrong: ' + ((e && e.message) || e) + ' - please tell Change Gear, and quote ' + APP_VERSION + '.';
  ($main || document.body).prepend(d);
}
const allMachines = () => [...calc.BUILTIN_MACHINES, ...store.machines];
const allInventories = () => [...calc.BUILTIN_INVENTORIES, ...store.inventories];
const findMachine = (id) => allMachines().find((m) => m.id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const S = calc.simple;
const P = calc.presets;
// Index gear presets: custom machines keep them on the machine, built-ins as an override.
function getPresets(m) {
  if (m.builtin) return ((store.builtinOverrides[m.id] || {}).indexPresets) || [];
  const mm = store.machines.find((x) => x.id === m.id); return (mm && mm.indexPresets) || [];
}
function setPresets(m, list) {
  if (m.builtin) { const o = store.builtinOverrides[m.id] || (store.builtinOverrides[m.id] = { trains: {} }); o.indexPresets = list; }
  else { const mm = store.machines.find((x) => x.id === m.id); if (mm) mm.indexPresets = list; m.indexPresets = list; }
  saveStore();
}
const zOf = (res) => { try { const v = res.env.get('Z'); return v === undefined ? null : res.num.toJS(v); } catch (e) { return null; } };
const placeholderGears = () => Array.from({ length: 69 }, (_, i) => ({ teeth: 20 + i, qty: 1 }));
const newInvId = () => 'inv-' + Math.random().toString(36).slice(2, 8);
function downloadText(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// ------------------------------------------------------------------ DOM helper
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const msg = (kind, ...t) => h('div', { class: `msg ${kind}` }, ...t);
const fmtPct = (e) => { const t = (e * 100).toFixed(5); return (Number(t) === 0 ? '0.00000' : (e > 0 ? '+' : '') + t) + ' %'; };
const trimNum = (s) => String(s).trim();

// ------------------------------------------------------------------ navigation
function renderNav() {
  const cur = location.hash || '#/';
  const link = (href, ...label) => h('a', { href, class: cur === href || cur.startsWith(href + '/') ? 'active' : '' }, ...label);
  $nav.replaceChildren(
    h('h3', {}, 'Original program'),
    ...calc.BUILTIN_MACHINES.map((m) => link(`#/m/${m.id}`, h('span', { class: 'num' }, `(${m.menu})`), m.name)),
    h('h3', {}, 'My machines'),
    ...(store.machines.length ? store.machines.map((m) => link(`#/m/${m.id}`, h('span', { class: 'num' }, '•'), m.name)) : [h('div', { class: 'muted small', style: 'padding:2px 16px' }, 'None yet')]),
    canEdit() ? link('#/new', h('span', { class: 'num' }, '+'), 'Add a machine') : null,
    h('h3', {}, 'Setup'),
    link('#/inventories', h('span', { class: 'num' }, '⚙'), 'Gear inventories'),
    link('#/io', h('span', { class: 'num' }, '⇅'), 'Import / export'),
    link('#/help', h('span', { class: 'num' }, '?'), 'Formula help'),
  );
}

function route() {
  renderNav();
  const parts = (location.hash || '#/').slice(2).split('/').map(decodeURIComponent);
  try {
    if (parts[0] === 'm' && parts[1]) return renderMachine(parts[1]);
    if (parts[0] === 'edit' && parts[1] && isLocked(findMachine(parts[1]))) return renderEditor({ id: parts[1], readOnly: true });
    if (['edit', 'copy', 'new'].includes(parts[0]) && !canEdit()) { if (parts[0] === 'edit' && parts[1]) return renderEditor({ id: parts[1], readOnly: true }); $main.replaceChildren(msg('warn', 'Only an admin can add or change machines. You can calculate and view.')); return; }
    if (parts[0] === 'edit' && parts[1]) return renderEditor({ id: parts[1] });
    if (parts[0] === 'view' && parts[1]) return renderEditor({ id: parts[1], readOnly: true });
    if (parts[0] === 'copy' && parts[1]) return renderEditor({ copyOf: parts[1] });
    if (parts[0] === 'new') return renderEditor({});
    if (parts[0] === 'inventories') return renderInventories(parts[1]);
    if (parts[0] === 'io') return renderIO();
    if (parts[0] === 'help') return renderHelp();
    return renderHome();
  } catch (e) {
    console.error(e);
    $main.replaceChildren(msg('err', 'Something went wrong: ' + e.message));
  }
}
window.addEventListener('hashchange', route);

function renderHome() {
  $main.replaceChildren(
    h('div', { class: 'card' },
      h('h2', {}, 'RAM-GEAR gear hobbing machine programs'),
      h('p', {}, 'Pick a program on the left. The programs kept from the original BASIC menu give exactly the same numbers as the old program. You can also add your own machines with their own formulas and gear inventories.'),
      h('table', {}, h('tr', {}, h('th', {}, 'Menu'), h('th', {}, 'Program'), h('th', {}, 'What it works out')),
        calc.BUILTIN_MACHINES.map((m) => h('tr', {}, h('td', {}, `(${m.menu})`), h('td', {}, h('a', { href: `#/m/${m.id}` }, m.name)), h('td', { class: 'small' }, m.description)))),
    ),
    h('div', { class: 'card' }, h('h3', {}, 'Arithmetic used for the original programs'),
      (() => {
        const sel = h('select', { style: 'max-width:520px', onchange: () => { store.settings.legacyNumeric = sel.value; saveStore(); } },
          h('option', { value: 'gwbasic' }, 'GW-BASIC single precision (default - verified digit for digit)'),
          h('option', { value: 'ieee-single' }, 'QBasic / QuickBASIC style single precision (not verified)'));
        sel.value = store.settings.legacyNumeric || 'gwbasic';
        return sel;
      })(),
      h('p', { class: 'small muted' }, 'The two old BASICs round the 7th digit slightly differently. Change gears found are the same in almost every case.')),
  );
}

// ------------------------------------------------------------------ machine screen
function trainOverride(m, i) {
  if (m.builtin) return ((store.builtinOverrides[m.id] || {}).trains || {})[i] || {};
  return {};
}
function setTrainOverride(m, i, patch) {
  if (m.builtin) {
    const o = store.builtinOverrides[m.id] || (store.builtinOverrides[m.id] = { trains: {} });
    o.trains = o.trains || {};
    o.trains[i] = { ...(o.trains[i] || {}), ...patch };
  } else {
    const mm = store.machines.find((x) => x.id === m.id);
    Object.assign(mm.trains[i], patch);
  }
  saveStore();
}

function renderMachine(id) {
  const m = findMachine(id);
  if (!m && calc.REMOVED_BUILTIN_IDS.includes(id)) { $main.replaceChildren(msg('err', `"${id}" was one of the original programs and has been removed from this app (v1.3). Any copies you made are still under My machines.`)); return; }
  if (!m) { $main.replaceChildren(msg('err', `Machine "${id}" not found.`)); return; }
  const compiled = calc.compileMachine(m);
  const last = store.lastInputs[m.id] || {};
  const fields = {};
  const head = h('div', { class: 'card' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('h2', {}, m.builtin ? `(${m.menu}) ` : '', m.name, m.builtin ? h('span', { class: 'badge builtin' }, 'original program') : h('span', { class: 'badge' }, 'my machine'), lockBadge(m)),
      h('div', { class: 'row' },
        !canEdit() ? [h('button', { onclick: () => (location.hash = `#/view/${m.id}`) }, 'View formulas')]
          : m.builtin ? [h('button', { onclick: () => (location.hash = `#/view/${m.id}`) }, 'View formulas'), h('button', { onclick: () => (location.hash = `#/copy/${m.id}`) }, 'Copy to edit')]
          : [isLocked(m) ? h('button', { onclick: () => (location.hash = `#/view/${m.id}`) }, 'View formulas') : h('button', { onclick: () => (location.hash = `#/edit/${m.id}`) }, 'Edit'),
            h('button', { id: 'copy-draft', onclick: () => (location.hash = `#/copy/${m.id}`) }, isLocked(m) ? 'Copy to new draft' : 'Duplicate'),
            isLocked(m) ? null : h('button', { class: 'primary', id: 'verify-lock', onclick: () => verifyAndLock(m) }, 'Verify & lock'),
            ...['index', 'differential'].filter((k) => S.trainOf(m, k)).map((k) => h('button', { onclick: () => editMachineGears(m, k) }, `Edit ${k} gears`)),
            canDelete() ? h('button', { class: 'danger', id: 'delete-machine', onclick: () => deleteMachine(m) }, 'Delete machine') : null])),
    h('p', { class: 'muted' }, m.description || ''),
    (!m.builtin && canEdit()) ? h('div', { class: 'msg info small', id: 'lock-help' }, isLocked(m)
      ? 'This machine is verified and locked: its formulas, constants, inputs and gear trains cannot be changed by anyone. Admins can still edit or clear its index and differential gear lists and its index presets, or use "Copy to new draft" to make a changed version.'
      : 'Draft: admins can still edit and test it. When the results are right, click "Verify & lock" to freeze its formulas and constants for good (gear lists and presets stay editable).') : null,
    (!m.builtin && canDelete()) ? gearTrainAdmin(m) : null,
    manualBar(m),
    m.numeric !== 'gwbasic' ? null : h('div', { class: 'small muted' }, legacyNumeric(m) === 'ieee-single'
      ? 'Arithmetic: QBasic-style single precision (setting on the start page). Switch back to GW-BASIC to match the verified results.'
      : 'Arithmetic: same single-precision GW-BASIC arithmetic as the original program (results match it digit for digit).'));
  if (!compiled.ok) {
    $main.replaceChildren(head, msg('err', 'This machine has formula errors - open the editor to fix them:', h('ul', {}, compiled.errors.map((e) => h('li', {}, `${e.where}: ${e.msg}`)))));
    return;
  }
  const form = h('form', { class: 'grid-form', onsubmit: (ev) => { ev.preventDefault(); calculate(); } });
  for (const inp of m.inputs || []) {
    const name = inp.name.toUpperCase();
    const t = inp.type || 'number';
    let field;
    if (t === 'choice') {
      field = h('select', { id: `in-${name}` }, inp.options.map((o) => h('option', { value: String(o.value) }, o.label)));
      field.value = String(last[name] !== undefined ? last[name] : (inp.default !== undefined ? inp.default : inp.options[0].value));
    } else {
      field = h('input', { type: 'text', id: `in-${name}`, inputmode: t === 'number' ? 'decimal' : undefined, autocomplete: 'off', placeholder: inp.example ? `e.g. ${inp.example}` : '', value: last[name] !== undefined ? last[name] : (inp.default !== undefined ? String(inp.default) : '') });
    }
    fields[name] = field;
    form.append(
      h('label', { for: `in-${name}` }, inp.label || name),
      field,
      h('div', { class: 'hint' }, inp.unit ? h('b', {}, inp.unit + ' ') : '', inp.basic ? `Original prompt: ${inp.basic}` : '', inp.help || ''),
    );
  }
  const fillEx = () => { for (const inp of m.inputs || []) { const f = fields[inp.name.toUpperCase()]; if (f && f.tagName === 'INPUT' && !f.value.trim() && inp.example !== undefined) { f.value = String(inp.example); f.classList.remove('invalid'); } } };
  form.append(h('div', {}), h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Calculate'),
    h('button', { type: 'button', onclick: fillEx }, 'Fill blanks with example values')), h('div', {}));
  const out = h('div', {});
  const hasIndex = (m.trains || []).some((t) => t.kind === 'index' && t.strategy === 'ranked');
  const presetCard = hasIndex ? presetEditor(m, () => { if (out.childNodes.length) calculate(true); }) : null;
  $main.replaceChildren(head, h('div', { class: 'card' }, h('h3', {}, 'Job details and inputs'), form), out, presetCard);

  function calculate(auto) {
    try { calculateInner(auto); } catch (e) {
      console.error(e);
      out.replaceChildren(msg('err', h('b', {}, 'Calculate failed: '), String((e && e.message) || e), ` (${APP_VERSION})`));
      if (out.scrollIntoView) out.scrollIntoView({ block: 'center' });
    }
  }
  function calculateInner(auto) {
    const inputs = {};
    for (const [n, f] of Object.entries(fields)) inputs[n] = f.value;
    store.lastInputs[m.id] = inputs; saveStore();
    const res = calc.evaluateMachine(m, inputs, { compiled, numeric: legacyNumeric(m) });
    out.replaceChildren();
    for (const f of Object.values(fields)) f.classList.remove('invalid');
    if (!res.ok) {
      for (const inp of m.inputs || []) { const n = inp.name.toUpperCase(); if (res.errors.some((e) => e.startsWith((inp.label || n) + ':'))) fields[n] && fields[n].classList.add('invalid'); }
      const box = msg('err', h('b', {}, 'Cannot calculate - no ratio yet. Fix the field(s) marked in red: '), h('ul', {}, res.errors.map((e) => h('li', {}, e))));
      out.append(box); if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const bad = form.querySelector('.invalid'); if (bad) bad.focus({ preventScroll: true });
      return;
    }
    const job = (m.inputs || []).filter((i) => i.type === 'text').map((i) => [i.label, inputs[i.name.toUpperCase()] || '']);
    const card = h('div', { class: 'card out-card' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', {}, 'Results'),
      h('button', { onclick: () => printSheet(m, res, inputs, job, trainState) }, 'Print sheet')));
    res.warnings.forEach((w) => card.append(msg('warn', w.replace('Division by zero', 'Division by zero (the original BASIC prints "Division by zero" and carries on with its largest number, 1.701412E+38)'))));
    card.append(h('table', { class: 'results-table' }, compiled.outputs.map((o) => h('tr', {}, h('td', {}, o.label || o.name), h('td', { class: 'big' }, formatOutput(res, o))))));
    if (res.reportText.length) card.append(h('details', {}, h('summary', {}, 'Original program screen'), h('pre', { class: 'screen' }, res.reportText.join('\n'))));
    out.append(card);
    if (card.scrollIntoView && !auto) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const trainState = [];
    (m.trains || []).forEach((t0, i) => {
      try { out.append(renderTrain(m, res, i, trainState, () => { calculate(true); if (presetCard) presetCard.refresh(); })); }
      catch (e) { console.error(e); out.append(msg('err', `Gear search failed (${e.message}). The ratio above is still correct.`)); }
    });
  }
  if (Object.keys(last).length) calculate(true);
}

// Admin box on a custom machine: remove a train (drafts only) and clear / delete its gear lists (draft or locked).
function gearTrainAdmin(m) {
  const kinds = ['index', 'differential'].filter((k) => S.trainOf(m, k));
  if (!kinds.length) return null;
  return h('div', { class: 'card danger-zone', id: 'train-admin' }, h('h3', {}, 'Gear train sets (admin)'),
    h('table', {}, kinds.map((k) => {
      const t = S.trainOf(m, k); const inv = store.inventories.find((x) => x.id === t.inventory);
      return h('tr', {}, h('td', {}, h('b', {}, k === 'index' ? 'Index' : 'Differential')), h('td', { class: 'small' }, inv ? `${inv.name} (${(inv.gears || []).reduce((s, g) => s + Number(g.qty || 0), 0)} gears)` : 'built-in list'),
        h('td', {}, inv ? h('button', { class: 'danger', id: `clear-gears-${k}`, onclick: () => { if (clearInventory(inv)) route(); } }, `Clear ${k} gear list`) : null, ' ',
          inv ? h('button', { class: 'danger', id: `delete-gears-${k}`, onclick: () => { if (deleteInventory(inv)) route(); } }, `Delete ${k} gear list`) : null, ' ',
          isLocked(m) ? null : h('button', { class: 'danger', id: `remove-train-${k}`, onclick: () => removeTrain(m, k) }, `Remove ${k} train`)));
    })),
    isLocked(m) ? h('p', { class: 'small muted' }, 'Locked: trains cannot be removed, but the gear lists can be cleared or deleted.') : null);
}

// Open the machine's own gear list for a train; if the train still points at a built-in list,
// make the machine its own copy first and link it.
function editMachineGears(m, kind) {
  const mm = store.machines.find((x) => x.id === m.id); if (!mm) return;
  const t = S.trainOf(mm, kind);
  let inv = store.inventories.find((x) => x.id === t.inventory);
  if (!inv) {
    const src = allInventories().find((x) => x.id === t.inventory);
    inv = { id: newInvId(), name: S.ownInventoryName(mm.name, kind), gears: src ? clone(src.gears) : placeholderGears() };
    store.inventories.push(inv); t.inventory = inv.id;
    mm.ownInventories = { ...(mm.ownInventories || {}), [kind]: inv.id };
    saveStore();
  }
  location.hash = `#/inventories/${inv.id}`;
}

function legacyNumeric(m) {
  return m.numeric === 'gwbasic' && store.settings.legacyNumeric === 'ieee-single' ? 'ieee-single' : undefined;
}

function formatOutput(res, o) {
  const v = res.env.get(o.name);
  const f = o.format || 'basic';
  const mm = /^fixed:(\d+)$/.exec(f);
  if (mm) return res.num.toJS(v).toFixed(Number(mm[1]));
  return trimNum(res.num.format(v));
}

function renderTrain(m, res, i, trainState, onPresetsChanged) {
  const base = m.trains[i];
  const t = calc.effectiveTrain(base, trainOverride(m, i));
  const card = h('div', { class: 'card out-card' });
  const body = h('div', {});
  const st = (trainState[i] = { train: t, matches: [], selected: null });
  const invSel = h('select', { onchange: () => { setTrainOverride(m, i, { inventory: invSel.value }); rerender(); } }, allInventories().map((v) => h('option', { value: v.id }, v.name)));
  invSel.value = t.inventory || 'legacy-20-88';
  const stratSel = h('select', { onchange: () => { setTrainOverride(m, i, { strategy: stratSel.value }); rerender(); } },
    h('option', { value: 'legacy-ramgear' }, 'Original program search (first match, then Continue)'),
    h('option', { value: 'ranked' }, 'Best matches from gear inventory (ranked by error)'));
  stratSel.value = t.strategy;
  const rerender = () => card.replaceWith(renderTrain(m, res, i, trainState, onPresetsChanged));
  card.append(h('h3', {}, t.label || `${t.kind} gears`));
  if (t.strategy === 'bc-breakdown') {
    card.append(renderBreakdown(m, res, t, st));
    return card;
  }
  const R = res.env.get(String(t.ratio).toUpperCase());
  card.append(h('div', { class: 'row small', style: 'margin-bottom:8px' }, 'Ratio needed: ', h('b', {}, trimNum(res.num.format(R))), ' | Search: ', stratSel));
  if (t.strategy === 'legacy-ramgear') {
    const useInv = h('input', { type: 'checkbox', checked: !!t.useInventory, onchange: () => { setTrainOverride(m, i, { useInventory: useInv.checked }); rerender(); } });
    card.append(h('div', { class: 'small muted' }, 'Tries A, B, C, D from 20 to 88 teeth in the same order as the original program and stops at each train within 0.9999 - 1.0001 of the ratio. "Find change gears" gives the same first answer as the old program; "Continue" gives the next one, like (C) CONTINUE did.'),
      h('div', { class: 'row small', style: 'margin:6px 0' }, h('label', {}, useInv, ' Only use gears from inventory: '), invSel));
    let gen = null;
    const tbody = h('tbody');
    const status = h('div', { class: 'small muted' });
    const screen = h('pre', { class: 'screen', style: 'display:none' });
    let busy = false;
    const findNext = (count) => {
      if (busy) return;
      try {
        if (!gen) gen = calc.runTrain(res, t, allInventories(), { yieldEvery: 200000, maxD: 5000 }).gen;
      } catch (e) { status.replaceChildren(msg('err', e.message)); return; }
      busy = true;
      let found = 0;
      const t0 = Date.now();
      const step = () => {
        const sliceEnd = Date.now() + 40;
        try {
          while (Date.now() < sliceEnd) {
            const r = gen.next();
            if (r.done) { busy = false; status.textContent = `${st.matches.length ? 'No more matches' : 'No match found'} (searched D up to 5000 teeth; the original program would keep searching forever).`; return; }
            const v = r.value;
            if (v.progress) { status.textContent = `Searching… now at A=${v.A} B=${v.B} C=${v.C} D=${v.D}`; continue; }
            st.matches.push(v);
            addRow(v);
            found++;
            if (found >= count) { busy = false; status.textContent = `${st.matches.length} match(es) shown, in the original program's order. Search took ${Date.now() - t0} ms.`; return; }
          }
        } catch (e) { busy = false; status.replaceChildren(msg('err', e.message)); return; }
        setTimeout(step, 0);
      };
      step();
    };
    const addRow = (v) => {
      const n = st.matches.length;
      const tr = h('tr', { class: 'clickable', onclick: () => select(v, tr) },
        h('td', { class: 'num' }, n), h('td', { class: 'num' }, v.A), h('td', { class: 'num' }, v.B), h('td', { class: 'num' }, v.C), h('td', { class: 'num' }, v.D),
        h('td', { class: 'num' }, v.ratioText), h('td', { class: 'num' }, fmtPct(v.errorPct / 100)), h('td', { class: 'num small' }, v.pos.toLocaleString()), h('td', { class: 'small' }, v.odd));
      tbody.append(tr);
      if (n === 1) select(v, tr);
    };
    const select = (v, tr) => {
      tbody.querySelectorAll('tr').forEach((x) => x.classList.remove('sel'));
      tr.classList.add('sel');
      st.selected = v;
      screen.style.display = '';
      screen.textContent = v.lines.join('\n');
    };
    body.append(
      h('div', { class: 'row' }, h('button', { class: 'blue', onclick: () => { gen = null; st.matches = []; tbody.replaceChildren(); findNext(1); } }, 'Find change gears'),
        h('button', { onclick: () => findNext(1) }, 'Continue (next match)'), h('button', { onclick: () => findNext(10) }, 'Next 10')),
      status,
      h('table', {}, h('thead', {}, h('tr', {}, ['#', 'A', 'B', 'C', 'D', 'Train ratio A/B×C/D', 'Error', 'Search pass', ''].map((x) => h('th', { class: 'num' }, x)))), tbody),
      h('div', { class: 'small muted' }, 'A and C are the driving gears, B and D the driven gears (ratio = A/B × C/D), as in the original printout.'),
      screen);
  } else {
    const gearsSel = h('select', { onchange: () => { setTrainOverride(m, i, { gears: Number(gearsSel.value) }); rerender(); } }, h('option', { value: '4' }, '4 gears (A/B × C/D)'), h('option', { value: '2' }, '2 gears (A/B)'));
    gearsSel.value = String(t.gears || 4);
    const tol = h('input', { type: 'text', style: 'width:110px', value: t.tolerance ? String(t.tolerance * 100) : '', placeholder: 'any', onchange: () => { const v = parseFloat(tol.value); setTrainOverride(m, i, { tolerance: v > 0 ? v / 100 : undefined }); rerender(); } });
    card.append(h('div', { class: 'row small', style: 'margin:6px 0' }, 'Inventory: ', invSel, ' Train: ', gearsSel, ' Max error %: ', tol));
    const tbody = h('tbody');
    const isIdx = t.kind === 'index';
    let searchSel = null;
    const z = isIdx ? zOf(res) : null;
    if (isIdx && z !== null) {
      const presets = P.presetsFor(getPresets(m), z);
      const Rt = res.num.toJS(R);
      if (presets.length) {
        body.append(h('table', { class: 'preset-results' }, h('thead', {}, h('tr', {}, ['', 'A', 'B', 'C', 'D', 'Train ratio', 'Error', 'Note'].map((x) => h('th', { class: 'num' }, x)))),
          h('tbody', {}, presets.map((p) => h('tr', { class: 'preset-row' }, h('td', {}, h('span', { class: 'badge preset' }, 'Preset')), h('td', { class: 'num' }, p.A), h('td', { class: 'num' }, p.B), h('td', { class: 'num' }, p.C ?? ''), h('td', { class: 'num' }, p.D ?? ''),
            h('td', { class: 'num' }, P.presetRatio(p).toFixed(8)), h('td', { class: 'num' }, fmtPct(P.presetError(p, Rt))), h('td', { class: 'small' }, p.note || ''))))),
          h('div', { class: 'small muted', style: 'margin-bottom:8px' }, `Saved preset(s) for z = ${z}. Searched matches from the gear list are below.`));
        st.selected = { ...presets[0], ratio: P.presetRatio(presets[0]), err: P.presetError(presets[0], Rt) };
      }
      const inv = allInventories().find((v) => v.id === t.inventory);
      const hint = P.primeHint(z, inv ? inv.gears : [], getPresets(m));
      if (hint) body.append(msg('warn prime-hint', hint));
    }
    try {
      const r = calc.runTrain(res, t, allInventories());
      st.matches = r.list;
      r.list.forEach((v, k) => {
        const tr = h('tr', { class: 'clickable', onclick: () => { tbody.querySelectorAll('tr').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel'); st.selected = v; } },
          h('td', { class: 'num' }, k + 1), h('td', { class: 'num' }, v.A), h('td', { class: 'num' }, v.B), h('td', { class: 'num' }, v.C ?? ''), h('td', { class: 'num' }, v.D ?? ''),
          h('td', { class: 'num' }, v.ratio.toFixed(8)), h('td', { class: 'num' }, fmtPct(v.err)),
          (isIdx && z !== null && canEdit()) ? h('td', {}, h('button', { class: 'small save-row-preset', title: `Save as preset for z = ${z}`, onclick: (ev) => {
            ev.stopPropagation(); setPresets(m, P.upsertPreset(getPresets(m), P.presetFromMatch(z, v))); if (onPresetsChanged) onPresetsChanged();
          } }, 'Save as preset')) : null);
        tbody.append(tr);
        if (k === 0) { tr.classList.add('sel'); if (!st.selected) st.selected = v; searchSel = v; }
        tr.addEventListener('click', () => { searchSel = v; });
      });
      body.append(r.list.length ? h('table', {}, h('thead', {}, h('tr', {}, [...['Rank', 'A', 'B', 'C', 'D', 'Train ratio', 'Error'], ...(isIdx && z !== null && canEdit() ? [''] : [])].map((x) => h('th', { class: 'num' }, x)))), tbody) : msg('warn', 'No combination within the tolerance.'),
        h('div', { class: 'small muted' }, 'Drivers A, C / driven B, D. Swapping A with C (or B with D) gives the same ratio and is listed once. Gear quantities in the inventory are respected.'),
        (isIdx && z !== null && r.list.length && canEdit()) ? h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'blue', id: 'save-preset', onclick: () => {
          if (!searchSel) return;
          setPresets(m, P.upsertPreset(getPresets(m), P.presetFromMatch(z, searchSel)));
          if (onPresetsChanged) onPresetsChanged();
        } }, `Save selected match as preset for z = ${z}`)) : null);
    } catch (e) { body.append(msg('err', e.message)); }
  }
  card.append(body);
  return card;
}

function renderBreakdown(m, res, t, st) {
  const r = calc.runTrain(res, t);
  const num = res.num;
  const wrap = h('div', {});
  const onlyWhole = h('input', { type: 'checkbox', onchange: () => draw() });
  const sel = [null, null];
  const summary = h('div', {});
  const tables = h('div', { class: 'flex2' });
  wrap.append(h('div', { class: 'small muted' }, `For each W from ${t.from || 20} to ${t.to || 120} the original prints X = L / W (and J = M / H) one line at a time and you answer Y at the one you want. Click a row in each table. Whole numbers are shaded green.`),
    h('label', { class: 'small' }, onlyWhole, ' Show whole numbers only'), tables, summary);
  const draw = () => {
    tables.replaceChildren(...r.tables.map((tb, k) => {
      const tbody = h('tbody');
      tb.rows.forEach((row) => {
        if (onlyWhole.checked && !row.whole) return;
        const tr = h('tr', { class: `clickable ${row.whole ? 'whole' : ''} ${sel[k] === row ? 'sel' : ''}`, onclick: () => { sel[k] = row; draw(); } },
          h('td', { class: 'num' }, row.xText), h('td', {}, '×'), h('td', { class: 'num' }, row.W));
        tbody.append(tr);
      });
      return h('div', {}, h('b', {}, `${tb.name} = ${tb.text}`, k === 0 ? '   (X × W)' : '   (J × H)'),
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { class: 'num' }, k === 0 ? 'X = L / W' : 'J = M / H'), h('th', {}, ''), h('th', { class: 'num' }, k === 0 ? 'W' : 'H'))), tbody)));
    }));
    summary.replaceChildren();
    if (sel[0] || sel[1]) {
      const z = num.assign(num.fromInt(0), '!');
      const X = sel[0] ? sel[0].X : z, W = sel[0] ? num.assign(num.fromInt(sel[0].W), '!') : z;
      const J = sel[1] ? sel[1].X : z, H = sel[1] ? num.assign(num.fromInt(sel[1].W), '!') : z;
      const line = calc.bcSummaryLine(num, X, W, J, H);
      st.selected = { line };
      summary.append(h('p', {}, 'Selected breakdown (as the original prints it):'), h('pre', { class: 'screen' }, line + '\n' + num.format(res.env.get('F')) + ' '));
    }
  };
  draw();
  return wrap;
}

// ------------------------------------------------------------------ print sheet
function printSheet(m, res, inputs, job, trainState) {
  const lines = ['', '', '                                 RAM-GEAR', '                       GEAR HOBBING MACHINE PROGRAMS', '', '',
    `                         ${m.builtin ? `(${m.menu}) ` : ''}${m.name.toUpperCase()}`, '', ''];
  for (const [label, v] of job) lines.push(`${label.toUpperCase()}: ${v}`);
  for (const inp of m.inputs || []) {
    if (inp.type === 'text') continue;
    const n = inp.name.toUpperCase();
    let v = inputs[n];
    if (inp.type === 'choice') v = (inp.options.find((o) => String(o.value) === String(v)) || {}).label || v;
    lines.push(`${(inp.label || n).toUpperCase()}: ${v}${inp.unit ? ' ' + inp.unit : ''}`);
  }
  lines.push('');
  const compiled = calc.compileMachine(m);
  for (const o of compiled.outputs) lines.push(`${(o.label || o.name).toUpperCase()}: ${formatOutput(res, o)}`);
  if (res.reportText.length) { lines.push('', ...res.reportText); }
  (trainState || []).forEach((s) => {
    if (!s || !s.selected) return;
    lines.push('');
    if (s.selected.lines) lines.push(...s.selected.lines);
    else if (s.selected.line) lines.push(s.selected.line);
    else if (s.selected.A) lines.push(`A; ${s.selected.A}  B; ${s.selected.B}${s.selected.C ? `  C; ${s.selected.C}  D; ${s.selected.D}` : ''}   RATIO ${s.selected.ratio.toFixed(8)}  ERROR ${fmtPct(s.selected.err)}`);
  });
  lines.push('', `Printed ${new Date().toLocaleString()}`);
  document.getElementById('print-area').textContent = lines.join('\n');
  window.print();
}

// ------------------------------------------------------------------ editor
function renderEditor({ id, copyOf, readOnly }) {
  let draft, isNew = false;
  if (id) {
    const m = findMachine(id);
    if (!m) { $main.replaceChildren(msg('err', 'Machine not found')); return; }
    draft = clone(m);
    if (m.builtin || !canEdit() || isLocked(m)) readOnly = true; if (!m.builtin) S.normalizeIndex(draft);
  } else if (copyOf) {
    const m = findMachine(copyOf);
    draft = clone(m);
    draft.id = 'custom-' + Math.random().toString(36).slice(2, 9);
    draft.name = m.name + ' (my copy)';
    draft.builtin = false;
    delete draft.menu; delete draft.lock;
    if (m.builtin) draft.description = `Copied from original program (${m.menu}). ${m.description}`;
    delete draft.ownInventories;
    S.normalizeIndex(draft);
    for (const t of draft.trains || []) if (t.kind === 'index' || t.kind === 'differential') t.inventory = S.OWN_INV;
    isNew = true;
  } else {
    draft = calc.newMachineTemplate();
    isNew = true;
  }
  const ro = !!readOnly;
  const status = h('div', {});
  const preview = h('div', {});
  const sections = h('div', {});
  let advancedOpen = !!readOnly;
  const advanced = h('details', { class: 'advanced' });
  advanced.addEventListener('toggle', () => { advancedOpen = advanced.open; });
  const jsonBox = h('textarea', { rows: 18, readonly: ro || undefined });

  const inputEl = (obj, key, attrs = {}) => {
    const el = h('input', { type: 'text', value: obj[key] === undefined ? '' : String(obj[key]), disabled: ro || undefined, ...attrs });
    el.addEventListener('input', () => { obj[key] = el.value; validate(); });
    return el;
  };
  const selectEl = (obj, key, options, after) => {
    const el = h('select', { disabled: ro || undefined }, options.map(([v, l]) => h('option', { value: v }, l)));
    el.value = obj[key] === undefined ? options[0][0] : String(obj[key]);
    el.addEventListener('change', () => { obj[key] = el.value; if (after) after(el.value); validate(); });
    return el;
  };
  const delBtn = (arr, idx) => (ro ? null : h('button', { class: 'x', title: 'Remove', onclick: () => { arr.splice(idx, 1); draw(); } }, '×'));
  const upBtn = (arr, idx) => (ro || idx === 0 ? null : h('button', { class: 'x', title: 'Move up', onclick: () => { [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; draw(); } }, '↑'));

  function draw() {
    draft.inputs = draft.inputs || []; draft.constants = draft.constants || []; draft.formulas = draft.formulas || [];
    draft.outputs = draft.outputs || []; draft.trains = draft.trains || []; draft.report = draft.report || [];
    const invOpts = allInventories().map((v) => [v.id, v.name]);
    const ownOpt = [S.OWN_INV, `${S.ownInventoryName(draft.name, '…')} - this machine's own list (made on save, 20-88 to start)`];
    const simpleSection = (kind) => {
      const title = kind === 'index' ? 'Index' : 'Differential';
      const info = S.sectionInfo(draft, kind);
      if (!info) return h('div', { class: 'card simple-sec', id: `simple-${kind}` }, h('h3', {}, `${title} ratio formula`),
        h('p', { class: 'muted small' }, `This machine has no ${kind} calculation.`),
        ro ? null : h('button', { class: 'blue', onclick: () => { (kind === 'index' ? S.addIndex : S.addDifferential)(draft); draw(); } }, `+ Add ${kind} ratio`));
      const t = info.train;
      const own = (draft.ownInventories || {})[kind];
      const opts = [own ? [own, `${S.ownInventoryName(draft.name, kind)} (this machine's own list)`] : ownOpt, ...invOpts.filter(([v]) => v !== own)];
      return h('div', { class: 'card simple-sec', id: `simple-${kind}` }, h('h3', {}, `${title} ratio formula`),
        h('div', { class: 'grid-form' },
          h('label', {}, `${title} constant`),
          info.constant ? inputEl(info.constant, 'expr', { id: `const-${kind}`, style: 'max-width:160px' }) : h('span', { class: 'muted small' }, 'written into the formula - see Advanced'),
          h('div', { class: 'hint' }, info.constant ? (info.constant.label || '') : ''),
          h('label', {}, 'Formula'), h('code', { class: 'formula-show' }, `${info.formula ? info.formula.name : t.ratio} = ${info.formula ? info.formula.expr : '?'}`),
          h('div', { class: 'hint' }, kind === 'index' ? 'KIDX = index constant, K = hob starts, Z = number of teeth in gear' : 'KDIFF (or O) = differential constant, B = helix angle, D = module or DP, K = hob starts, Q = inch/metric'),
          h('label', {}, `${title} gear list`), selectEl(t, 'inventory', opts), h('div', { class: 'hint' }, 'The gear search only uses gears from this list.'),
          h('label', {}, 'Search'), selectEl(t, 'strategy', [['ranked', 'Best matches from gear list (ranked by error)'], ['legacy-ramgear', 'Original program search (first match, then Continue)']]), h('div', {})),
        ro ? null : h('button', { onclick: () => { if (confirm(`Remove the ${kind} calculation from this machine?`)) { S.removeSection(draft, kind); draw(); } } }, `Remove ${kind}`));
    };
    const simpleCards = [
      h('div', { class: 'msg info small' }, 'Type each machine constant in its box - the formulas are already built: index ratio = index constant × hob starts (K) ÷ teeth (z), and a Fauter / FD-500 style differential. Each one gets its own gear list and gear search. Remove the one your machine does not need. Change the formulas themselves under "Advanced" at the bottom.'),
      simpleSection('index'), simpleSection('differential')];
    const machineCard = h('div', { class: 'card' }, h('h3', {}, 'Machine'),
        h('div', { class: 'grid-form' },
          h('label', {}, 'Name'), inputEl(draft, 'name', { id: 'machine-name' }), h('div', { class: 'hint' }, 'Its gear lists are named after it.'),
          h('label', {}, 'Description'), inputEl(draft, 'description'), h('div', {}),
          h('label', {}, 'Arithmetic'), selectEl(draft, 'numeric', [['float64', 'Normal (double precision) - recommended'], ['gwbasic', 'Old BASIC single precision (exactly like the original program)'], ['ieee-single', 'QBasic-style single precision (approximate)']]), h('div', { class: 'hint' }, 'Copies of the original programs keep "Old BASIC" so they give identical numbers.')));
    sections.replaceChildren(machineCard, ...simpleCards, advanced);
    advanced.replaceChildren(h('summary', {}, 'Advanced: inputs, constants, formulas, results and gear trains'),
      h('div', { class: 'card' }, h('h3', {}, 'Inputs (what the operator types in)'),
        h('table', { class: 'tbl-edit' }, h('tr', {}, ['Name', 'Label', 'Unit', 'Type', 'Example / default', 'Choices (value=label, one per line)', ''].map((x) => h('th', {}, x))),
          draft.inputs.map((inp, k) => h('tr', {},
            h('td', {}, inputEl(inp, 'name', { class: 'name' })), h('td', {}, inputEl(inp, 'label')), h('td', {}, inputEl(inp, 'unit', { style: 'width:80px' })),
            h('td', {}, selectEl(inp, 'type', [['number', 'number'], ['choice', 'choice'], ['text', 'text (not used in formulas)']], () => draw())),
            h('td', {}, inputEl(inp, 'example', { style: 'width:90px' })),
            h('td', {}, (inp.type === 'choice') ? (() => {
              const ta = h('textarea', { rows: 2, disabled: ro || undefined }, (inp.options || []).map((o) => `${o.value}=${o.label}`).join('\n'));
              ta.addEventListener('input', () => { inp.options = ta.value.split('\n').filter((l) => l.trim()).map((l) => { const [v, ...rest] = l.split('='); return { value: Number(v) || 0, label: rest.join('=').trim() || v }; }); validate(); });
              return ta;
            })() : h('span', { class: 'muted small' }, '—')),
            h('td', {}, upBtn(draft.inputs, k), delBtn(draft.inputs, k))))),
        ro ? null : h('button', { onclick: () => { draft.inputs.push({ name: '', label: '', unit: '', example: '' }); draw(); } }, '+ Add input')),
      h('div', { class: 'card' }, h('h3', {}, 'Constants'),
        h('table', { class: 'tbl-edit' }, h('tr', {}, ['Name', 'Value or formula', 'Note', ''].map((x) => h('th', {}, x))),
          draft.constants.map((c, k) => h('tr', {}, h('td', {}, inputEl(c, 'name', { class: 'name' })), h('td', {}, inputEl(c, 'expr')), h('td', {}, inputEl(c, 'label')), h('td', {}, delBtn(draft.constants, k))))),
        ro ? null : h('button', { onclick: () => { draft.constants.push({ name: '', expr: '', label: '' }); draw(); } }, '+ Add constant')),
      h('div', { class: 'card' }, h('h3', {}, 'Formulas (can use inputs, constants and other formulas)'),
        h('table', { class: 'tbl-edit' }, h('tr', {}, ['Name', 'Formula', 'What it is', ''].map((x) => h('th', {}, x))),
          draft.formulas.map((f, k) => h('tr', {}, h('td', {}, inputEl(f, 'name', { class: 'name' })), h('td', {}, inputEl(f, 'expr', { style: 'font-family:ui-monospace,Consolas,monospace' })), h('td', {}, inputEl(f, 'label')), h('td', {}, upBtn(draft.formulas, k), delBtn(draft.formulas, k))))),
        ro ? null : h('button', { onclick: () => { draft.formulas.push({ name: '', expr: '', label: '' }); draw(); } }, '+ Add formula'),
        h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Operators + - * / ^ ( ). Functions: SIND COSD TAND (degrees), SIN COS TAN ATN (radians), ASIN ACOS SQR ABS INT FIX CINT ROUND EXP LOG MIN MAX, IF(condition, then, else), PI. ', h('a', { href: '#/help' }, 'Full formula help'))),
      h('div', { class: 'card' }, h('h3', {}, 'Results to show'),
        h('table', { class: 'tbl-edit' }, h('tr', {}, ['Name', 'Label', 'Format', ''].map((x) => h('th', {}, x))),
          draft.outputs.map((o, k) => h('tr', {}, h('td', {}, inputEl(o, 'name', { class: 'name' })), h('td', {}, inputEl(o, 'label')),
            h('td', {}, selectEl(o, 'format', [['basic', 'like old BASIC (7 digits)'], ['fixed:2', '2 decimals'], ['fixed:4', '4 decimals'], ['fixed:6', '6 decimals'], ['fixed:8', '8 decimals']])), h('td', {}, delBtn(draft.outputs, k))))),
        ro ? null : h('button', { onclick: () => { draft.outputs.push({ name: '', label: '', format: 'fixed:6' }); draw(); } }, '+ Add result')),
      h('div', { class: 'card' }, h('h3', {}, 'Gear trains to search'),
        h('table', { class: 'tbl-edit' }, h('tr', {}, ['Type', 'Label', 'Ratio name(s)', 'Search', 'Inventory', 'Gears', 'Show best', ''].map((x) => h('th', {}, x))),
          draft.trains.map((t, k) => h('tr', {},
            h('td', {}, selectEl(t, 'kind', [['differential', 'differential'], ['index', 'index'], ['feed', 'feed'], ['other', 'other']])),
            h('td', {}, inputEl(t, 'label')),
            h('td', {}, t.strategy === 'bc-breakdown' ? (() => { const el = h('input', { type: 'text', value: (t.values || []).join(', '), disabled: ro || undefined }); el.addEventListener('input', () => { t.values = el.value.split(/[,\s]+/).filter(Boolean); validate(); }); return el; })() : inputEl(t, 'ratio', { class: 'name' })),
            h('td', {}, selectEl(t, 'strategy', [['ranked', 'best from inventory'], ['legacy-ramgear', 'original program search'], ['bc-breakdown', 'Barber-Colman breakdown']], () => draw())),
            h('td', {}, selectEl(t, 'inventory', invOpts)),
            h('td', {}, selectEl(t, 'gears', [['4', '4 (A/B×C/D)'], ['2', '2 (A/B)']], (v) => { t.gears = Number(v); })),
            h('td', {}, inputEl(t, 'maxResults', { style: 'width:60px' })),
            h('td', {}, delBtn(draft.trains, k))))),
        ro ? null : h('button', { onclick: () => { draft.trains.push({ kind: 'differential', label: 'Change gears', ratio: '', strategy: 'ranked', inventory: 'legacy-20-88', gears: 4, maxResults: 20 }); draw(); } }, '+ Add gear train')),
      h('div', { class: 'card' }, h('h3', {}, 'Printout lines (optional, BASIC PRINT style)'),
        (() => { const ta = h('textarea', { rows: Math.max(3, draft.report.length + 1), disabled: ro || undefined }, draft.report.join('\n')); ta.addEventListener('input', () => { draft.report = ta.value.split('\n').filter((l, i, a) => l !== '' || i < a.length - 1); validate(); }); return ta; })(),
        h('div', { class: 'small muted' }, 'Example: "RATIO: "; R    - text in quotes, names print with 7 digits like the old program; a comma jumps to the next 14-column zone.')),
      h('div', { class: 'card' }, h('details', {}, h('summary', {}, 'Advanced: edit as JSON'), jsonBox,
        ro ? null : h('button', { onclick: () => { try { const d = JSON.parse(jsonBox.value); d.id = draft.id; d.builtin = false; draft = d; draw(); } catch (e) { alert('Invalid JSON: ' + e.message); } } }, 'Apply JSON'))),
    );
    advanced.open = advancedOpen;
    validate();
  }

  function validate() {
    jsonBox.value = JSON.stringify(draft, null, 2);
    const c = calc.compileMachine(draft);
    status.replaceChildren();
    if (!c.ok) status.append(msg('err', h('b', {}, 'Fix these before saving:'), h('ul', {}, c.errors.map((e) => h('li', {}, `${e.where}: ${e.msg}`)))));
    else status.append(msg('ok', 'Formulas check out.'));
    c.warnings.forEach((w) => status.append(msg('warn', `${w.where}: ${w.msg}`)));
    if (store.machines.some((m) => m.id !== draft.id && m.name === draft.name)) status.append(msg('warn', 'Another machine already has this name.'));
    saveBtn.disabled = ro || !c.ok;
    preview.replaceChildren();
    if (c.ok) {
      const res = calc.evaluateMachine(draft, {}, { compiled: c, useExamples: true });
      if (!res.ok) { preview.append(msg('warn', 'Preview with example values: ', res.errors.join('; '))); return; }
      const rows = [...res.env.entries()].map(([n, v]) => h('tr', {}, h('td', {}, n), h('td', { class: 'num' }, trimNum(res.num.format(v)))));
      preview.append(h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', { class: 'num' }, 'Value with example inputs')), rows));
      res.warnings.forEach((w) => preview.append(msg('warn', w)));
      if (res.reportText.length) preview.append(h('pre', { class: 'screen' }, res.reportText.join('\n')));
      (draft.trains || []).forEach((t) => {
        try {
          if (t.strategy === 'ranked') {
            const r = calc.runTrain(res, t, previewInvs());
            const b = r.list[0];
            preview.append(h('div', { class: 'small' }, `${t.label || t.kind}: best ${b ? `${b.A}/${b.B}${b.C ? ` × ${b.C}/${b.D}` : ''} = ${b.ratio.toFixed(8)} (error ${fmtPct(b.err)})` : 'none'}`));
          } else if (t.strategy === 'legacy-ramgear') {
            const r = calc.runTrain(res, t, previewInvs(), { maxD: 60 });
            const first = calc.legacyFirstN(r.R, res.num, 1, { maxD: 60 })[0];
            preview.append(h('div', { class: 'small' }, `${t.label || t.kind}: first match ${first ? `A ${first.A} B ${first.B} C ${first.C} D ${first.D} = ${first.ratioText}` : 'none with D ≤ 60'}`));
          }
        } catch (e) { preview.append(msg('warn', `${t.label || t.kind}: ${e.message}`)); }
      });
    }
  }

  const previewInvs = () => [...allInventories(), { id: S.OWN_INV, name: 'own', gears: placeholderGears() }];
  const saveBtn = h('button', { class: 'primary', onclick: () => {
    const c = calc.compileMachine(draft);
    if (!c.ok) return;
    draft.builtin = false;
    // each machine gets its own index and differential gear lists, named after it
    draft.ownInventories = { ...(draft.ownInventories || {}) };
    for (const kind of ['index', 'differential']) {
      const t = S.trainOf(draft, kind);
      let inv = store.inventories.find((x) => x.id === draft.ownInventories[kind]);
      if (t && t.inventory === S.OWN_INV) {
        if (!inv) { inv = { id: newInvId(), name: '', gears: placeholderGears(), note: 'Placeholder: one of each 20-88. Change it to the gears you really have.' }; store.inventories.push(inv); draft.ownInventories[kind] = inv.id; }
        t.inventory = inv.id;
      }
      if (inv) inv.name = S.ownInventoryName(draft.name, kind);
      else delete draft.ownInventories[kind];
    }
    const k = store.machines.findIndex((m) => m.id === draft.id);
    if (k >= 0) store.machines[k] = draft; else store.machines.push(draft);
    saveStore();
    location.hash = `#/m/${draft.id}`;
  } }, 'Save machine');
  const locked = !isNew && isLocked(draft);
  const actions = h('div', { class: 'row' },
    ro ? (canEdit() ? h('button', { class: 'primary', id: 'copy-draft', onclick: () => (location.hash = `#/copy/${draft.id}`) }, locked ? 'Copy to new draft' : 'Copy to edit') : null) : saveBtn,
    h('button', { onclick: () => history.back() }, ro ? 'Back' : 'Cancel'),
    (!isNew && !draft.builtin && canEdit() && !locked && !ro) ? h('button', { class: 'blue', id: 'verify-lock', onclick: () => verifyAndLock(draft) }, 'Verify & lock (saved version)') : null,
    (!isNew && !draft.builtin && canDelete() && store.machines.some((x) => x.id === draft.id)) ? h('button', { class: 'danger', id: 'delete-machine', onclick: () => deleteMachine(draft) }, 'Delete machine') : null);
  $main.replaceChildren(
    h('div', { class: 'card' }, h('h2', {}, ro ? `Formulas of ${draft.name}` : (isNew ? 'Add a machine' : `Edit ${draft.name}`), ro ? h('span', { class: 'badge builtin' }, 'read-only') : null, isNew ? h('span', { class: 'badge draft' }, 'Draft') : lockBadge(draft)),
      locked ? h('p', { class: 'muted', id: 'locked-note' }, `${lockText(draft)}. Its formulas, constants, inputs and gear trains cannot be changed by anyone, admins included. Gear lists and index presets can still be edited by an admin from the machine page; use "Copy to new draft" for a changed version.`) : null,
      locked ? null : ro ? h('p', { class: 'muted' }, canEdit() ? 'Original programs cannot be changed. Use "Copy to edit" to make your own version.' : 'Read-only: only an admin can change machines.') : h('p', { class: 'muted' }, 'Give the machine a name and type its index constant and differential constant. The input form, ratios and gear searches are built automatically.'),
      actions),
    h('div', { class: 'flex2' }, h('div', { class: 'editor-main', style: 'flex:3 1 640px' }, sections), h('div', { style: 'flex:1 1 300px' }, h('div', { class: 'card', style: 'position:sticky; top:10px' }, h('h3', {}, 'Check & preview'), status, preview))));
  draw();
}

// ------------------------------------------------------------------ inventories
function parseGearList(text) {
  const gears = new Map();
  const errs = [];
  for (const tok of String(text).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?(?:\s*[x×*]\s*(\d+))?$/i.exec(tok);
    if (!m) { errs.push(`"${tok}" not understood`); continue; }
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a, q = m[3] ? Number(m[3]) : 1;
    if (b < a || b - a > 1000) { errs.push(`"${tok}" bad range`); continue; }
    for (let t = a; t <= b; t++) gears.set(t, (gears.get(t) || 0) + q);
  }
  return { gears: [...gears.entries()].sort((x, y) => x[0] - y[0]).map(([teeth, qty]) => ({ teeth, qty })), errs };
}
function gearListText(gears) {
  const out = [];
  let i = 0;
  while (i < gears.length) {
    let j = i;
    while (j + 1 < gears.length && gears[j + 1].teeth === gears[j].teeth + 1 && gears[j + 1].qty === gears[i].qty) j++;
    const q = gears[i].qty !== 1 ? ` x${gears[i].qty}` : '';
    out.push(j > i ? `${gears[i].teeth}-${gears[j].teeth}${q}` : `${gears[i].teeth}${q}`);
    i = j + 1;
  }
  return out.join(', ');
}
function renderInventories(editId) {
  const list = h('div', { class: 'card' }, h('h2', {}, 'Gear inventories'),
    h('p', { class: 'muted' }, 'A gear inventory is the set of change gears you have for a machine (tooth counts and how many of each). The "best from inventory" search only uses these gears and respects the quantities.'),
    h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Gears'), h('th', {}, '')),
      allInventories().map((inv) => h('tr', {}, h('td', {}, inv.name, inv.builtin ? h('span', { class: 'badge builtin' }, 'built-in') : null), h('td', { class: 'small' }, gearListText(inv.gears)),
        h('td', {}, !canEdit() ? null : inv.builtin ? h('button', { onclick: () => copyInv(inv) }, 'Copy to edit') : [h('button', { onclick: () => (location.hash = `#/inventories/${inv.id}`) }, 'Edit'), ' ', h('button', { onclick: () => copyInv(inv) }, 'Duplicate'),
          ...(canDelete() ? [' ', h('button', { class: 'danger inv-clear', onclick: () => { if (clearInventory(inv)) route(); } }, 'Clear'), ' ', h('button', { class: 'danger inv-del', onclick: () => { if (deleteInventory(inv)) route(); } }, 'Delete')] : [])])))),
    !canEdit() ? null : h('div', { style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: () => { const inv = { id: 'inv-' + Math.random().toString(36).slice(2, 8), name: 'My gear box', gears: [] }; store.inventories.push(inv); saveStore(); location.hash = `#/inventories/${inv.id}`; } }, '+ New inventory')));
  const kids = [list];
  const inv = store.inventories.find((x) => x.id === editId);
  if (inv && canEdit()) kids.unshift(inventoryEditor(inv));
  $main.replaceChildren(...kids);
}
// Per-gear table editor: tooth count, quantity, note; quick entry; CSV import / export.
function inventoryEditor(inv) {
  const G = calc.gearcsv;
  let rows = clone(inv.gears || []).map((g) => ({ teeth: g.teeth, qty: g.qty === undefined ? 1 : g.qty, note: g.note || '' }));
  const name = h('input', { type: 'text', id: 'inv-name', value: inv.name });
  const tbody = h('tbody');
  const info = h('div', {});
  const csvPreview = h('div', {});
  const check = () => {
    const errs = [];
    rows.forEach((r, k) => {
      if (!/^\d+$/.test(String(r.teeth).trim()) || Number(r.teeth) <= 0) errs.push(`row ${k + 1}: tooth count must be a whole number above 0`);
      if (!/^\d+$/.test(String(r.qty).trim())) errs.push(`row ${k + 1}: quantity must be a whole number`);
    });
    info.replaceChildren(errs.length ? msg('err', errs.join('; ')) : msg('ok', `${rows.length} rows, ${rows.reduce((s, g) => s + Number(g.qty || 0), 0)} gears in total.`));
    return errs;
  };
  const drawRows = () => {
    tbody.replaceChildren(...rows.map((r, k) => {
      const cell = (key, attrs) => { const el = h('input', { type: 'text', value: String(r[key]), ...attrs }); el.addEventListener('input', () => { r[key] = el.value; check(); }); return el; };
      return h('tr', {}, h('td', {}, cell('teeth', { class: 'gear-teeth', style: 'width:80px', inputmode: 'numeric' })), h('td', {}, cell('qty', { class: 'gear-qty', style: 'width:60px', inputmode: 'numeric' })),
        h('td', {}, cell('note', { class: 'gear-note' })), h('td', {}, h('button', { class: 'x', title: 'Remove this gear', onclick: () => { rows.splice(k, 1); drawRows(); } }, '×')));
    }));
    check();
  };
  const quick = h('input', { type: 'text', id: 'quick-gears', placeholder: 'e.g. 20, 24, 30, 36  or  40-48  or  30 x2', style: 'max-width:340px' });
  const quickAdd = () => {
    const p = parseGearList(quick.value);
    if (p.errs.length) { info.replaceChildren(msg('err', p.errs.join('; '))); return; }
    rows = G.mergeGears(rows.map((r) => ({ ...r, teeth: Number(r.teeth), qty: Number(r.qty) })), p.gears).map((g) => ({ ...g, note: g.note || '' }));
    quick.value = ''; drawRows();
  };
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); quickAdd(); } });
  const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv', style: 'display:none', id: 'csv-file' });
  file.addEventListener('change', async () => { const f = file.files[0]; if (f) showCsv(await f.text(), f.name); file.value = ''; });
  const showCsv = (text, fname) => {
    const p = G.parseGearCsv(text);
    csvPreview.replaceChildren(h('div', { class: 'card', id: 'csv-preview' }, h('h3', {}, `Import preview: ${fname}`),
      h('p', { class: 'small' }, `${p.rows.length} good row(s)${p.header ? ', header row found' : ''}, separator "${p.sep === '\t' ? 'tab' : p.sep}".`),
      p.bad.length ? msg('warn', h('b', {}, `${p.bad.length} row(s) will be skipped:`), h('ul', {}, p.bad.map((b) => h('li', {}, `line ${b.line}: ${b.reason} (${b.text})`)))) : null,
      p.rows.length ? h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, h('th', { class: 'num' }, 'Line'), h('th', { class: 'num' }, 'Teeth'), h('th', { class: 'num' }, 'Qty'), h('th', {}, 'Note')),
        p.rows.map((r) => h('tr', {}, h('td', { class: 'num' }, r.line), h('td', { class: 'num' }, r.teeth), h('td', { class: 'num' }, r.qty), h('td', {}, r.note))))) : msg('err', 'No usable rows in this file.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: !p.rows.length || undefined, onclick: () => { rows = G.mergeGears([], p.rows).map((g) => ({ ...g, note: g.note || '' })); csvPreview.replaceChildren(); drawRows(); } }, 'Replace my list with these'),
        h('button', { class: 'blue', disabled: !p.rows.length || undefined, onclick: () => { rows = G.mergeGears(rows.map((r) => ({ ...r, teeth: Number(r.teeth), qty: Number(r.qty) })), p.rows).map((g) => ({ ...g, note: g.note || '' })); csvPreview.replaceChildren(); drawRows(); } }, 'Add to my list'),
        h('button', { onclick: () => csvPreview.replaceChildren() }, 'Cancel')),
      h('p', { class: 'small muted' }, 'Nothing changes until you pick Replace or Add, and then Save.')));
  };
  const save = () => {
    if (check().length) return;
    inv.name = name.value || 'Unnamed';
    inv.gears = G.mergeGears([], rows.map((r) => ({ teeth: Number(r.teeth), qty: Number(r.qty), note: String(r.note || '').trim() })));
    saveStore(); location.hash = '#/inventories';
  };
  const usedBy = store.machines.filter((m) => (m.trains || []).some((t) => t.inventory === inv.id)).map((m) => m.name);
  const card = h('div', { class: 'card', id: 'inv-editor' }, h('h3', {}, 'Edit gear list'),
    usedBy.length ? h('p', { class: 'small muted' }, 'Used by: ', usedBy.join(', ')) : null,
    h('div', { class: 'grid-form' }, h('label', {}, 'Name'), name, h('div', {})),
    h('div', { class: 'row', style: 'margin:8px 0' }, h('label', {}, 'Quick add: '), quick, h('button', { onclick: quickAdd }, 'Add gears')),
    h('div', { class: 'small muted' }, 'Type tooth counts separated by commas and press Add. "40-48" adds every count from 40 to 48, "30 x2" adds two. Gears you already have get their quantity increased.'),
    h('table', { class: 'tbl-edit', id: 'gear-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tooth count'), h('th', {}, 'Quantity'), h('th', {}, 'Note (optional)'), h('th', {}, ''))), tbody),
    h('div', { class: 'row', style: 'margin:6px 0' }, h('button', { onclick: () => { rows.push({ teeth: '', qty: 1, note: '' }); drawRows(); const l = tbody.querySelector('tr:last-child input'); if (l) l.focus(); } }, '+ Add gear'),
      h('button', { onclick: () => { if (confirm('Remove every gear from this list?')) { rows = []; drawRows(); } } }, 'Clear list')),
    h('div', { class: 'row', style: 'margin:6px 0' }, file, h('button', { onclick: () => file.click() }, 'Import CSV'),
      h('button', { onclick: () => downloadText(`${(name.value || 'gears').replace(/[^\w -]+/g, '')}.csv`, G.gearsToCsv(rows), 'text/csv') }, 'Export CSV'),
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); downloadText('sample-gear-list.csv', G.SAMPLE_CSV, 'text/csv'); } }, 'Download sample CSV'),
      h('span', { class: 'small muted' }, 'Columns: teeth, qty, note (qty defaults to 1). Header row optional; comma or semicolon; one column of tooth counts also works.')),
    csvPreview, info,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: save }, 'Save'),
      h('button', { onclick: () => (location.hash = '#/inventories') }, 'Cancel'),
      !canDelete() ? null : h('button', { class: 'danger', id: 'inv-delete', onclick: () => { if (deleteInventory(inv)) location.hash = '#/inventories'; } }, 'Delete gear list')));
  card._showCsv = showCsv;
  window.__rgShowCsv = showCsv; // used by the browser test
  drawRows();
  return card;
}
function copyInv(inv) {
  const c = { ...clone(inv), id: 'inv-' + Math.random().toString(36).slice(2, 8), name: inv.name + ' (copy)', builtin: false };
  delete c.note;
  store.inventories.push(c); saveStore(); location.hash = `#/inventories/${c.id}`;
}

// ------------------------------------------------------------------ import / export
function renderIO() {
  const result = h('div', {});
  const inclMan = h('input', { type: 'checkbox', id: 'incl-manuals' });
  const expMsg = h('div', {});
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const mode = h('select', {}, h('option', { value: 'merge' }, 'Add / update (keep my other machines)'), h('option', { value: 'replace' }, 'Replace ALL shared machines and gear lists'));
  file.addEventListener('change', async () => {
    result.replaceChildren();
    const f = file.files[0];
    if (!f) return;
    const p = calc.parseBundle(await f.text());
    if (p.errors.length) result.append(msg(p.ok ? 'warn' : 'err', h('ul', {}, p.errors.map((e) => h('li', {}, e)))));
    if (!p.machines && !p.inventories) return;
    const nMan = Object.keys(p.manuals || {}).length;
    const n = `${p.machines.length} machine(s), ${p.inventories.length} inventory(ies), ${Object.keys(p.builtinOverrides).length} built-in setting(s)${nMan ? `, ${nMan} manual(s)` : ''}`;
    result.append(h('p', {}, `Found ${n}.`), h('button', { class: 'primary', id: 'import-now', onclick: async () => {
      if (mode.value === 'replace') { store.machines = []; store.inventories = []; store.builtinOverrides = {}; }
      const up = (arr, items) => items.forEach((x) => { const k = arr.findIndex((y) => y.id === x.id); if (k >= 0) arr[k] = x; else arr.push(x); });
      up(store.machines, p.machines); up(store.inventories, p.inventories);
      Object.assign(store.builtinOverrides, p.builtinOverrides);
      saveStore(); renderNav();
      let manMsg = '';
      if (nMan) { try { await dataStore.importManuals(p.manuals); } catch (e) { manMsg = ` Manuals could not be restored: ${e.message}.`; } }
      result.replaceChildren(msg(manMsg ? 'warn' : 'ok', `Imported ${n}.${manMsg}`));
    } }, 'Import now'));
  });
  const upMsg = h('div', { id: 'upload-local-msg' });
  const uploadCard = (canEdit() && dataStore.hasLocalData()) ? h('div', { class: 'card', id: 'upload-local' }, h('h3', {}, 'Upload my local data to the shared database'),
    h('p', {}, 'This PC still has machines, gear lists or presets saved by the old version (before logins). Upload them once so everyone sees them. Machines with the same name in the shared database are replaced.'),
    dataStore.localDataUploaded() ? h('p', { class: 'small muted' }, 'Already uploaded from this PC once. Uploading again overwrites shared changes made since with this PC\'s old copy.') : null,
    h('button', { class: 'primary', id: 'upload-local-go', onclick: async (ev) => {
      if (!confirm('Upload this PC\'s old saved data to the shared database for everyone?')) return;
      ev.target.disabled = true; upMsg.replaceChildren(h('span', { class: 'small muted' }, 'Uploading…'));
      try { const n = await dataStore.uploadLocalData(store); renderNav(); upMsg.replaceChildren(msg(document.getElementById('sync-banner') ? 'err' : 'ok', `Uploaded ${n.machines} machine(s), ${n.inventories} gear list(s), ${n.builtins} original-program setting(s).`)); }
      catch (e) { upMsg.replaceChildren(msg('err', 'Upload failed: ' + ((e && e.message) || e))); }
      ev.target.disabled = false;
    } }, 'Upload my local data to the shared database'), upMsg) : null;
  $main.replaceChildren(uploadCard, h('div', { class: 'card' }, h('h2', {}, 'Import / export'),
    h('p', {}, 'Machines, their gear lists and presets, and gear-search settings for the original programs are kept in the shared RAM-GEAR database. Export them to a file for a backup.'),
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'export-json', onclick: async () => {
      let man;
      expMsg.replaceChildren();
      if (inclMan.checked) { try { man = await dataStore.exportManuals(); } catch (e) { expMsg.append(msg('warn', `Manuals left out: ${e.message}`)); } }
      const bundle = calc.makeBundle({ machines: store.machines, inventories: store.inventories, builtinOverrides: store.builtinOverrides, manuals: man });
      downloadText(`ramgear-machines-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    } }, 'Export to file'), h('label', {}, inclMan, ' Include manuals (larger file)')), expMsg,
    canEdit() ? h('h3', { style: 'margin-top:18px' }, 'Import from file') : null, canEdit() ? h('div', { class: 'row' }, file, mode) : null, result));
}

// ------------------------------------------------------------------ help
function renderHelp() {
  $main.replaceChildren(h('div', { class: 'card', html: `
<h2>Formula help</h2>
<p>Formulas are written like on a calculator or in the old BASIC program. Names are not case sensitive.</p>
<table>
<tr><th>Write</th><th>Means</th></tr>
<tr><td><code>+ - * /</code></td><td>add, subtract, multiply, divide</td></tr>
<tr><td><code>^</code></td><td>power, e.g. <code>D ^ 2</code></td></tr>
<tr><td><code>( )</code></td><td>brackets</td></tr>
<tr><td><code>SIND(A) COSD(A) TAND(A)</code></td><td>sine / cosine / tangent of an angle in <b>degrees</b></td></tr>
<tr><td><code>SIN(X) COS(X) TAN(X) ATN(X)</code></td><td>same in <b>radians</b> (what the old BASIC used; <code>B * PI / 180</code> converts degrees)</td></tr>
<tr><td><code>ASIND ACOSD ATND / ASIN ACOS</code></td><td>inverse functions (degrees / radians)</td></tr>
<tr><td><code>SQR(X)</code> or <code>SQRT(X)</code></td><td>square root</td></tr>
<tr><td><code>ABS INT FIX CINT ROUND</code></td><td>absolute value; INT rounds down (INT(-2.5) = -3); FIX cuts off decimals (FIX(-2.5) = -2); CINT/ROUND round to the nearest whole number, halves away from zero, like BASIC</td></tr>
<tr><td><code>MIN(a,b,..) MAX(a,b,..)</code></td><td>smallest / largest</td></tr>
<tr><td><code>IF(condition, a, b)</code></td><td>a when the condition is true, otherwise b. Conditions use <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>, <code>AND</code>, <code>OR</code>, <code>NOT</code></td></tr>
<tr><td><code>PI</code></td><td>3.14159265358979…</td></tr>
<tr><td><code>25.4000508#</code></td><td>a number with # is a double-precision constant (old BASIC notation)</td></tr>
</table>
<p>A formula may use inputs, constants and other formulas (in any order). The app checks for typing errors, unknown names and formulas that depend on themselves before you can save.</p>
<p>Example differential formula: <code>RDIFF = KDIFF * SIND(HELIX) / (MN * STARTS)</code></p>
<p>Arithmetic setting: <b>Old BASIC single precision</b> reproduces the original program digit for digit (7 significant digits). <b>Normal</b> uses full double precision.</p>` }));
}

// ------------------------------------------------------------------ manual PDF (IndexedDB)
function manualBar(m) {
  const bar = h('div', { class: 'row manual-bar', id: 'manual-bar' });
  const file = h('input', { type: 'file', accept: '.pdf,application/pdf', style: 'display:none', id: 'manual-file' });
  const note = h('span', { class: 'small muted', id: 'manual-status' });
  const draw = (rec, err) => {
    bar.replaceChildren(h('b', {}, 'Manual: '), file,
      canEdit() ? h('button', { id: 'manual-attach', onclick: () => file.click(), disabled: err ? true : undefined }, rec ? 'Replace manual (PDF)' : 'Attach manual (PDF)') : null,
      rec ? h('button', { id: 'manual-open', onclick: () => openManual(m) }, 'Open manual') : null,
      (rec && canDelete()) ? h('button', { id: 'manual-remove', onclick: async () => { if (!confirm(`Remove the manual "${rec.name}" from this browser?`)) return; await dataStore.deleteManual(m.id); draw(null); } }, 'Remove') : null,
      note);
    note.className = err ? 'small err-text' : 'small muted';
    note.textContent = err ? `Manuals can't be stored in this browser: ${err}. Calculations still work.` : rec ? `${rec.name} (${Math.max(1, Math.round(rec.size / 1024))} KB) - kept in this browser only, not on the website or in the shared database.` : (canEdit() ? 'Kept in this browser only, never uploaded.' : 'No manual on this PC.');
  };
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    if (!dataStore.looksLikePdf(f)) { alert('Please pick a PDF file.'); return; }
    try { await dataStore.putManual(m.id, f, f.name); draw(await dataStore.getManual(m.id)); }
    catch (e) { draw(null, (e && e.message) || String(e)); }
  });
  if (!dataStore.manualsAvailable()) draw(null, 'IndexedDB is not available (private window or blocked site data)');
  else { draw(null); dataStore.getManual(m.id).then((r) => draw(r || null)).catch((e) => draw(null, (e && e.message) || String(e))); }
  return bar;
}
async function openManual(m) {
  const w = window.open('', '_blank');
  try {
    const rec = await dataStore.getManual(m.id);
    if (!rec) throw new Error('no manual attached');
    const url = URL.createObjectURL(rec.blob.type ? rec.blob : new Blob([rec.blob], { type: 'application/pdf' }));
    if (w) w.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { if (w) w.close(); alert('Could not open the manual: ' + ((e && e.message) || e)); }
}

// ------------------------------------------------------------------ index gear presets editor
function presetEditor(m, onChange) {
  const card = h('div', { class: 'card out-card', id: 'preset-editor' });
  let rows;
  const info = h('div', {});
  const csvPreview = h('div', {});
  const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv', style: 'display:none', id: 'preset-csv-file' });
  file.addEventListener('change', async () => { const f = file.files[0]; if (f) showCsv(await f.text(), f.name); file.value = ''; });
  const commit = () => {
    const errs = [], list = [];
    rows.forEach((r, k) => { const c = P.cleanPreset(r); if (c.errors.length) errs.push(`row ${k + 1}: ${c.errors.join('; ')}`); else list.push(c.preset); });
    if (errs.length) { info.replaceChildren(msg('err', errs.join(' | '))); return false; }
    setPresets(m, list.sort((a, b) => a.z - b.z)); rows = clone(list);
    if (onChange) onChange();
    info.replaceChildren(msg('ok', `Saved ${list.length} preset(s).`));
    return true;
  };
  const showCsv = (text, fname) => {
    const p = P.parsePresetCsv(text);
    csvPreview.replaceChildren(h('div', { class: 'card', id: 'preset-csv-preview' }, h('h3', {}, `Preset import preview: ${fname}`),
      h('p', { class: 'small' }, `${p.rows.length} good row(s)${p.header ? ', header row found' : ''}.`),
      p.bad.length ? msg('warn', h('b', {}, `${p.bad.length} row(s) will be skipped:`), h('ul', {}, p.bad.map((b) => h('li', {}, `line ${b.line}: ${b.reason}`)))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: !p.rows.length || undefined, onclick: () => { rows = p.rows.map(({ line, ...x }) => x); csvPreview.replaceChildren(); commit(); draw(); } }, 'Replace presets with these'),
        h('button', { class: 'blue', disabled: !p.rows.length || undefined, onclick: () => { let l = getPresets(m); p.rows.forEach(({ line, ...x }) => { l = P.upsertPreset(l, x); }); rows = clone(l); csvPreview.replaceChildren(); commit(); draw(); } }, 'Add to presets'),
        h('button', { onclick: () => csvPreview.replaceChildren() }, 'Cancel'))));
  };
  const cell = (r, key, w) => { const el = h('input', { type: 'text', value: r[key] === undefined ? '' : String(r[key]), class: `preset-${key}`, style: `width:${w}px`, inputmode: key === 'note' ? undefined : 'numeric' }); el.addEventListener('input', () => { r[key] = el.value; }); return el; };
  const draw = () => {
    if (!canEdit()) {
      card.replaceChildren(h('h3', {}, 'Index gear presets'),
        rows.length ? h('table', { id: 'preset-table' }, h('thead', {}, h('tr', {}, ['z', 'A', 'B', 'C', 'D', 'Note'].map((x) => h('th', {}, x)))),
          h('tbody', {}, rows.map((r) => h('tr', {}, ['z', 'A', 'B', 'C', 'D'].map((k) => h('td', { class: 'num' }, r[k] ?? '')), h('td', { class: 'small' }, r.note || ''))))) : h('p', { class: 'small muted' }, 'No presets saved for this machine.'),
        h('div', { class: 'row', style: 'margin:6px 0' }, h('button', { onclick: () => downloadText(`${m.name.replace(/[^\w -]+/g, '')} index presets.csv`, P.presetsToCsv(getPresets(m)), 'text/csv') }, 'Export CSV'),
          h('span', { class: 'small muted' }, 'Only an admin can add or change presets.')));
      return;
    }
    const keepInfo = [...info.childNodes];
    card.replaceChildren(h('h3', {}, 'Index gear presets'),
      h('p', { class: 'small muted' }, 'Saved index gear sets for a tooth count z. When the part\'s z matches, the set is shown first, marked Preset. Gears do not have to be in the gear list - for a prime z like 101 you need a 101-tooth gear. Leave C and D empty for a 2-gear A/B set.'),
      h('table', { class: 'tbl-edit', id: 'preset-table' }, h('thead', {}, h('tr', {}, ['z', 'A', 'B', 'C', 'D', 'Note', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map((r, k) => h('tr', {}, h('td', {}, cell(r, 'z', 60)), h('td', {}, cell(r, 'A', 55)), h('td', {}, cell(r, 'B', 55)), h('td', {}, cell(r, 'C', 55)), h('td', {}, cell(r, 'D', 55)), h('td', {}, cell(r, 'note', 220)),
          h('td', {}, h('button', { class: 'x', title: 'Delete preset', onclick: () => { rows.splice(k, 1); commit(); draw(); } }, '×')))))),
      h('div', { class: 'row', style: 'margin:6px 0' },
        h('button', { id: 'preset-add', onclick: () => { rows.push({ z: '', A: '', B: '', C: '', D: '', note: '' }); draw(); const l = card.querySelector('#preset-table tbody tr:last-child input'); if (l) l.focus(); } }, '+ Add preset'),
        h('button', { class: 'primary', id: 'preset-save', onclick: () => { if (commit()) draw(); } }, 'Save presets'),
        file, h('button', { onclick: () => file.click() }, 'Import CSV'),
        h('button', { onclick: () => downloadText(`${m.name.replace(/[^\w -]+/g, '')} index presets.csv`, P.presetsToCsv(getPresets(m)), 'text/csv') }, 'Export CSV'),
        h('span', { class: 'small muted' }, 'CSV columns: z, A, B, C, D, note')),
      csvPreview, info);
    info.replaceChildren(...keepInfo);
  };
  card.refresh = () => { rows = clone(getPresets(m)); draw(); };
  window.__rgShowPresetCsv = (t, n) => showCsv(t, n); // used by the browser test
  card.refresh();
  return card;
}

route();
