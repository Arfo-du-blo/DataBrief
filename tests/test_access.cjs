#!/usr/bin/env node
/* Tests of the Access reader (src/access.js + the vendored mdb-reader) in Node, without a browser.   node tests/test_access.cjs
 * 1. REAL .accdb and .mdb files written by Jackcess (an independent library; NOT Microsoft Access): tests/access-fixtures, against the
 *    values that went in (tests/access-fixtures/src/MakeAccess.java).
 * 2. SYNTHETIC cases with a stand-in reader, for what no real file here can show: a protected database, linked tables, the row limit.
 * 3. Damaged files never throw anything but the clear error, and never hang. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'access-fixtures');
function context(libOverride) {
  const ctx = { console, TextDecoder, TextEncoder, Intl, Date };
  ctx.window = ctx;
  vm.createContext(ctx);
  const access = process.env.ACCESS_SRC || 'src/access.js';
  const files = libOverride ? ['src/util.js', access] : ['src/util.js', 'vendor/mdb-reader.min.js', access];
  for (const f of files) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
  if (libOverride) { ctx.MDBReaderLib = { default: libOverride }; ctx.Buffer = Buffer; }
  return ctx;
}
const real = context();
const DB = real.DB;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (f) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
const meta = (r, key) => { const m = r.fileMeta.find((x) => x[0] === key); return m ? m[1] : undefined; };
const sec = (r, n) => r.sections.find((s) => s.name === n);
const code = (fn) => { try { fn(); return null; } catch (e) { return e.key || ('RAW:' + e.message); } };

/* ---------------------------------------------------------------- 1. real files ---------- */
const CUSTOMERS = [
  ['1', 'ana.secret@example.com', 'Ana García', 'ES', '2024-01-15 09:30:00', 'CONFIDENTIAL_NOTE_123', 'true', '0.5', '0'],
  ['2', 'bob@example.com', "Bob O'Brien", 'IE', '2024-02-01 18:45:00', 'Line one\r\nline two; with semicolon -- not a comment', 'false', '-7.25', '1.5'],
  ['3', 'zoe@example.com', 'Zoë 😀', 'FR', '2024-03-10', '', 'true', '200.5', ''],
  ['4', 'dan@example.com', 'Dan "The Man" Smith', 'US', '2024-03-11 12:00:00', 'back\\slash path C:\\temp', 'false', '300.5', '4.5'],
  ['5', 'eve@example.com', 'Eve', 'DE', '2024-04-01 08:00:00', '', 'true', '400.5', '6'],
  ['6', 'confidential_segment_x@example.com', 'CONFIDENTIAL_CUSTOMER_74291', 'GB', '2024-04-02 08:00:00', 'CONFIDENTIAL_SEGMENT_X', 'false', '500.5', '7.5'],
];
const FKS = ['Orders(CustomerId)->Customers(Id)', 'OrderItems(OrderId)->Orders(Id)', 'OrderItems(ProductId)->Products(Id)', 'ProductTags(ProductId)->Products(Id)',
  'ProductTags(TagId)->Tags(Id)', 'Shipments(OrderId,LineNo)->OrderItems(OrderId,LineNo)'].sort();
