/* DataBrief - data profile of every section: missing and distinct values, kind of column, summaries. GPL-3.0-or-later.
 *
 * Everything here is computed from ALL the rows, locally. The numbers are observed facts; the "kind" of a column
 * (identifier, categorical, continuous...) is an inference and is presented as such.
 * The result of profileColumn is a plain object so that later stages can decide which parts to show:
 *   { name, type, n, missing, distinct, kind, summary, note }
 *   summary: { top: [{ value, count, pct }], other, otherPct }            categorical
 *          | { min, max, mean, sd, median, outliers }                       continuous
 *          | { min, max }                                                    date / time (ISO text)
 *   note: key of a prompt string that explains why no summary was computed. */
'use strict';
(function () {
  const DB = window.DB;
  const MAX_DUP_ROWS = 1000000;  // duplicate detection keeps one text per row in memory
  const CAT_MAX = 20;            // a text column with more distinct values is not "categorical"

  /* Numbers of a column of "integer" / "decimal" texts, or null when the format is ambiguous:
   * both "1,5" and "2.5" in one column, or only "1,234" (a thousands separator or a decimal comma?). */
  function numbers(vals) {
    let comma = 0, dot = 0, thousands = 0, other = 0;
    for (const v of vals) {
      if (/^[+-]?\d+([eE][+-]?\d+)?$/.test(v)) continue;
      if (/^[+-]?\d*\.\d+([eE][+-]?\d+)?$/.test(v) || /^[+-]?\d+\.$/.test(v)) { dot++; continue; }
      if (/^[+-]?\d*,\d+$/.test(v)) { comma++; if (/^[+-]?\d{1,3},\d{3}$/.test(v)) thousands++; continue; }
      other++;
    }
    if (other || (comma && dot) || (comma && comma === thousands)) return null;
    const out = new Array(vals.length);
    for (let i = 0; i < vals.length; i++) out[i] = Number(comma ? vals[i].replace(',', '.') : vals[i]);
    return out;
  }

  const quantile = (sorted, p) => {
    const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  // The whole value must be a date / time (anchored at both ends): a value with text after the date is not a date
  const ISO = /^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?|\d{2}:\d{2}(:\d{2}(\.\d+)?)?)$/;

  function profileColumn(sec, ci) {
    const col = sec.columns[ci];
    const n = sec.rows.length;
    const vals = [];
    for (const r of sec.rows) {
      const v = r[ci];
      if (v === '' || v == null) continue;
      const t = String(v).trim();
      if (t) vals.push(t);
    }
    const m = vals.length;
    const p = { name: col.name, type: col.type, n, missing: n - m, distinct: 0, kind: 'empty', summary: null, note: null };
    if (!m) return p;
    const counts = new Map();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    p.distinct = counts.size;

    const type = col.type;
    if (type === 'mixed') p.kind = 'mixed';
    else if (type === 'date' || type === 'datetime' || type === 'time') p.kind = 'datetime';
    else if ((type === 'integer' || type === 'text') && m >= 5 && counts.size / m >= 0.99 && !vals.some((v) => /\s/.test(v) || v.length > 64)) p.kind = 'identifier';
    else if (type === 'boolean') p.kind = 'categorical';
    else if (type === 'integer' && counts.size <= 10 && counts.size <= m / 2) p.kind = 'categorical';
    else if (type === 'text' && counts.size <= CAT_MAX && counts.size <= m / 2) p.kind = 'categorical';
    else if (type === 'integer' || type === 'decimal') p.kind = 'continuous';
    else p.kind = 'text';

    if (p.kind === 'categorical') {
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, CAT_MAX); // every category (at most 20)
      const rest = m - top.reduce((s, x) => s + x[1], 0);
      p.summary = { top: top.map(([value, count]) => ({ value, count, pct: (count / m) * 100 })), other: rest, otherPct: (rest / m) * 100 };
    } else if (p.kind === 'continuous') {
      const nums = numbers(vals);
      if (!nums) p.note = 'profAmbiguous';
      else {
        let mean = 0, m2 = 0;
        nums.forEach((x, i) => { const d = x - mean; mean += d / (i + 1); m2 += d * (x - mean); }); // Welford
        const sorted = nums.slice().sort((a, b) => a - b);
        const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
        p.summary = {
          min: sorted[0], max: sorted[sorted.length - 1], mean, sd: sorted.length > 1 ? Math.sqrt(m2 / (sorted.length - 1)) : 0,
          median: quantile(sorted, 0.5), outliers: sorted.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr).length,
        };
      }
    } else if (p.kind === 'datetime') {
      if (vals.every((v) => ISO.test(v))) {
        let min = vals[0], max = vals[0];
        for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
        p.summary = { min, max };
      } else p.note = 'profNonIso';
    }
    return p;
  }

  function profileSection(sec) {
    const n = sec.rows.length;
    const columns = sec.columns.map((c, i) => profileColumn(sec, i));
    let duplicateRows = null;
    if (n > 1 && n <= MAX_DUP_ROWS) {
      const seen = new Set();
      for (const r of sec.rows) seen.add(r.join('\u0001'));
      duplicateRows = n - seen.size;
    }
    return {
      name: sec.name, rows: n, columns, duplicateRows,
      constantColumns: columns.filter((c) => c.distinct === 1 && c.missing === 0).map((c) => c.name),
    };
  }

  /* The profile of a document, computed once. */
  DB.getProfile = function (doc) {
    if (!doc.__profile) doc.__profile = doc.sections.map(profileSection);
    return doc.__profile;
  };
})();
