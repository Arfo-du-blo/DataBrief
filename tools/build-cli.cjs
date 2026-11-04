#!/usr/bin/env node
/* Builds dist/databrief-cli.cjs: the command-line tool as ONE file (needs only Node 18 or newer, no npm packages).
 *   node tools/build-cli.cjs [OUTPUT]
 * The file holds the tool's modules (cli/*.cjs) and, in cli/bundle-data.cjs's place, the page's scripts in page order with
 * the vendored libraries, the SQLite WebAssembly (base64), the xmldom and parse5 bundles and src/core.js. Line endings are
 * normalised to LF, nothing depends on the time or the machine: the same sources give the same bytes everywhere, which
 * the tests check (and the release publishes the file's SHA-256).
 * DATABRIEF_VERSION=1.5.0-rc.1 builds a file that says another version (the npm release candidate).
 * To check a build against a copy:  node tools/build-cli.cjs /tmp/other.cjs && cmp dist/databrief-cli.cjs /tmp/other.cjs */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MODULES = ['args', 'clipboard', 'outfiles', 'editor', 'realm', 'main'];
const lf = (s) => s.replace(/\r\n?/g, '\n');
const read = (p) => lf(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// the page's scripts: the same list cli/realm.cjs reads from the source tree (it must not find a bundle-data.cjs here)
if (fs.existsSync(path.join(ROOT, 'cli', 'bundle-data.cjs'))) throw new Error('cli/bundle-data.cjs must not exist in the source tree');
const realm = require('../cli/realm.cjs');
const list = realm.fullScriptList(read('src/template.html'));
const sources = {}, wasm = {};
for (const s of list) {
  if (s.wasm) wasm[s.wasm] = fs.readFileSync(path.join(ROOT, s.wasm)).toString('base64');
  else sources[s.file] = read(s.file);
}
// DATABRIEF_VERSION replaces the version of package.json (a release candidate: 1.5.0-rc.1, built by tools/build-npm.cjs)
const version = process.env.DATABRIEF_VERSION || JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('Not a version: ' + version);
const data = { version, list, sources, wasm };

// DATABRIEF_LIBRARY=1 builds the same file but, instead of running the command line, it exports the tool's main module ({ run, defaultEnv, ... }):
// the Claude Desktop extension (tools/build-mcpb.cjs) runs it inside its own process, because Claude Desktop's built-in Node cannot start a subprocess.
const entry = process.env.DATABRIEF_LIBRARY === '1' ? "module.exports = require('./main.cjs');\n" : read('cli/databrief.cjs').replace(/^#!.*\n/, '');
const wrap = (name, src) => JSON.stringify(name) + ': function (module, exports, require) {\n' + src + '\n}';
const parts = MODULES.map((m) => wrap('./' + m + '.cjs', read('cli/' + m + '.cjs')));
parts.push(wrap('./bundle-data.cjs', 'module.exports = JSON.parse(' + JSON.stringify(JSON.stringify(data)) + ');'));

const out = [
  '#!/usr/bin/env node',
  '/* DataBrief ' + version + ' command line (databrief --help). GPL-3.0-or-later. One file: built by tools/build-cli.cjs from',
  ' * https://github.com/Arfo-du-blo/DataBrief - the sources, the licenses of the bundled libraries (vendor/LICENSE-*.txt and',
  ' * THIRD-PARTY-NOTICES.md) and the SHA-256 of this file are in the release. Needs Node.js 18 or newer. */',
  "'use strict';",
  'const __modules = {',
  parts.join(',\n'),
  '};',
  'const __cache = {};',
  'function __require(name) {',
  '  if (!Object.prototype.hasOwnProperty.call(__modules, name)) return require(name);',
  '  if (!__cache[name]) { const m = { exports: {} }; __cache[name] = m; __modules[name](m, m.exports, __require); }',
  '  return __cache[name].exports;',
  '}',
  '(function (require) {',
  entry,
  '})(__require);',
  '',
].join('\n');

const target = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'databrief-cli.cjs'));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out, 'utf8');
try { fs.chmodSync(target, 0o755); } catch (e) { /* Windows */ }
const sha = crypto.createHash('sha256').update(out).digest('hex');
console.log(path.relative(process.cwd(), target) + '  ' + (Buffer.byteLength(out) / 1048576).toFixed(2) + ' MB  sha256 ' + sha);
