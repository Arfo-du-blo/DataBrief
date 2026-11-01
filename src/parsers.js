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
    { key: 'sql', label: 'SQL', exts: ['sql'] },
    { key: 'pgdump', label: 'pg_dump', exts: ['dump', 'backup', 'pgdump', 'tar'] },
    { key: 'dbf', label: 'DBF', exts: ['dbf'] },
    { key: 'duckdb', label: 'DuckDB', exts: ['zip'] },
    { key: 'access', label: 'Access', exts: ['mdb', 'accdb'] },
  ];
  const FORMAT_NAMES = {
    csv: 'CSV', tsv: 'TSV', txt: 'TXT (CSV)', xlsx: 'Excel (XLSX)', xlsm: 'Excel (XLSM)',
    xls: 'Excel 97-2003 (XLS)', ods: 'OpenDocument (ODS)', json: 'JSON', ndjson: 'NDJSON / JSON Lines',
    xml: 'XML', yaml: 'YAML', html: 'HTML', sav: 'SPSS Statistics (.sav)', zsav: 'SPSS Statistics (.zsav)',
    parquet: 'Apache Parquet', sqlite: 'SQLite', sql: 'SQL dump', pgdump: 'PostgreSQL archive (pg_dump)', dbf: 'dBase / FoxPro (DBF)', duckdb: 'DuckDB export (zip)', access: 'Microsoft Access',
  };
  DB.ACCEPT = DB.FORMATS.flatMap((f) => f.exts.map((e) => '.' + e)).concat(['.gz']).join(','); // .gz: a compressed file of any of these

  const extOf = (name) => { const m = /\.([^.]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
  const baseOf = (name) => (name || 'data').replace(/\.[^.]+$/, '') || 'data';

  function sniff(u8) {
    const s = (a, b) => String.fromCharCode.apply(null, u8.subarray(a, b));
    if (u8.length >= 16 && s(0, 15) === 'SQLite format 3') return 'sqlite';
    if (u8.length >= 4 && s(0, 4) === 'PAR1') return 'parquet';
    if (u8.length >= 4 && (s(0, 4) === '$FL2' || s(0, 4) === '$FL3')) return 'sav';
    if (u8.length >= 8 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) return 'xls';
    if (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04) return 'zip';
    if (DB.isPgArchive && DB.isPgArchive(u8)) return 'pgdump';
    if (u8.length >= 3 && u8[0] === 0x1f && u8[1] === 0x8b && u8[2] === 8) return 'gzip';
    if (DB.isAccess && DB.isAccess(u8)) return 'access';
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
      // sheetStubs: keep formula cells that have no stored result (otherwise they vanish); cellStyles: hidden rows and columns.
      wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellNF: true, cellDates: false, cellStyles: true, sheetStubs: true });
    } catch (e) {
      if (/password|encrypt/i.test(String(e && e.message))) throw new UserError('errEncrypted', {}, String(e.message));
      throw e;
    }
    const date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
    let isoDates = false;
    const cellText = (cell) => {
      if (!cell || cell.t === 'z') return ''; // 'z': a stub (blank or formula without a stored result)
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
      const formulas = [];
      if (ws) {
        for (const addr of Object.keys(ws)) {
          if (addr[0] === '!') continue;
          const cell = ws[addr];
          const rc = XLSX.utils.decode_cell(addr);
          (grid[rc.r] = grid[rc.r] || [])[rc.c] = cellText(cell);
          if (cell && cell.f) formulas.push({ rc, addr, f: String(cell.f), noResult: cell.t === 'z' });
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
      // What the cell values alone do not say: formulas, merged ranges, hidden rows and columns.
      formulas.sort((a, b) => a.rc.r - b.rc.r || a.rc.c - b.rc.c);
      const merges = ws && ws['!merges'] ? ws['!merges'].map((m) => XLSX.utils.encode_range(m)) : [];
      const hiddenRows = [];
      ((ws && ws['!rows']) || []).forEach((r, i) => { if (r && r.hidden) hiddenRows.push(i + 1); });
      const hiddenCols = [];
      ((ws && ws['!cols']) || []).forEach((c, i) => { if (c && c.hidden) hiddenCols.push(DB.colLetter(i)); });
      if (formulas.length || merges.length || hiddenRows.length || hiddenCols.length) {
        sec.sheetInfo = {
          merges, hiddenRows, hiddenCols,
          formulas: { count: formulas.length, noResult: formulas.filter((x) => x.noResult).length, examples: formulas.slice(0, 5).map((x) => ({ addr: x.addr, f: x.f })) },
        };
      }
      return sec;
    });
    // Defined names (named ranges and constants), without Excel's own technical names
    const names = ((wb.Workbook && wb.Workbook.Names) || []).filter((n) => n && n.Name && n.Ref && !/^_xlnm\./.test(n.Name));
    const fileMeta = names.length ? [['mNames', names.slice(0, 50).map((n) => '`' + n.Name + '` → `' + n.Ref + '`').join('; ') + (names.length > 50 ? '; …' : '')]] : [];
    return { sections, fileMeta, notes: { isoDates } };
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
    return treeToDoc(docs.length === 1 ? docs[0] : docs, baseOf(name), docs.length > 1 ? { yamlDocs: true } : undefined);
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
      // Where the name comes from: a caption, label or summary is free text written by people (see "Do not share data")
      const nameFrom = caption ? 'caption' : t.getAttribute('aria-label') ? 'label' : t.id ? 'id' : t.getAttribute('summary') ? 'summary' : 'auto';
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
      sec.nameFrom = nameFrom;
      return sec;
    });
    // Tables that contain other tables (page layout) are not read: say how many, so nothing disappears silently.
    const nestedSkipped = doc.querySelectorAll('table').length - tables.length;
    return { sections, fileMeta: [], notes: { spans, nestedSkipped } };
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
          // SQLite lists foreign keys in reverse order of definition: sort them by the position of their first column
          }).sort((a, b) => info.findIndex((c) => c.name === a.from[0]) - info.findIndex((c) => c.name === b.from[0]));

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

  /* ---------- SQL dumps (sqldump.js) and PostgreSQL archives (pgarchive.js) ---------- */
  DB.SQL_MAX_ROWS = 250000; // rows kept per table: a dump can hold millions; the row counts stay exact
  // Statements worth telling the user about (their text is never read); the others (SET, GRANT ...) are noise.
  const SQL_NOT_READ = ['function', 'procedure', 'trigger', 'event', 'package', 'insert select', 'table without columns', 'copy to'];

  /* The kind of a column from its SQL type: used when no row was read (a dump of the structure only). */
  function typeFromSql(sqlType) {
    let t = String(sqlType || '').toLowerCase().trim();
    for (let i = 0; i < 4; i++) { const m = /^(nullable|lowcardinality)\((.*)\)$/.exec(t); if (!m) break; t = m[2]; }
    t = t.replace(/^"?[\w$]+"?\./, '');
    if (/^(bool|boolean)\b|^tinyint\(1\)|^bit\(1\)|^bit$/.test(t)) return 'boolean';
    if (/^(u?int\d*|tinyint|smallint|mediumint|bigint|integer|serial|bigserial|smallserial|number\(\d+\))\b/.test(t) && !/^number\(\d+\s*,/.test(t)) return 'integer';
    if (/^(numeric|decimal\d*|dec|number|float\d*|double|real|money|smallmoney|currency|binary_float|binary_double)\b/.test(t)) return 'decimal';
    if (/^(timestamp|datetime|smalldatetime|datetimeoffset)/.test(t)) return 'datetime';
    if (/^date(32)?\b/.test(t)) return 'date';
    if (/^time\b|^timetz|^time\(/.test(t)) return 'time';
    return 'text';
  }
  function sqlDocument(r, lead) {
    const info = r.info;
    const meta = [['mDialect', r.dialectName]].concat(lead || []);
    for (const [k, v] of r.fileMeta || []) meta.push([k, v]);
    const a = info.archive;
    if (a && a.skipped && a.skipped.length) meta.push(['mSkipped', a.skipped.map((x) => '`' + x + '`').join(', ')]);
    if (info.externalFiles.length) meta.push(['mExternal', info.externalFiles.map((x) => '`' + x + '`').join(', ')]);
    const notRead = SQL_NOT_READ.filter((k) => info.ignored[k]).map((k) => k + ' ×' + info.ignored[k]);
    const bad = Object.values(info.errors).reduce((x, y) => x + y, 0);
    if (bad) notRead.push('unreadable statements ×' + bad);
    if (notRead.length) meta.push(['mIgnored', notRead.join(', ')]);
    if (info.truncated) meta.push(['mRowsCut', String(DB.SQL_MAX_ROWS)]);
    return { sections: r.sections, views: r.views, fileMeta: meta, notes: {} };
  }
  function parseSqlFile(buf, ext) {
    const { text, encoding } = DB.decodeText(buf);
    if (text.slice(0, 4096).includes('\u0000')) throw new UserError('errCorrupt', { ext: ext ? '.' + ext : '?' });
    const chunks = [];
    for (let i = 0; i < text.length; i += 1 << 20) chunks.push(text.slice(i, i + (1 << 20)));
    return sqlDocument(DB.parseSqlDump(chunks, { maxRows: DB.SQL_MAX_ROWS }), [['mEncoding', encoding]]);
  }
  function parsePgFile(buf) {
    let r;
    try {
      r = DB.parsePgArchive(new Uint8Array(buf), { maxRows: DB.SQL_MAX_ROWS });
    } catch (e) {
      if (e && e.code === 'pgArchiveVersion') throw new UserError('errPgVersion');
      if (e && e.code === 'pgArchiveCompression') throw new UserError('errPgCompression');
      throw new UserError('errPgCorrupt', {}, e && e.code ? e.message : '');
    }
    const a = r.info.archive;
    const num = (s) => (/^[\d.]+/.exec(s) || [''])[0];
    const text = a.format + ' archive ' + a.version + ' · ' + a.compression + (num(a.dumpVersion) ? ' · pg_dump ' + num(a.dumpVersion) : '') +
      (num(a.serverVersion) ? ' · PostgreSQL ' + num(a.serverVersion) : '');
    return sqlDocument(r, [['mArchive', text]]);
  }

  /* ---------- a zipped DuckDB "EXPORT DATABASE" folder: schema.sql + load.sql + one CSV or Parquet file per table ---------- */
  function zipNames(u8) {
    const names = [];
    try { window.fflate.unzipSync(u8, { filter: (f) => { names.push(f.name); return false; } }); } catch (e) { /* not readable as a zip: the spreadsheet reader says so */ }
    return names;
  }
  function isDuckdbZip(u8) {
    const names = zipNames(u8);
    return names.some((n) => /(^|\/)schema\.sql$/.test(n)) && names.some((n) => /(^|\/)load\.sql$/.test(n));
  }
  async function parseDuckdbZip(u8) {
    let files;
    try { files = window.fflate.unzipSync(u8, { filter: (f) => !/\/$/.test(f.name) && f.originalSize < 1024 * 1024 * 1024 }); } catch (e) { throw new UserError('errCorrupt', { ext: '.zip' }); }
    const names = Object.keys(files);
    const schema = names.find((n) => /(^|\/)schema\.sql$/.test(n)), load = names.find((n) => /(^|\/)load\.sql$/.test(n));
    const r = DB.parseSqlDump([DB.decodeText(files[schema]).text, '\n', DB.decodeText(files[load]).text], { maxRows: DB.SQL_MAX_ROWS, dialect: 'generic' });
    const byBase = {};
    for (const n of names) byBase[n.split('/').pop()] = n;
    const missing = [];
    let cut = false;
    const read = new Set();
    for (const s of r.sections) {
      if (!s.externalData) continue;
      const entry = byBase[s.externalData];
      if (!entry) { missing.push(s.name); continue; }
      const info = s.externalInfo || {};
      let rows;
      try {
        if (info.format === 'parquet') {
          const pq = (await parseParquet(files[entry].slice().buffer, 'parquet', s.name)).sections[0];
          const at = s.columns.map((c, i) => { const j = pq.columns.findIndex((x) => x.name.toLowerCase() === c.name.toLowerCase()); return j >= 0 ? j : i; });
          rows = pq.rows.map((row) => at.map((j) => (row[j] === undefined ? '' : row[j])));
        } else {
          const text = DB.decodeText(files[entry]).text;
          rows = DB.parseDelimited(text, info.delimiter || ',', DB.SQL_MAX_ROWS + 2);
          if (info.header !== false) rows.shift();
          const width = s.columns.length;
          rows = rows.map((row) => (row.length === width ? row : row.concat(new Array(Math.max(0, width - row.length)).fill('')).slice(0, width)));
        }
      } catch (e) { missing.push(s.name); continue; }
      if (rows.length > DB.SQL_MAX_ROWS) { rows = rows.slice(0, DB.SQL_MAX_ROWS); cut = true; }
      s.rows = rows;
      s.rowsTotal = rows.length;
      read.add(s.externalData);
    }
    r.info.externalFiles = r.info.externalFiles.filter((f) => !read.has(f) && !missing.some((m) => (r.sections.find((s) => s.name === m) || {}).externalData === f));
    if (cut) r.info.truncated = true;
    const doc = sqlDocument(r, [['mArchive', 'zip archive · ' + names.length + ' files']]);
    doc.fileMeta[0][1] = 'DuckDB (EXPORT DATABASE)';
    if (missing.length) doc.fileMeta.push(['mSkipped', missing.map((x) => '`' + x + '`').join(', ')]);
    return doc;
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
  /* ---- Parquet schema: types of every field, including nested ones ---- */
  const pqLogical = (n) => { const e = n.element || {}; return (e.logical_type && e.logical_type.type) || ''; };
  const pqIsList = (n) => pqLogical(n) === 'LIST' || (n.element || {}).converted_type === 'LIST';
  const pqIsMap = (n) => pqLogical(n) === 'MAP' || /^MAP/.test((n.element || {}).converted_type || '');
  function pqPrim(el) {
    let t = el.type || '';
    const lt = el.logical_type || {};
    if (lt.type === 'INTEGER') t += ' / ' + (lt.isSigned === false ? 'UINT' : 'INT') + '(' + lt.bitWidth + ')';
    else if (lt.type && lt.type !== t) t += ' / ' + lt.type;
    else if (!lt.type && el.converted_type && el.converted_type !== t) t += ' / ' + el.converted_type;
    if (lt.type === 'DECIMAL') t += ' (' + lt.precision + ',' + (lt.scale || 0) + ')';
    else if (el.converted_type === 'DECIMAL' && el.precision != null) t += ' (' + el.precision + ',' + (el.scale || 0) + ')';
    if (lt.unit) t += ' (' + lt.unit + (lt.isAdjustedToUTC ? ', UTC' : '') + ')';
    return t;
  }
  /* inList: the node is the repeated part of a LIST or MAP, not a list of its own.
   * anon: leave the field names of structs out (used by "Do not share data" when names are not shared). */
  function pqType(node, inList, anon) {
    const el = node.element || {};
    const ch = node.children || [];
    if (!inList && el.repetition_type === 'REPEATED' && !pqIsList(node) && !pqIsMap(node)) return 'LIST<' + pqType(node, true, anon) + '>'; // older writers
    if (!ch.length) return pqPrim(el);
    if (pqIsList(node)) {
      const rep = ch[0];
      const one = rep.children && rep.children.length === 1 && !/^(array|.+_tuple)$/.test((rep.element || {}).name || '');
      return 'LIST<' + pqType(one ? rep.children[0] : rep, true, anon) + '>';
    }
    if (pqIsMap(node)) {
      const kv = (ch[0] && ch[0].children) || [];
      return 'MAP<' + (kv[0] ? pqType(kv[0], true, anon) : '?') + ', ' + (kv[1] ? pqType(kv[1], true, anon) : '?') + '>';
    }
    return 'STRUCT<' + ch.map((c) => (anon ? '' : c.element.name + ': ') + pqType(c, false, anon)).join(', ') + '>';
  }
  /* One record following the schema: structs become objects with every leaf (null when absent), maps become JSON text. */
  function pqNormalize(value, node) {
    const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const out = {};
    for (const c of node.children || []) {
      const nm = c.element.name;
      const v = src[nm];
      const isStruct = (c.children || []).length && !pqIsList(c) && !pqIsMap(c) && c.element.repetition_type !== 'REPEATED';
      if (isStruct) out[nm] = pqNormalize(v, c);
      else if (pqIsMap(c)) { // an empty map is an empty cell, like an empty list
        const m = v instanceof Map ? Object.fromEntries(v) : v;
        out[nm] = m == null || !Object.keys(m).length ? null : DB.json(m);
      }
      else out[nm] = v === undefined ? null : v;
    }
    return out;
  }
  function pandasSummary(raw) {
    try {
      const p = JSON.parse(raw);
      const cols = (p.columns || []).map((c) => '`' + c.name + '` ' + (c.pandas_type || c.numpy_type || '?'));
      const idx = (p.index_columns || []).map((c) => (typeof c === 'string' ? '`' + c + '`' : 'range index'));
      return (idx.length ? 'index ' + idx.join(', ') + '; ' : '') + 'columns ' + cols.slice(0, 40).join(', ') + (cols.length > 40 ? ', …' : '');
    } catch (e) { return String(raw).replace(/\s+/g, ' ').slice(0, 300); }
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
    const schema = H.parquetSchema(metadata);

    // The columns come from the schema: every leaf of a struct is a column (a null struct adds none) and a map is one column.
    const typeByPath = new Map();
    const anonByPath = new Map(); // the same types without struct field names (see pqType)
    const required = new Set();
    const walk = (node, path, parentsRequired) => {
      const el = node.element || {};
      const p = path.concat(el.name);
      const req = parentsRequired && el.repetition_type === 'REQUIRED';
      if (!(node.children || []).length || pqIsList(node) || pqIsMap(node) || el.repetition_type === 'REPEATED') {
        typeByPath.set(p.join('.'), pqType(node, false));
        anonByPath.set(p.join('.'), pqType(node, false, true));
        if (req) required.add(p.join('.'));
        return;
      }
      for (const c of node.children) walk(c, p, req);
    };
    for (const c of (schema.children || [])) walk(c, [], true);
    const root = { children: schema.children || [] };
    const flat = DB.flattenRecords(rows.map((r) => pqNormalize(r, root)));

    const typeOf = (col, map) => {
      const parts = col.split('.');
      for (let i = parts.length; i > 0; i--) { const t = (map || typeByPath).get(parts.slice(0, i).join('.')); if (t !== undefined) return t; }
      return '';
    };
    const columns = flat.columns.map((c) => ({ name: c, meta: { parquetType: typeOf(c), parquetTypeAnon: typeOf(c, anonByPath), notNull: required.has(c) ? { key: 'yes' } : '' } }));

    const fileMeta = [];
    if (metadata.created_by) fileMeta.push(['mProduct', metadata.created_by]);
    const groups = metadata.row_groups || [];
    if (groups.length) {
      const sizes = groups.slice(0, 8).map((g) => Number(g.num_rows)).join(' + ') + (groups.length > 8 ? ' + …' : '');
      fileMeta.push(['mRowGroups', groups.length + (groups.length > 1 ? ' (' + sizes + ' rows)' : '')]);
      const codecs = Array.from(new Set(groups.flatMap((g) => (g.columns || []).map((c) => c.meta_data && c.meta_data.codec).filter(Boolean))));
      if (codecs.length) fileMeta.push(['mCodec', codecs.join(', ')]);
    }
    const kv = [];
    for (const x of (metadata.key_value_metadata || [])) {
      if (!x || !x.key || x.key === 'ARROW:schema') continue; // the Arrow schema is binary: the schema above already says it
      const val = String(x.value == null ? '' : x.value);
      if (x.key === 'pandas') kv.push('`pandas`: ' + pandasSummary(val));
      else kv.push('`' + x.key + '`: ' + val.replace(/\s+/g, ' ').slice(0, /spark/.test(x.key) ? 600 : 300));
    }
    if (kv.length) fileMeta.push(['mEmbedded', kv.join('; ')]);
    const notes = { isoDates: flat.flags.isoDates };
    if (flat.flags.flattened) notes.flattened = true;
    if (flat.flags.arrays) notes.arrays = true;
    return { sections: [{ name: baseOf(name), columns, rows: flat.rows }], fileMeta, notes };
  }

  /* ---------- files DataBrief recognises but cannot read: a clear message, with what to do instead ---------- */
  function knownKind(u8) {
    const s = (a, b) => String.fromCharCode.apply(null, u8.subarray(a, b));
    const binary = u8.subarray(0, 512).includes(0);   // a text file that merely starts with the same letters is not one of these
    if (u8.length >= 12 && s(8, 12) === 'DUCK' && binary) return 'Duckdb';
    if (u8.length >= 8 && u8[0] === 0x89 && s(1, 4) === 'HDF' && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return 'Hdf5';
    if (u8.length >= 8 && (s(0, 6) === 'ARROW1' || (s(0, 4) === 'FEA1' && binary))) return 'Arrow';
    if (u8.length >= 8 && s(0, 3) === 'ORC' && binary) return 'Orc';
    if (u8.length >= 8 && s(0, 3) === 'Obj' && u8[3] === 1) return 'Avro';
    if (u8.length >= 8 && s(0, 5) === '%PDF-') return 'Pdf';
    if (u8.length >= 64 && s(0, 4) === 'TAPE' && binary) return 'MssqlBak';
    if (u8.length >= 64 && /EXPORT:V\d/.test(s(0, 64)) && binary) return 'OracleDmp';
    return null;
  }

  /* ---------- gzip: read the file inside (dump.sql.gz, data.csv.gz ...) ---------- */
  async function parseGzip(u8, fileName, depth) {
    if (depth) throw new UserError('errCorrupt', { ext: '.gz' });            // a gzip inside a gzip is not followed
    const n = u8.length;
    const size = (u8[n - 4] | (u8[n - 3] << 8) | (u8[n - 2] << 16) | (u8[n - 1] << 24)) >>> 0;   // stored size modulo 4 GB
    if (size > 1024 * 1024 * 1024) throw new UserError('errTooLarge');
    let inner;
    try { inner = window.fflate.gunzipSync(u8); } catch (e) { throw new UserError('errCorrupt', { ext: '.gz' }); }
    const innerName = /\.(gz|gzip)$/i.test(fileName) ? fileName.replace(/\.(gz|gzip)$/i, '') : fileName;
    const doc = await DB.parseFile(inner, innerName, 1);
    doc.fileName = fileName;
    doc.fileSize = n;
    doc.fileMeta = [['mCompressed', 'gzip · ' + DB.fmtBytes(inner.length)]].concat(doc.fileMeta || []);
    return doc;
  }

  /* ---------- dispatch ---------- */
  DB.parseFile = async function (buf, fileName, depth) {
    const u8 = new Uint8Array(buf);
    let ext = extOf(fileName);
    const known = knownKind(u8);
    if (known) throw new UserError('errKind' + known);
    const magic = sniff(u8);
    if (magic === 'gzip') return parseGzip(u8, fileName, depth || 0);
    let kind;
    if (magic === 'zip') kind = isDuckdbZip(u8) ? 'duckdb' : ext === 'ods' ? 'ods' : ext === 'xlsm' ? 'xlsm' : 'xlsx';
    else if (magic) kind = magic;
    else {
      const f = DB.FORMATS.find((x) => x.exts.includes(ext));
      if (!f) throw new UserError('errUnsupported', { ext: ext ? '.' + ext : '?' });
      kind = f.key;
      if (['xlsx', 'xlsm', 'xls', 'ods', 'sqlite', 'parquet', 'sav', 'duckdb', 'access'].includes(kind)) {
        // Binary format expected but the content does not match: try as text.
        const sample = DB.decodeText(u8.subarray(0, 4096)).text.trim();
        if (/^</.test(sample)) kind = /<table/i.test(sample) || /^<!doctype html|^<html/i.test(sample) ? 'html' : 'xml';
        else if (/^[[{]/.test(sample)) kind = 'json';
        else if (kind !== 'xls') throw new UserError('errCorrupt', { ext: '.' + ext });
      }
      // A ".dump" / ".tar" that is not a PostgreSQL archive: often a plain SQL text dump with that name
      if (kind === 'pgdump') {
        const sample = DB.decodeText(u8.subarray(0, 4096)).text;
        if (sample.slice(0, 1024).includes('\u0000') || !/\b(CREATE|INSERT|COPY|ALTER|DROP|SET|BEGIN)\b|^--/im.test(sample)) throw new UserError('errCorrupt', { ext: '.' + ext });
        kind = 'sql';
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
      case 'sql': res = parseSqlFile(buf, ext); break;
      case 'pgdump': res = parsePgFile(buf); break;
      case 'duckdb': res = await parseDuckdbZip(u8); break;
      case 'access': res = DB.parseAccess(u8, { maxRows: DB.SQL_MAX_ROWS }); break;
      case 'dbf': res = DB.parseDbf(u8, { maxRows: DB.SQL_MAX_ROWS }); res.sections[0].name = baseOf(fileName); break;
      case 'parquet': res = await parseParquet(buf, ext, fileName); break;
      case 'sav': res = DB.parseSav(buf); res.sections[0].name = baseOf(fileName); break;
      default: throw new UserError('errUnsupported', { ext: '.' + ext });
    }
    const formatKey = kind === 'sav' && ext === 'zsav' ? 'zsav' : kind;
    const sectionKind = ['xlsx', 'xlsm', 'xls', 'ods'].includes(kind) ? 'sheets'
      : ['html', 'sqlite', 'sql', 'pgdump', 'duckdb', 'access'].includes(kind) ? 'tables' : 'records';
    return finalize(Object.assign(res, {
      fileName, fileSize: u8.length, formatKey, formatName: FORMAT_NAMES[formatKey] || kind.toUpperCase(), sectionKind,
    }));
  };

  function finalize(doc) {
    doc.sections = doc.sections.filter((s) => s && s.columns);
    const fromSql = ['sql', 'pgdump', 'dbf', 'duckdb', 'access'].includes(doc.formatKey);
    for (const s of doc.sections) {
      s.columns.forEach((c, i) => { c.type = DB.detectColumnType(s.rows, i); });
      // A dump of the structure only (or whose data is in other files): no row was read, the SQL type tells the kind
      if (fromSql && !s.rows.length) s.columns.forEach((c) => { c.type = typeFromSql(c.meta && c.meta.sqlType); });
      // The rows read can be fewer than the rows of the table (a large dump): the true count is kept
      s.totalRows = typeof s.rowsTotal === 'number' && s.rowsTotal > s.rows.length ? s.rowsTotal : s.rows.length;
      // A guessed header over columns that are all text may well be the first record (a file without header row)
      s.headerWeak = !!s.headerGuessed && s.columns.length > 0 && s.columns.every((c) => c.type === 'text' || c.type === 'empty');
    }
    doc.notes = doc.notes || {};
    if (!doc.sections.some((s) => s.rows.length || s.columns.length)) throw new UserError('errEmpty');
    if (DB.addRelationships) DB.addRelationships(doc); // declared relationships, then inferred candidates (relationships.js)
    return doc;
  }
})();
