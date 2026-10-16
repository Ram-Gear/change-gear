"""v1.8.6 named index presets (fake DB): Save as preset asks for a name (cg_presets.result.name), Load preset fills the
gear fields and shows the train, Rename / Delete for admins, viewers can only load, non-exact presets are flagged.
Built-in FO-10 and an added machine, ranked and original-program search."""
import sys, os, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
SHOT = '/workspace/v186_named_presets.png'
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m, flush=True); (None if c else fails.append(m))
answers = []
def page(b, user, db=None):
    ctx = b.new_context(viewport={'width': 1300, 'height': 1100})
    if db: ctx.add_init_script("if (!sessionStorage.getItem('cgSeeded')) { localStorage.setItem('cgmock.db', " + json.dumps(json.dumps(db)) + "); sessionStorage.setItem('cgSeeded', '1'); }")
    cgmock.install(ctx, user); pg = ctx.new_page(); pg.set_default_timeout(30000)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept(answers.pop(0)) if d.type == 'prompt' and answers else d.accept())
    return pg
def calc(pg, mid, z='47'):
    pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('#in-Z')
    for k, v in {'B': '30', 'D': '8', 'K': '1', 'Z': z}.items():
        if pg.locator('#in-' + k).count(): pg.fill('#in-' + k, v)
    pg.click('button:has-text("Calculate")'); pg.wait_for_selector('.preset-bar')
def bar(pg): return pg.locator('.preset-bar').first
def gears(pg, a, b_, c, d):
    for k, v in zip('ABCD', [a, b_, c, d]): bar(pg).locator(f'[data-gear="{k}"]').fill(str(v))
db = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('cgmock.db'))")
def presets(pg, mid_name=None): return [p for p in db(pg)['cg_presets']]
def wait_db(pg, js): pg.wait_for_function("(() => { const d = JSON.parse(localStorage.getItem('cgmock.db')); return " + js + "; })()", timeout=15000)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = page(b, 'gary'); pg.goto(URL); pg.wait_for_selector('#user-box')
    pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index'); pg.fill('#machine-name', 'Preset Test Hobber'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    custom = pg.url.split('#/m/')[1]
    for mid in ['tos-fo10-diff', custom]:
        calc(pg, mid)
        check(bar(pg).locator('select.preset-load').count() == 1, f'{mid}: Load preset dropdown in the index section')
        gears(pg, 24, 47, 20, 20)
        check('Exact' in bar(pg).locator('.preset-train').inner_text() and '24/47 × 20/20' in bar(pg).inner_text(), f'{mid}: typed gears show the train, exact')
        answers.append('Main hob 47'); bar(pg).locator('.preset-save').click()
        wait_db(pg, "d.cg_presets.some(p => p.result && p.result.name === 'Main hob 47')")
        row = [x for x in presets(pg) if (x['result'] or {}).get('name') == 'Main hob 47'][0]
        check(row['inputs'] == {'z': 47} and row['result']['A'] == 24 and row['result']['D'] == 20 and row['name'].startswith('z=47'), f'{mid}: stored as cg_presets name={row["name"]} result.name (no schema change)')
        # non-exact preset is flagged
        gears(pg, 25, 49, 20, 20)
        check(bar(pg).locator('.preset-flag').count() == 1, f'{mid}: non-exact gears flagged "Not exact"')
        answers.append('Rough'); bar(pg).locator('.preset-save').click()
        wait_db(pg, "d.cg_presets.some(p => p.result && p.result.name === 'Rough')")
        calc(pg, mid)
        opts = bar(pg).locator('select.preset-load option').all_inner_texts()
        check(any('Rough' in o and 'not exact' in o for o in opts) and any('Main hob 47' in o and 'not exact' not in o for o in opts), f'{mid}: dropdown lists names, flags the non-exact one {opts}')
        check(pg.locator('.preset-results .preset-flag').count() == 1, f'{mid}: saved-preset table flags the non-exact one')
        # load fills the fields
        v = [o for o in bar(pg).locator('select.preset-load option').all() if 'Main hob 47' in o.inner_text()][0].get_attribute('value')
        bar(pg).locator('select.preset-load').select_option(v)
        vals = [bar(pg).locator(f'[data-gear="{k}"]').input_value() for k in 'ABCD']
        check(vals == ['24', '47', '20', '20'] and '24/47 × 20/20' in bar(pg).locator('.preset-train').inner_text(), f'{mid}: Load preset fills the gear fields {vals} and shows the train')
        if mid == 'tos-fo10-diff': pg.locator('.preset-bar').first.scroll_into_view_if_needed(); pg.locator('.out-card:has(.preset-bar)').first.screenshot(path=SHOT)
        # rename
        answers.append('Main hob 47 (checked)'); bar(pg).locator('.preset-rename').click()
        wait_db(pg, "d.cg_presets.some(p => p.result && p.result.name === 'Main hob 47 (checked)')")
        check(not any((x['result'] or {}).get('name') == 'Main hob 47' for x in presets(pg)), f'{mid}: Rename updates result.name')
        # delete Rough
        v = [o for o in bar(pg).locator('select.preset-load option').all() if 'Rough' in o.inner_text()][0].get_attribute('value')
        bar(pg).locator('select.preset-load').select_option(v); bar(pg).locator('.preset-delete').click()
        wait_db(pg, "!d.cg_presets.some(p => p.result && p.result.name === 'Rough')")
        check(True, f'{mid}: Delete removes the preset row')
        # original-program search mode has the bar too, and a result row click fills it (ranked)
        calc(pg, mid); pg.locator('.out-card:has(.preset-bar) tbody tr.clickable').nth(2).click()
        check(bar(pg).locator('[data-gear="A"]').input_value() != '', f'{mid}: clicking a result fills the gear fields')
        pg.locator('.out-card:has(.preset-bar) select:has(option[value="legacy-ramgear"])').first.select_option('legacy-ramgear'); pg.wait_for_timeout(400)
        check(pg.locator('.out-card:has(.reroll-more) .preset-bar').count() >= 1, f'{mid}: Load preset also in original-program search mode')
        pg.locator('.out-card:has(.preset-bar) select:has(option[value="legacy-ramgear"])').first.select_option('ranked'); pg.wait_for_timeout(300)
    shared = db(pg)
    # viewer: can load, cannot save / rename / delete
    pv = page(b, 'vic', shared); pv.goto(URL); pv.wait_for_selector('#user-box')
    calc(pv, 'tos-fo10-diff')
    check(bar(pv).locator('.preset-save, .preset-rename, .preset-delete').count() == 0, 'viewer: no Save / Rename / Delete')
    v = [o for o in bar(pv).locator('select.preset-load option').all() if 'Main hob 47 (checked)' in o.inner_text()][0].get_attribute('value')
    bar(pv).locator('select.preset-load').select_option(v)
    check([bar(pv).locator(f'[data-gear="{k}"]').input_value() for k in 'ABCD'] == ['24', '47', '20', '20'], 'viewer: Load preset fills the gear fields')
    check(not errors, 'no page errors ' + '; '.join(errors[:3]))
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL NAMED PRESET CHECKS PASSED')
sys.exit(1 if fails else 0)
