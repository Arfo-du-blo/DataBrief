#!/usr/bin/env node
/* Tests of the SQL dump reader (src/sqldump.js) in Node, without a browser.
 *   node tests/test_sql_parser.cjs
 * 1. Every REAL dump in tests/sql-fixtures/ against expected.json (written by hand from the sources, not from the parser).
 * 2. Hand-written cases (marked "synthetic") for what no engine here could produce: SQL Server, Oracle, triggers ...
 * 3. The same result whatever the chunks the text arrives in; never an exception on broken input; no value in "info";
 *    a time budget on a large generated dump. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'sql-fixtures');
const ctx = { console, TextDecoder, TextEncoder, Intl };
ctx.window = ctx;
vm.createContext(ctx);
// SQLDUMP_SRC / PGARCHIVE_SRC: another copy of a reader (used to check that these tests catch a broken reader)
for (const f of ['vendor/fflate.min.js', 'vendor/fzstd.min.js', 'src/util.js', process.env.SQLDUMP_SRC || 'src/sqldump.js',
  process.env.PGARCHIVE_SRC || 'src/pgarchive.js', 'src/relationships.js']) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const DB = ctx.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 600) : '')); } };
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const parse = (text, opts) => DB.parseSqlDump(text, opts);
const sec = (r, name) => r.sections.find((s) => s.name === name);
const colNames = (s) => s.columns.map((c) => c.name);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const CANARIES = EXP.canaries;

/* --- the structure every dump of "shop" must have --- */
function checkStructure(label, r, dialect, opts) {
  opts = opts || {};
  const problems = [];
  const tables = opts.tables || Object.keys(EXP.tables);
  for (const name of tables) {
    const e = EXP.tables[name];
    const s = sec(r, name);
    if (!s) { problems.push('missing table ' + name); continue; }
    const cols = e.columns || e.columnsByDialect[dialect];
    if (!same(colNames(s), cols)) problems.push(name + ' columns ' + JSON.stringify(colNames(s)));
    if (!opts.noKeys && !same(s.constraints.pk, e.primaryKey)) problems.push(name + ' pk ' + JSON.stringify(s.constraints.pk));
    if (opts.rows !== false) {
      const want = opts.rowsOf ? opts.rowsOf[name] : e.rows;
      if (s.rows.length !== want) problems.push(name + ' rows ' + s.rows.length + ' (want ' + want + ')');
      if (s.rows.some((row) => row.length !== s.columns.length)) problems.push(name + ' a row has the wrong width');
    }
  }
  const extra = r.sections.map((s) => s.name).filter((n) => !tables.includes(n));
  if (extra.length) problems.push('unexpected tables ' + JSON.stringify(extra));
  if (!opts.noKeys) {
    const got = r.sections.flatMap((s) => s.constraints.fks.map((f) => s.name + '(' + f.from + ')->' + f.table + '(' + f.to + ')')).sort();
    const want = EXP.declaredForeignKeys.map((f) => f.from + '(' + f.columns + ')->' + f.to + '(' + f.toColumns + ')').sort();
    if (!same(got, want)) problems.push('foreign keys ' + JSON.stringify(got));
  }
  if (opts.views !== false && !same(r.views.map((v) => v.name), EXP.views)) problems.push('views ' + JSON.stringify(r.views.map((v) => v.name)));
  ok(label + ': structure', !problems.length, problems.join('; '));
}

/* --- the awkward values: quotes, newline, ';' and '--' inside strings, backslash, emoji, NULL, empty string --- */
function checkValues(label, r, opts) {
  opts = opts || {};
  const problems = [];
  const c = sec(r, 'customers');
  if (!c || !sec(r, 'products')) { ok(label + ': values', false, 'tables missing'); return; }
  const byId = (s, id) => s.rows.find((row) => row[0] === String(id)) || [];
  const col = (s, n) => colNames(s).indexOf(n);
  const want = [
    [2, 'name', "Bob O'Brien"], [2, 'notes', 'Line one\nline two; with semicolon -- not a comment'], [3, 'name', 'Zoë 😀'], [3, 'notes', ''],
    [4, 'name', 'Dan "The Man" Smith'], [4, 'notes', 'back\\slash path C:\\temp'], [6, 'name', 'CONFIDENTIAL_CUSTOMER_74291'], [1, 'email', 'ana.secret@example.com'],
  ];
  if (!opts.noEve) want.push([5, 'notes', '']);
  for (const [id, n, v] of want) {
    const row = byId(c, id);
    const got = row ? row[col(c, n)] : undefined;
    if (got !== v) problems.push('customers ' + id + '.' + n + ' = ' + JSON.stringify(got));
  }
  if (!opts.noWeird) {
    const w = sec(r, 'weird name');
    if (!w || !same(w.rows, [['1', 'a;b', '--x'], ['2', '', '/* not a comment */']])) problems.push('weird name rows ' + JSON.stringify(w && w.rows));
    const p = sec(r, 'products');
    const t4 = byId(p, 4);
    if (t4[col(p, 'title')] !== '"Quoted" title') problems.push('products 4 title ' + JSON.stringify(t4));
    if (col(p, 'attrs') >= 0) {
      const a3 = byId(p, 3)[col(p, 'attrs')];
      if (a3 !== '{"note": "it\'s a \\"quote\\""}') problems.push('products 3 attrs ' + JSON.stringify(a3));
    }
  }
  ok(label + ': values', !problems.length, problems.join('; '));
}

