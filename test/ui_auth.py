"""v1.7 logins + roles (browser, fake Supabase from test/mock_supabase.js unless --live).
  python3 test/ui_auth.py [URL]          signed out / wrong PIN / role none / viewer / admin with the fake
  python3 test/ui_auth.py [URL] --live   real project: login screen shows, wrong PIN refused. The rg-admin
                                         activate call is intercepted in the browser and never reaches the server."""
import sys, json, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8000/')
LIVE = '--live' in sys.argv
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m); (None if c else fails.append(m))
SHARED = {'db': None}  # browser contexts do not share localStorage: hand the fake shared DB to each new 'PC'
def _acc(d):  # v1.8.6: 'Save as preset' asks for a name
    try: d.accept()
    except Exception: pass
def page(b, user, fresh=True):
    ctx = b.new_context(viewport={'width': 1300, 'height': 1000})
    if SHARED['db']: ctx.add_init_script("if (!sessionStorage.getItem('cgSeeded')) { localStorage.setItem('cgmock.db', " + json.dumps(json.dumps(SHARED['db'])) + "); sessionStorage.setItem('cgSeeded', '1'); }")
    if not LIVE: cgmock.install(ctx, user)
    pg = ctx.new_page(); pg.set_default_timeout(30000)
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', _acc)
    return pg
