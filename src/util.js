/* DataBrief - shared helpers. GPL-3.0-or-later. */
'use strict';
(function () {
  const DB = (window.DB = window.DB || {});

  class UserError extends Error {
    constructor(key, vars, detail) { super(key); this.key = key; this.vars = vars || {}; this.detail = detail || ''; }
  }
  DB.UserError = UserError;

  const pad = (n, w) => String(n).padStart(w || 2, '0');
  DB.pad = pad;

  /* Numbers: remove float noise (0.30000000000000004 -> 0.3) without changing real values. */
  DB.cleanNum = function (n) {
    if (typeof n === 'bigint') return n.toString();
    if (typeof n !== 'number') return String(n);
    if (Number.isNaN(n)) return '';
    if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
    if (Number.isInteger(n)) return String(n);
    return String(Number(n.toPrecision(15)));
  };

  DB.isoParts = function (y, m, d, H, M, S, kind) {
    const date = pad(y, 4) + '-' + pad(m) + '-' + pad(d);
    const time = pad(H) + ':' + pad(M) + ':' + pad(S);
    if (kind === 'date') return date;
    if (kind === 'time') return time;
    return date + ' ' + time;
  };

  /* Date object -> ISO text (UTC). Date only when the time is midnight. */
  DB.isoFromDate = function (dt) {
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return '';
    const s = dt.toISOString();
    if (s.endsWith('T00:00:00.000Z')) return s.slice(0, 10);
    return s.replace('T', ' ').replace(/\.000Z$/, '').replace(/Z$/, '');
  };

  /* Compact JSON text. 64-bit integers (BigInt) are written as numbers, not as quoted strings. */
  DB.json = function (v) {
    const ser = (x) => {
      if (x === null || x === undefined) return 'null';
      if (typeof x === 'bigint') return x.toString();
      if (typeof x === 'number') return Number.isFinite(x) ? String(x) : 'null';
      if (typeof x === 'boolean') return String(x);
      if (typeof x === 'string') return JSON.stringify(x);
      if (x instanceof Uint8Array) return JSON.stringify('[binary ' + x.length + ' bytes]');
      if (x instanceof Date) return JSON.stringify(x);
      if (Array.isArray(x)) return '[' + x.map(ser).join(',') + ']';
      if (typeof x === 'object') {
        if (typeof x.toJSON === 'function') return ser(x.toJSON());
        return '{' + Object.keys(x).filter((k) => x[k] !== undefined && typeof x[k] !== 'function').map((k) => JSON.stringify(k) + ':' + ser(x[k])).join(',') + '}';
      }
      return 'null';
    };
    return ser(v);
  };

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
    !(v instanceof Date) && !(v instanceof Uint8Array) && !ArrayBuffer.isView(v);
  DB.isPlainObject = isPlainObject;

  /* Any value -> cell text. Empty string = missing. */
  DB.str = function (v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return DB.cleanNum(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof Date) return DB.isoFromDate(v);
    if (v instanceof Uint8Array) return '[binary ' + v.length + ' bytes]';
    return DB.json(v);
  };

  /* Flatten records: objects become a.b.c columns, lists stay as JSON text. */
  DB.flattenRecords = function (records) {
    const index = new Map();
    const cols = [];
    const rows = [];
    const flags = { flattened: false, arrays: false, isoDates: false };
    function add(row, key, val) {
      let i = index.get(key);
      if (i === undefined) { i = cols.length; index.set(key, i); cols.push(key); }
      row[i] = val;
    }
    function walk(row, prefix, v, depth) {
      if (isPlainObject(v) && depth < 32) {
        const keys = Object.keys(v);
        if (!keys.length) { add(row, prefix || 'value', ''); return; }
        if (prefix) flags.flattened = true;
        for (const k of keys) walk(row, prefix ? prefix + '.' + k : k, v[k], depth + 1);
      } else if (Array.isArray(v)) {
        flags.arrays = true;
        add(row, prefix || 'value', v.length ? DB.json(v) : '');
      } else {
        if (v instanceof Date) flags.isoDates = true;
        add(row, prefix || 'value', DB.str(v));
      }
    }
    for (const r of records) { const row = []; walk(row, '', r, 0); rows.push(row); }
    const n = cols.length;
    for (const row of rows) for (let i = 0; i < n; i++) if (row[i] === undefined) row[i] = '';
    return { columns: cols, rows, flags };
  };

  /* Find the record lists inside a JSON-like tree. Returns [{name, records}]. */
  DB.sectionsFromTree = function (root, rootName) {
    if (Array.isArray(root)) return [{ name: rootName, records: root }];
    if (!isPlainObject(root)) return [{ name: rootName, records: [root] }];
    const hasObjArray = (a) => Array.isArray(a) && a.length > 0 && a.some(isPlainObject);
    const containsObjArray = (o, depth) => {
      if (depth > 6) return false;
      for (const v of Object.values(o)) {
        if (hasObjArray(v)) return true;
        if (isPlainObject(v) && containsObjArray(v, depth + 1)) return true;
      }
      return false;
    };
    const sections = [];
    const rest = {};
    let restCount = 0;
    const scan = (obj, path, depth) => {
      for (const [k, v] of Object.entries(obj)) {
        const p = path ? path + '.' + k : k;
        if (hasObjArray(v)) sections.push({ name: p, records: v });
        else if (isPlainObject(v) && depth < 6 && containsObjArray(v, 0)) scan(v, p, depth + 1);
        else { rest[p] = v; restCount++; }
      }
    };
    scan(root, '', 0);
    if (!sections.length) {
      // Lists of plain values (e.g. ["a","b"]) become one-column sections.
      for (const [k, v] of Object.entries(root)) if (Array.isArray(v) && v.length > 1) sections.push({ name: k, records: v });
      if (sections.length) {
        for (const s of sections) delete rest[s.name];
        restCount = Object.keys(rest).length;
      }
    }
    if (!sections.length) {
      const vals = Object.values(root);
      if (vals.length > 1 && vals.every(isPlainObject)) {
        return [{ name: rootName, records: Object.entries(root).map(([k, v]) => Object.assign({ _key: k }, v)) }];
      }
      return [{ name: rootName, records: [root] }];
    }
    if (restCount) sections.unshift({ name: '(root)', records: [rest] });
    return sections;
  };

  /* ---------- Type detection on text values ---------- */
  const RX = {
    bool: /^(true|false)$/i,
    int: /^[+-]?\d+$/,
    dec: /^[+-]?(\d+[.,]\d+|\d+\.|[.,]\d+|\d+)([eE][+-]?\d+)?$/,
    date: /^(\d{4}-\d{1,2}-\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/,
    datetime: /^(\d{4}-\d{1,2}-\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})[T ]\d{1,2}:\d{2}(:\d{2}([.,]\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|[AaPp][Mm])?$/,
    time: /^\d{1,2}:\d{2}(:\d{2}([.,]\d+)?)?(\s*[AaPp][Mm])?$/,
  };
  DB.typeOf = function (v) {
    v = v.trim();
    if (v === '') return 'empty';
    if (RX.bool.test(v)) return 'boolean';
    if (RX.int.test(v)) return /^[+-]?0\d/.test(v) ? 'text' : 'integer';
    if (RX.dec.test(v)) return 'decimal';
    if (RX.date.test(v)) return 'date';
    if (RX.datetime.test(v)) return 'datetime';
    if (RX.time.test(v)) return 'time';
    return 'text';
  };
  DB.detectColumnType = function (rows, ci, limit) {
    const seen = {};
    let n = 0;
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r][ci];
      if (v === '' || v === undefined) continue;
      const t = DB.typeOf(v);
      seen[t] = 1;
      if (t === 'text' || ++n >= (limit || 20000)) break;
    }
    const ks = Object.keys(seen);
    if (!ks.length) return 'empty';
    if (seen.text) return 'text';
    if (ks.length === 1) return ks[0];
    if (ks.every((k) => k === 'integer' || k === 'decimal')) return 'decimal';
    if (ks.every((k) => k === 'date' || k === 'datetime')) return 'datetime';
    return 'mixed';
  };

  /* ---------- Grids (CSV, sheets, HTML tables) ---------- */
  DB.uniqueNames = function (names) {
    const used = new Map();
    return names.map((n) => {
      let base = n, k = used.get(base);
      if (k === undefined) { used.set(base, 1); return base; }
      let name;
      do { k++; name = base + '_' + k; } while (used.has(name));
      used.set(base, k); used.set(name, 1);
      return name;
    });
  };

  DB.colLetter = function (i) {
    let s = '';
    i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  };

  /*
   * grid: array of rows (arrays of strings). Removes empty rows and trailing empty columns,
   * detects the header row and builds a section.
   * opts: { header: 'auto'|'yes'|'no', headerRow: [...] (already known), genName: i => name }
   */
  DB.gridToSection = function (grid, name, opts) {
    opts = opts || {};
    const genName = opts.genName || ((i) => 'column_' + (i + 1));
    let rows = grid.filter((r) => r && r.some((c) => c !== '' && c !== undefined && c !== null));
    let width = 0;
    const scan = opts.headerRow ? rows.concat([opts.headerRow]) : rows;
    for (const r of scan) for (let i = r.length - 1; i >= width; i--) if (r[i] !== '' && r[i] != null) { width = i + 1; break; }
    const norm = (r) => { const o = new Array(width); for (let i = 0; i < width; i++) o[i] = r[i] == null ? '' : String(r[i]); return o; };
    rows = rows.map(norm);
    let header = opts.headerRow ? norm(opts.headerRow) : null;
    let noHeader = false;
    if (!header && rows.length) {
      const first = rows[0];
      const looksHeader = opts.header === 'yes' ||
        (opts.header !== 'no' && first.some((c) => c.trim() !== '') &&
          first.every((c) => c.trim() === '' || DB.typeOf(c) === 'text') && rows.length > 1);
      if (looksHeader) header = rows.shift();
      else noHeader = true;
    }
    const names = DB.uniqueNames(new Array(width).fill(0).map((_, i) => {
      const h = header ? header[i].replace(/\s+/g, ' ').trim() : '';
      return h || genName(i);
    }));
    return { name, columns: names.map((n) => ({ name: n, meta: {} })), rows, noHeader: noHeader && width > 0 };
  };

  /* ---------- Text decoding ---------- */
  DB.decodeText = function (buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'UTF-16LE' };
    if (u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'UTF-16BE' };
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('windows-1252').decode(u8), encoding: 'Windows-1252' };
    }
  };

  /* ---------- Delimited text ---------- */
  DB.parseDelimited = function (text, d, maxRows) {
    const rows = [];
    const n = text.length;
    let i = 0, row = [];
    if (!n) return rows;
    while (i < n) {
      let field;
      if (text.charCodeAt(i) === 34) {
        let j = i + 1, buf = '';
        for (;;) {
          const q = text.indexOf('"', j);
          if (q < 0) { buf += text.slice(j); i = n; break; }
          if (text.charCodeAt(q + 1) === 34) { buf += text.slice(j, q + 1); j = q + 2; continue; }
          buf += text.slice(j, q); i = q + 1; break;
        }
        let k = i;
        while (k < n) { const c = text[k]; if (c === d || c === '\n' || c === '\r') break; k++; }
        if (k > i) buf += text.slice(i, k);
        i = k; field = buf;
      } else {
        let k = i;
        while (k < n) { const c = text[k]; if (c === d || c === '\n' || c === '\r') break; k++; }
        field = text.slice(i, k); i = k;
      }
      row.push(field);
      if (i >= n) { rows.push(row); break; }
      const c = text[i];
      if (c === d) { i++; if (i >= n) { row.push(''); rows.push(row); } continue; }
      rows.push(row); row = [];
      if (c === '\r' && text[i + 1] === '\n') i += 2; else i++;
      if (maxRows && rows.length >= maxRows) break;
    }
    return rows;
  };

  DB.detectDelimiter = function (text, preferred) {
    const sample = text.slice(0, 200000);
    let best = preferred || ',', bestScore = -1;
    for (const d of [',', ';', '\t', '|']) {
      const rows = DB.parseDelimited(sample, d, 60);
      if (rows.length > 2 && sample.length >= 200000) rows.pop();
      const counts = new Map();
      for (const r of rows) if (r.length > 1 || r[0] !== '') counts.set(r.length, (counts.get(r.length) || 0) + 1);
      let mode = 1, freq = 0;
      for (const [k, v] of counts) if (v > freq || (v === freq && k > mode)) { mode = k; freq = v; }
      const total = rows.length || 1;
      let score = mode > 1 ? (freq / total) * 1000 + Math.min(mode, 50) : 0;
      if (d === preferred && score > 0) score += 5;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return bestScore > 0 ? best : (preferred || ',');
  };

  DB.fmtBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };

  /* Approximate token count (see the explanation in the page). */
  DB.estimateTokens = (s) => Math.ceil(DB.estimateTokensRaw(s));
  DB.estimateTokensRaw = function (s) {
    let t = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 128) t += c >= 48 && c <= 57 ? 0.4 : 0.25;
      else if (c < 0x0250) t += 0.4;
      else if (c >= 0x0370 && c < 0x0530) t += 0.45;
      else if (c >= 0x0590 && c < 0x0800) t += 0.6;
      else if (c >= 0x0900 && c < 0x0e80) t += 0.7;
      else if ((c >= 0x2e80 && c < 0xa000) || (c >= 0xac00 && c < 0xd7b0) || (c >= 0xf900 && c < 0xfb00) || (c >= 0xff00 && c < 0xfff0)) t += 1;
      else if (c >= 0xd800 && c < 0xdc00) { t += 1; i++; }
      else t += 0.5;
    }
    return t;
  };
})();
