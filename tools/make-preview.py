# Builds a standalone PREVIEW (fake in-browser DB seeded with a copy of the machines, never talks to Supabase):
#   python3 tools/make-preview.py <seed.json> <out.html> <version label>
# Same recipe as /workspace/v1812-preview.html: ramgear-standalone.html + CSP connect-src 'none' + mock_supabase.js + seed.
import sys, json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
seed_path, out, ver = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(os.path.join(root, 'ramgear-standalone.html'), encoding='utf-8').read()
mock = open(os.path.join(root, 'test', 'mock_supabase.js'), encoding='utf-8').read()
seed = json.load(open(seed_path)); seed.setdefault('__storage', {})
key = 'cgpreview' + ver.replace('.', '') + '.db'
first = 'custom-uzp78zx'
html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'">\n', 1)
html = html.replace('<title>', f'<title>PREVIEW v{ver} - ', 1)
boot = f"""<!-- v{ver} PREVIEW: fake in-browser database with test data. connect-src 'none' blocks every network call, so it can never reach the live Supabase. -->
<script>{mock}</script>
<script>
(function(){{
  var KEY='{key}';
  var seed={json.dumps(seed)};
  var db=null; try {{ db=JSON.parse(localStorage.getItem(KEY)||'null'); }} catch(e) {{}}
  try {{ if (localStorage.getItem('ramgear.cg.headFolded')===null) localStorage.setItem('ramgear.cg.headFolded','0'); }} catch(e) {{}}
  globalThis.__CG_SUPABASE_MOCK__ = makeCgMock({{ users: {{"gary": {{"pin": "4321", "role": "admin"}}, "vic": {{"pin": "1111", "role": "viewer"}}}}, persistKey: KEY, db: db || seed, session: {{ username: 'gary' }} }});
  window.__rgPreviewReset = function(){{ localStorage.removeItem(KEY); localStorage.removeItem(KEY+'.session'); location.hash='#/m/{first}'; location.reload(); }};
  if (!location.hash) location.hash = '#/m/{first}';
  document.addEventListener('DOMContentLoaded', function(){{
    var b=document.createElement('div');
    b.style.cssText='position:sticky;top:0;z-index:9999;background:#fff3cd;border-bottom:2px solid #c99700;color:#5c4400;padding:6px 12px;font:14px system-ui,sans-serif';
    b.innerHTML='<b>PREVIEW v{ver} - test data only.</b> A copy of the machines, not connected to the live Ram-Gear database: nothing you save here reaches the real app (it stays in this browser). Signed in as a test admin. <a href="#" id="pv-reset">Reset test data</a>';
    document.body.insertBefore(b, document.body.firstChild);
    document.getElementById('pv-reset').onclick=function(e){{ e.preventDefault(); window.__rgPreviewReset(); }};
  }});
}})();
</script>
"""
i = html.index('<script type="importmap">')
html = html[:i] + boot + html[i:]
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html) // 1024, 'KB')
