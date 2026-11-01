/* DataBrief - "Do not share data": the description of a file without any of its records. GPL-3.0-or-later.
 *
 * DB.makeNoShareSource(doc) copies out of a parsed file ONLY what the no-share prompt may ever use:
 * structure (sections, columns, types, metadata, keys, constraints), relationships, and the aggregates of the
 * profile. It copies no row, no sample and no cell value. The no-share prompt (DB.buildNoShareParts in
 * markdown.js) receives this copy and nothing else, so it cannot write a record even by mistake.
 * The page drops the parsed rows once this copy exists (app.js).
 *
 * What is shown, and when, is decided by the builder: level 1 structure, level 2 + counts, level 3 + summaries,
 * and the user's switches (names, labels, relationships, file name, free text, SQL definitions). */
'use strict';
(function () {
  const DB = window.DB;
  // File metadata that is free text written by people (it may hold anything): shown only when the user allows it.
  const FREE_TEXT_META = new Set(['mFileLabel', 'mDocs', 'mEmbedded']);
  // File metadata made of names (tables, views, sheets, variables): hidden when names are replaced.
  const NAME_META = new Set(['mViews', 'mSkipped', 'mNames', 'mRoot', 'mWeight']);
  const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  /* The profile of a section, with the protections applied BEFORE anything is kept: category groups smaller than
   * DB.NS_K are dropped (only their total count is kept), and ranges of tables smaller than DB.NS_MIN_ROWS are
   * dropped. So a rare category or an extreme value of a tiny table never exists in the no-share state at all. */
  function safeProfile(p) {
    if (!p) return null;
    const out = copy(p);
    const small = out.rows < DB.NS_MIN_ROWS;
    for (const c of out.columns) {
      const s = c.summary;
      if (!s) continue;
      if (s.top) {
        const kept = s.top.filter((x) => x.count >= DB.NS_K);
        c.summary = { top: kept, hiddenCount: c.n - c.missing - kept.reduce((a, x) => a + x.count, 0) };
      } else if (small) {
        c.summary = null;
        c.note = 'nsRangeSmall';
      }
    }
    return out;
  }

  DB.makeNoShareSource = function (doc) {
    const profile = DB.getProfile ? DB.getProfile(doc) : null;
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
        name: s.name, rows: s.rows.length, hidden: !!s.hidden, caption: s.caption || '', columns,
        constraints: copy(c),
        // Formula texts are left out: a formula can contain literal values (=IF(A2="Smith";...)).
        sheetInfo: si ? { merges: si.merges.slice(), hiddenRows: si.hiddenRows.slice(), hiddenCols: si.hiddenCols.slice(),
          formulas: { count: si.formulas.count, noResult: si.formulas.noResult, examples: [] } } : null,
        comments: (s.comments || []).map((x) => ({ cell: x.cell, text: x.text })),
        profile: profile ? safeProfile(profile[i]) : null,
      };
    });
    const views = (doc.views || []).map((v) => ({ name: v.name, sql: v.sql }));
    const fileMeta = (doc.fileMeta || []).map(([key, value]) => ({ key, value: String(value), freeText: FREE_TEXT_META.has(key), names: NAME_META.has(key) }));
    return {
      fileName: doc.fileName, fileSize: doc.fileSize, formatName: doc.formatName, formatKey: doc.formatKey, sectionKind: doc.sectionKind,
      sections, views, fileMeta, relationships: copy(doc.relationships || []),
      hasLabels: sections.some((s) => s.caption || s.columns.some((c) => c.meta.label || c.meta.values)),
      hasSql: views.length > 0 || sections.some((s) => s.constraints && s.constraints.ddl),
      hasFreeText: sections.some((s) => s.comments.length) || fileMeta.some((m) => m.freeText),
    };
  };
})();