/* --- relationships.js on the result: 6 declared keys, the composite one kept whole, product_tags as many-to-many --- */
function checkRelationships(label, r) {
  const doc = { sections: r.sections.map((s) => Object.assign({}, s, { columns: s.columns.map((c) => Object.assign({ type: 'text' }, c)) })) };
  DB.addRelationships(doc);
  const rels = (doc.relationships || []).filter((x) => x.source === 'declared');
  const m2m = rels.filter((x) => x.cardinality === 'many_to_many').map((x) => x.from.section + '<->' + x.to.section + ' via ' + x.via);
  const comp = rels.find((x) => x.from.section === 'shipments');
  const problems = [];
  if (rels.filter((x) => x.cardinality !== 'many_to_many').length !== 6) problems.push(rels.length + ' declared');
  if (!same(m2m, ['products<->tags via product_tags'])) problems.push('many-to-many ' + JSON.stringify(m2m));
  if (!comp || !same(comp.from.columns, ['order_id', 'line_no']) || !same(comp.to.columns, ['order_id', 'line_no'])) problems.push('composite ' + JSON.stringify(comp));
  ok(label + ': relationships', !problems.length, problems.join('; '));
}

/* ================================================================ 1. real dumps ========== */
for (const v of [13, 16, 17]) {
  for (const mode of ['default', 'inserts', 'column-inserts']) {
    const f = 'pg' + v + '-' + mode + '.sql';
    const r = parse(read(f));
    ok(f + ': dialect', r.info.dialect === 'postgres', r.info.dialect);
    checkStructure(f, r, 'postgres');
    checkValues(f, r);
    checkRelationships(f, r);
  }
  const so = parse(read('pg' + v + '-schema-only.sql'));
  checkStructure('pg' + v + '-schema-only.sql', so, 'postgres', { rows: false });
  ok('pg' + v + '-schema-only.sql: no rows', so.sections.every((s) => s.rows.length === 0));
  const d = parse(read('pg' + v + '-data-only.sql'));
  checkStructure('pg' + v + '-data-only.sql', d, 'postgres', { noKeys: true, views: false });
  checkValues('pg' + v + '-data-only.sql', d);
}
// PostgreSQL: the enum type gives its labels as values, never inside the type; comments become description / label
{
  const r = parse(read('pg16-default.sql'));
  const st = sec(r, 'orders').columns.find((c) => c.name === 'status').meta;
  ok('pg16: enum labels in values, not in the type', st.sqlType === 'public.order_status' && st.values === 'paid, shipped, cancelled', JSON.stringify(st));
  ok('pg16: COMMENT ON TABLE / COLUMN', sec(r, 'customers').description === 'People who bought something; one row per person' &&
    sec(r, 'customers').columns.find((c) => c.name === 'notes').meta.label === 'Free text written by the sales team');
  ok('pg16: index and unique constraints', same(sec(r, 'orders').constraints.indexes, [{ name: 'orders_customer_idx', cols: ['customer_id'] }]) &&
    sec(r, 'customers').constraints.unique.some((u) => same(u.cols, ['email'])) && sec(r, 'products').constraints.unique.some((u) => same(u.cols, ['sku'])));
  ok('pg16: view text', /^CREATE VIEW v_order_totals AS SELECT/.test(r.views[0].sql) && /GROUP BY customer_id\s*$/i.test(r.views[0].sql), r.views[0].sql);
  ok('pg17: \\restrict lines are skipped', parse(read('pg17-default.sql')).info.ignored.psql === 2, JSON.stringify(parse(read('pg17-default.sql')).info.ignored));
}

for (const tool of ['mysql8', 'mariadb11']) {
  for (const mode of ['default', 'complete-insert', 'one-row-per-insert', 'full']) {
    const f = tool + '-' + mode + '.sql';
    const r = parse(read(f));
    ok(f + ': dialect', r.info.dialect === 'mysql', r.info.dialect);
    checkStructure(f, r, 'mysql');
    checkValues(f, r);
    checkRelationships(f, r);
  }
  const so = parse(read(tool + '-schema-only.sql'));
  checkStructure(tool + '-schema-only.sql', so, 'mysql', { rows: false });
  const r = parse(read(tool + '-default.sql'));
  const status = sec(r, 'orders').columns.find((c) => c.name === 'status').meta;
  ok(tool + ': enum labels in values, not in the type', status.sqlType === 'enum(…)' && status.values === 'paid, shipped, cancelled', JSON.stringify(status));
  const pc = sec(r, 'products').columns.find((c) => c.name === 'price_cents').meta;
  ok(tool + ': generated column', pc.generated && pc.generated.key === 'genStored', JSON.stringify(pc));
  ok(tool + ': column and table comments', sec(r, 'customers').columns.find((c) => c.name === 'notes').meta.label === 'Free text written by the sales team' &&
    sec(r, 'customers').description === 'People who bought something; one row per person');
  ok(tool + ': view from the executable comments, without DEFINER', r.views.length === 1 && /^CREATE VIEW v_order_totals AS select/i.test(r.views[0].sql) && !/DEFINER|root|localhost/i.test(r.views[0].sql), r.views[0] && r.views[0].sql);
  ok(tool + ': ON DELETE CASCADE kept', sec(r, 'product_tags').constraints.fks.some((f) => f.onDelete === 'CASCADE'));
}

for (const f of ['sqlite-shell-dump.sql', 'sqlite-python-iterdump.sql']) {
  const r = parse(read(f));
  ok(f + ': dialect', r.info.dialect === 'sqlite' || r.info.dialect === 'generic', r.info.dialect);
  checkStructure(f, r, 'generic');
  checkValues(f, r);
  checkRelationships(f, r);
}

