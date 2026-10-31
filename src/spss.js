/* DataBrief - SPSS system file (.sav / .zsav) reader. GPL-3.0-or-later.
 * Written from the public format description in the GNU PSPP documentation.
 * Reads: variables, long names, very long strings, variable labels, value labels (incl. long strings),
 * missing values, print formats, measurement levels, file label, documents, encoding,
 * uncompressed / bytecode-compressed / zlib-compressed data. */
'use strict';
(function () {
  const DB = window.DB;

  const FORMATS = {
    1: 'A', 2: 'AHEX', 3: 'COMMA', 4: 'DOLLAR', 5: 'F', 6: 'IB', 7: 'PIBHEX', 8: 'P', 9: 'PIB', 10: 'PK', 11: 'RB',
    12: 'RBHEX', 15: 'Z', 16: 'N', 17: 'E', 20: 'DATE', 21: 'TIME', 22: 'DATETIME', 23: 'ADATE', 24: 'JDATE',
    25: 'DTIME', 26: 'WKDAY', 27: 'MONTH', 28: 'MOYR', 29: 'QYR', 30: 'WKYR', 31: 'PCT', 32: 'DOT', 33: 'CCA',
    34: 'CCB', 35: 'CCC', 36: 'CCD', 37: 'CCE', 38: 'EDATE', 39: 'SDATE', 40: 'MTIME', 41: 'YMDHMS',
  };
  const DATE_FMT = new Set([20, 23, 24, 28, 29, 30, 38, 39]);
  const DATETIME_FMT = new Set([22, 41]);
  const DURATION_FMT = new Set([21, 25, 40]);
  const CODEPAGES = {
    65001: 'utf-8', 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253',
    1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258',
    28591: 'iso-8859-1', 28592: 'iso-8859-2', 28605: 'iso-8859-15', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr',
    950: 'big5', 874: 'windows-874', 20127: 'windows-1252', 2: 'windows-1252', 3: 'windows-1252',
  };
  // Seconds between the SPSS epoch (1582-10-14) and the Unix epoch (1970-01-01).
  const SPSS_EPOCH_OFFSET = 12219379200;

  DB.parseSav = function (buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== '$FL2' && magic !== '$FL3') throw new Error('Not an SPSS system file');
    const layout = dv.getInt32(64, true);
    const le = layout === 2 || layout === 3;
    let pos = 0;
    const need = (n) => { if (pos + n > u8.length) throw new Error('Unexpected end of file'); };
    const i32 = () => { need(4); const v = dv.getInt32(pos, le); pos += 4; return v; };
    const f64 = () => { need(8); const v = dv.getFloat64(pos, le); pos += 8; return v; };
    const i64 = () => { need(8); const v = Number(dv.getBigInt64(pos, le)); pos += 8; return v; };
    const bytes = (n) => { need(n); const b = u8.subarray(pos, pos + n); pos += n; return b; };
    const latin = (b) => { let s = ''; for (let k = 0; k < b.length; k++) s += String.fromCharCode(b[k]); return s; };

    pos = 4;
    const productRaw = bytes(60);
    pos = 68;
    i32(); // nominal case size (recomputed from the variable records)
    const compression = i32();
    const weightIndex = i32();
    let ncases = i32();
    const bias = f64();
    const cdate = latin(bytes(9)), ctime = latin(bytes(8));
    const fileLabelRaw = bytes(64);
    pos += 3;

    const varRecs = [];
    const labelSets = [];
    const docs = [];
    const ext = {};
    let sysmis = -Number.MAX_VALUE, highest = Number.MAX_VALUE, lowest = -Number.MAX_VALUE;
    loop: for (;;) {
      const rt = i32();
      switch (rt) {
        case 2: {
          const type = i32(), hasLabel = i32(), nMiss = i32(), print = i32();
          i32(); // write format
          const nameRaw = bytes(8);
          let labelRaw = null;
          if (hasLabel) { const len = i32(); labelRaw = bytes(len); pos += (4 - (len % 4)) % 4; }
          const miss = [];
          for (let k = 0; k < Math.abs(nMiss); k++) miss.push(bytes(8));
          varRecs.push({ type, nMiss, miss, print, nameRaw, labelRaw });
          break;
        }
        case 3: {
          const n = i32();
          const labels = [];
          for (let k = 0; k < n; k++) {
            const raw = bytes(8);
            need(1);
            const len = u8[pos]; pos += 1;
            const lab = bytes(len);
            pos += (8 - ((len + 1) % 8)) % 8;
            labels.push({ raw, lab });
          }
          if (i32() !== 4) throw new Error('Corrupt value label record');
          const nv = i32();
          const vars = [];
          for (let k = 0; k < nv; k++) vars.push(i32());
          labelSets.push({ labels, vars });
          break;
        }
        case 6: { const n = i32(); for (let k = 0; k < n; k++) docs.push(bytes(80)); break; }
        case 7: {
          const sub = i32(), size = i32(), count = i32();
          const start = pos;
          const data = bytes(size * count);
          ext[sub] = { size, count, data, start };
          break;
        }
        case 999: i32(); break loop;
        default: throw new Error('Unknown record type ' + rt + ' at byte ' + (pos - 4));
      }
    }
    const dataStart = pos;

    // --- extension records ---
    let encoding = null;
    if (ext[20]) encoding = latin(ext[20].data).trim();
    if (ext[3]) {
      const e = ext[3];
      const cp = new DataView(e.data.buffer, e.data.byteOffset, e.data.byteLength).getInt32(28, le);
      if (!encoding && CODEPAGES[cp]) encoding = CODEPAGES[cp];
    }
    if (ext[4]) {
      const fdv = new DataView(ext[4].data.buffer, ext[4].data.byteOffset, ext[4].data.byteLength);
      sysmis = fdv.getFloat64(0, le); highest = fdv.getFloat64(8, le); lowest = fdv.getFloat64(16, le);
    }
    if (ext[16] && ext[16].count === 2) {
      const n = Number(new DataView(ext[16].data.buffer, ext[16].data.byteOffset, 16).getBigInt64(8, le));
      if (n >= 0) ncases = n;
    }
    let decoder;
    try { decoder = new TextDecoder(encoding || 'windows-1252'); } catch (e) { decoder = new TextDecoder('utf-8'); }
    const dec = (b) => decoder.decode(b).replace(/[\s\u0000]+$/, '');

    // --- variables ---
    const vars = [];
    const slotVar = [];
    varRecs.forEach((r, slot) => {
      if (r.type === -1) { const last = vars[vars.length - 1]; if (last) { last.nslots++; slotVar[slot] = last; } return; }
      const fmt = r.print;
      const v = {
        shortName: dec(r.nameRaw), type: r.type, width: r.type, slot, nslots: 1,
        label: r.labelRaw ? dec(r.labelRaw) : '', fmtType: (fmt >> 16) & 0xff, fmtW: (fmt >> 8) & 0xff, fmtD: fmt & 0xff,
        nMiss: r.nMiss, miss: r.miss, labels: null, measure: 0, segments: null,
      };
      v.name = v.shortName;
      vars.push(v);
      slotVar[slot] = v;
    });

    if (ext[11]) {
      const e = ext[11];
      const edv = new DataView(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      const per = e.count === vars.length * 3 ? 3 : e.count === vars.length * 2 ? 2 : 0;
      if (per) vars.forEach((v, k) => { v.measure = edv.getInt32(k * per * 4, le); });
    }
    if (ext[13]) {
      const map = {};
      for (const pair of decoder.decode(ext[13].data).split('\t')) {
        const eq = pair.indexOf('=');
        if (eq > 0) map[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1).replace(/\u0000/g, '');
      }
      for (const v of vars) if (map[v.shortName.toUpperCase()]) v.name = map[v.shortName.toUpperCase()];
    }

    // value labels (attached by slot index, before very long strings are merged)
    for (const set of labelSets) {
      const targets = set.vars.map((idx) => slotVar[idx - 1]).filter(Boolean);
      if (!targets.length) continue;
      const isNum = targets[0].type === 0;
      const map = new Map();
      for (const { raw, lab } of set.labels) {
        const key = isNum ? new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, le) : dec(raw);
        map.set(key, dec(lab));
      }
      for (const t of targets) { t.labels = t.labels || new Map(); for (const [k, l] of map) t.labels.set(k, l); }
    }

    // very long strings (> 255 bytes) are stored as several 255-byte segments
    if (ext[14]) {
      const widths = {};
      for (const part of decoder.decode(ext[14].data).split(/[\t\u0000]+/)) {
        const eq = part.indexOf('=');
        if (eq > 0) widths[part.slice(0, eq).toUpperCase()] = parseInt(part.slice(eq + 1), 10);
      }
      for (let k = 0; k < vars.length; k++) {
        const v = vars[k];
        const w = widths[v.shortName.toUpperCase()];
        if (!w || w <= 255) continue;
        const nseg = Math.ceil(w / 252);
        v.segments = vars.slice(k, k + nseg);
        v.width = w;
        vars.splice(k + 1, nseg - 1);
      }
    }

    const byName = new Map();
    for (const v of vars) { byName.set(v.name.toUpperCase(), v); byName.set(v.shortName.toUpperCase(), v); }

    // long string value labels
    if (ext[21]) {
      const d = ext[21].data;
      const ddv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      let p = 0;
      const ri = () => { const x = ddv.getInt32(p, le); p += 4; return x; };
      while (p + 4 <= d.length) {
        const nl = ri(); const vname = dec(d.subarray(p, p + nl)); p += nl;
        ri(); // width
        const n = ri();
        const v = byName.get(vname.toUpperCase());
        for (let k = 0; k < n; k++) {
          const vl = ri(); const val = dec(d.subarray(p, p + vl)); p += vl;
          const ll = ri(); const lab = dec(d.subarray(p, p + ll)); p += ll;
          if (v) { v.labels = v.labels || new Map(); v.labels.set(val, lab); }
        }
      }
    }

    // --- data ---
    const nslots = varRecs.length;
    let data = u8, dataPos = dataStart, dataDv = dv;
    if (compression === 2) {
      // zlib: header, blocks, trailer
      pos = dataStart;
      i64(); const ztrailerOfs = i64(); i64();
      pos = ztrailerOfs;
      const zbias = i64(); i64(); i32();
      const nBlocks = i32();
      const blocks = [];
      for (let k = 0; k < nBlocks; k++) { const uofs = i64(), cofs = i64(), usize = i32(), csize = i32(); blocks.push({ uofs, cofs, usize, csize }); }
      const parts = blocks.map((b) => window.fflate.unzlibSync(u8.subarray(b.cofs, b.cofs + b.csize)));
      const total = parts.reduce((s, p) => s + p.length, 0);
      data = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { data.set(p, o); o += p.length; }
      dataPos = 0;
      dataDv = new DataView(data.buffer);
      void zbias;
    }

    const nums = new Float64Array(nslots);
    const strBuf = new Uint8Array(nslots * 8);
    const isStrSlot = new Uint8Array(nslots);
    varRecs.forEach((r, s) => { isStrSlot[s] = r.type !== 0 ? 1 : 0; });
    const SPACES = 0x20;
    let p = dataPos;
    let cmd = 0, cmdIdx = 8;

    function readCase() {
      if (compression === 0) {
        if (p + nslots * 8 > data.length) return false;
        for (let s = 0; s < nslots; s++) {
          if (isStrSlot[s]) strBuf.set(data.subarray(p, p + 8), s * 8);
          else nums[s] = dataDv.getFloat64(p, le);
          p += 8;
        }
        return true;
      }
      for (let s = 0; s < nslots; s++) {
        let code;
        for (;;) {
          if (cmdIdx >= 8) {
            if (p + 8 > data.length) return false;
            cmd = p; p += 8; cmdIdx = 0;
          }
          code = data[cmd + cmdIdx++];
          if (code !== 0) break;
        }
        if (code === 252) return false;
        if (code === 253) {
          if (p + 8 > data.length) return false;
          if (isStrSlot[s]) strBuf.set(data.subarray(p, p + 8), s * 8);
          else nums[s] = dataDv.getFloat64(p, le);
          p += 8;
        } else if (code === 254) {
          if (isStrSlot[s]) strBuf.fill(SPACES, s * 8, s * 8 + 8); else nums[s] = sysmis;
        } else if (code === 255) {
          if (isStrSlot[s]) strBuf.fill(SPACES, s * 8, s * 8 + 8); else nums[s] = sysmis;
        } else {
          if (isStrSlot[s]) strBuf.fill(SPACES, s * 8, s * 8 + 8); else nums[s] = code - bias;
        }
      }
      return true;
    }

    const fmtTime = (secs) => {
      const neg = secs < 0; secs = Math.abs(secs);
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.round(secs % 60);
      return (neg ? '-' : '') + DB.pad(h) + ':' + DB.pad(m) + ':' + DB.pad(s);
    };
    let isoDates = false;
    const numText = (v, x) => {
      if (x === sysmis || Number.isNaN(x)) return '';
      if (v.labels && v.labels.has(x)) return v.labels.get(x);
      if (DATE_FMT.has(v.fmtType) || DATETIME_FMT.has(v.fmtType)) {
        isoDates = true;
        const dt = new Date((x - SPSS_EPOCH_OFFSET) * 1000);
        if (isNaN(dt.getTime())) return DB.cleanNum(x);
        const s = dt.toISOString();
        return DATE_FMT.has(v.fmtType) ? s.slice(0, 10) : s.slice(0, 19).replace('T', ' ');
      }
      if (DURATION_FMT.has(v.fmtType)) return fmtTime(x);
      return DB.cleanNum(x);
    };
    const strText = (v) => {
      let raw;
      if (v.segments) {
        const parts = [];
        v.segments.forEach((seg, k) => {
          const b = strBuf.subarray(seg.slot * 8, (seg.slot + seg.nslots) * 8);
          if (k === v.segments.length - 1) { parts.push(b); return; }
          // Writers differ: SPSS/PSPP use 252 bytes of each 255-byte segment, ReadStat uses all 255.
          // Bytes 252-254 hold padding spaces in the first case and data in the second.
          const padded = b[252] === SPACES && b[253] === SPACES && b[254] === SPACES;
          parts.push(b.subarray(0, padded ? 252 : 255));
        });
        const len = parts.reduce((s, b) => s + b.length, 0);
        raw = new Uint8Array(len);
        let o = 0;
        for (const b of parts) { raw.set(b, o); o += b.length; }
      } else {
        raw = strBuf.subarray(v.slot * 8, v.slot * 8 + Math.min(v.width, v.nslots * 8));
      }
      const s = dec(raw);
      if (v.labels && v.labels.has(s)) return v.labels.get(s);
      return s;
    };

    const rows = [];
    const maxCases = ncases >= 0 ? ncases : Infinity;
    while (rows.length < maxCases && readCase()) {
      const row = new Array(vars.length);
      for (let k = 0; k < vars.length; k++) {
        const v = vars[k];
        row[k] = v.type === 0 ? numText(v, nums[v.slot]) : strText(v);
      }
      rows.push(row);
    }

    // --- metadata ---
    const numFmt = (x) => (x <= lowest || x === -Number.MAX_VALUE ? 'LO' : x >= highest ? 'HI' : DB.cleanNum(x));
    const missText = (v) => {
      if (!v.nMiss) return '';
      if (v.type !== 0) return v.miss.map((b) => '"' + dec(b) + '"').join(', ');
      const vals = v.miss.map((b) => new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, le));
      if (v.nMiss > 0) return vals.map(numFmt).join(', ');
      const range = numFmt(vals[0]) + '–' + numFmt(vals[1]);
      return v.nMiss === -3 ? range + ', ' + numFmt(vals[2]) : range;
    };
    const labelsText = (v) => {
      if (!v.labels || !v.labels.size) return '';
      const items = [];
      for (const [k, l] of v.labels) items.push((typeof k === 'number' ? DB.cleanNum(k) : '"' + k + '"') + ' = ' + l);
      return items.length > 60 ? items.slice(0, 60).join('; ') + '; … (+' + (items.length - 60) + ')' : items.join('; ');
    };
    const measure = { 1: 'mNominal', 2: 'mOrdinal', 3: 'mScale' };
    const columns = vars.map((v) => {
      const fname = FORMATS[v.fmtType] || ('#' + v.fmtType);
      const width = v.type === 0 ? v.fmtW : v.width;
      const format = fname + width + (v.type === 0 && v.fmtD ? '.' + v.fmtD : '');
      return {
        name: v.name,
        meta: {
          label: v.label || '', values: labelsText(v), measure: measure[v.measure] ? { key: measure[v.measure] } : '',
          format, missing: missText(v),
        },
      };
    });

    const fileMeta = [];
    const fileLabel = dec(fileLabelRaw);
    if (fileLabel) fileMeta.push(['mFileLabel', fileLabel]);
    const created = (cdate.trim() + ' ' + ctime.trim()).trim();
    if (created) fileMeta.push(['mCreated', created]);
    const product = latin(productRaw).replace(/^@\(#\)\s*/, '').replace(/[\s\u0000]+$/, '');
    if (product) fileMeta.push(['mProduct', product]);
    if (encoding) fileMeta.push(['mEncoding', encoding]);
    if (weightIndex > 0 && slotVar[weightIndex - 1]) fileMeta.push(['mWeight', '`' + slotVar[weightIndex - 1].name + '`']);
    if (docs.length) {
      const text = docs.map(dec).join('\n').trim();
      if (text) fileMeta.push(['mDocs', text]);
    }

    return {
      sections: [{ name: 'data', columns, rows, totalRows: rows.length }],
      fileMeta,
      notes: { valueLabels: vars.some((v) => v.labels && v.labels.size), isoDates },
    };
  };
})();
