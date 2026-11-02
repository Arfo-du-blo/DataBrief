#!/usr/bin/env node
/* Tests of the Avro reader (src/avro.js) and the Arrow / Feather reader (src/arrow.js + vendor/flechette.min.js) in Node.
 *   node tests/test_columnar.cjs
 * 1. The REAL files of tests/v14-fixtures/arrow-fixtures (written by fastavro and pyarrow) against expected.json and the data
 *    of make_sources.py (the values below are written by hand from it): every codec must give the same rows.
 * 2. Synthetic Avro files (marked synthetic: a small encoder below, written from the Avro specification): 64-bit values,
 *    logical types, named and recursive types, unions, blocks beyond the row limit, a cut file, hostile counts and schemas.
 * 3. Damaged Arrow / Feather files: a coded error, never a crash or a hang.
 * AVRO_SRC / ARROW_SRC: other copies of the readers (used to check that these tests catch broken readers). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'v14-fixtures');
const ctx = { console, TextDecoder, TextEncoder, Intl };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['src/util.js', 'vendor/fflate.min.js', 'vendor/fzstd.min.js', 'vendor/hyparquet.js', 'vendor/flechette.min.js', 'src/pgarchive.js',
  process.env.AVRO_SRC || 'src/avro.js', process.env.ARROW_SRC || 'src/arrow.js']) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const DB = ctx.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
const bytes = (...p) => new Uint8Array(fs.readFileSync(path.join(FIX, ...p)));
const names = (s) => s.columns.map((c) => c.name);
const types = (s, key) => Object.fromEntries(s.columns.map((c) => [c.name, c.meta[key]]));
const errKey = (fn) => { try { fn(); return 'no error'; } catch (e) { return e && e.key ? e.key : 'raw: ' + (e && e.message); } };
const time = (fn) => { const t0 = Date.now(); fn(); return Date.now() - t0; };

/* ---------------------------------------------------------------- 1. real Avro files ---------- */
{
  const E = EXP.avro;
  const results = E.files.map((f) => J(DB.parseAvro(bytes('arrow-fixtures', f))));
  const a = results[0], s = a.sections[0];
  ok('Avro: the 4 codecs (null, deflate, snappy, zstandard) give the same columns and rows', results.every((r) => same(r.sections, a.sections)), JSON.stringify(results.map((r) => r.sections[0].rows.length)));
  ok('Avro: the codec is named', same(results.map((r) => (r.fileMeta.find((m) => m[0] === 'mCodec') || [])[1]), ['null', 'deflate', 'snappy', 'zstandard']));
  ok('Avro: ' + E.rows + ' records', s.rows.length === E.rows && !s.rowsTotal);
  // every field of expected.json, in order; the record "address" is flattened
  ok('Avro: the fields in order, a record flattened (address.city, address.zip)', same(names(s), ['id', 'name', 'country', 'signup', 'notes', 'balance', 'tags', 'address.city', 'address.zip', 'prefs', 'last_login']) &&
    E.columns.every((c) => names(s).some((n) => n === c || n.startsWith(c + '.'))), JSON.stringify(names(s)));
  const T = types(s, 'avroType');
  const want = { id: 'long', country: 'enum', signup: 'date', notes: 'nullable string', balance: 'decimal(9,2)', tags: 'array<string>', 'address.city': 'string', 'address.zip': 'nullable string', prefs: 'map<boolean>', last_login: 'nullable timestamp-millis (UTC)' };
  ok('Avro: the types of the schema (expected.json)', Object.entries(want).every(([k, v]) => T[k] === v), JSON.stringify(T));
  const country = s.columns.find((c) => c.name === 'country');
  ok('Avro: the enum symbols as value labels (' + E.types.country + ')', country.meta.values === 'PT, CN, FR, IE', JSON.stringify(country.meta));
  ok('Avro: required fields marked, nullable ones not', s.columns.find((c) => c.name === 'id').meta.notNull && !s.columns.find((c) => c.name === 'notes').meta.notNull);
  const col = (n) => names(s).indexOf(n);
  const V = E.values;
  ok('Avro: row 1 (expected.json)', Object.entries(V.row1).every(([k, v]) => s.rows[0][col(k)] === v), JSON.stringify(s.rows[0]));
  ok('Avro: row 2 (a newline, non-Latin text, a null inside a record)', s.rows[1][col('name')] === V.row2.name && s.rows[1][col('notes')] === V.row2.notes &&
    s.rows[1][col('balance')] === V.row2.balance && s.rows[1][col('address.zip')] === '', JSON.stringify(s.rows[1]));
  ok('Avro: row 4 (nulls: notes, last_login)', s.rows[3][col('name')] === V.row4.name && s.rows[3][col('notes')] === '' && s.rows[3][col('balance')] === V.row4.balance && s.rows[3][col('last_login')] === '', JSON.stringify(s.rows[3]));
  // the rest, by hand from make_sources.py: tags ["vip"] then [], prefs {"email": k % 2 == 0}, last_login 2025-01-0k 09:30 UTC
  ok('Avro: array and map as JSON text, booleans as booleans', s.rows[0][col('tags')] === '["vip"]' && s.rows[1][col('tags')] === '[]' &&
    s.rows[0][col('prefs')] === '{"email":true}' && s.rows[1][col('prefs')] === '{"email":false}', JSON.stringify(s.rows.map((r) => [r[col('tags')], r[col('prefs')]])));
  ok('Avro: timestamps in UTC, dates as dates', s.rows[0][col('last_login')] === '2025-01-01 09:30:00' && s.rows[2][col('last_login')] === '2025-01-03 09:30:00' && s.rows[1][col('signup')] === '2023-03-17');
  ok('Avro: the record name and its documentation', same(a.fileMeta.find((m) => m[0] === 'mAvroRecord'), ['mAvroRecord', 'shop.Customer']) && s.description === 'one customer', JSON.stringify(a.fileMeta));
  ok('Avro: the notes say flattened and JSON columns', a.notes.flattened && a.notes.arrays);
}
{
  const c = J(DB.parseAvro(bytes('canary', 'CONFIDENTIAL_FILE_avro.avro')));
  const s = c.sections[0];
  ok('Avro canary: record name, doc and the writer\'s metadata are found (to be filtered by "Do not share data")', same(names(s), ['id', 'CONFIDENTIAL_COL_A', 'amount']) && s.rows.length === 6 &&
    s.description === 'CONFIDENTIAL_TEXT_AVRO_DOC' && same(c.embedded, [['note', 'CONFIDENTIAL_TEXT_AVRO_META']]) && c.fileMeta.some((m) => m[1] === 'CONFIDENTIAL_COL_RECORD'), JSON.stringify(c));
}