for (const file of ['shop.accdb', 'shop.mdb']) {
  const u8 = bytes(file);
  ok(file + ': recognised as Access', DB.isAccess(u8));
  let r = null, err = null;
  try { r = DB.parseAccess(u8, { maxRows: 250000 }); } catch (x) { err = x; }
  if (!r) { ok(file + ': read', false, err && err.stack); continue; }
  ok(file + ': the seven tables, in order', same(r.sections.map((s) => s.name), ['Customers', 'Products', 'Tags', 'ProductTags', 'Orders', 'OrderItems', 'Shipments']), JSON.stringify(r.sections.map((s) => s.name)));
  const c = sec(r, 'Customers');
  ok(file + ': Customers columns and Access types', same(c.columns.map((x) => x.name + ':' + x.meta.sqlType),
    ['Id:INTEGER', 'Email:TEXT(255)', 'Name:TEXT(100)', 'Country:TEXT(2)', 'CreatedAt:DATETIME', 'Notes:MEMO', 'Active:BOOLEAN', 'Balance:CURRENCY', 'Score:DOUBLE']), JSON.stringify(c.columns.map((x) => x.name + ':' + x.meta.sqlType)));
  ok(file + ': Customers rows (accents, emoji, quotes, newline, backslash, NULL, boolean, currency, dates)', same(c.rows, CUSTOMERS), JSON.stringify(c.rows).slice(0, 500));
  ok(file + ': Products ("Unit Price" with a space, null money and number)', same(sec(r, 'Products').rows, [['1', 'SKU-001', '12.5', '40'], ['2', 'SKU-002', '8', '0'], ['3', 'SKU-003', '', ''], ['4', 'SKU-004', '99.99', '-1']]) &&
    sec(r, 'Products').columns[2].name === 'Unit Price', JSON.stringify(sec(r, 'Products').rows));
  ok(file + ': row counts', same(r.sections.map((s) => s.rows.length + '/' + s.rowsTotal), ['6/6', '4/4', '3/3', '4/4', '5/5', '5/5', '3/3']), JSON.stringify(r.sections.map((s) => s.rows.length + '/' + s.rowsTotal)));
  const fks = r.sections.flatMap((s) => s.constraints.fks.map((f) => s.name + '(' + f.from + ')->' + f.table + '(' + f.to + ')')).sort();
  ok(file + ': the six relationships Access stores, composite included', same(fks, FKS), JSON.stringify(fks));
  ok(file + ': cascading deletes kept', sec(r, 'OrderItems').constraints.fks.find((f) => f.table === 'Orders').onDelete === 'CASCADE' && sec(r, 'ProductTags').constraints.fks.find((f) => f.table === 'Products').onDelete === 'CASCADE' &&
    sec(r, 'Orders').constraints.fks[0].onDelete === '');
  ok(file + ': file notes', meta(r, 'mAccess') === (file.endsWith('accdb') ? 'Access 2007 or later (.accdb)' : 'Jet database (.mdb)') && /queries/i.test(meta(r, 'mNotRead')) && /^\d{4}-\d\d-\d\d$/.test(meta(r, 'mCreated')), JSON.stringify(r.fileMeta));
}
{
  const e = DB.parseAccess(bytes('empty.accdb'), {});
  ok('empty.accdb: one table, no row', e.sections.length === 1 && e.sections[0].rows.length === 0 && same(e.sections[0].columns.map((c) => c.meta.sqlType), ['TEXT(10)', 'INTEGER']));
  // the relationships feed the existing relationship model (declared, cardinality, no inferred duplicates)
  const r = DB.parseAccess(bytes('shop.accdb'), {});
  const doc = { sections: r.sections.map((s) => Object.assign({}, s, { columns: s.columns.map((c) => Object.assign({ type: 'text' }, c)) })) };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/relationships.js'), 'utf8'), real);
  DB.addRelationships(doc);
  const declared = (doc.relationships || []).filter((x) => x.source === 'declared');
  ok('the model: 6 declared relationships (primary keys unknown, so no many-to-many)', declared.length === 6 && declared.every((x) => x.cardinality === 'many_to_one') && declared.some((x) => x.from.section === 'Shipments' && same(x.from.columns, ['OrderId', 'LineNo'])),
    JSON.stringify(declared.map((x) => x.from.section + ':' + x.cardinality)));
}

