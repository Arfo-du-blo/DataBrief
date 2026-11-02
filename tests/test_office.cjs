#!/usr/bin/env node
/* Tests of the Word / PowerPoint / OpenDocument reader (src/office.js) in Node.
 *   node tests/test_office.cjs
 * 1. The REAL files of tests/v14-fixtures/doc-fixtures (python-docx, python-pptx, and LibreOffice's own .docx, .pptx, .odt,
 *    .odp) against expected.json and make_sources.py: the tables as data, the rest as context, the document properties.
 * 2. Synthetic files (marked synthetic: XML written here, zipped with fflate) for what the real files do not hold: vertical
 *    merges, header rows marked by the file, tracked changes, a localised heading style, an unusual namespace prefix,
 *    DOCTYPE entities (never expanded), PowerPoint merged cells; hostile sizes and nesting.
 * OFFICE_SRC: another copy of the reader (used to check that these tests catch a broken reader). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'v14-fixtures');
const ctx = { console, TextDecoder, TextEncoder, Intl };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['src/util.js', 'vendor/fflate.min.js', process.env.OFFICE_SRC || 'src/office.js']) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const DB = ctx.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = (x) => JSON.parse(JSON.stringify(x));
const read = (dir, f, kind) => J(DB.parseOffice(new Uint8Array(fs.readFileSync(path.join(FIX, dir, f))), kind));
const cols = (s) => s.columns.map((c) => c.name);
const errKey = (fn) => { try { fn(); return 'no error'; } catch (e) { return e && e.key ? e.key : 'raw: ' + (e && e.message); } };
const time = (fn) => { const t0 = Date.now(); fn(); return Date.now() - t0; };
const meta = (r, k) => (r.fileMeta.find((m) => m[0] === k) || [])[1];

/* ---------------------------------------------------------------- 1. real documents ---------- */
{
  const E = EXP.docx;
  // by hand from make_sources.py: CUSTOMERS (None -> empty), ORDERS, the merged "Quarter" header
  const CUST = [['1', 'Ana Lima', 'PT', '2023-01-05', 'Prefers email, "never" calls'], ['2', 'Bo Chen', 'CN', '2023-03-17', '陈博\nsecond line'],
    ['3', 'Chloé Martin', 'FR', '2024-07-02', ''], ['4', "Dmitri O'Brien", 'IE', '2024-11-30', '']];
  const ORD = [['10', '1', '19.90', 'paid'], ['11', '1', '5.00', 'refunded'], ['12', '2', '120.00', 'paid'], ['13', '4', '42.42', 'pending']];
  for (const [f, kind, writer] of [['report.docx', 'docx', 'python-docx'], ['report-libreoffice.docx', 'docx', 'LibreOffice'], ['report.odt', 'odt', 'LibreOffice']]) {
    const r = read('doc-fixtures', f, kind);
    const s = r.sections;
    ok(f + ' (' + writer + '): 3 tables (expected.json)', s.length === 3, s.length);
    ok(f + ': table 1, the customers (a newline in a cell, an empty cell)', s[0] && same(cols(s[0]), E.tables[0].header) && same(s[0].rows, CUST) && s[0].rows[E.tables[0].cell.row - 1][4] === E.tables[0].cell.value, JSON.stringify(s[0]));
    ok(f + ': table 2, the orders', s[1] && same(cols(s[1]), E.tables[1].header) && same(s[1].rows, ORD), JSON.stringify(s[1]));
    ok(f + ': table 3, a header cell merged over two columns ("Quarter / Q1", "Quarter / Q2")', s[2] && same(cols(s[2]), ['Region', 'Quarter / Q1', 'Quarter / Q2']) && same(s[2].rows, [['North', '10', '12']]), JSON.stringify(s[2]));
    const it = r.contents.items;
    ok(f + ': headings in order (expected.json)', same(it.filter((x) => x.k === 'h').map((x) => x.text), E.headings) && same(it.filter((x) => x.k === 'h').map((x) => x.level), [1, 2]), JSON.stringify(it));
    ok(f + ': the paragraphs and tables in document order', same(it.map((x) => x.k), ['h', 'p', 'h', 'table', 'p', 'table', 'p', 'table', 'p']) && it[8].text === 'Last paragraph, bold part', JSON.stringify(it.map((x) => x.k)));
    ok(f + ': the document properties (expected.json)', meta(r, 'mDocTitle') === E.metadata.title && meta(r, 'mDocAuthor') === E.metadata.author, JSON.stringify(r.fileMeta));
    ok(f + ': merged cells noted for the prompt', r.notes.spans === true);
  }
  const app = (f, kind) => meta(read('doc-fixtures', f, kind), 'mDocApp');
  ok('the application without its build details', app('report-libreoffice.docx', 'docx') === 'LibreOffice/25.2.3.2' && app('report.odt', 'odt') === 'LibreOffice/25.2.3.2', app('report-libreoffice.docx', 'docx'));
}
{
  const E = EXP.pptx;
  for (const [f, kind] of [['deck.pptx', 'pptx'], ['deck-libreoffice.pptx', 'pptx'], ['deck.odp', 'odp']]) {
    const r = read('doc-fixtures', f, kind);
    const sl = r.contents.items;
    ok(f + ': ' + E.slides + ' slides with their titles (expected.json)', r.contents.kind === 'slides' && same(sl.map((s) => s.title), E.slideTitles), JSON.stringify(sl));
    ok(f + ': the table of slide ' + E.tables[0].slide + ' as data', r.sections.length === 1 && r.sections[0].name === 'slide2_table1' && same(cols(r.sections[0]), E.tables[0].header) &&
      r.sections[0].rows.length === E.tables[0].rows && same(sl[1].tables, [0]), JSON.stringify(r.sections));
    ok(f + ': speaker notes (expected.json)', sl[E.notes.slide - 1].notes === E.notes.text && !sl[0].notes, JSON.stringify(sl.map((s) => s.notes)));
    ok(f + ': slide text, one line per paragraph', same(sl[0].text, ['Q1 2025']) && same(sl[2].text, ['Three points\nwithout a table']), JSON.stringify(sl.map((s) => s.text)));
    ok(f + ': the author (expected.json)', meta(r, 'mDocAuthor') === E.metadata.author, JSON.stringify(r.fileMeta));
  }
}
{
  // the canaries: tables, text and properties are found (the "Do not share data" rules are tested in the browser)
  for (const [f, kind] of [['CONFIDENTIAL_FILE_docx.docx', 'docx'], ['CONFIDENTIAL_FILE_odt.odt', 'odt'], ['CONFIDENTIAL_FILE_pptx.pptx', 'pptx'], ['CONFIDENTIAL_FILE_odp.odp', 'odp']]) {
    const r = read('canary', f, kind);
    const all = JSON.stringify(r);
    ok('canary ' + f + ': the table with its records, the text and the author', r.sections[0] && cols(r.sections[0]).includes('CONFIDENTIAL_COL_A') && /CONFIDENTIAL_REC_01/.test(JSON.stringify(r.sections[0].rows)) &&
      /CONFIDENTIAL_TEXT_TITLE/.test(JSON.stringify(r.contents)) && meta(r, 'mDocAuthor') === 'CONFIDENTIAL_TEXT_AUTHOR', all.slice(0, 400));
  }
}

