"""Headless browser smoke test of the web app (optional; needs Python playwright).
Start the server first:  python3 -m http.server 8000   (in the app folder)
Run:                     python3 test/ui_smoke.py [http://127.0.0.1:8000/] [screenshot-dir]"""
import sys, json
from playwright.sync_api import sync_playwright
import os, sys as _s; _s.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000/'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
errors = []
EX = {
  'fd500-diff': {'B': '30', 'D': '8', 'K': '1'}, 'fauter-diff': {'B': '22.5', 'D': '3', 'K': '1', 'Q': '1'},
  'tos-fo10-diff': {'B': '30', 'D': '8', 'K': '1', 'Z': '40'},
  'hob-rpm-time': {'DA': '3', 'HELIX': '20', 'SF': '100', 'NT': '40', 'SN': '1', 'FEED': '.08', 'LC': '2', 'NC': '1', 'NP': '10', 'SETUP': '60'},
}
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1300, 'height': 1000}); cgmock.install(pg)
    pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.goto(URL); pg.wait_for_selector('nav a')
    nav = pg.locator('nav').inner_text()
    for gone in ['Barber', 'OFA-71A', 'FD-320']:
        if gone in nav: errors.append('removed routine still in menu: ' + gone)
    results = {}
    for mid, vals in EX.items():
        pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('form.grid-form')
        for k, v in vals.items():
            el = pg.locator('#in-' + k)
            if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(v)
            else: el.fill(v)
        pg.click('button:has-text("Calculate")')
        pg.wait_for_selector('.results-table')
        r = {'outputs': pg.locator('.results-table td.big').all_inner_texts()}
        if pg.locator('button:has-text("Find change gears")').count():
            pg.click('button:has-text("Find change gears")')
            pg.wait_for_function("() => document.querySelectorAll('tbody tr').length > 0", timeout=60000)
            r['firstMatch'] = pg.locator('tbody tr').first.inner_text().replace('\t', ' ')
        results[mid] = r
        if SHOTS: pg.screenshot(path=f'{SHOTS}/{mid}.png', full_page=True)
    # custom machine: new -> save -> run
    pg.goto(URL + '#/new'); pg.wait_for_selector('button:has-text("Save machine")')
    pg.wait_for_selector('.msg.ok')
    if SHOTS: pg.screenshot(path=f'{SHOTS}/editor.png', full_page=True)
    pg.click('button:has-text("Save machine")'); pg.wait_for_selector('form.grid-form')
    for k, v in {'Z': '40', 'K': '1', 'B': '20', 'D': '3'}.items(): pg.fill('#in-' + k, v)
    pg.click('button:has-text("Calculate")'); pg.wait_for_selector('tbody tr')
    results['custom'] = {'outputs': pg.locator('.results-table td.big').all_inner_texts(), 'best': pg.locator('tbody tr').first.inner_text().replace('\t', ' ')}
    if SHOTS: pg.screenshot(path=f'{SHOTS}/custom.png', full_page=True)
    # editor validation: circular reference must block saving
    pg.goto(URL + '#/new'); pg.wait_for_selector('.msg.ok')
    pg.click('details.advanced > summary')
    f = pg.locator('table.tbl-edit').nth(2).locator('input').nth(1)
    f.fill('RIDX * 2'); pg.wait_for_selector('.msg.err')
    results['circular'] = {'error': pg.locator('.msg.err').inner_text()[:200], 'saveDisabled': pg.locator('button:has-text("Save machine")').is_disabled()}
    for page in ['#/inventories', '#/io', '#/help', '#/view/fd500-diff']:
        pg.goto(URL + page); pg.wait_for_timeout(300)
    b.close()
print(json.dumps(results, indent=1))
print('JS errors:', errors if errors else 'none')
sys.exit(1 if errors else 0)