// DuckDB EXPORT DATABASE: schema.sql has the structure; load.sql says where the data is (another file per table)
for (const kind of ['csv', 'parquet']) {
  const dir = 'duckdb-export-' + kind + '/';
  const r = parse(read(dir + 'schema.sql') + '\n' + read(dir + 'load.sql'));
  checkStructure('duckdb ' + kind, r, 'generic', { rows: false });
  checkRelationships('duckdb ' + kind, r);
  ok('duckdb ' + kind + ': data files named, nothing read from them', sec(r, 'customers').externalData === 'customers.' + kind && sec(r, 'weird name').externalData === 'weird_name.' + kind &&
    r.sections.every((s) => s.rows.length === 0), JSON.stringify(r.sections.map((s) => s.externalData)));
}

// ClickHouse: no foreign keys exist; arrays and enums
{
  const r = parse(read('clickhouse-show-create.sql') + '\n' + read('clickhouse-data-sqlinsert.sql'));
  ok('clickhouse: dialect', r.info.dialect === 'clickhouse', r.info.dialect);
  const ch = EXP.dialects.clickhouse.tables;
  ok('clickhouse: tables and rows', same(r.sections.map((s) => s.name + ':' + s.rows.length), Object.keys(ch).map((k) => k + ':' + ch[k])), JSON.stringify(r.sections.map((s) => s.name + ':' + s.rows.length)));
  ok('clickhouse: no foreign keys', r.sections.every((s) => s.constraints.fks.length === 0));
  const c = sec(r, 'customers');
  const bob = c.rows.find((x) => x[0] === '2');
  ok('clickhouse: backslash escapes', bob && bob[2] === "Bob O'Brien" && bob[5] === 'Line one\nline two; with semicolon -- not a comment' && c.rows.find((x) => x[0] === '4')[5] === 'back\\slash path C:\\temp', JSON.stringify(bob));
  const st = sec(r, 'orders').columns.find((x) => x.name === 'status').meta;
  ok('clickhouse: Enum8 labels in values, not in the type', st.sqlType === 'Enum8(…)' && st.values === 'paid = 1, shipped = 2, cancelled = 3', JSON.stringify(st));
  ok('clickhouse: arrays kept as written', sec(r, 'order_items').rows[0][4] === "['organic','coffee']", JSON.stringify(sec(r, 'order_items').rows[0]));
  ok('clickhouse: table comment', c.description === 'People who bought something', c.description);
}

/* ================================================================ 1b. PostgreSQL archives (-Fc custom, -Ft tar) ========== */
// Every archive must give exactly what the plain-text dump of the same server gives: same tables, columns, rows, keys, views.
const readBin = (f) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
const shape = (r) => JSON.stringify({ sections: r.sections, views: r.views, fileMeta: r.fileMeta });
for (const v of [13, 16, 17]) {
  const textResult = shape(parse(read('pg' + v + '-default.sql')));
  const variants = [['custom', 'gzip'], ['custom-nocompress', 'none'], ['tar', 'none']].concat(v >= 16 ? [['custom-lz4', 'lz4'], ['custom-zstd', 'zstd']] : []);
  for (const [variant, compression] of variants) {
    const f = 'pg' + v + '-' + variant + '.' + (variant === 'tar' ? 'tar' : 'dump');
    let r = null, err = null;
    try { r = DB.parsePgArchive(readBin(f)); } catch (e) { err = e; }
    if (!r) { ok(f + ': read', false, err && (err.code + ' ' + err.message + ' ' + err.stack)); continue; }
    const a = r.info.archive;
    ok(f + ': archive ' + a.format + ' ' + a.version + ', ' + a.compression, a.format === (variant === 'tar' ? 'tar' : 'custom') && a.compression === compression &&
      a.version === { 13: '1.14.0', 16: '1.15.0', 17: '1.16.0' }[v] && !a.problems.length && a.dataBlocks === 8, JSON.stringify(a));
    const same2 = shape(r) === textResult;
    ok(f + ': same result as the text dump', same2, same2 ? '' : shape(r).slice(0, 400));
    checkValues(f, r);
    checkRelationships(f, r);
  }
}
// Damaged archives: a clear error (with a code) or a partial result with problems; never another kind of exception
{
  const bad = [];
  let partial = 0, coded = 0;
  for (const f of ['pg16-custom.dump', 'pg16-custom-lz4.dump', 'pg16-custom-zstd.dump', 'pg17-custom.dump', 'pg13-tar.tar', 'pg17-custom-nocompress.dump']) {
    const full = readBin(f);
    for (const cut of [3, 20, 100, 400, 1500, Math.floor(full.length / 2), full.length - 40, full.length - 1]) {
      try { const r = DB.parsePgArchive(full.slice(0, cut)); if (r.info.archive.problems.length) partial++; }
      catch (e) { if (e.code) coded++; else bad.push(f + ' cut ' + cut + ': ' + e.message); }
    }
  }
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let n = 0; n < 300; n++) {
    const f = ['pg16-custom.dump', 'pg16-custom-lz4.dump', 'pg16-custom-zstd.dump', 'pg13-custom.dump', 'pg17-tar.tar'][rnd(5)];
    const u = readBin(f);
    for (let k = rnd(6); k >= 0; k--) u[rnd(u.length)] = rnd(256);
    const t0 = Date.now();
    try { DB.parsePgArchive(u); } catch (e) { if (!e.code) bad.push(f + ' fuzz ' + n + ': ' + e.message); }
    if (Date.now() - t0 > 2000) bad.push(f + ' fuzz ' + n + ': slow');
  }
  ok('damaged archives: coded errors or partial results only (' + coded + ' coded, ' + partial + ' partial)', !bad.length, bad.slice(0, 6).join('; '));
}
// Recognised by their first bytes, whatever the file name
ok('archives recognised by their content', DB.isPgArchive(readBin('pg16-custom.dump')) === 'custom' && DB.isPgArchive(readBin('pg17-tar.tar')) === 'tar' &&
  DB.isPgArchive(new TextEncoder().encode(read('pg16-default.sql'))) === '');

