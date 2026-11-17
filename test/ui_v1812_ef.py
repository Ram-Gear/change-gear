"""v1.8.12 browser test (fake DB, admin): reversing gears E/F in index gear presets.
E/F = one of 56/28 (2:1), 42/42 (1:1), 28/56 (1:2); missing = 42/42. Train = A/B x C/D x E/F.
Checks: editor E/F selector per row (+ Add preset), old preset rows without E/F (shown 42/42, exact, row data untouched),
results table columns A B C D E F, exact / not exact with E/F, Load preset bar E/F + train text, Save as preset and
Save selected match as preset with the E/F selector, CSV import old + new format, CSV export, viewer read-only table.
Screens: /workspace/v1812_editor.png, /workspace/v1812_results.png, /workspace/v1812_saveas.png, /workspace/v1812_presets.png
Run: python3 test/ui_v1812_ef.py [url]"""
import sys, os, json, copy
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
answers = []
IDX = '.card:has(h3:has-text("Index change gears"))'
db = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('cgmock.db'))")
def wait_db(pg, js): pg.wait_for_function("(() => { const d = JSON.parse(localStorage.getItem('cgmock.db')); return " + js + "; })()", timeout=15000)
def rows_for(pg, mid_name):
    d = db(pg); mid = [m for m in d['cg_machines'] if m['name'] == mid_name][0]['id']
    return [r for r in d['cg_presets'] if r['machine_id'] == mid]
def calc(pg, mid, z):
    pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('#in-Z')
    for k, v in {'B': '30', 'D': '8', 'K': '1', 'Z': str(z)}.items():
        if pg.locator('#in-' + k).count(): pg.fill('#in-' + k, v)
    pg.click('button:has-text("Calculate")'); pg.wait_for_selector('.preset-bar')
