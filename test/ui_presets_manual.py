"""v1.6 browser test: index gear presets (FO-10 built-in + custom machine, prime hint, save selected
match, hand edit, CSV import, reload) and machine manual PDFs in IndexedDB (attach, reload, open
via blob URL, export with manuals, import restores, delete machine asks about the manual).
Run: python3 test/ui_presets_manual.py [url]   (serve the folder first)"""
import sys, json, os, tempfile
from playwright.sync_api import sync_playwright
import os, sys as _s; _s.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000/'
errors, out = [], {}
def check(c, m):
    if not c: errors.append('FAIL: ' + m)
PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
tmp = tempfile.mkdtemp(); pdf_path = os.path.join(tmp, 'FO10 manual.pdf'); open(pdf_path, 'wb').write(PDF)
IDX = '.card:has(h3:has-text("Index change gears"))'
def fo10(pg, z):
    pg.goto(URL + '#/m/tos-fo10-diff'); pg.wait_for_selector('#in-Z')
    for k, v in {'B': '30', 'D': '8', 'K': '1', 'Z': str(z)}.items(): pg.fill('#in-' + k, v)
    pg.click('button:has-text("Calculate")'); pg.wait_for_selector(IDX)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(accept_downloads=True, viewport={'width': 1300, 'height': 1000}); pg = ctx.new_page(); cgmock.install(pg); pg.set_default_timeout(20000); ctx.set_default_timeout(180000)
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append('console.error: ' + m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.evaluate("new Promise(r => { const q = indexedDB.deleteDatabase('ramgear-change-gear'); q.onsuccess = q.onerror = q.onblocked = () => r(); })")
    pg.goto(URL + '#/'); pg.reload()
    check('v1.8.9' in pg.locator('#app-version').inner_text(), 'version v1.8.9')
    # --- presets on FO-10 (built-in override)
    fo10(pg, 101)
    hint = pg.locator('.prime-hint')
    out['hint'] = hint.inner_text() if hint.count() else None
    check(hint.count() == 1 and 'z = 101 is prime – you need a 101-tooth gear (or a multiple); add a preset.' in hint.inner_text(), 'prime hint for z=101')
    check(pg.locator('#preset-editor h3:has-text("Index gear presets")').count() == 1, 'presets table shown on FO-10')
    pg.click('#preset-add')
    row = pg.locator('#preset-table tbody tr').last
    for k, v in {'z': '101', 'A': '24', 'B': '101', 'note': 'prime - needs 101 gear'}.items(): row.locator('.preset-' + k).fill(v)
    pg.click('#preset-save')
    pg.wait_for_selector(IDX + ' tr.preset-row')
    pr = pg.locator(IDX + ' tr.preset-row').first.locator('td').all_inner_texts()
    out['presetRow101'] = pr
    check(pr[0] == 'Preset' and pr[1] == '24' and pr[2] == '101' and pr[5] == '0.23762376' and pr[6].startswith('0 (exact)'), 'preset 24/101 shown first with ratio and 0 error')
    check(pg.locator('.prime-hint').count() == 0, 'hint gone once preset exists')
    first_table = pg.locator(IDX + ' table').first
    check(first_table.evaluate("t => t.classList.contains('preset-results')"), 'preset table comes before search results')
    # save selected search match (z=40) in one click
    fo10(pg, 40)
    check(pg.locator('.prime-hint').count() == 0, 'no hint for z=40')
    pg.locator(IDX + ' table:not(.preset-results) tbody tr').nth(1).click()
    sel = pg.locator(IDX + ' table:not(.preset-results) tbody tr').nth(1).locator('td').all_inner_texts()
    pg.click('#save-preset')
    pg.wait_for_selector(IDX + ' tr.preset-row')
    pr40 = pg.locator(IDX + ' tr.preset-row').first.locator('td').all_inner_texts()
    out['saved40'] = {'selected': sel, 'preset': pr40}
    check(pr40[1:5] == sel[1:5], 'saved selected match as preset')
    check(pg.locator('#preset-table tbody tr').count() == 2, 'preset table refreshed (2 presets)')
    st = pg.evaluate("window.__rgData()")
    check(len(st['builtinOverrides']['tos-fo10-diff']['indexPresets']) == 2, 'FO-10 presets stored as built-in override')
    # CSV import (add) + delete by hand + reload
    pg.evaluate("window.__rgShowPresetCsv('z,A,B,C,D,note\\n97,24,97,,,prime\\nbad,1,2,,,\\n', 'p.csv')")
    pg.wait_for_selector('#preset-csv-preview')
    check('1 row(s) will be skipped' in pg.locator('#preset-csv-preview').inner_text(), 'bad csv row reported')
    pg.click('#preset-csv-preview button:has-text("Add to presets")')
    check(pg.locator('#preset-table tbody tr').count() == 3, 'csv row added')
    k97 = pg.evaluate("[...document.querySelectorAll('#preset-table tbody input.preset-z')].findIndex(i => i.value === '97')")
    check(k97 >= 0, 'csv preset z=97 in table')
    pg.locator('#preset-table tbody tr').nth(k97).locator('button.x').click()
    check(pg.locator('#preset-table tbody tr').count() == 2, 'preset deleted')
    pg.reload(); pg.wait_for_selector('#preset-table')
    check(pg.locator('#preset-table tbody tr').count() == 2, 'presets kept after reload')
    # --- manual on FO-10
    pg.goto(URL + '#/m/tos-fo10-diff'); pg.wait_for_selector('#manual-attach-another', state='attached')
    pg.set_input_files('#manual-file', pdf_path)
    pg.wait_for_selector('#manual-list .manual-open', state='attached')
    pg.reload(); pg.wait_for_selector('#manual-list .manual-open', state='attached')
    out['manualStatus'] = pg.locator('#manual-panel').text_content()
    check('FO10 manual.pdf' in out['manualStatus'], 'manual kept after reload')
    # Headless Chromium has no PDF viewer: a PDF opened in a tab becomes a download from the blob URL.
    got = {}
    def on_page(np): np.on('download', lambda dl: got.setdefault('dl', dl))
    ctx.on('page', on_page)
    with ctx.expect_page() as np:
        pg.click('#machine-manual'); pg.click('#manual-list .manual-open')
    tab = np.value
    try: tab.wait_for_url('blob:*', timeout=20000)
    except Exception: pass
    for _ in range(60):
        if got.get('dl') or tab.url.startswith('blob:'): break
        pg.wait_for_timeout(500)
    if got.get('dl'):
        dl = got['dl']; out['manualTab'] = 'download from ' + dl.url
        check(dl.url.startswith('blob:'), 'manual opens from a blob URL')
        check(open(dl.path(), 'rb').read() == PDF, 'opened file is the attached PDF')
    else:
        out['manualTab'] = tab.url
        check(tab.url.startswith('blob:'), 'manual opens in new tab from a blob URL')
        body = pg.evaluate("u => fetch(u).then(r => r.text()).catch(e => 'fetch failed: ' + e)", tab.url)
        check(body.startswith('%PDF-1.4'), 'blob is the PDF (' + body[:40] + ')')
    tab.close()
    check(not st.get('manuals') and 'PDF' not in pg.evaluate("JSON.stringify(Object.assign({}, localStorage))"), 'PDF not in localStorage')
    # --- export with manuals, wipe, import restores
    pg.goto(URL + '#/io'); pg.wait_for_selector('#export-json')
    with pg.expect_download() as d: pg.click('#export-json')
    plain = json.load(open(d.value.path()))
    check('manuals' not in plain, 'export without checkbox has no manuals')
    pg.check('#incl-manuals')
    with pg.expect_download() as d: pg.click('#export-json')
    full_path = d.value.path(); full = json.load(open(full_path))
    check(any(k.startswith('tos-fo10-diff/') for k in full.get('manuals', {})), 'export with manuals embeds the PDF')
    check(len(full['builtinOverrides']['tos-fo10-diff']['indexPresets']) == 2, 'presets in JSON export')
    pg.evaluate('localStorage.clear()'); pg.evaluate("new Promise(r => { const q = indexedDB.deleteDatabase('ramgear-change-gear'); q.onsuccess = q.onerror = q.onblocked = () => r(); })")
    pg.reload(); pg.goto(URL + '#/io'); pg.wait_for_selector('#export-json')
    pg.set_input_files('#main input[type=file]', full_path)
    pg.wait_for_selector('#import-now'); pg.click('#import-now'); pg.wait_for_selector('.msg.ok:has-text("Imported")')
    pg.goto(URL + '#/m/tos-fo10-diff'); pg.wait_for_selector('#manual-list .manual-open', state='attached')
    check(pg.locator('#preset-table tbody tr').count() == 2, 'presets restored by import')
    # --- custom machine: index .6 + presets + manual deleted with machine
    pg.goto(URL + '#/new'); pg.wait_for_selector('#machine-name'); pg.fill('#machine-name', 'Preset Hobber')
    pg.click('button:has-text("Save machine")'); pg.wait_for_selector('form.grid-form')
    mid = pg.evaluate("location.hash.split('/')[2]")
    for k, v in {'Z': '40', 'K': '1', 'B': '30', 'D': '8'}.items(): pg.fill('#in-' + k, v)
    pg.click('button:has-text("Calculate")'); pg.wait_for_selector(IDX)
    res = dict(zip(pg.locator('.results-table td:not(.big)').all_inner_texts(), pg.locator('.results-table td.big').all_inner_texts()))
    check(float(res['Index ratio']) == 0.6, 'custom index .6')
    pg.locator('.save-row-preset').first.click(); pg.wait_for_selector(IDX + ' tr.preset-row')
    check(len([m for m in pg.evaluate("window.__rgData()")['machines'] if m['id'] == mid][0]['indexPresets']) == 1, 'custom preset stored on machine')
    pg.set_input_files('#manual-file', pdf_path); pg.wait_for_selector('#manual-list .manual-open', state='attached')
    dialogs = []
    pg.remove_listener('dialog', pg.listeners('dialog')[0]) if hasattr(pg, 'listeners') else None
    pg.on('dialog', lambda dlg: dialogs.append(dlg.message))
    pg.goto(URL + '#/edit/' + mid); pg.wait_for_selector('button:has-text("Delete machine")')
    pg.click('button:has-text("Delete machine")'); pg.wait_for_function("location.hash === '#/'")
    out['deleteDialogs'] = dialogs
    check(any('manual(s) attached' in x for x in dialogs), 'delete asks about the manual')
    left = pg.evaluate(f"new Promise(r => {{ const q = indexedDB.open('ramgear-change-gear'); q.onsuccess = () => {{ const g = q.result.transaction('manuals').objectStore('manuals').getAll(); g.onsuccess = () => r(g.result.some(x => (x.machine || x.id) === '{mid}')); }}; }})")
    check(not left, 'manual deleted with machine')
    # --- IndexedDB unavailable: clear message, calculation still works
    c2 = b.new_context(); c2.add_init_script("Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked'); } })")
    p2 = c2.new_page(); p2.set_default_timeout(180000); cgmock.install(p2, buckets=[])  # v1.8.7: no shared bucket either
    p2.on('pageerror', lambda e: errors.append('pageerror (no IDB): ' + str(e)))
    p2.goto(URL + '#/m/tos-fo10-diff'); p2.wait_for_selector('#manual-status', state='attached'); p2.wait_for_timeout(800)
    out['noIdb'] = p2.locator('#manual-status').text_content()
    check('IndexedDB is not available' in out['noIdb'] and p2.locator('#manual-attach-another').is_disabled(), 'clear message when IndexedDB is unavailable')
    for k, v in {'B': '30', 'D': '8', 'K': '1', 'Z': '40'}.items(): p2.fill('#in-' + k, v)
    p2.click('button:has-text("Calculate")'); p2.wait_for_selector('.results-table td.big')
    check('.6' in p2.locator('.results-table td.big').all_inner_texts(), 'calculation works without IndexedDB')
    b.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
print('\n'.join(errors) if errors else 'ui_presets_manual: ALL PASSED')
sys.exit(1 if errors else 0)