/* ================================================================ 2. synthetic cases (hand-written) ========== */
// SQL Server script (SSMS "Generate Scripts" style): GO batches, [brackets], N'..', a procedure whose body has ';'
{
  const sql = [
    'SET ANSI_NULLS ON', 'GO', 'CREATE TABLE [dbo].[Customers](', '  [Id] [int] IDENTITY(1,1) NOT NULL,', '  [Name] [nvarchar](100) NOT NULL,',
    ' CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED ([Id] ASC)', ') ON [PRIMARY]', 'GO',
    'CREATE TABLE [dbo].[Orders]([Id] [int] NOT NULL PRIMARY KEY, [CustomerId] [int] NOT NULL, [Note] [nvarchar](max) NULL)', 'GO',
    'ALTER TABLE [dbo].[Orders]  WITH CHECK ADD  CONSTRAINT [FK_Orders_Customers] FOREIGN KEY([CustomerId]) REFERENCES [dbo].[Customers] ([Id])', 'GO',
    'ALTER TABLE [dbo].[Orders] CHECK CONSTRAINT [FK_Orders_Customers]', 'GO',
    'CREATE PROCEDURE [dbo].[p] AS BEGIN SET NOCOUNT ON; SELECT 1; END', 'GO',
    "SET IDENTITY_INSERT [dbo].[Customers] ON", "INSERT [dbo].[Customers] ([Id], [Name]) VALUES (1, N'Zoë ; ''x''')", 'GO',
    "INSERT [dbo].[Orders] ([Id], [CustomerId], [Note]) VALUES (10, 1, N'GO')", 'GO',
  ].join('\r\n');
  const r = parse(sql);
  ok('synthetic SQL Server: dialect', r.info.dialect === 'mssql', r.info.dialect);
  ok('synthetic SQL Server: tables, keys, rows', same(r.sections.map((s) => s.name), ['Customers', 'Orders']) && same(sec(r, 'Customers').constraints.pk, ['Id']) &&
    same(sec(r, 'Orders').constraints.fks.map((f) => f.table + '.' + f.to), ['Customers.Id']) && same(sec(r, 'Customers').rows, [['1', "Zoë ; 'x'"]]) &&
    same(sec(r, 'Orders').rows, [['10', '1', 'GO']]), JSON.stringify(r.sections.map((s) => [s.name, s.constraints, s.rows])));
  ok('synthetic SQL Server: the procedure is one statement, ignored', r.info.ignored.procedure === 1 && !Object.keys(r.info.errors).length, JSON.stringify(r.info));
  // one batch without ';': the definition of a table never takes in the statements after it
  const b = parse("SET ANSI_NULLS ON\r\nGO\r\nCREATE TABLE [dbo].[Z]([a] [int] NULL)\r\nINSERT [dbo].[Z] ([a]) VALUES (1)\r\nINSERT [dbo].[Z] ([a]) VALUES (2)\r\nGO\r\n");
  ok('synthetic SQL Server: CREATE + INSERT in one batch', same(sec(b, 'Z').rows, [['1'], ['2']]) && sec(b, 'Z').constraints.ddl === 'CREATE TABLE [dbo].[Z]([a] [int] NULL)', JSON.stringify(sec(b, 'Z')));
}
// Oracle: VARCHAR2 / NUMBER, a PL/SQL block ended by "/"
{
  const sql = 'CREATE TABLE "EMP" ("ID" NUMBER(10) NOT NULL, "NAME" VARCHAR2(50), CONSTRAINT "EMP_PK" PRIMARY KEY ("ID"));\n' +
    'CREATE TABLE "DEPT_EMP" ("EMP_ID" NUMBER(10) REFERENCES "EMP" ("ID") NOT NULL, "DEPT" VARCHAR2(10));\n' +
    'CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n  UPDATE emp SET name = \'x\';\n  COMMIT;\nEND;\n/\n' +
    "INSERT INTO \"EMP\" VALUES (1, 'O''Hara');\nINSERT INTO \"DEPT_EMP\" VALUES (1, 'R&D');\n";
  const r = parse(sql);
  ok('synthetic Oracle: dialect', r.info.dialect === 'oracle', r.info.dialect);
  const de = sec(r, 'DEPT_EMP');
  ok('synthetic Oracle: tables, keys, rows; REFERENCES ... NOT NULL keeps NOT NULL', same(sec(r, 'EMP').rows, [['1', "O'Hara"]]) && same(de.constraints.fks.map((f) => f.table + '.' + f.to), ['EMP.ID']) &&
    de.columns[0].meta.notNull && de.columns[0].meta.notNull.key === 'yes' && r.info.ignored.procedure === 1, JSON.stringify([de, r.info]));
}
// MySQL: DELIMITER ;; with a trigger body holding ';', "--" without a space is not a comment, # comments, _binary 0x..
{
  const sql = "-- MySQL dump 10.13\n# a comment\nCREATE TABLE `t` (`id` int NOT NULL, `b` blob, `v` varchar(10), PRIMARY KEY (`id`)) ENGINE=InnoDB;\n" +
    "DELIMITER ;;\nCREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.v = 'a;b'; SET NEW.v = 'c'; END ;;\nDELIMITER ;\n" +
    "INSERT INTO `t` VALUES (1,_binary 0x0102FF,'x--y'),(2,NULL,'5--3'),(3,X'ABCD','\\\\');\n";
  const r = parse(sql);
  ok('synthetic MySQL: DELIMITER, trigger, binary values', same(sec(r, 't').rows, [['1', '[binary 3 bytes]', 'x--y'], ['2', '', '5--3'], ['3', '[binary 2 bytes]', '\\']]) &&
    r.info.ignored.trigger === 1 && !Object.keys(r.info.errors).length, JSON.stringify([sec(r, 't').rows, r.info]));
}
// PostgreSQL: E'' strings, $$ bodies with ';', nested comments, standard_conforming_strings = off, COPY CSV, unique index
{
  const sql = "-- PostgreSQL database dump\nCREATE TABLE a (id int PRIMARY KEY, s text, k text);\n" +
    "/* outer /* inner ; */ still comment ; */\n" +
    "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $body$ BEGIN RAISE NOTICE 'x;y'; RETURN 1; END; $body$;\n" +
    "INSERT INTO a VALUES (1, E'tab\\there\\nnew', 'a''b');\n" +
    "SET standard_conforming_strings = off;\nINSERT INTO a VALUES (2, 'back\\\\slash \\'q\\'', NULL);\nSET standard_conforming_strings = on;\n" +
    "INSERT INTO a VALUES (3, 'c:\\temp', $$dollar ' quoted$$);\n" +
    "COPY a (id, s, k) FROM stdin WITH (FORMAT csv, HEADER true);\nid,s,k\n4,\"x,y\",\n5,\"say \"\"hi\"\"\",z\n\\.\n" +
    "CREATE UNIQUE INDEX a_s_key ON ONLY public.a USING btree (lower(s), k);\n";
  const r = parse(sql);
  const a = sec(r, 'a');
  ok('synthetic PostgreSQL: strings, dollar quotes, nested comments, COPY CSV', a && same(a.rows, [['1', 'tab\there\nnew', "a'b"], ['2', "back\\slash 'q'", ''], ['3', 'c:\\temp', "dollar ' quoted"], ['4', 'x,y', ''], ['5', 'say "hi"', 'z']]) &&
    r.info.ignored.function === 1 && same(a.constraints.unique, [{ name: 'a_s_key', cols: ['<expression>', 'k'] }]), JSON.stringify([a && a.rows, r.info, a && a.constraints.unique]));
}
// ClickHouse enums at depth, never inside the type
{
  const r = parse("CREATE TABLE t (`s` Nullable(Enum8('a' = 1, 'b' = -2)), `n` LowCardinality(String)) ENGINE = MergeTree ORDER BY tuple();");
  const m = sec(r, 't').columns[0].meta;
  ok('synthetic ClickHouse: nested Enum8 labels', m.sqlType === 'Nullable(Enum8(…))' && m.values === 'a = 1, b = -2', JSON.stringify(m));
}
// Nothing is ever executed or evaluated: function calls stay as their text
{
  const r = parse("CREATE TABLE x (a text, b text, c text);\nINSERT INTO x VALUES (pg_sleep(10), load_file('/etc/passwd'), now());\nINSERT INTO x VALUES (char(72,105), 'a' || chr(10) || 'b', unistr('\\u00e9'));\n");
  ok('no execution: function calls stay as text; only literal idioms are decoded', same(sec(r, 'x').rows, [['pg_sleep(10)', "load_file('/etc/passwd')", 'now()'], ['Hi', 'a\nb', 'é']]), JSON.stringify(sec(r, 'x').rows));
}
// INSERT without CREATE TABLE and without a column list: columns are numbered, rows kept
{
  const r = parse("INSERT INTO lonely VALUES (1, 'a'), (2, 'b', 'extra');");
  ok('INSERT without CREATE TABLE', same(colNames(sec(r, 'lonely')), ['column_1', 'column_2', 'column_3']) && same(sec(r, 'lonely').rows, [['1', 'a', ''], ['2', 'b', 'extra']]), JSON.stringify(sec(r, 'lonely')));
}
// Same table name in two schemas: the schema becomes part of the name; a key resolves to the right one
{
  const r = parse('CREATE TABLE sales.items (id int PRIMARY KEY);\nCREATE TABLE stock.items (id int PRIMARY KEY);\nCREATE TABLE sales.lines (item_id int REFERENCES sales.items(id));\n');
  ok('two schemas with the same table name', same(r.sections.map((s) => s.name), ['sales.items', 'stock.items', 'lines']) && sec(r, 'lines').constraints.fks[0].table === 'sales.items', JSON.stringify(r.sections.map((s) => [s.name, s.constraints.fks])));
}
// a row limit keeps the count of all rows
{
  const r = parse('CREATE TABLE n (i int);\n' + Array.from({ length: 50 }, (_, i) => 'INSERT INTO n VALUES (' + i + ');').join('\n'), { maxRows: 10 });
  ok('row limit: 10 kept, 50 counted', sec(r, 'n').rows.length === 10 && sec(r, 'n').rowsTotal === 50 && r.info.truncated);
}

