/* DataBrief - "Do not share data": the description of a file without any of its records. GPL-3.0-or-later.
 *
 * DB.makeNoShareSource(doc, level) copies out of a parsed file ONLY what the no-share prompt may use AT THAT LEVEL:
 *   level 1: structure (sections, columns, types, metadata, keys, constraints) and declared relationships;
 *   level 2: + counts (missing, distinct, kind of column, duplicates) and inferred relationships (without ratios);
 *   level 3: + aggregate summaries, with the protections applied here, before anything is kept:
 *            category groups under DB.NS_K records hidden, plus one more group when a single hidden group could be
 *            worked out by subtraction; ranges hidden for columns with fewer than DB.NS_MIN_ROWS values.
 * It copies no row, no sample and no cell value. The no-share prompt (DB.buildNoShareParts in markdown.js) receives
 * this copy and nothing else. The page drops the parsed rows once this copy exists (app.js); going up a level reads
 * the file again, going down removes what the lower level must not hold (DB.restrictNoShare). */
'use strict';
(function () {
  const DB = window.DB;
  // File metadata that is free text written by people (it may hold anything): shown only when the user allows it.
  const FREE_TEXT_META = new Set(['mFileLabel', 'mDocs', 'mEmbedded', 'mDocTitle', 'mDocSubject', 'mDocAuthor', 'mDocLastAuthor', 'mDocKeywords', 'mDocDescription']);
  // File metadata made of names: hidden when names are replaced. Embedded pandas / Spark metadata lists the columns.
  const FILE_META = new Set(['mExternal']);
  // Facts computed from the records (where the data lies, how many features of each kind): never in "Do not share data"
  const DATA_META = new Set(['mExtent', 'mGeomTypes']);   // names of other files (COPY FROM a file, linked tables): hidden with the file name too
  const NAME_META = new Set(['mViews', 'mSkipped', 'mNames', 'mRoot', 'mWeight', 'mEmbedded', 'mExternal', 'mMemo', 'mAvroRecord']);
  const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const baseOf = (name) => (name || 'data').replace(/\.[^.]+$/, '') || 'data';
  // Excel defined names: keep only references to cells ("Sheet!$A$1:$B$9"), not constants (="Smith" is a value).
  const keepRanges = (v) => v.split('; ').filter((e) => /→ `[^`]*(![^`]*|\$[A-Z]+\$?\d+[^`]*)`$/.test(e)).join('; ');

  function profileFor(p, level) {
    if (!p || level < 2) return null;
    const out = copy(p);
    for (const c of out.columns) {
      const s = c.summary;
      if (level < 3) { c.summary = null; continue; }
      if (!s) continue;
      const m = c.n - c.missing;
      if (s.top) {
        let kept = s.top.filter((x) => x.count >= DB.NS_K);
        // A single hidden group can be worked out (non-missing values minus the groups shown): hide one more.
        if (s.top.length - kept.length === 1 && kept.length) kept = kept.slice(0, -1);
        c.summary = { top: kept, hiddenCount: m - kept.reduce((a, x) => a + x.count, 0) };
      } else if (m < DB.NS_MIN_ROWS) {
        c.summary = null; // a range of a few values shows those values
        c.note = 'nsRangeSmall';
      }
    }
    return out;
  }
  // Declared relationships at every level; inferred ones (computed from the values) from level 2, their ratios at 3.
  const relationshipsFor = (rels, level) => copy(rels || []).filter((r) => r.source === 'declared' || level >= 2)
    .map((r) => { if (r.evidence && level < 3) r.evidence = r.evidence.filter((e) => typeof e === 'string'); return r; });

  DB.makeNoShareSource = function (doc, level) {
    level = [1, 2, 3].includes(level) ? level : 1;
    const profile = level >= 2 && DB.getProfile ? DB.getProfile(doc) : null;
    const fileBase = baseOf(doc.fileName), innerBase = baseOf(String(doc.fileName || '').replace(/.(gz|gzip)$/i, '')); // data.csv.gz: the section is "data"
    const sections = doc.sections.map((s, i) => {
      const c = s.constraints || null;
      const columns = s.columns.map((col) => {
        const meta = {};
        // "key" holds ready-made text with table names in it: rebuilt from keyInfo, so names can be replaced.
        for (const [k, v] of Object.entries(col.meta || {})) if (k !== 'key') meta[k] = copy(v);
        let keyInfo = null;
        if (c) {
          const refs = [];
          for (const f of c.fks) { const ix = f.from.indexOf(col.name); if (ix >= 0) refs.push({ table: f.table, col: f.to[ix] || null }); }
          const pk = c.pk.includes(col.name);
          if (pk || refs.length) keyInfo = { pk, refs };
        }
        return { name: col.name, type: col.type, meta, keyInfo };
      });
      const si = s.sheetInfo;
      return {
        name: s.name, rows: s.totalRows || s.rows.length, hidden: !!s.hidden, caption: s.caption || '', description: s.description || '', columns,
        fromFile: s.name === fileBase || s.name === innerBase,                                   // a section named after the file
        nameIsText: ['caption', 'label', 'summary'].includes(s.nameFrom), // an HTML table named by its caption
        headerWeak: !!s.headerWeak,                                      // the column names may be the first record
        constraints: copy(c),
        // Formula texts are left out: a formula can contain literal values (=IF(A2="Smith";...)).
        sheetInfo: si ? { merges: si.merges.slice(), hiddenRows: si.hiddenRows.slice(), hiddenCols: si.hiddenCols.slice(),
          formulas: { count: si.formulas.count, noResult: si.formulas.noResult, examples: [] } } : null,
        comments: (s.comments || []).map((x) => ({ cell: x.cell, text: x.text })),
        profile: profile ? profileFor(profile[i], level) : null,
      };
    });
    const views = (doc.views || []).map((v) => ({ name: v.name, sql: v.sql }));
    // A notebook: the kind of each cell and of each output, which section a table became. Code and outputs (printed text,
    // values, error messages) can hold records: never copied. Markdown and raw cells are free text (shown only when allowed).
    // An error keeps its class name only when it is one (ZeroDivisionError), never its message.
    const nb = doc.contents && doc.contents.kind === 'notebook' ? doc.contents : null;
    const contents = nb ? {
      kind: 'notebook', language: nb.language, counts: copy(nb.counts), cellsCut: nb.cellsCut, maxTables: nb.maxTables,
      cells: nb.cells.map((c) => ({
        n: c.n, type: c.type, exec: c.exec, source: c.type === 'code' ? null : c.source, more: c.type === 'code' ? 0 : c.more,
        outputs: c.outputs.map((o) => (o.kind === 'table' ? { kind: 'table', sec: o.sec, colsCut: copy(o.colsCut) }
          : o.kind === 'error' ? { kind: 'error', ename: /^[A-Za-z_][\w.]{0,80}$/.test(o.ename) ? o.ename : '' }
            : o.kind === 'image' || o.kind === 'other' ? { kind: o.kind, mime: o.mime }
              : { kind: o.kind, stderr: !!o.stderr })),
      })),
    } : doc.contents && (doc.contents.kind === 'document' || doc.contents.kind === 'slides') ? copy(doc.contents) : null;
    // A document or a presentation (office.js): its text is free text written by people. It is kept in this copy and shown
    // only when the user allows free text (markdown.js docContentsText); otherwise only its outline (kinds and tables).
    const docText = !!(contents && contents.kind !== 'notebook' && contents.items.some((it) => (it.k === 'slide' ? it.title || it.text.length || it.notes : it.k !== 'table' && it.text)));
    const fileMeta = (doc.fileMeta || [])
      .map(([key, value]) => ({ key, value: key === 'mNames' ? keepRanges(String(value)) : String(value), freeText: FREE_TEXT_META.has(key), names: NAME_META.has(key), files: FILE_META.has(key), data: DATA_META.has(key) }))
      .filter((m) => m.value !== '');
    return {
      level, fileName: doc.fileName, fileSize: doc.fileSize, formatName: doc.formatName, formatKey: doc.formatKey, sectionKind: doc.sectionKind,
      sections, views, fileMeta, contents, relationships: relationshipsFor(doc.relationships, level),
      hadInferred: (doc.relationships || []).some((r) => r.source === 'inferred'),
      hasLabels: sections.some((s) => s.caption || s.columns.some((c) => c.meta.label || c.meta.values)),
      hasSql: views.length > 0 || sections.some((s) => s.constraints && s.constraints.ddl),
      hasFreeText: sections.some((s) => s.comments.length || s.description) || fileMeta.some((m) => m.freeText) ||
        !!(contents && contents.kind === 'notebook' && contents.cells.some((c) => c.type !== 'code' && c.source)) || docText,
    };
  };

  /* Going down a level: remove from the copy what the lower level must not hold. (Going up needs the file again.) */
  DB.restrictNoShare = function (ns, level) {
    if (level >= ns.level) return ns;
    for (const s of ns.sections) {
      if (!s.profile) continue;
      if (level < 2) s.profile = null;
      else for (const c of s.profile.columns) c.summary = null;
    }
    ns.relationships = relationshipsFor(ns.relationships, level);
    ns.level = level;
    return ns;
  };
})();
