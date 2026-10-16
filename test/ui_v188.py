"""v1.8.8 (fake DB + fake Storage): no menu numbers, one identical dot per machine, Machine Manual panel with
several manuals (list, Open, Remove w/ confirm, 'Attach another manual' inside the panel only; no standalone attach,
no lower Manual row), legacy single-manual migration, delete machine deletes all manuals."""
import sys, os, json, re, tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n' + b'x' * 3000
tmp = tempfile.mkdtemp(); p1 = os.path.join(tmp, 'Book A.pdf'); open(p1, 'wb').write(PDF); p2 = os.path.join(tmp, 'Book B.pdf'); open(p2, 'wb').write(PDF + b'y' * 2000)
store = lambda pg: pg.evaluate("(JSON.parse(localStorage.getItem('cgmock.db')).__storage || {})['cg-manuals'] || {}")
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 1000}); cgmock.install(ctx, 'gary')
    pg = ctx.new_page(); pg.set_default_timeout(30000); pg.on('pageerror', lambda e: errors.append(str(e)))
    confirms = []
    def dlg(d): confirms.append(d.message); d.accept()
    pg.on('dialog', dlg)
    pg.goto(URL); pg.wait_for_selector('#user-box')
    pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index'); pg.fill('#machine-name', '7 Lees-Bradner ZZ'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    mid = pg.url.split('#/m/')[1]
    items = pg.evaluate("""() => { const o = []; let sec = ''; for (const el of document.querySelectorAll('nav h3, nav a')) { if (el.tagName === 'H3') sec = el.textContent.toLowerCase(); else if (sec === 'my machines' && el.querySelector('.machine-name')) o.push([el.textContent, [...el.querySelectorAll('.mdot')].map(d => d.textContent + getComputedStyle(d).color + getComputedStyle(d).width).join('|')]); } return o; }""")
    check(len(items) >= 4 and all(not re.match(r'^\W*\d', t) for t, _ in items), f'no digits in front of names {[t for t, _ in items]}')
    check(len({d for _, d in items}) == 1 and all('|' not in d and d.startswith('•') for _, d in items), 'exactly one identical dot on every machine')
    check(not re.search(r'\(\d\)', pg.inner_text('main h2')) and 'Lees-Bradner ZZ' in pg.inner_text('main h2'), 'page title without number')
    pg.goto(URL + '#/m/fd500-diff'); pg.wait_for_selector('#machine-manual'); check(not re.search(r'\(\d\)', pg.inner_text('main h2')), 'built-in title without (3)')
    pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('#machine-manual')
    check(pg.locator('#manual-attach').count() == 0 and pg.locator('#manual-bar').count() == 0 and pg.locator('#manual-panel').is_hidden(), 'no standalone attach, no lower Manual row, panel closed')
    pg.click('#machine-manual'); check(pg.locator('#manual-panel').is_visible() and pg.locator('#manual-attach-another').is_visible(), 'panel opens with upload control')
    with pg.expect_file_chooser() as fc: pg.click('#manual-attach-another')
    fc.value.set_files([p1, p2]); pg.wait_for_function("document.querySelectorAll('#manual-list .manual-row').length === 2")
    rows = pg.locator('#manual-list .manual-row').all_inner_texts()
    check('Book A.pdf' in rows[0] and 'KB' in rows[0] and 'Book B.pdf' in rows[1], f'both listed with size {rows}')
    check(f'{mid}/Book A.pdf' in store(pg) and f'{mid}/Book B.pdf' in store(pg), 'both in cg-manuals/<id>/')
    check(pg.inner_text('#machine-manual') == 'Machine Manual (2)', 'button shows count')
    for i in range(2):
        with ctx.expect_page() as np: pg.locator('#manual-list .manual-open').nth(i).click()
        check(np.value is not None, f'Open manual {i+1}')
    pg.locator('#manual-list .manual-remove').first.click(); pg.wait_for_function("document.querySelectorAll('#manual-list .manual-row').length === 1")
    check(any('Remove the manual "Book A.pdf"' in c for c in confirms) and f'{mid}/Book A.pdf' not in store(pg), 'Remove asks and removes one')
    # legacy v1.8.7 IndexedDB record (key = machine id) shows and migrates
    pg.evaluate("""(mid) => new Promise((res) => { const r = indexedDB.open('ramgear-change-gear', 1); r.onsuccess = () => { const t = r.result.transaction('manuals', 'readwrite'); t.objectStore('manuals').put({ id: mid, name: 'Old.pdf', type: 'application/pdf', size: 5, added: '', blob: new Blob(['%PDF-'], { type: 'application/pdf' }) }); t.oncomplete = res; }; })""", mid)
    pg.reload(); pg.wait_for_selector('#machine-manual'); pg.click('#machine-manual'); pg.wait_for_selector('.manual-migrate')
    pg.click('.manual-migrate'); pg.wait_for_function("document.querySelectorAll('#manual-list .manual-row').length === 2 && !document.querySelector('.manual-migrate')")
    check(f'{mid}/Old.pdf' in store(pg), 'legacy single manual migrated to shared folder')
    pg.click('#head-toggle') if pg.locator('#head-body').is_hidden() else None
    pg.click('#delete-machine'); pg.wait_for_url('**/#/')
    pg.wait_for_function("!Object.keys((JSON.parse(localStorage.getItem('cgmock.db')).__storage || {})['cg-manuals'] || {}).some(k => k.startsWith(%s))" % json.dumps(mid + '/'))
    check(any('2 manual(s)' in c for c in confirms), 'delete machine offers to delete all manuals')
    check(not errors, 'no page errors ' + '; '.join(errors[:3])); b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL V1.8.8 CHECKS PASSED'); sys.exit(1 if fails else 0)
