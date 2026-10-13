// Runs every Node test (no network, no BASIC interpreter needed: the PC-BASIC
// results are cached in test/fixtures). Use --live on basic_compare.mjs to re-run PC-BASIC.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
for (const f of ['engine.test.mjs', 'simple_csv.test.mjs', 'mbf_fuzz.test.mjs', 'legacy_search.test.mjs', 'basic_compare.mjs']) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(here, f), ...(f === 'basic_compare.mjs' ? ['--cachedonly'] : [])], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} test file(s) FAILED` : '\nALL TESTS PASSED');
process.exitCode = bad ? 1 : 0;
