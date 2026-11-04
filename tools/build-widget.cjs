#!/usr/bin/env node
/* Builds dist/databrief-widget.html: DataBrief as a widget for Claude, ChatGPT and other hosts of MCP Apps.
 *   node tools/build-widget.cjs [OUTPUT]
 * It starts from the committed databrief.html (which is NOT changed) and writes a copy with
 *   - two small anchored patches in the page's script: window.DataBriefPage (read access to the page's state, so the widget layer
 *     reads the prompt from the page instead of catching it from a button) and a hook in save() that lets the layer route
 *     downloads through the host. Each anchor must be found exactly once, or the build stops: a change in the page that moves them
 *     has to be followed here;
 *   - the widget layer (widget/widget.js, widget/widget-i18n.js, widget/widget.css) before the last </body>.
 * The layer is inert outside a frame whose host answers the MCP Apps handshake: the copy opened on its own is the normal page.
 * Line endings are LF and nothing depends on the time or the machine: the same sources give the same bytes everywhere (the
 * tests check it). The output holds a comment with the SHA-256 of the page it was made from.
 * To check a build against a copy:  node tools/build-widget.cjs /tmp/other.html && cmp dist/databrief-widget.html /tmp/other.html */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const lf = (s) => s.replace(/\r\n?/g, '\n');
const read = (p) => lf(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// [name, text to find (exactly once in databrief.html), text that replaces it]
const PATCHES = [
  ['the page hook', "  const fmt = (n) => new Intl.NumberFormat(DB.locale(state.ui)).format(n);",
    "  const fmt = (n) => new Intl.NumberFormat(DB.locale(state.ui)).format(n);\n  window.DataBriefPage = { get state() { return state; }, DB, tu };"],
  ['the download hook', "  function save(blob, name) {\n",
    "  function save(blob, name) {\n    if (window.DataBriefHost && window.DataBriefHost.save(blob, name)) return;\n"],
];

// A script or style written inside the page must not end its element early (the same care as build.ps1).
const inScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const inStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

// The page with the two patches made (LF text in, LF text out). Stops if an anchor is missing or found twice.
function patchPage(text) {
  let page = text;
  if (/DataBriefPage|DataBriefHost/.test(page)) throw new Error('databrief.html already mentions the widget hooks: it must stay the plain page');
  for (const [name, find, replace] of PATCHES) {
    const first = page.indexOf(find);
    if (first < 0 || page.indexOf(find, first + 1) >= 0) throw new Error('Patch "' + name + '": the text to patch is not found exactly once in databrief.html. The page changed: update PATCHES in tools/build-widget.cjs.');
    page = page.slice(0, first) + replace + page.slice(first + find.length);
  }
  return page;
}

function build() {
  const basePath = path.join(ROOT, 'databrief.html');
  if (!fs.existsSync(basePath)) throw new Error('databrief.html is missing: build it first (build.ps1)');
  const baseRaw = fs.readFileSync(basePath, 'utf8');
  const page = patchPage(lf(baseRaw));
  const version = JSON.parse(read('package.json')).version;
  const js = read('widget/widget.js').replace('__WIDGET_VERSION__', version);
  if (js.includes('__WIDGET_VERSION__')) throw new Error('widget.js lost its version placeholder');
  const layer = '<style id="databrief-widget-css">' + inStyle(read('widget/widget.css')) + '</style>\n' +
    '<script id="databrief-widget-i18n">' + inScript(read('widget/widget-i18n.js')) + '</script>\n' +
    '<script id="databrief-widget">' + inScript(js) + '</script>\n';
  const banner = '<!-- DataBrief widget ' + version + ': databrief.html (SHA-256 ' + sha(lf(baseRaw)) + ') with the widget layer of widget/ added. The layer does nothing outside a frame whose host speaks MCP Apps. -->\n';
  const at = page.lastIndexOf('</body>');
  if (at < 0) throw new Error('databrief.html has no </body>');
  return page.slice(0, at) + banner + layer + page.slice(at);
}

// Claude and ChatGPT keep a widget per address: a widget whose content changed needs a NEW address, and the old ones keep answering.
// mcp/uris.json records the SHA-256 of the page served at the current address; --new-address moves it to a new one when the page
// changed (tests/test_widget.cjs fails when the page and the record disagree).
const URIS = path.join(ROOT, 'mcp', 'uris.json');
function newAddress(html) {
  const uris = JSON.parse(fs.readFileSync(URIS, 'utf8'));
  const digest = sha(html);
  if (uris.widgetSha256 === digest) { console.log('The widget did not change: its address stays ' + uris.current); return; }
  const m = /widget-v(\d+)\.html$/.exec(uris.current || '');
  if (!m) throw new Error('mcp/uris.json: the current address does not end in widget-vN.html');
  const next = uris.current.replace(/widget-v\d+\.html$/, 'widget-v' + (Number(m[1]) + 1) + '.html');
  const out = { '//': uris['//'], current: next, previous: [uris.current].concat(uris.previous || []), widgetSha256: digest };
  fs.writeFileSync(URIS, JSON.stringify(out, null, 2) + '\n');
  console.log('New widget address ' + next + ' (the old ones still answer)');
}

function main() {
  const args = process.argv.slice(2);
  const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'dist', 'databrief-widget.html'));
  const html = build();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const bytes = Buffer.byteLength(html);
  console.log('Built ' + path.relative(process.cwd(), out) + ' (' + bytes.toLocaleString('en-US') + ' bytes, SHA-256 ' + sha(html) + ')');
  if (args.includes('--new-address')) newAddress(html);
}

if (require.main === module) main();
module.exports = { build, patchPage, PATCHES };
