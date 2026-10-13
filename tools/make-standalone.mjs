// Optional helper: writes ramgear-standalone.html, a single file with the CSS and all
// JS modules embedded (via an import map of data: URLs), so the app also works when the
// file is simply double-clicked (file://). The normal app needs no build step.
//   node tools/make-standalone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'js');
const imports = {};
for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8').replace(/(from\s+|import\s*\(\s*)'\.\/([\w-]+\.js)'/g, "$1'rg/$2'");
  imports[`rg/${f}`] = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
}
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
html = html.replace(/<script>\s*\/\/ ES modules do not load[\s\S]*?<\/script>\n/, '');
html = html.replace('<script type="module" src="js/app.js"></script>',
  `<script type="importmap">${JSON.stringify({ imports })}</script>\n<script type="module">import 'rg/app.js';</script>`);
fs.writeFileSync(path.join(root, 'ramgear-standalone.html'), html);
console.log(`wrote ramgear-standalone.html (${Math.round(html.length / 1024)} KB)`);
