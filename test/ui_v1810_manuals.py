"""v1.8.10 (fake DB + fake Storage): manual upload for every signed-in user on every My Machines entry, Remove for admin only.
Policy 'current' = live v1.8.7 policies (upload admin-only); 'v1810' = proposed SQL (upload = any viewer, no overwrite)."""
import sys, os, re, tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
tmp = tempfile.mkdtemp(); PDF = os.path.join(tmp, 'zz-test.pdf'); open(PDF, 'wb').write(b'%PDF-1.4\n%%EOF\n' + b'x' * 2000)
MACH = "() => { const o = []; let s = ''; for (const el of document.querySelectorAll('nav h3, nav a')) { if (el.tagName === 'H3') s = el.textContent.toLowerCase(); else if (s === 'my machines' && el.querySelector('.machine-name')) o.push([el.querySelector('.machine-name').textContent, el.getAttribute('href')]); } return o; }"
store = lambda pg: pg.evaluate("Object.keys((JSON.parse(localStorage.getItem('cgmock.db')).__storage || {})['cg-manuals'] || {})")
def run(user, policy, b):
    ctx = b.new_context(viewport={'width': 1300, 'height': 1000}); cgmock.install(ctx, 'gary')
    pg = ctx.new_page(); pg.set_default_timeout(20000); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.wait_for_selector('#user-box')
    # seed an added machine (Lees Bradner) as admin, then switch user
    pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index'); pg.fill('#machine-name', 'Lees Bradner'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    pg.evaluate("(p) => localStorage.setItem('cgmock.manualPolicy', p)", policy)
    ctx2 = b.new_context(viewport={'width': 1300, 'height': 1000}); st = ctx.storage_state(); ctx.close()
    ctx2 = b.new_context(viewport={'width': 1300, 'height': 1000}, storage_state=st); cgmock.install(ctx2, user)
    pg = ctx2.new_page(); pg.set_default_timeout(20000); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.wait_for_selector('#user-box'); names = pg.evaluate(MACH)
    tag = f'[{user}/{policy}]'
    check(len(names) == 4, f'{tag} My Machines has 4 entries {[n for n, _ in names]}')
    for n, href in names:
        pg.goto(URL + href); pg.wait_for_selector('#machine-manual'); pg.click('#machine-manual')
        check(pg.locator('#manual-attach-another').is_visible(), f'{tag} {n}: upload control shown')
        pg.set_input_files('#manual-file', PDF); pg.wait_for_timeout(800)
        mid = href.split('#/m/')[1]; inS = f'{mid}/zz-test.pdf' in store(pg)
        if policy == 'current' and user == 'vic':
            check(not inS and 'Manual problem' in pg.inner_text('#manual-status'), f'{tag} {n}: viewer upload refused by current policy, error shown')
            continue
        check(inS and pg.locator('.manual-row:has-text("zz-test.pdf")').count() == 1, f'{tag} {n}: uploaded and listed')
        check(pg.locator('.manual-remove').count() == (1 if user == 'gary' else 0), f'{tag} {n}: Remove {"shown" if user == "gary" else "hidden"}')
        if user == 'vic':
            pg.set_input_files('#manual-file', PDF); pg.wait_for_timeout(800)
            check('already attached' in pg.inner_text('#manual-status'), f'{tag} {n}: viewer cannot overwrite same name')
        else:
            pg.click('.manual-remove'); pg.wait_for_timeout(800)
            check(f'{mid}/zz-test.pdf' not in store(pg) and pg.locator('.manual-row').count() == 0, f'{tag} {n}: admin removed test file')
    ctx2.close()
with sync_playwright() as p:
    b = p.chromium.launch()
    for u, pol in [('gary', 'current'), ('vic', 'current'), ('vic', 'v1810'), ('gary', 'v1810')]: run(u, pol, b)
    b.close()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('FAILED: ' + '; '.join(fails) if fails else 'ALL V1.8.10 CHECKS PASSED'); sys.exit(1 if fails else 0)
