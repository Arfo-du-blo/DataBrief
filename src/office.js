/* DataBrief - Word (.docx), PowerPoint (.pptx) and OpenDocument text and presentations (.odt, .odp). GPL-3.0-or-later.
 *
 * Tables are DATA: each table becomes a section (merged cells repeated in every cell they cover, a header row taken when
 * the file marks one, or guessed like any table). Everything else is CONTEXT, in doc.contents: headings, paragraphs and
 * lists in order (documents), or each slide's title, text and speaker notes (presentations); plus the document properties.
 * DB.officeKind(names, mimetype) -> 'docx' | 'pptx' | 'odt' | 'odp' | ''; DB.parseOffice(u8, kind) -> { sections, fileMeta,
 * notes, contents }. DB.xmlTree(text) is a small XML reader without a DOM (tested in Node): linear, namespaces resolved
 * to the usual prefixes, no DOCTYPE or entity expansion, with limits on nodes, depth and size. */
'use strict';
(function () {
  const DB = window.DB;
  const UserError = DB.UserError;
  const MAX_NODES = 4000000, MAX_DEPTH = 256, MAX_ENTRY = 256 * 1024 * 1024, MAX_TOTAL = 768 * 1024 * 1024;
  const MAX_TABLES = 500, MAX_ITEMS = 5000, ITEM_CHARS = 2000, CONTENT_BUDGET = 200000, MAX_SLIDES = 2000;

  /* ---------- XML without a DOM ---------- */
  const NS = {
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w', 'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
    'http://schemas.openxmlformats.org/drawingml/2006/main': 'a', 'http://purl.oclc.org/ooxml/drawingml/main': 'a',
    'http://schemas.openxmlformats.org/presentationml/2006/main': 'p', 'http://purl.oclc.org/ooxml/presentationml/main': 'p',
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r', 'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
    'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
    'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
    'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties': 'ep', 'http://purl.oclc.org/ooxml/officeDocument/extendedProperties': 'ep',
    'http://purl.org/dc/elements/1.1/': 'dc', 'http://purl.org/dc/terms/': 'dcterms',
    'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
    'urn:oasis:names:tc:opendocument:xmlns:office:1.0': 'office', 'urn:oasis:names:tc:opendocument:xmlns:text:1.0': 'text',
    'urn:oasis:names:tc:opendocument:xmlns:table:1.0': 'table', 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0': 'draw',
    'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0': 'presentation', 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0': 'meta',
    'urn:oasis:names:tc:opendocument:xmlns:style:1.0': 'style',
  };
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unescape = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,5});/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m; }
    return ENT[e] !== undefined ? ENT[e] : m;
  }));
  const corrupt = (ext) => new UserError('errCorrupt', { ext: ext || '.docx' });

  /* -> root element { n, a, c } (n: "w:p", a: attributes with resolved prefixes, c: children elements and strings) */
  DB.xmlTree = function (xml, ext) {
    const n = xml.length;
    let nodes = 0;
    const root = { n: '#root', a: {}, c: [] };
    const stack = [{ el: root, ns: { xml: 'xml' } }];
    let i = 0;
    const resolve = (q, ns, isAttr) => {
      const k = q.indexOf(':');
      if (k < 0) return isAttr ? q : (ns[''] ? ns[''] + ':' + q : q);
      const p = q.slice(0, k);
      return (ns[p] || p) + ':' + q.slice(k + 1);
    };
    while (i < n) {
      const lt = xml.indexOf('<', i);
      const top = stack[stack.length - 1];
      if (lt < 0 || lt > i) {
        const t = xml.slice(i, lt < 0 ? n : lt);
        if (/\S/.test(t) || !/\n/.test(t)) top.el.c.push(unescape(t));   // indentation between elements is dropped
        if (lt < 0) break;
      }
      if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); top.el.c.push(xml.slice(lt + 9, e < 0 ? n : e)); i = e < 0 ? n : e + 3; continue; }
      if (xml[lt + 1] === '?' || xml[lt + 1] === '!') { const e = xml.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }   // declarations, DOCTYPE: skipped, never expanded
      // the end of the tag, outside quotes
      let j = lt + 1, q = '';
      for (; j < n; j++) { const ch = xml[j]; if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
      if (j >= n) break;
      const tag = xml.slice(lt + 1, j);
      i = j + 1;
      if (tag[0] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const selfClose = tag.endsWith('/');
      const body = selfClose ? tag.slice(0, -1) : tag;
      const m = /^([^\s/>]+)/.exec(body);
      if (!m) continue;
      if (++nodes > MAX_NODES) throw new UserError('errTooLarge');
      // attributes and namespace declarations
      const raw = [];
      let ns = top.ns;
      // name="value" pairs, scanned by hand (a regex backtracks quadratically on a long token without "=")
      const L = body.length;
      const space = (ch) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
      let p = m[0].length;
      while (p < L) {
        while (p < L && space(body[p])) p++;
        const s0 = p;
        while (p < L && body[p] !== '=' && !space(body[p])) p++;
        const name = body.slice(s0, p);
        while (p < L && space(body[p])) p++;
        if (body[p] !== '=') { if (p === s0) p++; continue; }
        p++;
        while (p < L && space(body[p])) p++;
        const quote = body[p];
        if (quote !== '"' && quote !== "'") { while (p < L && !space(body[p])) p++; continue; }
        const e = body.indexOf(quote, p + 1);
        if (e < 0) break;
        const val = unescape(body.slice(p + 1, e));
        p = e + 1;
        if (!name || name.includes('/')) continue;
        if (name === 'xmlns' || name.startsWith('xmlns:')) {
          if (ns === top.ns) ns = Object.assign({}, top.ns);
          ns[name === 'xmlns' ? '' : name.slice(6)] = NS[val] || (name === 'xmlns' ? '' : name.slice(6));
        } else raw.push([name, val]);
      }
      const a = {};
      for (const [k, v] of raw) a[resolve(k, ns, true)] = v;
      const el = { n: resolve(m[1], ns, false), a, c: [] };
      top.el.c.push(el);
      if (!selfClose) {
        if (stack.length > MAX_DEPTH) throw corrupt(ext);
        stack.push({ el, ns });
      }
    }
    return root.c.find((x) => typeof x === 'object') || root;
  };
  // helpers on the tree
  const kids = (el, name) => (el && el.c ? el.c.filter((x) => typeof x === 'object' && (!name || x.n === name)) : []);
  const kid = (el, name) => (el && el.c ? el.c.find((x) => typeof x === 'object' && x.n === name) : null) || null;
  function find(el, name, depth) {                                       // the first descendant called name
    if (!el || !el.c || (depth || 0) > MAX_DEPTH) return null;
    for (const x of el.c) if (typeof x === 'object') { if (x.n === name) return x; const f = find(x, name, (depth || 0) + 1); if (f) return f; }
    return null;
  }
  function textOf(el) {                                                  // all the text under el
    let s = '';
    const walk = (e, d) => { if (d > MAX_DEPTH) return; for (const x of e.c) { if (typeof x === 'string') s += x; else walk(x, d + 1); } };
    walk(el, 0);
    return s;
  }
  const clean = (s) => s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  /* ---------- tables: rows of cells { text, cs, rs, cont } -> a section ---------- */
  /* headerRows: header rows the file marks; firm: false when the mark only styles the row (PowerPoint's "firstRow"), so the
   * header is a guess (a guessed header over text columns may be a record: "Do not share data" then uses neutral names).
   * Spans and repeats multiply cells: a table has a budget of cells and columns; rows past it are left out and counted. */
  const TABLE_CELLS = 2000000, TABLE_COLS = 10000;
  function tableSection(rows, name, headerRows, firm) {
    // the grid: spans repeated in every cell they cover; a "continue" cell (Word's vMerge) repeats the cell above
    const grid = [];
    let spans = false, cells = 0, last = rows.length;
    for (let r = 0; r < rows.length && r < last; r++) {
      grid[r] = grid[r] || [];
      let c = 0;
      for (const cell of rows[r]) {
        while (grid[r][c] !== undefined) c++;
        if (c >= TABLE_COLS) break;
        const cs = Math.min(Math.max(cell.cs || 1, 1), 1000, TABLE_COLS - c), rs = Math.min(Math.max(cell.rs || 1, 1), 1000);
        if (cs > 1 || rs > 1 || cell.cont) spans = true;
        const v = cell.cont && r > 0 && grid[r - 1][c] !== undefined ? grid[r - 1][c] : cell.text;
        for (let a = 0; a < rs && r + a < last; a++) { grid[r + a] = grid[r + a] || []; for (let b = 0; b < cs; b++) grid[r + a][c + b] = v; cells += cs; }
        c += cs;
        if (cells > TABLE_CELLS) { last = r + 1; break; }
      }
    }
    grid.length = Math.min(grid.length, last);
    for (let r = 0; r < grid.length; r++) { const g = grid[r] = grid[r] || []; for (let k = 0; k < g.length; k++) if (g[k] === undefined) g[k] = ''; }
    // the header: rows the file marks as header; else a first row that spans columns above a second row that names them
    let h = headerRows || 0, guessed = !!h && !firm;
    if (h <= 1 && grid.length > 2 && rows[0].some((c) => (c.cs || 1) > 1) && !rows[1].some((c) => (c.cs || 1) > 1)) {
      const first = grid[0], second = grid[1];
      let named = true;
      for (let k = 0; k < first.length; k++) if (k > 0 && first[k] === first[k - 1] && first[k] && !second[k]) named = false;
      if (named) { h = 2; guessed = true; }
    }
    let sec;
    if (h > 0 && grid.length > h) {
      let width = 0;
      for (const g of grid) if (g.length > width) width = g.length;
      const header = new Array(width).fill(0).map((_, k) => {
        const parts = [];
        for (let r = 0; r < h; r++) { const v = (grid[r] && grid[r][k]) || ''; if (v && parts[parts.length - 1] !== v) parts.push(v); }
        return parts.join(' / ').replace(/\s*\n\s*/g, ' ');
      });
      sec = DB.gridToSection(grid.slice(h), name, { headerRow: header });
      if (guessed) sec.headerGuessed = true;
    } else sec = DB.gridToSection(grid, name);
    if (rows.length > grid.length) sec.rowsTotal = sec.rows.length + (rows.length - grid.length);
    return { sec, spans };
  }

  /* ---------- reading the zip ---------- */
  function unzip(u8, wanted, ext) {
    let total = 0;
    try {
      return window.fflate.unzipSync(u8, { filter: (f) => {
        const name = f.name.replace(/\\/g, '/');
        if (!wanted(name)) return false;
        if (f.originalSize > MAX_ENTRY || (total += f.originalSize) > MAX_TOTAL) throw new UserError('errTooLarge');
        return true;
      } });
    } catch (e) {
      if (e instanceof UserError) throw e;
      throw corrupt(ext);
    }
  }
  const text = (files, name) => (files[name] ? DB.decodeText(files[name]).text : '');
  const ext = { docx: '.docx', pptx: '.pptx', odt: '.odt', odp: '.odp' };

  DB.officeKind = function (names, mimetype) {
    if (/^application\/vnd\.oasis\.opendocument\.text(-template)?$/.test(mimetype)) return 'odt';
    if (/^application\/vnd\.oasis\.opendocument\.presentation(-template)?$/.test(mimetype)) return 'odp';
    if (names.includes('word/document.xml')) return 'docx';
    if (names.includes('ppt/presentation.xml')) return 'pptx';
    return '';
  };

  /* relationships of a part: id -> target path (resolved against the part's folder) */
  function rels(files, part) {
    const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
    const relPath = dir + '_rels/' + part.slice(dir.length) + '.rels';
    const out = {};
    const t = text(files, relPath);
    if (!t) return out;
    for (const r of kids(DB.xmlTree(t), 'rel:Relationship')) {
      if (r.a.TargetMode === 'External') continue;
      let target = r.a.Target || '';
      if (target.startsWith('/')) target = target.slice(1);
      else {
        const parts = (dir + target).split('/');
        const res = [];
        for (const p of parts) { if (p === '..') res.pop(); else if (p !== '.') res.push(p); }
        target = res.join('/');
      }
      out[r.a.Id] = { target, type: (r.a.Type || '').replace(/^.*\//, '') };
    }
    return out;
  }

  /* ---------- document properties ----------
   * The title, subject, keywords, description, dates and the program. NEVER the author, the last editor or the company: who wrote
   * a file is not something DataBrief ever shows, in any format or mode. */
  const one = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 300);
  function ooxmlProps(files, meta) {
    const core = text(files, 'docProps/core.xml');
    if (core) {
      const t = DB.xmlTree(core);
      const get = (n) => { const e = kid(t, n); return e ? one(textOf(e)) : ''; };
      if (get('dc:title')) meta.push(['mDocTitle', get('dc:title')]);
      if (get('dc:subject')) meta.push(['mDocSubject', get('dc:subject')]);
      if (get('cp:keywords')) meta.push(['mDocKeywords', get('cp:keywords')]);
      if (get('dc:description')) meta.push(['mDocDescription', get('dc:description')]);
      const d = (n) => (/^\d{4}-\d\d-\d\d/.test(get(n)) ? get(n).slice(0, 10) : '');
      if (d('dcterms:created') || d('dcterms:modified')) meta.push(['mDocDates', [d('dcterms:created'), d('dcterms:modified')].filter(Boolean).join(' → ')]);
    }
    const app = text(files, 'docProps/app.xml');
    if (app) { const e = kid(DB.xmlTree(app), 'ep:Application'); const v = e ? one(textOf(e)).replace(/\$.*$/, '').replace(/[^\w .,/()+-]/g, '') : ''; if (v) meta.push(['mDocApp', v]); }
  }
  function odfProps(files, meta) {
    const t = text(files, 'meta.xml');
    if (!t) return;
    const m = find(DB.xmlTree(t), 'office:meta');
    if (!m) return;
    const get = (n) => { const e = kid(m, n); return e ? one(textOf(e)) : ''; };
    if (get('dc:title')) meta.push(['mDocTitle', get('dc:title')]);
    if (get('dc:subject')) meta.push(['mDocSubject', get('dc:subject')]);
    const kw = kids(m, 'meta:keyword').map((e) => one(textOf(e))).filter(Boolean).join(', ');
    if (kw) meta.push(['mDocKeywords', kw]);
    if (get('dc:description')) meta.push(['mDocDescription', get('dc:description')]);
    const d = (n) => (/^\d{4}-\d\d-\d\d/.test(get(n)) ? get(n).slice(0, 10) : '');
    if (d('meta:creation-date') || d('dc:date')) meta.push(['mDocDates', [d('meta:creation-date'), d('dc:date')].filter(Boolean).join(' → ')]);
    const gen = get('meta:generator').replace(/\$.*$/, '').replace(/[^\w .,/()+-]/g, '');
    if (gen) meta.push(['mDocApp', gen]);
  }

  /* ---------- the contents being built: items with a budget of characters ---------- */
  function Contents(kind) {
    let budget = CONTENT_BUDGET;
    const c = { kind, items: [], cut: 0, counts: { headings: 0, paragraphs: 0, tables: 0, slides: 0 } };
    c.take = (s) => {
      s = clean(s);
      if (!s) return null;
      if (s.length > ITEM_CHARS) s = s.slice(0, ITEM_CHARS) + '…';
      if (budget <= 0) return '';
      if (s.length > budget) s = s.slice(0, budget) + '…';
      budget -= s.length;
      return s;
    };
    c.push = (item) => { if (c.items.length < MAX_ITEMS) c.items.push(item); else c.cut++; };
    return c;
  }
  DB.docContents = Contents;   // also used by the HTML reader (parsers.js): a web page is read as a document
  function addTable(state, rows, headerRows, name, firm) {
    if (!rows.length || !rows.some((r) => r.length)) return -1;
    state.contents.counts.tables++;
    if (state.sections.length >= MAX_TABLES) return -2;
    const t = tableSection(rows, name || 'table_' + (state.sections.length + 1), headerRows, firm);
    if (t.spans) state.notes.spans = true;
    if (!t.sec.columns.length) return -1;
    let nm = t.sec.name, k = 2;
    while (state.used.has(nm)) nm = t.sec.name + ' (' + k++ + ')';
    state.used.add(nm); t.sec.name = nm;
    state.sections.push(t.sec);
    return state.sections.length - 1;
  }

  /* ---------- Word ---------- */
  /* The text of a paragraph or a cell: runs and breaks. A table met inside a paragraph (in a text box) holds records, not
   * free text: it is left out of the paragraph (inside a cell, a nested table stays part of that cell's value). */
  function docxText(el, d, inCell) {
    let s = '';
    if (d > MAX_DEPTH) return s;
    for (const x of el.c) {
      if (typeof x === 'string') continue;
      switch (x.n) {
        case 'w:t': s += textOf(x); break;
        case 'w:tab': s += '\t'; break;
        case 'w:br': case 'w:cr': s += '\n'; break;
        case 'w:noBreakHyphen': s += '-'; break;
        case 'w:del': case 'w:delText': case 'w:instrText': case 'w:rPr': case 'w:pPr': case 'w:tcPr': case 'mc:Fallback': case 'w:footnoteReference': case 'w:commentReference': break;
        case 'w:p': s += (s && !s.endsWith('\n') ? '\n' : '') + docxText(x, d + 1, inCell); break;
        case 'w:tbl':
          if (inCell) s += (s ? '\n' : '') + kids(x, 'w:tr').map((tr) => kids(tr, 'w:tc').map((tc) => clean(docxText(tc, d + 1, true))).join(' | ')).join('\n');
          break;
        default: s += docxText(x, d + 1, inCell);
      }
    }
    return s;
  }
  /* the rows of a Word table, also those inside content controls (a repeating section) */
  function docxRows(tbl) {
    const out = [];
    const collect = (p, d) => { for (const x of kids(p)) { if (x.n === 'w:tr') out.push(x); else if (d < 8 && ['w:sdt', 'w:sdtContent', 'w:customXml'].includes(x.n)) collect(x, d + 1); } };
    collect(tbl, 0);
    return out;
  }
  function parseDocx(files, state) {
    const doc = DB.xmlTree(text(files, 'word/document.xml'), '.docx');
    const body = find(doc, 'w:body');
    if (!body) throw corrupt('.docx');
    // heading levels from the styles (ids are translated in localised Word: "Titre1"), or the outline level
    const levels = new Map();
    const st = text(files, 'word/styles.xml');
    if (st) {
      for (const s of kids(DB.xmlTree(st), 'w:style')) {
        const id = s.a['w:styleId'];
        const nm = kid(s, 'w:name') ? (kid(s, 'w:name').a['w:val'] || '') : '';
        const ol = find(s, 'w:outlineLvl');
        let lv = 0;
        const m = /^heading (\d)$/i.exec(nm);
        if (m) lv = +m[1]; else if (/^title$/i.test(nm)) lv = 1; else if (ol && /^\d$/.test(ol.a['w:val'])) lv = +ol.a['w:val'] + 1;
        if (id && lv) levels.set(id, Math.min(lv, 9));
      }
    }
    const c = state.contents;
    const walk = (parent, d) => {
      if (d > 32) return;
      for (const el of kids(parent)) {
        if (el.n === 'w:p') {
          const ppr = kid(el, 'w:pPr');
          const style = ppr && kid(ppr, 'w:pStyle') ? ppr ? kid(ppr, 'w:pStyle').a['w:val'] : '' : '';
          const ol = ppr && kid(ppr, 'w:outlineLvl');
          const hm = /^Heading(\d)$/.exec(style || '');
          const level = levels.get(style) || (hm ? +hm[1] : style === 'Title' ? 1 : 0) || (ol && /^\d$/.test(ol.a['w:val']) ? +ol.a['w:val'] + 1 : 0);
          const s = c.take(docxText(el, 0));
          if (s === null) continue;
          if (level) { c.counts.headings++; c.push({ k: 'h', level, text: s }); }
          else { c.counts.paragraphs++; c.push({ k: 'p', text: s, list: !!(ppr && kid(ppr, 'w:numPr')) }); }
        } else if (el.n === 'w:tbl') {
          const rows = [];
          let headerRows = 0, inHeader = true;
          for (const tr of docxRows(el)) {
            const trPr = kid(tr, 'w:trPr');
            if (inHeader && trPr && kid(trPr, 'w:tblHeader') && (kid(trPr, 'w:tblHeader').a['w:val'] || 'true') !== 'false' && kid(trPr, 'w:tblHeader').a['w:val'] !== '0') headerRows++;
            else inHeader = false;
            const cells = kids(tr).filter((x) => x.n === 'w:tc' || x.n === 'w:sdt').map((tc) => {
              const cell = tc.n === 'w:sdt' ? find(tc, 'w:tc') || tc : tc;
              const pr = kid(cell, 'w:tcPr');
              const span = pr && kid(pr, 'w:gridSpan') ? parseInt(kid(pr, 'w:gridSpan').a['w:val'], 10) || 1 : 1;
              const vm = pr && kid(pr, 'w:vMerge');
              return { text: clean(docxText(cell, 0, true)), cs: span, cont: !!vm && (vm.a['w:val'] || 'continue') === 'continue' };
            });
            // a row that starts or ends later in the grid (an indented row): its empty grid columns keep the cells in place
            const gb = trPr && kid(trPr, 'w:gridBefore'), ga = trPr && kid(trPr, 'w:gridAfter');
            const nb = gb ? Math.min(parseInt(gb.a['w:val'], 10) || 0, 1000) : 0, na = ga ? Math.min(parseInt(ga.a['w:val'], 10) || 0, 1000) : 0;
            if (nb > 0) cells.unshift({ text: '', cs: nb });
            if (na > 0) cells.push({ text: '', cs: na });
            rows.push(cells);
          }
          const sec = addTable(state, rows, headerRows, '', true);
          if (sec !== -1) c.push({ k: 'table', sec });
        } else if (el.n === 'w:sdt') walk(kid(el, 'w:sdtContent') || el, d + 1);
        else if (el.n === 'mc:AlternateContent') walk(kid(el, 'mc:Choice') || el, d + 1);
        else if (['w:customXml', 'w:smartTag', 'w:ins'].includes(el.n)) walk(el, d + 1);
      }
    };
    walk(body, 0);
    ooxmlProps(files, state.fileMeta);
  }

  /* ---------- PowerPoint ---------- */
  function drawText(el) {                                                 // a:p paragraphs of a text body, one line each
    const lines = [];
    for (const p of kids(el, 'a:p')) {
      let s = '';
      for (const x of kids(p)) {
        if (x.n === 'a:r' || x.n === 'a:fld') { const t = kid(x, 'a:t'); if (t) s += textOf(t); } else if (x.n === 'a:br') s += '\n';
      }
      lines.push(s);
    }
    return lines.join('\n');
  }
  function pptxTable(tbl) {
    const rows = [];
    for (const tr of kids(tbl, 'a:tr')) {
      rows.push(kids(tr, 'a:tc').map((tc) => {
        if (tc.a.hMerge === '1' || tc.a.vMerge === '1') return { text: '', cs: 1, cont: tc.a.vMerge === '1', skip: tc.a.hMerge === '1' };
        const body = kid(tc, 'a:txBody');
        return { text: body ? clean(drawText(body)) : '', cs: parseInt(tc.a.gridSpan, 10) || 1, rs: parseInt(tc.a.rowSpan, 10) || 1 };
      }).filter((x) => !x.skip));
    }
    // PowerPoint writes the covered cells of a span too (hMerge / vMerge): the spans already cover them
    const fixed = rows.map((r) => r.filter((x) => !x.cont));
    const pr = kid(tbl, 'a:tblPr');
    return { rows: fixed, header: pr && (pr.a.firstRow === '1' || pr.a.firstRow === 'true') ? 1 : 0 };
  }
  function parsePptx(files, state) {
    const pres = DB.xmlTree(text(files, 'ppt/presentation.xml'), '.pptx');
    const r = rels(files, 'ppt/presentation.xml');
    const lst = find(pres, 'p:sldIdLst');
    const slidePaths = (lst ? kids(lst, 'p:sldId') : []).map((s) => r[s.a['r:id']] && r[s.a['r:id']].target).filter(Boolean);
    const c = state.contents;
    slidePaths.slice(0, MAX_SLIDES).forEach((path, si) => {
      const n = si + 1;
      c.counts.slides++;
      const slide = { k: 'slide', n, title: '', text: [], tables: [], notes: '' };
      const x = text(files, path);
      if (x) {
        const tree = DB.xmlTree(x, '.pptx');
        const tree2 = find(tree, 'p:spTree');
        let ti = 0;
        const walk = (el, d) => {
          if (d > 32) return;
          for (const sh of kids(el)) {
            if (sh.n === 'p:grpSp') walk(sh, d + 1);
            else if (sh.n === 'mc:AlternateContent') walk(kid(sh, 'mc:Choice') || sh, d + 1);
            else if (sh.n === 'p:sp') {
              const ph = find(kid(sh, 'p:nvSpPr'), 'p:ph');
              const body = kid(sh, 'p:txBody');
              const s = body ? c.take(drawText(body)) : null;
              if (!s) continue;
              if (ph && /^(title|ctrTitle)$/.test(ph.a.type || '') && !slide.title) slide.title = s;
              else slide.text.push(s);
            } else if (sh.n === 'p:graphicFrame') {
              const tbl = find(sh, 'a:tbl');
              if (!tbl) continue;
              const t = pptxTable(tbl);
              ti++;
              const sec = addTable(state, t.rows, t.header, 'slide' + n + '_table' + ti);
              if (sec !== -1) slide.tables.push(sec);
            }
          }
        };
        walk(tree2 || tree, 0);
        // speaker notes: the body placeholder of the notes slide
        const sr = rels(files, path);
        const notes = Object.values(sr).find((v) => v.type === 'notesSlide');
        if (notes && files[notes.target]) {
          const nt = DB.xmlTree(text(files, notes.target), '.pptx');
          const parts = [];
          for (const sh of kids(find(nt, 'p:spTree') || nt, 'p:sp')) {
            const ph = find(kid(sh, 'p:nvSpPr'), 'p:ph');
            if (ph && ph.a.type === 'body' && kid(sh, 'p:txBody')) parts.push(drawText(kid(sh, 'p:txBody')));
          }
          slide.notes = c.take(parts.join('\n')) || '';
        }
      }
      c.push(slide);
    });
    if (slidePaths.length > MAX_SLIDES) c.cut += slidePaths.length - MAX_SLIDES;
    ooxmlProps(files, state.fileMeta);
  }

  /* ---------- OpenDocument ---------- */
  /* The text of a paragraph or a cell. A table in a frame anchored in a paragraph holds records, not free text: left out of
   * the paragraph (inside a cell it stays part of the cell's value). */
  function odfText(el, d, inCell) {
    let s = '';
    if (d > MAX_DEPTH) return s;
    for (const x of el.c) {
      if (typeof x === 'string') { s += x; continue; }
      switch (x.n) {
        case 'text:s': s += ' '.repeat(Math.min(Math.max(parseInt(x.a['text:c'], 10) || 1, 1), 100)); break;
        case 'text:tab': s += '\t'; break;
        case 'text:line-break': s += '\n'; break;
        case 'text:note': case 'office:annotation': case 'text:bookmark-ref': break;
        case 'table:table': if (inCell) s += (s ? '\n' : '') + odfText(x, d + 1, true); break;
        case 'text:p': case 'text:h': case 'text:list-item': s += (s && !s.endsWith('\n') ? '\n' : '') + odfText(x, d + 1, inCell); break;
        default: s += odfText(x, d + 1, inCell);
      }
    }
    return s;
  }
  const ODF_ROWS = 1000000;            // rows of one table, repeats included
  function odfTable(tbl) {
    const rows = [];
    let headerRows = 0;
    const addRow = (tr, header) => {
      if (rows.length >= ODF_ROWS) return;
      const reps = Math.min(parseInt(tr.a['table:number-rows-repeated'], 10) || 1, 1000);
      const cells = [];
      for (const tc of kids(tr)) {
        if (tc.n !== 'table:table-cell' && tc.n !== 'table:covered-table-cell') continue;
        const crep = Math.min(parseInt(tc.a['table:number-columns-repeated'], 10) || 1, 1000);
        const cell = tc.n === 'table:covered-table-cell' ? { covered: true }
          : { text: clean(odfText(tc, 0, true)), cs: parseInt(tc.a['table:number-columns-spanned'], 10) || 1, rs: parseInt(tc.a['table:number-rows-spanned'], 10) || 1 };
        for (let k = 0; k < crep && cells.length < 10000; k++) cells.push(cell);   // one object for every repeat
      }
      // empty cells at the end of a row, and repeated empty rows, are layout, not data
      while (cells.length && (cells[cells.length - 1].covered || !cells[cells.length - 1].text) && (cells[cells.length - 1].cs || 1) === 1) cells.pop();
      const kept = cells.filter((x) => !x.covered);
      const n = !kept.some((x) => x.text) ? Math.min(reps, 1) : Math.min(reps, ODF_ROWS - rows.length);
      for (let k = 0; k < n; k++) { rows.push(kept); if (header) headerRows++; }
    };
    const walk = (el, header, d) => {
      if (d > 8) return;
      for (const x of kids(el)) {
        if (x.n === 'table:table-row') addRow(x, header);
        else if (x.n === 'table:table-header-rows') walk(x, true, d + 1);
        else if (x.n === 'table:table-rows' || x.n === 'table:table-row-group') walk(x, header, d + 1);
      }
    };
    walk(tbl, false, 0);
    return { rows, header: headerRows };
  }
  function parseOdt(files, state) {
    const tree = DB.xmlTree(text(files, 'content.xml'), '.odt');
    const body = find(tree, 'office:text');
    if (!body) throw corrupt('.odt');
    const c = state.contents;
    const walk = (parent, d, list) => {
      if (d > 32) return;
      for (const el of kids(parent)) {
        if (el.n === 'text:h' || el.n === 'text:p') {
          const s = c.take(odfText(el, 0));
          if (s === null) continue;
          if (el.n === 'text:h') { c.counts.headings++; c.push({ k: 'h', level: Math.min(Math.max(parseInt(el.a['text:outline-level'], 10) || 1, 1), 9), text: s }); }
          else { c.counts.paragraphs++; c.push({ k: 'p', text: s, list }); }
        } else if (el.n === 'table:table') {
          const t = odfTable(el);
          const sec = addTable(state, t.rows, t.header, el.a['table:name'] && !/^Table\d+$/.test(el.a['table:name']) ? one(el.a['table:name']).slice(0, 80) : '', true);
          if (sec !== -1) c.push({ k: 'table', sec });
        } else if (el.n === 'text:list' || el.n === 'text:list-item' || el.n === 'text:list-header') walk(el, d + 1, true);
        else if (['text:section', 'text:soft-page-break', 'text:index-body', 'text:table-of-content'].includes(el.n)) walk(el, d + 1, list);
      }
    };
    walk(body, 0, false);
    odfProps(files, state.fileMeta);
  }
  function parseOdp(files, state) {
    const tree = DB.xmlTree(text(files, 'content.xml'), '.odp');
    const pres = find(tree, 'office:presentation');
    if (!pres) throw corrupt('.odp');
    const c = state.contents;
    kids(pres, 'draw:page').slice(0, MAX_SLIDES).forEach((page, si) => {
      const n = si + 1;
      c.counts.slides++;
      const slide = { k: 'slide', n, title: '', text: [], tables: [], notes: '' };
      let ti = 0;
      const walk = (el, d) => {
        if (d > 32) return;
        for (const f of kids(el)) {
          if (f.n === 'draw:g') { walk(f, d + 1); continue; }
          if (f.n !== 'draw:frame' && f.n !== 'draw:custom-shape') continue;
          const tbl = kid(f, 'table:table');
          if (tbl) {
            const t = odfTable(tbl);
            ti++;
            const sec = addTable(state, t.rows, t.header, 'slide' + n + '_table' + ti, true);
            if (sec !== -1) slide.tables.push(sec);
            continue;
          }
          const box = kid(f, 'draw:text-box') || (f.n === 'draw:custom-shape' ? f : null);
          if (!box) continue;
          const s = c.take(kids(box).filter((x) => x.n === 'text:p' || x.n === 'text:h' || x.n === 'text:list').map((x) => odfText(x, 0)).join('\n'));
          if (!s) continue;
          if (f.a['presentation:class'] === 'title' && !slide.title) slide.title = s;
          else slide.text.push(s);
        }
      };
      walk(page, 0);
      const notes = kid(page, 'presentation:notes');
      if (notes) {
        const parts = [];
        for (const f of kids(notes, 'draw:frame')) if (f.a['presentation:class'] === 'notes' && kid(f, 'draw:text-box')) parts.push(odfText(kid(f, 'draw:text-box'), 0));
        slide.notes = c.take(parts.join('\n')) || '';
      }
      c.push(slide);
    });
    odfProps(files, state.fileMeta);
  }

  DB.parseOffice = function (u8, kind) {
    const e = ext[kind] || '.docx';
    let files;
    if (kind === 'docx') files = unzip(u8, (n) => n === 'word/document.xml' || n === 'word/styles.xml' || /^docProps\/(core|app)\.xml$/.test(n), e);
    else if (kind === 'pptx') files = unzip(u8, (n) => /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(_rels\/)?slide\d+\.xml(\.rels)?|notesSlides\/notesSlide\d+\.xml)$/.test(n) || /^docProps\/(core|app)\.xml$/.test(n), e);
    else files = unzip(u8, (n) => n === 'content.xml' || n === 'meta.xml', e);
    const state = { sections: [], fileMeta: [], notes: {}, used: new Set(), contents: Contents(kind === 'pptx' || kind === 'odp' ? 'slides' : 'document') };
    if (kind === 'docx') { if (!files['word/document.xml']) throw corrupt(e); parseDocx(files, state); }
    else if (kind === 'pptx') { if (!files['ppt/presentation.xml']) throw corrupt(e); parsePptx(files, state); }
    else if (kind === 'odt') { if (!files['content.xml']) throw corrupt(e); parseOdt(files, state); }
    else if (kind === 'odp') { if (!files['content.xml']) throw corrupt(e); parseOdp(files, state); }
    else throw corrupt(e);
    const cont = state.contents;
    delete cont.take; delete cont.push;
    return { sections: state.sections, fileMeta: state.fileMeta, notes: state.notes, contents: cont, office: kind };
  };
})();
