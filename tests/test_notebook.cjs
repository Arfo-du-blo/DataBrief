#!/usr/bin/env node
/* Tests of the Jupyter notebook reader (src/notebook.js) in Node, without a browser.
 *   node tests/test_notebook.cjs
 * 1. The REAL notebooks of tests/v14-fixtures/ipynb-fixtures, executed by a real kernel (nbclient, pandas, Polars), against
 *    expected.json and against the data given to them in make_sources.py (the values below are written by hand from it).
 * 2. Hand-made notebooks and HTML (marked synthetic): R data frames, the JSON table pandas can add, nbformat 3, names taken
 *    from the code, limits; hostile input (unclosed tags and quotes, deep nesting, many tables) is read quickly or refused.
 * NB_SRC: another copy of the reader (used to check that these tests catch a broken reader). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'v14-fixtures');
const ctx = { console, TextDecoder, TextEncoder, Intl };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['src/util.js', process.env.NB_SRC || 'src/notebook.js']) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const DB = ctx.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = (x) => JSON.parse(JSON.stringify(x));   // out of the vm realm, for comparisons
const read = (...p) => JSON.parse(fs.readFileSync(path.join(FIX, ...p), 'utf8'));
const cols = (s) => s.columns.map((c) => c.name);
const nb = (cells, metadata) => ({ nbformat: 4, nbformat_minor: 5, metadata: metadata || {}, cells });
const code = (source, outputs, n) => ({ cell_type: 'code', execution_count: n === undefined ? 1 : n, metadata: {}, source, outputs: outputs || [] });
const result = (data) => ({ output_type: 'execute_result', execution_count: 1, metadata: {}, data });
const display = (data) => ({ output_type: 'display_data', metadata: {}, data });

/* ---------------------------------------------------------------- 1. real notebooks ---------- */
{
  const E = EXP.ipynb;
  const tree = read('ipynb-fixtures', 'analysis.ipynb');
  ok('analysis.ipynb is recognised as a notebook', DB.isNotebook(tree));
  const d = J(DB.notebookDoc(tree, 'analysis'));
  const c = d.contents;
  ok('cells counted (expected.json)', c.counts.cells === E.cells && c.counts.code === E.codeCells && c.counts.markdown === E.markdownCells, JSON.stringify(c.counts));
  const lang = (d.fileMeta.find((m) => m[0] === 'mKernel') || [])[1] || '';
  ok('kernel language (expected.json: ' + E.kernelLanguage + ')', lang.startsWith(E.kernelLanguage), lang);
  ok('nbformat version 4.5', same(d.fileMeta.find((m) => m[0] === 'mNbformat'), ['mNbformat', '4.5']), JSON.stringify(d.fileMeta));
  // the data frames of expected.json, named after the expression that showed them
  ok('one section per data frame, in order, named from the code', same(d.sections.map((s) => s.name), E.dataFrames.map((f) => f.name)), JSON.stringify(d.sections.map((s) => s.name)));
  E.dataFrames.forEach((f, i) => {
    const s = d.sections[i];
    if (!s) return ok('data frame ' + f.name, false, 'missing');
    ok('columns of ' + f.name + ' (the default row numbers are dropped)', same(cols(s), f.columns), JSON.stringify(cols(s)));
    ok('section ' + f.name + ' comes from cell ' + (f.cell + 1), s.cell === f.cell + 1, s.cell);
    if (f.rows) ok('rows of ' + f.name, s.rows.length === f.rows && !s.rowsTotal, s.rows.length + ' / ' + s.rowsTotal);
    if (f.trueRows) ok(f.name + ': the shortened table keeps its true size (' + f.footer + ')', s.rowsTotal === f.trueRows && s.rows.length === 10, s.rows.length + ' / ' + s.rowsTotal);
  });
  // the values, written by hand from make_sources.py (CUSTOMERS, ORDERS, big)
  const cust = d.sections[0];
  ok('customers: values with a comma and quotes, a newline, non-Latin text, an apostrophe', cust && same(cust.rows, [
    ['1', 'Ana Lima', 'PT', '2023-01-05', 'Prefers email, "never" calls'],
    ['2', 'Bo Chen', 'CN', '2023-03-17', '陈博\\nsecond line'],   // pandas shows a newline as the two characters \n: kept as stored
    ['3', 'Chloé Martin', 'FR', '2024-07-02', ''],
    ['4', "Dmitri O'Brien", 'IE', '2024-11-30', ''],      // None, shown "NaN" by pandas: missing
  ]), JSON.stringify(cust && cust.rows));
  ok('orders.head(2): the first two orders', same(d.sections[1] && d.sections[1].rows, [['10', '1', '19.9'], ['11', '1', '5.0']]), JSON.stringify(d.sections[1] && d.sections[1].rows));
  const big = d.sections[2];
  ok('big: first and last rows kept, the "..." row dropped', big && same(big.rows.slice(0, 2), [['0', '0'], ['1', '1']]) && same(big.rows[9], ['299', '89401']) && !big.rows.some((r) => r.includes('...')), JSON.stringify(big && big.rows));
  ok('a shortened table is flagged for the prompt', d.notes.nbShortened === true);
  // the other outputs: printed text, a Series (text only), an error
  const cell = (n) => c.cells.find((x) => x.n === n);
  ok('cell 3: printed "4", then the table', same(cell(3).outputs.map((o) => o.kind), ['stream', 'table']) && cell(3).outputs[0].text === '4' && cell(3).outputs[1].sec === 1, JSON.stringify(cell(3).outputs));
  ok('cell 4: ' + E.plainTextOnly.note + ' -> text, no section', same(cell(4).outputs.map((o) => o.kind), ['text']) && /customer_id[\s\S]*24\.90[\s\S]*Name: total/.test(cell(4).outputs[0].text), JSON.stringify(cell(4).outputs));
  ok('cell 6: the error (' + E.errors[0].name + ')', same(cell(6).outputs, [{ kind: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero' }]), JSON.stringify(cell(6).outputs));
  ok('Markdown cells keep their text', cell(1).type === 'markdown' && cell(1).source === '# Customer analysis\nA small notebook with **DataFrame outputs**.' && cell(7).source === 'Conclusion: *nothing* surprising.');
  ok('code is kept as written', cell(5).source === "big = pd.DataFrame({'n': range(300), 'sq': [i * i for i in range(300)]})\nbig" && cell(5).exec === 4, JSON.stringify(cell(5)));
  ok('the language of the code blocks', c.language === 'python');
}
{
  // the canary notebook: the expression that made the table holds values (a dict literal): never a section name
  const d = J(DB.notebookDoc(read('canary', 'CONFIDENTIAL_FILE_ipynb.ipynb'), 'x'));
  const s = d.sections[0];
  ok('canary: a table named after its cell, not after code holding values', d.sections.length === 1 && s.name === 'cell_2' && same(cols(s), ['id', 'CONFIDENTIAL_COL_A']) && s.rows.length === 6, JSON.stringify(d.sections.map((x) => [x.name, cols(x), x.rows.length])));
  ok('canary: printed text kept for the normal prompt (removed by "Do not share data" later)', d.contents.cells[2].outputs[0].text === 'CONFIDENTIAL_REC_PRINTED');
}
{
  // REAL output of pandas (named index, MultiIndex on rows and columns, too wide, display()), the pandas Styler and Polars
  const tree = read('ipynb-fixtures', 'shapes.ipynb');
  const d = J(DB.notebookDoc(tree, 'shapes'));
  const sec = (n) => d.sections.find((s) => s.name === n);
  const c = d.contents;
  const cell = (n) => c.cells.find((x) => x.n === n);
  // make_sources.py notebook_shapes(): sales = region, year, amount, qty: North 2023 10.5 3 / North 2024 12.0 4 / South 2023 7.25 2 / South 2024 9.0 5
  let s = sec('by_region');
  ok('named index (set_index): kept as a column with its name', s && same(cols(s), ['region', 'year', 'amount', 'qty']) && same(s.rows, [
    ['North', '2023', '10.50', '3'], ['North', '2024', '12.00', '4'], ['South', '2023', '7.25', '2'], ['South', '2024', '9.00', '5']]), JSON.stringify(s));
  s = sec('pivot');
  ok('MultiIndex columns (pivot_table): joined names, the index named', s && same(cols(s), ['region', 'amount / 2023', 'amount / 2024', 'qty / 2023', 'qty / 2024']) &&
    same(s.rows, [['North', '10.50', '12.0', '3', '4'], ['South', '7.25', '9.0', '2', '5']]), JSON.stringify(s));
  s = sec('two_levels');
  ok('MultiIndex rows: both levels as columns, the spanning cells repeated', s && same(cols(s), ['region', 'year', 'amount', 'qty']) && same(s.rows, [
    ['North', '2023', '10.50', '3'], ['North', '2024', '12.00', '4'], ['South', '2023', '7.25', '2'], ['South', '2024', '9.00', '5']]), JSON.stringify(s));
  s = sec('wide');
  const wideNames = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c20', 'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27', 'c28', 'c29'];
  ok('too wide: the "..." column dropped, 20 of 30 columns, all 3 rows', s && same(cols(s), wideNames) && s.rows.length === 3 && !s.rowsTotal &&
    same(s.rows[2], [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58].map(String)), JSON.stringify(s && [cols(s), s.rows]));
  const wideOut = cell(5).outputs.find((o) => o.kind === 'table');
  ok('too wide: the contents say 20 of 30 columns', wideOut && same(wideOut.colsCut, { a: 20, b: 30 }), JSON.stringify(cell(5).outputs));
  s = sec('cell_7');
  ok('pandas Styler (format(precision=1): a call with a value, so named after its cell): the values as shown', s && same(cols(s), ['region', 'year', 'amount', 'qty']) &&
    same(s.rows.map((r) => r[2]), ['10.5', '12.0', '7.2', '9.0']), JSON.stringify(s));
  s = sec('pl_sales');
  ok('Polars: the row of types as column metadata, text without its quotes', s && same(cols(s), ['region', 'amount']) && same(s.columns.map((x) => x.meta.dtype), ['str', 'f64']) &&
    same(s.rows, [['North', '22.5'], ['South', '16.25']]), JSON.stringify(s));
  ok('stderr and an image (with its text form)', same(cell(9).outputs.map((o) => o.kind + (o.stderr ? ':stderr' : '')), ['stream:stderr', 'text', 'image']) &&
    cell(9).outputs[0].text === 'careful: small sample' && cell(9).outputs[2].mime === 'image/png', JSON.stringify(cell(9).outputs));
  ok('a cell added after the run: never executed, no output', cell(10).exec === null && cell(10).outputs.length === 0 && cell(10).source === 'sales.describe()');
  ok('8 tables in all, none from the image cell', d.sections.length === 8 && c.counts.tables === 8, JSON.stringify(d.sections.map((x) => x.name)));
  ok('display() twice: two sections named after what was displayed', sec('first') && sec('second') && same(sec('first').rows, [['North', '2023', '10.5', '3']]) &&
    same(sec('second').rows, [['South', '2024', '9.0', '5']]), JSON.stringify(d.sections.map((x) => x.name)));
}

/* ---------------------------------------------------------------- 2. synthetic ---------- */
{
  // R (IRkernel) writes a caption with the true size and a row of types under the names (synthetic: no R kernel in the generator)
  const html = '<table class="dataframe">\n<caption>A data.frame: 120 × 2</caption>\n<thead>\n\t<tr><th></th><th scope=col>name</th><th scope=col>score</th></tr>\n' +
    '\t<tr><th></th><th scope=col>&lt;chr&gt;</th><th scope=col>&lt;dbl&gt;</th></tr>\n</thead>\n<tbody>\n\t<tr><th scope=row>1</th><td>Ann</td><td>1.5</td></tr>\n' +
    '\t<tr><th scope=row>2</th><td>Bob &amp; Co</td><td>NA</td></tr>\n</tbody>\n</table>\n';
  const d = J(DB.notebookDoc(nb([code('df', [result({ 'text/html': html, 'text/plain': 'x' })])], { kernelspec: { language: 'R', name: 'ir' }, language_info: { name: 'R', version: '4.4.1' } }), 'r'));
  const s = d.sections[0];
  ok('synthetic R data frame: types as column metadata, true size from the caption, "NA" kept as text', s && same(cols(s), ['name', 'score']) &&
    same(s.columns.map((x) => x.meta.dtype), ['chr', 'dbl']) && s.rowsTotal === 120 && same(s.rows, [['Ann', '1.5'], ['Bob & Co', 'NA']]) && !s.caption, JSON.stringify(s));
  ok('synthetic R: the language in lower case with its version', same(d.fileMeta[0], ['mKernel', 'r 4.4.1']), JSON.stringify(d.fileMeta));
}
{
  // the JSON table pandas adds with pd.set_option('display.html.table_schema', True) (synthetic)
  const res = { schema: { fields: [{ name: 'index', type: 'integer' }, { name: 'city', type: 'string' }, { name: 'n', type: 'integer' }], primaryKey: ['index'], pandas_version: '1.4.0' },
    data: [{ index: 0, city: 'Oslo', n: 3 }, { index: 1, city: 'Rome', n: null }] };
  const d = J(DB.notebookDoc(nb([code('counts', [result({ 'application/vnd.dataresource+json': res, 'text/html': '<table><tr><th>wrong</th></tr></table>' })])]), 'x'));
  ok('synthetic table schema JSON: preferred to the HTML, the default index dropped', d.sections.length === 1 && same(cols(d.sections[0]), ['city', 'n']) &&
    same(d.sections[0].rows, [['Oslo', '3'], ['Rome', '']]) && d.sections[0].name === 'counts', JSON.stringify(d.sections));
}
{
  // nbformat 3 (worksheets, input, prompt_number, pyout with short mime keys, pyerr, heading cells) (synthetic)
  const v3 = { nbformat: 3, nbformat_minor: 0, metadata: { name: 'old' }, worksheets: [{ cells: [
    { cell_type: 'heading', level: 2, source: ['Old notebook'] },
    { cell_type: 'code', language: 'python', input: ['df'], prompt_number: 3, outputs: [{ output_type: 'pyout', prompt_number: 3, html: ['<table><thead><tr><th></th><th>a</th></tr></thead><tbody><tr><th>0</th><td>1</td></tr><tr><th>1</th><td>2</td></tr></tbody></table>'], text: ['   a\n0  1'] }] },
    { cell_type: 'code', input: 'x', prompt_number: 4, outputs: [{ output_type: 'pyerr', ename: 'NameError', evalue: "name 'x' is not defined", traceback: [] }] },
  ] }] };
  ok('synthetic nbformat 3 is recognised', DB.isNotebook(v3));
  const d = J(DB.notebookDoc(v3, 'old'));
  ok('synthetic nbformat 3: heading, table from "pyout", error from "pyerr"', d.sections.length === 1 && same(cols(d.sections[0]), ['a']) && same(d.sections[0].rows, [['1'], ['2']]) &&
    d.contents.cells[0].source === '## Old notebook' && d.contents.cells[1].exec === 3 && d.contents.cells[2].outputs[0].ename === 'NameError', JSON.stringify(d));
}
{
  // names: only a plain expression names a table (values written in the code never become a name)
  const t = { 'text/html': '<table><thead><tr><th></th><th>v</th></tr></thead><tbody><tr><th>0</th><td>1</td></tr></tbody></table>' };
  const d = J(DB.notebookDoc(nb([
    code("df[df.name == 'Smith']", [result(t)]), code('df.describe()', [result(t)]), code('# comment\ndf  ', [result(t)]), code('df', [result(t)]),
    code('x = 1\nprint(x)', [display(t)]), code('df.head(3)\n# trailing comment', [result(t)]),
  ]), 'x'));
  ok('synthetic names: a filter with a value -> cell_1; plain expressions kept; a duplicate numbered', same(d.sections.map((s) => s.name),
    ['cell_1', 'df.describe()', 'df', 'df (2)', 'cell_5', 'df.head(3)']), JSON.stringify(d.sections.map((s) => s.name)));
}
{
  // HTML details (synthetic): entities, <br>, comments, a nested layout table, an index that is not row numbers
  const tabs = DB.htmlTables('<!-- <table><tr><td>no</td></tr></table> --><table><tr><th>a&amp;b</th><th>c</th></tr><tr><td>x&lt;y&#x41;&#128512;&nbsp;</td><td>1<br>2</td></tr></table>' +
    '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>');
  ok('synthetic htmlTables: entities, <br>, comments skipped; a table holding a table: only the inner one', tabs.length === 2 &&
    same(J(tabs[0].rows).map((r) => r.map((c) => c.v)), [['a&b', 'c'], ['x<yA😀', '1\n2']]) && J(tabs[1].rows)[0][0].v === 'inner', JSON.stringify(J(tabs)));
  const d = J(DB.notebookDoc(nb([code('s', [result({ 'text/html': '<table><thead><tr><th></th><th>n</th></tr></thead><tbody><tr><th>2024-01-01</th><td>5</td></tr><tr><th>2024-01-02</th><td>6</td></tr></tbody></table>' })])]), 'x'));
  ok('synthetic: an index that is not row numbers is kept as "index"', same(cols(d.sections[0]), ['index', 'n']) && same(d.sections[0].rows, [['2024-01-01', '5'], ['2024-01-02', '6']]), JSON.stringify(d.sections));
}
{
  // a notebook without any table: no section, the cells are still described
  const d = J(DB.notebookDoc(nb([{ cell_type: 'markdown', metadata: {}, source: 'Notes' }, code('print(1)', [{ output_type: 'stream', name: 'stdout', text: ['1\n'] }]),
    code('plot()', [display({ 'image/png': 'iVBOR', 'text/plain': '<Figure size 640x480 with 1 Axes>' })]), code('w', [display({ 'application/vnd.jupyter.widget-view+json': { model_id: 'x' } })]),
    code('later()', [], null)]), 'x'));
  ok('synthetic: no table -> no section, but contents', d.sections.length === 0 && d.contents.cells.length === 5);
  ok('synthetic: image (with its text) and an unknown output kind are listed', same(d.contents.cells[2].outputs.map((o) => o.kind), ['text', 'image']) &&
    d.contents.cells[2].outputs[1].mime === 'image/png' && same(d.contents.cells[3].outputs, [{ kind: 'other', mime: 'application/vnd.jupyter.widget-view+json' }]), JSON.stringify(d.contents.cells));
  ok('synthetic: a code cell never run has no execution count', d.contents.cells[4].exec === null && d.contents.counts.run === 3, JSON.stringify(d.contents.counts));
}
{
  // limits: long code and long outputs are cut (with the number of lines left out); ANSI colour codes removed
  const long = Array.from({ length: 100 }, (_, i) => 'line ' + i).join('\n');
  const d = J(DB.notebookDoc(nb([code(long, [{ output_type: 'stream', name: 'stdout', text: long }, { output_type: 'error', ename: '\u001b[31mValueError\u001b[0m', evalue: 'bad \u001b[1mvalue\u001b[0m', traceback: [] }])]), 'x'));
  const c = d.contents.cells[0];
  ok('limits: code cut at 60 lines (40 more), output at 30 lines (70 more)', c.source.split('\n').length === 60 && c.more === 40 && c.outputs[0].text.split('\n').length === 30 && c.outputs[0].more === 70, c.more + ' ' + c.outputs[0].more);
  ok('ANSI colour codes removed from errors', c.outputs[1].ename === 'ValueError' && c.outputs[1].evalue === 'bad value', JSON.stringify(c.outputs[1]));
  const one = J(DB.notebookDoc(nb([code('x'.repeat(10000))]), 'x')).contents.cells[0];
  ok('limits: a single very long line is cut by characters, marked "…"', one.source.length === 4001 && one.source.endsWith('…') && one.more === 1, one.source.length + ' ' + one.more);
}
{
  // more tables than read: listed, not read
  const t = { 'text/html': '<table><tr><th>a</th></tr><tr><td>1</td></tr></table>' };
  const d = J(DB.notebookDoc(nb(Array.from({ length: 205 }, () => code('t', [result(t)]))), 'x'));
  ok('limits: 200 tables read, 5 more listed as not read', d.sections.length === 200 && d.contents.cells[204].outputs[0].sec === -1 && d.notes.nbTablesCut === 200 && d.contents.counts.tables === 205);
  const many = J(DB.notebookDoc(nb(Array.from({ length: 450 }, () => code('1'))), 'x'));
  ok('limits: 400 cells described, the rest counted', many.contents.cells.length === 400 && many.contents.cellsCut === 50 && many.contents.counts.cells === 450);
}
{
  // not notebooks
  ok('not a notebook: plain JSON, an array, cells that are not a list', !DB.isNotebook({ cells: [] }) && !DB.isNotebook([{ nbformat: 4 }]) && !DB.isNotebook({ nbformat: 4, cells: 'x' }) && DB.notebookDoc({ a: 1 }) === null);
  const d = J(DB.notebookDoc(nb([null, 5, 'x', { cell_type: 'code', source: 7, outputs: [null, { output_type: 'execute_result', data: null }, { output_type: 'stream', text: 9 }] }]), 'x'));
  ok('damaged cells are skipped or read as empty, without an error', d.contents.counts.cells === 1 && d.contents.cells[0].source === '', JSON.stringify(d.contents));
}
{
  // hostile HTML: linear time
  const time = (fn) => { const t0 = Date.now(); fn(); return Date.now() - t0; };
  let ms = time(() => DB.htmlTables('<table><tr><td>' + '<a href="x'.repeat(200000)));
  ok('hostile: 200,000 unclosed tags with an open quote, read in under 2 s (' + ms + ' ms)', ms < 2000);
  ms = time(() => DB.htmlTables('<!--'.repeat(300000)));
  ok('hostile: 300,000 unclosed comments (' + ms + ' ms)', ms < 2000);
  ms = time(() => DB.htmlTables('<table>'.repeat(50000) + 'x' + '</table>'.repeat(50000)));
  ok('hostile: 50,000 nested tables (' + ms + ' ms)', ms < 2000);
  ms = time(() => DB.htmlTables('<table><tr>' + '<td rowspan="999999" colspan="999999">x</td>'.repeat(3) + '</tr></table>'));
  const big = DB.htmlTables('<table><tr><td rowspan="999999" colspan="999999">x</td></tr></table>');
  ok('hostile: huge spans are capped at 1000', J(big[0].rows)[0][0].cs === 1000 && ms < 2000, ms);
  const rows = '<tr><td>1</td></tr>'.repeat(1000);
  const capped = DB.htmlTables('<table>' + rows + '</table>', 100);
  ok('limits: rows beyond the limit are counted, not kept', capped[0].rows.length === 110 && capped[0].cut === 890, capped[0].rows.length + ' ' + capped[0].cut);
}

/* ---------------------------------------------------------------- review of v1.4 (stage 23): regression tests ---------- */
{
  const time = (fn) => { const t0 = Date.now(); fn(); return Date.now() - t0; };
  // spans multiply cells: 1000 rows of rowspan=1000 colspan=1000 (40 kB) must not build half a billion cells
  const bomb = '<table>' + '<tr><td rowspan=1000 colspan=1000>x</td></tr>'.repeat(1000) + '</table>';
  let r;
  let ms = time(() => { r = J(DB.notebookDoc(nb([code('t', [result({ 'text/html': bomb })])]), 'x')); });
  ok('review: a table of huge spans stays within its cell budget (' + ms + ' ms)', ms < 5000 && r.sections.length <= 1, ms);
  // 2,000 rows of 9,000 merged columns (18 million cells): the rows past the cell budget are left out, and counted
  const wide = '<table>' + ('<tr>' + '<td colspan=1000>x</td>'.repeat(9) + '</tr>').repeat(2000) + '</table>';
  ms = time(() => { r = J(DB.notebookDoc(nb([code('t', [result({ 'text/html': wide })])]), 'x')); });
  ok('review: a table past the cell budget keeps the rows within it and the true count (' + ms + ' ms)', r.sections[0] && r.sections[0].rows.length < 1000 && r.sections[0].rowsTotal >= 1999, r.sections[0] && [r.sections[0].rows.length, r.sections[0].rowsTotal]);
  // a row of <td> in the head that is not Polars types: a record, kept as data (never a column type)
  const t = '<table><thead><tr><th>name</th><th>city</th></tr><tr><td>Alice Martin</td><td>Paris</td></tr></thead><tbody><tr><td>Bob</td><td>Rome</td></tr></tbody></table>';
  r = J(DB.notebookDoc(nb([code('t', [result({ 'text/html': t })])]), 'x'));
  ok('review: a head row of records is data, not types', same(r.sections[0].rows, [['Alice Martin', 'Paris'], ['Bob', 'Rome']]) && r.sections[0].columns.every((c) => !c.meta.dtype), JSON.stringify(r.sections[0]));
  // quadratic patterns: a million line breaks, a long run of digits next to a table, many "<" without ">", many <style>
  ms = time(() => DB.notebookDoc(nb([code('\n'.repeat(1000000) + 'x', [{ output_type: 'stream', name: 'stdout', text: '\n'.repeat(1000000) + 'y' }])]), 'x'));
  ok('review: a million line breaks in code and output (' + ms + ' ms)', ms < 3000);
  ms = time(() => DB.notebookDoc(nb([code('t', [result({ 'text/html': '<table><tr><td>1</td></tr><tr><td>2</td></tr></table>' + '1'.repeat(200000) })])]), 'x'));
  ok('review: a long run of digits after a table (' + ms + ' ms)', ms < 2000);
  ms = time(() => DB.htmlTables('<a '.repeat(500000)));
  ok('review: 500,000 "<" without ">" (' + ms + ' ms)', ms < 3000);
  ms = time(() => DB.htmlTables('<style>x</style>'.repeat(20000) + 'y'.repeat(1000000)));
  ok('review: 20,000 <style> elements in a long output (' + ms + ' ms)', ms < 3000);
  // a table of 200,000 rows: no argument-spread limit
  const rows = '<tr><td>1</td><td>2</td></tr>'.repeat(200000);
  ms = time(() => { r = J(DB.notebookDoc(nb([code('big', [result({ 'text/html': '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody>' + rows + '</tbody></table>' })])]), 'x')); });
  ok('review: a table of 200,000 rows is read (' + ms + ' ms)', r.sections[0] && r.sections[0].rows.length === 200000, r.sections[0] && r.sections[0].rows.length);
  // nbformat 3 marks stderr with "stream"
  const v3 = { nbformat: 3, nbformat_minor: 0, metadata: {}, worksheets: [{ cells: [{ cell_type: 'code', input: 'x', prompt_number: 1, outputs: [{ output_type: 'stream', stream: 'stderr', text: 'warn' }] }] }] };
  ok('review: nbformat 3 stderr', J(DB.notebookDoc(v3, 'x')).contents.cells[0].outputs[0].stderr === true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
