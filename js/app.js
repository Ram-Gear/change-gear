// app.js - browser UI. All maths lives in calc.js (and the modules it re-exports).
import * as calc from './calc.js';

const STORE_KEY = 'ramgear.changegear.v1';
export const APP_VERSION = 'RAM-GEAR web v1.2 (2026-10-10b)';
// Browser storage can be blocked (Edge/Chrome "block site data", some file:// policies, private
// windows, full quota). Never let that stop a calculation: fall back to memory and say so.
let storageProblem = null;
function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { storageProblem = storageProblem || e; return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { const first = !storageProblem; storageProblem = storageProblem || e; if (first) showStorageBanner(); return false; } }
function showStorageBanner() {
  if (document.getElementById('storage-banner')) return;
  const d = document.createElement('div'); d.id = 'storage-banner'; d.className = 'msg warn';
  d.textContent = 'This browser is blocking saved data for this page (' + ((storageProblem && storageProblem.message) || 'storage unavailable') + '). Calculations still work, but gear inventories, your machines and last inputs will not be kept after you close the page. Use Import / export to save a backup, or allow site data for this file in browser settings.';
  const main = document.getElementById('main'); if (main && main.parentNode) main.parentNode.insertBefore(d, main); else document.body.prepend(d);
}
const $main = document.getElementById('main');
const $nav = document.getElementById('nav');

// ------------------------------------------------------------------ storage
function loadStore() {
  try {
    const s = JSON.parse(lsGet(STORE_KEY) || '{}') || {};
    return { machines: s.machines || [], inventories: s.inventories || [], builtinOverrides: s.builtinOverrides || {}, lastInputs: s.lastInputs || {}, settings: s.settings || {} };
  } catch (e) { return { machines: [], inventories: [], builtinOverrides: {}, lastInputs: {}, settings: {} }; }
}
let store = loadStore();
function saveStore() { try { lsSet(STORE_KEY, JSON.stringify(store)); } catch (e) { console.error(e); } }
if (storageProblem) setTimeout(showStorageBanner, 0);
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
const fmtPct = (e) => (e === 0 ? '0' : (e > 0 ? '+' : '') + (e * 100).toFixed(5)) + ' %';
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
    link('#/new', h('span', { class: 'num' }, '+'), 'Add a machine'),
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
      h('p', {}, 'Pick a program on the left. The eight programs from the original BASIC menu give exactly the same numbers as the old program. You can also add your own machines with their own formulas and gear inventories.'),
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
      h('p', { class: 'small muted' }, 'The two old BASICs round the 7th digit slightly differently. Quick check if you still have an old printout: Barber-Colman index, constant 4.32, 20 teeth, same hand. GW-BASIC prints "64.80001 / 85.4", QBasic-style prints "64.8 / 85.4". Change gears found are the same in almost every case.')),
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
  if (!m) { $main.replaceChildren(msg('err', `Machine "${id}" not found.`)); return; }
  const compiled = calc.compileMachine(m);
  const last = store.lastInputs[m.id] || {};
  const fields = {};
  const head = h('div', { class: 'card' },
    h('div', { class: 'row', style: 'justify-content:space-between' },
      h('h2', {}, m.builtin ? `(${m.menu}) ` : '', m.name, m.builtin ? h('span', { class: 'badge builtin' }, 'original program') : h('span', { class: 'badge' }, 'my machine')),
      h('div', { class: 'row' },
        m.builtin ? [h('button', { onclick: () => (location.hash = `#/view/${m.id}`) }, 'View formulas'), h('button', { onclick: () => (location.hash = `#/copy/${m.id}`) }, 'Copy to edit')]
          : [h('button', { onclick: () => (location.hash = `#/edit/${m.id}`) }, 'Edit'), h('button', { onclick: () => (location.hash = `#/copy/${m.id}`) }, 'Duplicate')])),
    h('p', { class: 'muted' }, m.description || ''),
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
  $main.replaceChildren(head, h('div', { class: 'card' }, h('h3', {}, 'Job details and inputs'), form), out);

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
    const card = h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', {}, 'Results'),
      h('button', { onclick: () => printSheet(m, res, inputs, job, trainState) }, 'Print sheet')));
    res.warnings.forEach((w) => card.append(msg('warn', w.replace('Division by zero', 'Division by zero (the original BASIC prints "Division by zero" and carries on with its largest number, 1.701412E+38)'))));
    card.append(h('table', { class: 'results-table' }, compiled.outputs.map((o) => h('tr', {}, h('td', {}, o.label || o.name), h('td', { class: 'big' }, formatOutput(res, o))))));
    if (res.reportText.length) card.append(h('details', { open: m.builtin }, h('summary', {}, 'Original program screen'), h('pre', { class: 'screen' }, res.reportText.join('\n'))));
    out.append(card);
    if (card.scrollIntoView && !auto) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const trainState = [];
    (m.trains || []).forEach((t0, i) => {
      try { out.append(renderTrain(m, res, i, trainState)); }
      catch (e) { console.error(e); out.append(msg('err', `Gear search failed (${e.message}). The ratio above is still correct.`)); }
    });
  }
  if (Object.keys(last).length) calculate(true);
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

