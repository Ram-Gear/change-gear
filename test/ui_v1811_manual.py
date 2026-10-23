"""v1.8.11 manuals: admin-only upload (Attach shown to admins only, viewers see list/Open + note), 50 MB pre-check
(no upload attempted), server 413 mapped to the same message. Screenshot /workspace/v1811_manual.png."""
import sys, os, base64
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
PDF = {'name': 'zz-test.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4\n%test\n%%EOF\n'}
BIG = '/tmp/bigpdf/TOS FO-10.pdf'
os.makedirs('/tmp/bigpdf', exist_ok=True)
if not os.path.exists(BIG) or os.path.getsize(BIG) != int(69.0 * 1048576): open(BIG, 'wb').write(b'%PDF-1.4\n' + b'0' * (int(69.0 * 1048576) - 9))
OK413 = {'name': 'big-server.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4\n%x\n'}
store = lambda pg: pg.evaluate("() => Object.keys((JSON.parse(localStorage.getItem('cgmock.db') || '{}').storage || {})['cg-manuals'] || {})")
MSG = 'and the shared storage limit is 50 MB per file. Compress the PDF or split it, then try again.'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1300, 'height': 1000}); cgmock.install(ctx, 'gary')
    pg = ctx.new_page(); pg.set_default_timeout(20000); pg.on('dialog', lambda d: d.accept())
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    uploads = []; pg.on('console', lambda m: None)
    pg.goto(URL); pg.wait_for_selector('#user-box'); FO = cgmock.add_fo10(pg, URL)  # v1.8.11: Gary's own FO-10 (built-in removed)
    pg.goto(URL + '#/m/' + FO); pg.wait_for_selector('#machine-manual'); pg.click('#machine-manual')
    check(pg.locator('#manual-attach-another').is_visible() and pg.locator('#manual-admin-only').count() == 0, 'admin: Attach shown, no admin-only note')
    pg.set_input_files('#manual-file', PDF); pg.wait_for_timeout(800)
    check(pg.locator('.manual-row:has-text("zz-test.pdf")').count() == 1 and pg.locator('.manual-remove').count() == 1, 'admin: uploaded, listed, Remove shown')
    pg.set_input_files('#manual-file', PDF); pg.wait_for_timeout(800)
    check(pg.locator('.manual-row').count() == 1 and 'Manual problem' not in pg.inner_text('#manual-status'), 'admin: same-name replace (upsert) ok')
    before = store(pg)
    pg.set_input_files('#manual-file', BIG); pg.wait_for_timeout(1500)
    st = pg.inner_text('#manual-status'); print('BIG MSG:', st)
    check(st.startswith('TOS FO-10.pdf is 69.0 MB, ') and MSG in st, 'oversize: clear message before upload')
    check(store(pg) == before, 'oversize: nothing uploaded')
    pg.screenshot(path='/workspace/v1811_manual.png')
    pg.evaluate("localStorage.setItem('cgmock.force413', '1')")
    pg.set_input_files('#manual-file', OK413); pg.wait_for_timeout(1000)
    st = pg.inner_text('#manual-status'); print('413 MSG:', st)
    check('big-server.pdf is ' in st and MSG in st, 'server 413 mapped to the same message')
    pg.evaluate("localStorage.removeItem('cgmock.force413')")
    state = ctx.storage_state()
    # viewer
    ctx2 = b.new_context(viewport={'width': 1300, 'height': 1000}, storage_state=state); cgmock.install(ctx2, 'vic')
    pv = ctx2.new_page(); pv.on('pageerror', lambda e: errors.append(str(e)))
    pv.goto(URL + '#/m/' + FO); pv.wait_for_selector('#machine-manual'); pv.click('#machine-manual'); pv.wait_for_timeout(600)
    check(pv.locator('#manual-attach-another').count() == 0 and pv.locator('.manual-migrate').count() == 0, 'viewer: no Attach / Upload to shared storage')
    check(pv.locator('#manual-admin-only').inner_text() == 'Only an admin can add manuals.', 'viewer: admin-only note')
    check(pv.locator('.manual-row .manual-open').count() == 1 and pv.locator('.manual-remove').count() == 0, 'viewer: list + Open, no Remove')
    pg.bring_to_front(); pg.reload(); pg.wait_for_selector('#machine-manual'); pg.click('#machine-manual'); pg.wait_for_selector('.manual-remove')
    pg.click('.manual-remove'); pg.wait_for_timeout(800); check(pg.locator('.manual-row').count() == 0, 'admin removed test file')
    check(not errors, f'no page/console errors {errors}')
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL V1.8.11 MANUAL CHECKS PASSED'); sys.exit(1 if fails else 0)
