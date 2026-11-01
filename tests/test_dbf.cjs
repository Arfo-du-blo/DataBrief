#!/usr/bin/env node
/* Tests of the DBF reader (src/dbf.js) in Node, without a browser.   node tests/test_dbf.cjs
 * 1. REAL .dbf files written by the independent `dbf` library (tests/dbf-fixtures, tests/make_dbf_fixtures.py) against the values that
 *    went in (expected.json): dBase III, DOS code pages, Cyrillic, FoxPro with a memo, Visual FoxPro (integer, currency, double,
 *    datetime, nullable text), an empty table, a cut file.
 * 2. The language-driver table against that library's own table, for all 256 values.
 * 3. Damaged files never throw anything but the clear error; large files are cut at the row limit. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'dbf-fixtures');
const ctx = { console, TextDecoder, TextEncoder, Intl };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['src/util.js', 'src/dbf-codepages.js', process.env.DBF_SRC || 'src/dbf.js']) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const DB = ctx.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));
const LANGIDS = JSON.parse(fs.readFileSync(path.join(FIX, 'langids.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (f) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
const meta = (r, key) => { const m = r.fileMeta.find((x) => x[0] === key); return m ? m[1] : undefined; };

/* ---------------------------------------------------------------- 1. real files ---------- */
const ENC = { cp1252: 'windows-1252', cp437: 'cp437', cp866: 'ibm866', cp1251: 'windows-1251' };
const VERSION = { dbase3: 'dBase III with memo (0x83)', dos437: 'dBase III / FoxPro 2.x (0x03)', foxpro: 'FoxPro 2.x with memo (0xf5)', vfp: 'Visual FoxPro (0x30)' };
for (const name of ['dbase3', 'dos437', 'cyrillic866', 'cyrillic1251', 'foxpro', 'vfp', 'empty']) {
  const e = EXP[name];
  const u8 = bytes(name + '.dbf');
  ok(name + ': recognised as a DBF', DB.looksLikeDbf(u8));
  let r = null, err = null;
  try { r = DB.parseDbf(u8); } catch (x) { err = x; }
  if (!r) { ok(name + ': read', false, err && err.stack); continue; }
  const s = r.sections[0];
  ok(name + ': column names', same(s.columns.map((c) => c.name), e.columns), JSON.stringify(s.columns.map((c) => c.name)));
  ok(name + ': rows', same(s.rows, e.rows), JSON.stringify(s.rows).slice(0, 300) + ' / want ' + JSON.stringify(e.rows).slice(0, 300));
  ok(name + ': counts (records ' + e.records + ', deleted ' + e.deleted + ')', s.rowsTotal === e.rows.length && (meta(r, 'mDeleted') || '0') === String(e.deleted));
  ok(name + ': encoding ' + ENC[e.codepage], String(meta(r, 'mEncoding')) === ENC[e.codepage], meta(r, 'mEncoding'));
  if (VERSION[name]) ok(name + ': version "' + VERSION[name] + '"', meta(r, 'mDbVersion') === VERSION[name], meta(r, 'mDbVersion'));
  ok(name + ': every row has one value per column', s.rows.every((row) => row.length === s.columns.length));
}
{
  const r = DB.parseDbf(bytes('dbase3.dbf'));
  ok('dbase3: memo field named, never filled', meta(r, 'mMemo') === '`NOTE`' && r.sections[0].rows.every((row) => row[5] === ''), meta(r, 'mMemo'));
  ok('dbase3: SQL-like types', same(r.sections[0].columns.map((c) => c.meta.sqlType), ['CHAR(20)', 'NUMERIC(10,2)', 'NUMERIC(5)', 'DATE', 'BOOLEAN', 'MEMO']), JSON.stringify(r.sections[0].columns.map((c) => c.meta.sqlType)));
  const v = DB.parseDbf(bytes('vfp.dbf'));
  ok('vfp: types and the hidden _NullFlags field is not a column', same(v.sections[0].columns.map((c) => c.meta.sqlType), ['INTEGER', 'CURRENCY', 'DOUBLE', 'DATETIME', 'CHAR(12)', 'BOOLEAN', 'INTEGER', 'CURRENCY']), JSON.stringify(v.sections[0].columns.map((c) => c.meta.sqlType)));
  // The library writes no VFP null flags, so a record is patched by hand (SYNTHETIC): bit n of _NullFlags = the n-th nullable field is NULL
  {
    const u = bytes('vfp.dbf').slice();
    const hdr = u[8] | (u[9] << 8), rec = u[10] | (u[11] << 8);
    const nf = hdr + 1 * rec + rec - 1;                // the last byte of the second record: _NullFlags
    u[nf] = 0b00000110;                                 // nullable fields in order: NAME (bit 0), QTY (bit 1), AMT (bit 2) -> QTY and AMT are NULL
    const row = DB.parseDbf(u).sections[0].rows[1];
    ok('vfp (synthetic null flags): QTY and AMT null -> empty, NAME stays (bit 0 clear)', row[4] === '' && row[6] === '' && row[7] === '' && row[0] === '2', JSON.stringify(row));
    const u2 = bytes('vfp.dbf').slice();
    u2[hdr + 2 * rec + rec - 1] = 0b00000001;           // the third record: only NAME is NULL; QTY 0 and AMT 0 are real zeros
    const r3 = DB.parseDbf(u2).sections[0].rows[2];
    ok('vfp (synthetic null flags): a real zero stays 0', r3[6] === '0' && r3[7] === '0' && r3[4] === '', JSON.stringify(r3));
  }
  ok('foxpro: memo field named', meta(DB.parseDbf(bytes('foxpro.dbf')), 'mMemo') === '`DESCR`');
  const e = DB.parseDbf(bytes('empty.dbf'));
  ok('empty table: columns, no row', e.sections[0].columns.length === 2 && e.sections[0].rows.length === 0 && e.sections[0].rowsTotal === 0);
  // the DOS text really is the text that was written (the box and accent characters of code page 437)
  ok('dos437: the characters', DB.parseDbf(bytes('dos437.dbf')).sections[0].rows[0][0] === 'Café ñandú über');
}
{
  const r = DB.parseDbf(bytes('cut.dbf'));
  ok('cut file: the complete records are read, the missing ones counted', r.sections[0].rows.length === 3 && same(r.sections[0].rows, EXP.dbase3.rows.slice(0, 3)) && meta(r, 'mCutRecords') === '2',
    JSON.stringify([r.sections[0].rows.length, meta(r, 'mCutRecords')]));
}