function renderTrain(m, res, i, trainState) {
  const base = m.trains[i];
  const t = calc.effectiveTrain(base, trainOverride(m, i));
  const card = h('div', { class: 'card' });
  const body = h('div', {});
  const st = (trainState[i] = { train: t, matches: [], selected: null });
  const invSel = h('select', { onchange: () => { setTrainOverride(m, i, { inventory: invSel.value }); rerender(); } }, allInventories().map((v) => h('option', { value: v.id }, v.name)));
  invSel.value = t.inventory || 'legacy-20-88';
  const stratSel = h('select', { onchange: () => { setTrainOverride(m, i, { strategy: stratSel.value }); rerender(); } },
    h('option', { value: 'legacy-ramgear' }, 'Original program search (first match, then Continue)'),
    h('option', { value: 'ranked' }, 'Best matches from gear inventory (ranked by error)'));
  stratSel.value = t.strategy;
  const rerender = () => card.replaceWith(renderTrain(m, res, i, trainState));
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
    try {
      const r = calc.runTrain(res, t, allInventories());
      st.matches = r.list;
      r.list.forEach((v, k) => {
        const tr = h('tr', { class: 'clickable', onclick: () => { tbody.querySelectorAll('tr').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel'); st.selected = v; } },
          h('td', { class: 'num' }, k + 1), h('td', { class: 'num' }, v.A), h('td', { class: 'num' }, v.B), h('td', { class: 'num' }, v.C ?? ''), h('td', { class: 'num' }, v.D ?? ''),
          h('td', { class: 'num' }, v.ratio.toFixed(8)), h('td', { class: 'num' }, fmtPct(v.err)));
        tbody.append(tr);
        if (k === 0) { tr.classList.add('sel'); st.selected = v; }
      });
      body.append(r.list.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Rank', 'A', 'B', 'C', 'D', 'Train ratio', 'Error'].map((x) => h('th', { class: 'num' }, x)))), tbody) : msg('warn', 'No combination within the tolerance.'),
        h('div', { class: 'small muted' }, 'Drivers A, C / driven B, D. Swapping A with C (or B with D) gives the same ratio and is listed once. Gear quantities in the inventory are respected.'));
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
    if (m.builtin) readOnly = true;
  } else if (copyOf) {
    const m = findMachine(copyOf);
    draft = clone(m);
    draft.id = 'custom-' + Math.random().toString(36).slice(2, 9);
    draft.name = m.name + ' (my copy)';
    draft.builtin = false;
    delete draft.menu;
    if (m.builtin) draft.description = `Copied from original program (${m.menu}). ${m.description}`;
    isNew = true;
  } else {
    draft = calc.newMachineTemplate();
    isNew = true;
  }
  const ro = !!readOnly;
  const status = h('div', {});
  const preview = h('div', {});
  const sections = h('div', {});
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
    sections.replaceChildren(
      h('div', { class: 'card' }, h('h3', {}, 'Machine'),
        h('div', { class: 'grid-form' },
          h('label', {}, 'Name'), inputEl(draft, 'name'), h('div', {}),
          h('label', {}, 'Description'), inputEl(draft, 'description'), h('div', {}),
          h('label', {}, 'Arithmetic'), selectEl(draft, 'numeric', [['float64', 'Normal (double precision) - recommended'], ['gwbasic', 'Old BASIC single precision (exactly like the original program)'], ['ieee-single', 'QBasic-style single precision (approximate)']]), h('div', { class: 'hint' }, 'Copies of the original programs keep "Old BASIC" so they give identical numbers.'))),
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
            const r = calc.runTrain(res, t, allInventories());
            const b = r.list[0];
            preview.append(h('div', { class: 'small' }, `${t.label || t.kind}: best ${b ? `${b.A}/${b.B}${b.C ? ` × ${b.C}/${b.D}` : ''} = ${b.ratio.toFixed(8)} (error ${fmtPct(b.err)})` : 'none'}`));
          } else if (t.strategy === 'legacy-ramgear') {
            const r = calc.runTrain(res, t, allInventories(), { maxD: 60 });
            const first = calc.legacyFirstN(r.R, res.num, 1, { maxD: 60 })[0];
            preview.append(h('div', { class: 'small' }, `${t.label || t.kind}: first match ${first ? `A ${first.A} B ${first.B} C ${first.C} D ${first.D} = ${first.ratioText}` : 'none with D ≤ 60'}`));
          }
        } catch (e) { preview.append(msg('warn', `${t.label || t.kind}: ${e.message}`)); }
      });
    }
  }

  const saveBtn = h('button', { class: 'primary', onclick: () => {
    const c = calc.compileMachine(draft);
    if (!c.ok) return;
    draft.builtin = false;
    const k = store.machines.findIndex((m) => m.id === draft.id);
    if (k >= 0) store.machines[k] = draft; else store.machines.push(draft);
    saveStore();
    location.hash = `#/m/${draft.id}`;
  } }, 'Save machine');
  const actions = h('div', { class: 'row' },
    ro ? h('button', { class: 'primary', onclick: () => (location.hash = `#/copy/${draft.id}`) }, 'Copy to edit') : saveBtn,
    h('button', { onclick: () => history.back() }, ro ? 'Back' : 'Cancel'),
    (!ro && !isNew) ? h('button', { onclick: () => {
      if (!confirm(`Delete "${draft.name}" from this browser? (Export first if you want a backup.)`)) return;
      store.machines = store.machines.filter((m) => m.id !== draft.id); saveStore(); location.hash = '#/';
    } }, 'Delete machine') : null);
  $main.replaceChildren(
    h('div', { class: 'card' }, h('h2', {}, ro ? `Formulas of ${draft.name}` : (isNew ? 'Add a machine' : `Edit ${draft.name}`), ro ? h('span', { class: 'badge builtin' }, 'read-only') : null),
      ro ? h('p', { class: 'muted' }, 'Original programs cannot be changed. Use "Copy to edit" to make your own version.') : h('p', { class: 'muted' }, 'Name the inputs, write the formulas, choose which gear train each ratio drives. The input form and gear search are built automatically.'),
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
        h('td', {}, inv.builtin ? h('button', { onclick: () => copyInv(inv) }, 'Copy to edit') : [h('button', { onclick: () => (location.hash = `#/inventories/${inv.id}`) }, 'Edit'), ' ', h('button', { onclick: () => copyInv(inv) }, 'Duplicate')])))),
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: () => { const inv = { id: 'inv-' + Math.random().toString(36).slice(2, 8), name: 'My gear box', gears: [] }; store.inventories.push(inv); saveStore(); location.hash = `#/inventories/${inv.id}`; } }, '+ New inventory')));
  const kids = [list];
  const inv = store.inventories.find((x) => x.id === editId);
  if (inv) {
    const name = h('input', { type: 'text', value: inv.name });
    const ta = h('textarea', { rows: 5 }, gearListText(inv.gears));
    const info = h('div', {});
    const check = () => {
      const p = parseGearList(ta.value);
      info.replaceChildren(p.errs.length ? msg('err', p.errs.join('; ')) : msg('ok', `${p.gears.length} different tooth counts, ${p.gears.reduce((s, g) => s + g.qty, 0)} gears in total.`));
      return p;
    };
    ta.addEventListener('input', check);
    kids.push(h('div', { class: 'card' }, h('h3', {}, 'Edit inventory'),
      h('div', { class: 'grid-form' }, h('label', {}, 'Name'), name, h('div', {}), h('label', {}, 'Gears'), ta, h('div', { class: 'hint' }, 'Write tooth counts separated by commas. "20-88" = every count from 20 to 88; "x2" = you have two of them. Example: 20-60 x2, 64, 72, 80, 100 x1')),
      info,
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { const p = check(); if (p.errs.length) return; inv.name = name.value || 'Unnamed'; inv.gears = p.gears; saveStore(); location.hash = '#/inventories'; } }, 'Save'),
        h('button', { onclick: () => { if (confirm(`Delete inventory "${inv.name}"?`)) { store.inventories = store.inventories.filter((x) => x !== inv); saveStore(); location.hash = '#/inventories'; } } }, 'Delete'))));
    setTimeout(check);
  }
  $main.replaceChildren(...kids);
}
function copyInv(inv) {
  const c = { ...clone(inv), id: 'inv-' + Math.random().toString(36).slice(2, 8), name: inv.name + ' (copy)', builtin: false };
  delete c.note;
  store.inventories.push(c); saveStore(); location.hash = `#/inventories/${c.id}`;
}

