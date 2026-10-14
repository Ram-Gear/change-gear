"""v1.8 browser test (fake Supabase): draft -> Verify & lock -> read-only, viewer sees no lock/delete buttons,
copy to new draft, delete a train, clear/delete gear lists, admin deletes a locked machine.
  python3 test/ui_lock_delete.py [URL]"""
import sys, json, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8000/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m); (None if c else fails.append(m))
DB = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('cgmock.db'))")
def page(b, user, seed=None):
    ctx = b.new_context(viewport={'width': 1300, 'height': 1000})
    if seed: ctx.add_init_script("if (!sessionStorage.getItem('cgSeeded')) { localStorage.setItem('cgmock.db', " + json.dumps(json.dumps(seed)) + "); sessionStorage.setItem('cgSeeded', '1'); }")
    cgmock.install(ctx, user)
    pg = ctx.new_page(); pg.set_default_timeout(30000)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return pg
def mrow(pg, name): return next((m for m in DB(pg)['cg_machines'] if m['name'] == name and not m.get('deleted_at')), None)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = page(b, 'gary'); pg.goto(URL); pg.evaluate("localStorage.clear()"); pg.reload()
    pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index')
    pg.fill('#machine-name', 'Lock UI Hobber'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    pg.wait_for_function("JSON.parse(localStorage.getItem('cgmock.db')||'{}').cg_machines?.some(m => m.name === 'Lock UI Hobber')", timeout=15000)
    mid = mrow(pg, 'Lock UI Hobber')['formulas']['def']['id']
    check(pg.locator('#draft-badge').count() == 1, 'new machine is a Draft')
    check(pg.locator('#remove-train-differential').count() == 1 and pg.locator('#delete-machine').count() == 1, 'admin: remove train + delete machine on draft')
    # delete differential train on the draft
    pg.click('#remove-train-differential'); pg.wait_for_selector('#remove-train-index')
    pg.wait_for_function("JSON.parse(localStorage.getItem('cgmock.db')).cg_machines.some(m => m.name === 'Lock UI Hobber' && m.formulas.def.trains.every(t => t.kind !== 'differential'))", timeout=15000)
    check(pg.locator('#remove-train-differential').count() == 0, 'differential train removed')
    # verify & lock
    pg.click('#verify-lock'); pg.wait_for_selector('#lock-badge')
    pg.wait_for_function("JSON.parse(localStorage.getItem('cgmock.db')).cg_machines.some(m => m.name === 'Lock UI Hobber' && m.formulas.locked === true)", timeout=15000)
    f = mrow(pg, 'Lock UI Hobber')['formulas']
    check(f['lockedBy'] == 'gary' and f['lockedAt'], 'lock stored with who/when')
    check('gary' in pg.inner_text('#lock-badge'), 'Locked badge shows who locked it')
    check(pg.locator('#verify-lock').count() == 0 and pg.locator('#remove-train-index').count() == 0, 'locked: no lock button, no remove train')
    check(pg.locator('#clear-gears-index').count() == 1 and pg.locator('#delete-gears-index').count() == 1, 'locked: gear list clear/delete still offered')
    check('gear lists' in pg.inner_text('#lock-help'), 'locked: UI explains gear lists stay editable')
    # editor read-only
    pg.goto(URL + '#/edit/' + mid); pg.wait_for_selector('#locked-note')
    check(pg.locator('button:has-text("Save machine")').count() == 0 and pg.locator('#const-index').is_disabled(), 'locked editor read-only for admin')
    check(pg.locator('#copy-draft:has-text("Copy to new draft")').count() == 1, 'Copy to new draft offered')
    # copy to new draft
    pg.click('#copy-draft'); pg.wait_for_selector('button:has-text("Save machine")')
    check(pg.locator('button:has-text("Save machine")').count() == 1 and not pg.locator('#const-index').is_disabled(), 'copy is an editable draft')
    pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#draft-badge')
    pg.wait_for_function("JSON.parse(localStorage.getItem('cgmock.db')).cg_machines.some(m => m.name === 'Lock UI Hobber (my copy)')", timeout=15000)
    check(not mrow(pg, 'Lock UI Hobber (my copy)')['formulas'].get('locked'), 'copy not locked')
    # clear then delete the locked machine's index gear list
    pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('#clear-gears-index')
    pg.click('#clear-gears-index'); pg.wait_for_timeout(1500)
    lid = mrow(pg, 'Lock UI Hobber')['id']
    check(any(g['machine_id'] == lid and g['teeth'] == [] for g in DB(pg)['cg_gear_sets']), 'locked machine gear list cleared')
    pg.click('#delete-gears-index'); pg.wait_for_timeout(1500)
    check(not any(g['machine_id'] == lid for g in DB(pg)['cg_gear_sets']), 'locked machine gear list deleted')
    check(mrow(pg, 'Lock UI Hobber')['formulas'].get('locked') is True, 'still locked after gear list delete')
    # gear list delete from inventories page
    pg.goto(URL + '#/inventories'); pg.wait_for_selector('h2:has-text("Gear inventories")')
    n = pg.locator('button.inv-del').count()
    check(n >= 1, 'admin: Delete buttons on gear lists')
    pg.locator('button.inv-del').first.click(); pg.wait_for_timeout(800)
    check(pg.locator('button.inv-del').count() == n - 1, 'gear list deleted from inventories page')
    seed = DB(pg)
    # viewer
    pv = page(b, 'vic', seed); pv.goto(URL + '#/m/' + mid); pv.wait_for_selector('form.grid-form')
    check(pv.locator('#lock-badge').count() == 1, 'viewer sees Locked badge')
    for sel, what in [('#verify-lock', 'Verify & lock'), ('#delete-machine', 'delete machine'), ('#train-admin', 'train admin'), ('button.danger', 'any delete button'), ('#copy-draft', 'copy')]:
        check(pv.locator(sel).count() == 0, f'viewer: no {what}')
    pv.goto(URL + '#/inventories'); pv.wait_for_selector('h2:has-text("Gear inventories")')
    check(pv.locator('button.inv-del').count() == 0 and pv.locator('button.inv-clear').count() == 0, 'viewer: no gear list delete/clear')
    # admin deletes the locked machine
    pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('#delete-machine')
    pg.click('#delete-machine')
    pg.wait_for_function("!JSON.parse(localStorage.getItem('cgmock.db')).cg_machines.some(m => m.name === 'Lock UI Hobber' && !m.deleted_at)", timeout=15000)
    check(mrow(pg, 'Lock UI Hobber') is None, 'admin deleted locked machine')
    pg.goto(URL + '#/m/tos-fo10-diff'); pg.wait_for_selector('form.grid-form')
    check(pg.locator('#delete-machine').count() == 0, 'built-in: no delete')
    check(not errors, 'no page errors ' + '; '.join(errors))
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL LOCK/DELETE UI CHECKS PASSED')
sys.exit(1 if fails else 0)