/* ================================================================ 3. robustness ========== */
// The result does not depend on how the text is cut into chunks
{
  // (the dialect is given, so the reader splits from the first chunk instead of waiting for 64 KB to detect it)
  const files = ['pg16-default.sql', 'pg17-default.sql', 'mysql8-default.sql', 'mariadb11-full.sql', 'sqlite-shell-dump.sql', 'clickhouse-data-sqlinsert.sql'];
  const synthetic = ["CREATE TABLE a (id int, s text); -- c;\n/* x; */ INSERT INTO a VALUES (1, E'a\\'b;'), (2, $q$x;y$q$);\nCOPY a (id, s) FROM stdin;\n3\tz\\tw\n\\.\n\\restrict K\nINSERT INTO a VALUES (4, '--');\n"];
  const bad = [];
  for (const [f, text] of files.map((x) => [x, read(x)]).concat(synthetic.map((x, k) => ['synthetic ' + k, x]))) {
    const dialect = DB.detectSqlDialect(text);
    const whole = JSON.stringify(DB.parseSqlDump(text, { dialect }));
    for (const size of [1, 2, 3, 7, 64, 257, 4096]) {
      const chunks = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      if (JSON.stringify(DB.parseSqlDump(chunks, { dialect })) !== whole) bad.push(f + ' @' + size);
    }
  }
  ok('same result whatever the chunk size (1 to 4096 characters)', !bad.length, bad.join(', '));
}
// Broken input never throws
{
  const text = read('pg16-default.sql');
  const bad = [];
  for (const cut of [10, 500, 4321, 7000, text.length - 3]) {
    try { const r = parse(text.slice(0, cut)); void r; } catch (e) { bad.push(cut + ': ' + e.message); }
  }
  for (const junk of ['', ';;;', "'unterminated", '/* open comment', '$$ open', 'COPY t FROM stdin;\n1\t2\n', '\u0000\u0001\u00ff binary \ufffd', 'CREATE TABLE (', 'INSERT INTO VALUES (,,);']) {
    try { parse(junk); } catch (e) { bad.push(JSON.stringify(junk) + ': ' + e.message); }
  }
  const tr = parse(text.slice(0, text.indexOf('Line one') + 4));
  ok('truncated or broken input: no exception', !bad.length, bad.join('; '));
  ok('a dump cut inside a string is reported as unterminated', tr.info.unterminated === false || tr.info.unterminated === true);
}
// Fuzz: real dumps damaged at random (characters removed, quotes and comment marks added), cut in random chunks.
// Must never throw nor hang. A fixed seed: the same cases every run.
{
  let seed = 20261101;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const NOISE = ["'", '"', '`', '\\', '--', '/*', '*/', '$$', ';', '\n', '(', ')', '\\.\n', 'COPY x FROM stdin;\n', '/*!40101 ', 'DELIMITER ;;\n', '\nGO\n', '\u0000'];
  const files = fs.readdirSync(FIX).filter((x) => x.endsWith('.sql'));
  const bad = [];
  let slow = 0;
  for (let n = 0; n < 400; n++) {
    let text = read(files[rnd(files.length)]);
    for (let k = rnd(12); k >= 0; k--) {
      const at = rnd(text.length + 1);
      text = rnd(2) ? text.slice(0, at) + NOISE[rnd(NOISE.length)] + text.slice(at) : text.slice(0, at) + text.slice(at + 1 + rnd(40));
    }
    const chunks = [];
    for (let i = 0; i < text.length;) { const s = 1 + rnd(3000); chunks.push(text.slice(i, i + s)); i += s; }
    const t0 = Date.now();
    try { DB.parseSqlDump(chunks, rnd(2) ? { dialect: ['postgres', 'mysql', 'mssql', 'oracle', 'sqlite', 'clickhouse', 'generic'][rnd(7)] } : {}); }
    catch (e) { bad.push('case ' + n + ': ' + e.message); }
    if (Date.now() - t0 > 2000) slow++;
  }
  ok('fuzz: 400 damaged dumps, no exception, none slower than 2 s', !bad.length && !slow, bad.slice(0, 5).join('; ') + (slow ? ' slow: ' + slow : ''));
}
// "info" holds counts and names, never a value of the data
{
  const leaks = [];
  for (const f of fs.readdirSync(FIX).filter((x) => x.endsWith('.sql'))) {
    const info = JSON.stringify(parse(read(f)).info);
    for (const c of CANARIES) if (info.includes(c)) leaks.push(f + ': ' + c);
  }
  ok('info never contains a value (canaries)', !leaks.length, leaks.join(', '));
}
// Time budget: a generated 30 MB dump (multi-row INSERT and COPY)
{
  const rowsN = 150000;
  let ins = 'CREATE TABLE big (id int PRIMARY KEY, name text, note text, amount numeric(10,2));\n';
  for (let i = 0; i < rowsN; i += 500) {
    const vals = [];
    for (let j = i; j < i + 500; j++) vals.push('(' + j + ",'name " + j + "','note with ''quote'' and ; semicolon " + j + "'," + (j * 1.25).toFixed(2) + ')');
    ins += 'INSERT INTO big VALUES ' + vals.join(',') + ';\n';
  }
  let copy = 'CREATE TABLE big2 (id int, name text, note text, amount numeric);\nCOPY big2 (id, name, note, amount) FROM stdin;\n';
  for (let j = 0; j < rowsN; j++) copy += j + '\tname ' + j + '\tnote\\twith tab ' + j + '\t' + (j * 1.25).toFixed(2) + '\n';
  copy += '\\.\n';
  const text = ins + copy;
  const t0 = Date.now();
  const chunks = [];
  for (let i = 0; i < text.length; i += 1 << 20) chunks.push(text.slice(i, i + (1 << 20)));
  const r = DB.parseSqlDump(chunks);
  const ms = Date.now() - t0;
  const mb = (text.length / 1048576).toFixed(1);
  ok('time budget: ' + mb + ' MB, ' + (2 * rowsN) + ' rows in ' + ms + ' ms (budget 15000 ms)', ms < 15000 && sec(r, 'big').rows.length === rowsN && sec(r, 'big2').rows.length === rowsN &&
    sec(r, 'big2').rows[7][2] === 'note\twith tab 7' && sec(r, 'big').rows[3][2] === "note with 'quote' and ; semicolon 3", ms + ' ms');
}

