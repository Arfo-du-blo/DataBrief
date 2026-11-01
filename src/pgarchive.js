/* DataBrief - PostgreSQL archives (pg_dump -Fc "custom" and -Ft "tar"). GPL-3.0-or-later.
 *
 * An archive holds a table of contents (one entry per object: its CREATE statement, its COPY statement) and the data of
 * each table, compressed with gzip, lz4 or zstd (or not at all). This reader rebuilds the SQL text that pg_restore would
 * print (definitions in archive order, each table's data as a COPY ... FROM stdin block) and gives it to the SQL dump
 * reader (sqldump.js). Nothing is executed. The directory format (-Fd) is a folder, not a file: not read here.
 *
 *   DB.isPgArchive(u8) -> 'custom' | 'tar' | ''
 *   DB.parsePgArchive(u8, opts) -> the result of DB.parseSqlDump, plus info.archive:
 *     { format, version, compression, serverVersion, dumpVersion, entries, dataBlocks, largeObjects, problems, skipped }
 *     (skipped = names of the tables whose data could not be read)
 * Versions read: archive 1.12 to 1.16 (PostgreSQL 9.x to 17). An error that stops the reading is thrown as
 * Error with .code = 'pgArchiveCorrupt' | 'pgArchiveVersion' | 'pgArchiveCompression'; damage inside one table's data
 * is reported in info.archive.problems and the rest is still read. */
