#!/usr/bin/env node
/* Checks the files written by the commands of the export helper (tests/test_export_commands.sh) with DataBrief's own SQL reader,
 * against the hand-written oracle tests/sql-fixtures/expected.json (the "shop" database).
 *   node tests/check_export_outputs.cjs <folder>   (folder/<engine>/schema.sql, dump.sql ... as written by the harness) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const dir = process.argv[2];
const ctx = { console, TextDecoder, TextEncoder, Intl };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['vendor/fflate.min.js', 'vendor/fzstd.min.js', 'src/util.js', process.env.SQLDUMP_SRC || 'src/sqldump.js', 'src/pgarchive.js', 'src/relationships.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const DB = ctx.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'sql-fixtures', 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 500) : '')); } };
const has = (e, f) => fs.existsSync(path.join(dir, e, f));
const text = (e, f) => fs.readFileSync(path.join(dir, e, f), 'utf8');
const ALL = Object.keys(EXP.tables).sort();
const CH = ['customers', 'order_items', 'orders'];
const sec = (r, n) => r.sections.find((s) => s.name === n);

function schema(engine, file, tables, fks, label) {
  if (!has(engine, file)) return ok(engine + ' ' + label + ': file written', false, file + ' missing');
  const r = DB.parseSqlDump(text(engine, file), {});
  const names = r.sections.map((s) => s.name).sort();
  ok(engine + ' ' + label + ': tables', JSON.stringify(names) === JSON.stringify(tables.slice().sort()), names.join(','));
  const n = r.sections.reduce((a, s) => a + ((s.constraints && s.constraints.fks) || []).length, 0);
  ok(engine + ' ' + label + ': declared foreign keys', n === fks, 'found ' + n + ', expected ' + fks);
  return r;
}
function rows(engine, file, tables, expectRows) {
  const r = schema(engine, file, tables, expectRows === 'ch' ? 0 : 6, 'with data');
  if (!r) return;
  const bad = [];
  for (const t of tables) {
    const e = EXP.tables[t], s = sec(r, t);
    const want = expectRows === 'ch' ? { customers: 5, orders: 3, order_items: 3 }[t] : e.rows;
    if (!s || s.rows.length !== want) bad.push(t + ':' + (s ? s.rows.length : 'none') + '/' + want);
  }
  ok(engine + ' with data: row counts', !bad.length, bad.join(' '));
}
// the foreign-key listing: each declared relationship appears with both of its tables, on one line
function fkList(engine, file) {
  if (!has(engine, file)) return ok(engine + ' foreign-key query: file written', false, file + ' missing');
  const lines = text(engine, file).split(/\r?\n/).filter(Boolean);
  const miss = EXP.declaredForeignKeys.filter((f) => !lines.some((l) => l.includes(f.from) && l.includes(f.to)));
  ok(engine + ' foreign-key query: the 6 relationships', !miss.length, 'missing ' + miss.map((f) => f.from + '->' + f.to).join(', ') + ' in ' + lines.length + ' lines');
}

for (const e of ['postgresql', 'mysql', 'mariadb']) {
  if (!fs.existsSync(path.join(dir, e))) { console.log('SKIP ' + e + ' (not run)'); continue; }
  schema(e, 'schema.sql', ALL, 6, 'schema only');
  const s = DB.parseSqlDump(text(e, 'schema.sql'), {});
  ok(e + ' schema only: no row', s.sections.every((x) => x.rows.length === 0));
  rows(e, 'dump.sql', ALL);
  fkList(e, e === 'postgresql' ? 'foreign_keys.csv' : 'foreign_keys.tsv');
}
if (fs.existsSync(path.join(dir, 'sqlite'))) {
  schema('sqlite', 'schema.sql', ALL, 6, 'schema only');
  rows('sqlite', 'dump.sql', ALL);
  fkList('sqlite', 'foreign_keys.csv');
}
if (fs.existsSync(path.join(dir, 'duckdb'))) {
  schema('duckdb', 'schema.sql', ALL, 6, 'schema only');
  ok('duckdb export folder: schema.sql, load.sql and the data files', ['export/schema.sql', 'export/load.sql', 'export/customers.csv'].every((f) => has('duckdb', f)));
  fkList('duckdb', 'foreign_keys.csv');
}
if (fs.existsSync(path.join(dir, 'clickhouse'))) {
  schema('clickhouse', 'schema.sql', CH, 0, 'schema only');
  const c = text('clickhouse', 'customers.csv').split(/\r?\n/).filter(Boolean);
  const recs = c.filter((l) => /^\d+,/.test(l)).length;   // a note holds a newline inside quotes: count records, not lines
  ok('clickhouse data: header and 5 rows', recs === 5 && /^"?id"?,/.test(c[0]), recs + ' records: ' + c[0]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