/* ---- review of v1.3 (synthetic): values that must never end up in a column type ---- */
{
  const r = parse("CREATE TABLE [dbo].[Customers]([Id] [int] NOT NULL,[City] [nvarchar](50) NULL)\nGO\n" +
    "ALTER TABLE [dbo].[Customers] ADD  DEFAULT (N'CONFIDENTIAL_DEFAULT') FOR [City]\nGO\nALTER TABLE [dbo].[Customers] ADD [Extra] [int] NULL\nGO\n");
  const c = sec(r, 'Customers');
  ok('synthetic SQL Server ALTER TABLE ADD DEFAULT .. FOR: no column, no value', same(colNames(c), ['Id', 'City', 'Extra']) && !JSON.stringify(r).includes('CONFIDENTIAL'), JSON.stringify(c.columns.map((x) => [x.name, x.meta.sqlType])));
  ok('synthetic SQL Server: a bracketed built-in type is not a custom type', c.columns.every((x) => !x.meta.sqlTypeAnon || x.meta.sqlTypeAnon === x.meta.sqlType), JSON.stringify(c.columns.map((x) => x.meta.sqlTypeAnon)));
  const r2 = parse("CREATE TABLE t (s varchar(10) TITLE 'CONFIDENTIAL_T1', ea int ENGINE_ATTRIBUTE='CONFIDENTIAL_T2', d DateTime64(3,'CONFIDENTIAL_T3'), e enum('CONFIDENTIAL_T4','b'));\n" +
    "ALTER TABLE t ADD PARTITION (PARTITION p1 VALUES IN ('CONFIDENTIAL_T5'));\nALTER TABLE t ADD COLUMN z text;\n");
  const t = sec(r2, 't');
  const types = JSON.stringify(t.columns.map((x) => [x.meta.sqlType, x.meta.sqlTypeAnon]));
  ok('synthetic: quoted text in a type is replaced, partitions are not columns', same(colNames(t), ['s', 'ea', 'd', 'e', 'z']) && !types.includes('CONFIDENTIAL') && t.columns[4].meta.sqlType === 'text', types);
  ok('synthetic: enum labels still go to the values (shown with the labels switch)', t.columns[3].meta.values === 'CONFIDENTIAL_T4, b', t.columns[3].meta.values);
}
/* ---- review of v1.3 (synthetic): the SQL reader's bugs found in review, one case each ---- */
{
  const rowsOf = (r, n) => (sec(r, n) || { rows: [] }).rows;
  const timed = (f) => { const t0 = Date.now(); const r = f(); return [r, Date.now() - t0]; };
  // 1. an escape beyond U+10FFFF does not stop the reading
  let r;
  try { r = parse("-- PostgreSQL database dump\nCREATE TABLE t (a text);\nINSERT INTO t VALUES (E'x\\U00110000');\nINSERT INTO t VALUES ('ok');\n"); } catch (e) { r = null; }
  ok('review: \\U beyond U+10FFFF does not throw', !!r && rowsOf(r, 't').length === 2, r ? JSON.stringify(rowsOf(r, 't')) : 'threw');
  // 2. nested comments: linear
  let ms;
  [r, ms] = timed(() => parse('-- PostgreSQL database dump\nCREATE TABLE t (a int);\n' + '/* '.repeat(300000)));
  ok('review: 300,000 open nested comments in linear time', ms < 3000, ms + ' ms');
  // 3. backslashes in strings: linear (mysqldump writes BLOBs as escaped strings)
  [r, ms] = timed(() => parse('-- MySQL dump\nCREATE TABLE `t` (`b` blob);\nINSERT INTO `t` VALUES (\'' + '\\0x'.repeat(1000000) + '\');\n'));
  ok('review: a 3 MB escaped blob in linear time', ms < 3000 && rowsOf(r, 't').length === 1, ms + ' ms');
  [r, ms] = timed(() => parse('-- MySQL dump\nINSERT INTO `t` VALUES (\'' + '\\a'.repeat(1000000)));
  ok('review: an unterminated escaped string in linear time', ms < 3000, ms + ' ms');
  [r, ms] = timed(() => parse("-- PostgreSQL database dump\nINSERT INTO t VALUES (E'" + "''".repeat(500000) + "\\n');\n"));
  ok('review: doubled quotes before a far backslash in linear time', ms < 3000, ms + ' ms');
  // 4. SQL Server: BEGIN TRANSACTION is an ordinary statement
  r = parse('CREATE TABLE [dbo].[t]([a] int)\nGO\nBEGIN TRANSACTION;\nINSERT INTO [dbo].[t] ([a]) VALUES (1);\nINSERT INTO [dbo].[t] ([a]) VALUES (2);\nCOMMIT;\nGO\n');
  ok('review: SQL Server BEGIN TRANSACTION keeps the rows', same(rowsOf(r, 't'), [['1'], ['2']]), JSON.stringify([rowsOf(r, 't'), r.info.ignored]));
  // 5. columns named key, index, fulltext (pg_dump does not quote them)
  r = parse('-- PostgreSQL database dump\nCREATE TABLE public.t (id integer NOT NULL, key numeric(10,2), fulltext tsvector, index bit(8));\n');
  ok('review: columns named key, index, fulltext', same(colNames(sec(r, 't')), ['id', 'key', 'fulltext', 'index']), JSON.stringify(colNames(sec(r, 't'))));
  r = parse('-- MySQL dump\nCREATE TABLE `t` (`id` int, `body` text, KEY `k1` (`id`), FULLTEXT KEY `ft` (`body`), FULLTEXT ft2 (`body`)) ENGINE=InnoDB;\n');
  ok('review: MySQL KEY / FULLTEXT KEY are still indexes', same(colNames(sec(r, 't')), ['id', 'body']) && sec(r, 't').constraints.indexes.length === 3, JSON.stringify([colNames(sec(r, 't')), sec(r, 't').constraints.indexes]));
  // 6. SQL Server CAST(... AS type) values
  r = parse("CREATE TABLE [dbo].[t]([a] datetime, [b] decimal(10,2))\nGO\nINSERT [dbo].[t] ([a], [b]) VALUES (CAST(N'2020-01-01T00:00:00.000' AS DateTime), CAST(12.50 AS Decimal(10, 2)))\nGO\n");
  ok('review: SQL Server CAST values are decoded', same(rowsOf(r, 't'), [['2020-01-01T00:00:00.000', '12.50']]), JSON.stringify(rowsOf(r, 't')));
  // 7. mysqldump --compact --no-create-info
  r = parse("INSERT INTO `t` VALUES (1,'it\\'s'),(2,'x; y');\n");
  ok('review: compact MySQL data is read as MySQL', r.info.dialect === 'mysql' && same(rowsOf(r, 't'), [['1', "it's"], ['2', 'x; y']]), JSON.stringify([r.info.dialect, rowsOf(r, 't')]));
  // 8. MySQL \0 is NUL, never octal; \u and \x are letters
  r = parse("-- MySQL dump\nINSERT INTO `t` VALUES ('a\\012','\\ufeed','\\x41','50\\%');\n");
  ok('review: MySQL escapes', same(rowsOf(r, 't')[0], ['a\u000012', 'ufeed', 'x41', '50\\%']), JSON.stringify(rowsOf(r, 't')[0]));
  r = parse("-- PostgreSQL database dump\nINSERT INTO t VALUES (E'a\\101\\x42\\u0043 50\\%');\n");
  ok('review: PostgreSQL E-string escapes', same(rowsOf(r, 't')[0], ['aABC 50%']), JSON.stringify(rowsOf(r, 't')[0]));
  // 9. a trigger's sql_mode is restored after it
  r = parse("-- MySQL dump\n/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;\nCREATE TABLE `t` (`a` text);\n" +
    "/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;\n/*!50003 SET sql_mode              = 'NO_BACKSLASH_ESCAPES' */ ;\n" +
    "/*!50003 SET sql_mode              = @saved_sql_mode */ ;\nINSERT INTO `t` VALUES ('it\\'s'),('b');\n/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;\n");
  ok('review: NO_BACKSLASH_ESCAPES of a trigger ends with it', same(rowsOf(r, 't'), [["it's"], ['b']]), JSON.stringify(rowsOf(r, 't')));
  r = parse("-- MySQL dump\n/*!40101 SET SQL_MODE='NO_BACKSLASH_ESCAPES' */;\nINSERT INTO `t` VALUES ('a\\b');\n");
  ok('review: NO_BACKSLASH_ESCAPES for the whole dump still applies', same(rowsOf(r, 't'), [['a\\b']]), JSON.stringify(rowsOf(r, 't')));
  // 10. rows growing wider: linear
  let s = 'CREATE TABLE t (c1 int);\n';
  for (let k = 0; k < 100000; k++) s += 'INSERT INTO t VALUES (' + k + ');\n';
  for (let w = 2; w <= 1500; w++) s += 'INSERT INTO t VALUES (' + Array.from({ length: w }, (_, j) => j).join(',') + ');\n';
  [r, ms] = timed(() => parse(s));
  ok('review: rows growing wider in linear time, every row as wide as the table', ms < 8000 && sec(r, 't').rows.every((x) => x.length === 1500), ms + ' ms');
}

