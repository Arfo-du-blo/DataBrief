/* DataBrief - Apache Avro object container files (.avro). GPL-3.0-or-later. Original code.
 *
 * DB.isAvro(u8) -> boolean; DB.parseAvro(u8, { maxRows }) -> { sections: [one], fileMeta, notes }.
 * The schema (JSON, in the header) gives the columns: a nested record is flattened (address.city), a nullable record too;
 * arrays, maps and other unions are one column of JSON text. Logical types are shown as people read them: decimals with
 * their scale, dates, timestamps (UTC), UUIDs. Codecs: null, deflate (fflate), snappy (hyparquet), zstandard (fzstd).
 * Rows beyond maxRows are counted from the block headers, not decoded. Every length and count is checked against the
 * bytes left: a damaged or hostile file gives an error or the rows read so far, quickly. */
'use strict';
(function () {
  const DB = window.DB;
  const UserError = DB.UserError;
  const MAX_DEPTH = 32;            // nesting of the schema and of the values
  const MAX_ITEMS = 10000000;      // items of one array or map
  const MAX_BLOCK = 1024 * 1024 * 1024;
  const FILE_ITEMS = 5000000;      // items of all arrays and maps of a file
  const FILE_BYTES = 1024 * 1024 * 1024;   // bytes decompressed for a whole file

  /* A streaming decoder (fflate's Inflate, fzstd's Decompress) with a running limit: a small block cannot ask for gigabytes.
   * budget: { bytes } shared by the blocks of one file. Also used by arrow.js for Zstandard. */
  DB.decodeLimited = function (Ctor, bytes, budget, limit) {
    const parts = [];
    let size = 0;
    const s = new Ctor((chunk) => {
      size += chunk.length;
      if ((budget ? (budget.bytes += chunk.length) : size) > (limit || FILE_BYTES)) throw new UserError('errTooLarge');
      parts.push(chunk);
    });
    for (let i = 0; i < bytes.length; i += 1 << 20) s.push(bytes.subarray(i, Math.min(bytes.length, i + (1 << 20))), false);
    s.push(new Uint8Array(0), true);
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };

  DB.isAvro = (u8) => u8.length >= 4 && u8[0] === 0x4f && u8[1] === 0x62 && u8[2] === 0x6a && u8[3] === 1;   // "Obj" 1

  const corrupt = () => new UserError('errCorrupt', { ext: '.avro' });
  const utf8 = new TextDecoder('utf-8');

  /* ---------- binary decoding ---------- */
  function Reader(u8) { this.u8 = u8; this.pos = 0; }
  Reader.prototype.long = function () {
    const u8 = this.u8;
    let n = 0, mul = 1, b, i = 0;
    const start = this.pos;
    do {
      if (this.pos >= u8.length || i >= 10) throw corrupt();
      b = u8[this.pos++];
      if (i < 7) n += (b & 0x7f) * mul;
      mul *= 128; i++;
    } while (b & 0x80);
    if (i <= 7) return n % 2 ? -(n + 1) / 2 : n / 2;                 // up to 49 bits: exact as a number
    let v = 0n;
    for (let k = this.pos - 1; k >= start; k--) v = (v << 7n) | BigInt(u8[k] & 0x7f);
    v &= 0xffffffffffffffffn;
    const z = (v >> 1n) ^ -(v & 1n);
    return z >= -9007199254740991n && z <= 9007199254740991n ? Number(z) : z;
  };
  Reader.prototype.bytes = function () {
    const n = this.long();
    if (typeof n !== 'number' || n < 0 || this.pos + n > this.u8.length) throw corrupt();
    const out = this.u8.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  };
  Reader.prototype.fixed = function (n) {
    if (this.pos + n > this.u8.length) throw corrupt();
    const out = this.u8.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  };
  Reader.prototype.str = function () { return utf8.decode(this.bytes()); };
  Reader.prototype.float = function () { const b = this.fixed(4); return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true); };
  Reader.prototype.double = function () { const b = this.fixed(8); return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true); };
  /* array and map blocks: a count, negative when followed by the size of the block in bytes; 0 ends */
  Reader.prototype.blocks = function (each) {
    let total = 0;
    for (;;) {
      let n = this.long();
      if (typeof n !== 'number') throw corrupt();
      if (n === 0) return;
      if (n < 0) { n = -n; const size = this.long(); if (typeof size !== 'number' || size < 0 || this.pos + size > this.u8.length) throw corrupt(); }
      total += n;
      if (total > MAX_ITEMS) throw corrupt();
      // items of a zero-byte type (null, an empty record) cost no bytes: a budget for the whole file keeps them bounded
      if (this.budget && (this.budget.items += n) > FILE_ITEMS) throw new UserError('errTooLarge');
      for (let i = 0; i < n; i++) each();
    }
  };

  /* ---------- values shown as people read them ---------- */
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const hex = (b) => Array.from(b.subarray(0, 64), (x) => x.toString(16).padStart(2, '0')).join('') + (b.length > 64 ? '…' : '');
  function decimal(bytes, scale) {
    if (!bytes.length) return '0';
    if (bytes.length > 64) return '0x' + hex(bytes);                  // not a number anyone wrote (a decimal is at most 38 digits)
    let v = BigInt('0x' + Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(''));   // linear, unlike shifting byte by byte
    if (bytes[0] & 0x80) v -= 1n << BigInt(bytes.length * 8);     // two's complement, big-endian
    return scaled(v, scale);
  }
  /* an integer of the smallest unit, written with its decimal point: 1990n, 2 -> "19.90"; a negative scale adds zeros */
  function scaled(v, scale) {
    if (typeof v !== 'bigint') v = BigInt(Math.trunc(Number(v)) || 0);
    scale = Math.max(-100, Math.min(1000, scale | 0));
    if (scale < 0) v *= 10n ** BigInt(-scale);
    const neg = v < 0n;
    let s = (neg ? -v : v).toString();
    if (scale > 0) { s = s.padStart(scale + 1, '0'); s = s.slice(0, -scale) + '.' + s.slice(-scale); }
    return (neg ? '-' : '') + s;
  }
  function dateOf(days) {
    if (typeof days !== 'number' || !isFinite(days) || Math.abs(days) > 1e8) return String(days);
    const d = new Date(days * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  // timestamps and times: unit = 1 (millis), 1000 (micros), 1000000 (nanos) per millisecond
  function stampOf(v, unit) {
    const big = typeof v === 'bigint' ? v : BigInt(v);
    const u = BigInt(unit);
    let ms = big / u, frac = big % u;
    if (frac < 0n) { frac += u; ms -= 1n; }
    if (ms > 8640000000000000n || ms < -8640000000000000n) return String(v);
    const d = new Date(Number(ms));
    let s = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    const sub = pad(d.getUTCMilliseconds(), 3) + (unit > 1 ? frac.toString().padStart(String(unit).length - 1, '0') : '');
    if (/[1-9]/.test(sub)) s += '.' + sub.replace(/0+$/, '');
    return s;
  }
  function timeOf(v, unit) {
    const big = typeof v === 'bigint' ? v : BigInt(v);
    const total = big / BigInt(unit), frac = big % BigInt(unit);
    const t = Number(total);
    if (t < 0 || t >= 86400000) return String(v);
    let s = pad(Math.floor(t / 3600000)) + ':' + pad(Math.floor(t / 60000) % 60) + ':' + pad(Math.floor(t / 1000) % 60);
    const sub = pad(t % 1000, 3) + (unit > 1 ? frac.toString().padStart(String(unit).length - 1, '0') : '');
    if (/[1-9]/.test(sub)) s += '.' + sub.replace(/0+$/, '');
    return s;
  }

  DB.cellFmt = { dateOf, stampOf, timeOf, hex, scaled };   // shared with the Arrow reader (arrow.js)

  /* ---------- the schema ---------- */
  const PRIMITIVE = new Set(['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string']);
  function resolveSchema(root) {
    const named = new Map();
    const fullName = (name, ns) => (String(name).includes('.') ? String(name) : ns ? ns + '.' + name : String(name));
    // first pass: every named type, so references can come before or after (and be recursive)
    const collect = (s, ns, depth) => {
      if (depth > MAX_DEPTH) throw corrupt();
      if (Array.isArray(s)) { s.forEach((x) => collect(x, ns, depth + 1)); return; }
      if (!s || typeof s !== 'object') return;
      if (['record', 'error', 'enum', 'fixed'].includes(s.type) && s.name) {
        const fn = fullName(s.name, s.namespace !== undefined ? s.namespace : ns);
        named.set(fn, s);
        s.__full = fn;
        const inner = fn.includes('.') ? fn.slice(0, fn.lastIndexOf('.')) : '';
        if (Array.isArray(s.fields)) s.fields.forEach((f) => { if (f && typeof f === 'object') { f.__ns = inner; collect(f.type, inner, depth + 1); } });
        return;
      }
      if (s.type === 'array') collect(s.items, ns, depth + 1);
      else if (s.type === 'map') collect(s.values, ns, depth + 1);
      else if (s && typeof s.type === 'object') collect(s.type, ns, depth + 1);
    };
    collect(root, '', 0);
    // a type: a string (primitive or a name), an array (a union) or an object
    const get = (s, ns) => {
      if (typeof s === 'string') {
        if (PRIMITIVE.has(s)) return { type: s };
        const t = named.get(fullName(s, ns)) || named.get(s);
        if (!t) throw corrupt();
        return t;
      }
      if (Array.isArray(s)) return { type: 'union', branches: s };
      if (s && typeof s === 'object') {
        if (s.type === 'union' && Array.isArray(s.branches)) return s;   // already resolved
        if (typeof s.type === 'string' && !PRIMITIVE.has(s.type) && !['record', 'error', 'enum', 'fixed', 'array', 'map'].includes(s.type)) return get(s.type, ns);
        if (s.type && typeof s.type === 'object') return get(s.type, ns);
        return s;
      }
      throw corrupt();
    };
    return { get, nsOf: (s) => (s && s.__full && s.__full.includes('.') ? s.__full.slice(0, s.__full.lastIndexOf('.')) : '') };
  }

  /* A leaf value: decode -> text of the cell. Returns { read(r) -> string|value, type, anon } */
  function leafType(s, R, ns, depth) {
    if (depth > MAX_DEPTH) throw corrupt();
    const t = R.get(s, ns);
    const lt = t.logicalType;
    switch (t.type) {
      case 'null': return { read: () => null, type: 'null', anon: 'null' };
      case 'boolean': return { read: (r) => { const b = r.fixed(1)[0]; return b === 1 ? 'true' : b === 0 ? 'false' : (() => { throw corrupt(); })(); }, type: 'boolean', anon: 'boolean' };
      case 'int': case 'long': {
        if (lt === 'date' && t.type === 'int') return { read: (r) => dateOf(r.long()), type: 'date', anon: 'date' };
        const units = { 'timestamp-millis': 1, 'timestamp-micros': 1000, 'timestamp-nanos': 1000000, 'local-timestamp-millis': 1, 'local-timestamp-micros': 1000, 'local-timestamp-nanos': 1000000 };
        if (units[lt] && t.type === 'long') { const u = units[lt]; const ty = lt + (lt.startsWith('local') ? '' : ' (UTC)'); return { read: (r) => stampOf(r.long(), u), type: ty, anon: ty }; }
        if (lt === 'time-millis' && t.type === 'int') return { read: (r) => timeOf(r.long(), 1), type: 'time-millis', anon: 'time-millis' };
        if (lt === 'time-micros' && t.type === 'long') return { read: (r) => timeOf(r.long(), 1000), type: 'time-micros', anon: 'time-micros' };
        return { read: (r) => String(r.long()), type: t.type, anon: t.type };
      }
      case 'float': return { read: (r) => DB.str(Math.fround(r.float())), type: 'float', anon: 'float' };
      case 'double': return { read: (r) => DB.str(r.double()), type: 'double', anon: 'double' };
      case 'bytes': case 'fixed': {
        const read = t.type === 'fixed' ? (r) => r.fixed(+t.size) : (r) => r.bytes();
        if (t.type === 'fixed' && !(t.size >= 0 && t.size <= 1 << 20)) throw corrupt();
        if (lt === 'decimal') {
          const scale = Math.max(0, Math.min(1000, +t.scale || 0));
          const ty = 'decimal(' + (+t.precision || '?') + ',' + scale + ')';
          return { read: (r) => decimal(read(r), scale), type: ty, anon: ty };
        }
        if (lt === 'duration' && t.type === 'fixed' && +t.size === 12) {
          return { read: (r) => { const b = read(r), v = new DataView(b.buffer, b.byteOffset, 12); return v.getUint32(0, true) + ' months ' + v.getUint32(4, true) + ' days ' + v.getUint32(8, true) + ' ms'; }, type: 'duration', anon: 'duration' };
        }
        const ty = t.type === 'fixed' ? 'fixed(' + t.size + ')' : 'bytes';
        return { read: (r) => { const b = read(r); return b.length ? '0x' + hex(b) : ''; }, type: ty, anon: ty };
      }
      case 'string': return { read: (r) => r.str(), type: lt === 'uuid' ? 'uuid' : 'string', anon: lt === 'uuid' ? 'uuid' : 'string' };
      case 'enum': {
        const sym = Array.isArray(t.symbols) ? t.symbols.map(String) : [];
        return { read: (r) => { const i = r.long(); if (typeof i !== 'number' || i < 0 || i >= sym.length) throw corrupt(); return sym[i]; }, type: 'enum', anon: 'enum', symbols: sym };
      }
      default: {
        // arrays, maps, records and unions inside a column: one JSON text
        const v = valueType(t, R, ns, depth + 1);
        return { read: (r) => { const x = v.read(r); return x === null ? null : DB.json(x); }, type: v.type, anon: v.anon, json: true };
      }
    }
  }
  /* Any value as a JS value (for JSON text) */
  function valueType(s, R, ns, depth) {
    if (depth > MAX_DEPTH) throw corrupt();
    const t = R.get(s, ns);
    const tns = R.nsOf(t) || ns;
    if (t.type === 'array') {
      let it = null;
      const item = () => it || (it = valueType(t.items, R, tns, depth + 1));
      const ty = item().type, an = item().anon;
      return { read: (r) => { const out = []; r.blocks(() => out.push(item().read(r))); return out; }, type: 'array<' + ty + '>', anon: 'array<' + an + '>' };
    }
    if (t.type === 'map') {
      const val = valueType(t.values, R, tns, depth + 1);
      return { read: (r) => { const out = {}; r.blocks(() => { const k = r.str(); out[k] = val.read(r); }); return out; }, type: 'map<' + val.type + '>', anon: 'map<' + val.anon + '>' };
    }
    if (t.type === 'record' || t.type === 'error') {
      const fields = (Array.isArray(t.fields) ? t.fields : []).map((f) => ({ name: String(f.name), v: null, f }));
      const inner = R.nsOf(t);
      // recursive types (a linked list): the readers are made when first used, the type names the record only
      const reader = (fd) => fd.v || (fd.v = valueType(fd.f.type, R, inner, depth + 1));
      return {
        read: (r) => { if (++r.depth > MAX_DEPTH * 4) throw corrupt(); const o = {}; for (const fd of fields) o[fd.name] = reader(fd).read(r); r.depth--; return o; },
        type: 'record{' + fields.map((x) => x.name).join(', ') + '}', anon: 'record',
      };
    }
    if (t.type === 'union') {
      const br = t.branches.map((b) => valueType(b, R, ns, depth + 1));
      return { read: (r) => { const i = r.long(); if (typeof i !== 'number' || i < 0 || i >= br.length) throw corrupt(); return br[i].read(r); }, ...unionName(br) };
    }
    const leaf = leafType(t, R, ns, depth + 1);
    // inside JSON text, numbers and booleans stay numbers and booleans
    const conv = leaf.type === 'int' || leaf.type === 'long' ? (x) => { const n = Number(x); return Number.isSafeInteger(n) ? n : BigInt(x); }
      : leaf.type === 'boolean' ? (x) => x === 'true' : leaf.type === 'float' || leaf.type === 'double' ? (x) => Number(x) : null;
    return { read: conv ? (r) => conv(leaf.read(r)) : (r) => leaf.read(r), type: leaf.type, anon: leaf.anon };
  }
  function unionName(br) {
    const nonNull = br.filter((b) => b.type !== 'null');
    if (nonNull.length === 1 && br.length === 2) return { type: 'nullable ' + nonNull[0].type, anon: 'nullable ' + nonNull[0].anon };
    return { type: 'union<' + br.map((b) => b.type).join(', ') + '>', anon: 'union<' + br.map((b) => b.anon).join(', ') + '>' };
  }

  /* The columns of the top record: records (and nullable records) flattened, the rest one column each.
   * Each column: { name, type, anon, notNull, doc, symbols }; the plan writes the cells of a row. */
  function plan(recSchema, R) {
    const cols = [];
    const build = (rec, prefix, nullable, depth, ns) => {
      if (depth > 8) return null;                                     // deeper records: JSON text (see below)
      const steps = [];
      for (const f of (Array.isArray(rec.fields) ? rec.fields : [])) {
        if (!f || typeof f !== 'object') throw corrupt();
        const name = prefix + String(f.name);
        const ft = R.get(f.type, f.__ns !== undefined ? f.__ns : ns);
        const doc = typeof f.doc === 'string' ? f.doc : '';
        // a record, or a union of null and a record: its fields become columns
        const recBranch = ft.type === 'union' && ft.branches.length === 2 ? ft.branches.map((b) => R.get(b, ns)) : null;
        const nullIdx = recBranch ? recBranch.findIndex((b) => b.type === 'null') : -1;
        const recIdx = recBranch ? recBranch.findIndex((b) => b.type === 'record') : -1;
        if ((ft.type === 'record' || (nullIdx >= 0 && recIdx >= 0)) && depth < 8 && !(ft.__full && ft.__busy)) {
          const sub = ft.type === 'record' ? ft : recBranch[recIdx];
          if (sub.__busy) { steps.push(leafStep(f.type, name, nullable, doc, ns)); continue; }   // recursive: JSON text
          sub.__busy = true;
          const start = cols.length;
          const inner = build(sub, name + '.', nullable || ft.type !== 'record', depth + 1, R.nsOf(sub));
          sub.__busy = false;
          if (ft.type === 'record') steps.push((r, row) => inner(r, row));
          else steps.push((r, row) => { const i = r.long(); if (i === recIdx) inner(r, row); else if (i !== nullIdx) throw corrupt(); });
          if (cols.length === start) cols.push({ name, type: 'record{}', anon: 'record', notNull: false, doc });   // an empty record: one empty column
          continue;
        }
        steps.push(leafStep(f.type, name, nullable, doc, f.__ns !== undefined ? f.__ns : ns));
      }
      return (r, row) => { for (const s of steps) s(r, row); };
    };
    function leafStep(type, name, nullable, doc, ns) {
      const t = R.get(type, ns);
      let leaf;
      if (t.type === 'union') {
        const v = valueType(t, R, ns, 1);
        const nonNull = t.branches.map((b) => R.get(b, ns)).filter((b) => b.type !== 'null');
        // a nullable scalar keeps its text form (a nullable date is a date); a real union is JSON text
        if (nonNull.length === 1 && t.branches.length === 2 && !['array', 'map', 'record', 'union'].includes(nonNull[0].type)) {
          const nIdx = t.branches.map((b) => R.get(b, ns)).findIndex((b) => b.type === 'null');
          const inner = leafType(t.branches[1 - nIdx], R, ns, 1);
          leaf = { read: (r) => { const i = r.long(); if (i === nIdx) return null; if (i !== 1 - nIdx) throw corrupt(); return inner.read(r); },
            type: 'nullable ' + inner.type, anon: 'nullable ' + inner.anon, symbols: inner.symbols, nullable: true };
        } else leaf = { read: (r) => { const x = v.read(r); return x === null ? null : typeof x === 'string' ? x : DB.json(x); }, type: v.type, anon: v.anon, nullable: true };
      } else leaf = leafType(type, R, ns, 1);
      const idx = cols.length;
      cols.push({ name, type: leaf.type, anon: leaf.anon, notNull: !nullable && !leaf.nullable && t.type !== 'null', doc, symbols: leaf.symbols || null, json: !!leaf.json });
      return (r, row) => { const x = leaf.read(r); row[idx] = x === null || x === undefined ? '' : x; };
    }
    const write = build(recSchema, '', false, 0, R.nsOf(recSchema));
    return { cols, write };
  }

  /* ---------- the container ---------- */
  function decompress(codec, data, budget) {
    switch (codec) {
      case 'null': return data;
      case 'deflate': return DB.decodeLimited(window.fflate.Inflate, data, budget);
      case 'snappy': {
        if (data.length < 4) throw corrupt();
        const input = data.subarray(0, data.length - 4);              // 4 bytes of CRC32 at the end
        let len = 0, mul = 1, i = 0, b;
        do { if (i >= input.length || i > 5) throw corrupt(); b = input[i++]; len += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
        // snappy cannot expand more than about 22 times (a 3-byte copy of 64 bytes): a larger size is a lie
        if (len > input.length * 22 + 64) throw corrupt();
        if (len > MAX_BLOCK || (budget.bytes += len) > FILE_BYTES) throw new UserError('errTooLarge');
        const out = new Uint8Array(len);
        window.hyparquet.snappyUncompress(input, out);
        return out;
      }
      case 'zstandard': return DB.decodeLimited(window.fzstd.Decompress, data, budget);
      default: throw new UserError('errCodecAvro', {}, 'Avro codec ' + codec);
    }
  }

  DB.parseAvro = function (u8, opts) {
    const maxRows = (opts && opts.maxRows) || DB.SQL_MAX_ROWS || 250000;   // never unbounded: a damaged count cannot run on
    if (!DB.isAvro(u8)) throw corrupt();
    const r = new Reader(u8);
    r.pos = 4;
    const meta = {};
    r.blocks(() => { const k = r.str(); meta[k] = r.bytes(); });
    const sync = r.fixed(16);
    let schema;
    try { schema = JSON.parse(utf8.decode(meta['avro.schema'] || new Uint8Array(0))); } catch (e) { throw corrupt(); }
    const codec = meta['avro.codec'] ? utf8.decode(meta['avro.codec']) : 'null';
    const R = resolveSchema(schema);
    let top = R.get(schema, '');
    const wrapped = top.type !== 'record' && top.type !== 'error';      // a file of plain values: one column "value"
    if (wrapped) top = { type: 'record', fields: [{ name: 'value', type: schema, __ns: '' }] };
    const P = plan(top, R);
    const width = P.cols.length;
    const rows = [];
    let total = 0, blocks = 0, cut = false;
    const budget = { bytes: 0, items: 0 };          // decompressed bytes and array items for the whole file
    while (r.pos < u8.length) {
      const count = r.long(), size = r.long();
      if (typeof count !== 'number' || typeof size !== 'number' || count < 0 || size < 0 || r.pos + size + 16 > u8.length) { cut = true; break; }
      const data = u8.subarray(r.pos, r.pos + size);
      r.pos += size;
      const s2 = r.fixed(16);
      for (let i = 0; i < 16; i++) if (s2[i] !== sync[i]) { cut = true; break; }
      if (cut) break;
      blocks++;
      if (rows.length < maxRows) {
        let raw;
        try { raw = decompress(codec, data, budget); } catch (e) { if (e instanceof UserError && e.key !== 'errCorrupt') throw e; cut = true; break; }
        const br = new Reader(raw);
        br.depth = 0;
        br.budget = budget;
        let n = 0;
        try {
          for (; n < count && rows.length < maxRows; n++) {
            const row = new Array(width).fill('');
            P.write(br, row);
            rows.push(row);
          }
        } catch (e) { if (!(e instanceof UserError)) throw e; total += n; cut = true; break; }
      }
      total += count;
    }
    if (!width && !rows.length) throw corrupt();
    const columns = P.cols.map((c) => {
      const m = { avroType: c.type, avroTypeAnon: c.anon };
      if (c.notNull) m.notNull = { key: 'yes' };
      if (c.doc) m.label = c.doc;                                      // a field's doc: written by people, like a column comment
      if (c.symbols && c.symbols.length) m.values = c.symbols.slice(0, 200).join(', ') + (c.symbols.length > 200 ? ', …' : '');
      return { name: c.name, meta: m };
    });
    const sec = { columns, rows };
    if (total > rows.length) sec.rowsTotal = total;
    if (!wrapped && typeof top.doc === 'string' && top.doc) sec.description = top.doc;
    const fileMeta = [];
    if (!wrapped && top.__full) fileMeta.push(['mAvroRecord', top.__full]);
    fileMeta.push(['mCodec', codec]);
    if (blocks > 1) fileMeta.push(['mAvroBlocks', String(blocks)]);
    if (cut) fileMeta.push(['mAvroCut', String(total)]);
    // metadata added by the writer (keys other than avro.*): shown like Parquet's (parsers.js), free text and names
    const embedded = Object.keys(meta).filter((k) => !/^avro\./.test(k)).slice(0, 20).map((k) => [k, utf8.decode(meta[k].subarray(0, 100000))]);
    const notes = {};
    if (columns.some((c) => c.name.includes('.'))) notes.flattened = true;
    if (P.cols.some((c) => c.json || /^(array|map|union)/.test(c.type))) notes.arrays = true;
    return { sections: [sec], fileMeta, notes, embedded };
  };
})();
