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

  /* ---------------------------------------------------------------- 3b. stage 33b: richer reading ---------- */
  {
    // SQLite: a trigger and a full-text index, the file built here with the page's own SQLite (sql.js)
    const SQL = await ctx.initSqlJs({ wasmBinary: Buffer.from(ctx.DB_SQL_WASM, 'base64') });
    const db = new SQL.Database();
    db.run("CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT); CREATE TABLE log (id INTEGER PRIMARY KEY, order_id INTEGER, note TEXT);");
    db.run("INSERT INTO orders (status) VALUES ('open'), ('done');");
    db.run("CREATE TRIGGER orders_audit AFTER UPDATE OF status ON orders BEGIN INSERT INTO log (order_id, note) VALUES (NEW.id, 'SQL_TRIGGER_LITERAL'); END;");
    db.run("CREATE TRIGGER \"log guard\" BEFORE DELETE ON log BEGIN SELECT RAISE(ABORT, 'no'); END;");
    // FTS4 (in the page's SQLite: readable) and FTS5 (not in it: an FTS5 index made by another SQLite is named, not read; it is
    // declared here directly in the schema, as a full SQLite would have written it)
    db.run("CREATE VIRTUAL TABLE search USING fts4(body); INSERT INTO search (body) VALUES ('hello world');");
    db.run("PRAGMA writable_schema=ON; INSERT INTO sqlite_master VALUES('table','docs','docs',0,'CREATE VIRTUAL TABLE docs USING fts5(body)'); PRAGMA writable_schema=OFF;");
    db.run("CREATE TABLE docs_data(id INTEGER PRIMARY KEY, block BLOB); CREATE TABLE docs_idx(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID; CREATE TABLE docs_config(k PRIMARY KEY, v) WITHOUT ROWID;");
    const bytes = Buffer.from(db.export());
    db.close();
    const r = await realm.prepare(bytes, 'shop.sqlite', {});
    ok('sqlite: the triggers with when they run, on which table, and their SQL', /## Triggers/.test(r.md) && r.md.includes('### `orders_audit` · AFTER UPDATE ON `orders`') && r.md.includes('### `log guard` · BEFORE DELETE ON `log`') && r.md.includes('SQL_TRIGGER_LITERAL'), r.md.slice(r.md.indexOf('## Triggers'), r.md.indexOf('## Triggers') + 400));
    ok('sqlite: full-text indexes are named for what they are (FTS4 read, FTS5 named), their internal tables are left out', /Search indexes[^\n]*`search`: FTS4, `docs`: FTS5/.test(r.md) && !/`(search|docs)_(data|idx|content|docsize|config|segments|segdir|stat)`/.test(r.md) && /### \d+\. `search`/.test(r.md) && /hello world/.test(r.md), r.md.slice(0, 1800));
    const n = await realm.prepare(bytes, 'shop.sqlite', { share: 'no' });
    ok('sqlite, do not share: the triggers named with when they run, never their SQL', n.md.includes('- `orders_audit` · AFTER UPDATE ON `orders`') && !n.md.includes('SQL_TRIGGER_LITERAL'));
    const ns = await realm.prepare(bytes, 'shop.sqlite', { share: 'no', sw: { sql: true } });
    ok('sqlite, do not share with SQL allowed: the trigger\'s SQL', ns.md.includes('SQL_TRIGGER_LITERAL'));
    const nn = await realm.prepare(bytes, 'shop.sqlite', { share: 'no', sw: { names: false } });
    ok('sqlite, do not share without names: neutral trigger and table names', nn.md.includes('- `trigger_1` · AFTER UPDATE ON `table_1`') && !/orders_audit|`search`/.test(nn.md), nn.md.slice(nn.md.indexOf('## Triggers'), nn.md.indexOf('## Triggers') + 200));
  }
  {
    // Excel and ODS: the workbook's properties, never the author, the last editor, the manager or the company; comments
    // without their author. The files are written here with the page's own SheetJS.
    const X = ctx.XLSX;
    for (const bookType of ['xlsx', 'ods']) {
      const wb = X.utils.book_new();
      const ws = X.utils.aoa_to_sheet([['name', 'amount'], ['Ana', 1], ['Bo', 2]]);
      ws.A2.c = [{ a: 'SECRET_COMMENT_AUTHOR', t: 'checked twice' }];
      X.utils.book_append_sheet(wb, ws, 'Sales');
      wb.Props = { Title: 'Budget 2026', Subject: 'Planning', Keywords: 'budget, plan', Comments: 'Internal draft', Author: 'SECRET_AUTHOR', LastAuthor: 'SECRET_LAST', Manager: 'SECRET_MANAGER', Company: 'SECRET_COMPANY', CreatedDate: new Date(Date.UTC(2026, 0, 5)) };
      const bytes = Buffer.from(X.write(wb, { type: 'array', bookType }));
      const r = await realm.prepare(bytes, 'book.' + bookType, {});
      // (SheetJS writes no properties into an ODS file: for ODS only "never the author" is checked here)
      if (bookType === 'xlsx') ok('xlsx: the workbook\'s title, subject, keywords, description and date in the prompt', r.md.includes('**Title (document properties):** Budget 2026') && r.md.includes('Planning') && r.md.includes('budget, plan') && r.md.includes('Internal draft') && r.md.includes('2026-01-05'), r.md.slice(0, 900));
      ok(bookType + ': never the author, the last editor, the manager or the company, nor a comment\'s author', !/SECRET_/.test(r.md), (r.md.match(/SECRET_\w+/g) || []).join());
      if (bookType === 'xlsx') {
        ok('xlsx: the comment\'s text is kept', r.md.includes('checked twice'));
        const n = await realm.prepare(bytes, 'book.' + bookType, { share: 'no' });
        ok(bookType + ', do not share: the properties are free text (hidden by default)', !n.md.includes('Budget 2026') && (await realm.prepare(bytes, 'book.' + bookType, { share: 'no', sw: { text: true } })).md.includes('Budget 2026'));
      }
    }
  }
  {
    // HTML read as a document (the browser and the tool give the same contents: tests/test_cli_parity.cjs)
    const page = '<html><head><title>Report</title><meta name="author" content="SECRET_AUTHOR"></head><body><nav>menu</nav><h1>Intro</h1><p>First <b>para</b>.</p><table><tr><th>a</th></tr><tr><td>1</td></tr></table><p>After.</p></body></html>';
    const r = await realm.prepare(Buffer.from(page), 'page.html', {});
    ok('html: the page as a document, the table in its place, the navigation and the author left out', r.md.includes('**1 headings, 2 paragraphs, 1 tables**') && r.md.includes('> # Intro') && r.md.includes('> First para.') && r.md.includes('**[Table: section 1 `table_1`]**') && r.md.includes('> After.') && !/menu|SECRET_AUTHOR/.test(r.md) && r.md.includes('**Title (document properties):** Report'), r.md.slice(0, 1500));
    const t = await realm.prepare(Buffer.from('<html><body><h2>Only text</h2><p>No table here.</p></body></html>'), 'text.html', {});
    ok('html: a page without a table is read as a document (it was refused before)', t.md.includes('> ## Only text') && t.md.includes('> No table here.'));
    // writer metadata (Parquet, Arrow, Avro): keys that name a person or an organisation are left out, the others kept. An
    // Arrow file written here with the page's own flechette, its schema carrying such keys.
    {
      const F = ctx.flechette;
      const tbl = F.tableFromArrays({ id: [1, 2], amount: [1.5, 2.5] });
      tbl.schema.metadata = new Map([['owner', 'SECRET_OWNER_TEAM'], ['contact_email', 'SECRET_MAIL'], ['note', 'kept note']]);
      const bytes = Buffer.from(F.tableToIPC(tbl, { format: 'file' }));
      const ar = await realm.prepare(bytes, 'meta.arrow', {}).then((x) => x.md, (e2) => 'error ' + (e2.key || e2.message));
      ok('writer metadata: "owner" and "contact_email" left out, "note" kept', ar.includes('kept note') && !/SECRET_/.test(ar), (ar.match(/.*(SECRET_|kept note|error).*/) || [ar.slice(0, 200)])[0]);
    }
    // a GeoPackage (GDAL): its spatial index, metadata tables and bookkeeping triggers (feature counts) are machinery
    const gp = await realm.prepare(fs.readFileSync(path.join(__dirname, 'v14-fixtures', 'geo-fixtures', 'city.gpkg')), 'city.gpkg', {});
    ok('gpkg: no GeoPackage machinery (gpkg_ / rtree_ tables, GDAL\'s feature-count triggers, the spatial index)', !/gpkg_|rtree_|## Triggers|feature_count|Search indexes/.test(gp.md), (gp.md.match(/.*(gpkg_|rtree_|Triggers|feature_count).*/) || [''])[0]);
    const e = await realm.prepare(Buffer.from('<html><body>   </body></html>'), 'empty.html', {}).then(() => 'read', (x) => x.key);
    ok('html: a page with nothing to read is still refused', e === 'errNoTable', e);
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
    // the cap: 10 times the file plus 100 kB (as browsers: the 300 kB "laughs" file is refused, 10 kB is read). 10 MB is refused.
    const amp = (levels) => { let s = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "abcdefghij">'; let p = 'a'; for (let k = 1; k <= levels; k++) { s += '<!ENTITY e' + k + ' "' + ('&' + p + ';').repeat(10) + '">'; p = 'e' + k; } return s + ']><r><i>&' + p + ';</i><i>2</i></r>'; };
    const big = await realm.prepare(Buffer.from(amp(6)), 'amp6.xml', {}).then(() => 'read', (e) => realm.errorInfo(e, false).key);
    const small = await realm.prepare(Buffer.from(amp(3)), 'amp3.xml', {}).then((r) => r.md.includes('abcdefghij'.repeat(1000)) ? 'read' : 'read, not expanded', (e) => realm.errorInfo(e, false).key);
    ok('xml: an expansion over the cap is refused (10 MB from 1 kB), a small one is read', big === 'errGeneric' && small === 'read', big + ' / ' + small);
    // stage 33 review: work that produces no text is counted too (entities that expand to nothing, nested), and the DOCTYPE
    // and ATTLIST scans take linear time (they used regular expressions that backtracked for minutes)
    const timed = async (name, xml, maxMs) => {
      const t = Date.now();
      const r = await realm.prepare(Buffer.from(xml), name, {}).then(() => 'read', (e) => realm.errorInfo(e, false).key);
      return { ms: Date.now() - t, r };
    };
    let empty = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e0 "">';
    for (let k = 1; k <= 12; k++) empty += '<!ENTITY e' + k + ' "' + ('&e' + (k - 1) + ';').repeat(10) + '">';
    empty += ']><r><a>1</a><a>&e12;</a></r>';
    const t1 = await timed('empty.xml', empty);
    ok('xml: nested entities that expand to nothing (a billion-laughs of empty text) take no time (' + t1.ms + ' ms, ' + t1.r + ')', t1.ms < 3000);
    const t2 = await timed('spaces.xml', '<!DOCTYPE' + ' '.repeat(400000) + 'x>');
    const t3 = await timed('quotes.xml', '<!DOCTYPE r "'.repeat(60000));
    const t4 = await timed('attlist.xml', '<!DOCTYPE r [<!ATTLIST r ' + 'a'.repeat(400000) + '>]><r/>');
    ok('xml: a DOCTYPE with 400,000 spaces, 60,000 quotes, an ATTLIST with a 400,000-character name: each read or refused at once (' + [t2.ms, t3.ms, t4.ms].join(' / ') + ' ms)', t2.ms < 3000 && t3.ms < 3000 && t4.ms < 3000);
    const deep = '<table><tr><th>c</th></tr><tr><td>' + '<div>'.repeat(200000) + 'x</td></tr></table>';
    const t5 = await (async () => { const t = Date.now(); const r = await realm.prepare(Buffer.from(deep), 'deep.html', {}).then(() => 'read', (e) => realm.errorInfo(e, false).key); return { ms: Date.now() - t, r }; })();
    ok('html: 200,000 nested elements: refused at once (parse5 would take minutes; ' + t5.ms + ' ms)', t5.ms < 5000 && t5.r === 'errGeneric', t5.r);
    const cellDeep = '<table><tr><th>c</th></tr><tr><td>' + '<span>'.repeat(4900) + 'deep value' + '</span>'.repeat(4900) + '</td></tr></table>';
    const r6 = await realm.prepare(Buffer.from(cellDeep), 'cell.html', {}).then((x) => x.md, (e) => 'error ' + realm.errorInfo(e, false).key);
    ok('html: a cell 4,900 levels deep is read (the copy of a cell does not recurse)', /deep value/.test(r6), r6.slice(0, 120));
    const xml2 = (s) => new ctx.DOMParser().parseFromString(s, 'application/xml');
    ok('xml: an entity that refers to itself is an error, not a hang', xml2('<!DOCTYPE r [<!ENTITY a "&b;"><!ENTITY b "&a;">]><r>&a;</r>').getElementsByTagName('parsererror').length === 1);
    const dflt = xml2('<!DOCTYPE r [<!ATTLIST i k CDATA "d">]><r><i/><i k="x"/></r>').getElementsByTagName('i');
    ok('xml: attribute defaults of the DOCTYPE are filled in, given values kept', dflt[0].getAttribute('k') === 'd' && dflt[1].getAttribute('k') === 'x');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