/* ---- v1.3.1: COPY byte escapes, and the size limit of archive data ---- */
{
  // \303\251 is the UTF-8 of "é" written byte by byte (octal); \xc3\xa9 the same in hex; \377 alone is not UTF-8
  const r = parse('-- PostgreSQL database dump\nCREATE TABLE t (a text, b text, c text);\nCOPY t (a, b, c) FROM stdin;\ncaf\\303\\251\t\\xc3\\xa9t\\xc3\\xa9\t\\377x\\tz\n\\.\n');
  ok('v1.3.1 (synthetic): COPY octal and hex escapes are UTF-8 bytes', same(sec(r, 't').rows[0], ['café', 'été', 'ÿx\tz']), JSON.stringify(sec(r, 't').rows[0]));
}
{
  const zlib = require('zlib');
  // a stream of many steps comes back whole and identical
  const data = Buffer.alloc(30e6);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7919 >>> 3) & 255;
  const back = DB.pgStreamed(ctx.fflate.Unzlib, new Uint8Array(zlib.deflateSync(data)));
  ok('v1.3.1: zlib data decoded step by step is identical (30 MB)', Buffer.from(back.buffer, back.byteOffset, back.length).equals(data), back.length);
  if (zlib.zstdCompressSync) {
    const z = DB.pgStreamed(ctx.fzstd.Decompress, new Uint8Array(zlib.zstdCompressSync(data)));
    ok('v1.3.1: zstd data decoded step by step is identical (30 MB)', Buffer.from(z.buffer, z.byteOffset, z.length).equals(data), z.length);
  }
  // the limit: every kind of real archive skips (and names) a table larger than the limit, and reads the rest
  ctx.DB.PG_ARCHIVE_LIMIT = 300;      // bytes, for the test (1 GB in the page)
  const bad = [];
  for (const f of ['pg16-custom.dump', 'pg16-custom-lz4.dump', 'pg16-custom-zstd.dump', 'pg17-custom.dump']) {
    let a;
    try { a = DB.parsePgArchive(readBin(f)).info.archive; } catch (e) { bad.push(f + ' threw ' + e.message); continue; }
    if (!a.skipped.length || !a.problems.some((p) => p.includes('larger than 1 GB'))) bad.push(f + ': ' + JSON.stringify(a.problems));
  }
  ctx.DB.PG_ARCHIVE_LIMIT = 0;
  const after = DB.parsePgArchive(readBin('pg16-custom-zstd.dump')).info.archive;
  ok('v1.3.1: archive data over the limit is skipped and named, not decompressed whole', !bad.length && !after.skipped.length, bad.join(' | '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