/* ---------------------------------------------------------------- 2. language drivers vs the library's table ---------- */
{
  const TO_SPEC = { cp437: 'dos:437', cp850: 'dos:850', cp852: 'dos:852', cp857: 'dos:857', cp737: 'dos:737', cp860: 'dos:860', cp861: 'dos:861', cp863: 'dos:863', cp865: 'dos:865',
    cp866: 'ibm866', cp1250: 'windows-1250', cp1251: 'windows-1251', cp1252: 'windows-1252', cp1253: 'windows-1253', cp1254: 'windows-1254', cp1255: 'windows-1255',
    cp1256: 'windows-1256', cp1257: 'windows-1257', cp874: 'windows-874', cp932: 'shift_jis', cp936: 'gbk', cp949: 'euc-kr', cp950: 'big5', mac_roman: 'macintosh',
    mac_cyrillic: 'x-mac-cyrillic', utf8: 'utf-8' };
  const bad = [];
  for (let id = 0; id < 256; id++) {
    const key = '0x' + id.toString(16).padStart(2, '0');
    const py = LANGIDS[key];
    const want = TO_SPEC[py];                       // undefined for ascii, None, mac_greek, mac_latin2: not supported, decoded by detection
    if (DB.DBF_LANG[id] !== want) bad.push(key + ' ' + py + ' -> ' + DB.DBF_LANG[id] + ' (want ' + want + ')');
  }
  ok('language-driver table agrees with the dbf library for all 256 values', !bad.length, bad.join('; '));
  const cp = DB.DBF_CODEPAGES;
  ok('DOS code page tables: 9 pages of 128 characters, spot checks', Object.keys(cp).length === 9 && Object.values(cp).every((t) => t.length === 128) &&
    cp[437][0] === 'Ç' && cp[437][0x7f] === ' ' && cp[850][0x55] === 'ı' && cp[852][0x61] === 'ß' && cp[737][0] === 'Α' && cp[865][0x1e] === '₧', JSON.stringify(Object.keys(cp)));
}

