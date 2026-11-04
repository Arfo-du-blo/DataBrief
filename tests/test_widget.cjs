#!/usr/bin/env node
/* The widget layer without a browser (widget/ and tools/build-widget.cjs).   node tests/test_widget.cjs
 * Checks: the texts (15 languages, the same keys and placeholders as English, no key unused or missing in the code); the build
 * (anchors found exactly once, reproducible, databrief.html untouched, the layer inserted once); and what the layer must never do
 * (no network call, no eval, inert outside a frame). The behaviour in a real browser, with fake hosts: tests/test_widget_browser.cjs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { build, patchPage, PATCHES } = require('../tools/build-widget.cjs');

const ROOT = path.join(__dirname, '..');
let failed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } else console.log('ok   ' + name); };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* ---------- the texts ---------- */
const sandbox = { window: {} };
vm.runInNewContext(read('widget/widget-i18n.js'), sandbox);
const I = sandbox.window.DB_WIDGET_I18N;
const LANGS = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'zh', 'ja', 'ko', 'hi', 'ar'];
const pageLangs = [...read('src/i18n.js').matchAll(/code:\s*'([a-z]{2})'/g)].map((m) => m[1]);
check('the widget has the page\'s 15 languages, and no other', JSON.stringify(Object.keys(I).sort()) === JSON.stringify(LANGS.slice().sort()) && (!pageLangs.length || JSON.stringify([...new Set(pageLangs)].sort()) === JSON.stringify(LANGS.slice().sort())), Object.keys(I).join());
const keys = Object.keys(I.en);
check('English has 44 keys', keys.length === 44, String(keys.length));
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
for (const code of LANGS) {
  const t = I[code];
  const sameKeys = JSON.stringify(Object.keys(t)) === JSON.stringify(keys);
  const allText = keys.every((k) => typeof t[k] === 'string' && t[k].trim().length > 0 && !/\n/.test(t[k]));
  const samePh = keys.every((k) => ph(t[k]) === ph(I.en[k]));
  check(code + ': same keys in the same order, every text filled', sameKeys && allText);
  check(code + ': the placeholders are the ones of English', samePh, keys.filter((k) => ph(t[k]) !== ph(I.en[k])).join());
  if (code !== 'en') check(code + ': not a copy of English', keys.filter((k) => t[k] === I.en[k]).length <= 3, keys.filter((k) => t[k] === I.en[k]).join());
}
const js = read('widget/widget.js');
const literals = new Set([...js.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
check('every text key is used by the code (no dead text)', keys.every((k) => literals.has(k)), keys.filter((k) => !literals.has(k)).join());
const used = new Set([...js.matchAll(/\bT\('([A-Za-z]+)'/g)].map((m) => m[1]));
for (const m of js.matchAll(/(?:done|fail)\('([A-Za-z]+)'\)/g)) used.add(m[1]);
for (const m of js.matchAll(/mkBtn\('[^']+',\s*'[^']*',\s*'([A-Za-z]+)'/g)) used.add(m[1]);
for (const m of js.matchAll(/T\(hk === 'fill' \? '([A-Za-z]+)' : \(hk === 'send' \? '([A-Za-z]+)' : '([A-Za-z]+)'\)\)/g)) { used.add(m[1]); used.add(m[2]); used.add(m[3]); }
check('every key the code asks for exists', [...used].every((k) => keys.includes(k)), [...used].filter((k) => !keys.includes(k)).join());
check('the lines written in the message box are in every language, with the {q} where it belongs', LANGS.every((c) => I[c].lineAsk.includes('{q}') && I[c].askBundle.includes('{q}') && !I[c].lineRead.includes('{')));
check('the lines written in the message box carry no internal tool name (they read like something a person would write)', LANGS.every((c) => !/read_widget_context|_/.test(I[c].lineRead + I[c].lineAsk + I[c].askBundle)) && !('lineReadFill' in I.en) && !('lineAskFill' in I.en));

/* ---------- the build ---------- */
const basePath = path.join(ROOT, 'databrief.html');
const before = sha(fs.readFileSync(basePath));
const out1 = build();
const out2 = build();
check('the build is reproducible', out1 === out2);
check('databrief.html is not changed by the build', sha(fs.readFileSync(basePath)) === before);
const base = fs.readFileSync(basePath, 'utf8').replace(/\r\n?/g, '\n');
check('the plain page does not mention the widget hooks', !/DataBriefPage|DataBriefHost|databrief-widget/.test(base));
for (const [name, find] of PATCHES) {
  check('anchor "' + name + '" is found exactly once in the page', base.split(find).length === 2);
}
check('the layer is inserted once each (style, texts, code, banner)', ['id="databrief-widget-css"', 'id="databrief-widget-i18n"', 'id="databrief-widget"', '<!-- DataBrief widget '].every((s) => out1.split(s).length === 2));
check('the hooks are in the copy once each', out1.split('window.DataBriefPage = ').length === 2 && out1.split('window.DataBriefHost.save(blob, name)) return;').length === 2);
check('the banner states the SHA-256 of the page it was made from', out1.includes(sha(base)));
const urisRec = JSON.parse(read('mcp/uris.json'));
check('the widget served at the current address is this build (a changed widget needs: node tools/build-widget.cjs --new-address)', urisRec.widgetSha256 === sha(out1), 'recorded ' + String(urisRec.widgetSha256).slice(0, 12) + ', built ' + sha(out1).slice(0, 12));
check('the copy is the page plus the layer (the page\'s text is otherwise intact)', out1.length > base.length && out1.length - base.length < 120000, String(out1.length - base.length));
const inLayer = out1.slice(out1.lastIndexOf('<!-- DataBrief widget '));
check('the layer comes before the last </body>', /<\/body>\s*<\/html>\s*$/.test(out1) && inLayer.indexOf('</body>') > inLayer.indexOf('id="databrief-widget"'));
let msg = '';
try { patchPage('<html>nothing to patch</html>'); } catch (e) { msg = e.message; }
check('a page without the anchors stops the build with a clear message', /not found exactly once/.test(msg));
msg = '';
try { patchPage(base + base); } catch (e) { msg = e.message; }
check('a page where an anchor appears twice stops the build', /not found exactly once/.test(msg));
msg = '';
try { patchPage(base + '\nwindow.DataBriefPage = 1;'); } catch (e) { msg = e.message; }
check('a page that already has the hooks is refused', /already mentions/.test(msg));
check('the layer\'s own script parses', (() => { try { new Function(js.replace('__WIDGET_VERSION__', '0')); return true; } catch (e) { return false; } })());
check('the injected script is cut at no </script', !/<\/script/i.test(js) && !/<\/script/i.test(read('widget/widget-i18n.js')) && !/<\/style/i.test(read('widget/widget.css')));

/* ---------- what the layer must never do ---------- */
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('the layer makes no network call', !/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/.test(code) && !/https?:\/\//.test(code));
check('the layer uses no eval and no dynamic code', !/\beval\(|new Function\(|setTimeout\(\s*['"`]/.test(code));
check('the layer sets no cookie and stores nothing', !/document\.cookie|localStorage|sessionStorage|indexedDB/.test(code));
check('the layer does nothing when the page is not in a frame', /if \(window\.parent === window\) return;/.test(js));
check('the layer listens to the host only (messages from other windows are ignored)', /e\.source !== window\.parent\) return;/.test(js));
check('the layer shows only what the host says it supports', /caps\(\)\.message/.test(js) && /caps\(\)\.updateModelContext/.test(js) && /caps\(\)\.downloadFile/.test(js) && /caps\(\)\.openLinks/.test(js));
check('styles and texts carry no outside address', !/https?:\/\//.test(read('widget/widget.css')) && !/https?:\/\//.test(read('widget/widget-i18n.js')));

console.log('\n' + (total - failed) + '/' + total + ' passed');
process.exit(failed ? 1 : 0);
