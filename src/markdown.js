/* DataBrief - builds the Markdown prompt. GPL-3.0-or-later.
 * The prompt is produced as a list of parts:
 *   { s }            locked text (values, names, data, Markdown structure)
 *   { k, s, orig }   editable text written by DataBrief (k = stable id, orig = generated text)
 * User edits are stored as { id: text } overrides and re-applied on every rebuild. */
'use strict';
(function () {
  const DB = window.DB;
  const LOCALES = { zh: 'zh-CN', ar: 'ar-u-nu-latn' };

  DB.locale = (lang) => LOCALES[lang] || lang;

  /* Translate a prompt string. */
  DB.tp = function (lang, key, vars) {
    const P = window.DB_I18N.prompt;
    let s = (P[lang] && P[lang][key]) || P.en[key] || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
  };
  const rawTp = (lang, key) => {
    const P = window.DB_I18N.prompt;
    return (P[lang] && P[lang][key]) || P.en[key] || key;
  };

  const cellMd = (v) => String(v).replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
  const csvCell = (v) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  // Inline code. A name that contains backticks gets a longer fence, so it cannot end the code span early.
  const code = (s) => {
    s = String(s);
    if (!s.includes('`')) return '`' + s + '`';
    let f = '``';
    while (s.includes(f)) f += '`';
    return f + ' ' + s + ' ' + f;
  };

  function fenceFor(text) {
    let f = '```';
    while (text.includes(f)) f += '`';
    return f;
  }

  DB.toCsv = function (sec, limit) {
    const n = limit == null ? sec.rows.length : Math.min(limit, sec.rows.length);
    const lines = new Array(n + 1);
    lines[0] = sec.columns.map((c) => csvCell(c.name)).join(',');
    for (let r = 0; r < n; r++) lines[r + 1] = sec.rows[r].map(csvCell).join(',');
    return lines.join('\n');
  };

  function toTable(sec, n) {
    const lines = new Array(n + 2);
    lines[0] = '| ' + sec.columns.map((c) => cellMd(c.name)).join(' | ') + ' |';
    lines[1] = '|' + sec.columns.map(() => '---').join('|') + '|';
    for (let r = 0; r < n; r++) lines[r + 2] = '| ' + sec.rows[r].map(cellMd).join(' | ') + ' |';
    return lines.join('\n');
  }

  function renderData(sec, layout, n) {
    if (layout === 'table') return toTable(sec, n);
    const csv = DB.toCsv(sec, n);
    const f = fenceFor(csv);
    return f + 'csv\n' + csv + '\n' + f;
  }

  /* In 'files' mode the data goes in separate CSV files: the prompt only shows a short sample. */
  function sectionView(sec, opts) {
    const avail = sec.rows.length;                          // the rows that were read
    const total = Math.max(avail, sec.totalRows || 0);      // the rows of the table (a large SQL dump is read only in part)
    const files = opts.mode === 'files';
    const shown = files ? Math.min(opts.sample || 5, avail) : opts.limit && avail > opts.limit ? opts.limit : avail;
    let layout = opts.layout;
    if (layout === 'auto') layout = shown <= 100 && sec.columns.length <= 12 ? 'table' : 'csv';
    return { sec, shown, total, layout, partial: !files && shown < total };
  }

  DB.safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'data';
  /* Names of the CSV files: <file>.csv for one section, NN_<section>.csv for several. */
  DB.dataFileNames = function (doc) {
    const base = DB.safeName((doc.fileName || 'data').replace(/\.[^.]+$/, ''));
    if (doc.sections.length === 1) return [base + '.csv'];
    const used = new Set();
    return doc.sections.map((s, i) => {
      let n = String(i + 1).padStart(2, '0') + '_' + DB.safeName(s.name) + '.csv';
      while (used.has(n)) n = n.replace(/\.csv$/, '_.csv');
      used.add(n);
      return n;
    });
  };

  const META_COLS = [
    ['label', 'cLabel'], ['values', 'cValues'], ['measure', 'cMeasure'], ['format', 'cFormat'], ['missing', 'cMissing'],
    ['sqlType', 'cSql'], ['key', 'cKey'], ['notNull', 'cNotNull'], ['generated', 'cGenerated'], ['parquetType', 'cParquet'], ['geometry', 'cGeometry'], ['dtype', 'cDtype'], ['avroType', 'cAvro'], ['arrowType', 'cArrow'],
  ];
  const TYPE_KEYS = {
    integer: 'tInteger', decimal: 'tDecimal', date: 'tDate', datetime: 'tDatetime', time: 'tTime',
    boolean: 'tBoolean', text: 'tText', empty: 'tEmpty', mixed: 'tMixed', geometry: 'tGeometry',
  };

  function metaText(v, t) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.map((x) => metaText(x, t)).filter(Boolean).join(', ');
    if (typeof v === 'object' && v.key) return t(v.key);
    return String(v);
  }
  const isEmptyMeta = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

  /* The per-section column table is locked: it describes the data exactly. */
  function columnsTable(sec, t) {
    const extra = META_COLS.filter(([k]) => sec.columns.some((c) => !isEmptyMeta(c.meta && c.meta[k])));
    const head = [t('cName'), t('cType')].concat(extra.map(([, label]) => t(label)));
    const lines = ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'];
    for (const c of sec.columns) {
      const cells = [cellMd(code(c.name)), t(TYPE_KEYS[c.type] || 'tText')];
      for (const [k] of extra) cells.push(cellMd(metaText(c.meta && c.meta[k], t)));
      lines.push('| ' + cells.join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  const sqlBlock = (sql) => { const f = fenceFor(sql); return f + 'sql\n' + sql + '\n' + f; };

  /* Keys, constraints, indexes and the original definition of a table (locked: they describe the data exactly). */
  function constraintsText(c, t) {
    const list = (cols) => cols.map(code).join(', ');
    const out = [];
    if (c.pk && c.pk.length) out.push('**' + t('tblPk') + ':** ' + list(c.pk));
    if (c.fks && c.fks.length) {
      const lines = c.fks.map((f) => {
        const act = [['onDelete', f.onDelete], ['onUpdate', f.onUpdate]].filter(([, v]) => v && v !== 'NO ACTION').map(([k, v]) => ' · ' + t(k) + ': ' + v).join('');
        return '- (' + list(f.from) + ') → ' + code(f.table) + ' (' + list(f.to.map((x) => x || '?')) + ')' + act;
      });
      out.push('**' + t('tblFk') + ':**\n' + lines.join('\n'));
    }
    const ixLine = (e) => (e.name ? code(e.name) + ' ' : '') + '(' + list(e.cols) + ')';
    if (c.unique && c.unique.length) out.push('**' + t('tblUnique') + ':** ' + c.unique.map(ixLine).join('; '));
    if (c.indexes && c.indexes.length) out.push('**' + t('tblIndexes') + ':** ' + c.indexes.map(ixLine).join('; '));
    if (c.ddl) out.push('**' + t('tblDdl') + ':**\n\n' + sqlBlock(c.ddl));
    return out.length ? out.join('\n\n') + '\n\n' : '';
  }

  /* Relationships between sections: declared by the source, and inferred candidates (kept apart, never mixed). */
  function relationshipsText(rels, t) {
    const ref = (e) => code(e.section) + ' (' + e.columns.map(code).join(', ') + ')';
    const CARD = { one_to_one: 'cardOneOne', many_to_one: 'cardManyOne', many_to_many: 'cardManyMany' };
    const CONF = { high: 'confHigh', medium: 'confMedium', low: 'confLow' };
    const table = (heads, rows) => {
      const h = heads.map((k) => t(k));
      return ['| ' + h.join(' | ') + ' |', '|' + h.map(() => '---').join('|') + '|']
        .concat(rows.map((r) => '| ' + r.map(cellMd).join(' | ') + ' |')).join('\n');
    };
    const out = [];
    const dec = rels.filter((r) => r.source === 'declared');
    const inf = rels.filter((r) => r.source === 'inferred');
    if (dec.length) {
      out.push('**' + t('relDeclared') + ':**\n\n' + table(['relFrom', 'relTo', 'relCard', 'relNotes'], dec.map((r) => {
        const notes = [];
        if (r.onDelete && r.onDelete !== 'NO ACTION') notes.push(t('onDelete') + ': ' + r.onDelete);
        if (r.onUpdate && r.onUpdate !== 'NO ACTION') notes.push(t('onUpdate') + ': ' + r.onUpdate);
        if (r.from.section === r.to.section && r.cardinality !== 'many_to_many') notes.push(t('relSelf'));
        if (r.via) notes.push(t('relVia', { t: code(r.via) }));
        return [ref(r.from), ref(r.to), t(CARD[r.cardinality]), notes.join(' · ')];
      })));
    }
    if (inf.length) {
      out.push('**' + t('relInferred') + ':**\n\n' + table(['relFrom', 'relTo', 'relCard', 'relConf', 'relEvid'], inf.map((r) => [
        ref(r.from), ref(r.to), t(CARD[r.cardinality]), t(CONF[r.confidence]),
        (r.evidence || []).map((e) => (typeof e === 'string' ? t(e) : t(e.key, { pct: e.pct }))).join('; '),
      ])));
    }
    return out.join('\n\n') + '\n\n';
  }

  /* Optional data profile: one table per section (locked text: the numbers are computed from the data). */
  function profileText(sections, t) {
    const KIND = { identifier: 'kindIdentifier', categorical: 'kindCategorical', continuous: 'kindContinuous', datetime: 'kindDatetime',
      text: 'kindText', empty: 'kindEmpty', mixed: 'kindMixed' };
    const pct = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '%';
    const num = (x) => String(Number(Number(x).toPrecision(6)));
    const summary = (c) => {
      const s = c.summary;
      if (c.note) return t(c.note);
      if (!s) return '';
      if (s.top) {
        const parts = s.top.map((x) => x.value + ': ' + x.count + ' (' + pct(x.pct) + ')');
        if (s.other) parts.push(t('statOther') + ': ' + s.other + ' (' + pct(s.otherPct) + ')');
        return parts.join(' · ');
      }
      if (s.mean !== undefined) {
        return [[t('statMin'), num(s.min)], [t('statMax'), num(s.max)], [t('statMean'), num(s.mean)], [t('statSd'), num(s.sd)],
          [t('statMedian'), num(s.median)], [t('statOutliers'), s.outliers]].map(([k, v]) => k + ': ' + v).join(' · ');
      }
      return t('statMin') + ': ' + s.min + ' · ' + t('statMax') + ': ' + s.max;
    };
    const head = [t('cName'), t('profKind'), t('profMissing'), t('profDistinct'), t('profSummary')];
    return sections.map((p, i) => {
      if (!p.columns.length) return '';
      const rows = p.columns.map((c) => [code(c.name), t(KIND[c.kind]), c.missing ? c.missing + ' (' + pct((c.missing / c.n) * 100) + ')' : '0', c.distinct, summary(c)]);
      let s = '### ' + (i + 1) + '. ' + code(p.name) + '\n\n' +
        ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'].concat(rows.map((r) => '| ' + r.map(cellMd).join(' | ') + ' |')).join('\n') + '\n\n';
      if (p.duplicateRows) s += '**' + t('profDup') + ':** ' + p.duplicateRows + '\n\n';
      if (p.constantColumns.length) s += '**' + t('profConst') + ':** ' + p.constantColumns.map(code).join(', ') + '\n\n';
      return s;
    }).join('');
  }

  /* Compact list of numbers: 3, 7-9. */
  function numRanges(nums) {
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      out.push(j > i ? nums[i] + '-' + nums[j] : String(nums[i]));
      i = j;
    }
    return out.length > 30 ? out.slice(0, 30).join(', ') + ', …' : out.join(', ');
  }

  /* What the values of a spreadsheet do not say by themselves: formulas, merged cells, hidden rows and columns. */
  function sheetInfoText(si, t) {
    const out = [];
    const f = si.formulas;
    if (f && f.count) {
      let s = '**' + t('xFormulas') + ':** ' + f.count + (f.noResult ? ' · ' + t('xNoResult') + ': ' + f.noResult : '');
      if (f.examples.length) s += '\n' + f.examples.map((e) => '- `' + e.addr + '`: ' + code('=' + e.f)).join('\n') + (f.count > f.examples.length ? '\n- …' : '');
      out.push(s);
    }
    if (si.merges && si.merges.length) {
      out.push('**' + t('xMerged') + ':** ' + si.merges.slice(0, 20).map(code).join(', ') + (si.merges.length > 20 ? ', … (+' + (si.merges.length - 20) + ')' : ''));
    }
    if (si.hiddenRows && si.hiddenRows.length) out.push('**' + t('xHidRows') + ':** ' + numRanges(si.hiddenRows));
    if (si.hiddenCols && si.hiddenCols.length) out.push('**' + t('xHidCols') + ':** ' + si.hiddenCols.join(', '));
    return out.length ? out.join('\n\n') + '\n\n' : '';
  }

  /* Collects locked and editable parts. */
  /*
   * Collects the prompt. Everything is locked, except free regions: each region becomes one editable
   * block ({ k, s, orig }) that the user can rewrite entirely. Overrides replace a whole region.
   */
  /* The cells of a notebook, in order (doc.contents, notebook.js). The tables of its outputs are sections; the rest is context.
   * secName(i): the name to show for section i. ns: the "Do not share data" copy (noshare.js): no code and no output is
   * in it; the Markdown only when text is true. */
  function contentsText(cont, t, N, secName, ns, text) {
    const c = cont.counts;
    const out = ['**' + t('nbCounts', { n: N(c.cells), code: N(c.code), md: N(c.markdown), raw: N(c.raw) }) + '**', ''];
    const quote = (s) => s.split('\n').map((l) => '> ' + l).join('\n');
    const block = (s, lang) => { const f = fenceFor(s); return f + lang + '\n' + s + '\n' + f; };
    const more = (n) => (n ? '\n_' + t('nbMoreLines', { n: N(n) }) + '_' : '');
    const withheld = '_(' + t('nbWithheld') + ')_';
    for (const cell of cont.cells) {
      const kind = cell.type === 'code' ? t('nbCode') + (cell.exec !== null ? ' [' + cell.exec + ']' : ' · ' + t('nbNotRun'))
        : cell.type === 'markdown' ? 'Markdown' : t('nbRaw');
      const head = '**' + t('nbCell', { n: cell.n }) + ' · ' + kind + '**';
      const lines = [];
      if (cell.type === 'code') {
        if (ns) lines.push(head + ': ' + withheld);
        else if (cell.source) lines.push(head, block(cell.source, cont.language) + more(cell.more));
        else lines.push(head);
      } else if (ns && !(text && cell.source !== null)) lines.push(head + ': ' + withheld);
      else if (cell.source || cell.more) lines.push(head, quote(cell.source || '…') + more(cell.more));
      else lines.push(head);
      for (const o of cell.outputs) {
        if (o.kind === 'table') {
          lines.push(o.sec >= 0 ? '- ' + t('nbTable', { n: o.sec + 1 }) + ' ' + code(secName(o.sec)) +
            (o.colsCut ? ' (' + t('nbColsCut', { a: N(o.colsCut.a), b: N(o.colsCut.b) }) + ')' : '') : '- ' + t('nbTableCut', { n: N(cont.maxTables || 200) }));
        }
        else if (o.kind === 'error') lines.push('- ' + t('nbError') + ': ' + (o.ename ? code(o.ename) : '') + (!ns && o.evalue ? ' ' + code(o.evalue) : ''));
        else if (o.kind === 'image') lines.push('- ' + t('nbImage', { mime: o.mime }));
        else if (o.kind === 'other') lines.push('- ' + t('nbOther', { mime: o.mime }));
        else {
          const label = o.kind === 'stream' ? t(o.stderr ? 'nbStderr' : 'nbPrinted') : t('nbText');
          if (ns) lines.push('- ' + label + ': ' + withheld);
          else if (o.text || o.more) lines.push('- ' + label + ':', block(o.text || '…', 'text') + more(o.more));
        }
      }
      out.push(lines.join('\n'), '');
    }
    if (cont.cellsCut) out.push('_' + t('nbMoreCells', { n: N(cont.cellsCut) }) + '_', '');
    return out.join('\n') + '\n';
  }

  /* A document (headings, paragraphs, lists, tables in order) or a presentation (slides) as context (office.js).
   * ns: the "Do not share data" copy; text: the user allows free text. Without it, only the outline (kinds and tables). */
  function docContentsText(cont, t, N, secName, ns, text) {
    const c = cont.counts;
    const showText = !ns || text;
    const withheld = '_(' + t('nbWithheld') + ')_';
    const quote = (s) => s.split('\n').map((l) => '> ' + l).join('\n');
    const tableLine = (k) => (k >= 0 ? t('docTable', { n: k + 1 }) + ' ' + code(secName(k)) : t('docTableCut', { n: N(500) }));
    const out = [];
    if (cont.kind === 'slides' || cont.kind === 'pages') {
      const pg = cont.kind === 'pages';
      out.push('**' + t(pg ? 'pageCounts' : 'slideCounts', { n: N(c.slides), t: N(c.tables) }) + '**', '');
      for (const s of cont.items) {
        const head = '**' + t(pg ? 'pageN' : 'slideN', { n: s.n }) + (s.title && showText ? ' · ' + s.title.replace(/\s*\n\s*/g, ' ') : '') + '**';
        const lines = [];
        if (showText) {
          lines.push(head);
          if (s.text.length) lines.push(quote(s.text.join('\n')));
        } else {
          const parts = [];
          if (s.title || s.text.length) parts.push(t('slideTextNs', { n: N(s.text.length + (s.title ? 1 : 0)) }) + ' ' + withheld);
          lines.push(head + (parts.length ? ': ' + parts.join(' · ') : ''));
        }
        for (const k of s.tables) lines.push('- ' + tableLine(k));
        if (s.notes) lines.push(showText ? '- ' + t('slideNotes') + ':\n' + quote(s.notes) : '- ' + t('slideNotes') + ': ' + withheld);
        out.push(lines.join('\n'), '');
      }
    } else {
      out.push('**' + t('docCounts', { h: N(c.headings), p: N(c.paragraphs), t: N(c.tables) }) + '**', '');
      if (showText) {
        const lines = [];
        for (const it of cont.items) {
          if (it.k === 'h') lines.push('> ' + '#'.repeat(Math.min(it.level, 6)) + ' ' + (it.text || '…').replace(/\s*\n\s*/g, ' '));
          else if (it.k === 'p') lines.push(quote((it.list ? '- ' : '') + (it.text || '…')));
          else lines.push('>', '> **[' + tableLine(it.sec) + ']**', '>');
        }
        out.push(lines.join('\n'), '');
      } else {
        // the outline: headings with their level, runs of paragraphs counted, tables where they are
        const lines = [];
        let paras = 0;
        const flush = () => { if (paras) lines.push('- ' + t('docParasNs', { n: N(paras) }) + ' ' + withheld); paras = 0; };
        for (const it of cont.items) {
          if (it.k === 'p') { paras++; continue; }
          flush();
          if (it.k === 'h') lines.push('- ' + t('docHeadingNs', { n: it.level }) + ' ' + withheld);
          else lines.push('- ' + tableLine(it.sec));
        }
        flush();
        out.push(lines.join('\n'), '');
      }
    }
    if (cont.cut) out.push('_' + t('docMoreItems', { n: N(cont.cut) }) + '_', '');
    return out.join('\n') + '\n';
  }

  function Builder(lang, overrides) {
    const parts = [];
    const ov = overrides || {};
    return {
      parts,
      lock(s) {
        if (!s) return;
        const last = parts[parts.length - 1];
        if (last && !last.k && !last.mark) last.s += s; else parts.push({ s });
      },
      /* Prompt string by key, with its {placeholders} filled in. */
      say(key, vars) {
        this.lock(rawTp(lang, key).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m)));
      },
      /* Everything written inside fn becomes one editable block; trailing line breaks stay locked. */
      /* base: text set by an admin for this region (replaces the generated text, still editable by the user). */
      region(id, fn, base) {
        const start = parts.length;
        parts.push({ s: '', mark: true });
        fn();
        const text = parts.splice(start).map((p) => p.s).join('');
        const tail = /\n*$/.exec(text)[0];
        const orig = base ? String(base).replace(/\n+$/, '') : text.slice(0, text.length - tail.length);
        parts.push({ k: id, s: Object.prototype.hasOwnProperty.call(ov, id) ? ov[id] : orig, orig });
        this.lock(tail); // same spacing after the region, whether the text is generated or set by an admin
      },
    };
  }
  /* Ids of the free regions, in prompt order. */
  DB.REGIONS = ['intro', 'respond', 'fmt'];

  /*
   * opts: { lang, layout: 'auto'|'table'|'csv', limit: number|null, overrides: { id: text },
   *         mode: 'inline'|'files', sample: rows shown per section in files mode,
   *         displayLimit: max rows rendered per section (formatted view only) }
   * Returns the list of parts.
   */
  DB.buildParts = function (doc, opts) {
    const L = opts.lang;
    const files = opts.mode === 'files';
    const fileNames = files ? DB.dataFileNames(doc) : [];
    const t = (k, v) => DB.tp(L, k, v);
    const nf = new Intl.NumberFormat(DB.locale(L));
    const N = (n) => nf.format(n);
    const views = doc.sections.map((s) => sectionView(s, opts));
    const multi = views.length > 1;
    const b = Builder(L, opts.overrides);
    const say = (key, id, vars) => b.say(key, vars);
    const line = (prefix, key, id, vars) => { b.lock(prefix); say(key, id, vars); b.lock('\n'); };

    const base = opts.base || {};
    // Locked: title. Free: introduction (an admin may provide its own text)
    b.lock('# '); say('title', 'title', { file: doc.fileName }); b.lock('\n\n');
    b.region('intro', () => { say('intro'); }, base.intro);
    b.lock('\n\n');

    // Locked: overview (exact facts about the file)
    line('## ', 'overview');
    b.lock('- **'); say('file'); b.lock(':** ' + code(doc.fileName) + ' · **');
    say('format'); b.lock(':** ' + doc.formatName + ' · **');
    say('size'); b.lock(':** ' + DB.fmtBytes(doc.fileSize) + '\n');
    const totalRows = views.reduce((a, v) => a + v.total, 0);
    if (multi) {
      const sep = doc.sectionKind === 'sheets' ? 'sepSheets' : doc.sectionKind === 'tables' ? 'sepTables' : 'sepRecords';
      b.lock('- **'); say('sections'); b.lock(':** ' + N(views.length) + '. '); say(sep); b.lock('\n');
    }
    b.lock('- **'); say('rows'); b.lock(':** ' + N(totalRows) + '\n');
    for (const [key, value] of doc.fileMeta || []) {
      const v = String(value);
      b.lock('- **'); say(key); b.lock(':**');
      if (v.includes('\n')) b.lock('\n' + v.split('\n').map((l) => '  > ' + l).join('\n') + '\n');
      else b.lock(' ' + v + '\n');
    }
    b.lock('\n');

    // Free: how to respond (an admin may provide its own text)
    b.region('respond', () => {
    line('## ', 'respond');
    if (files) line('\n', 'filesCheck');
    line('\n### ', 'first');
    line('1. ', 'f1');
    line('2. ', 'f2');
    line('   - ', 'f2a');
    line('   - ', 'f2b');
    line('3. ', 'f3');
    line('\n### ', 'next');
    for (const k of ['n1', 'n2', files ? 'n3Files' : 'n3', 'n4']) line('- ', k);
    }, base.respond);
    b.lock('\n'); // blank line between the two regions

    // Free: how this file is formatted (generated for each file)
    b.region('fmt', () => {
    const anyCsv = views.some((v) => v.layout === 'csv' && v.sec.columns.length);
    const anyTable = views.some((v) => v.layout === 'table' && v.sec.columns.length);
    const notes = doc.notes || {};
    line('## ', 'fmt');
    if (files) {
      line('- ', 'fmtFiles');
      line('- ', 'fmtSample', null, { n: opts.sample || 5 });
    } else line('- ', 'fmtLoc');
    if (anyCsv) line('- ', 'fmtCsv');
    if (anyTable) line('- ', 'fmtTable');
    line('- ', 'fmtEmpty');
    if (notes.isoDates) line('- ', 'fmtDates');
    if (notes.flattened || notes.arrays) line('- ', 'fmtFlat');
    if (notes.xmlAttr) line('- ', 'fmtXml');
    if (notes.valueLabels) line('- ', 'fmtLabels');
    const noHeader = views.map((v, i) => (v.sec.noHeader ? i + 1 : 0)).filter(Boolean);
    if (noHeader.length) line('- ', 'fmtNoHeader', null, { list: noHeader.join(', ') });
    if (notes.spans) line('- ', 'fmtSpans');
    if (notes.yamlDocs) line('- ', 'fmtYamlDocs');
    if (notes.nestedSkipped) line('- ', 'fmtNested', null, { n: notes.nestedSkipped });
    if (notes.nbShortened) line('- ', 'nbShortened');
    if (notes.pdfTables) line('- ', 'fmtPdfTables');
    if (notes.pdfNoText) line('- ', 'fmtPdfNoText');
    if (views.some((v) => v.partial)) line('- ', 'fmtPartial');
    if (anyCsv && !files) line('- ', 'fmtCode');
    });
    b.lock('\n'); // the region's own final line break is kept (locked) by region()

    // Locked: the cells of a notebook (its tables are the sections below)
    if (doc.contents) {
      const nb = doc.contents.kind === 'notebook', sl = doc.contents.kind === 'slides', pg = doc.contents.kind === 'pages';
      const name = (k) => (doc.sections[k] ? doc.sections[k].name : '?');
      line('## ', nb ? 'nbTitle' : sl ? 'slidesTitle' : pg ? 'pagesTitle' : 'docTitle'); b.lock('\n'); say(nb ? 'nbIntro' : sl ? 'slidesIntro' : pg ? 'pagesIntro' : 'docIntro'); b.lock('\n\n');
      b.lock(nb ? contentsText(doc.contents, t, N, name, false, true) : docContentsText(doc.contents, t, N, name, false, true));
    }

    // Locked: sections and columns
    if (views.length) { line('## ', 'details'); b.lock('\n'); }
    views.forEach((v, i) => {
      const s = v.sec;
      b.lock('### ' + (i + 1) + '. ' + code(s.name) + '\n');
      if (v.partial) say('secPartial', 'secPartial@' + i, { a: N(v.shown), b: N(v.total), c: N(s.columns.length) });
      else say('secRows', 'secRows@' + i, { n: N(v.total), c: N(s.columns.length) });
      if (s.hidden) { b.lock(' · '); say('hidden', 'hidden@' + i); }
      b.lock('\n');
      if (files) { b.lock('**'); say('file', 'file@' + i); b.lock(':** `' + fileNames[i] + '`\n'); }
      if (s.caption) { b.lock('\n**'); say('caption', 'caption@' + i); b.lock(':** ' + s.caption + '\n'); }
      if (s.description) { b.lock('\n**'); say('tblDescription', 'tblDescription@' + i); b.lock(':** ' + s.description.replace(/\s*\n\s*/g, ' ') + '\n'); }
      b.lock('\n');
      if (s.columns.length) b.lock(columnsTable(s, t) + '\n\n');
      if (s.constraints) b.lock(constraintsText(s.constraints, t));
      if (s.sheetInfo) b.lock(sheetInfoText(s.sheetInfo, t));
      if (s.comments && s.comments.length) {
        b.lock('**'); say('comments', 'comments@' + i); b.lock(':**\n');
        const list = s.comments.slice(0, 200).map((c) => '- `' + c.cell + '`: ' + c.text.replace(/\n/g, ' '));
        if (s.comments.length > 200) list.push('- … (+' + (s.comments.length - 200) + ')');
        b.lock(list.join('\n') + '\n\n');
      }
    });

    // Saved queries (SQL views): their definitions, never their results
    if (doc.views && doc.views.length) {
      line('## ', 'mViews'); b.lock('\n');
      for (const v of doc.views) b.lock('### ' + code(v.name) + '\n\n' + sqlBlock(v.sql) + '\n\n');
    }
    // Triggers: what the database does by itself on a change (their SQL, never run)
    if (doc.triggers && doc.triggers.length) {
      line('## ', 'mTriggers'); b.lock('\n');
      for (const tr of doc.triggers) b.lock('### ' + code(tr.name) + (tr.when || tr.table ? ' · ' + [tr.when, tr.table ? 'ON ' + code(tr.table) : ''].filter(Boolean).join(' ') : '') + '\n\n' + (tr.sql ? sqlBlock(tr.sql) + '\n\n' : ''));
    }

    // Relationships between the sections: declared by the source, inferred candidates (marked as such)
    if (doc.relationships && doc.relationships.length) {
      line('## ', 'relTitle'); b.lock('\n');
      b.lock(relationshipsText(doc.relationships, t));
    }

    // Optional profile of every column (statistics from all the rows)
    if (opts.profile && DB.getProfile) {
      line('## ', 'profTitle'); b.lock('\n'); say('profIntro'); b.lock('\n\n');
      if (DB.getProfile(doc).some((p) => p.partial)) { say(doc.formatKey === 'ipynb' ? 'nbProfPartial' : 'profPartial', null, { n: N(DB.SQL_MAX_ROWS) }); b.lock('\n\n'); }
      b.lock(profileText(DB.getProfile(doc), t));
    }

    // Data
    if (views.length) { line('## ', files ? 'dataSample' : 'data'); b.lock('\n'); }
    views.forEach((v, i) => {
      b.lock('### ' + (i + 1) + '. ' + code(v.sec.name) + '\n\n');
      if (files) { say('sampleOf', 'sampleOf@' + i, { a: N(v.shown), b: N(v.total), file: fileNames[i] }); b.lock('\n\n'); }
      if (v.sec.columns.length) {
        const dn = opts.displayLimit && v.shown > opts.displayLimit ? opts.displayLimit : v.shown;
        b.lock(renderData(v.sec, v.layout, dn) + '\n\n');
        if (dn < v.shown) b.lock('_… (+' + N(v.shown - dn) + ')_\n\n');
      } else { b.lock('_'); say('empty', 'empty@' + i); b.lock('_\n\n'); }
    });
    // Locked: closing line
    b.lock('---\n_'); say('end'); b.lock('_\n');
    return b.parts;
  };

  /* ============================== "Do not share data" ==============================
   * A different prompt with a different purpose: the AI gets a description of the data and helps plan the
   * analysis. Its only input is the copy made by DB.makeNoShareSource (noshare.js), which holds no record.
   * level: 1 structure, 2 + counts, 3 + summaries. sw: what the user allows (see DB.NS_DEFAULTS). */
  DB.NS_DEFAULTS = { names: true, labels: true, rel: true, file: true, text: false, sql: false };
  DB.NS_K = 5;           // category groups smaller than this are hidden (applied when the copy is made, noshare.js)
  DB.NS_MIN_ROWS = 10;   // ranges are hidden for smaller tables (idem)

  function nsSummary(c, small, t) {
    const pct = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '%';
    const num = (x) => String(Number(Number(x).toPrecision(6)));
    if (c.note) return c.note === 'nsRangeSmall' ? t('nsRangeSmall', { n: DB.NS_MIN_ROWS }) : t(c.note);
    const s = c.summary;
    if (!s) return '';
    if (s.top) { // small groups were already removed from the copy; checked again here
      const kept = s.top.filter((x) => x.count >= DB.NS_K);
      const hidden = c.n - c.missing - kept.reduce((a, x) => a + x.count, 0);
      const parts = kept.map((x) => x.value + ': ' + x.count + ' (' + pct(x.pct) + ')');
      if (hidden > 0) parts.push(t('nsOtherSmall') + ': ' + hidden);
      return parts.join(' · ');
    }
    if (small) return t('nsRangeSmall', { n: DB.NS_MIN_ROWS });
    if (s.mean !== undefined) {
      return [[t('statMin'), num(s.min)], [t('statMax'), num(s.max)], [t('statMean'), num(s.mean)], [t('statSd'), num(s.sd)],
        [t('statMedian'), num(s.median)], [t('statOutliers'), s.outliers]].map(([k, v]) => k + ': ' + v).join(' · ');
    }
    return t('statMin') + ': ' + s.min + ' · ' + t('statMax') + ': ' + s.max;
  }

  /* The names "Do not share data" shows (the prompt, and the command-line tool for anything else it shows): neutral names when
   * the real ones are not to be shared, and for names that may be data themselves: a guessed header over all-text columns
   * (maybe the first record), keys of JSON / XML / YAML that look like values (an e-mail, a number, an identifier, a date), a
   * section named after the file, a table named by its caption. (GeoJSON properties are flattened JSON; notebook column names
   * come from pivots and crosstabs, often values.) sw: the switches, already merged with DB.NS_DEFAULTS.
   * -> { secMap: real section name -> shown, colMap: section \u0001 column -> shown, replacedAsData } */
  DB.noShareNames = function (ns, sw, L) {
    const TREE = ['json', 'ndjson', 'yaml', 'xml', 'geojson', 'ipynb'].includes(ns.formatKey);
    const looksLikeValue = (seg) => /@|^\d+$|^[0-9a-f]{8}-[0-9a-f]{4}-|^\d{4}-\d{2}-\d{2}/i.test(seg) || seg.length > 40;
    let replacedAsData = false;
    const secMap = new Map(), colMap = new Map();
    ns.sections.forEach((s, i) => {
      let name = s.name;
      if (!sw.names || (s.nameIsText && !sw.labels)) name = 'table_' + (i + 1);
      else if (s.fromFile && !sw.file) name = DB.tp(L, 'nsDataset') + (ns.sections.length > 1 ? '_' + (i + 1) : '');
      else if (TREE && name.split('.').some(looksLikeValue)) { name = name.split('.').map((x) => (looksLikeValue(x) ? 'key' : x)).join('.'); replacedAsData = true; }
      secMap.set(s.name, name);
      s.columns.forEach((c, j) => {
        let col = c.name;
        if (!sw.names) col = 'column_' + (j + 1);
        else if (s.headerWeak) { col = 'column_' + (j + 1); replacedAsData = true; }
        else if (TREE && col.split('.').some(looksLikeValue)) { col = col.split('.').map((x) => (looksLikeValue(x) ? 'key' : x)).join('.'); replacedAsData = true; }
        colMap.set(s.name + '\u0001' + c.name, col);
      });
    });
    return { secMap, colMap, replacedAsData };
  };

  DB.buildNoShareParts = function (ns, opts) {
    const L = opts.lang;
    const t = (k, v) => DB.tp(L, k, v);
    const nf = new Intl.NumberFormat(DB.locale(L));
    const N = (n) => nf.format(n);
    const level = [1, 2, 3].includes(opts.level) ? opts.level : 1;
    const sw = Object.assign({}, DB.NS_DEFAULTS, opts.sw || {});
    if (!sw.names) sw.sql = false; // SQL definitions spell the real names out
    const b = Builder(L, opts.overrides);
    const say = (key, vars) => b.say(key, vars);
    const line = (prefix, key, vars) => { b.lock(prefix); say(key, vars); b.lock('\n'); };

    const names = DB.noShareNames(ns, sw, L);
    const secMap = names.secMap, colMap = names.colMap;
    const replacedAsData = names.replacedAsData;
    const S = (n) => (secMap.has(n) ? secMap.get(n) : sw.names ? n : '?');
    const C = (sec, col) => { const k = sec + '\u0001' + col; return colMap.has(k) ? colMap.get(k) : sw.names ? col : '?'; };

    // Title, introduction (free text), and the constraint the AI must respect (locked)
    const ext = (/\.([^.]+)$/.exec(ns.fileName || '') || [])[1];
    const fileLabel = sw.file ? ns.fileName : t('nsDataset') + (ext ? '.' + ext : '');
    b.lock('# '); say('nsTitle', { file: fileLabel }); b.lock('\n\n');
    b.region('nsIntro', () => { say('nsIntro'); });
    b.lock('\n\n');
    line('## ', 'nsConstraintTitle');
    for (const k of ['nsC1', 'nsC2', 'nsC3']) line('- ', k);
    b.lock('\n');

    // Overview
    line('## ', 'overview');
    b.lock('- **'); say('file'); b.lock(':** ' + code(fileLabel) + ' · **');
    say('format'); b.lock(':** ' + ns.formatName + ' · **');
    say('size'); b.lock(':** ' + DB.fmtBytes(ns.fileSize) + '\n');
    if (ns.sections.length > 1) {
      const sep = ns.sectionKind === 'sheets' ? 'sepSheets' : ns.sectionKind === 'tables' ? 'sepTables' : 'sepRecords';
      b.lock('- **'); say('sections'); b.lock(':** ' + N(ns.sections.length) + '. '); say(sep); b.lock('\n');
    }
    b.lock('- **'); say('rows'); b.lock(':** ' + N(ns.sections.reduce((a, s) => a + s.rows, 0)) + '\n');
    b.lock('- **'); say('nsLevelLabel'); b.lock(':** '); say('nsL' + level); b.lock('\n');
    for (const m of ns.fileMeta) {
      if (m.data || (m.freeText && !sw.text) || (m.names && !sw.names) || (m.files && !sw.file) || m.key === 'mViews') continue;
      b.lock('- **'); say(m.key); b.lock(':**');
      if (m.value.includes('\n')) b.lock('\n' + m.value.split('\n').map((l) => '  > ' + l).join('\n') + '\n');
      else b.lock(' ' + m.value + '\n');
    }
    b.lock('\n');

    // A notebook: which cell made which table; no code and no output, the Markdown only when free text is allowed
    if (ns.contents) {
      const nb = ns.contents.kind === 'notebook', sl = ns.contents.kind === 'slides', pg = ns.contents.kind === 'pages';
      const name = (k) => (ns.sections[k] ? S(ns.sections[k].name) : '?');
      line('## ', nb ? 'nbTitle' : sl ? 'slidesTitle' : pg ? 'pagesTitle' : 'docTitle'); b.lock('\n'); say(nb ? 'nbIntroNs' : sl ? 'slidesIntroNs' : pg ? 'pagesIntroNs' : 'docIntroNs'); b.lock('\n\n');
      b.lock(nb ? contentsText(ns.contents, t, N, name, true, sw.text) : docContentsText(ns.contents, t, N, name, true, sw.text));
    }

    // Sections and columns: structure only
    if (ns.sections.length) { line('## ', 'details'); b.lock('\n'); }
    ns.sections.forEach((s, i) => {
      b.lock('### ' + (i + 1) + '. ' + code(S(s.name)) + '\n');
      say('secRows', { n: N(s.rows), c: N(s.columns.length) });
      if (s.hidden) { b.lock(' · '); say('hidden'); }
      b.lock('\n');
      if (s.caption && sw.labels && sw.names) { b.lock('\n**'); say('caption'); b.lock(':** ' + s.caption + '\n'); }
      // A table comment is free text written by people (like a file label): only when the user allows free text
      if (s.description && sw.text) { b.lock('\n**'); say('tblDescription'); b.lock(':** ' + s.description.replace(/\s*\n\s*/g, ' ') + '\n'); }
      b.lock('\n');
      if (s.columns.length) {
        const cols = s.columns.map((c) => {
          const meta = {};
          for (const [k, v] of Object.entries(c.meta)) if (sw.labels || (k !== 'label' && k !== 'values')) meta[k] = v;
          // Struct field names are names too: when names are not shared, the type without them is used
          for (const k of ['parquetType', 'avroType', 'arrowType']) {
            if (!sw.names && meta[k + 'Anon']) meta[k] = meta[k + 'Anon'];
            delete meta[k + 'Anon'];
          }
          // A type name chosen by people (a PostgreSQL enum or domain) is a name: replaced when names are not shared
          if (!sw.names && meta.sqlTypeAnon) meta.sqlType = meta.sqlTypeAnon;
          delete meta.sqlTypeAnon;
          if (c.keyInfo) {
            meta.key = [c.keyInfo.pk ? { key: 'pk' } : null]
              .concat(c.keyInfo.refs.map((r) => '→ `' + S(r.table) + '.' + (r.col ? C(r.table, r.col) : '?') + '`')).filter(Boolean);
          }
          return { name: C(s.name, c.name), type: c.type, meta };
        });
        b.lock(columnsTable({ columns: cols }, t) + '\n\n');
      }
      if (s.constraints) {
        const c = s.constraints;
        const ixCols = (cols) => cols.map((x) => (x === '<expression>' ? x : C(s.name, x)));
        b.lock(constraintsText({
          pk: c.pk.map((x) => C(s.name, x)),
          fks: c.fks.map((f) => ({ table: S(f.table), from: f.from.map((x) => C(s.name, x)), to: f.to.map((x) => (x ? C(f.table, x) : '?')), onDelete: f.onDelete, onUpdate: f.onUpdate })),
          unique: c.unique.map((u) => ({ name: sw.names ? u.name : '', cols: ixCols(u.cols) })),
          indexes: c.indexes.map((u) => ({ name: sw.names ? u.name : '', cols: ixCols(u.cols) })),
          ddl: sw.sql ? c.ddl : '',
        }, t));
      }
      if (s.sheetInfo) b.lock(sheetInfoText(s.sheetInfo, t));
      if (sw.text && s.comments.length) {
        b.lock('**'); say('comments'); b.lock(':**\n');
        const list = s.comments.slice(0, 200).map((c) => '- `' + c.cell + '`: ' + c.text.replace(/\n/g, ' '));
        if (s.comments.length > 200) list.push('- … (+' + (s.comments.length - 200) + ')');
        b.lock(list.join('\n') + '\n\n');
      }
    });

    // Saved queries: names, and their SQL only when allowed
    if (ns.views.length) {
      line('## ', 'mViews'); b.lock('\n');
      ns.views.forEach((v, i) => {
        const name = code(sw.names ? v.name : 'view_' + (i + 1));
        b.lock(sw.sql ? '### ' + name + '\n\n' + sqlBlock(v.sql) + '\n\n' : '- ' + name + '\n');
      });
      if (!sw.sql) b.lock('\n');
    }
    // Triggers: names (or neutral ones), when they run and on which table; their SQL only when allowed
    if (ns.triggers && ns.triggers.length) {
      line('## ', 'mTriggers'); b.lock('\n');
      ns.triggers.forEach((tr, i) => {
        const head = code(sw.names ? tr.name : 'trigger_' + (i + 1)) + (tr.when || tr.table ? ' · ' + [tr.when, tr.table ? 'ON ' + code(S(tr.table)) : ''].filter(Boolean).join(' ') : '');
        b.lock(sw.sql && tr.sql ? '### ' + head + '\n\n' + sqlBlock(tr.sql) + '\n\n' : '- ' + head + '\n');
      });
      if (!sw.sql) b.lock('\n');
    }

    // Relationships (names replaced if needed; value-overlap ratios only at level 3)
    if (sw.rel && ns.relationships.length) {
      const rels = ns.relationships.map((r) => Object.assign({}, r, {
        from: { section: S(r.from.section), columns: r.from.columns.map((x) => (x === '?' ? x : C(r.from.section, x))) },
        to: { section: S(r.to.section), columns: r.to.columns.map((x) => (x === '?' ? x : C(r.to.section, x))) },
        via: r.via ? S(r.via) : r.via,
        evidence: r.evidence ? r.evidence.filter((e) => level >= 3 || typeof e === 'string') : r.evidence,
      }));
      line('## ', 'relTitle'); b.lock('\n');
      b.lock(relationshipsText(rels, t));
    }

    // Statistics: counts at level 2, summaries at level 3 (small groups and small tables hidden)
    if (level >= 2) {
      line('## ', 'nsContextTitle'); b.lock('\n'); say(level >= 3 ? 'nsContextL3' : 'nsContextL2'); b.lock('\n\n');
      if (ns.sections.some((s) => s.profile && s.profile.partial)) { say(ns.formatKey === 'ipynb' ? 'nbProfPartial' : 'profPartial', { n: N(DB.SQL_MAX_ROWS) }); b.lock('\n\n'); }
      const KIND = { identifier: 'kindIdentifier', categorical: 'kindCategorical', continuous: 'kindContinuous', datetime: 'kindDatetime',
        text: 'kindText', empty: 'kindEmpty', mixed: 'kindMixed' };
      const pct = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '%';
      const head = [t('cName'), t('profKind'), t('profMissing'), t('profDistinct')].concat(level >= 3 ? [t('profSummary')] : []);
      ns.sections.forEach((s, i) => {
        const p = s.profile;
        if (!p || !p.columns.length) return;
        const rows = p.columns.map((c) => {
          const cells = [code(C(s.name, c.name)), t(KIND[c.kind]), c.missing ? c.missing + ' (' + pct((c.missing / c.n) * 100) + ')' : '0',
            c.kind === 'categorical' ? String(c.distinct) : '']; // distinct counts: categorical columns only
          if (level >= 3) cells.push(nsSummary(c, c.n - c.missing < DB.NS_MIN_ROWS, t)); // few values: no range
          return cells;
        });
        let out = '### ' + (i + 1) + '. ' + code(S(s.name)) + '\n\n' +
          ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'].concat(rows.map((r) => '| ' + r.map(cellMd).join(' | ') + ' |')).join('\n') + '\n\n';
        if (p.duplicateRows) out += '**' + t('profDup') + ':** ' + p.duplicateRows + '\n\n';
        if (p.constantColumns.length) out += '**' + t('profConst') + ':** ' + p.constantColumns.map((x) => code(C(s.name, x))).join(', ') + '\n\n';
        b.lock(out);
      });
    }

    // What the AI does not have (locked: generated from the choices above)
    line('## ', 'nsMissingTitle'); say('nsMissingIntro'); b.lock('\n\n');
    const missing = ['nsMRecords'];
    if (level < 2) missing.push('nsMCounts');
    if (level < 3) missing.push('nsMSummaries');
    if (!sw.names) missing.push('nsMNames');
    else if (replacedAsData) missing.push('nsMNamesData');
    if (level < 2 && sw.rel && ns.hadInferred) missing.push('nsMInferred');
    if (!sw.labels && ns.hasLabels) missing.push('nsMLabels');
    if (!sw.rel && ns.relationships.length) missing.push('nsMRel');
    if (!sw.sql && ns.hasSql) missing.push('nsMSql');
    if (!sw.text && ns.hasFreeText) missing.push('nsMText');
    if (ns.contents && ns.contents.kind === 'notebook') missing.push('nbMCode');
    for (const k of missing) line('- ', k);
    b.lock('\n');

    // What is asked of the AI (free text)
    b.region('nsRespond', () => {
      line('## ', 'nsRespondTitle');
      line('\n### ', 'first');
      line('1. ', 'nsF1');
      line('2. ', 'nsF2');
      line('\n### ', 'next');
      for (const k of ['nsN1', 'nsN2', 'nsN3', 'nsN4', 'nsN5']) line('- ', k);
    });
    b.lock('\n');
    b.lock('---\n_'); say('nsEnd'); b.lock('_\n');
    return b.parts;
  };

  DB.joinParts = (parts) => parts.map((p) => p.s).join('');

  /* Generated text of a free region that does not depend on the file (intro, respond). Used by the settings page. */
  DB.generatedText = function (lang, mode, id) {
    const doc = { fileName: 'data.csv', fileSize: 0, formatName: 'CSV', sections: [], fileMeta: [], notes: {}, sectionKind: 'records' };
    const p = DB.buildParts(doc, { lang, mode, layout: 'auto', sample: 5 }).find((x) => x.k === id);
    return p ? p.orig : '';
  };
  DB.buildMarkdown = (doc, opts) => DB.joinParts(DB.buildParts(doc, opts));

  /* Largest "nice" N rows per section that keeps the estimate under the budget. */
  DB.suggestLimit = function (doc, opts, budget) {
    const base = DB.estimateTokens(DB.buildMarkdown(doc, Object.assign({}, opts, { limit: 1 })));
    const perRow = doc.sections.map((s) => {
      if (s.rows.length < 2) return 0;
      const sampleN = Math.min(s.rows.length, 2000);
      return DB.estimateTokens(DB.toCsv(s, sampleN)) / (sampleN + 1);
    });
    const cost = (n) => base + doc.sections.reduce((a, s, i) => a + perRow[i] * Math.max(0, Math.min(n, s.rows.length) - 1), 0);
    const maxRows = Math.max(1, ...doc.sections.map((s) => s.rows.length));
    let lo = 1, hi = maxRows;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (cost(mid) <= budget) lo = mid; else hi = mid - 1; }
    if (lo >= 100) { const p = Math.pow(10, Math.floor(Math.log10(lo)) - 1); lo = Math.floor(lo / p) * p; }
    return Math.max(1, lo);
  };
})();