'use strict';
(function () {
  const DB = window.DB;
  const ARCH_CUSTOM = 1, ARCH_TAR = 3;
  const COMPRESSION = ['none', 'gzip', 'lz4', 'zstd'];
  const BLK_DATA = 1, BLK_BLOBS = 3;
  const V = (a, b, c) => (a * 256 + b) * 256 + (c || 0);
  const fail = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };

  /* ---------------------------------------------------------------- byte reader ---------- */
  class Bytes {
    constructor(u8) { this.u = u8; this.p = 0; this.intSize = 4; this.offSize = 8; }
    need(n) { if (this.p + n > this.u.length) throw fail('pgArchiveCorrupt', 'unexpected end of the archive'); }
    byte() { this.need(1); return this.u[this.p++]; }
    bytes(n) { this.need(n); const b = this.u.subarray(this.p, this.p + n); this.p += n; return b; }
    // ReadInt: a sign byte, then intSize bytes, least significant first
    int() {
      const neg = this.byte();
      this.need(this.intSize);
      let v = 0;
      for (let k = 0; k < this.intSize; k++) v += this.u[this.p++] * 2 ** (8 * k);
      return neg ? -v : v;
    }
    // ReadStr: an int length (-1 = NULL), then the bytes (kept as bytes: decoded later, with the archive's encoding)
    str() {
      const n = this.int();
      if (n < 0) return null;
      if (n > this.u.length - this.p) throw fail('pgArchiveCorrupt', 'string longer than the archive');
      return this.bytes(n);
    }
    // ReadOffset: a flag byte, then offSize bytes (the position of the data; unused: blocks are read in order)
    offset() { const flag = this.byte(); this.bytes(this.offSize); return flag; }
  }

  /* ---------------------------------------------------------------- header and table of contents ---------- */
  function readHead(b) {
    if (String.fromCharCode(...b.bytes(5)) !== 'PGDMP') throw fail('pgArchiveCorrupt', 'not a pg_dump archive');
    const vmaj = b.byte(), vmin = b.byte();
    const vrev = vmaj > 1 || (vmaj === 1 && vmin > 0) ? b.byte() : 0;
    const version = V(vmaj, vmin, vrev);
    if (version < V(1, 12) ) throw fail('pgArchiveVersion', 'archive version ' + vmaj + '.' + vmin + ' is too old (before PostgreSQL 9.0)');
    b.intSize = b.byte();
    b.offSize = b.byte();
    if (b.intSize < 1 || b.intSize > 8 || b.offSize < 1 || b.offSize > 8) throw fail('pgArchiveCorrupt', 'impossible integer sizes');
    const format = b.byte();
    let compression;
    if (version >= V(1, 15)) compression = b.byte();
    else compression = b.int() !== 0 ? 1 : 0;           // before 1.15: a zlib level (-1 = default); 0 = none
    for (let k = 0; k < 7; k++) b.int();                 // creation time (seconds ... year, isdst)
    b.str();                                              // database name (not kept)
    const serverVersion = b.str(), dumpVersion = b.str();
    return { version, vtext: vmaj + '.' + vmin + '.' + vrev, format, compression, serverVersion, dumpVersion };
  }
  function readToc(b, head) {
    const count = b.int();
    if (count < 0 || count > 10000000) throw fail('pgArchiveCorrupt', 'impossible number of entries');
    const v = head.version;
    const entries = [];
    for (let k = 0; k < count; k++) {
      const te = {};
      te.dumpId = b.int();
      te.hadDumper = b.int();
      b.str(); b.str();                                   // catalog ids (tableoid, oid)
      te.tag = b.str();
      te.desc = b.str();
      b.int();                                            // section (pre-data, data, post-data)
      te.defn = b.str();
      b.str();                                            // drop statement
      te.copyStmt = b.str();
      te.namespace = b.str();
      b.str();                                            // tablespace
      if (v >= V(1, 14)) b.str();                         // table access method
      if (v >= V(1, 16)) b.int();                         // relkind
      b.str();                                            // owner
      b.str();                                            // "with oids": always "false" today
      for (let guard = 0; ; guard++) {                    // dependencies, ended by NULL
        if (guard > 1000000) throw fail('pgArchiveCorrupt', 'endless dependency list');
        if (b.str() === null) break;
      }
      if (head.format === ARCH_CUSTOM) te.dataState = b.offset();
      else if (head.format === ARCH_TAR) te.file = b.str();
      entries.push(te);
    }
    return entries;
  }

  /* ---------------------------------------------------------------- decompression ---------- */
  // LZ4 frame format (what pg_dump writes): blocks may refer to earlier blocks, so all go into one output buffer.
  function lz4Frames(src) {
    let out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0;
    const ensure = (n) => { if (op + n <= out.length) return; let size = out.length * 2; while (size < op + n) size *= 2; const o = new Uint8Array(size); o.set(out.subarray(0, op)); out = o; };
    let p = 0;
    const u32 = (q) => (src[q] | (src[q + 1] << 8) | (src[q + 2] << 16) | (src[q + 3] << 24)) >>> 0;
    while (p + 4 <= src.length) {
      const magic = u32(p);
      if ((magic & 0xfffffff0) === 0x184d2a50) { p += 8 + u32(p + 4); continue; }   // skippable frame
      if (magic !== 0x184d2204) throw fail('pgArchiveCorrupt', 'bad lz4 frame');
      p += 4;
      const flg = src[p], blockChecksum = !!(flg & 0x10), contentSize = !!(flg & 0x08), contentChecksum = !!(flg & 0x04), dictId = !!(flg & 0x01);
      if ((flg >> 6) !== 1) throw fail('pgArchiveCorrupt', 'bad lz4 version');
      p += 2 + (contentSize ? 8 : 0) + (dictId ? 4 : 0) + 1;                         // FLG, BD, sizes, header checksum
      for (;;) {
        if (p + 4 > src.length) throw fail('pgArchiveCorrupt', 'truncated lz4 data');
        const size = u32(p); p += 4;
        if (size === 0) break;                                                        // end mark
        const len = size & 0x7fffffff;
        if (p + len > src.length) throw fail('pgArchiveCorrupt', 'truncated lz4 block');
        if (size & 0x80000000) { ensure(len); out.set(src.subarray(p, p + len), op); op += len; }   // stored as is
        else {
          const end = p + len;
          let ip = p;
          while (ip < end) {
            const token = src[ip++];
            let lit = token >> 4;
            if (lit === 15) { let x; do { x = src[ip++]; lit += x; } while (x === 255 && ip < end); }
            ensure(lit);
            out.set(src.subarray(ip, ip + lit), op); op += lit; ip += lit;
            if (ip >= end) break;                                                     // the last sequence has no match
            const off = src[ip] | (src[ip + 1] << 8); ip += 2;
            if (!off || off > op) throw fail('pgArchiveCorrupt', 'bad lz4 offset');
            let ml = token & 15;
            if (ml === 15) { let x; do { x = src[ip++]; ml += x; } while (x === 255 && ip < end); }
            ml += 4;
            ensure(ml);
            for (let k = 0; k < ml; k++, op++) out[op] = out[op - off];               // may overlap: byte by byte
          }
        }
        p += len + (blockChecksum ? 4 : 0);
      }
      if (contentChecksum) p += 4;
    }
    return out.subarray(0, op);
  }
  function decompress(algo, bytes) {
    switch (algo) {
      case 0: return bytes;
      case 1: return window.fflate.unzlibSync(bytes);
      case 2: return lz4Frames(bytes);
      case 3: return window.fzstd.decompress(bytes);
      default: throw fail('pgArchiveCompression', 'unknown compression ' + algo);
    }
  }
  const concat = (parts) => {
    if (parts.length === 1) return parts[0];
    const n = parts.reduce((a, x) => a + x.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  };

  /* ---------------------------------------------------------------- data blocks (custom format) ---------- */
  // After the table of contents: [type byte][dumpId int][chunks: int length + bytes ... length 0]. Read in order.
  function readBlocks(b, problems) {
    const data = new Map();
    let largeObjects = 0;
    while (b.p < b.u.length) {
      const start = b.p;
      try {
        const type = b.byte();
        const id = b.int();
        if (type === BLK_DATA) {
          const parts = [];
          for (;;) { const n = b.int(); if (n === 0) break; if (n < 0) throw fail('pgArchiveCorrupt', 'negative chunk'); parts.push(b.bytes(n)); }
          data.set(id, parts);
        } else if (type === BLK_BLOBS) {
          for (;;) {                                      // large objects: oid, chunks ... oid 0 ends the list
            const oid = b.int(); if (oid === 0) break;
            largeObjects++;
            for (;;) { const n = b.int(); if (n === 0) break; b.bytes(n); }
          }
        } else throw fail('pgArchiveCorrupt', 'unknown block type ' + type);
      } catch (e) {
        problems.push('data after byte ' + start + ' could not be read');
        break;
      }
    }
    return { data, largeObjects };
  }

  /* ---------------------------------------------------------------- tar ---------- */
  function tarFiles(u8) {
    const files = new Map();
    let p = 0;
    while (p + 512 <= u8.length) {
      const h = u8.subarray(p, p + 512);
      if (h.every((x) => x === 0)) break;
      const field = (a, n) => { let s = ''; for (let k = a; k < a + n && h[k]; k++) s += String.fromCharCode(h[k]); return s; };
      let name = field(0, 100);
      if (field(257, 5) === 'ustar') { const prefix = field(345, 155); if (prefix) name = prefix + '/' + name; }
      const size = parseInt(field(124, 12).trim() || '0', 8);
      if (!Number.isFinite(size) || size < 0) throw fail('pgArchiveCorrupt', 'bad tar header');
      const type = String.fromCharCode(h[156] || 48);
      p += 512;
      if (type === '0' || type === '\0') files.set(name.replace(/^\.\//, ''), u8.subarray(p, Math.min(u8.length, p + size)));
      p += Math.ceil(size / 512) * 512;
    }
    return files;
  }

  DB.isPgArchive = function (u8) {
    if (u8.length >= 5 && u8[0] === 0x50 && u8[1] === 0x47 && u8[2] === 0x44 && u8[3] === 0x4d && u8[4] === 0x50) return 'custom';
    if (u8.length >= 512 && String.fromCharCode(...u8.subarray(257, 262)) === 'ustar' && String.fromCharCode(...u8.subarray(0, 7)) === 'toc.dat') return 'tar';
    return '';
  };

  // PostgreSQL encoding names -> TextDecoder labels
  const ENCODINGS = { UTF8: 'utf-8', SQL_ASCII: 'utf-8', LATIN1: 'iso-8859-1', LATIN2: 'iso-8859-2', LATIN9: 'iso-8859-15', WIN1250: 'windows-1250',
    WIN1251: 'windows-1251', WIN1252: 'windows-1252', WIN1253: 'windows-1253', WIN1254: 'windows-1254', WIN1256: 'windows-1256', KOI8R: 'koi8-r',
    KOI8U: 'koi8-u', EUC_JP: 'euc-jp', SJIS: 'shift_jis', EUC_KR: 'euc-kr', GBK: 'gbk', GB18030: 'gb18030', BIG5: 'big5', EUC_CN: 'gb2312' };

  DB.parsePgArchive = function (u8, opts) {
    const kind = DB.isPgArchive(u8);
    if (!kind) throw fail('pgArchiveCorrupt', 'not a pg_dump archive');
    const problems = [], skipped = [];
    let head, entries, blocks = { data: new Map(), largeObjects: 0 }, files = null;
    if (kind === 'custom') {
      const b = new Bytes(u8);
      head = readHead(b);
      if (head.format !== ARCH_CUSTOM) throw fail('pgArchiveCorrupt', 'unexpected archive format ' + head.format);
      entries = readToc(b, head);
      blocks = readBlocks(b, problems);
    } else {
      files = tarFiles(u8);
      const toc = files.get('toc.dat');
      if (!toc) throw fail('pgArchiveCorrupt', 'toc.dat missing from the tar archive');
      const b = new Bytes(toc);
      head = readHead(b);
      if (head.format !== ARCH_TAR) throw fail('pgArchiveCorrupt', 'unexpected archive format ' + head.format);
      entries = readToc(b, head);
    }
    if (head.version > V(1, 16)) problems.push('archive version ' + head.vtext + ' is newer than this reader knows (1.16)');

    // the encoding of the archive (an ENCODING entry: SET client_encoding = 'UTF8';)
    const ascii = (x) => (x ? String.fromCharCode(...x.subarray(0, 200)) : '');
    const encEntry = entries.find((e) => ascii(e.desc) === 'ENCODING');
    const encName = encEntry ? (/'([^']+)'/.exec(ascii(encEntry.defn)) || [])[1] : 'UTF8';
    const label = ENCODINGS[String(encName || 'UTF8').toUpperCase()] || 'utf-8';
    let dec;
    try { dec = new TextDecoder(label); } catch (e) { dec = new TextDecoder('utf-8'); }
    const text = (x) => (x ? dec.decode(x) : '');

    const reader = new DB.SqlDumpReader(Object.assign({}, opts, { dialect: 'postgres' }));
    let dataBlocks = 0;
    const STEP = 1 << 20;
    for (const te of entries) {
      const desc = text(te.desc);
      const defn = text(te.defn);
      if (defn) reader.push(defn + '\n');
      if (!te.hadDumper) continue;
      let raw = null;
      try {
        if (kind === 'custom') {
          const parts = blocks.data.get(te.dumpId);
          if (!parts) { if (desc === 'TABLE DATA') { problems.push('data of ' + text(te.tag) + ' missing'); skipped.push(text(te.tag)); } continue; }
          raw = decompress(head.compression, concat(parts));
        } else {
          const name = text(te.file);
          const f = name && (files.get(name) || files.get(name + '.gz'));
          if (!f) { if (desc === 'TABLE DATA') { problems.push('data file of ' + text(te.tag) + ' missing'); skipped.push(text(te.tag)); } continue; }
          raw = files.has(name) ? f : window.fflate.gunzipSync(f);
        }
      } catch (e) {
        problems.push('data of ' + text(te.tag) + ' could not be decompressed');
        skipped.push(text(te.tag));
        continue;
      }
      dataBlocks++;
      const copy = text(te.copyStmt);
      if (copy) reader.push(copy.replace(/\s*$/, '') + '\n');
      // the data, decoded in steps (a multi-byte character cut at a step boundary is kept for the next step)
      const sd = new TextDecoder(dec.encoding);
      for (let k = 0; k < raw.length; k += STEP) reader.push(sd.decode(raw.subarray(k, k + STEP), { stream: true }));
      const tail = sd.decode();
      if (tail) reader.push(tail);
      if (copy) reader.push((raw.length && raw[raw.length - 1] !== 10 ? '\n' : '') + '\\.\n');
    }
    const result = reader.end();
    result.info.archive = {
      format: kind, version: head.vtext, compression: COMPRESSION[head.compression] || String(head.compression),
      serverVersion: text(head.serverVersion), dumpVersion: text(head.dumpVersion),
      entries: entries.length, dataBlocks, largeObjects: blocks.largeObjects, problems, skipped,
    };
    return result;
  };
})();