/* ---------------------------------------------------------------- 1. real Arrow / Feather files ---------- */
{
  const E = EXP.arrow;
  const ext = (f) => f.split('.').pop();
  const read = (f) => { const u = bytes('arrow-fixtures', f); const k = DB.arrowKind(u, ext(f)); return { k, r: J(DB.parseArrow(u, k)) }; };
  const all = E.files.map(read);
  ok('Arrow: file, stream and Feather v2 recognised', same(all.map((x) => x.k), ['file', 'stream', 'file', 'file', 'file']), JSON.stringify(all.map((x) => x.k)));
  const s = all[0].r.sections[0];
  ok('Arrow: the IPC file, the stream and Feather v2 (lz4, zstd, none) give the same columns and rows', all.every((x) => same(x.r.sections, all[0].r.sections)), JSON.stringify(all.map((x) => x.r.sections[0].rows.length)));
  ok('Arrow: the columns in order, the struct flattened', same(names(s), ['id', 'customer_id', 'total', 'status', 'ordered_at', 'items', 'shipping.carrier', 'shipping.days', 'note']) &&
    E.columns.every((c) => names(s).some((n) => n === c || n.startsWith(c + '.'))), JSON.stringify(names(s)));
  const T = types(s, 'arrowType');
  ok('Arrow: the types (expected.json)', T.id === 'int64' && T.customer_id === 'int32' && T.total === 'decimal128(9,2)' && T.status === 'dictionary<string>' &&
    T.ordered_at === 'timestamp[ms, Europe/Paris] (values in UTC)' && T.items === 'list<string>' && T['shipping.carrier'] === 'string' && T['shipping.days'] === 'int8' && T.note === 'large_string', JSON.stringify(T));
  const col = (n) => names(s).indexOf(n);
  const V = E.values;
  ok('Arrow: decimals with their scale (expected.json)', same(s.rows.map((r) => r[col('total')]), V.total));
  ok('Arrow: dictionary values decoded', same(s.rows.map((r) => r[col('status')]), V.status));
  ok('Arrow: large strings, a null, non-Latin text, a newline', same(s.rows.map((r) => r[col('note')]), V.note.map((x) => (x === null ? '' : x))));
  // by hand from make_sources.py: items [a,b] / [] / None / [c]; shipping UPS 2 / None / DHL 5 / (None, None); 2025-02-0d 12:00 (naive, read as UTC by pyarrow)
  ok('Arrow: lists as JSON text (an empty list is [], a null list empty)', same(s.rows.map((r) => r[col('items')]), ['["a","b"]', '[]', '', '["c"]']));
  ok('Arrow: struct fields, a null struct and a struct of nulls', same(s.rows.map((r) => [r[col('shipping.carrier')], r[col('shipping.days')]]), [['UPS', '2'], ['', ''], ['DHL', '5'], ['', '']]));
  ok('Arrow: timestamps in UTC', same(s.rows.map((r) => r[col('ordered_at')]), ['2025-02-01 12:00:00', '2025-02-02 12:00:00', '2025-02-03 12:00:00', '2025-02-04 12:00:00']));
  ok('Arrow: 2 record batches in the IPC file (expected.json)', same(all[0].r.fileMeta, [['mArrowBatches', '2']]), JSON.stringify(all[0].r.fileMeta));
  ok('Arrow: the schema metadata (expected.json)', all.every((x) => same(x.r.embedded, [['source', 'shop']])));
  ok('Arrow: the format named', all[0].r.formatName === 'Apache Arrow IPC file' && all[1].r.formatName === 'Apache Arrow IPC stream');
  const v1 = read(E.feather_v1.file);
  const s1 = v1.r.sections[0];
  ok('Feather v1: recognised and read (expected.json)', v1.k === 'feather1' && same(names(s1), E.feather_v1.columns) && s1.rows.length === E.feather_v1.rows &&
    same(s1.rows, [['10', '1', 'ok'], ['11', '1', ''], ['12', '2', '陈'], ['13', '4', 'x\ny']]) && same(types(s1, 'arrowType'), { id: 'int64', customer_id: 'int32', note: 'string' }), JSON.stringify(s1));
}
{
  for (const f of ['CONFIDENTIAL_FILE_arrow.arrow', 'CONFIDENTIAL_FILE_feather.feather']) {
    const u = bytes('canary', f);
    const c = J(DB.parseArrow(u, DB.arrowKind(u, f.split('.').pop())));
    ok('Arrow canary ' + f + ': columns, rows and the metadata found', same(names(c.sections[0]), ['id', 'CONFIDENTIAL_COL_A', 'amount']) && c.sections[0].rows.length === 6 &&
      same(c.embedded, [['note', 'CONFIDENTIAL_TEXT_ARROW_META']]), JSON.stringify(c));
  }
}

