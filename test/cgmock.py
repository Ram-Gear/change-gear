"""v1.7 browser tests: replace Supabase with the in-memory fake (test/mock_supabase.js) before the app loads.
install(page_or_context, user='gary') signs the page in as that fake user (gary=admin, vic=viewer, nora=none);
user=None starts signed out. The fake database lives in localStorage key 'cgmock.db' (survives reloads)."""
import os, json
MOCK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_supabase.js')
USERS = {'gary': {'pin': '4321', 'role': 'admin'}, 'vic': {'pin': '1111', 'role': 'viewer'}, 'nora': {'pin': '2222', 'role': 'none'}}
def install(target, user='gary', buckets=None, unfold=True):
    """buckets: list of Storage buckets that exist (default: cg-manuals exists); [] = not created yet."""
    target.add_init_script(path=MOCK)
    # v1.8.7: the machine menu starts folded; older tests expect its buttons visible, so unfold unless asked not to
    if unfold: target.add_init_script("try { if (localStorage.getItem('ramgear.cg.headFolded') === null) localStorage.setItem('ramgear.cg.headFolded', '0'); } catch (e) {}")
    sess = json.dumps({'username': user}) if user else 'undefined'
    target.add_init_script(f"globalThis.__CG_SUPABASE_MOCK__ = makeCgMock({{ users: {json.dumps(USERS)}, persistKey: 'cgmock.db', session: {sess}" + (f", storageBuckets: {json.dumps(buckets)}" if buckets is not None else '') + " });")