/* ---------------------------------------------------------------- 2. synthetic files ---------- */
// the synthetic files are zipped by a copy of fflate in THIS realm (inside the sandbox, fflate would see Node's TextEncoder
// output as a foreign Uint8Array and write every file as a folder)
const fflate = require(path.join(ROOT, 'vendor/fflate.min.js'));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body, extra) => {
  const files = { 'word/document.xml': fflate.strToU8('<?xml version="1.0"?><w:document ' + W + '><w:body>' + body + '</w:body></w:document>'), '[Content_Types].xml': fflate.strToU8('<Types/>') };
  Object.assign(files, extra || {});
  return fflate.zipSync(files);
};
const P = (t, style) => '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + '<w:r><w:t>' + t + '</w:t></w:r></w:p>';
const TC = (t, pr) => '<w:tc>' + (pr ? '<w:tcPr>' + pr + '</w:tcPr>' : '') + P(t) + '</w:tc>';
const parse = (u8, kind) => J(DB.parseOffice(u8, kind || 'docx'));
{
  // a header row marked by the file (w:tblHeader), a cell merged down (vMerge), tracked changes, a content control
  const tbl = '<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>' + TC('city') + TC('year') + TC('n') + '</w:tr>' +
    '<w:tr>' + TC('Oslo', '<w:vMerge w:val="restart"/>') + TC('2023') + TC('1') + '</w:tr>' +
    '<w:tr>' + TC('', '<w:vMerge/>') + TC('2024') + TC('2') + '</w:tr></w:tbl>';
  const r = parse(docx('<w:sdt><w:sdtContent>' + tbl + '</w:sdtContent></w:sdt>' +
    '<w:p><w:r><w:t>kept </w:t></w:r><w:del><w:r><w:delText>deleted </w:delText></w:r></w:del><w:ins><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>'));
  ok('synthetic Word: a marked header row, a cell merged down repeated, inside a content control', r.sections.length === 1 && same(cols(r.sections[0]), ['city', 'year', 'n']) &&
    same(r.sections[0].rows, [['Oslo', '2023', '1'], ['Oslo', '2024', '2']]), JSON.stringify(r.sections));
  ok('synthetic Word: tracked changes, the deleted text left out and the inserted text read', r.contents.items[1].text === 'kept inserted', JSON.stringify(r.contents.items));
}
{
  // a localised heading style ("Titre1" named "heading 1"), list items, alternate content read once, line breaks and tabs
  const styles = fflate.strToU8('<w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Rubrik"><w:name w:val="Rubrik"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style></w:styles>');
  const mc = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
  const r = parse(docx(P('Synthèse', 'Titre1') + P('Partie', 'Rubrik') + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>' +
    '<mc:AlternateContent ' + mc + '><mc:Choice Requires="x">' + P('once') + '</mc:Choice><mc:Fallback>' + P('once') + '</mc:Fallback></mc:AlternateContent>' +
    '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>', { 'word/styles.xml': styles }));
  const it = r.contents.items;
  ok('synthetic Word: a localised heading style and an outline level give headings', it[0].k === 'h' && it[0].level === 1 && it[0].text === 'Synthèse' && it[1].k === 'h' && it[1].level === 3, JSON.stringify(it));
  ok('synthetic Word: list items marked, alternate content read once, tab and line break kept', it[2].list === true && it.filter((x) => x.text === 'once').length === 1 && it[4].text === 'a b\nc', JSON.stringify(it));
}
{
  // XML: another prefix for the same namespace, entities, CDATA, a comment; a DOCTYPE whose entities are never expanded
  const x = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>' +
    '<q:document xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><q:body><!-- a <q:p> in a comment -->' +
    '<q:p><q:r><q:t>Tom &amp; Jerry &lt;3 &#x41;&#66; &b;</q:t></q:r></q:p><q:p><q:r><q:t><![CDATA[<raw> & text]]></q:t></q:r></q:p></q:body></q:document>';
  const r = parse(fflate.zipSync({ 'word/document.xml': fflate.strToU8(x) }));
  ok('synthetic XML: any prefix for the Word namespace, entities decoded, CDATA kept, comments skipped, DOCTYPE entities NOT expanded',
    same(r.contents.items.map((i) => i.text), ['Tom & Jerry <3 AB &b;', '<raw> & text']), JSON.stringify(r.contents.items));
  const tree = J(DB.xmlTree('<a x="1 > 2" y=\'q"\'><b/>t</a>'));
  ok('synthetic XML: a ">" inside an attribute, both quote kinds', tree.a.x === '1 > 2' && tree.a.y === 'q"' && tree.c.length === 2, JSON.stringify(tree));
}
{
  // PowerPoint: merged cells (gridSpan, hMerge, rowSpan, vMerge), a table without a header flag
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const tc = (t, at) => '<a:tc' + (at || '') + '><a:txBody><a:p><a:r><a:t>' + t + '</a:t></a:r></a:p></a:txBody></a:tc>';
  const tbl = '<a:tbl><a:tblPr firstRow="1"/><a:tr>' + tc('area') + tc('Q', ' gridSpan="2"') + tc('', ' hMerge="1"') + '</a:tr>' +
    '<a:tr>' + tc('') + tc('Q1') + tc('Q2') + '</a:tr><a:tr>' + tc('North', ' rowSpan="2"') + tc('1') + tc('2') + '</a:tr><a:tr>' + tc('', ' vMerge="1"') + tc('3') + tc('4') + '</a:tr></a:tbl>';
  const slide = '<p:sld ' + A + '><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData>' + tbl + '</a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>';
  const files = {
    'ppt/presentation.xml': fflate.strToU8('<p:presentation ' + A + '><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': fflate.strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://x/slide" Target="slides/slide1.xml"/></Relationships>'),
    'ppt/slides/slide1.xml': fflate.strToU8(slide),
  };
  const r = parse(fflate.zipSync(files), 'pptx');
  const s = r.sections[0];
  ok('synthetic PowerPoint: merged cells across and down; a merged header cell over a row that names its columns: two header rows', s && same(cols(s), ['area', 'Q / Q1', 'Q / Q2']) && same(s.rows, [['North', '1', '2'], ['North', '3', '4']]), JSON.stringify(s));
}
{
  // hostile: deep nesting, many elements, a declared size too large, many tables, damaged zips
  let ms = time(() => { ok('hostile: 100,000 nested elements are refused', errKey(() => DB.parseOffice(docx('<w:p>'.repeat(100000) + '</w:p>'.repeat(100000)), 'docx')) === 'errCorrupt'); });
  ok('hostile: ... quickly (' + ms + ' ms)', ms < 3000);
  ms = time(() => { ok('hostile: 5 million empty elements are refused as too large', errKey(() => DB.parseOffice(docx('<w:b/>'.repeat(5000000)), 'docx')) === 'errTooLarge'); });
  ok('hostile: ... quickly (' + ms + ' ms)', ms < 8000);
  const many = docx(('<w:tbl><w:tr>' + TC('a') + TC('b') + '</w:tr><w:tr>' + TC('1') + TC('2') + '</w:tr></w:tbl>' + P('x')).repeat(520));
  const r = parse(many);
  ok('limits: 500 tables read, the others counted and listed as not read', r.sections.length === 500 && r.contents.counts.tables === 520 && r.contents.items.filter((i) => i.k === 'table' && i.sec === -2).length === 20, r.sections.length);
  const z = docx(P('x'));
  const broken = z.slice(); broken.fill(0x41, 40, 80);
  ok('hostile: a damaged zip gives a coded error', ['errCorrupt', 'errTooLarge'].includes(errKey(() => DB.parseOffice(broken, 'docx'))), errKey(() => DB.parseOffice(broken, 'docx')));
  ok('a zip without the document part is refused', errKey(() => DB.parseOffice(fflate.zipSync({ 'a.txt': fflate.strToU8('x') }), 'docx')) === 'errCorrupt');
  // a zip entry that declares a size over the limit (a zip bomb would): refused before it is decompressed
  const big = fflate.zipSync({ 'word/document.xml': new Uint8Array(1000) }, { level: 0 });
  const dv = new DataView(big.buffer, big.byteOffset);
  const cd = big.length - 22 - 46 - 'word/document.xml'.length;   // the central directory entry
  dv.setUint32(cd + 24, 300 * 1024 * 1024, true);
  ok('hostile: a document part declaring 300 MB is refused before decompression', errKey(() => DB.parseOffice(big, 'docx')) === 'errTooLarge', errKey(() => DB.parseOffice(big, 'docx')));
  let raw = 0;
  const real = new Uint8Array(fs.readFileSync(path.join(FIX, 'doc-fixtures', 'report.docx')));
  let seed = 4242;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  ms = time(() => { for (let i = 0; i < 300; i++) { const f = real.slice(); for (let j = 0; j < 3; j++) f[rnd(f.length)] = rnd(256); if (errKey(() => DB.parseOffice(f, 'docx')).startsWith('raw')) raw++; } });
  ok('hostile: 300 damaged copies of a real .docx: read or a coded error (' + ms + ' ms, ' + raw + ' raw)', raw === 0 && ms < 30000);
  ok('officeKind: by the parts or the mimetype; a spreadsheet is not a document', DB.officeKind(['word/document.xml'], '') === 'docx' && DB.officeKind(['ppt/presentation.xml'], '') === 'pptx' &&
    DB.officeKind([], 'application/vnd.oasis.opendocument.text') === 'odt' && DB.officeKind([], 'application/vnd.oasis.opendocument.presentation') === 'odp' &&
    DB.officeKind(['xl/workbook.xml'], '') === '' && DB.officeKind([], 'application/vnd.oasis.opendocument.spreadsheet') === '');
}

/* ---------------------------------------------------------------- review of v1.4 (stage 23): regression tests ---------- */
{
  // a 1 MB attribute name without "=": linear (the old regex backtracked)
  let ms = time(() => DB.xmlTree('<a ' + 'x'.repeat(1000000) + '>t</a>'));
  ok('review: a 1 MB token without "=" in a tag (' + ms + ' ms)', ms < 2000);
  ok('review: attributes still read: quotes, spaces around "=", an attribute without value', same(J(DB.xmlTree('<a k = "v w" flag j=\'x\'>t</a>')).a, { k: 'v w', j: 'x' }));
  // ODF repeats multiply cells: 15 rows repeated 1000 times, each of 10,000 repeated cells (a few kB of XML)
  const T = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
  const row = '<table:table-row table:number-rows-repeated="1000"><table:table-cell table:number-columns-repeated="1000"><text:p>x</text:p></table:table-cell>'.repeat(1) +
    '<table:table-cell table:number-columns-repeated="1000"><text:p>y</text:p></table:table-cell>'.repeat(9) + '</table:table-row>';
  const odt = (body) => fflate.zipSync({ mimetype: fflate.strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': fflate.strToU8('<office:document-content ' + T + '><office:body><office:text>' + body + '</office:text></office:body></office:document-content>') });
  let r;
  ms = time(() => { r = parse(odt('<table:table>' + row.repeat(15) + '</table:table>'), 'odt'); });
  ok('review: repeated ODF rows and cells stay within the table budget (' + ms + ' ms)', ms < 15000 && r.sections.length === 1 && r.sections[0].rows.length < 1000, ms + ' ms, ' + (r.sections[0] && r.sections[0].rows.length) + ' rows');
  // a PowerPoint "Header row" only styles the row: the header is a guess (records may be its names)
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const tc = (t) => '<a:tc><a:txBody><a:p><a:r><a:t>' + t + '</a:t></a:r></a:p></a:txBody></a:tc>';
  const deck = (tbl) => fflate.zipSync({
    'ppt/presentation.xml': fflate.strToU8('<p:presentation ' + A + '><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': fflate.strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://x/slide" Target="slides/slide1.xml"/></Relationships>'),
    'ppt/slides/slide1.xml': fflate.strToU8('<p:sld ' + A + '><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData>' + tbl + '</a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>') });
  r = parse(deck('<a:tbl><a:tblPr firstRow="1"/><a:tr>' + tc('Alice Martin') + tc('alice@corp.com') + '</a:tr><a:tr>' + tc('Bob Stone') + tc('bob@corp.com') + '</a:tr><a:tr>' + tc('Carol Diaz') + tc('carol@corp.com') + '</a:tr></a:tbl>'), 'pptx');
  ok('review: a PowerPoint header row is a guessed header (for "Do not share data")', r.sections[0].headerGuessed === true, JSON.stringify(r.sections[0]));
  // the two-row header rule is a guess too
  const tbl2 = '<w:tbl><w:tr>' + TC('Q3 customers', '<w:gridSpan w:val="2"/>') + '</w:tr><w:tr>' + TC('Alice Martin') + TC('alice@corp.com') + '</w:tr><w:tr>' + TC('Bob Stone') + TC('bob@corp.com') + '</w:tr></w:tbl>';
  r = parse(docx(tbl2));
  ok('review: a merged first row over a second row: a guessed two-row header', r.sections[0].headerGuessed === true, JSON.stringify(r.sections[0]));
  // a table in a text box (inside a paragraph) is not paragraph text; an indented row keeps its columns; rows in a content control
  const box = '<w:p><w:r><w:t>Intro </w:t></w:r><w:r><w:pict><w:txbxContent><w:tbl><w:tr>' + TC('secret 1') + TC('secret 2') + '</w:tr></w:tbl></w:txbxContent></w:pict></w:r></w:p>';
  r = parse(docx(box));
  ok('review: a table inside a text box is left out of the paragraph text', r.contents.items[0].text === 'Intro' && !JSON.stringify(r.contents).includes('secret'), JSON.stringify(r.contents.items));
  const indented = '<w:tbl><w:tr>' + TC('a') + TC('b') + TC('c') + '</w:tr><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>' + TC('2') + TC('3') + '</w:tr>' +
    '<w:sdt><w:sdtContent><w:tr>' + TC('4') + TC('5') + TC('6') + '</w:tr></w:sdtContent></w:sdt></w:tbl>';
  r = parse(docx(indented));
  ok('review: an indented row (gridBefore) keeps its columns; rows inside a content control are read', same(r.sections[0].rows, [['', '2', '3'], ['4', '5', '6']]), JSON.stringify(r.sections[0]));
  // a style named like an Object property is not a heading
  r = parse(docx(P('text', 'toString')));
  ok('review: a paragraph style called "toString" is not a heading', r.contents.items[0].k === 'p', JSON.stringify(r.contents.items));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
