"""v1.8.11: built-in FD-500 Overton, Fauter and TOS FO-10 removed (Gary keeps his own added ones). Admin on the fake DB: custom machines
(incl. one named like a built-in) still listed and calculate, added FO-10 + Hob RPM work, old links give a note."""
import sys, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 1000}); cgmock.install(ctx, 'gary')
    pg = ctx.new_page(); pg.set_default_timeout(20000); pg.on('dialog', lambda d: d.accept())
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_selector('#user-box')
    for name in ['Lees Bradner', 'Overton FD-500', 'TOS FO-10']:
        pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index'); pg.fill('#machine-name', name); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    nav = pg.inner_text('nav')
    check('Fauter' not in nav and 'FD-500 Overton' not in nav and pg.locator('nav a[href="#/m/tos-fo10-diff"]').count() == 0, 'built-in FD-500 Overton / Fauter / TOS FO-10 gone from menu')
    check(nav.count('TOS FO-10') == 1, 'only the added TOS FO-10 listed')
    check(all(n in nav for n in ['TOS FO-10', 'Lees Bradner', 'Overton FD-500', 'Hob RPM']), 'customs (Lees Bradner, Overton FD-500, TOS FO-10), Hob RPM listed')
    pg.goto(URL + '#/'); home = pg.evaluate("() => [...document.querySelectorAll('main table a')].map(a => a.textContent)"); print('HOME', home); check(home == ['Hob RPM & cutting time'], 'home table: only Hob RPM left of the originals')
    for mid in ['fauter-diff', 'fd500-diff', 'tos-fo10-diff']:
        pg.goto(URL + '#/m/' + mid); pg.wait_for_timeout(500); check('removed from this app' in pg.inner_text('main'), f'old link #/m/{mid} shows removed note')
    href = pg.evaluate("() => [...document.querySelectorAll('nav a')].find(a => a.textContent.includes('Lees Bradner')).getAttribute('href')")
    pg.goto(URL + href); pg.wait_for_selector('form.grid-form')
    pg.click('button:has-text("Fill blanks with example values")'); pg.fill('#in-Z', '47'); pg.click('button:has-text("Calculate")'); pg.wait_for_timeout(2000)
    t = pg.inner_text('main'); check('A/B' in t or 'Index' in t, 'Lees Bradner calculates'); print('LEES', ' | '.join(l for l in t.splitlines() if 'ratio' in l.lower())[:400])
    href = pg.evaluate("() => [...document.querySelectorAll('nav a')].find(a => a.textContent.includes('TOS FO-10')).getAttribute('href')")
    pg.goto(URL + href); pg.wait_for_selector('form.grid-form'); pg.click('button:has-text("Fill blanks with example values")'); pg.click('button:has-text("Calculate")'); pg.wait_for_timeout(2000)
    check('ratio' in pg.inner_text('main').lower(), 'added TOS FO-10 calculates')
    pg.goto(URL + '#/m/hob-rpm-time'); pg.wait_for_selector('form.grid-form'); pg.click('button:has-text("Fill blanks with example values")'); pg.click('button:has-text("Calculate")'); pg.wait_for_timeout(1500)
    t = pg.inner_text('main'); check('RPM' in t, 'Hob RPM calculates'); print('HOB', ' | '.join(l for l in t.splitlines() if 'RPM' in l)[:300])
    check('v1.8.13' in pg.inner_text('#app-version'), 'version v1.8.13 (v1.8.11 menu checks)')
    pg.goto(URL + '#/'); pg.wait_for_timeout(500); pg.screenshot(path='/workspace/v1811_menu.png')
    check(not errors, f'no console/page errors {errors}')
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL V1.8.11 CHECKS PASSED'); sys.exit(1 if fails else 0)
