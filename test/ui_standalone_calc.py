"""Browser test: open ramgear-standalone.html via file:// and click Calculate on every built-in
routine (and a custom machine); assert a ratio shows. Also asserts a blank form gives a visible,
in-view error with the bad fields marked. Run: python3 test/ui_standalone_calc.py [path-or-url]"""
import sys, os
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
URL = sys.argv[1] if len(sys.argv) > 1 else 'file://' + os.path.join(here, '..', 'ramgear-standalone.html')
EX = {
  'fd500-diff': {'B': '30', 'D': '8', 'K': '1'}, 'fauter-diff': {'B': '22.5', 'D': '3', 'K': '1', 'Q': '1'},
  'tos-fo10-diff': {'B': '30', 'D': '8', 'K': '1', 'Q': '1'},
  'hob-rpm-time': {'DA': '3', 'HELIX': '20', 'SF': '100', 'NT': '40', 'SN': '1', 'FEED': '.08', 'LC': '2', 'NC': '1', 'NP': '10', 'SETUP': '60'},
}
fails, errors = [], []
def ratio_shown(pg):
    pg.wait_for_selector('.results-table td.big', timeout=10000)
    vals = [v.strip() for v in pg.locator('.results-table td.big').all_inner_texts()]
    return vals if vals and all(vals) else None
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 657})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    for mid, vals in EX.items():
        pg.goto(URL + '#/m/' + mid); pg.reload(); pg.wait_for_selector('form.grid-form')
        # blank form: visible error in view, fields flagged
        for k in vals:
            el = pg.locator('#in-' + k)
            if el.evaluate('e => e.tagName') == 'INPUT': el.fill('')
        pg.click('button:has-text("Calculate")'); pg.wait_for_selector('.msg.err'); pg.wait_for_timeout(700)
        box = pg.locator('.msg.err').bounding_box()
        if not (box and box['y'] < 657 and box['y'] + 20 > 0): fails.append(f'{mid}: error not in view {box}')
        if pg.locator('input.invalid').count() == 0: fails.append(f'{mid}: no field marked invalid')
        for k, v in vals.items():
            el = pg.locator('#in-' + k)
            if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(v)
            else: el.fill(v)
        pg.click('button:has-text("Calculate")')
        r = ratio_shown(pg); print(mid, r)
        if not r: fails.append(f'{mid}: no ratio')
        # example-fill button also gives a ratio
        pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('form.grid-form')
        for k in vals:
            el = pg.locator('#in-' + k)
            if el.evaluate('e => e.tagName') == 'INPUT': el.fill('')
        pg.click('button:has-text("Fill blanks")'); pg.click('button:has-text("Calculate")')
        if not ratio_shown(pg): fails.append(f'{mid}: no ratio after Fill blanks')
    pg.goto(URL + '#/new'); pg.wait_for_selector('.msg.ok')
    pg.click('button:has-text("Save machine")'); pg.wait_for_selector('form.grid-form')
    for k, v in {'HELIX': '20', 'MN': '3', 'STARTS': '1'}.items(): pg.fill('#in-' + k, v)
    pg.click('button:has-text("Calculate")'); r = ratio_shown(pg); print('custom', r)
    if not r: fails.append('custom: no ratio')
    v = pg.locator('#app-version').inner_text(); print('version', v)
    if 'RAM-GEAR web v' not in v: fails.append('no version stamp')
    # browser blocks saved data (Edge/Chrome site-data settings): Calculate must still give a ratio
    ctx = b.new_context(viewport={'width': 1366, 'height': 657})
    ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Access is denied for this document.','SecurityError')}})")
    pg2 = ctx.new_page()
    for mid, vals in EX.items():
        pg2.goto(URL + '#/m/' + mid); pg2.wait_for_selector('form.grid-form')
        for k, val in vals.items():
            el = pg2.locator('#in-' + k)
            if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(val)
            else: el.fill(val)
        pg2.press('#in-' + [k for k in vals if k != 'Q'][-1], 'Enter')
        if not ratio_shown(pg2): fails.append(f'{mid}: no ratio with storage blocked')
    if not pg2.locator('#storage-banner').count(): fails.append('no storage warning banner')
    b.close()
if errors: fails.append('JS errors: ' + '; '.join(errors))
print('FAILED:\n ' + '\n '.join(fails) if fails else 'ALL PASSED')
sys.exit(1 if fails else 0)