def bar(pg): return pg.locator(IDX + ' .preset-bar').first
NAME = 'Overton FD-500'
def shot_union(pg, sels, path):
    bs = [pg.locator(x).first.evaluate("e => { const r = e.getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.right + scrollX, r.bottom + scrollY]; }") for x in sels]
    x0, y0 = min(b[0] for b in bs) - 10, min(b[1] for b in bs) - 10; x1, y1 = max(b[2] for b in bs) + 10, max(b[3] for b in bs) + 10
    pg.screenshot(path=path, full_page=True, clip={'x': max(0, x0), 'y': max(0, y0), 'width': x1 - max(0, x0), 'height': y1 - max(0, y0)})
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 1100}, accept_downloads=True)
    cgmock.install(ctx, 'gary'); pg = ctx.new_page(); pg.set_default_timeout(30000)
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept(answers.pop(0)) if d.type == 'prompt' and answers else d.accept())
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_selector('#user-box')
    check('v1.8.12' in pg.inner_text('#app-version'), 'version v1.8.12')
    mid = cgmock.add_fo10(pg, URL, NAME)  # Add-a-machine defaults: index ratio 24 x K / Z (FD-500 manual: a/b x c/d x e/f = 24 k / z)
    calc(pg, mid, 17)
    # --- editor: + Add preset has an E/F selector (default 42/42) with exactly the 3 pairs
    pg.click('#preset-add'); row = pg.locator('#preset-table tbody tr').last
    opts = row.locator('select.preset-EF option').all_inner_texts()
    check(opts == ['56/28 (2:1)', '42/42 (1:1)', '28/56 (1:2)'], f'editor row E/F options {opts}')
    check(row.locator('select.preset-EF').input_value() == '42/42', 'new row E/F defaults to 42/42')
    heads = pg.locator('#preset-table thead th').all_inner_texts()
    check(heads[:7] == ['z', 'A', 'B', 'C', 'D', 'E/F', 'Note'], f'editor columns {heads}')
    for k, v in {'z': '17', 'A': '48', 'B': '80', 'C': '80', 'D': '34', 'note': 'old style (no E/F)'}.items(): row.locator('.preset-' + k).fill(v)
    pg.click('#preset-save'); wait_db(pg, "d.cg_presets.length >= 1")
    r17 = [r for r in rows_for(pg, NAME) if r['inputs']['z'] == 17][0]
    check('E' not in r17['result'] and 'F' not in r17['result'], f'untouched 42/42 row stores no E/F (same as v1.8.11 rows) {r17["result"]}')
    # inject a v1.8.11-style row (z = 37) straight into the fake DB, like Gary's existing presets
    d = db(pg); r37 = copy.deepcopy(r17); r37['id'] = '00000000-0000-4000-8000-0000000fd037'; r37['name'] = 'z=37'; r37['inputs'] = {'z': 37}
    r37['result'] = {'A': 48, 'B': 80, 'C': 80, 'D': 74, 'note': 'v1.8.11 row', 'name': 'FD37 old'}; d['cg_presets'].append(r37)
    pg.evaluate("d => localStorage.setItem('cgmock.db', JSON.stringify(d))", d); pg.reload(); pg.wait_for_selector('#user-box')
    calc(pg, mid, 37); pg.wait_for_selector(IDX + ' tr.preset-row')
    pr = pg.locator(IDX + ' tr.preset-row').first.locator('td').all_inner_texts()
    th = pg.locator(IDX + ' table.preset-results thead th').all_inner_texts()
    check(th[1:7] == ['A', 'B', 'C', 'D', 'E', 'F'], f'results table columns {th}')
    check(pr[1:7] == ['48', '80', '80', '74', '42', '42'] and pr[8].startswith('0 (exact)') and pg.locator(IDX + ' .preset-results .preset-flag').count() == 0, f'old v1.8.11 preset z=37 shows E/F 42/42, exact, no flag {pr}')
    # --- add a 28/56 preset in the editor (FD-500 table IV.7, z = 45: 48/70 x 70/45, e/f 28/56)
    pg.click('#preset-add'); row = pg.locator('#preset-table tbody tr').last
    for k, v in {'z': '45', 'A': '48', 'B': '70', 'C': '70', 'D': '45', 'note': 'manual table IV.7'}.items(): row.locator('.preset-' + k).fill(v)
    row.locator('select.preset-EF').select_option('28/56')
    pg.click('#preset-add'); row = pg.locator('#preset-table tbody tr').last
    for k, v in {'z': '12', 'A': '48', 'B': '80', 'C': '80', 'D': '48', 'note': 'manual z=12'}.items(): row.locator('.preset-' + k).fill(v)
    row.locator('select.preset-EF').select_option('56/28')
    pg.click('#preset-save'); wait_db(pg, "d.cg_presets.some(p => p.inputs.z === 45)")
    rs = {r['inputs']['z']: r for r in rows_for(pg, NAME)}
    check((rs[45]['result'].get('E'), rs[45]['result'].get('F')) == (28, 56) and (rs[12]['result'].get('E'), rs[12]['result'].get('F')) == (56, 28), 'editor saves E/F in cg_presets.result')
    check(rs[37]['result'] == r37['result'], f'saving the editor leaves the old z=37 row unchanged {rs[37]["result"]}')
    check(set(rs[45].keys()) == set(r17.keys()), 'no new columns on cg_presets rows')
    pg.locator('#preset-editor').scroll_into_view_if_needed(); pg.locator('#preset-editor').screenshot(path='/workspace/v1812_editor.png')
    # --- results: z = 45 preset with 28/56 is exact; Load preset bar
    calc(pg, mid, 45)
    pr = pg.locator(IDX + ' tr.preset-row').first.locator('td').all_inner_texts()
    check(pr[1:7] == ['48', '70', '70', '45', '28', '56'] and pr[7] == '0.53333333' and pr[8].startswith('0 (exact)'), f'z=45 preset 48/70 x 70/45 x 28/56 exact {pr}')
    v = [o for o in bar(pg).locator('select.preset-load option').all() if '48/70 × 70/45 × 28/56' in o.inner_text()]
    check(len(v) == 1 and 'not exact' not in v[0].inner_text(), 'Load preset list shows E/F in the train and no flag')
    bar(pg).locator('select.preset-load').select_option(v[0].get_attribute('value'))
    check(bar(pg).locator('select.pg-ef').input_value() == '28/56', 'Load preset sets the E/F selector')
    tt = bar(pg).locator('.preset-train').inner_text()
    check('48/70 × 70/45 × 28/56' in tt and 'Exact' in tt, f'train text with E/F, Exact: {tt}')
    pg.locator(IDX + ' .preset-results').scroll_into_view_if_needed()
    shot_union(pg, [IDX + ' table.preset-results', IDX + ' .preset-bar'], '/workspace/v1812_results.png')
    bar(pg).locator('select.pg-ef').select_option('42/42')
    check(bar(pg).locator('.preset-flag').count() == 1, 'same gears with E/F 42/42 -> Not exact')
    bar(pg).locator('select.pg-ef').select_option('28/56')
    # --- Save as preset from the index results (row button) with E/F 28/56: search match A/B x C/D = 24/45 -> not exact at 1:2
    check(pg.locator(IDX + ' select.save-ef').input_value() == '42/42', 'Save-as E/F selector defaults to 42/42')
    pg.locator(IDX + ' select.save-ef').select_option('42/42')
    first = pg.locator(IDX + ' tbody tr.clickable').first.locator('td').all_inner_texts()
    answers.append('From results 1:1'); pg.locator(IDX + ' tbody tr.clickable').first.locator('.save-row-preset').click()
    wait_db(pg, "d.cg_presets.some(p => p.result && p.result.name === 'From results 1:1')")
    r = [x for x in rows_for(pg, NAME) if x['result'].get('name') == 'From results 1:1'][0]['result']
    check((r['A'], r['B'], r.get('E'), r.get('F')) == (int(first[1]), int(first[2]), 42, 42), f'Save as preset (row) stores the match + E/F 42/42 {r}')
    calc(pg, mid, 45)
    pg.locator(IDX + ' select.save-ef').select_option('56/28')
    pg.locator(IDX + ' tbody tr.clickable').nth(1).click()
    sel = pg.locator(IDX + ' tbody tr.clickable').nth(1).locator('td').all_inner_texts()
    pg.locator(IDX + ' .save-preset-row').scroll_into_view_if_needed()
    pg.locator(IDX + ' tbody tr.clickable').nth(1).scroll_into_view_if_needed()
    shot_union(pg, [IDX + ' .save-ef-row', IDX + ' tbody tr.clickable >> nth=4'], '/workspace/v1812_saveas.png')
    answers.append('Selected 2:1'); pg.click(IDX + ' #save-preset')
    wait_db(pg, "d.cg_presets.some(p => p.result && p.result.name === 'Selected 2:1')")
    r = [x for x in rows_for(pg, NAME) if x['result'].get('name') == 'Selected 2:1'][0]['result']
    check((r['A'], r['B'], r.get('E'), r.get('F')) == (int(sel[1]), int(sel[2]), 56, 28), f'Save selected match as preset stores E/F 56/28 {r}')
    calc(pg, mid, 45)
    rows = pg.locator(IDX + ' tr.preset-row').all()
    flagged = [x.locator('td').all_inner_texts() for x in rows if x.locator('.preset-flag').count()]
    check(len(flagged) == 1 and flagged[0][5:7] == ['56', '28'], f'the 56/28 copy of a 1:1 match is flagged Not exact {flagged}')
    # bar: clicking a result keeps the bar's E/F
    bar(pg).locator('select.pg-ef').select_option('42/42'); pg.locator(IDX + ' tbody tr.clickable').nth(0).click()
    check(bar(pg).locator('select.pg-ef').input_value() == '42/42' and 'Exact' in bar(pg).locator('.preset-train').inner_text(), 'clicking a search match fills A-D, keeps E/F, exact at 1:1')
    # --- CSV import: old and new format
    pg.evaluate("window.__rgShowPresetCsv('z,A,B,C,D,note,name\\r\\n20,48,80,80,40,old csv,Old20\\r\\n', 'old.csv')")
    check('1 good row' in pg.inner_text('#preset-csv-preview'), 'old CSV format accepted')
    pg.click('#preset-csv-preview button:has-text("Add to presets")'); wait_db(pg, "d.cg_presets.some(p => p.inputs.z === 20)")
    r20 = [x for x in rows_for(pg, NAME) if x['inputs']['z'] == 20][0]['result']
    check('E' not in r20, f'old CSV row -> no E/F stored (= 42/42) {r20}')
    pg.evaluate("window.__rgShowPresetCsv('z,A,B,C,D,E,F,note,name\\r\\n50,48,70,70,50,28,56,new csv,New50\\r\\n51,48,70,70,51,21,63,bad,Bad\\r\\n', 'new.csv')")
    pv = pg.inner_text('#preset-csv-preview')
    check('1 good row' in pv and 'E/F must be' in pv, 'new CSV format accepted, bad E/F pair skipped')
    pg.click('#preset-csv-preview button:has-text("Add to presets")'); wait_db(pg, "d.cg_presets.some(p => p.inputs.z === 50)")
    r50 = [x for x in rows_for(pg, NAME) if x['inputs']['z'] == 50][0]['result']
    check((r50.get('E'), r50.get('F')) == (28, 56), 'new CSV row stores E/F 28/56')
    with pg.expect_download() as dl: pg.locator('#preset-editor button:has-text("Export CSV")').click()
    txt = open(dl.value.path(), encoding='utf-8').read().splitlines()
    check(txt[0] == 'z,A,B,C,D,E,F,note,name' and any(l.startswith('45,48,70,70,45,28,56,') for l in txt) and any(l.startswith('37,48,80,80,74,42,42,') for l in txt), f'Export CSV has E,F columns {txt[:3]}')
    pg.locator('#preset-editor').scroll_into_view_if_needed(); pg.screenshot(path='/workspace/v1812_presets.png', full_page=True)
    shared = db(pg)
    # --- viewer: read-only table has E and F columns
    vctx = b.new_context(viewport={'width': 1300, 'height': 1100})
    vctx.add_init_script("if (!sessionStorage.getItem('s')) { localStorage.setItem('cgmock.db', " + json.dumps(json.dumps(shared)) + "); sessionStorage.setItem('s','1'); }")
    cgmock.install(vctx, 'vic'); pv_ = vctx.new_page(); pv_.on('pageerror', lambda e: errors.append(str(e)))
    calc(pv_, mid, 45)
    th = pv_.locator('#preset-table thead th').all_inner_texts()
    check(th[:7] == ['z', 'A', 'B', 'C', 'D', 'E', 'F'] and pv_.locator('select.preset-EF').count() == 0 and pv_.locator(IDX + ' select.save-ef').count() == 0, f'viewer: read-only E/F columns, no selectors to save {th}')
    check(not errors, f'no page/console errors {errors}')
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL V1.8.12 E/F CHECKS PASSED'); sys.exit(1 if fails else 0)
