"""v1.8.7 (fake DB + fake Storage): Machine Manual button beside Delete machine, no 'null' text, manuals in the shared
Storage bucket cg-manuals (view = viewer/admin, upload/remove = admin) with IndexedDB fallback + migration,
delete machine offers to delete the manual, one 'My Machines' menu (bold names, Tools section), foldable machine
header (folded by default, remembered, keyboard), job details card style."""
import sys, os, json, tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n' + b'x' * 3000
tmp = tempfile.mkdtemp(); pdf = os.path.join(tmp, 'FO10 manual.pdf'); open(pdf, 'wb').write(PDF)
pdf2 = os.path.join(tmp, 'Hobber book.pdf'); open(pdf2, 'wb').write(PDF)
def page(b, user, db=None, unfold=True):
    ctx = b.new_context(viewport={'width': 1300, 'height': 1000})
    if db: ctx.add_init_script("if (!sessionStorage.getItem('cgSeeded')) { localStorage.setItem('cgmock.db', " + json.dumps(json.dumps(db)) + "); sessionStorage.setItem('cgSeeded', '1'); }")
    cgmock.install(ctx, user, unfold=unfold); pg = ctx.new_page(); pg.set_default_timeout(30000)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    def acc(d):
        try: d.accept()
        except Exception: pass
    pg.on('dialog', acc); return ctx, pg
store = lambda pg: pg.evaluate("(JSON.parse(localStorage.getItem('cgmock.db')).__storage || {})['cg-manuals'] || {}")
def no_null(pg, where): check('null' not in pg.inner_text('#manual-bar') and 'null' not in pg.inner_text('main'), f'{where}: no "null" text')
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = page(b, 'gary'); pg.goto(URL); pg.wait_for_selector('#user-box')
    # --- menu
    nav = pg.locator('nav')
    heads = nav.locator('h3').all_inner_texts()
    check('My Machines' in [x.title() if x.isupper() else x for x in heads] or any(x.lower() == 'my machines' for x in heads), f'one My Machines section {heads}')
    check(not any(x.lower() == 'original program' for x in heads) and sum(1 for x in heads if x.lower() == 'my machines') == 1, 'no separate Original program section')
    check('None yet' not in nav.inner_text(), 'no "None yet" (built-ins always listed)')
    pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index'); pg.fill('#machine-name', 'Lees-Bradner Test'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    mid = pg.url.split('#/m/')[1]
    names = pg.evaluate("""() => { const out = []; let sec = ''; for (const el of document.querySelectorAll('nav h3, nav a')) { if (el.tagName === 'H3') sec = el.textContent.toLowerCase(); else out.push([sec, el.textContent, getComputedStyle(el.querySelector('.machine-name') || el).fontWeight, el.className, getComputedStyle(el).backgroundColor]); } return out; }""")
    mm = [n for n in names if n[0] == 'my machines' and ('FD-500' in n[1] or 'Fauter' in n[1] or 'FO-10' in n[1] or 'Lees-Bradner Test' in n[1])]
    check(len(mm) == 4, f'built-ins and the added machine listed together ({len(mm)})')
    check(all(int(n[2]) >= 600 for n in mm), 'every machine name bold ' + str([n[2] for n in mm]))
    check(any(n[0] == 'tools' and 'Hob RPM' in n[1] for n in names), 'Hob RPM under Tools')
    act = [n for n in mm if 'active' in n[3]]; other = [n for n in mm if 'active' not in n[3]]
    check(len(act) == 1 and act[0][4] != other[0][4], f'current page has its own background ({act[0][4] if act else None})')
    # --- Machine Manual button beside Delete machine, no null
    ids = pg.locator('#head-body .row').first.evaluate("r => [...r.querySelectorAll('button')].map(b => b.id || b.textContent)")
    k = ids.index('delete-machine') if 'delete-machine' in ids else -1
    check(k >= 0 and ids[k + 1] == 'machine-manual', f'Machine Manual right after Delete machine {ids}')
    check(pg.inner_text('#machine-manual') == 'Machine Manual', 'button text "Machine Manual"')
    # job card style (the v1.8.7 single-manual checks are superseded by test/ui_v188.py: manuals panel, several PDFs)
    st = pg.evaluate("() => { const s = getComputedStyle(document.querySelector('#job-card')); return [s.borderTopWidth, s.borderTopStyle, s.borderTopColor, s.borderTopLeftRadius]; }")
    check(st == ['5px', 'solid', 'rgb(46, 115, 134)', '6px'], f'job details card border-top/radius {st}')
    ctx.close()
    # --- folded header: default folded, keyboard, remembered
    fctx, pf = page(b, 'gary', unfold=False); pf.goto(URL + '#/m/tos-fo10-diff'); pf.wait_for_selector('#head-toggle')
    check(pf.locator('#head-body').is_hidden() and pf.get_attribute('#head-toggle', 'aria-expanded') == 'false' and '▸' in pf.inner_text('#head-toggle'), 'machine menu folded by default (chevron ▸)')
    check(pf.locator('#job-card').is_visible(), 'job details still visible when folded')
    pf.focus('#head-toggle'); pf.keyboard.press('Enter')
    check(pf.locator('#head-body').is_visible() and pf.get_attribute('#head-toggle', 'aria-expanded') == 'true' and '▾' in pf.inner_text('#head-toggle'), 'Enter unfolds (chevron ▾)')
    pf.reload(); pf.wait_for_selector('#head-toggle')
    check(pf.locator('#head-body').is_visible(), 'unfolded state remembered after reload')
    pf.screenshot(path='/workspace/v187_machine_page.png')
    pf.focus('#head-toggle'); pf.keyboard.press('Space'); pf.goto(URL + '#/m/fauter-diff'); pf.wait_for_selector('#head-toggle')
    check(pf.locator('#head-body').is_hidden(), 'Space folds; folded state remembered on other machines')
    pf.screenshot(path='/workspace/v187_machine_page_folded.png')
    J = "() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const o = []; let n; while ((n = w.nextNode())) if (/^\\s*null\\s*$|nullnull/.test(n.textContent)) o.push(n.parentElement.id || n.parentElement.tagName); return o; }"
    bad = []
    for r in ['#/', '#/m/tos-fo10-diff', '#/m/fauter-diff', '#/m/fd500-diff', '#/m/hob-rpm-time', '#/io', '#/inventories', '#/help', '#/new']:
        pf.goto(URL + r); pf.wait_for_timeout(500); o = pf.evaluate(J); bad += [(r, o)] if o else []
    check(not bad, f'no stray "null" text on any page {bad}')
    check(not errors, 'no page errors ' + '; '.join(errors[:3]))
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL V1.8.7 CHECKS PASSED')
sys.exit(1 if fails else 0)
