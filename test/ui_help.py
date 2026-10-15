"""v1.8.3 help.html: practice boxes (engine-backed), Ask Grok links, no secrets. python3 test/ui_help.py [base URL]"""
import sys, re, urllib.parse
from playwright.sync_api import sync_playwright
BASE = next((a for a in sys.argv[1:] if not a.startswith('--')), 'http://127.0.0.1:8018/')
fails, errors, net = [], [], []
def check(c, m): print(('PASS ' if c else 'FAIL ') + m); (None if c else fails.append(m))
PRE = 'Please read https://ram-gear.github.io/change-gear/help.html first.'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.set_default_timeout(20000)
    pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('request', lambda r: net.append(r.url) if 'supabase' in r.url or 'grok.com' in r.url else None)
    pg.goto(BASE + 'help.html'); pg.wait_for_function("document.body.dataset.practiceReady === '1'")
    bg = pg.evaluate("getComputedStyle(document.body).backgroundColor"); check(bg == 'rgb(234, 247, 234)', f'background #EAF7EA ({bg})')
    def run(prefix, task, vals):
        pg.select_option(f'#{prefix}-task', task)
        for k, v in vals.items(): pg.fill(f'#{prefix}-{k}', v)
        pg.click(f'#{prefix}-check'); pg.wait_for_selector(f'#{prefix}-result.ok, #{prefix}-result.bad')
        return pg.get_attribute(f'#{prefix}-result', 'class'), pg.inner_text(f'#{prefix}-result')
    c, t = run('tf', 'idx30', {'input': '30*k/z'}); check('ok' in c and t.startswith('Correct'), 'formula: 30*k/z correct')
    c, t = run('tf', 'idx30', {'input': 'K * 30 / Z'}); check('ok' in c, 'formula: equivalent form correct')
    c, t = run('tf', 'idx30', {'input': '24 * K / Z'}); check('bad' in c and '30 * K / Z' in t and 'right value' in t, 'formula: wrong constant -> Incorrect with answer + reason')
    c, t = run('tf', 'idx30', {'input': '30 * K / (Z'}); check('bad' in c and 'parse' in t, 'formula: syntax error explained')
    c, t = run('tf', 'diffm', {'input': '11.9367 * SIN(B) / D / K'}); check('bad' in c, 'formula: SIN (radians) instead of SIND rejected')
    c, t = run('tf', 'diffm', {'input': '11.9367*SIND(B)/D/K'}); check('ok' in c, 'formula: differential correct')
    c, t = run('tf', 'rpm', {'input': 'SF / (X * 3)'}); check('bad' in c and 'SF, DA' in t, 'formula: unknown name explained')
    c, t = run('tr', 'idx101', {'input': '.2376238'}); check('ok' in c, 'ratio: 24/101 correct')
    c, t = run('tr', 'idx101', {'input': '0.24'}); check('bad' in c and '0.2376238' in t, 'ratio: wrong -> right answer shown')
    c, t = run('tr', 'diff', {'input': '0.7460438'}); check('ok' in c, 'ratio: differential .7460438 correct')
    c, t = run('tr', 'idx40k2', {'input': 'abc'}); check('bad' in c and '1.2000000' in t, 'ratio: not a number')
    c, t = run('tg', 'diff', {'A': '23', 'B': '79', 'C': '82', 'D': '32'}); check('ok' in c, 'gears: 23/79 x 82/32 correct for .74604375')
    c, t = run('tg', 'diff', {'A': '24', 'B': '80', 'C': '80', 'D': '32'}); check('bad' in c and 'allowed' in t and 'One right answer' in t, f'gears: off ratio rejected')
    c, t = run('tg', 'diff', {'A': '15', 'B': '79', 'C': '82', 'D': '32'}); check('bad' in c and '20-88' in t, 'gears: out-of-box gear rejected')
    c, t = run('tg', 'idx47', {'A': '24', 'B': '47', 'C': '30', 'D': '30'}); check('ok' in c, 'gears: 24/47 x 30/30 correct')
    c, t = run('tg', 'idx47', {'A': '', 'B': '', 'C': '', 'D': ''}); m = re.search(r'One right answer: (\d+)/(\d+) × (\d+)/(\d+)', t)
    if m:
        c2, t2 = run('tg', 'idx47', dict(zip('ABCD', m.groups()))); check('ok' in c2, 'gears: the suggested answer itself is accepted')
    else: check(False, 'gears: answer suggested')
    asks = pg.eval_on_selector_all('a.ask', 'els => els.map(e => [e.href, e.target, e.rel])')
    qs = [urllib.parse.parse_qs(urllib.parse.urlparse(h).query).get('q', [''])[0] for h, _, _ in asks]
    check(len(asks) >= 20 and all(h.startswith('https://grok.com/?q=') and t == '_blank' and r == 'noopener' for h, t, r in asks), f'{len(asks)} Ask Grok links, new tab, noopener')
    check(all(q.startswith(PRE) for q in qs) and len(set(qs)) == len(qs), 'each Ask Grok question starts with the help-page sentence and is unique')
    html = pg.content(); check(not re.search(r'sb_publishable|supabase\.co|QC_ADMIN|password\s*=', html, re.I), 'no keys / secrets in the help page')
    check(not net, f'no requests to Supabase or grok.com while practising {net[:2]}')
    # app links
    pg.goto(BASE); pg.wait_for_timeout(1500)
    pg2 = pg
    check(pg2.locator('#login-help-page').count() == 1 and pg2.get_attribute('#login-help-page', 'href') == 'help.html', 'sign-in card links to help.html')
    hq = urllib.parse.parse_qs(urllib.parse.urlparse(pg2.get_attribute('#help-link', 'href')).query)['q'][0]
    check(hq.endswith('Please read https://ram-gear.github.io/change-gear/help.html first, then give me pointers.'), 'Help button question updated')
    check(not errors, 'no page errors ' + '; '.join(errors[:3]))
    b.close()
print('FAILED: ' + '; '.join(fails) if fails else 'ALL HELP CHECKS PASSED')
sys.exit(1 if fails else 0)
