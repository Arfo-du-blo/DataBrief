/* DataBrief - Jupyter notebooks (.ipynb). GPL-3.0-or-later.
 *
 * A notebook is read, never run: only what it stores is used.
 *   - The tables in the stored outputs (pandas / Polars / R data frames shown as HTML, or the JSON "data resource"
 *     pandas can add) become sections, like the tables of an HTML page. A table the notebook shortened itself
 *     (pandas keeps the first and last rows) keeps its true size from the footer ("300 rows × 2 columns").
 *   - The rest (Markdown, code, printed text, errors, images) is described in doc.contents, given to the AI for context.
 * DB.isNotebook(tree), DB.notebookDoc(tree, baseName) -> { sections, fileMeta, notes, contents, ipynb: true },
 * DB.htmlTables(html) -> [{ rows: [[{ v, th, rs, cs }]], head, caption }] (a small reader of HTML tables, without a DOM,
 * linear in the size of the text). */
'use strict';
(function () {
  const DB = window.DB;
  const MAX_TABLES = 200;        // tables read per notebook (the others are listed, not read)
  const MAX_CELLS = 400;         // cells described in the contents
  const SRC_LINES = 60, SRC_CHARS = 4000, OUT_LINES = 30, OUT_CHARS = 2000;
  const CONTENT_BUDGET = 200000; // characters of code and text in the contents, in all
  const MAX_TAG = 2000;          // a "<" without ">" within this many characters is text

  DB.isNotebook = (tree) => !!tree && typeof tree === 'object' && !Array.isArray(tree) && typeof tree.nbformat === 'number' &&
    (Array.isArray(tree.cells) || (Array.isArray(tree.worksheets) && tree.worksheets.some((w) => w && Array.isArray(w.cells))));

  /* ---------- HTML tables, without a DOM ---------- */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', times: '×', hellip: '…' };
  const decodeEnt = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
    }
    const v = ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  }));
  const attr = (attrs, name) => {
    const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(attrs);
    return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
  };
  const span = (attrs, name) => { const n = parseInt(attr(attrs, name) || '1', 10); return n >= 1 ? Math.min(n, 1000) : 1; };
  const cleanCell = (s) => s.split('\n').map((l) => l.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');

  DB.htmlTables = function (html, maxRows) {
    const out = [];
    const stack = [];                       // open tables (a table inside a table is read on its own; its parent is not)
    let cur = null, cell = null, row = null, caption = null;
    const n = html.length;
    const closeCell = () => { if (cell) { cell.v = cleanCell(decodeEnt(cell.raw)); delete cell.raw; cell = null; } };
    const closeRow = () => { closeCell(); row = null; };
    const text = (s) => { if (cell) cell.raw += s; else if (caption !== null) caption += s; };
    let i = 0;
    while (i < n) {
      const lt = html.indexOf('<', i);
      if (lt < 0) { text(html.slice(i)); break; }
      if (lt > i) text(html.slice(i, lt));
      if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      // the end of the tag, outside quotes, within MAX_TAG characters
      let j = lt + 1, q = '';
      const lim = Math.min(n, lt + MAX_TAG);
      for (; j < lim; j++) { const ch = html[j]; if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
      const m = j < lim && /^<(\/?)([a-zA-Z][\w:-]*)/.exec(html.slice(lt, Math.min(j, lt + 64)));
      if (!m) { text('<'); i = lt + 1; continue; }
      i = j + 1;
      const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = html.slice(lt + m[0].length, j);
      if (!close && (tag === 'style' || tag === 'script' || tag === 'template')) {   // raw text: skipped
        const e = html.toLowerCase().indexOf('</' + tag, i); i = e < 0 ? n : e; continue;
      }
      if (tag === 'table') {
        if (!close) {
          closeCell();
          if (cur) cur.nested = true;
          stack.push(cur = { rows: [], head: 0, part: '', caption: '', nested: false, cut: 0 });
          row = null; caption = null;
        } else if (cur) {
          closeRow();
          const t = stack.pop();
          if (!t.nested) out.push({ rows: t.rows, head: t.head, caption: cleanCell(decodeEnt(t.caption)), cut: t.cut });
          cur = stack[stack.length - 1] || null; row = null;
          if (cur) cur.nested = true;
        }
        continue;
      }
      if (!cur) continue;
      if (tag === 'caption') { if (!close) { closeCell(); caption = ''; } else if (caption !== null) { cur.caption += caption; caption = null; } continue; }
      if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') { closeRow(); cur.part = close ? '' : tag; continue; }
      if (tag === 'tr') {
        closeRow();
        if (!close) {
          if (cur.part === 'thead' && cur.head === cur.rows.length) cur.head++;
          if (maxRows && cur.rows.length >= maxRows + 10) { cur.cut++; continue; }
          row = []; cur.rows.push(row);
        }
        continue;
      }
      if (tag === 'td' || tag === 'th') {
        closeCell();
        if (close) continue;
        if (!row) {
          if (cur.cut) continue;
          row = []; cur.rows.push(row);
          if (cur.part === 'thead' && cur.head === cur.rows.length - 1) cur.head++;
        }
        cell = { v: '', raw: '', th: tag === 'th', rs: span(attrs, 'rowspan'), cs: span(attrs, 'colspan') };
        row.push(cell);
        continue;
      }
      if (tag === 'br' && cell) { cell.raw += '\n'; continue; }
      if (!close && (tag === 'p' || tag === 'div' || tag === 'li') && cell && cell.raw) cell.raw += '\n';
    }
    // unclosed tables (cut HTML): what was read is kept
    while (stack.length) { closeRow(); const t = stack.pop(); if (!t.nested) out.unshift({ rows: t.rows, head: t.head, caption: cleanCell(decodeEnt(t.caption)), cut: t.cut }); }
    return out;
  };

  /* A table of cells (with spans) into a grid of { v, th } */
  function toGrid(rows) {
    const grid = [];
    rows.forEach((tr, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      for (const cell of tr) {
        while (grid[r][c] !== undefined) c++;
        for (let a = 0; a < cell.rs && r + a < rows.length; a++) {
          grid[r + a] = grid[r + a] || [];
          for (let b = 0; b < cell.cs; b++) grid[r + a][c + b] = { v: cell.v, th: cell.th };
        }
        c += cell.cs;
      }
    });
    for (let r = 0; r < rows.length; r++) { grid[r] = grid[r] || []; for (let c = 0; c < grid[r].length; c++) if (!grid[r][c]) grid[r][c] = { v: '', th: false }; }
    return grid;
  }

  const DOTS = /^(\.\.\.|…)$/;
  const MISSING = new Set(['NaN', 'NaT', '<NA>', 'None']);   // how pandas shows a missing value
  const isTypeRow = (cells) => cells.some((c) => c.v) && cells.every((c) => !c.v || /^<[\w.:, ]+>$/.test(c.v));   // R: <dbl>, <chr>

  /* One HTML table (as read by DB.htmlTables) -> { columns, rows, rowsTotal, shortened, dropped } or null */
  function frameFromTable(t, outputHtml, single, maxRows) {
    const grid = toGrid(t.rows);
    if (!grid.length) return null;
    let head = t.head;
    if (!head) while (head < grid.length && head < 3 && grid[head].length && grid[head].every((c) => c.th)) head++;
    let headRows = grid.slice(0, head), body = grid.slice(head);
    // Polars writes the column types as a row of <td> in the head; R writes them as <dbl>, <chr> under the names
    let types = null, polars = false;
    const typesOf = (r) => r.map((c) => c.v.replace(/^<(.*)>$/, '$1'));
    headRows = headRows.filter((r, idx) => {
      if (idx === 0) return true;
      if (r.every((c) => !c.th)) { types = typesOf(r); polars = true; return false; }
      if (isTypeRow(r.slice(1)) || isTypeRow(r)) { types = typesOf(r); return false; }
      return true;
    });
    if (body.length && isTypeRow(body[0])) { types = typesOf(body[0]); body = body.slice(1); }
    if (!headRows.length && !body.length) return null;
    // index columns: the <th> cells that start every row of the body
    let k = body.length ? Infinity : 0;
    for (const r of body) { let x = 0; while (x < r.length && r[x].th) x++; k = Math.min(k, x); if (!k) break; }
    if (!isFinite(k)) k = 0;
    const width = Math.max(0, ...headRows.map((r) => r.length), ...body.map((r) => r.length));
    if (k >= width) k = 0;
    // pandas: a last head row with the index names only (the other cells empty)
    let indexNames = new Array(k).fill('');
    if (k && headRows.length > 1) {
      const last = headRows[headRows.length - 1];
      if (last.slice(k).every((c) => !c.v) && last.slice(0, k).some((c) => c.v)) { indexNames = last.slice(0, k).map((c) => c.v); headRows = headRows.slice(0, -1); }
    }
    const names = [];
    for (let c = 0; c < width; c++) {
      const parts = [];
      for (const r of headRows) { const v = (r[c] && r[c].v) || ''; if (v && parts[parts.length - 1] !== v) parts.push(v); }
      names.push(c < k ? indexNames[c] || parts.join(' / ') : parts.join(' / '));
    }
    let rows = body.map((r) => { const o = new Array(width); for (let c = 0; c < width; c++) o[c] = r[c] ? r[c].v : ''; return o; });
    // shortened by the notebook: a row of "..." between the first and the last rows, a column of "..." in the middle
    let shortened = false;
    const before = rows.length;
    rows = rows.filter((r) => !r.slice(k).every((v) => DOTS.test(v)) || r.slice(k).every((v) => !v));
    if (rows.length < before) shortened = true;
    let keep = names.map((nm, c) => !(DOTS.test(nm) && rows.every((r) => !r[c] || DOTS.test(r[c]))));
    if (keep.some((x) => !x)) shortened = true;
    // an index of row numbers (0, 1, 2...) without a name says nothing: dropped
    let dropIndex = false;
    if (k === 1 && !names[0]) {
      let prev = -1; dropIndex = rows.length > 0;
      for (const r of rows) { if (!/^\d+$/.test(r[0]) || +r[0] <= prev) { dropIndex = false; break; } prev = +r[0]; }
    }
    if (dropIndex) keep[0] = false;
    for (let c = 0; c < k; c++) if (keep[c] && !names[c]) names[c] = k > 1 ? 'index_' + (c + 1) : 'index';
    const cols = [];
    keep.forEach((x, c) => { if (x) cols.push(c); });
    // Polars writes text in quotes ("North") and a missing value as null
    const quoted = cols.map((c) => polars && types && types[c] === 'str');
    rows = rows.map((r) => cols.map((c, x) => {
      let v = r[c];
      if (MISSING.has(v) || (polars && v === 'null')) return '';
      if (quoted[x] && v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
      return v;
    }));
    const dtypes = cols.map((c) => (types && types[c] && /^[\w .:,()[\]<>-]{1,40}$/.test(types[c]) ? types[c] : ''));
    if (maxRows && rows.length > maxRows) rows = rows.slice(0, maxRows);
    // the true size, from what the library writes next to the table (only when the output holds this one table)
    let rowsTotal = null;
    const num = (s) => parseInt(s.replace(/[,_\s]/g, ''), 10);
    const foot = single && (/(\d[\d,]*) rows × (\d[\d,]*) columns/.exec(outputHtml) || /shape:\s*\((\d[\d_]*),\s*(\d[\d_]*)\)/.exec(outputHtml));
    const capm = /(?:data\.frame|tibble|data\.table|DataFrame)[^:]*:\s*(\d[\d,]*)\s*[×x]\s*(\d[\d,]*)/i.exec(t.caption || '');
    if (foot) rowsTotal = num(foot[1]); else if (capm) rowsTotal = num(capm[1]);
    if (rowsTotal !== null && rowsTotal > rows.length) shortened = true;
    else rowsTotal = null;
    if (t.cut) { shortened = true; rowsTotal = Math.max(rowsTotal || 0, rows.length + t.cut); }
    const captionIsName = !!t.caption && !capm;
    // columns: the library counts the data columns (not the index); a wide frame keeps only the first and last ones
    const dataCols = cols.filter((c) => c >= k).length;
    const colsTotal = foot ? num(foot[2]) : capm ? num(capm[2]) : null;
    const colsCut = colsTotal !== null && colsTotal > dataCols ? { a: dataCols, b: colsTotal } : null;
    if (colsCut) shortened = true;
    return { names: cols.map((c) => names[c]), dtypes, rows, rowsTotal, shortened, colsCut, caption: captionIsName ? t.caption : '' };
  }

  /* pandas "application/vnd.dataresource+json" (Table Schema) */
  function frameFromResource(res, maxRows) {
    if (!res || typeof res !== 'object' || !res.schema || !Array.isArray(res.schema.fields) || !Array.isArray(res.data)) return null;
    const fields = res.schema.fields.filter((f) => f && typeof f.name !== 'undefined').map((f) => String(f.name));
    if (!fields.length) return null;
    const pk = Array.isArray(res.schema.primaryKey) ? res.schema.primaryKey.map(String) : [];
    const str = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    let rows = res.data.slice(0, maxRows || res.data.length).map((d) => fields.map((f) => (d && typeof d === 'object' ? str(d[f]) : '')));
    // the default index of pandas (0, 1, 2... named "index"): dropped
    const ix = fields.indexOf('index');
    let names = fields.slice();
    if (ix >= 0 && pk.length === 1 && pk[0] === 'index' && rows.every((r, n) => r[ix] === String(n))) {
      names.splice(ix, 1); rows = rows.map((r) => r.filter((_, c) => c !== ix));
    }
    return { names, rows, rowsTotal: res.data.length > rows.length ? res.data.length : null, shortened: res.data.length > rows.length, caption: '' };
  }

  /* ---------- the notebook ---------- */
  const joinSrc = (x) => (Array.isArray(x) ? x.map((s) => (typeof s === 'string' ? s : '')).join('') : typeof x === 'string' ? x : '');
  const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
  /* At most maxLines lines and maxChars characters; "more": the lines not shown (in whole or in part) */
  function cut(text, maxLines, maxChars) {
    const s = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!s) return { text: '', more: 0 };
    const lines = s.split('\n');
    let kept = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : s;
    if (kept.length > maxChars) kept = kept.slice(0, Math.max(0, maxChars));
    if (kept.length === s.length) return { text: s, more: 0 };
    const partial = !!kept && s[kept.length] !== '\n';
    const keptLines = kept ? kept.split('\n').length : 0;
    return { text: kept + (partial ? '…' : ''), more: Math.max(1, lines.length - keptLines + (partial ? 1 : 0)) };
  }
  const SIMPLE = /^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)*(\(\s*\d{0,9}\s*\))?$/;    // customers, orders.head(2), df.describe()
  function lastExpression(src) {
    const lines = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const last = lines[lines.length - 1] || '';
    return SIMPLE.test(last) && !/^(import|from|return|pass|print)\b/.test(last) ? last : '';
  }
  const displayed = (src) => {
    const out = [];
    const re = /(?:^|[^\w.])display\(\s*([A-Za-z_][\w.]*(?:\(\s*\d{0,9}\s*\))?)\s*\)/g;
    let m;
    while ((m = re.exec(src))) if (SIMPLE.test(m[1])) out.push(m[1]);
    return out;
  };
  const MIME = /^[\w.+-]{1,40}\/[\w.+-]{1,60}$/;
  const mimeOf = (m) => (MIME.test(m) ? m : 'unknown');

  DB.notebookDoc = function (tree, baseName) {
    if (!DB.isNotebook(tree)) return null;
    const maxRows = DB.SQL_MAX_ROWS || 250000;
    const v3 = !Array.isArray(tree.cells);
    const rawCells = v3 ? [].concat(...tree.worksheets.filter((w) => w && Array.isArray(w.cells)).map((w) => w.cells)) : tree.cells;
    const meta = tree.metadata && typeof tree.metadata === 'object' ? tree.metadata : {};
    const li = meta.language_info && typeof meta.language_info === 'object' ? meta.language_info : {};
    const ks = meta.kernelspec && typeof meta.kernelspec === 'object' ? meta.kernelspec : {};
    const okWord = (s, re) => (typeof s === 'string' && re.test(s) ? s : '');
    const language = (okWord(li.name, /^[\w.+#-]{1,30}$/) || okWord(ks.language, /^[\w.+#-]{1,30}$/) || okWord(meta.language, /^[\w.+#-]{1,30}$/)).toLowerCase();
    const version = okWord(li.version, /^[\w.+-]{1,30}$/);
    const sections = [], used = new Set();
    const notes = {};
    let budget = CONTENT_BUDGET, tablesSkipped = 0;
    const counts = { cells: 0, code: 0, markdown: 0, raw: 0, run: 0, errors: 0, tables: 0 };
    const cells = [];
    let cellsCut = 0;
    const take = (text, ml, mc) => {
      if (budget <= 0) return { text: '', more: text ? text.replace(/\n+$/, '').split('\n').length : 0 };
      const c = cut(text, ml, Math.min(mc, budget));
      budget -= c.text.length;
      return c;
    };
    const uniqueName = (n) => { let x = n, k = 2; while (used.has(x)) x = n + ' (' + k++ + ')'; used.add(x); return x; };

    rawCells.forEach((cellIn, ci) => {
      if (!cellIn || typeof cellIn !== 'object') return;
      const type = cellIn.cell_type === 'code' ? 'code' : cellIn.cell_type === 'markdown' || cellIn.cell_type === 'heading' ? 'markdown' : 'raw';
      counts.cells++; counts[type]++;
      const n = ci + 1;
      const srcFull = joinSrc(v3 && type === 'code' ? cellIn.input : cellIn.source).replace(ANSI, '');
      const listed = cells.length < MAX_CELLS;
      if (!listed) cellsCut++;
      const cell = { n, type, exec: null, source: '', more: 0, outputs: [] };
      const src = cellIn.cell_type === 'heading' ? '#'.repeat(Math.min(6, Math.max(1, +cellIn.level || 1))) + ' ' + srcFull : srcFull;   // nbformat 3
      if (listed) { const c = take(src, SRC_LINES, SRC_CHARS); cell.source = c.text; cell.more = c.more; }
      if (type === 'code') {
        const ec = v3 ? cellIn.prompt_number : cellIn.execution_count;
        if (typeof ec === 'number' && isFinite(ec)) cell.exec = ec;
        const outs = Array.isArray(cellIn.outputs) ? cellIn.outputs : [];
        if (outs.length || cell.exec !== null) counts.run++;
        const expr = lastExpression(srcFull), shown = displayed(srcFull);
        let tablesInCell = 0;
        for (const o of outs) {
          if (!o || typeof o !== 'object') continue;
          const ot = o.output_type;
          if (ot === 'stream') {
            const c = listed ? take(joinSrc(o.text).replace(ANSI, ''), OUT_LINES, OUT_CHARS) : { text: '', more: 0 };
            cell.outputs.push({ kind: 'stream', stderr: o.name === 'stderr', text: c.text, more: c.more });
            continue;
          }
          if (ot === 'error' || ot === 'pyerr') {
            counts.errors++;
            const ename = typeof o.ename === 'string' ? o.ename.replace(ANSI, '').slice(0, 120) : '';
            const evalue = typeof o.evalue === 'string' ? o.evalue.replace(ANSI, '').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
            cell.outputs.push({ kind: 'error', ename, evalue });
            continue;
          }
          // execute_result / display_data (nbformat 4); pyout / display_data (nbformat 3: the mime types are short keys)
          let data = o.data && typeof o.data === 'object' ? o.data : null;
          if (v3) {
            data = {};
            const V3 = { html: 'text/html', text: 'text/plain', png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml', latex: 'text/latex', json: 'application/json', javascript: 'application/javascript' };
            for (const [key, mime] of Object.entries(V3)) if (o[key] !== undefined) data[mime] = o[key];
          }
          if (!data) continue;
          const nameFor = () => {
            const base = ot === 'execute_result' || ot === 'pyout' ? expr : shown[tablesInCell] || '';
            return uniqueName(base || 'cell_' + n + (tablesInCell ? '_' + (tablesInCell + 1) : ''));
          };
          const addFrame = (f) => {
            if (!f || !f.names.length) return false;
            counts.tables++;
            if (sections.length >= MAX_TABLES) { tablesSkipped++; cell.outputs.push({ kind: 'table', sec: -1 }); tablesInCell++; return true; }
            const name = nameFor();
            const sec = DB.gridToSection(f.rows, name, { headerRow: f.names });
            // gridToSection drops empty rows: the stored rows are what the notebook kept
            if (f.rowsTotal) sec.rowsTotal = f.rowsTotal;
            if (f.shortened) notes.nbShortened = true;
            if (f.caption) sec.caption = f.caption;   // a caption set by people (Styler.set_caption): a label
            if (f.dtypes) f.dtypes.forEach((d, x) => { if (d && sec.columns[x]) sec.columns[x].meta.dtype = d; });   // Polars, R
            sec.cell = n;
            sections.push(sec);
            cell.outputs.push({ kind: 'table', sec: sections.length - 1, colsCut: f.colsCut || null });
            tablesInCell++;
            return true;
          };
          let done = false;
          const res = data['application/vnd.dataresource+json'];
          if (res) done = addFrame(frameFromResource(typeof res === 'string' ? (() => { try { return JSON.parse(res); } catch (e) { return null; } })() : res, maxRows));
          const html = joinSrc(data['text/html']);
          if (!done && html && /<table/i.test(html)) {
            const tables = DB.htmlTables(html, maxRows);
            for (const t of tables) if (addFrame(frameFromTable(t, html, tables.length === 1, maxRows))) done = true;
          }
          if (done) continue;
          const img = Object.keys(data).find((m) => /^image\//.test(m));
          const txt = ['text/markdown', 'text/latex', 'text/plain'].find((m) => data[m] !== undefined);
          if (txt) {
            const c = listed ? take(joinSrc(data[txt]).replace(ANSI, ''), OUT_LINES, OUT_CHARS) : { text: '', more: 0 };
            cell.outputs.push({ kind: 'text', mime: txt, text: c.text, more: c.more });
            if (img) cell.outputs.push({ kind: 'image', mime: mimeOf(img) });
          } else if (img) cell.outputs.push({ kind: 'image', mime: mimeOf(img) });
          else { const m = Object.keys(data)[0]; if (m) cell.outputs.push({ kind: 'other', mime: mimeOf(m) }); }
        }
      }
      if (listed) cells.push(cell);
    });
    const fileMeta = [];
    if (language) fileMeta.push(['mKernel', language + (version ? ' ' + version : '')]);
    const nbv = typeof tree.nbformat_minor === 'number' ? tree.nbformat + '.' + tree.nbformat_minor : String(tree.nbformat);
    fileMeta.push(['mNbformat', nbv]);
    if (tablesSkipped) notes.nbTablesCut = MAX_TABLES;
    return {
      sections, fileMeta, notes, ipynb: true,
      contents: { kind: 'notebook', maxTables: MAX_TABLES, language: /^[a-z0-9+#-]{1,20}$/.test(language) ? language : '', counts, cells, cellsCut, budgetHit: budget <= 0 },
    };
  };
})();