/* ---------------------------------------------------------------- 2. synthetic Avro (an encoder from the specification) ---------- */
const zz = (n) => { let v = BigInt(n); v = ((v << 1n) ^ (v >> 63n)) & 0xffffffffffffffffn; const out = []; do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return out; };
const enc = { long: zz, str: (s) => { const b = [...Buffer.from(s)]; return zz(b.length).concat(b); }, bytes: (b) => zz(b.length).concat([...b]) };
const SYNC = new Array(16).fill(0).map((_, i) => i * 7 + 3);
function avroFile(schema, blocks, opt) {
  opt = opt || {};
  const meta = [['avro.schema', JSON.stringify(schema)], ['avro.codec', opt.codec || 'null']].concat(opt.meta || []);
  let out = [0x4f, 0x62, 0x6a, 1].concat(zz(meta.length));
  for (const [k, v] of meta) out = out.concat(enc.str(k), enc.bytes(Buffer.from(v)));
  out = out.concat(zz(0), SYNC);
  for (const b of blocks) out = out.concat(zz(b.count), zz(b.data.length), b.data, b.sync || SYNC);
  return new Uint8Array(out);
}
{
  // 64-bit values, negatives, logical types, fixed, uuid, a union of several types, namespaces
  const schema = { type: 'record', name: 'T', namespace: 'a.b', fields: [
    { name: 'big', type: 'long' }, { name: 'neg', type: 'int' },
    { name: 'us', type: { type: 'long', logicalType: 'timestamp-micros' } }, { name: 't', type: { type: 'long', logicalType: 'time-micros' } },
    { name: 'id', type: { type: 'string', logicalType: 'uuid' } }, { name: 'h', type: { type: 'fixed', name: 'Hash', size: 2 } },
    { name: 'dec', type: { type: 'fixed', name: 'Money', size: 3, logicalType: 'decimal', precision: 6, scale: 3 } },
    { name: 'u', type: ['null', 'int', 'string'] }, { name: 'again', type: 'Hash' }, { name: 'f', type: 'double' }, { name: 'b', type: 'boolean' },
  ] };
  const row = [].concat(zz(2n ** 62n + 1n), zz(-5), zz(1700000000123456n), zz(3723000001n), enc.str('5f0c…'), [0xab, 0xcd], [0xff, 0xfe, 0x0c] /* -500 */,
    zz(2), enc.str('x'), [0x01, 0x02], [...Buffer.from(new Float64Array([1.5]).buffer)], [1]);
  const r = J(DB.parseAvro(avroFile(schema, [{ count: 1, data: row }])));
  const s = r.sections[0];
  ok('synthetic Avro: 64-bit long exact, negative int, timestamp-micros, time-micros, uuid, fixed, fixed decimal, union, a named type reused', same(s.rows[0],
    ['4611686018427387905', '-5', '2023-11-14 22:13:20.123456', '01:02:03.000001', '5f0c…', '0xabcd', '-0.500', 'x', '0x0102', '1.5', 'true']), JSON.stringify(s.rows[0]));
  ok('synthetic Avro: their types', same(s.columns.map((c) => c.meta.avroType), ['long', 'int', 'timestamp-micros (UTC)', 'time-micros', 'uuid', 'fixed(2)', 'decimal(6,3)', 'union<null, int, string>', 'fixed(2)', 'double', 'boolean']), JSON.stringify(s.columns.map((c) => c.meta.avroType)));
}
{
  // a recursive type (a linked list): one column of JSON text, no endless loop
  const schema = { type: 'record', name: 'Node', fields: [{ name: 'v', type: 'int' }, { name: 'next', type: ['null', 'Node'] }] };
  const row = [].concat(zz(1), zz(1), zz(2), zz(1), zz(3), zz(0));
  const s = J(DB.parseAvro(avroFile(schema, [{ count: 1, data: row }]))).sections[0];
  ok('synthetic Avro: a recursive record is read (its nested part as JSON text)', s.rows.length === 1 && s.rows[0][0] === '1' && s.rows[0].join('|').includes('"v":3'), JSON.stringify(s));
}
{
  // rows beyond the limit: counted from the block headers (the data of those blocks is never decoded)
  const schema = { type: 'record', name: 'R', fields: [{ name: 'n', type: 'long' }] };
  const block = (from, k) => ({ count: k, data: [].concat(...Array.from({ length: k }, (_, i) => zz(from + i))) });
  const garbage = { count: 1000, data: new Array(50).fill(0xff) };      // not valid records: must not be decoded
  const r = J(DB.parseAvro(avroFile(schema, [block(0, 3), block(3, 3), garbage]), { maxRows: 4 }));
  ok('synthetic Avro: 4 rows kept, 1,006 counted from the block headers', r.sections[0].rows.length === 4 && r.sections[0].rowsTotal === 1006 && r.sections[0].rows[3][0] === '3' && same(r.fileMeta.find((m) => m[0] === 'mAvroBlocks'), ['mAvroBlocks', '3']), JSON.stringify(r));
  // a block whose sync marker is wrong (a damaged file): the blocks before it are kept, and the prompt says so
  const bad = J(DB.parseAvro(avroFile(schema, [block(0, 2), Object.assign(block(2, 2), { sync: new Array(16).fill(9) }), block(4, 2)])));
  ok('synthetic Avro: a damaged block (wrong sync marker) is dropped and stops the reading: the rows before it kept, the cut named', bad.sections[0].rows.length === 2 && bad.fileMeta.some((m) => m[0] === 'mAvroCut'), JSON.stringify(bad));
  // a file of plain values (the schema is not a record): one column "value"
  const plain = J(DB.parseAvro(avroFile('string', [{ count: 2, data: [].concat(enc.str('a'), enc.str('b')) }]))).sections[0];
  ok('synthetic Avro: a file of plain values is one column "value"', same(names(plain), ['value']) && same(plain.rows, [['a'], ['b']]), JSON.stringify(plain));
  // deflate written by Node's zlib (raw deflate, as the specification says)
  const zlib = require('zlib');
  const raw = block(0, 3);
  const z = J(DB.parseAvro(avroFile(schema, [{ count: 3, data: [...zlib.deflateRawSync(Buffer.from(raw.data))] }], { codec: 'deflate' }))).sections[0];
  ok('synthetic Avro: deflate (written by Node zlib)', same(z.rows, [['0'], ['1'], ['2']]), JSON.stringify(z));
  ok('synthetic Avro: an unsupported codec is named', errKey(() => DB.parseAvro(avroFile(schema, [{ count: 1, data: [1, 2] }], { codec: 'bzip2' }))) === 'errCodecAvro');
}
{
  // hostile: huge counts, deep schemas, bad union branches, bad lengths -> an error or the rows so far, quickly
  const nulls = { type: 'record', name: 'R', fields: [{ name: 'a', type: { type: 'array', items: 'null' } }] };
  let ms = time(() => DB.parseAvro(avroFile(nulls, [{ count: 1, data: [].concat(zz(2n ** 40n), zz(0)) }])));
  ok('hostile Avro: an array of 2^40 nulls is refused quickly (' + ms + ' ms)', ms < 2000);
  let deep = 'long';
  for (let i = 0; i < 200; i++) deep = { type: 'array', items: deep };
  ok('hostile Avro: a schema nested 200 deep is refused', errKey(() => DB.parseAvro(avroFile({ type: 'record', name: 'D', fields: [{ name: 'x', type: deep }] }, [])) ) === 'errCorrupt');
  const u = { type: 'record', name: 'U', fields: [{ name: 'x', type: ['null', 'int'] }] };
  const r = J(DB.parseAvro(avroFile(u, [{ count: 2, data: [].concat(zz(1), zz(5), zz(7)) }])));
  ok('hostile Avro: a union branch that does not exist stops the reading (rows before it kept)', r.sections[0].rows.length === 1 && r.fileMeta.some((m) => m[0] === 'mAvroCut'), JSON.stringify(r));
  const s = { type: 'record', name: 'S', fields: [{ name: 'x', type: 'string' }] };
  const r2 = J(DB.parseAvro(avroFile(s, [{ count: 1, data: zz(1000000) }])));
  ok('hostile Avro: a string longer than its block is not read past the end', r2.sections[0].rows.length === 0 && r2.fileMeta.some((m) => m[0] === 'mAvroCut'), JSON.stringify(r2));
  ok('hostile Avro: an unknown type name is refused', errKey(() => DB.parseAvro(avroFile({ type: 'record', name: 'X', fields: [{ name: 'x', type: 'Nope' }] }, []))) === 'errCorrupt');
  ok('hostile Avro: a header cut short is refused', errKey(() => DB.parseAvro(avroFile(s, []).subarray(0, 30))) === 'errCorrupt');
  ms = time(() => { for (let i = 0; i < 300; i++) { const f = avroFile(s, [{ count: 3, data: [].concat(enc.str('abc'), enc.str('d'), enc.str('e')) }]); const k = 20 + (i * 37) % (f.length - 20); f[k] ^= 0xff; errKey(() => DB.parseAvro(f)); } });
  ok('hostile Avro: 300 files with one damaged byte, each read or refused (' + ms + ' ms)', ms < 5000);
}