// ------------------------------------------------------------------ import / export
function renderIO() {
  const result = h('div', {});
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const mode = h('select', {}, h('option', { value: 'merge' }, 'Add / update (keep my other machines)'), h('option', { value: 'replace' }, 'Replace all my machines and inventories'));
  file.addEventListener('change', async () => {
    result.replaceChildren();
    const f = file.files[0];
    if (!f) return;
    const p = calc.parseBundle(await f.text());
    if (p.errors.length) result.append(msg(p.ok ? 'warn' : 'err', h('ul', {}, p.errors.map((e) => h('li', {}, e)))));
    if (!p.machines && !p.inventories) return;
    const n = `${p.machines.length} machine(s), ${p.inventories.length} inventory(ies), ${Object.keys(p.builtinOverrides).length} built-in setting(s)`;
    result.append(h('p', {}, `Found ${n}.`), h('button', { class: 'primary', onclick: () => {
      if (mode.value === 'replace') { store.machines = []; store.inventories = []; store.builtinOverrides = {}; }
      const up = (arr, items) => items.forEach((x) => { const k = arr.findIndex((y) => y.id === x.id); if (k >= 0) arr[k] = x; else arr.push(x); });
      up(store.machines, p.machines); up(store.inventories, p.inventories);
      Object.assign(store.builtinOverrides, p.builtinOverrides);
      saveStore(); renderNav(); result.replaceChildren(msg('ok', `Imported ${n}.`));
    } }, 'Import now'));
  });
  $main.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Import / export'),
    h('p', {}, 'Your machines, gear inventories and gear-search settings for the original programs are saved in this browser. Export them to a file for backup or to move them to another PC.'),
    h('button', { class: 'primary', onclick: () => {
      const bundle = calc.makeBundle({ machines: store.machines, inventories: store.inventories, builtinOverrides: store.builtinOverrides });
      const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })), download: `ramgear-machines-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
    } }, 'Export to file'),
    h('h3', { style: 'margin-top:18px' }, 'Import from file'), h('div', { class: 'row' }, file, mode), result));
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

route();
