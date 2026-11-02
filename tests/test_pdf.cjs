#!/usr/bin/env node
/* Tests of the PDF reader (src/pdf.js with vendor/pdfjs.min.js) in Node.
 *   node tests/test_pdf.cjs
 * 1. The REAL PDFs of tests/v14-fixtures/doc-fixtures (LibreOffice Writer and Impress, Chrome) against expected.json and
 *    make_sources.py: the tables guessed from the text positions, the page text, the document properties.
 * 2. The layout (DB.pdfLayout) on hand-placed text (marked synthetic): justified paragraphs are not tables, right-aligned
 *    numbers stay in their column, wrapped cells join their row, a wide gap ends a table.
 * 3. A PDF without text (a scan), damaged PDFs: a result or a coded error, quickly.
 * pdf.js is run in this Node realm with minimal stand-ins for the browser classes it touches when it loads (it draws
 * nothing here). PDF_SRC: another copy of the reader (used to check that these tests catch a broken reader). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'v14-fixtures');
global.window = global;
global.DOMMatrix = class DOMMatrix { constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); } };
global.Path2D = class Path2D {};
global.ImageData = class ImageData {};
for (const f of ['src/util.js', 'vendor/pdfjs.min.js', process.env.PDF_SRC || 'src/pdf.js']) vm.runInThisContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), { filename: f });
const DB = global.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cols = (s) => s.columns.map((c) => c.name);
const meta = (r, k) => (r.fileMeta.find((m) => m[0] === k) || [])[1];
const read = (...p) => DB.parsePdf(new Uint8Array(fs.readFileSync(path.join(FIX, ...p))));
const errKey = async (fn) => { try { await fn(); return 'no error'; } catch (e) { return e && e.key ? e.key : 'raw: ' + (e && e.message); } };

(async () => {
  /* ---------------------------------------------------------------- 1. real PDFs ---------- */
  const E = EXP.pdf;
  {
    // Chrome printed one HTML table (make_v14_fixtures.sh): its columns sit close together
    const r = await read('doc-fixtures', 'orders-chrome.pdf');
    ok('Chrome PDF: the orders table guessed exactly (expected.json)', r.sections.length === 1 && same(cols(r.sections[0]), E.orders.header) && same(r.sections[0].rows, E.orders.rows), JSON.stringify(r.sections));
    ok('Chrome PDF: the text around it, and the guess noted for the prompt', same(r.contents.items[0].text, ['Orders\nPrinted by Chrome.']) && r.notes.pdfTables === true, JSON.stringify(r.contents));
  }
  {
    // LibreOffice Impress: the deck of make_sources.py, the table on page 2
    const r = await read('doc-fixtures', 'deck.pdf');
    ok('Impress PDF: 3 pages, the orders table on page 2 (expected.json)', r.contents.counts.pages === 3 && r.sections.length === 1 && r.sections[0].name === 'page2_table1' &&
      same(cols(r.sections[0]), E.orders.header) && same(r.sections[0].rows, E.orders.rows) && same(r.contents.items[1].tables, [0]), JSON.stringify(r.sections));
    ok('Impress PDF: the slide text in page order, a larger title marked as a heading', same(r.contents.items[0].text, ['Sales review', 'Q1 2025']) && r.contents.items[2].text[0] === '# Summary', JSON.stringify(r.contents.items));
    ok('Impress PDF: the author', meta(r, 'mDocAuthor') === 'Deck author', JSON.stringify(r.fileMeta));
  }
  {
    // LibreOffice Writer: the report with its 3 tables. Cells that wrap are joined with a space. (The Chinese name of
    // make_sources.py is not checked: LibreOffice had no Chinese font in the generator and wrote other glyphs.)
    const r = await read('doc-fixtures', 'report.pdf');
    const s = r.sections;
    ok('Writer PDF: 3 tables guessed', s.length === 3, s.length);
    ok('Writer PDF: the customers, wrapped cells joined', s[0] && same(cols(s[0]), ['id', 'name', 'country', 'signup', 'notes']) && s[0].rows.length === 4 &&
      same(s[0].rows.map((x) => x[1]), ['Ana Lima', 'Bo Chen', 'Chloé Martin', "Dmitri O'Brien"]) && s[0].rows[0][4] === 'Prefers email, "never" calls' && /second line$/.test(s[0].rows[1][4]), JSON.stringify(s[0]));
    ok('Writer PDF: the orders (expected.json)', s[1] && same(cols(s[1]), E.orders.header) && same(s[1].rows, E.orders.rows), JSON.stringify(s[1]));
    // its second header line sits at the usual row distance: kept as a row (in a PDF it cannot be told from a record)
    ok('Writer PDF: the merged header table, its second header line kept as a row', s[2] && same(cols(s[2]), ['Region', 'Quarter', 'column_3']) && same(s[2].rows, [['', 'Q1', 'Q2'], ['North', '10', '12']]), JSON.stringify(s[2]));
    const page = r.contents.items[0];
    ok('Writer PDF: the paragraphs around the tables, in page order', page.text.includes('Between the tables: some text.') && page.text.includes('Sales by region:') && page.text[page.text.length - 1] === 'Last paragraph, bold part' && same(page.tables, [0, 1, 2]), JSON.stringify(page));
    ok('Writer PDF: title and author', meta(r, 'mDocTitle') === 'Quarterly report' && meta(r, 'mDocAuthor') === 'Report author', JSON.stringify(r.fileMeta));
  }
  {
    for (const f of ['CONFIDENTIAL_FILE_pdf.pdf', 'CONFIDENTIAL_FILE_pdfslides.pdf']) {
      const r = await read('canary', f);
      ok('canary ' + f + ': the table with its records, the text and the author found (for "Do not share data" to filter)', r.sections.some((x) => cols(x).some((c) => /CONFIDENTIAL_COL/.test(c)) && /CONFIDENTIAL_REC/.test(JSON.stringify(x.rows))) &&
        /CONFIDENTIAL_TEXT/.test(JSON.stringify(r.contents)) && meta(r, 'mDocAuthor') === 'CONFIDENTIAL_TEXT_AUTHOR', JSON.stringify(r).slice(0, 300));
    }
  }

  /* ---------------------------------------------------------------- 2. the layout, synthetic ---------- */
  const T = (str, x, y, h) => ({ str, x, y, w: str.length * (h || 10) * 0.5, h: h || 10 });
  {
    // a table of 3 columns: numbers right-aligned under a left-aligned header, one cell that wraps
    const items = [T('name', 50, 700), T('city', 150, 700), T('amount', 250, 700),
      T('Ann', 50, 686), T('Oslo', 150, 686), T('5', 275, 686),
      T('Bob', 50, 672), T('Rio de', 150, 672), T('1234.5', 255, 672), T('Janeiro', 150, 660),
      T('Cy', 50, 646), T('Lima', 150, 646), T('12', 270, 646)];
    const f = DB.pdfLayout(items);
    ok('synthetic layout: a table with right-aligned numbers and a wrapped cell', f.length === 1 && f[0].k === 'table' &&
      same(f[0].rows, [['name', 'city', 'amount'], ['Ann', 'Oslo', '5'], ['Bob', 'Rio de Janeiro', '1234.5'], ['Cy', 'Lima', '12']]), JSON.stringify(f));
  }
  {
    // a justified paragraph: words placed one by one, with wide gaps that do not line up from one line to the next
    const words = (y, xs, ws) => xs.map((x, i) => ({ str: ws[i], x, y, w: ws[i].length * 5, h: 10 }));
    const items = words(700, [50, 95, 160, 230], ['Lorem', 'ipsum', 'dolor', 'sit'])
      .concat(words(686, [50, 120, 175, 225], ['consectetur', 'amet', 'elit', 'sed']))
      .concat(words(672, [50, 88, 150, 205], ['do', 'eiusmod', 'tempor', 'ut']));
    const f = DB.pdfLayout(items);
    ok('synthetic layout: a justified paragraph is text, not a table', f.length === 1 && f[0].k === 'p' && f[0].text.split('\n').length === 3, JSON.stringify(f));
  }
  {
    // two tables with a paragraph between them; a wide vertical gap also ends a table; one line of cells alone is not a table
    const items = [T('a', 50, 700), T('b', 150, 700), T('1', 50, 686), T('2', 150, 686),
      T('A sentence between the tables.', 50, 660),
      T('c', 50, 630), T('d', 150, 630), T('3', 50, 616), T('4', 150, 616),
      T('e', 50, 500), T('f', 150, 500)];
    const f = DB.pdfLayout(items);
    ok('synthetic layout: two tables, the text between them, a lonely line of cells as text', same(f.map((x) => x.k), ['table', 'p', 'table', 'p']) &&
      same(f[0].rows, [['a', 'b'], ['1', '2']]) && same(f[2].rows, [['c', 'd'], ['3', '4']]) && f[3].text === 'e f', JSON.stringify(f));
  }
  {
    // headings: clearly larger text; rotated or empty items are ignored by the reader, damaged numbers by the layout
    const items = [T('Report', 50, 760, 20), T('Body text line one', 50, 730), T('Body text line two', 50, 716), { str: 'x', x: NaN, y: 1, w: 1, h: 10 }, { str: 'y', x: 1, y: 1, w: 1, h: 0 }];
    const f = DB.pdfLayout(items);
    ok('synthetic layout: a heading, a paragraph, items without a position ignored', same(f, [{ k: 'h', text: 'Report' }, { k: 'p', text: 'Body text line one\nBody text line two' }]), JSON.stringify(f));
    const many = [];
    for (let i = 0; i < 200000; i++) many.push(T('w' + i, (i % 50) * 11, 800 - Math.floor(i / 50) * 0.01));
    const t0 = Date.now();
    DB.pdfLayout(many);
    ok('hostile layout: 200,000 overlapping items laid out quickly (' + (Date.now() - t0) + ' ms)', Date.now() - t0 < 10000);
  }

  /* ---------------------------------------------------------------- 3. no text, damaged files ---------- */
  {
    // a page without any text (what a scan looks like to a reader), written by hand
    const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
    const r = await DB.parsePdf(new Uint8Array(Buffer.from(pdf, 'latin1')));
    ok('synthetic PDF without text: read, no section, the prompt told there is no text', r.sections.length === 0 && r.notes.pdfNoText === true && r.contents.counts.pages === 1, JSON.stringify(r));
    ok('not a PDF: a coded error', (await errKey(() => DB.parsePdf(new Uint8Array(Buffer.from('%PDF-1.7 nothing else'))))) === 'errCorrupt');
    const real = new Uint8Array(fs.readFileSync(path.join(FIX, 'doc-fixtures', 'report.pdf')));
    let seed = 99, raw = 0, slow = 0;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const f = real.slice();
      for (let j = 0; j < 4; j++) f[rnd(f.length)] = rnd(256);
      const t1 = Date.now();
      if ((await errKey(() => DB.parsePdf(f))).startsWith('raw')) raw++;
      if (Date.now() - t1 > 3000) slow++;
    }
    ok('hostile: 60 damaged copies of a real PDF: read or a coded error, none slow (' + (Date.now() - t0) + ' ms)', raw === 0 && slow === 0, raw + ' raw, ' + slow + ' slow');
    ok('isPdf: the signature at the start; further in only for a .pdf or after binary bytes; a text mentioning it is not a PDF',
      DB.isPdf(new Uint8Array(Buffer.from('%PDF-1.4'))) && DB.isPdf(new Uint8Array(Buffer.from('\n\n%PDF-1.4')), 'pdf') && DB.isPdf(new Uint8Array(Buffer.from('\x00\x01junk%PDF-1.4', 'latin1'))) &&
      !DB.isPdf(new Uint8Array(Buffer.from('note,value\n%PDF-1.4 signature,1\n')), 'csv') && !DB.isPdf(new Uint8Array(Buffer.from('PDF report.csv'))));
  }
  {
    // review of v1.4 (stage 23): a grouped report keeps its rows (a first column left empty under a group, with numbers)
    const T2 = (str, x, y) => ({ str, x, y, w: str.length * 5, h: 10 });
    const f = DB.pdfLayout([T2('region', 50, 700), T2('city', 150, 700), T2('sales', 250, 700), T2('North', 50, 686), T2('Oslo', 150, 686), T2('10', 250, 686),
      T2('Bergen', 150, 672), T2('20', 250, 672), T2('South', 50, 658), T2('Rome', 150, 658), T2('30', 250, 658)]);
    ok('review: a grouped report keeps its rows', f.length === 1 && same(f[0].rows, [['region', 'city', 'sales'], ['North', 'Oslo', '10'], ['', 'Bergen', '20'], ['South', 'Rome', '30']]), JSON.stringify(f));
    const wide = [];
    for (let i = 0; i < 300; i++) { wide.push(T2('c' + i, i * 30, 700)); wide.push(T2('v' + i, i * 30, 686)); }
    ok('review: a line of 300 cells is not laid out as a table', !DB.pdfLayout(wide).some((x) => x.k === 'table'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + (e && e.stack)); process.exit(1); });