/* ---------------------------------------------------------------- 3. damaged Arrow / Feather ---------- */
{
  const good = bytes('arrow-fixtures', 'orders.arrow');
  ok('Arrow: a cut IPC file gives a coded error', errKey(() => DB.parseArrow(good.subarray(0, 1500), 'file')) === 'errCorrupt');
  const v1 = bytes('arrow-fixtures', 'orders-v1.feather');
  const broken = v1.slice(); broken[broken.length - 8] = 0xff; broken[broken.length - 7] = 0xff;     // metadata length out of range
  ok('Feather v1: a metadata length out of range gives a coded error', errKey(() => DB.parseArrow(broken, 'feather1')) === 'errCorrupt');
  let raw = 0, ms = time(() => {
    for (let i = 0; i < 300; i++) {
      const f = (i % 2 ? good : v1).slice();
      const k = 8 + (i * 97) % (f.length - 16); f[k] ^= 0x5a;
      const e = errKey(() => DB.parseArrow(f, i % 2 ? 'file' : 'feather1'));
      if (e.startsWith('raw')) raw++;
    }
  });
  ok('Arrow / Feather: 300 files with one damaged byte: read, or a coded error (' + ms + ' ms, ' + raw + ' raw errors)', raw === 0 && ms < 10000);
  // every file of arrow-fixtures with 1 to 4 random bytes (a fixed seed: this run once crashed on a list offset of 2 billion)
  const files = fs.readdirSync(path.join(FIX, 'arrow-fixtures')).sort().map((f) => [f, bytes('arrow-fixtures', f)]);
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const outcome = {};
  raw = 0;
  ms = time(() => {
    for (let i = 0; i < 3000; i++) {
      const [name, u] = files[i % files.length], f = u.slice();
      for (let j = 1 + rnd(4); j > 0; j--) f[rnd(f.length)] = rnd(256);
      const x = name.split('.').pop();
      const e = errKey(() => { if (x === 'avro') DB.parseAvro(f); else { const k = DB.arrowKind(f, x); if (k) DB.parseArrow(f, k); } });
      if (e.startsWith('raw')) raw++;
      outcome[e] = (outcome[e] || 0) + 1;
    }
  });
  ok('Avro / Arrow / Feather: 3,000 damaged copies of the real files: read, or a coded error (' + ms + ' ms, ' + JSON.stringify(outcome) + ')', raw === 0 && ms < 20000);
  ok('Arrow: not recognised by its extension alone (a CSV named .arrow)', DB.arrowKind(new Uint8Array(Buffer.from('id,x\n1,2\n')), 'arrow') === '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
