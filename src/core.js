/* DataBrief - the page's way from a file to a prompt, without the page. GPL-3.0-or-later.
 *
 * DB.prepare(buffer, fileName, options) does what src/app.js does between "a file was chosen" and "the prompt is ready"
 * (handleFile, rebuild, the data files), with the same defaults, so that the command-line tool (and, later, other front ends)
 * give exactly the prompt the page gives. It uses no DOM: it runs in the page's realm or in the tool's (cli/realm.cjs).
 * tests/test_cli_parity.cjs compares it with the page in a browser on every test file.
 *
 *   options (all optional):
 *     lang      prompt language ('en')                 layout   'auto' | 'table' | 'csv' ('auto')
 *     mode      'inline' | 'files' ('inline')          profile  data profile on (true)
 *     share     'yes' | 'no' ("Do not share data")     level    no-share level 1, 2 or 3 (1)
 *     sw        no-share switches (DB.NS_DEFAULTS)     limit    rows per table in the prompt: a number, 'auto' (the page's
 *     csv       also return the data as CSV files                suggestion) or null; inline mode only, as in the page
 *   result: { md, tokens, shared, fileName, formatName, files, large }
 *     shared  true when the prompt contains data (false in "Do not share data")
 *     files   [{ name, text }]: the data files (CSV), only with options.csv; in "Do not share data" too (the user asked for
 *             them, on their computer), the prompt still holds no record
 *     large   { tokens, limit } when the full prompt is over the page's warning size (inline mode), else null
 *
 * DB.errorInfo(error, noShare, uiLang) -> { key, message, detail }: the page's error text; no technical detail in
 * "Do not share data" (it can quote the file), as on the page. */
'use strict';
(function () {
  const DB = window.DB;
  const I = window.DB_I18N;

  DB.prepare = async function (buf, fileName, options) {
    const CFG = DB.CONFIG;
    const o = Object.assign({ lang: 'en', layout: 'auto', mode: 'inline', profile: true, share: 'yes', level: 1, sw: null, limit: null, csv: false }, options || {});
    const noShare = o.share === 'no';
    const WARN_AT = CFG.warnTokens, BUDGET = Math.round(CFG.warnTokens * 0.8); // as in src/app.js
    let doc = await DB.parseFile(buf, fileName);
    const out = { md: '', tokens: 0, shared: !noShare, fileName: doc.fileName || fileName, formatName: doc.formatName || '', files: [], large: null };
    if (o.csv) {
      const names = DB.dataFileNames(doc);
      out.files = doc.sections.map((s, i) => ({ name: names[i], text: DB.toCsv(s) }));
    }
    if (noShare) {
      // "Do not share data": the prompt is built from the record-free copy only (the parsed rows are dropped)
      const ns = DB.makeNoShareSource(doc, o.level);
      doc = null;
      const parts = DB.buildNoShareParts(ns, { lang: o.lang, overrides: {}, level: o.level, sw: Object.assign({}, DB.NS_DEFAULTS, o.sw || {}) });
      out.md = DB.joinParts(parts);
      out.tokens = DB.estimateTokens(out.md);
      return out;
    }
    const base = { intro: CFG.text.intro, respond: o.mode === 'files' ? CFG.text.respondFiles : CFG.text.respond };
    const opts = (limit) => ({ lang: o.lang, layout: o.layout, overrides: {}, mode: o.mode, sample: CFG.sampleRows, base, profile: o.profile, limit });
    const fullMd = DB.joinParts(DB.buildParts(doc, opts(null)));
    const fullTokens = DB.estimateTokens(fullMd);
    let suggested = null;
    if (o.mode === 'inline' && fullTokens > WARN_AT) {
      suggested = DB.suggestLimit(doc, { lang: o.lang, layout: o.layout }, BUDGET);
      out.large = { tokens: fullTokens, limit: suggested };
    }
    let limit = o.mode === 'inline' ? o.limit : null;
    if (limit === 'auto') limit = suggested;
    if (limit != null && !(Number.isInteger(limit) && limit >= 1)) throw new Error('limit: a whole number from 1');
    if (limit) {
      out.md = DB.joinParts(DB.buildParts(doc, opts(limit)));
      out.tokens = DB.estimateTokens(out.md);
    } else {
      out.md = fullMd;
      out.tokens = fullTokens;
    }
    return out;
  };

  DB.errorInfo = function (e, noShare, uiLang) {
    const ui = (I.ui[uiLang] || I.ui.en);
    const text = (k, v) => {
      let s = ui[k] || I.ui.en[k] || k;
      if (v) s = s.replace(/\{(\w+)\}/g, (m, x) => (v[x] !== undefined ? v[x] : m));
      return s;
    };
    if (e instanceof DB.UserError) return { key: e.key, message: text(e.key, e.vars), detail: noShare ? '' : e.detail || '' };
    return { key: 'errGeneric', message: text('errGeneric'), detail: noShare ? '' : String((e && e.message) || e) };
  };
})();
