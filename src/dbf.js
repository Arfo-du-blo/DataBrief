/* DataBrief - DBF reader (dBase III / IV, FoxBase, FoxPro, Visual FoxPro). GPL-3.0-or-later.
 *
 * A .dbf file is one table: a header, the field descriptions, then fixed-size records. Memo texts live in another file
 * (.dbt / .fpt) that is not read: memo fields are listed, never filled. Deleted records are skipped and counted.
 *
 *   DB.looksLikeDbf(u8) -> boolean          (a .dbf has no signature: version byte, header and record length must agree)
 *   DB.parseDbf(u8, { maxRows }) -> { sections: [one], fileMeta, notes }
 *   DB.DBF_LANG: language-driver byte -> decoder, exported so tests can compare it with another implementation's table.
 * Throws DB.UserError('errCorrupt') for a file that is not a DBF. A file cut short is read as far as it goes (fileMeta says so). */
'use strict';
(function () {
  const DB = window.DB;

  const VERSIONS = {
    0x02: 'FoxBase', 0x03: 'dBase III / FoxPro 2.x', 0x04: 'dBase IV', 0x05: 'dBase V', 0x30: 'Visual FoxPro', 0x31: 'Visual FoxPro (autoincrement)',
    0x32: 'Visual FoxPro (varchar)', 0x43: 'dBase IV SQL system', 0x63: 'dBase IV SQL system', 0x83: 'dBase III with memo', 0x8b: 'dBase IV with memo',
    0x8e: 'dBase IV with SQL table', 0xcb: 'dBase IV SQL table with memo', 0xf5: 'FoxPro 2.x with memo', 0xfb: 'FoxBase',
  };

  /* Language-driver byte (offset 29) -> how the text is written. "dos:N" = a DOS code page from DB.DBF_CODEPAGES (generated from Python's
     codecs); the others are names TextDecoder knows. The same table as the dbf library's, checked by tests/test_dbf.cjs. */
  const GROUPS = [
    ['dos:437', [0x01, 0x09, 0x0b, 0x0d, 0x0f, 0x11, 0x15, 0x18, 0x19, 0x1b]], ['dos:850', [0x02, 0x0a, 0x0e, 0x10, 0x12, 0x14, 0x16, 0x1a, 0x1d, 0x25, 0x37]],
    ['dos:852', [0x1f, 0x22, 0x23, 0x40, 0x64, 0x87]], ['dos:857', [0x6b]], ['dos:737', [0x6a]], ['dos:860', [0x24]], ['dos:861', [0x67]], ['dos:863', [0x1c]],
    ['dos:865', [0x08, 0x17, 0x66]], ['ibm866', [0x26, 0x65]],
    ['windows-1250', [0xc8]], ['windows-1251', [0xc9]], ['windows-1252', [0x03, 0x57, 0x58, 0x59]], ['windows-1253', [0xcb]], ['windows-1254', [0xca]],
    ['windows-1255', [0x7d]], ['windows-1256', [0x7e]], ['windows-1257', [0xcc]], ['windows-874', [0x50, 0x7c]],
    ['macintosh', [0x04]], ['x-mac-cyrillic', [0x96]], ['shift_jis', [0x13, 0x7b]], ['gbk', [0x4d, 0x7a]], ['euc-kr', [0x4e, 0x79]], ['big5', [0x4f, 0x78]], ['utf-8', [0xf0]],
  ];
  const LANG = {};
  for (const [spec, ids] of GROUPS) for (const id of ids) LANG[id] = spec;
  DB.DBF_LANG = LANG;

  function makeDecoder(spec) {
    if (spec && spec.startsWith('dos:')) {
      const high = DB.DBF_CODEPAGES[spec.slice(4)];
      return { name: 'cp' + spec.slice(4), decode(b) { let s = ''; for (let i = 0; i < b.length; i++) s += b[i] < 128 ? String.fromCharCode(b[i]) : high[b[i] - 128]; return s; } };
    }
    const td = new TextDecoder(spec);
    return { name: spec, decode: (b) => td.decode(b) };
  }

  const ascii = (b, a, e) => { let s = ''; for (let i = a; i < e; i++) s += String.fromCharCode(b[i]); return s; };

  /* The field descriptions: from byte 32, 32 bytes each, up to a 0x0D. Returns null when the header does not hold together. */
  function readFields(u8, hdr) {
    const fields = [];
    let p = 32;
    while (p + 32 <= hdr && u8[p] !== 0x0d) {
      fields.push({ at: p, type: String.fromCharCode(u8[p + 11]), len: u8[p + 16], dec: u8[p + 17], flags: u8[p + 18] });
      p += 32;
    }
    if (u8[p] !== 0x0d || !fields.length) return null;
    return fields;
  }
  DB.looksLikeDbf = function (u8) {
    if (u8.length < 66 || !(u8[0] in VERSIONS)) return false;
    const hdr = u8[8] | (u8[9] << 8), rec = u8[10] | (u8[11] << 8);
    if (hdr < 33 || hdr > u8.length || rec < 2) return false;
    const fields = readFields(u8, hdr);
    return !!fields && fields.reduce((a, f) => a + f.len, 1) === rec;
  };

  const pad2 = (n) => String(n).padStart(2, '0');
  // Julian day number -> "YYYY-MM-DD" (proleptic Gregorian, the algorithm of Fliegel and Van Flandern)
  function fromJulian(jd) {
    let l = jd + 68569;
    const n = Math.floor((4 * l) / 146097);
    l -= Math.floor((146097 * n + 3) / 4);
    const i = Math.floor((4000 * (l + 1)) / 1461001);
    l = l - Math.floor((1461 * i) / 4) + 31;
    const j = Math.floor((80 * l) / 2447);
    const d = l - Math.floor((2447 * j) / 80);
    l = Math.floor(j / 11);
    const m = j + 2 - 12 * l;
    const y = 100 * (n - 49) + i + l;
    return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d);
  }
  function currency(dv, o) {
    const v = dv.getBigInt64(o, true);
    const neg = v < 0n;
    const s = String(neg ? -v : v).padStart(5, '0');
    const frac = s.slice(-4).replace(/0+$/, '');
    return (neg ? '-' : '') + s.slice(0, -4) + (frac ? '.' + frac : '');
  }

  function sqlTypeOf(f) {
    switch (f.type) {
      case 'C': return 'CHAR(' + f.len + ')';
      case 'V': return 'VARCHAR(' + f.len + ')';
      case 'N': return f.dec ? 'NUMERIC(' + f.len + ',' + f.dec + ')' : 'NUMERIC(' + f.len + ')';
      case 'F': return 'FLOAT(' + f.len + ',' + f.dec + ')';
      case 'D': return 'DATE';
      case 'L': return 'BOOLEAN';
      case 'M': return 'MEMO';
      case 'G': return 'GENERAL (OLE)';
      case 'P': return 'PICTURE';
      case 'I': return 'INTEGER';
      case '+': return 'AUTOINCREMENT';
      case 'Y': return 'CURRENCY';
      case 'B': return f.len === 8 ? 'DOUBLE' : 'MEMO (binary)';
      case 'O': return 'DOUBLE';
      case 'T': case '@': return 'DATETIME';
      default: return f.type;
    }
  }

  DB.parseDbf = function (u8, opts) {
    const maxRows = (opts && opts.maxRows) || 0;
    if (!DB.looksLikeDbf(u8)) throw new DB.UserError('errCorrupt', { ext: '.dbf' });
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const version = u8[0];
    const nRec = dv.getUint32(4, true), hdr = dv.getUint16(8, true), rec = dv.getUint16(10, true), lang = u8[29];
    const fields = readFields(u8, hdr);

    // the text encoding: the language driver byte, else UTF-8 when it fits, else Windows-1252
    let spec = LANG[lang];
    let encNote = spec ? '' : ' (no code page in the file)';
    const have = Math.min(nRec, Math.floor((u8.length - hdr) / rec));
    if (!spec) {
      spec = 'utf-8';
      try {
        const td = new TextDecoder('utf-8', { fatal: true });
        for (let i = 0; i < Math.min(have, 2000) && spec === 'utf-8'; i++) td.decode(u8.subarray(hdr + i * rec + 1, hdr + (i + 1) * rec));
      } catch (e) { spec = 'windows-1252'; }
    }
    const dec = makeDecoder(spec);

    // columns (the hidden _NullFlags field is not one)
    let off = 1;
    const cols = [];
    let nullAt = -1;
    for (const f of fields) {
      f.off = off; off += f.len;
      const nb = u8.subarray(f.at, f.at + 11), z = nb.indexOf(0);
      f.name = dec.decode(z < 0 ? nb : nb.subarray(0, z)).trim();
      if (f.type === '0') { nullAt = f.off; continue; }
      f.index = cols.length;
      cols.push({ name: f.name || 'column_' + (cols.length + 1), meta: { sqlType: sqlTypeOf(f) } });
    }
    // VFP _NullFlags: in field order, one bit per nullable field, then one more per varchar / varbinary field ("shorter than
    // the field": its real length is then in the field's last byte). Same order as Harbour's DBF driver; from the format's
    // description, no VFP-written varchar file here (tests/test_dbf.cjs marks that case synthetic).
    let bits = 0;
    for (const f of fields) {
      if (f.type === '0') continue;
      if (f.flags & 0x02) f.nullBit = bits++;
      if (f.type === 'V' || f.type === 'Q') f.lenBit = bits++;
    }
    const useNull = nullAt >= 0 && bits > 0;
    const bit = (o, n) => (u8[o + nullAt + (n >> 3)] >> (n & 7)) & 1;

    const rows = [];
    let deleted = 0, total = 0, truncatedAt = false;
    const memo = fields.filter((f) => f.type === 'M' || f.type === 'G' || f.type === 'P' || (f.type === 'B' && f.len !== 8)).map((f) => f.name);
    for (let i = 0; i < have; i++) {
      const o = hdr + i * rec;
      if (u8[o] === 0x1a) break;                          // end-of-file marker inside the record area
      if (u8[o] === 0x2a) { deleted++; continue; }        // deleted record
      total++;
      if (maxRows && rows.length >= maxRows) { truncatedAt = true; continue; }
      const row = new Array(cols.length);
      for (const f of fields) {
        if (f.type === '0') continue;
        const a = o + f.off, e = a + f.len;
        let v = '';
        if (useNull && f.nullBit !== undefined && bit(o, f.nullBit)) { row[f.index] = ''; continue; }
        switch (f.type) {
          case 'C': case 'V': {
            if (f.flags & 0x04) { v = '[binary ' + f.len + ' bytes]'; break; }
            let z = e;
            if (useNull && f.lenBit !== undefined && bit(o, f.lenBit)) z = a + Math.min(u8[e - 1], f.len - 1);   // varchar shorter than the field
            while (z > a && (u8[z - 1] === 0x20 || u8[z - 1] === 0)) z--;
            v = z > a ? dec.decode(u8.subarray(a, z)) : '';
            break;
          }
          case 'N': case 'F': {
            const t = ascii(u8, a, e).trim();
            v = /\d/.test(t) && !t.includes('*') ? t : '';
            break;
          }
          case 'D': {
            const t = ascii(u8, a, e);
            v = /^\d{8}$/.test(t) && t !== '00000000' ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6) : '';
            break;
          }
          case 'L': { const c = String.fromCharCode(u8[a]); v = 'TtYy'.includes(c) ? 'true' : 'FfNn'.includes(c) ? 'false' : ''; break; }
          case 'I': case '+': v = f.len === 4 ? String(dv.getInt32(a, true)) : ''; break;
          case 'Y': v = f.len === 8 ? currency(dv, a) : ''; break;
          case 'B': case 'O': if (f.len === 8) v = DB.str(dv.getFloat64(a, true)); break;
          case 'T': case '@': {
            if (f.len !== 8) break;
            const jd = dv.getInt32(a, true), ms = dv.getInt32(a + 4, true);
            if (!jd) break;
            const s = Math.floor(ms / 1000), r = ms % 1000;
            v = fromJulian(jd) + ' ' + pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60) + (r ? '.' + String(r).padStart(3, '0') : '');
            break;
          }
          default: break;                                  // memo and general fields: the text is in another file
        }
        row[f.index] = v;
      }
      rows.push(row);
    }

    const fileMeta = [['mDbVersion', VERSIONS[version] + ' (0x' + version.toString(16).padStart(2, '0') + ')'], ['mEncoding', dec.name + encNote]];
    if (memo.length) fileMeta.push(['mMemo', memo.map((x) => '`' + x + '`').join(', ')]);
    if (deleted) fileMeta.push(['mDeleted', String(deleted)]);
    if (have < nRec) fileMeta.push(['mCutRecords', String(nRec - have)]);
    if (truncatedAt) fileMeta.push(['mRowsCut', String(maxRows)]);
    return { sections: [{ name: '', columns: cols, rows, rowsTotal: total }], fileMeta, notes: {} };
  };
})();