with sync_playwright() as p:
    b = p.chromium.launch()
    if LIVE:
        pg = page(b, None); calls = []
        pg.route('**/functions/v1/rg-admin', lambda r: (calls.append(r.request.post_data), r.fulfill(status=400, body='{"error":"blocked by test"}')))
        pg.goto(URL); pg.wait_for_selector('#login-form')
        check(pg.locator('nav a').count() == 0, 'live: signed out sees only the login screen')
        pg.fill('#login-user', 'zz-cg-nonexistent-test'); pg.fill('#login-pin', '000000'); pg.click('#login-go')
        pg.wait_for_selector('#login-error')
        check('Wrong username or PIN' in pg.inner_text('#login-error'), 'live: wrong PIN refused with a clear message')
        check(len(calls) == 1, 'live: activate attempted once (intercepted, never sent)')
        check(pg.locator('#user-box').count() == 0, 'live: no user box')
    else:
        # signed out -> login only; wrong PIN; then admin signs in
        pg = page(b, None); pg.goto(URL); pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_selector('#login-form')
        check(pg.locator('nav a').count() == 0 and pg.locator('form.grid-form#login-form').count() == 1, 'signed out: login screen only')
        check('needs an admin' in pg.inner_text('#login-admin-note'), 'signed out: admin note on sign-in card')
        pg.fill('#login-user', 'gary'); pg.fill('#login-pin', '9999'); pg.click('#login-go'); pg.wait_for_selector('#login-error')
        check('Wrong username or PIN' in pg.inner_text('#login-error'), 'wrong PIN message')
        pg.fill('#login-pin', '4321'); pg.click('#login-go'); pg.wait_for_selector('#user-box')
        check(pg.inner_text('#user-name') == 'gary' and 'admin' in pg.inner_text('#user-role'), 'admin signed in, name + role shown')
        check(pg.locator('nav a:has-text("Add a machine")').count() == 1 and pg.locator('#add-hint').count() == 0, 'admin: Add a machine in menu, no hint')
        # admin creates a machine -> stored in the fake shared DB
        pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index')
        pg.locator('.editor-main input').first.fill('Shared Test Hobber')
        pg.click('button:has-text("Save machine")'); pg.wait_for_selector('form.grid-form')
        pg.wait_for_function("JSON.parse(localStorage.getItem('cgmock.db')||'{}').cg_machines?.some(m => m.name === 'Shared Test Hobber')", timeout=15000)
        db = pg.evaluate("JSON.parse(localStorage.getItem('cgmock.db'))")
        m = [x for x in db['cg_machines'] if x['name'] == 'Shared Test Hobber'][0]
        check(m['formulas'].get('app') == 'ramgear-changegear' and 'def' in m['formulas'], 'machine definition in formulas jsonb')
        kinds = sorted(g['kind'] for g in db['cg_gear_sets'] if g['machine_id'] == m['id'])
        check(kinds == ['differential', 'indexing'], f'own gear lists stored as cg_gear_sets {kinds}')
        check(pg.locator('button:has-text("Edit index gears")').count() == 1 and pg.locator('#manual-attach').count() == 1, 'admin: edit gears + attach manual visible')
        pg.fill('#in-Z', '47'); pg.fill('#in-K', '1')
        for k in ['B', 'D']:
            if pg.locator('#in-' + k).count(): pg.fill('#in-' + k, '30' if k == 'B' else '8')
        pg.click('button:has-text("Calculate")'); pg.wait_for_selector('.save-row-preset')
        pg.locator('.save-row-preset').first.click()
        pg.wait_for_function("JSON.parse(localStorage.getItem('cgmock.db')).cg_presets.some(p => p.name === 'z=47')", timeout=15000)
        pr = [x for x in pg.evaluate("JSON.parse(localStorage.getItem('cgmock.db'))")['cg_presets'] if x['name'] == 'z=47'][0]
        check(pr['inputs'] == {'z': 47} and set(pr['result']) >= {'A', 'B', 'C', 'D', 'note'}, f'preset row {pr["inputs"]} {pr["result"]}')
        SHARED['db'] = pg.evaluate("JSON.parse(localStorage.getItem('cgmock.db'))")
        pg.click('#sign-out'); pg.wait_for_selector('#login-form')
        check(pg.locator('#user-box').count() == 0, 'sign out returns to login')
        # viewer sees shared data read-only
        pv = page(b, 'vic'); pv.goto(URL); pv.wait_for_selector('#user-box')
        check('viewer' in pv.inner_text('#user-role'), 'viewer role shown')
        check(pv.locator('nav a:has-text("Shared Test Hobber")').count() == 1, 'viewer sees shared machine')
        check(pv.locator('nav a:has-text("Add a machine")').count() == 0, 'viewer: no Add a machine')
        check(pv.locator('#add-hint').count() == 1, 'viewer: greyed admin hint in menu')
        pv.click('#add-hint'); pv.wait_for_selector('#admin-hint-card')
        check(pv.inner_text('#hint-user') == 'vic' and 'viewer' in pv.inner_text('#hint-role') and pv.locator('#hint-signout').count() == 1, 'viewer: hint explains user/role, offers sign out')
        pv.goto(URL + '#/m/' + m['formulas']['def']['id']); pv.wait_for_selector('form.grid-form')
        for sel, what in [('button:has-text("Edit index gears")', 'edit gears'), ('button:has-text("Duplicate")', 'duplicate'), ('#manual-attach', 'attach manual'), ('#preset-add', 'add preset'), ('#preset-save', 'save presets')]:
            check(pv.locator(sel).count() == 0, f'viewer: no {what}')
        check(pv.locator('#preset-table tbody tr').count() == 1, 'viewer sees the shared preset')
        pv.fill('#in-Z', '47'); pv.fill('#in-K', '1')
        for k in ['B', 'D']:
            if pv.locator('#in-' + k).count(): pv.fill('#in-' + k, '30' if k == 'B' else '8')
        pv.click('button:has-text("Calculate")'); pv.wait_for_selector('.results-table')
        check(pv.locator('.results-table td.big').count() >= 1, 'viewer can calculate')
        check(pv.locator('.save-row-preset').count() == 0 and pv.locator('#save-preset').count() == 0, 'viewer: no Save as preset')
        pv.goto(URL + '#/m/tos-fo10-diff'); pv.wait_for_selector('form.grid-form')
        check(pv.locator('button:has-text("Copy to edit")').count() == 0, 'viewer: no Copy to edit on built-in')
        pv.goto(URL + '#/new'); pv.wait_for_selector('.msg.warn')
        check(pv.locator('#simple-index').count() == 0, 'viewer: #/new blocked')
        pv.goto(URL + '#/edit/' + m['formulas']['def']['id']); pv.wait_for_selector('.badge.builtin')
        check(pv.locator('button:has-text("Save machine")').count() == 0 and pv.locator('button:has-text("Delete machine")').count() == 0, 'viewer: editor read-only, no delete')
        pv.goto(URL + '#/inventories'); pv.wait_for_selector('h2:has-text("Gear inventories")')
        check(pv.locator('button:has-text("New inventory")').count() == 0 and pv.locator('main button:has-text("Edit")').count() == 0, 'viewer: gear lists read-only')
        pv.goto(URL + '#/io'); pv.wait_for_selector('#export-json')
        check(pv.locator('input[type=file]').count() == 0 and pv.locator('#upload-local').count() == 0, 'viewer: no import, no upload')
        # role none
        pn = page(b, 'nora'); pn.goto(URL); pn.wait_for_selector('#login-signout')
        check('role: none' in pn.inner_text('#login') and pn.locator('nav a').count() == 0, 'role none: no access screen only')
        # admin: one-time upload of v1.6 browser data
        pa = page(b, 'gary'); pa.goto(URL)
        pa.evaluate("""localStorage.setItem('ramgear.changegear.v1', JSON.stringify({machines:[], inventories:[{id:'inv-old', name:'Old box', gears:[{teeth:50,qty:2,note:'n'}]}],
            builtinOverrides:{'fauter-diff':{trains:{0:{inventory:'inv-old', strategy:'ranked'}}, indexPresets:[]}}, lastInputs:{}}))""")
        pa.goto(URL + '#/io'); pa.reload(); pa.wait_for_selector('#upload-local-go')
        pa.click('#upload-local-go'); pa.wait_for_selector('#upload-local-msg .msg')
        db = pa.evaluate("JSON.parse(localStorage.getItem('cgmock.db'))")
        fr = [x for x in db['cg_machines'] if x['formulas'].get('builtin') == 'fauter-diff']
        check(len(fr) == 1 and any(g['machine_id'] == fr[0]['id'] and g['teeth'] == [50, 50] for g in db['cg_gear_sets']), 'upload: built-in row created by name, gear list stored')
    check(not errors, 'no page errors ' + '; '.join(errors))
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL AUTH UI CHECKS PASSED')
sys.exit(1 if fails else 0)
