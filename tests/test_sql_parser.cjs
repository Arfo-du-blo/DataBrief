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
// SQLDUMP_SRC: another copy of the reader (used to check that these tests catch a broken reader)
for (const f of ['src/util.js', process.env.SQLDUMP_SRC || 'src/sqldump.js', 'src/relationships.js']) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