/* ---------------------------------------------------------------- 3. robustness ---------- */
{
  const bad = [];
  let cleanErrors = 0;
  for (const name of ['dbase3', 'vfp', 'foxpro']) {
    const full = bytes(name + '.dbf');
    for (let cut = 0; cut <= full.length; cut++) {
      try { DB.parseDbf(full.subarray(0, cut)); } catch (e) { if (e instanceof DB.UserError && e.key === 'errCorrupt') cleanErrors++; else bad.push(name + ' cut ' + cut + ': ' + e.message); }
    }
  }
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const t0 = Date.now();
  for (let n = 0; n < 1500; n++) {
    const u = bytes(['dbase3', 'vfp', 'foxpro', 'dos437'][rnd(4)] + '.dbf').slice();
    for (let k = rnd(8); k >= 0; k--) u[rnd(Math.min(u.length, rnd(2) ? 64 : u.length))] = rnd(256);
    try { DB.parseDbf(u); } catch (e) { if (!(e instanceof DB.UserError && e.key === 'errCorrupt')) bad.push('fuzz ' + n + ': ' + e.message); }
  }
  ok('every cut and 1500 damaged files: a result or the clear error, nothing else (' + cleanErrors + ' clean errors, ' + (Date.now() - t0) + ' ms)', !bad.length, bad.slice(0, 5).join('; '));
  const text = new TextEncoder().encode('a,b,c\n1,2,3\n4,5,6\n');
  ok('not a DBF: text, zeros, a SQLite header, random bytes', !DB.looksLikeDbf(text) && !DB.looksLikeDbf(new Uint8Array(500)) && !DB.looksLikeDbf(new TextEncoder().encode('SQLite format 3\0'.padEnd(200, 'x'))) &&
    !DB.looksLikeDbf(Uint8Array.from({ length: 400 }, (_, i) => (i * 131 + 7) & 255)));
  let err = null; try { DB.parseDbf(text); } catch (e) { err = e; }
  ok('parsing text as a DBF: the clear error', err && err.key === 'errCorrupt');
}
{
  // a large table: cut at the row limit, the total stays exact
  const n = 300000, rec = 1 + 10 + 8, hdr = 32 + 2 * 32 + 1;
  const u = new Uint8Array(hdr + n * rec + 1);
  const dv = new DataView(u.buffer);
  u[0] = 3; dv.setUint32(4, n, true); dv.setUint16(8, hdr, true); dv.setUint16(10, rec, true); u[29] = 3;
  const field = (i, name, type, len, dec) => { const p = 32 + i * 32; for (let k = 0; k < name.length; k++) u[p + k] = name.charCodeAt(k); u[p + 11] = type.charCodeAt(0); u[p + 16] = len; u[p + 17] = dec; };
  field(0, 'NAME', 'C', 10, 0); field(1, 'AMOUNT', 'N', 8, 0);
  u[32 + 64] = 0x0d;
  for (let i = 0; i < n; i++) {
    const o = hdr + i * rec;
    u[o] = 0x20;
    const s = 'name' + String(i % 100000).padEnd(6, ' ');
    for (let k = 0; k < 10; k++) u[o + 1 + k] = s.charCodeAt(k);
    const a = String(i).padStart(8, ' ');
    for (let k = 0; k < 8; k++) u[o + 11 + k] = a.charCodeAt(k);
  }
  u[u.length - 1] = 0x1a;
  const t0 = Date.now();
  const r = DB.parseDbf(u, { maxRows: 250000 });
  const ms = Date.now() - t0;
  const s = r.sections[0];
  ok('large table (' + n + ' records) cut at 250,000 rows, total exact, in ' + ms + ' ms (budget 5000)', s.rows.length === 250000 && s.rowsTotal === n && meta(r, 'mRowsCut') === '250000' &&
    s.rows[7][0] === 'name7' && s.rows[7][1] === '7' && ms < 5000, JSON.stringify([s.rows.length, s.rowsTotal, ms]));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
