/* DataBrief - Apache Arrow IPC (.arrow file, .arrows stream) and Feather (v2 = Arrow IPC file; v1 = the old format). GPL-3.0-or-later.
 *
 * DB.arrowKind(u8, ext) -> 'file' | 'stream' | 'feather1' | ''; DB.parseArrow(u8, kind, { maxRows }) -> { sections: [one],
 * fileMeta, notes, embedded, formatName }.
 * Arrow IPC is read by the vendored @uwdata/flechette (vendor/flechette.min.js, tools/build-flechette.sh), with the LZ4 frame
 * decoder of pgarchive.js and fzstd for compressed record batches. Feather v1 is read here (a FlatBuffers footer and plain
 * buffers). A struct is flattened (shipping.carrier), lists, maps and unions are one column of JSON text, like Parquet.
 * Values are shown as people read them: decimals with their scale, dates, timestamps in UTC (the column type says the time
 * zone the writer gave), times, binary in hexadecimal. */
'use strict';
(function () {
  const DB = window.DB;
  const UserError = DB.UserError;
  const UNIT = ['s', 'ms', 'us', 'ns'];
  const PER_MS = [0.001, 1, 1000, 1000000];   // units per millisecond
  let EXT = '.arrow';                         // the extension named in error messages (set by DB.parseArrow)

  const s4 = (u8, a) => String.fromCharCode(u8[a], u8[a + 1], u8[a + 2], u8[a + 3]);
  DB.arrowKind = function (u8, ext) {
    if (u8.length >= 12 && s4(u8, 0) === 'ARRO' && u8[4] === 0x57 && u8[5] === 0x31 && u8[6] === 0 && u8[7] === 0) return 'file';   // ARROW1, padded to 8
    if (u8.length >= 12 && s4(u8, 0) === 'FEA1' && s4(u8, u8.length - 4) === 'FEA1') return 'feather1';
    // a stream starts with a message: the continuation marker 0xFFFFFFFF, or (before Arrow 0.15) its length directly
    if (u8.length >= 8 && ['arrows', 'arrow', 'ipc', 'feather', 'stream'].includes(ext) &&
      ((u8[0] === 0xff && u8[1] === 0xff && u8[2] === 0xff && u8[3] === 0xff) || (u8[3] === 0 && u8[2] < 0x10 && (u8[0] | u8[1] | u8[2])))) return 'stream';
    return '';
  };

  /* ---------- the type of a field, as Arrow writes it ---------- */
  function typeName(t, anon, depth) {
    if (!t || depth > 32) return '?';
    const T = window.flechette.Type;
    const child = (i) => (t.children && t.children[i] ? typeName(t.children[i].type, anon, depth + 1) : '?');
    switch (t.typeId) {
      case T.Null: return 'null';
      case T.Int: return (t.signed ? 'int' : 'uint') + t.bitWidth;
      case T.Float: return ['float16', 'float32', 'float64'][t.precision] || 'float';
      case T.Binary: return 'binary';
      case T.LargeBinary: return 'large_binary';
      case T.BinaryView: return 'binary_view';
      case T.Utf8: return 'string';
      case T.LargeUtf8: return 'large_string';
      case T.Utf8View: return 'string_view';
      case T.Bool: return 'bool';
      case T.Decimal: return 'decimal' + (t.bitWidth || 128) + '(' + t.precision + ',' + t.scale + ')';
      case T.Date: return t.unit === 0 ? 'date32' : 'date64';
      case T.Time: return 'time' + t.bitWidth + '[' + UNIT[t.unit] + ']';
      case T.Timestamp: return 'timestamp[' + UNIT[t.unit] + (t.timezone ? ', ' + t.timezone : '') + ']';
      case T.Interval: return 'interval';
      case T.Duration: return 'duration[' + UNIT[t.unit] + ']';
      case T.FixedSizeBinary: return 'fixed_size_binary[' + t.stride + ']';
      case T.List: return 'list<' + child(0) + '>';
      case T.LargeList: return 'large_list<' + child(0) + '>';
      case T.ListView: return 'list_view<' + child(0) + '>';
      case T.LargeListView: return 'large_list_view<' + child(0) + '>';
      case T.FixedSizeList: return 'fixed_size_list<' + child(0) + '>[' + t.stride + ']';
      case T.Struct: return anon ? 'struct<' + (t.children || []).map((c) => typeName(c.type, true, depth + 1)).join(', ') + '>'
        : 'struct{' + (t.children || []).map((c) => c.name + ': ' + typeName(c.type, false, depth + 1)).join(', ') + '}';
      case T.Map: {
        const kv = t.children && t.children[0] && t.children[0].type && t.children[0].type.children;
        return kv ? 'map<' + typeName(kv[0].type, anon, depth + 1) + ', ' + typeName(kv[1].type, anon, depth + 1) + '>' : 'map';
      }
      case T.Union: return 'union<' + (t.children || []).map((c) => typeName(c.type, anon, depth + 1)).join(', ') + '>';
      case T.Dictionary: return 'dictionary<' + typeName(t.dictionary, anon, depth + 1) + '>';
      case T.RunEndEncoded: return 'run_end_encoded<' + (t.children && t.children[1] ? typeName(t.children[1].type, anon, depth + 1) : '?') + '>';
      default: return 'type ' + t.typeId;
    }
  }

  /* ---------- a value as text ---------- */
  function toPlain(v, depth) {
    if (depth > 32) return null;
    if (v === null || v === undefined) return null;
    if (v instanceof Uint8Array) return '0x' + DB.cellFmt.hex(v);
    if (ArrayBuffer.isView(v)) return Array.from(v, (x) => (typeof x === 'bigint' ? x : x));
    if (v instanceof Map) {
      const o = {}; let strKeys = true;
      for (const k of v.keys()) if (typeof k !== 'string') strKeys = false;
      if (!strKeys) return Array.from(v, ([k, x]) => [toPlain(k, depth + 1), toPlain(x, depth + 1)]);
      for (const [k, x] of v) o[k] = toPlain(x, depth + 1);
      return o;
    }
    if (Array.isArray(v)) return v.map((x) => toPlain(x, depth + 1));
    if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = toPlain(v[k], depth + 1); return o; }
    return v;
  }
  /* the text of a leaf value of type t */
  function cell(v, t) {
    if (v === null || v === undefined) return '';
    const T = window.flechette.Type, F = DB.cellFmt;
    const id = t.typeId === T.Dictionary ? t.dictionary.typeId : t.typeId;
    const tt = t.typeId === T.Dictionary ? t.dictionary : t;
    switch (id) {
      case T.Decimal: return F.scaled(v, tt.scale);   // an integer of the smallest unit (a Number for decimal32)
      case T.Date: return tt.unit === 0 ? F.dateOf(Number(v)) : F.stampOf(v, 1).slice(0, 10);
      case T.Timestamp: return tt.unit === 0 ? F.stampOf(BigInt(v) * 1000n, 1) : F.stampOf(v, PER_MS[tt.unit]);
      case T.Time: return tt.unit === 0 ? F.timeOf(BigInt(v) * 1000n, 1) : F.timeOf(v, PER_MS[tt.unit]);
      case T.Duration: return String(v) + ' ' + UNIT[tt.unit];
      case T.Bool: return v ? 'true' : 'false';
      case T.Utf8: case T.LargeUtf8: case T.Utf8View: return String(v);
      case T.Binary: case T.LargeBinary: case T.BinaryView: case T.FixedSizeBinary: return v instanceof Uint8Array ? (v.length ? '0x' + F.hex(v) : '') : String(v);
      case T.Int: case T.Float: return DB.str(v);
      default: { const p = toPlain(v, 0); return p === null ? '' : typeof p === 'string' ? p : DB.json(p); }
    }
  }

  /* ---------- Arrow IPC (file or stream) with flechette ---------- */
  let codecs = false;
  let budget = { bytes: 0 };            // bytes decompressed for the file being read (1 GB at most, all buffers together)
  const FILE_BYTES = 1024 * 1024 * 1024, OUT_CHARS = 256 * 1024 * 1024;
  function registerCodecs() {
    if (codecs) return;
    const F = window.flechette;
    // flechette views 64-bit columns in place: the decompressed bytes must start on a multiple of 8 (a fresh buffer)
    const own = (out) => (out.byteOffset % 8 ? out.slice() : out);
    const count = (out) => { if ((budget.bytes += out.length) > FILE_BYTES) throw new UserError('errTooLarge'); return out; };
    F.setCompressionCodec(F.CompressionType.LZ4_FRAME, { decode: (b) => own(count(DB.lz4Frames(b))) });
    F.setCompressionCodec(F.CompressionType.ZSTD, { decode: (b) => own(DB.decodeLimited(window.fzstd.Decompress, b, budget, FILE_BYTES)) });
    codecs = true;
  }
  function parseIpc(u8, maxRows) {
    const F = window.flechette;
    registerCodecs();
    budget = { bytes: 0 };
    let table;
    try {
      table = F.tableFromIPC(u8, { useBigInt: true, useDecimalInt: true, useDate: false, useMap: true });
    } catch (e) {
      if (e instanceof UserError) throw e;
      if (e && e.tooLarge) throw new UserError('errTooLarge');
      if (/codec/i.test(String(e && e.message))) throw new UserError('errCodecArrow', {}, String(e.message));
      throw new UserError('errCorrupt', { ext: EXT }, String(e && e.message || e).slice(0, 200));
    }
    // flechette trusts the lengths written in the file: a batch must have the buffers its length needs (a damaged
    // length would otherwise make every read past the end return nothing, row after row)
    const plausible = (b, depth) => {
      if (!b || depth > 32) return true;
      const len = b.length;
      if (!(len >= 0) || len > 2147483647) return false;
      if (b.validity && b.nullCount > 0 && b.validity.length * 8 < len) return false;
      if (b.offsets && b.offsets.length < len + 1) return false;
      // offsets: never decreasing, within the strings' bytes or the list's items (a damaged one would make a list of billions)
      if (b.offsets && len > 0 && !b.sizes) {   // (list views have sizes and may overlap: not checked here)
        const o = b.offsets, big = typeof o[0] === 'bigint';
        const limit = b.children && b.children[0] ? b.children[0].length : b.values ? b.values.length : 0;
        let prev = big ? Number(o[0]) : o[0];
        if (prev < 0) return false;
        for (let i = 1; i <= len; i++) { const x = big ? Number(o[i]) : o[i]; if (x < prev) return false; prev = x; }
        if (prev > limit) return false;
      }
      if (b.values && ArrayBuffer.isView(b.values) && !b.offsets && b.values.length * 8 < len) return false;
      if (b.children) for (const c of b.children) if (!plausible(c, depth + 1)) return false;
      return true;
    };
    for (let i = 0; i < table.numCols; i++) for (const b of table.getChildAt(i).data) if (!plausible(b, 0)) throw new UserError('errCorrupt', { ext: EXT }, 'record batch shorter than its length');
    const fields = table.schema.fields;
    // the columns: a struct's fields become columns (recursively); the rest is one column each
    const cols = [];
    const walk = (field, path, getter, depth) => {
      if (field.type.typeId === F.Type.Struct && depth < 8 && field.type.children && field.type.children.length) {
        for (const c of field.type.children) walk(c, path.concat(c.name), (row) => { const o = getter(row); return o == null ? null : o[c.name]; }, depth + 1);
        return;
      }
      cols.push({ name: path.join('.'), field, get: getter });
    };
    const columns = [];
    fields.forEach((f, i) => {
      const col = table.getChildAt(i);
      walk(f, [f.name], (row) => col.at(row), 0);
    });
    const n = table.numRows;
    const take = Math.min(n, maxRows);
    const rows = new Array(take);
    // the text produced has a budget too: views (string, binary or list views) may all point at the same large region
    let chars = 0, got = take;
    try {
      for (let r = 0; r < take; r++) {
        const row = cols.map((c) => cell(c.get(r), c.field.type));
        for (const v of row) chars += v.length;
        rows[r] = row;
        if (chars > OUT_CHARS) { got = r + 1; break; }
      }
      rows.length = got;
    } catch (e) {
      if (e instanceof UserError) throw e;
      if (e && e.tooLarge) throw new UserError('errTooLarge');
      throw new UserError('errCorrupt', { ext: EXT }, String(e && e.message || e).slice(0, 200));
    }
    for (const c of cols) {
      const t = c.field.type;
      const tz = t.typeId === F.Type.Timestamp && t.timezone ? ' (values in UTC)' : '';
      const m = { arrowType: typeName(t, false, 0) + tz, arrowTypeAnon: typeName(t, true, 0) + tz };
      if (c.field.nullable === false) m.notNull = { key: 'yes' };
      columns.push({ name: c.name, meta: m });
    }
    const batches = table.children[0] && table.children[0].data ? table.children[0].data.length : 0;
    const embedded = table.schema.metadata ? Array.from(table.schema.metadata, ([k, v]) => [String(k), String(v)]) : [];
    return { columns, rows, total: n, batches, embedded,
      json: cols.some((c) => [F.Type.List, F.Type.LargeList, F.Type.FixedSizeList, F.Type.Map, F.Type.Union, F.Type.ListView, F.Type.LargeListView].includes(c.field.type.typeId)) };
  }

  /* ---------- Feather v1: "FEA1", the column buffers, a FlatBuffers table (CTable), its length, "FEA1" ---------- */
  function fb(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const chk = (p, n) => { if (p < 0 || p + n > u8.length) throw new UserError('errCorrupt', { ext: EXT }); return p; };
    const table = (p) => {
      const vt = p - dv.getInt32(chk(p, 4), true);
      const vlen = dv.getUint16(chk(vt, 4), true);
      const at = (i) => { const o = 4 + 2 * i; return o < vlen ? dv.getUint16(chk(vt + o, 2), true) : 0; };
      return {
        has: (i) => at(i) !== 0,
        u8: (i, d) => (at(i) ? u8[chk(p + at(i), 1)] : d),
        i32: (i, d) => (at(i) ? dv.getInt32(chk(p + at(i), 4), true) : d),
        i64: (i, d) => (at(i) ? Number(dv.getBigInt64(chk(p + at(i), 8), true)) : d),
        str: (i) => { if (!at(i)) return ''; const q = p + at(i); const s = q + dv.getUint32(chk(q, 4), true); const n = dv.getUint32(chk(s, 4), true); return new TextDecoder().decode(u8.subarray(chk(s + 4, n), s + 4 + n)); },
        sub: (i) => { if (!at(i)) return null; const q = p + at(i); return table(q + dv.getUint32(chk(q, 4), true)); },
        vec: (i) => { if (!at(i)) return []; const q = p + at(i); const s = q + dv.getUint32(chk(q, 4), true); const n = dv.getUint32(chk(s, 4), true); if (n > 100000) throw new UserError('errCorrupt', { ext: EXT }); const out = []; for (let k = 0; k < n; k++) { const e = s + 4 + 4 * k; out.push(table(e + dv.getUint32(chk(e, 4), true))); } return out; },
      };
    };
    return { root: () => table(dv.getUint32(chk(0, 4), true)) };
  }
  const V1 = ['bool', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'float', 'double', 'string', 'binary', 'category', 'timestamp', 'date', 'time', 'large_string', 'large_binary'];
  function parseFeather1(u8, maxRows) {
    const bad = () => new UserError('errCorrupt', { ext: EXT });
    const mlen = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getInt32(u8.length - 8, true);
    const mstart = u8.length - 8 - mlen;
    if (mlen <= 0 || mstart < 4) throw bad();
    const meta = fb(u8.subarray(mstart, mstart + mlen)).root();
    const nrows = meta.i64(1, 0);
    if (!(nrows >= 0)) throw bad();
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const pad8 = (n) => Math.ceil(n / 8) * 8;
    // one PrimitiveArray -> a function giving the value of row i (null when missing)
    const arrayOf = (pa) => {
      if (!pa) throw bad();
      const type = pa.u8(0, 0), off = pa.i64(2, 0), len = pa.i64(3, 0), nulls = pa.i64(4, 0), totalBytes = pa.i64(5, 0);
      if (off < 0 || len < 0 || totalBytes < 0 || off + totalBytes > mstart) throw bad();
      let p = off;
      let valid = null;
      if (nulls > 0) { valid = p; p += pad8(Math.ceil(len / 8)); }
      const isNull = (i) => valid !== null && !(u8[valid + (i >> 3)] & (1 << (i & 7)));
      const end = off + totalBytes;
      const need = (q, n) => { if (q < 0 || q + n > end) throw bad(); return q; };
      const name = V1[type] || 'type ' + type;
      const fixed = { int8: [1, 'getInt8'], int16: [2, 'getInt16'], int32: [4, 'getInt32'], int64: [8, 'getBigInt64'], uint8: [1, 'getUint8'], uint16: [2, 'getUint16'],
        uint32: [4, 'getUint32'], uint64: [8, 'getBigUint64'], float: [4, 'getFloat32'], double: [8, 'getFloat64'], timestamp: [8, 'getBigInt64'], date: [4, 'getInt32'], time: [8, 'getBigInt64'] }[name];
      if (fixed) { const [w, fn] = fixed; return { type, len, get: (i) => (isNull(i) ? null : dv[fn](need(p + i * w, w), true)) }; }
      if (name === 'bool') return { type, len, get: (i) => (isNull(i) ? null : !!(u8[need(p + (i >> 3), 1)] & (1 << (i & 7)))) };
      if (['string', 'binary', 'large_string', 'large_binary'].includes(name)) {
        const big = name.startsWith('large'), w = big ? 8 : 4;
        const offs = p, data = p + pad8((len + 1) * w);
        const o = (i) => (big ? Number(dv.getBigInt64(need(offs + i * 8, 8), true)) : dv.getInt32(need(offs + i * 4, 4), true));
        return { type, len, get: (i) => { if (isNull(i)) return null; const a = o(i), b = o(i + 1); if (a < 0 || b < a) throw bad(); const bytes = u8.subarray(need(data + a, b - a), data + b); return name.endsWith('binary') ? bytes : new TextDecoder().decode(bytes); } };
      }
      throw new UserError('errCodecArrow', {}, 'Feather v1 type ' + name);
    };
    const columns = [], getters = [];
    for (const c of meta.vec(2)) {
      const name = c.str(0);
      const values = arrayOf(c.sub(1));
      const mt = c.u8(2, 0), md = c.sub(3);
      let type = V1[values.type] || '?', get = values.get, fmt = (v) => (v === null ? '' : typeof v === 'string' ? v : v instanceof Uint8Array ? (v.length ? '0x' + DB.cellFmt.hex(v) : '') : DB.str(v));
      if (mt === 1 && md) {                         // a category: integer codes into levels
        const levels = arrayOf(md.sub(0));
        type = 'category<' + (V1[levels.type] || '?') + '>';
        get = (i) => { const k = values.get(i); if (k === null) return null; const kk = Number(k); if (kk < 0 || kk >= levels.len) throw bad(); return levels.get(kk); };
      } else if (mt === 2 && md) {                  // a timestamp: its unit and time zone
        const unit = md.u8(0, 0), tz = md.str(1);
        if (unit > 3) throw bad();
        type = 'timestamp[' + UNIT[unit] + (tz ? ', ' + tz : '') + ']' + (tz ? ' (values in UTC)' : '');
        fmt = (v) => (v === null ? '' : unit === 0 ? DB.cellFmt.stampOf(BigInt(v) * 1000n, 1) : DB.cellFmt.stampOf(v, PER_MS[unit]));
      } else if (mt === 3) { type = 'date'; fmt = (v) => (v === null ? '' : DB.cellFmt.dateOf(Number(v))); }
      else if (mt === 4 && md) { const unit = md.u8(0, 0); if (unit > 3) throw bad(); type = 'time[' + UNIT[unit] + ']'; fmt = (v) => (v === null ? '' : unit === 0 ? DB.cellFmt.timeOf(BigInt(v) * 1000n, 1) : DB.cellFmt.timeOf(v, PER_MS[unit])); }
      if (values.len !== nrows) throw bad();
      columns.push({ name, meta: { arrowType: type, arrowTypeAnon: type } });
      getters.push((i) => fmt(get(i)));
    }
    const take = Math.min(nrows, maxRows);
    const rows = new Array(take);
    for (let r = 0; r < take; r++) rows[r] = getters.map((g) => g(r));
    const desc = meta.str(0);
    return { columns, rows, total: nrows, batches: 0, embedded: [], description: desc, version: meta.i32(3, 0) };
  }

  DB.parseArrow = function (u8, kind, opts) {
    const maxRows = (opts && opts.maxRows) || DB.SQL_MAX_ROWS || 250000;   // never unbounded: a damaged count cannot run on
    EXT = opts && opts.ext ? opts.ext : kind === 'feather1' ? '.feather' : '.arrow';
    const res = kind === 'feather1' ? parseFeather1(u8, maxRows) : parseIpc(u8, maxRows);
    const sec = { columns: res.columns, rows: res.rows };
    if (res.total > res.rows.length) sec.rowsTotal = res.total;
    if (res.description) sec.description = res.description;
    const fileMeta = [];
    if (res.batches > 1) fileMeta.push(['mArrowBatches', String(res.batches)]);
    const notes = {};
    if (res.columns.some((c) => c.name.includes('.'))) notes.flattened = true;
    if (res.json) notes.arrays = true;
    const formatName = kind === 'feather1' ? 'Feather v1' : kind === 'stream' ? 'Apache Arrow IPC stream' : 'Apache Arrow IPC file';
    return { sections: [sec], fileMeta, notes, embedded: res.embedded, formatName };
  };
})();
