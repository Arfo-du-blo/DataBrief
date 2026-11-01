/* DataBrief - format parsers. GPL-3.0-or-later.
 * Every parser returns { sections, fileMeta, notes }:
 *   sections: [{ name, columns: [{ name, meta }], rows: [[string]], noHeader?, comments?, caption?, hidden? }]
 *   fileMeta: [[promptKey, text]]  (shown in the prompt overview)
 *   notes:    flags that add explanations to "How this file is formatted" */
'use strict';
(function () {
  const DB = window.DB;
  const UserError = DB.UserError;

  DB.FORMATS = [
    { key: 'csv', label: 'CSV', exts: ['csv'] },
    { key: 'tsv', label: 'TSV', exts: ['tsv', 'tab'] },
    { key: 'txt', label: 'TXT', exts: ['txt'] },
    { key: 'xlsx', label: 'XLSX', exts: ['xlsx'] },
    { key: 'xlsm', label: 'XLSM', exts: ['xlsm'] },
    { key: 'xls', label: 'XLS', exts: ['xls'] },
    { key: 'ods', label: 'ODS', exts: ['ods'] },
    { key: 'json', label: 'JSON', exts: ['json'] },
    { key: 'ndjson', label: 'NDJSON', exts: ['ndjson', 'jsonl'] },
    { key: 'xml', label: 'XML', exts: ['xml'] },
    { key: 'yaml', label: 'YAML', exts: ['yaml', 'yml'] },
    { key: 'html', label: 'HTML', exts: ['html', 'htm'] },
    { key: 'sav', label: 'SPSS', exts: ['sav', 'zsav'] },
    { key: 'parquet', label: 'Parquet', exts: ['parquet', 'pq'] },
    { key: 'sqlite', label: 'SQLite', exts: ['sqlite', 'sqlite3', 'db', 'db3'] },
  ];
  const FORMAT_NAMES = {
    csv: 'CSV', tsv: 'TSV', txt: 'TXT (CSV)', xlsx: 'Excel (XLSX)', xlsm: 'Excel (XLSM)',
    xls: 'Excel 97-2003 (XLS)', ods: 'OpenDocument (ODS)', json: 'JSON', ndjson: 'NDJSON / JSON Lines',
    xml: 'XML', yaml: 'YAML', html: 'HTML', sav: 'SPSS Statistics (.sav)', zsav: 'SPSS Statistics (.zsav)',
    parquet: 'Apache Parquet', sqlite: 'SQLite',
  };
  DB.ACCEPT = DB.FORMATS.flatMap((f) => f.exts.map((e) => '.' + e)).join(',');

  const extOf = (name) => { const m = /\.([^.]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
  const baseOf = (name) => (name || 'data').replace(/\.[^.]+$/, '') || 'data';

  function sniff(u8) {
    const s = (a, b) => String.fromCharCode.apply(null, u8.subarray(a, b));
    if (u8.length >= 16 && s(0, 15) === 'SQLite format 3') return 'sqlite';
    if (u8.length >= 4 && s(0, 4) === 'PAR1') return 'parquet';
    if (u8.length >= 4 && (s(0, 4) === '$FL2' || s(0, 4) === '$FL3')) return 'sav';
    if (u8.length >= 8 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) return 'xls';
    if (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04) return 'zip';
    return null;
  }

  /* ---------- CSV / TSV / TXT ---------- */
  function parseDelimitedFile(buf, ext, name) {
    const { text, encoding } = DB.decodeText(buf);
    const d = DB.detectDelimiter(text, ext === 'tsv' || ext === 'tab' ? '\t' : null);
    const grid = DB.parseDelimited(text, d);
    const sec = DB.gridToSection(grid, baseOf(name));
    const delimName = { ',': '`,`', ';': '`;`', '\t': '`\\t` (TAB)', '|': '`|`' }[d];
    return {
      sections: [sec],
      fileMeta: [['mDelimiter', delimName], ['mEncoding', encoding]],
      notes: {},
    };
  }

  /* ---------- Spreadsheets (SheetJS) ---------- */
  function parseWorkbook(buf) {
    const XLSX = window.XLSX;
    let wb;
    try {
      wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellNF: true, cellDates: false, cellStyles: false, sheetStubs: false });
    } catch (e) {
      if (/password|encrypt/i.test(String(e && e.message))) throw new UserError('errEncrypted', {}, String(e.message));
      throw e;
    }
    const date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
    let isoDates = false;
    const cellText = (cell) => {
      if (!cell) return '';
      if (cell.t === 'e') return cell.w || '#ERROR';
      if (cell.v === null || cell.v === undefined) return '';
      if (cell.t === 'b') return cell.v ? 'true' : 'false';
      if (cell.t === 'd') { isoDates = true; return DB.isoFromDate(cell.v); }
      if (cell.t === 'n') {
        if (cell.z && XLSX.SSF.is_date(cell.z)) {
          const p = XLSX.SSF.parse_date_code(cell.v, { date1904 });
          if (p) {
            isoDates = true;
            // The number format says whether the column shows a time (h/s or AM/PM, outside quotes and [..]).
            const fmtTime = /[hs]|AM\/PM|A\/P/i.test(String(cell.z).replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
            const hasTime = fmtTime || p.H || p.M || p.S;
            const kind = cell.v < 1 && cell.v >= 0 ? 'time' : hasTime ? 'datetime' : 'date';
            return DB.isoParts(p.y, p.m, p.d, p.H, p.M, p.S, kind);
          }
        }
        return DB.cleanNum(cell.v);
      }
      return String(cell.v);
    };
    const sections = wb.SheetNames.map((name, si) => {
      const ws = wb.Sheets[name];
      const info = (wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[si]) || {};
      const grid = [];
      const comments = [];
      if (ws) {
        for (const addr of Object.keys(ws)) {
          if (addr[0] === '!') continue;
          const cell = ws[addr];
          const rc = XLSX.utils.decode_cell(addr);
          (grid[rc.r] = grid[rc.r] || [])[rc.c] = cellText(cell);
          if (cell && cell.c && cell.c.length) {
            const text = cell.c.map((c) => (c.a ? c.a + ': ' : '') + String(c.t || '').replace(/\s+/g, ' ').trim()).join(' / ');
            comments.push({ rc, addr, text });
          }
        }
      }
      for (let r = 0; r < grid.length; r++) if (!grid[r]) grid[r] = [];
      comments.sort((a, b) => a.rc.r - b.rc.r || a.rc.c - b.rc.c);
      const sec = DB.gridToSection(grid, name, { genName: DB.colLetter });
      sec.comments = comments.map((c) => ({ cell: c.addr, text: c.text }));
      sec.hidden = !!info.Hidden;
      return sec;
    });
    return { sections, fileMeta: [], notes: { isoDates } };
  }

  /* ---------- JSON / NDJSON / YAML (trees) ---------- */
  function treeToDoc(tree, rootName, extraNotes) {
    const found = DB.sectionsFromTree(tree, rootName);
    const notes = Object.assign({}, extraNotes);
    const sections = found.map((f) => {
      const flat = DB.flattenRecords(f.records);
      if (flat.flags.flattened) notes.flattened = true;
      if (flat.flags.arrays) notes.arrays = true;
      if (flat.flags.isoDates) notes.isoDates = true;
      return { name: f.name, columns: flat.columns.map((n) => ({ name: n, meta: {} })), rows: flat.rows };
    });
    return { sections, fileMeta: [], notes };
  }

  function parseJson(buf, ext, name) {
    const { text } = DB.decodeText(buf);
    const t = text.replace(/^﻿/, '');
    const lines = () => t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    let tree;
    if (ext === 'ndjson' || ext === 'jsonl') tree = lines();
    else {
      try { tree = JSON.parse(t); } catch (e) {
        try { tree = lines(); } catch (e2) { throw e; }
      }
    }
    return treeToDoc(tree, baseOf(name));
  }

  function parseYaml(buf, ext, name) {
    const { text } = DB.decodeText(buf);
    const docs = window.jsyaml.loadAll(text).filter((d) => d !== undefined && d !== null);
    return treeToDoc(docs.length === 1 ? docs[0] : docs, baseOf(name));
  }

  /* ---------- XML ---------- */
  function xmlToObj(el) {
    const obj = {};
    let has = false;
    for (const a of Array.from(el.attributes)) { obj['@' + a.name] = a.value; has = true; }
    const kids = new Map();
    let text = '';
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 1) {
        if (!kids.has(n.nodeName)) kids.set(n.nodeName, []);
        kids.get(n.nodeName).push(xmlToObj(n));
      } else if (n.nodeType === 3 || n.nodeType === 4) text += n.nodeValue;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!has && !kids.size) return text;
    for (const [k, list] of kids) obj[k] = list.length > 1 ? list : list[0];
    if (text) obj['#text'] = text;
    return obj;
  }
  function parseXml(buf) {
    const { text } = DB.decodeText(buf);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('Invalid XML: ' + err.textContent.replace(/\s+/g, ' ').trim().slice(0, 300));
    const root = doc.documentElement;
    let tree = xmlToObj(root);
    if (typeof tree !== 'object') tree = { '#text': tree };
    const res = treeToDoc(tree, root.nodeName);
    const xmlAttr = res.sections.some((s) => s.columns.some((c) => /(^|\.)[@#]/.test(c.name)));
    if (xmlAttr) res.notes.xmlAttr = true;
    res.fileMeta.push(['mRoot', '`<' + root.nodeName + '>`']);
    return res;
  }

  /* ---------- HTML tables ---------- */
  function cellText(el) {
    const c = el.cloneNode(true);
    for (const br of Array.from(c.querySelectorAll('br'))) br.replaceWith('\n');
    for (const s of Array.from(c.querySelectorAll('script,style,template'))) s.remove();
    return c.textContent.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  }
  function parseHtml(buf) {
    const { text } = DB.decodeText(buf);
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table')).filter((t) => !t.querySelector('table'));
    if (!tables.length) throw new UserError('errNoTable');
    let spans = false;
    const used = new Set();
    const sections = tables.map((t, ti) => {
      const rows = Array.from(t.rows);
      const grid = [];
      const allTh = [];
      rows.forEach((tr, r) => {
        grid[r] = grid[r] || [];
        let c = 0;
        allTh[r] = tr.cells.length > 0;
        for (const cell of Array.from(tr.cells)) {
          while (grid[r][c] !== undefined) c++;
          const v = cellText(cell);
          if (cell.tagName !== 'TH') allTh[r] = false;
          const rs = Math.min(Math.max(cell.rowSpan || 1, 1), 1000);
          const cs = Math.min(Math.max(cell.colSpan || 1, 1), 1000);
          if (rs > 1 || cs > 1) spans = true;
          for (let i = 0; i < rs && r + i < rows.length; i++) {
            grid[r + i] = grid[r + i] || [];
            for (let j = 0; j < cs; j++) grid[r + i][c + j] = v;
          }
          c += cs;
        }
      });
      for (const g of grid) for (let i = 0; i < g.length; i++) if (g[i] === undefined) g[i] = '';
      let h = t.tHead ? t.tHead.rows.length : 0;
      if (!h) while (h < allTh.length && allTh[h] && h < 3) h++;
      const caption = t.caption ? cellText(t.caption) : '';
      let name = caption || t.getAttribute('aria-label') || t.id || t.getAttribute('summary') || ('table_' + (ti + 1));
      name = name.replace(/\s+/g, ' ').trim().slice(0, 80);
      while (used.has(name)) name += ' (' + (ti + 1) + ')';
      used.add(name);
      let sec;
      if (h > 0) {
        const width = Math.max(0, ...grid.map((g) => g.length));
        const header = new Array(width).fill(0).map((_, i) => {
          const parts = [];
          for (let r = 0; r < h; r++) { const v = (grid[r] && grid[r][i]) || ''; if (v && parts[parts.length - 1] !== v) parts.push(v); }
          return parts.join(' / ');
        });
        sec = DB.gridToSection(grid.slice(h), name, { headerRow: header });
      } else {
        sec = DB.gridToSection(grid, name);
      }
      if (caption) sec.caption = caption;
      return sec;
    });
    return { sections, fileMeta: [], notes: { spans } };
  }

  /* ---------- SQLite (sql.js, WebAssembly) ---------- */
  let sqlPromise = null;
  function getSql() {
    if (!sqlPromise) {
      const b64 = window.DB_SQL_WASM;
      const bin = atob(b64);
      const wasm = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) wasm[i] = bin.charCodeAt(i);
      sqlPromise = window.initSqlJs({ wasmBinary: wasm, locateFile: (f) => f });
    }
    return sqlPromise;
  }
  const qi = (n) => '"' + String(n).replace(/"/g, '""') + '"';
  function allRows(db, sql) {
    const st = db.prepare(sql);
    const out = [];
    try { while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
    return out;
  }
  async function parseSqlite(buf) {
    const SQL = await getSql();
    const db = new SQL.Database(new Uint8Array(buf));
    try {
      let master;
      try {
        master = allRows(db, "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY rowid");
      } catch (e) { throw new UserError('errSqlite', {}, String(e.message || e)); }
      const sections = [];
      const skipped = [];
      // Columns of a table in primary-key order (used when a foreign key does not name its target columns).
      const pkCache = new Map();
      const pkColumns = (table) => {
        if (!pkCache.has(table)) {
          let cols = [];
          try { cols = allRows(db, 'PRAGMA table_info(' + qi(table) + ')').filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name); } catch (e) { /* unknown table */ }
          pkCache.set(table, cols);
        }
        return pkCache.get(table);
      };
      for (const t of master.filter((m) => m.type === 'table')) {
        try {
          // table_xinfo (not table_info) also lists generated columns, which SELECT * returns:
          // header and rows must describe the same columns. hidden: 0 normal, 1 hidden (virtual tables), 2 generated virtual, 3 generated stored.
          const info = allRows(db, 'PRAGMA table_xinfo(' + qi(t.name) + ')').filter((c) => c.hidden === 0 || c.hidden === 2 || c.hidden === 3);

          // Foreign keys: one entry per constraint (a composite key has several rows with the same id).
          const fkMap = new Map();
          for (const f of allRows(db, 'PRAGMA foreign_key_list(' + qi(t.name) + ')')) {
            if (!fkMap.has(f.id)) fkMap.set(f.id, { table: f.table, from: [], to: [], onUpdate: f.on_update, onDelete: f.on_delete });
            const e = fkMap.get(f.id);
            e.from[f.seq] = f.from;
            e.to[f.seq] = f.to;
          }
          const fks = Array.from(fkMap.values()).map((f) => {
            if (f.to.some((x) => x == null)) { // implicit target: the primary key of the referenced table
              const pk = pkColumns(f.table);
              f.to = f.from.map((_, i) => (pk.length === f.from.length ? pk[i] : null));
            }
            return f;
          });

          const columns = info.map((c) => {
            const arrows = [];
            for (const f of fks) {
              const i = f.from.indexOf(c.name);
              if (i >= 0) arrows.push('→ `' + f.table + '.' + (f.to[i] || '?') + '`');
            }
            const key = [c.pk > 0 ? { key: 'pk' } : null].concat(arrows).filter(Boolean);
            const meta = { sqlType: c.type || '', key, notNull: c.notnull ? { key: 'yes' } : '' };
            if (c.hidden === 2) meta.generated = { key: 'genVirtual' };
            else if (c.hidden === 3) meta.generated = { key: 'genStored' };
            return { name: c.name, meta };
          });

          // Indexes: unique constraints and unique indexes together, the others apart (the primary key is listed on its own).
          const unique = [];
          const indexes = [];
          for (const ix of allRows(db, 'PRAGMA index_list(' + qi(t.name) + ')')) {
            if (ix.origin === 'pk') continue;
            const cols = allRows(db, 'PRAGMA index_info(' + qi(ix.name) + ')').sort((a, b) => a.seqno - b.seqno).map((c) => c.name || '<expression>');
            const entry = { name: /^sqlite_autoindex_/.test(ix.name) ? '' : ix.name, cols };
            (ix.unique ? unique : indexes).push(entry);
          }

          // Rows: the columns are named explicitly, in the same order as the header. 64-bit integers stay exact (BigInt).
          const st = db.prepare('SELECT ' + info.map((c) => qi(c.name)).join(', ') + ' FROM ' + qi(t.name));
          const rows = [];
          try { while (st.step()) rows.push(st.get(null, { useBigInt: true }).map(DB.str)); } finally { st.free(); }
          sections.push({
            name: t.name, columns, rows,
            constraints: { pk: info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name), fks, unique, indexes, ddl: t.sql || '' },
          });
        } catch (e) {
          skipped.push(t.name);
        }
      }
      const fileMeta = [];
      const views = master.filter((m) => m.type === 'view');
      if (views.length) fileMeta.push(['mViews', views.map((v) => '`' + v.name + '`').join(', ')]);
      if (skipped.length) fileMeta.push(['mSkipped', skipped.map((v) => '`' + v + '`').join(', ')]);
      return { sections, fileMeta, notes: {}, views: views.map((v) => ({ name: v.name, sql: v.sql || '' })).filter((v) => v.sql) };
    } finally {
      db.close();
    }
  }

  /* ---------- Parquet (hyparquet) ---------- */
  function lz4RawDecompress(input, outputLength) {
    const out = new Uint8Array(outputLength);
    let ip = 0, op = 0;
    while (ip < input.length) {
      const token = input[ip++];
      let lit = token >> 4;
      if (lit === 15) { let b; do { b = input[ip++]; lit += b; } while (b === 255); }
      out.set(input.subarray(ip, ip + lit), op); ip += lit; op += lit;
      if (ip >= input.length) break;
      const offset = input[ip] | (input[ip + 1] << 8); ip += 2;
      let len = token & 15;
      if (len === 15) { let b; do { b = input[ip++]; len += b; } while (b === 255); }
      len += 4;
      for (let k = 0; k < len; k++) { out[op] = out[op - offset]; op++; }
    }
    return out;
  }
  async function parseParquet(buf, ext, name) {
    const H = window.hyparquet;
    const ab = buf instanceof ArrayBuffer ? buf : buf.buffer;
    const metadata = H.parquetMetadata(ab);
    const compressors = {
      GZIP: (input) => window.fflate.gunzipSync(input),
      ZSTD: (input) => window.fzstd.decompress(input),
      LZ4_RAW: lz4RawDecompress,
    };
    let rows;
    try {
      rows = await H.parquetReadObjects({ file: ab, metadata, compressors });
    } catch (e) {
      const m = String(e && e.message || e);
      if (/compress|codec|BROTLI|LZ4/i.test(m)) throw new UserError('errCodec', {}, m);
      throw e;
    }
    for (const r of rows) if (r && typeof r === 'object' && '__index__' in r) delete r.__index__;
    const flat = DB.flattenRecords(rows);
    const schema = H.parquetSchema(metadata);
    const typeOf = {};
    for (const child of (schema.children || [])) {
      const el = child.element || {};
      let t = el.type || (child.children && child.children.length ? 'GROUP' : '');
      const logical = el.logical_type && el.logical_type.type;
      const conv = el.converted_type;
      if (logical && logical !== t) t += ' / ' + logical;
      else if (conv && conv !== t) t += ' / ' + conv;
      if (el.logical_type && el.logical_type.unit) t += ' (' + el.logical_type.unit + ')';
      if (el.logical_type && el.logical_type.precision != null) t += ' (' + el.logical_type.precision + ',' + (el.logical_type.scale || 0) + ')';
      typeOf[el.name] = t;
    }
    const columns = flat.columns.map((c) => {
      const top = typeOf[c] !== undefined ? c : c.split('.')[0];
      return { name: c, meta: { parquetType: typeOf[top] || '' } };
    });
    const fileMeta = [];
    if (metadata.created_by) fileMeta.push(['mProduct', metadata.created_by]);
    const kv = (metadata.key_value_metadata || []).filter((x) => x && x.key && !/^(ARROW:schema|pandas|org\.apache\.spark\.sql\.parquet\.row\.metadata)$/.test(x.key));
    if (kv.length) {
      fileMeta.push(['mEmbedded', kv.map((x) => '`' + x.key + '`: ' + String(x.value == null ? '' : x.value).replace(/\s+/g, ' ').slice(0, 300)).join('; ')]);
    }
    const notes = { isoDates: flat.flags.isoDates };
    if (flat.flags.flattened) notes.flattened = true;
    if (flat.flags.arrays) notes.arrays = true;
    return { sections: [{ name: baseOf(name), columns, rows: flat.rows }], fileMeta, notes };
  }

  /* ---------- dispatch ---------- */
  DB.parseFile = async function (buf, fileName) {
    const u8 = new Uint8Array(buf);
    let ext = extOf(fileName);
    const magic = sniff(u8);
    let kind;
    if (magic === 'zip') kind = ext === 'ods' ? 'ods' : ext === 'xlsm' ? 'xlsm' : 'xlsx';
    else if (magic) kind = magic;
    else {
      const f = DB.FORMATS.find((x) => x.exts.includes(ext));
      if (!f) throw new UserError('errUnsupported', { ext: ext ? '.' + ext : '?' });
      kind = f.key;
      if (['xlsx', 'xlsm', 'xls', 'ods', 'sqlite', 'parquet', 'sav'].includes(kind)) {
        // Binary format expected but the content does not match: try as text.
        const sample = DB.decodeText(u8.subarray(0, 4096)).text.trim();
        if (/^</.test(sample)) kind = /<table/i.test(sample) || /^<!doctype html|^<html/i.test(sample) ? 'html' : 'xml';
        else if (/^[[{]/.test(sample)) kind = 'json';
        else if (kind !== 'xls') throw new UserError('errCorrupt', { ext: '.' + ext });
      }
    }
    let res;
    switch (kind) {
      case 'csv': case 'tsv': case 'txt': res = parseDelimitedFile(buf, ext, fileName); break;
      case 'xlsx': case 'xlsm': case 'xls': case 'ods': res = parseWorkbook(buf); break;
      case 'json': case 'ndjson': res = parseJson(buf, ext, fileName); break;
      case 'yaml': res = parseYaml(buf, ext, fileName); break;
      case 'xml': res = parseXml(buf); break;
      case 'html': res = parseHtml(buf); break;
      case 'sqlite': res = await parseSqlite(buf); break;
      case 'parquet': res = await parseParquet(buf, ext, fileName); break;
      case 'sav': res = DB.parseSav(buf); res.sections[0].name = baseOf(fileName); break;
      default: throw new UserError('errUnsupported', { ext: '.' + ext });
    }
    const formatKey = kind === 'sav' && ext === 'zsav' ? 'zsav' : kind;
    const sectionKind = ['xlsx', 'xlsm', 'xls', 'ods'].includes(kind) ? 'sheets'
      : ['html', 'sqlite'].includes(kind) ? 'tables' : 'records';
    return finalize(Object.assign(res, {
      fileName, fileSize: u8.length, formatKey, formatName: FORMAT_NAMES[formatKey] || kind.toUpperCase(), sectionKind,
    }));
  };

  function finalize(doc) {
    doc.sections = doc.sections.filter((s) => s && s.columns);
    for (const s of doc.sections) {
      s.columns.forEach((c, i) => { c.type = DB.detectColumnType(s.rows, i); });
      s.totalRows = s.rows.length;
    }
    doc.notes = doc.notes || {};
    if (!doc.sections.some((s) => s.rows.length || s.columns.length)) throw new UserError('errEmpty');
    return doc;
  }
})();
