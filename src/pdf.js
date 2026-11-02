/* DataBrief - PDF documents (best effort). GPL-3.0-or-later.
 *
 * A PDF holds text placed on pages, not tables: DataBrief reads the text with pdf.js (vendor/pdfjs.min.js, legacy build, its
 * worker code on the main thread, no eval) and GUESSES tables from the positions of the text: lines are text at the same
 * height, cells are separated by wide gaps, a table is a run of lines with several cells that line up in columns. A line that
 * starts in a later column right under a row continues the cells of that row (text that wraps in a cell). The prompt says
 * that these tables are guessed. The rest of each page is context (doc.contents, kind "pages").
 * DB.isPdf(u8); DB.parsePdf(u8) -> Promise<{ sections, fileMeta, notes, contents }>. DB.pdfLayout(items) is the pure part
 * (text items with positions -> lines, tables, paragraphs), tested in Node.
 * The page built for the ESP32 has no pdf.js (deploy/esp32/make_header strips it): there, a PDF gets the "recognised but not
 * readable" message (errKindPdf). */
'use strict';
(function () {
  const DB = window.DB;
  const UserError = DB.UserError;
  const MAX_PAGES = 500, MAX_TABLES = 500, ITEM_CHARS = 4000, CONTENT_BUDGET = 200000, MAX_ITEMS_PAGE = 100000;

  DB.isPdf = (u8) => {
    const head = String.fromCharCode.apply(null, u8.subarray(0, Math.min(u8.length, 1024)));
    return head.indexOf('%PDF-') >= 0;
  };
  DB.pdfAvailable = () => !!(window.pdfjsLib && window.pdfjsLib.getDocument);

  /* ---------- the layout: text items { str, x, y, w, h } (y grows upwards, as in PDF) -> lines, tables, paragraphs ---------- */
  function joinPieces(pieces) {                                           // pieces of one cell, left to right
    let s = '', end = null;
    for (const p of pieces) {
      if (s && end !== null && !/\s$/.test(s) && !/^\s/.test(p.str) && p.x - end > p.h * 0.15) s += ' ';
      s += p.str;
      end = p.x + p.w;
    }
    return s.replace(/\s+/g, ' ').trim();
  }
  DB.pdfLayout = function (items) {
    const its = items.filter((i) => i && typeof i.str === 'string' && isFinite(i.x) && isFinite(i.y) && i.h > 0 && (i.str.trim() || i.w > 0))
      .slice(0, MAX_ITEMS_PAGE);
    // 1. lines: items at the same height, top to bottom
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of its) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line.y - it.y) <= 0.35 * Math.max(line.h, it.h)) { line.items.push(it); line.h = Math.max(line.h, it.h); }
      else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    // 2. cells: within a line, pieces separated by a wide gap
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      const cells = [];
      let cur = null, end = null;
      for (const it of line.items) {
        if (!it.str.trim()) { continue; }
        // pdf.js writes the spaces between words inside the text; text placed apart (another cell) comes as a separate piece:
        // a gap wider than a word space (about a quarter of the character height) starts a new cell
        if (cur && it.x - end < Math.max(it.h * 0.3, 1.5)) cur.pieces.push(it);
        else { cur = { x: it.x, pieces: [it] }; cells.push(cur); }
        end = it.x + it.w;
      }
      line.cells = cells.map((c) => ({ x: c.x, end: c.pieces[c.pieces.length - 1].x + c.pieces[c.pieces.length - 1].w, text: joinPieces(c.pieces) })).filter((c) => c.text);
    }
    const textLines = lines.filter((l) => l.cells.length);
    // 3. tables: runs of lines with 2 or more cells; a line of fewer cells that starts in a later column continues the row above
    const blocks = [];
    for (let i = 0; i < textLines.length; i++) {
      const l = textLines[i];
      if (l.cells.length < 2) continue;
      const block = [l];
      let j = i + 1;
      for (; j < textLines.length; j++) {
        const prev = textLines[j - 1], m = textLines[j];
        if (prev.y - m.y > 2.6 * Math.max(prev.h, m.h)) break;
        if (m.cells.length >= 2) { block.push(m); continue; }
        // one cell: a continuation only when it starts clearly to the right of the table's first column
        if (m.cells[0].x > block[0].cells[0].x + Math.max(m.h, 4)) { block.push(m); continue; }
        break;
      }
      blocks.push(block);
      i = j - 1;
    }
    const tables = [];
    const inTable = new Set();
    for (const block of blocks) {
      // columns: the cells of the fullest line. A line of several cells is a row only when its cells line up with them (by
      // their left edge, right edge or centre): the words of a justified paragraph do not
      const widest = block.filter((l) => l.cells.length >= 2).reduce((a, l) => (l.cells.length > a.cells.length ? l : a), block[0]);
      const anchors = widest.cells.map((c) => c.x);
      const tol = Math.max(widest.h * 0.8, 3);
      const lines = (() => {
        const fits = (c) => widest.cells.some((a) => Math.abs(c.x - a.x) <= tol || Math.abs(c.end - a.end) <= tol || Math.abs((c.x + c.end) / 2 - (a.x + a.end) / 2) <= tol);
        const out = [];
        for (const l of block) {
          if (l.cells.length >= 2 && l.cells.filter((c) => !fits(c)).length > 0) { if (out.length && out.filter((x) => x.cells.length >= 2).length >= 2) break; out.length = 0; continue; }
          out.push(l);
        }
        return out;
      })();
      const full = lines.filter((l) => l.cells.length >= 2);
      if (full.length < 2) continue;                                      // a header and one row at least
      // a cell's column: the one it lines up with best (left edge, right edge for numbers, centre), else by its left edge
      const colOf = (c) => {
        let best = -1, bd = Infinity;
        widest.cells.forEach((a, k) => {
          const d = Math.min(Math.abs(c.x - a.x), Math.abs(c.end - a.end), Math.abs((c.x + c.end) / 2 - (a.x + a.end) / 2));
          if (d <= tol && d < bd) { bd = d; best = k; }
        });
        if (best >= 0) return best;
        let k = 0;
        for (let a = 0; a < anchors.length; a++) if (c.x >= anchors[a] - tol) k = a;
        return k;
      };
      const rows = [];
      for (const l of lines) {
        const row = new Array(anchors.length).fill('');
        let firstCol = Infinity;
        for (const c of l.cells) { const k = colOf(c); firstCol = Math.min(firstCol, k); row[k] = row[k] ? row[k] + ' ' + c.text : c.text; }
        // a line that leaves the first column empty and has fewer cells than columns: text wrapping inside the row above
        // (joined with a space: in a PDF a wrapped line and a line break written by people look the same)
        if (rows.length && firstCol > 0 && l.cells.length < anchors.length) {
          const last = rows[rows.length - 1];
          for (let k = 0; k < anchors.length; k++) if (row[k]) last[k] = last[k] ? last[k] + ' ' + row[k] : row[k];
        } else rows.push(row);
      }
      // a real table has at least two columns used by most rows
      const used = anchors.map((_, k) => rows.filter((r) => r[k]).length);
      if (used.filter((u) => u >= Math.min(2, rows.length)).length < 2 || rows.length < 2) continue;
      tables.push({ y: lines[0].y, rows });
      for (const l of lines) inTable.add(l);
    }
    // 4. the rest: paragraphs (lines close together), with headings (clearly larger text)
    const rest = textLines.filter((l) => !inTable.has(l));
    const sizes = rest.map((l) => l.h).sort((a, b) => a - b);
    const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    const flow = [];
    let para = null;
    for (const l of rest) {
      const text = l.cells.map((c) => c.text).join(' ');
      const heading = body && l.h >= body * 1.3 && text.length < 150;
      if (heading) { flow.push({ k: 'h', y: l.y, text }); para = null; continue; }
      if (para && para.lastY - l.y <= 1.8 * Math.max(l.h, para.h)) { para.text += '\n' + text; para.lastY = l.y; }
      else { para = { k: 'p', y: l.y, text, lastY: l.y, h: l.h }; flow.push(para); }
    }
    for (const t of tables) flow.push({ k: 'table', y: t.y, rows: t.rows });
    flow.sort((a, b) => b.y - a.y);
    return flow.map((f) => (f.k === 'table' ? { k: 'table', rows: f.rows } : { k: f.k, text: f.text }));
  };

  /* ---------- the document ---------- */
  const one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 300);
  const pdfDate = (s) => { const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?/.exec(String(s || '')); return m ? m[1] + '-' + (m[2] || '01') + '-' + (m[3] || '01') : ''; };

  DB.parsePdf = async function (u8) {
    if (!DB.pdfAvailable()) throw new UserError('errKindPdf');
    const lib = window.pdfjsLib;
    let doc;
    try {
      doc = await lib.getDocument({
        data: u8.slice(),                        // pdf.js takes the buffer over: a copy keeps the caller's bytes
        isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, stopAtErrors: false,
        verbosity: 0, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, enableXfa: false,
      }).promise;
    } catch (e) {
      const name = e && e.name;
      if (name === 'PasswordException') throw new UserError('errPdfProtected');
      throw new UserError('errCorrupt', { ext: '.pdf' }, String(e && e.message || e).slice(0, 200));
    }
    try {
      const fileMeta = [];
      try {
        const m = await doc.getMetadata();
        const info = (m && m.info) || {};
        if (one(info.Title)) fileMeta.push(['mDocTitle', one(info.Title)]);
        if (one(info.Subject)) fileMeta.push(['mDocSubject', one(info.Subject)]);
        if (one(info.Author)) fileMeta.push(['mDocAuthor', one(info.Author)]);
        if (one(info.Keywords)) fileMeta.push(['mDocKeywords', one(info.Keywords)]);
        const dates = [pdfDate(info.CreationDate), pdfDate(info.ModDate)].filter(Boolean);
        if (dates.length) fileMeta.push(['mDocDates', dates.join(' → ')]);
        const app = [one(info.Creator), one(info.Producer)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ').replace(/[^\w .,/()+:;·-]/g, '').slice(0, 160);
        if (app) fileMeta.push(['mDocApp', app]);
      } catch (e) { /* no metadata: nothing to show */ }
      const pages = doc.numPages;
      const sections = [], notes = {}, used = new Set();
      let budget = CONTENT_BUDGET, chars = 0;
      const contents = { kind: 'pages', items: [], cut: 0, counts: { headings: 0, paragraphs: 0, tables: 0, slides: 0, pages } };
      const take = (s) => { s = s.slice(0, ITEM_CHARS); if (budget <= 0) return ''; if (s.length > budget) s = s.slice(0, budget) + '…'; budget -= s.length; return s; };
      for (let n = 1; n <= Math.min(pages, MAX_PAGES); n++) {
        const page = await doc.getPage(n);
        const tc = await page.getTextContent({ disableNormalization: false });
        const items = [];
        for (const it of tc.items) {
          if (typeof it.str !== 'string' || !it.transform) continue;
          const t = it.transform;
          if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;   // rotated text: not part of a table nor of the flow
          chars += it.str.length;
          items.push({ str: it.str, x: t[4], y: t[5], w: it.width || 0, h: Math.abs(it.height || t[3] || 0) });
        }
        page.cleanup();
        const flow = DB.pdfLayout(items);
        const entry = { k: 'page', n, title: '', text: [], tables: [], notes: '' };
        let ti = 0;
        for (const f of flow) {
          if (f.k === 'table') {
            contents.counts.tables++;
            if (sections.length >= MAX_TABLES) { entry.tables.push(-2); continue; }
            ti++;
            let name = 'page' + n + '_table' + ti, k = 2;
            while (used.has(name)) name = 'page' + n + '_table' + ti + '_' + k++;
            used.add(name);
            const sec = DB.gridToSection(f.rows, name);
            if (!sec.columns.length) continue;
            sections.push(sec);
            entry.tables.push(sections.length - 1);
            notes.pdfTables = true;
          } else {
            const s = take(f.text);
            if (!s) continue;
            if (f.k === 'h') contents.counts.headings++; else contents.counts.paragraphs++;
            entry.text.push(f.k === 'h' ? '# ' + s : s);
          }
        }
        contents.items.push(entry);
      }
      if (pages > MAX_PAGES) contents.cut = pages - MAX_PAGES;
      contents.counts.slides = contents.items.length;
      if (!chars) notes.pdfNoText = true;                                 // scanned pages: images, no text to read
      return { sections, fileMeta, notes, contents };
    } finally {
      try { await doc.destroy(); } catch (e) { /* already gone */ }
    }
  };
})();
