"""v1.8.4 reroll UI: every gear-train section (built-ins FO-10 / Fauter / FD-500 and an added machine, ranked and
legacy search) has 'Show more / different options' + 'Start over' with its own no-repeat history."""
import sys, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cgmock
URL = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors = [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m); (None if c else fails.append(m))
VALS = {'B': '30', 'D': '8', 'K': '1', 'Z': '47', 'Q': '1'}
rows = lambda card: card.locator('tbody tr').evaluate_all("trs => trs.map(t => [...t.children].slice(1,5).map(c => c.textContent).join('/'))")
def calc(pg, mid):
    pg.goto(URL + '#/m/' + mid); pg.wait_for_selector('form.grid-form#' if False else 'button:has-text("Calculate")')
    for k, v in VALS.items():
        el = pg.locator('#in-' + k)
        if el.count():
            if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(v)
            else: el.fill(v)
    pg.click('button:has-text("Calculate")'); pg.wait_for_selector('.reroll-more')
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 1000}); cgmock.install(ctx, 'gary'); pg = ctx.new_page(); pg.set_default_timeout(30000)
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.wait_for_selector('#user-box')
    pg.goto(URL + '#/new'); pg.wait_for_selector('#simple-index'); pg.fill('#machine-name', 'Reroll Test Hobber'); pg.click('button:has-text("Save machine")'); pg.wait_for_selector('#verify-lock')
    custom = pg.url.split('#/m/')[1]
    for mid in ['tos-fo10-diff', 'fauter-diff', 'fd500-diff', custom]:
        calc(pg, mid)
        for mode in ['ranked', 'legacy-ramgear']:
          if mode != 'ranked':
              for j in range(pg.locator('.out-card:has(.reroll-more)').count()):
                  pg.locator('.out-card:has(.reroll-more)').nth(j).locator('select:has(option[value="legacy-ramgear"])').first.select_option(mode); pg.wait_for_timeout(300)
          cards = pg.locator('.out-card:has(.reroll-more)')
          n = cards.count(); check(n >= 1, f'{mid} [{mode}]: {n} section(s) with Show more')
          for i in range(n):
              c = cards.nth(i); title = c.locator('h3').first.inner_text()
              if c.locator('.reroll-status').count():   # ranked
                  b1 = rows(c); c.locator('.reroll-more').click(); pg.wait_for_timeout(300); b2 = rows(c)
                  c.locator('.reroll-more').click(); pg.wait_for_timeout(300); b3 = rows(c)
                  check(len(b1) == 20 and len(b2) > 0 and not (set(b1) & set(b2)) and not ((set(b1) | set(b2)) & set(b3)), f'{mid} / {title}: ranked batches distinct ({len(b1)}, {len(b2)}, {len(b3)})')
                  check('Options 41-' in c.locator('.reroll-status').inner_text(), f'{mid} / {title}: numbering continues')
                  c.locator('.reroll-reset').click(); pg.wait_for_timeout(300)
                  check(rows(c) == b1, f'{mid} / {title}: Start over gives the first batch again')
              else:   # legacy
                  c.locator('.reroll-more').click(); pg.wait_for_function("c => c.querySelectorAll('tbody tr').length >= 20", arg=c.element_handle(), timeout=60000)
                  r1 = rows(c); c.locator('.reroll-more').click(); pg.wait_for_function("c => c.querySelectorAll('tbody tr').length >= 40 || /No more/.test(c.textContent)", arg=c.element_handle(), timeout=60000)
                  r2 = rows(c); check(len(r1) == 20 and len(r2) > 20 and len(set(r2)) == len(r2) and r2[:20] == r1, f'{mid} / {title}: legacy next 20 continue, no repeats ({len(r2)})')
                  c.locator('.reroll-reset').click(); pg.wait_for_function("c => c.querySelectorAll('tbody tr').length === 20", arg=c.element_handle(), timeout=60000)
                  check(rows(c) == r1, f'{mid} / {title}: legacy Start over = first 20 again')
    # separate histories: rerolling one section does not change another
    calc(pg, 'tos-fo10-diff'); cards = pg.locator('.out-card:has(.reroll-status)')
    if cards.count() >= 2:
        a0 = rows(cards.nth(1)); cards.nth(0).locator('.reroll-more').click(); pg.wait_for_timeout(300)
        check(rows(cards.nth(1)) == a0, 'FO-10: sections keep separate histories')
    check(not errors, 'no page errors ' + '; '.join(errors[:3]))
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL REROLL UI CHECKS PASSED')
sys.exit(1 if fails else 0)
