/* DataBrief - relationships between sections (tables, sheets). GPL-3.0-or-later.
 *
 * doc.relationships = [{ from: { section, columns }, to: { section, columns },
 *   cardinality: 'one_to_one' | 'many_to_one' | 'many_to_many', source: 'declared' | 'inferred',
 *   onDelete?, onUpdate?, via? (junction table), confidence?: 'high' | 'medium' | 'low', evidence?: [key | { key, pct }] }]
 *
 * Declared: written in the source (SQLite foreign keys), never changed here.
 * Inferred: a candidate only when the column names correspond AND (when the sizes allow) the values agree.
 * A name alone is never more than "low". Only ratios are reported, never values. */
'use strict';
(function () {
  const DB = window.DB;
  const MAX_ROWS = 200000;   // larger sections are not compared value by value
  const MAX_SECTIONS = 40;
  // Names too common to say anything on their own (every table has an "id" or a "name").
  const GENERIC = new Set(['id', 'name', 'value', 'code', 'key', 'type', 'status', 'date', 'description', 'label', 'title', 'number', 'no', 'nr',
    'created', 'updated', 'email', 'comment', 'notes', 'note', 'text', 'data', 'index', 'count', 'total', 'amount', 'price', 'day', 'year']);
  const SUFFIXES = ['id', 'key', 'code', 'no', 'nr', 'number', 'ref', 'fk'];

  const norm = (s) => String(s).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const singular = (s) => {
    if (s.length > 4 && /ies$/.test(s)) return s.slice(0, -3) + 'y';
    if (/(sses|xes|ches|shes)$/.test(s)) return s.slice(0, -2);
    if (s.length > 3 && /s$/.test(s) && !/ss$/.test(s)) return s.slice(0, -1);
    return s;
  };

  /* 2: "customer_id" points to the table "customers" (column id, customer_id or customer); 1: same name that is not generic; 0: nothing. */
  function nameScore(childCol, parentSec, parentCol) {
    const cn = norm(childCol), pn = norm(parentCol), sn = norm(parentSec.name);
    if (!cn || !pn) return 0;
    for (const suf of SUFFIXES) {
      if (cn.length > suf.length && cn.endsWith(suf)) {
        const stem = cn.slice(0, -suf.length);
        if (stem && (stem === sn || stem === singular(sn)) && (pn === suf || pn === cn || pn === stem)) return 2;
      }
    }
    return cn === pn && !GENERIC.has(cn) ? 1 : 0;
  }

  /* Non-empty values of a column: how many, the distinct ones, and whether they are all different. */
  const cache = new WeakMap();
  function stats(sec, j) {
    let cols = cache.get(sec);
    if (!cols) { cols = []; cache.set(sec, cols); }
    if (cols[j]) return cols[j];
    const set = new Set();
    let nonEmpty = 0;
    for (const r of sec.rows) {
      const v = r[j];
      if (v === '' || v == null) continue;
      const t = v.trim();
      if (!t) continue;
      nonEmpty++;
      set.add(t);
    }
    cols[j] = { nonEmpty, set, unique: nonEmpty > 0 && set.size === nonEmpty };
    return cols[j];
  }

  /* Relationships written in the source: foreign keys, with their cardinality, and junction tables (many to many). */
  function declared(doc) {
    const rels = [];
    for (const s of doc.sections) {
      const c = s.constraints;
      if (!c || !c.fks) continue;
      for (const f of c.fks) {
        const covers = (cols) => cols.length === f.from.length && f.from.every((x) => cols.includes(x));
        const one = covers(c.pk || []) || (c.unique || []).some((u) => covers(u.cols));
        rels.push({
          from: { section: s.name, columns: f.from.slice() }, to: { section: f.table, columns: f.to.map((x) => x || '?') },
          cardinality: one ? 'one_to_one' : 'many_to_one', source: 'declared', onDelete: f.onDelete, onUpdate: f.onUpdate,
        });
      }
    }
    // A table whose primary key is made of foreign-key columns links its two parents: many to many.
    for (const s of doc.sections) {
      const c = s.constraints;
      if (!c || !c.fks || c.fks.length < 2 || !c.pk || !c.pk.length) continue;
      const fkCols = new Set(c.fks.flatMap((f) => f.from));
      if (!c.pk.every((x) => fkCols.has(x))) continue;
      const [a, b] = c.fks;
      rels.push({
        from: { section: a.table, columns: a.to.map((x) => x || '?') }, to: { section: b.table, columns: b.to.map((x) => x || '?') },
        cardinality: 'many_to_many', source: 'declared', via: s.name,
      });
    }
    return rels;
  }

  const compatible = (a, b) => (a === 'integer' && b === 'integer') || (a === 'text' && b === 'text');
  const RANK = { high: 3, medium: 2, low: 1 };

  /* Candidates for sections without declared relationships (spreadsheets, CSV, Parquet...). */
  function inferred(doc, declaredRels) {
    const secs = doc.sections.filter((s) => s.rows.length && s.columns.length);
    if (secs.length < 2 || secs.length > MAX_SECTIONS) return [];
    const declaredCols = new Set();
    for (const r of declaredRels) for (const c of r.from.columns) declaredCols.add(r.from.section + '\u0001' + c);

    const best = new Map(); // the best parent of each child column
    secs.forEach((A, ai) => {
      A.columns.forEach((cA, i) => {
        if (declaredCols.has(A.name + '\u0001' + cA.name)) return;
        if (cA.type !== 'integer' && cA.type !== 'text') return;
        for (const B of secs) {
          if (B === A) continue;
          B.columns.forEach((cB, j) => {
            if (!compatible(cA.type, cB.type)) return;
            const ns = nameScore(cA.name, B, cB.name);
            if (!ns) return;
            let overlap = null, childUnique = false;
            if (A.rows.length <= MAX_ROWS && B.rows.length <= MAX_ROWS) {
              const sp = stats(B, j), sc = stats(A, i);
              if (!sp.unique || sp.nonEmpty < 2 || !sc.nonEmpty) return;           // a parent column holds each value once
              let hit = 0;
              for (const v of sc.set) if (sp.set.has(v)) hit++;
              overlap = hit / sc.set.size;
              childUnique = sc.unique;
              if (overlap < 0.5) return;                                            // the values do not agree: no candidate
            }
            const confidence = overlap == null ? 'low' : overlap >= 0.95 ? 'high' : 'medium';
            const cand = { ai, i, A, B, cA, cB, ns, overlap, childUnique, confidence };
            const key = A.name + '\u0001' + i;
            const cur = best.get(key);
            const better = !cur || RANK[confidence] > RANK[cur.confidence] ||
              (RANK[confidence] === RANK[cur.confidence] && (ns > cur.ns || (ns === cur.ns && (overlap || 0) > (cur.overlap || 0))));
            if (better) best.set(key, cand);
          });
        }
      });
    });

    const list = Array.from(best.values()).sort((x, y) => RANK[y.confidence] - RANK[x.confidence] || x.ai - y.ai || x.i - y.i);
    const seen = new Set();
    const out = [];
    for (const c of list) {
      const fwd = c.A.name + '\u0001' + c.cA.name + '\u0001' + c.B.name + '\u0001' + c.cB.name;
      const back = c.B.name + '\u0001' + c.cB.name + '\u0001' + c.A.name + '\u0001' + c.cA.name;
      if (seen.has(back)) continue; // the same link seen from the other side
      seen.add(fwd);
      out.push({
        from: { section: c.A.name, columns: [c.cA.name] }, to: { section: c.B.name, columns: [c.cB.name] },
        cardinality: c.childUnique ? 'one_to_one' : 'many_to_one', source: 'inferred', confidence: c.confidence,
        evidence: c.overlap == null ? ['relEvNames', 'relEvNameOnly'] : ['relEvNames', { key: 'relEvOverlap', pct: Math.round(c.overlap * 100) }, 'relEvUnique'],
      });
    }
    return out;
  }

  DB.addRelationships = function (doc) {
    const d = declared(doc);
    const i = inferred(doc, d);
    if (d.length || i.length) doc.relationships = d.concat(i);
  };
})();
