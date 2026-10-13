"""v1.5 browser test: Add a machine with index 24*K/Z and a Fauter-like differential, own gear
lists, Edit gear buttons, per-gear table, quick add, CSV import preview (replace / add, bad rows),
rename and delete. Run: python3 test/ui_new_machine.py [url]   (serve the folder first)"""
import sys, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000/'
errors, out = [], {}
def check(c, m):
    if not c: errors.append('FAIL: ' + m)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1300, 'height': 1000})
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append('console.error: ' + m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index')
    check(pg.locator('#const-index').input_value() == '24', 'index constant defaults to 24')
    check('KIDX * K / Z' in pg.locator('#simple-index').inner_text(), 'index formula shown')
    check(pg.locator('#const-differential').input_value() == '11.9367', 'differential constant default')
    check(not pg.locator('details.advanced').evaluate('e => e.open'), 'advanced tucked away')
    pg.wait_for_selector('.msg.ok:has-text("Formulas check out")')
    pg.fill('#machine-name', 'Test Hobber')
    pg.click('button:has-text("Save machine")'); pg.wait_for_selector('form.grid-form')
    st = pg.evaluate("JSON.parse(localStorage.getItem('ramgear.changegear.v1'))")
    names = sorted(i['name'] for i in st['inventories'])
    out['inventories'] = names
    check(names == ['Test Hobber differential gears', 'Test Hobber index gears'], 'own gear lists created')
    m = st['machines'][0]
    check({t['kind']: t['inventory'] for t in m['trains']} == {'index': m['ownInventories']['index'], 'differential': m['ownInventories']['differential']}, 'trains linked to own lists')
    for k, v in {'Z': '40', 'K': '1', 'B': '30', 'D': '8'}.items(): pg.fill('#in-' + k, v)
    pg.select_option('#in-Q', '1')
    pg.click('button:has-text("Calculate")'); pg.wait_for_selector('.results-table')
    res = dict(zip(pg.locator('.results-table td:not(.big)').all_inner_texts(), pg.locator('.results-table td.big').all_inner_texts()))
    out['results'] = res
    check(float(res.get('Index ratio', 'nan')) == 0.6, 'index ratio .6')
    check(abs(float(res.get('Differential ratio', 'nan')) - 0.7460438) < 1e-6, 'differential like Fauter')
    pg.wait_for_function("() => [...document.querySelectorAll('.card h3')].filter(h => /change gears/.test(h.textContent)).length === 2")
    heads = [h for h in pg.locator('.card h3').all_inner_texts() if 'change gears' in h]
    tables = pg.locator('.card:has(h3:has-text("change gears")) table tbody tr').count()
    out['gearCards'] = heads; out['gearRows'] = tables
    check(len(heads) == 2 and tables >= 2, 'both gear match lists shown')
    # Edit index gears -> per-gear table, quick add, CSV
    pg.click('button:has-text("Edit index gears")'); pg.wait_for_selector('#inv-editor')
    check(pg.locator('#gear-table tbody tr').count() == 69, 'placeholder 20-88')
    pg.click('button:has-text("Clear list")')
    pg.fill('#quick-gears', '20, 24, 30, 36'); pg.click('button:has-text("Add gears")')
    check(pg.locator('#gear-table tbody tr').count() == 4, 'quick add 4 gears')
    pg.locator('#gear-table .gear-note').first.fill('chipped tooth')
    csv = 'Teeth;Qty;Note\n40;2;spare\n44;x;\n48\nabc;1\n'
    pg.set_input_files('#csv-file', files=[{'name': 'gears.csv', 'mimeType': 'text/csv', 'buffer': csv.encode()}])
    pg.wait_for_selector('#csv-preview')
    prev = pg.locator('#csv-preview').inner_text()
    check('2 row(s) will be skipped' in prev, 'bad rows flagged')
    pg.click('button:has-text("Add to my list")')
    check(pg.locator('#gear-table tbody tr').count() == 6, 'CSV added to list')
    pg.click('#inv-editor button:has-text("Save")'); pg.wait_for_timeout(200)
    st = pg.evaluate("JSON.parse(localStorage.getItem('ramgear.changegear.v1'))")
    g = next(i for i in st['inventories'] if i['name'] == 'Test Hobber index gears')['gears']
    out['indexGears'] = g
    check(g == [{'teeth': 20, 'qty': 1, 'note': 'chipped tooth'}, {'teeth': 24, 'qty': 1}, {'teeth': 30, 'qty': 1}, {'teeth': 36, 'qty': 1}, {'teeth': 40, 'qty': 2, 'note': 'spare'}, {'teeth': 48, 'qty': 1}], 'saved gears with notes')
    # replace via CSV on the differential list
    pg.goto(URL + '#/m/' + m['id']); pg.wait_for_selector('form.grid-form')
    pg.click('button:has-text("Edit differential gears")'); pg.wait_for_selector('#inv-editor')
    pg.set_input_files('#csv-file', files=[{'name': 'd.csv', 'mimeType': 'text/csv', 'buffer': b'20\n30\n40\n'}])
    pg.click('button:has-text("Replace my list with these")')
    check(pg.locator('#gear-table tbody tr').count() == 3, 'CSV replace')
    # rename machine -> lists renamed
    pg.goto(URL + '#/edit/' + m['id']); pg.wait_for_selector('#machine-name')
    pg.fill('#machine-name', 'Hobber Two'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('form.grid-form')
    st = pg.evaluate("JSON.parse(localStorage.getItem('ramgear.changegear.v1'))")
    check(sorted(i['name'] for i in st['inventories']) == ['Hobber Two differential gears', 'Hobber Two index gears'], 'lists renamed')
    # copy of Fauter: add index simply
    pg.goto(URL + '#/copy/fauter-diff'); pg.wait_for_selector('#simple-index')
    check(pg.locator('#const-differential').input_value() == '11.9367', 'Fauter copy shows differential constant')
    pg.click('button:has-text("+ Add index ratio")'); pg.wait_for_selector('#const-index')
    pg.wait_for_selector('.msg.ok:has-text("Formulas check out")')
    pg.click('button:has-text("Save machine")'); pg.wait_for_selector('form.grid-form')
    check(pg.locator('#in-Z').count() == 1, 'Fauter copy got teeth box')
    # delete -> also deletes lists (dialogs accepted)
    pg.goto(URL + '#/edit/' + m['id']); pg.wait_for_selector('button:has-text("Delete machine")')
    pg.click('button:has-text("Delete machine")'); pg.wait_for_timeout(300)
    st = pg.evaluate("JSON.parse(localStorage.getItem('ramgear.changegear.v1'))")
    check(not any(i['name'].startswith('Hobber Two') for i in st['inventories']), 'lists deleted with machine')
    b.close()
print(json.dumps(out, indent=1))
print('\n'.join(errors) if errors else 'ui_new_machine: ALL PASSED')
sys.exit(1 if errors else 0)
