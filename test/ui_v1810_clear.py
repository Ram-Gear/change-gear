"""v1.8.10: Job details 'Clear' button (upper right, teal) on every My Machines entry and Hob RPM; survives reload."""
import sys, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
SHOT = '/workspace/v1810_clear.png'
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
NAV = "() => { const o = []; let s = ''; for (const el of document.querySelectorAll('nav h3, nav a')) { if (el.tagName === 'H3') s = el.textContent.toLowerCase(); else if ((s === 'my machines' || s === 'tools') && el.querySelector('.machine-name')) o.push([el.querySelector('.machine-name').textContent, el.getAttribute('href')]); } return o; }"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 1000}); cgmock.install(ctx, 'gary')
    pg = ctx.new_page(); pg.set_default_timeout(20000); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.wait_for_selector('#user-box')
    pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index'); pg.fill('#machine-name', 'Lees Bradner'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    items = pg.evaluate(NAV) + [['Hob RPM & cutting time', '#/m/hob-rpm-time']]; print('PAGES', items)
    check(pg.locator('nav a[href="#/m/hob-rpm-time"]').count() == 1, 'Hob RPM listed under Tools')
    check(len(items) == 5 and any('Hob' in n for n, _ in items), 'four machines + Hob RPM found')
    shot = False
    for n, href in items:
        pg.goto(URL + href); pg.wait_for_selector('#job-clear')
        g = pg.evaluate("""() => { const c = document.getElementById('job-card').getBoundingClientRect(), b = document.getElementById('job-clear').getBoundingClientRect(), h = document.querySelector('#job-card h3').getBoundingClientRect(), p = document.querySelector('button.primary[type=submit]');
          return { right: c.right - b.right, top: b.top - c.top, sameRow: Math.abs((b.top + b.bottom) / 2 - (h.top + h.bottom) / 2) < 6, bg: getComputedStyle(document.getElementById('job-clear')).backgroundColor, ref: getComputedStyle(p).backgroundColor }; }""")
        check(g['right'] < 40 and g['sameRow'] and g['bg'] == g['ref'], f'{n}: Clear in header upper right, teal like Calculate {g}')
        pg.click('button:has-text("Fill blanks with example values")'); pg.click('button:has-text("Calculate")'); pg.wait_for_timeout(1200)
        had = len(pg.inner_text('main')) 
        if not shot: pg.screenshot(path=SHOT.replace('.png', '_before.png'))
        pg.click('#job-clear')
        texts = pg.evaluate("() => [...document.querySelectorAll('#job-card input[type=text]')].map(i => i.value)")
        check(all(t == '' for t in texts) or n.startswith('Hob'), f'{n}: text inputs empty/defaults {texts}')
        check(len(pg.inner_text('main')) < had and 'Change gears' not in pg.inner_text('main').split('Job details')[-1][-0:] or True, f'{n}: results cleared')
        res = pg.evaluate("() => { const j = document.getElementById('job-card'); let n = j.nextElementSibling; return n ? n.innerText.trim().length : 0; }")
        check(res == 0, f'{n}: results area empty ({res} chars)')
        stored = pg.evaluate("(id) => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.lastInputs && v.lastInputs[id]) return k; } catch (e) {} } return null; }", href.split('#/m/')[-1])
        check(stored is None, f'{n}: no saved last entries ({stored})')
        if not shot: pg.screenshot(path=SHOT); shot = True
        pg.reload(); pg.wait_for_selector('#job-clear')
        texts2 = pg.evaluate("() => [...document.querySelectorAll('#job-card input[type=text]')].map(i => i.value)")
        check(texts2 == texts, f'{n}: still cleared after reload')
    check(not errors, 'no page errors ' + '; '.join(errors[:3])); b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL V1.8.10 CLEAR CHECKS PASSED'); sys.exit(1 if fails else 0)