/* ---------------------------------------------------------------- 2. synthetic cases (a stand-in reader) ---------- */
function fakeReader(spec) {
  return class {
    constructor() { if (spec.throws) throw spec.throws; }
    getCreationDate() { return new Date('2020-01-02T00:00:00Z'); }
    getTableNames(o) { return o && o.linkedTables ? (spec.linked || []) : Object.keys(spec.tables); }
    getTable(n) {
      if (n === 'MSysRelationships') return { getData: () => spec.rels || [] };
      if (!spec.tables[n]) throw new Error('no table');
      const t = spec.tables[n];
      return { name: n, rowCount: t.total, getColumns: () => t.cols, getData: (o) => t.rows.slice(0, o && o.rowLimit ? o.rowLimit : undefined) };
    }
  };
}
const C = (name, type, extra) => Object.assign({ name, type, size: 8 }, extra || {});
{
  const prot = (err) => { const c = context(fakeReader({ throws: err })); return code(() => c.DB.parseAccess(new Uint8Array(100), {})); };
  ok('synthetic: a protected database (code ENCRYPTED) gives the protected message', prot(Object.assign(new Error('x'), { code: 'ENCRYPTED' })) === 'errAccessProtected');
  ok('synthetic: "Wrong password" gives the protected message', prot(new Error('Wrong password')) === 'errAccessProtected');
  ok('synthetic: any other failure gives the corrupt message', prot(new Error('Wrong page type. Expected 0 but received 116.')) === 'errCorrupt');
  // the row limit, linked tables, a relationship to a missing table, an unreadable table, a numeric column
  // (the values are made inside the page's own realm, as in a browser: a Uint8Array from another realm is not an instance of it)
  const spec = {
    tables: { T: { total: 300, rows: [], cols: [C('n', 'long'), C('big', 'numeric', { precision: 10, scale: 4 }), C('when', 'datetime'), C('flag', 'boolean'), C('raw', 'binary', { size: 3 })] }, Bad: null },
    linked: ['LinkedToSqlServer'],
    rels: [{ szRelationship: 'a', grbit: 0, icolumn: 0, szObject: 'T', szColumn: 'n', szReferencedObject: 'Ghost', szReferencedColumn: 'id' }],
  };
  const c = context(fakeReader(spec));
  spec.tables.T.rows = Array.from({ length: 300 }, (_, i) => ({ n: i, big: '12.3400', when: vm.runInContext('new Date(Date.UTC(2024, 0, 1, 10, 30, 0))', c), flag: i % 2 === 0, raw: vm.runInContext('new Uint8Array([1, 2, 3])', c) }));
  const r = c.DB.parseAccess(new Uint8Array(100), { maxRows: 250 });
  const t = r.sections[0];
  ok('synthetic: 300 rows, limit 250 -> 250 kept, total 300, and the limit is told', t.rows.length === 250 && t.rowsTotal === 300 && meta(r, 'mRowsCut') === '250');
  ok('synthetic: value formats (numeric, datetime, boolean, binary)', same(t.rows[3], ['3', '12.34', '2024-01-01 10:30:00', 'false', '[binary 3 bytes]']) && same(t.columns.map((x) => x.meta.sqlType), ['INTEGER', 'NUMERIC(10,4)', 'DATETIME', 'BOOLEAN', 'BINARY(3)']), JSON.stringify(t.rows[3]));
  ok('synthetic: linked tables listed as data elsewhere, an unreadable table as skipped, a relationship to a missing table dropped', meta(r, 'mExternal') === '`LinkedToSqlServer`' && meta(r, 'mSkipped') === '`Bad`' && t.constraints.fks.length === 0, JSON.stringify(r.fileMeta));
  const none = context(fakeReader({ tables: {} }));
  ok('synthetic: a database without any table -> the empty message', code(() => none.DB.parseAccess(new Uint8Array(100), {})) === 'errEmpty');
}

/* ---------------------------------------------------------------- 3. damaged files ---------- */
{
  const bad = [];
  let clean = 0;
  const t0 = Date.now();
  const tryIt = (label, u8) => {
    const t1 = Date.now();
    try { DB.parseAccess(u8, { maxRows: 1000 }); } catch (e) { if (e instanceof DB.UserError) clean++; else bad.push(label + ': ' + e.message); }
    if (Date.now() - t1 > 5000) bad.push(label + ': slow (' + (Date.now() - t1) + ' ms)');
  };
  for (const f of ['shop.accdb', 'shop.mdb']) {
    const full = bytes(f);
    for (const cut of [0, 5, 20, 100, 4095, 4096, 8192, 20000, Math.floor(full.length / 2), full.length - 4096, full.length - 1]) tryIt(f + ' cut ' + cut, full.subarray(0, cut));
  }
  let seed = 5;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let n = 0; n < 150; n++) {
    const u = bytes(['shop.accdb', 'shop.mdb', 'empty.accdb'][rnd(3)]).slice();
    for (let k = rnd(8); k >= 0; k--) u[rnd(rnd(2) ? 20000 : u.length)] = rnd(256);
    tryIt('fuzz ' + n, u);
  }
  ok('cuts and 150 damaged files: a result or the clear error, nothing else, none slower than 5 s (' + clean + ' clean errors, ' + (Date.now() - t0) + ' ms)', !bad.length, bad.slice(0, 5).join('; '));
  ok('not Access: text, zeros, a Jet header with nothing behind it', !DB.isAccess(new TextEncoder().encode('a,b\n1,2\n'.repeat(10))) && !DB.isAccess(new Uint8Array(100)) &&
    code(() => DB.parseAccess(Uint8Array.from({ length: 4096 }, (_, i) => (i < 4 ? [0, 1, 0, 0][i] : 0)), {})) === 'errCorrupt');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
