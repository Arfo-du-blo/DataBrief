#!/usr/bin/env node
/* Tests of the command-line tool's reading core in Node, without a browser:
 *   node tests/test_core.cjs
 * cli/realm.cjs (the page's scripts in a separate realm), src/core.js (DB.prepare, DB.errorInfo) and cli/dom-shim.js (the
 * DOMParser for XML and HTML). That the prompts equal the page's is tests/test_cli_parity.cjs (Chrome); here: the realm
 * has nothing of Node, the options, the limits, the errors (no file content in "Do not share data"), the DOM features the
 * readers use, and hostile XML (entities, external files).
 * DATABRIEF_SRC_<NAME> (see cli/realm.cjs) replaces one script, to check that these tests catch a change. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const realmLib = require('../cli/realm.cjs');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 600) : '')); } };
const J = (x) => JSON.parse(JSON.stringify(x));
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

(async () => {
  const realm = realmLib.create();
  const ctx = realm.context;
  const inRealm = (code) => vm.runInContext(code, ctx);

  /* ---------------------------------------------------------------- 1. the realm ---------- */
  {
    const list = realmLib.scriptList().map((s) => s.file || 'wasm:' + s.wasm);
    ok('script list: the page order, without the interface, the tool additions last',
      !list.includes('src/app.js') && list.indexOf('src/util.js') < list.indexOf('src/parsers.js') && list.includes('wasm:vendor/sql-wasm.wasm') &&
      list.slice(-4).join() === 'vendor/xmldom.min.js,vendor/parse5.min.js,cli/dom-shim.js,src/core.js', list.join(' '));
    const noPdf = realmLib.scriptList({ pdf: false }).map((s) => s.file);
    ok('script list without the PDF reader (as the ESP32 page)', !noPdf.includes('vendor/pdfjs.min.js') && list.includes('vendor/pdfjs.min.js') && noPdf.length === list.length - 1);
    // (Buffer: vendor/mdb-reader.min.js sets its own, a plain-JavaScript copy, as in the page; never Node's)
    ok('realm: the Buffer there is mdb-reader\'s own, not Node\'s', inRealm('typeof Buffer') === 'function' && inRealm('Buffer') !== Buffer && inRealm('Buffer.from') !== Buffer.from);
    const kinds = J(inRealm(`({ require: typeof require, process: typeof process, module: typeof module, fetch: typeof fetch,
      XMLHttpRequest: typeof XMLHttpRequest, WebSocket: typeof WebSocket, EventSource: typeof EventSource, navigator: typeof navigator, importScripts: typeof importScripts })`));
    ok('realm: nothing of Node and no network API (require, process, fetch, XMLHttpRequest, WebSocket...)', Object.values(kinds).every((k) => k === 'undefined'), JSON.stringify(kinds));
    let evalBlocked = false;
    try { inRealm('eval("1 + 1")'); } catch (e) { evalBlocked = /code generation|EvalError/i.test(String(e)); }
    let fnBlocked = false;
    try { inRealm('new Function("return 1")()'); } catch (e) { fnBlocked = true; }
    ok('realm: no code from strings (eval, new Function), as the page\'s security policy', evalBlocked && fnBlocked);
    ok('realm: the readers are there (DB.parseFile, DB.prepare, DOMParser)', typeof realm.DB.parseFile === 'function' && typeof realm.DB.prepare === 'function' && typeof ctx.DOMParser === 'function');
    // the realm's code cannot write to Node's console by accident: its console is silent unless given one
    const logged = [];
    const loud = realmLib.create({ console: { log: (...a) => logged.push(a.join(' ')), info() {}, debug() {}, warn() {}, error() {} } });
    vm.runInContext('console.log("hello from the realm")', loud.context);
    ok('realm: its console goes where the tool says', logged[0] === 'hello from the realm');
  }

  /* ---------------------------------------------------------------- 2. DB.prepare ---------- */
  const CANARY = 'CANARY_RECORD_7731';
  const csv = Buffer.from('name,amount,city\n' + CANARY + ',12.5,Paris\nBob,8,Lyon\nCleo,3,Nice\nDan,4,Nice\n');
  {
    const r = await realm.prepare(csv, 'people.csv', {});
    ok('prepare: a CSV, data in the prompt', r.shared === true && r.md.includes(CANARY) && r.formatName === 'CSV' && r.fileName === 'people.csv' && r.tokens > 0 && r.large === null && r.files.length === 0, JSON.stringify(J(Object.assign({}, r, { md: r.md.slice(0, 80) }))));
    const n = await realm.prepare(csv, 'people.csv', { share: 'no' });
    ok('prepare: "Do not share data" leaves the records out and says so', n.shared === false && !n.md.includes(CANARY) && !n.md.includes('Bob') && /data not shared/.test(n.md));
    const nc = await realm.prepare(csv, 'people.csv', { share: 'no', csv: true });
    ok('prepare: "Do not share data" with the CSV files asked: the files hold the data, the prompt does not', nc.files.length === 1 && nc.files[0].name === 'people.csv' && nc.files[0].text.includes(CANARY) && !nc.md.includes(CANARY) && nc.md === n.md);
    const c = await realm.prepare(csv, 'people.csv', { csv: true });
    ok('prepare: the CSV files are the page\'s data files (all rows)', c.files.length === 1 && c.files[0].text.trim().split(/\r?\n/).length === 5 && /^name,amount,city/.test(c.files[0].text) && c.files[0].text.includes(CANARY + ',12.5,Paris'), JSON.stringify(c.files));
    for (const lvl of [1, 2, 3]) {
      const x = await realm.prepare(csv, 'people.csv', { share: 'no', level: lvl });
      ok('prepare: no-share level ' + lvl + ' has no record', !x.md.includes(CANARY) && !x.md.includes('Lyon'));
    }
    const l2 = await realm.prepare(csv, 'people.csv', { limit: 2 });
    ok('prepare: limit 2 rows', l2.md.includes(CANARY) && l2.md.includes('Bob') && !l2.md.includes('Cleo') && /\*\*Partial data:\*\*/.test(l2.md));
    const lf = await realm.prepare(csv, 'people.csv', { limit: 2, mode: 'files' });
    const ff = await realm.prepare(csv, 'people.csv', { mode: 'files' });
    ok('prepare: the limit is for inline mode only (as in the page)', lf.md === ff.md);
    const auto = await realm.prepare(csv, 'people.csv', { limit: 'auto' });
    ok('prepare: limit "auto" on a small file = the full prompt', auto.md === (await realm.prepare(csv, 'people.csv', {})).md);
    for (const bad of [0, -1, 1.5, 'x']) {
      const e = await errOf(() => realm.prepare(csv, 'people.csv', { limit: bad }));
      ok('prepare: limit ' + JSON.stringify(bad) + ' refused', !!e && /limit/.test(e.message));
    }
    const fr = await realm.prepare(csv, 'people.csv', { lang: 'fr' });
    ok('prepare: the prompt language', /Fichier/.test(fr.md) && fr.md !== (await realm.prepare(csv, 'people.csv', {})).md);
    const np = await realm.prepare(csv, 'people.csv', { profile: false });
    ok('prepare: without the data profile', !/## Data profile/.test(np.md) && /## Data profile/.test((await realm.prepare(csv, 'people.csv', {})).md));
    const sw = await realm.prepare(csv, 'people.csv', { share: 'no', sw: { names: false } });
    ok('prepare: a no-share switch (column names hidden)', !sw.md.includes('`amount`') && n.md.includes('`amount`'));
  }
  {
    // a large file: the page's warning size and its suggested limit
    let big = 'id,text,value\n';
    for (let i = 0; i < 30000; i++) big += i + ',some words for row number ' + i + ',' + (i * 1.5) + '\n';
    const r = await realm.prepare(Buffer.from(big), 'big.csv', {});
    ok('prepare: a large file reports its size and a suggested limit', !!r.large && r.large.tokens > 150000 && Number.isInteger(r.large.limit) && r.large.limit >= 1 && r.tokens === r.large.tokens, JSON.stringify(r.large));
    const a = await realm.prepare(Buffer.from(big), 'big.csv', { limit: 'auto' });
    ok('prepare: limit "auto" applies the suggestion: under the warning size (an estimate, as in the page)', a.tokens <= 150000 && a.tokens < r.tokens && a.large.limit === r.large.limit, a.tokens);
    const f = await realm.prepare(Buffer.from(big), 'big.csv', { mode: 'files' });
    ok('prepare: no size warning in files mode (as in the page)', f.large === null);
  }

  /* ---------------------------------------------------------------- 3. errors ---------- */
  {
    const e1 = await errOf(() => realm.prepare(Buffer.from('x'), 'data.xyz', {}));
    const i1 = realm.errorInfo(e1, false);
    ok('errors: an unsupported type, the page\'s text', i1.key === 'errUnsupported' && i1.message === 'This file type is not supported: .xyz', JSON.stringify(i1));
    const broken = Buffer.from('{"a": ' + CANARY + ' }');
    const e2 = await errOf(() => realm.prepare(broken, 'broken.json', {}));
    const shared = realm.errorInfo(e2, false), hidden = realm.errorInfo(e2, true);
    ok('errors: the technical detail is given when data may be shared', shared.key === 'errGeneric' && shared.detail.length > 0);
    ok('errors: no technical detail in "Do not share data" (it can quote the file)', hidden.key === 'errGeneric' && hidden.detail === '' && !JSON.stringify(hidden).includes('CANARY'), JSON.stringify(hidden));
    const fr = realm.errorInfo(e1, false, 'fr');
    ok('errors: the text in another interface language', /pris en charge/.test(fr.message));
    const noPdf = realmLib.create({ pdf: false });
    const pdf = fs.readFileSync(path.join(__dirname, 'v14-fixtures', 'doc-fixtures', 'deck.pdf'));
    const e3 = await errOf(() => noPdf.prepare(pdf, 'deck.pdf', {}));
    ok('errors: without the PDF reader a PDF gets the page\'s "recognised but not readable" message', e3 && e3.key === 'errKindPdf' && /PDF document/.test(noPdf.errorInfo(e3, false).message), e3 && e3.key);
    const r3 = await realm.prepare(pdf, 'deck.pdf', {});
    ok('a PDF with the PDF reader (pdf.js in Node)', /Pages/.test(r3.md) && /Sales review/.test(r3.md));
  }

  /* ---------------------------------------------------------------- 4. the DOM shim: HTML ---------- */
  {
    const html = (s) => new ctx.DOMParser().parseFromString(s, 'text/html');
    const d = html('<table id="t"><caption>Cap</caption><tfoot><tr><td>f</td></tr></tfoot><tbody><tr><td>b1</td></tr></tbody><thead><tr><th>h</th></tr></thead><tr><td>b2</td></tr></table>');
    const t = d.querySelector('table');
    ok('html: table.rows in the browser order (thead, then body rows, then tfoot)', Array.from(t.rows).map((r) => r.textContent).join() === 'h,b1,b2,f', Array.from(t.rows).map((r) => r.textContent).join());
    ok('html: tHead, caption, id, tagName', t.tHead && t.tHead.rows.length === 1 && t.caption.textContent === 'Cap' && t.id === 't' && t.rows[0].cells[0].tagName === 'TH');
    const spans = html('<table><tr><td rowspan="0" colspan="0">a</td><td rowspan="3x" colspan="2000">b</td><td rowspan="-2" colspan=" +3">c</td><td rowspan="99999">d</td></tr></table>').querySelector('table').rows[0].cells;
    ok('html: rowSpan / colSpan as browsers reflect them', spans.map((c) => c.rowSpan + '/' + c.colSpan).join() === '0/1,3/1000,1/3,65534/1', spans.map((c) => c.rowSpan + '/' + c.colSpan).join());
    const raw = html('<table><tr><td>x<template><table><tr><td>in template</td></tr></table></template><noscript><b>ns</b></noscript></td></tr></table>');
    ok('html: <template> contents are not searched, <noscript> is markup (scripting off, as DOMParser)', raw.querySelectorAll('table').length === 1 && raw.querySelectorAll('b').length === 1);
    let threw = false;
    try { raw.querySelectorAll('table > tr'); } catch (e) { threw = /unsupported selector/.test(e.message); }
    ok('html: a selector the shim does not know fails loudly (a reader change shows up in the tests)', threw);
    const cell = html('<table><tr><td>a<br>b<script>s</script></td></tr></table>').querySelector('table').rows[0].cells[0];
    const c = cell.cloneNode(true);
    for (const br of Array.from(c.querySelectorAll('br'))) br.replaceWith('\n');
    for (const s of Array.from(c.querySelectorAll('script'))) s.remove();
    ok('html: cloneNode / replaceWith / remove change the copy only', c.textContent === 'a\nb' && cell.textContent === 'abs', JSON.stringify([c.textContent, cell.textContent]));
    const foster = html('<table>loose<tr><td>x</td></tr></table>');
    ok('html: text in a table is moved before it (the browser algorithm)', foster.querySelector('table').textContent === 'x' && /loose/.test(foster.documentElement.textContent));
  }

  /* ---------------------------------------------------------------- 5. the DOM shim: XML, hostile XML ---------- */
  {
    const xml = (s) => new ctx.DOMParser().parseFromString(s, 'application/xml');
    const d = xml('<r xmlns:p="urn:p"><p:i a="1">x</p:i></r>');
    const i = d.documentElement.getElementsByTagName('p:i')[0];
    ok('xml: elements, prefixes, local names and attributes', d.documentElement.nodeName === 'r' && i.localName === 'i' && i.nodeName === 'p:i' && i.getAttribute('a') === '1' && i.textContent === 'x');
    for (const bad of ['<r><i></r>', '<r a="1" a="2"/>', '<a/><b/>', '', 'not xml']) {
      const p = xml(bad);
      ok('xml: an error gives a <parsererror> as in browsers: ' + JSON.stringify(bad), p.getElementsByTagName('parsererror').length === 1);
    }
    const passwd = fs.existsSync('/etc/passwd') ? 'root:' : 'C:\\';
    const ext = await realm.prepare(Buffer.from('<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xx SYSTEM "file:///etc/passwd">]><r><i>&xx;</i><i>2</i></r>'), 'ext.xml', {}).catch((e) => ({ md: 'error ' + (e.key || e.message) }));
    ok('xml: an external entity is never read (no file of the computer in the prompt)', !ext.md.includes(passwd) && !ext.md.includes('/bin/'), ext.md.slice(0, 300));
    let laughs = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa">';
    let prev = 'a';
    for (let k = 1; k <= 9; k++) { laughs += '<!ENTITY e' + k + ' "' + ('&' + prev + ';').repeat(10) + '">'; prev = 'e' + k; }
    laughs += ']><r><i>&' + prev + ';</i></r>';
    const t0 = Date.now();
    const bomb = await realm.prepare(Buffer.from(laughs), 'laughs.xml', {}).catch((e) => ({ md: 'error ' + (e.key || e.message) }));
    ok('xml: entities that expand a billion times are not expanded (fast, small)', Date.now() - t0 < 3000 && bomb.md.length < 20000, (Date.now() - t0) + ' ms, ' + bomb.md.length + ' chars');
    // the cap: 10 times the file plus 1 MB. 10 MB out of a small file is refused, 30 kB is read.
    const amp = (levels) => { let s = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "abcdefghij">'; let p = 'a'; for (let k = 1; k <= levels; k++) { s += '<!ENTITY e' + k + ' "' + ('&' + p + ';').repeat(10) + '">'; p = 'e' + k; } return s + ']><r><i>&' + p + ';</i><i>2</i></r>'; };
    const big = await realm.prepare(Buffer.from(amp(6)), 'amp6.xml', {}).then(() => 'read', (e) => realm.errorInfo(e, false).key);
    const small = await realm.prepare(Buffer.from(amp(3)), 'amp3.xml', {}).then((r) => r.md.includes('abcdefghij'.repeat(1000)) ? 'read' : 'read, not expanded', (e) => realm.errorInfo(e, false).key);
    ok('xml: an expansion over the cap is refused (10 MB from 1 kB), a small one is read', big === 'errGeneric' && small === 'read', big + ' / ' + small);
    const xml2 = (s) => new ctx.DOMParser().parseFromString(s, 'application/xml');
    ok('xml: an entity that refers to itself is an error, not a hang', xml2('<!DOCTYPE r [<!ENTITY a "&b;"><!ENTITY b "&a;">]><r>&a;</r>').getElementsByTagName('parsererror').length === 1);
    const dflt = xml2('<!DOCTYPE r [<!ATTLIST i k CDATA "d">]><r><i/><i k="x"/></r>').getElementsByTagName('i');
    ok('xml: attribute defaults of the DOCTYPE are filled in, given values kept', dflt[0].getAttribute('k') === 'd' && dflt[1].getAttribute('k') === 'x');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
