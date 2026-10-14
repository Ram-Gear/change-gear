"""v1.7 browser tests: replace Supabase with the in-memory fake (test/mock_supabase.js) before the app loads.
install(page_or_context, user='gary') signs the page in as that fake user (gary=admin, vic=viewer, nora=none);
user=None starts signed out. The fake database lives in localStorage key 'cgmock.db' (survives reloads)."""
import os, json
MOCK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_supabase.js')
USERS = {'gary': {'pin': '4321', 'role': 'admin'}, 'vic': {'pin': '1111', 'role': 'viewer'}, 'nora': {'pin': '2222', 'role': 'none'}}
def install(target, user='gary'):
    target.add_init_script(path=MOCK)
    sess = json.dumps({'username': user}) if user else 'undefined'
    target.add_init_script(f"globalThis.__CG_SUPABASE_MOCK__ = makeCgMock({{ users: {json.dumps(USERS)}, persistKey: 'cgmock.db', session: {sess} }});")
