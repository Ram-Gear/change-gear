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
// v1.8.3: embed the App Hub icon (small SVG) as a data URI; drop the PNG touch icon (not needed offline)
const iconUri = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, 'img', 'change-gear.svg')).toString('base64');
html = html.split('img/change-gear.svg').join(iconUri).replace(/<link rel="apple-touch-icon"[^>]*>\n/, '');
html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
html = html.replace(/<script>\s*\/\/ ES modules do not load[\s\S]*?<\/script>\n/, '');
html = html.replace('<script type="module" src="js/app.js"></script>',
  `<script type="importmap">${JSON.stringify({ imports })}</script>\n<script type="module">import 'rg/app.js';</script>`);
// v1.8.3: the help page is not bundled; offline copies link to the published one
html = html.replace(/href: 'help\.html'/g, "href: 'https://ram-gear.github.io/change-gear/help.html'").replace(/href=\\?"help\.html\\?"/g, (m) => m.replace('help.html', 'https://ram-gear.github.io/change-gear/help.html'));
fs.writeFileSync(path.join(root, 'ramgear-standalone.html'), html);
console.log(`wrote ramgear-standalone.html (${Math.round(html.length / 1024)} KB)`);
