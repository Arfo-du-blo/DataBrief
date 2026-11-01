/* DataBrief - settings. GPL-3.0-or-later.
 *
 * Sources, from strongest to weakest:
 *   1. Locked settings of the config block (set by a team admin, a server or the settings page)
 *   2. URL parameters: ?lang=fr&prompt=en&mode=files&layout=csv&theme=dark&share=no   (ignored for locked settings;
 *      share=no only: a link can switch "Do not share data" on, never off)
 *   3. The visitor's own saved choices (interface language, theme)
 *   4. Defaults of the config block
 *   5. Built-in defaults
 *
 * Config block (JSON, inside the page):
 *   <script id="databrief-config" type="application/json">{ ... }</script>
 *   {
 *     "lang": "fr", "promptLang": "en", "mode": "inline|files", "layout": "auto|table|csv", "theme": "system|light|dark", "share": "yes|no",
 *     "sampleRows": 5, "warnTokens": 150000,
 *     "lock": ["lang", "promptLang", "mode", "layout", "theme", "limit", "edit", "view", "share"],
 *     "promptIntro": "...", "promptRespond": "...", "promptRespondFiles": "..."
 *   }
 */
'use strict';
(function () {
  const DB = window.DB;
  const LANGS = window.DB_I18N.langs.map((l) => l.code);
  const VALID = {
    lang: (v) => LANGS.includes(v),
    promptLang: (v) => LANGS.includes(v),
    mode: (v) => v === 'inline' || v === 'files',
    layout: (v) => v === 'auto' || v === 'table' || v === 'csv',
    theme: (v) => v === 'system' || v === 'light' || v === 'dark',
    share: (v) => v === 'yes' || v === 'no', // 'no' = "Do not share data"
  };
  DB.LOCKABLE = ['lang', 'promptLang', 'mode', 'layout', 'theme', 'limit', 'edit', 'view', 'share'];

  function str(v) { return typeof v === 'string' && v.trim() ? v.replace(/\r\n?/g, '\n') : ''; }
  function int(v, d, min, max) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max ? n : d; }

  function readBlock() {
    const el = document.getElementById('databrief-config');
    if (!el) return {};
    try {
      const c = JSON.parse(el.textContent.trim() || '{}');
      return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    } catch (e) {
      console.warn('DataBrief: the config block is not valid JSON and was ignored.', e);
      return {};
    }
  }
  function readUrl() {
    const out = {};
    let p;
    try { p = new URLSearchParams(window.location.search); } catch (e) { return out; }
    const names = { lang: 'lang', prompt: 'promptLang', promptLang: 'promptLang', mode: 'mode', layout: 'layout', theme: 'theme', share: 'share' };
    for (const [param, key] of Object.entries(names)) {
      const v = p.get(param);
      if (v) out[key] = v.trim().toLowerCase().replace(/^promptlang$/, 'promptLang');
    }
    return out;
  }

  const raw = readBlock();
  const lockList = Array.isArray(raw.lock) ? raw.lock : String(raw.lock || '').split(',');
  const locks = new Set(lockList.map((s) => String(s).trim()).filter((x) => DB.LOCKABLE.includes(x)));
  const defaults = {};
  for (const k of Object.keys(VALID)) if (raw[k] != null && VALID[k](String(raw[k]))) defaults[k] = String(raw[k]);
  // "share" fails closed: any value other than "yes" (NO, false, 0, a typo...) means "Do not share data".
  if (raw.share != null && String(raw.share).trim() !== '') defaults.share = String(raw.share).trim().toLowerCase() === 'yes' ? 'yes' : 'no';
  const url = readUrl();
  const fromUrl = {};
  for (const k of Object.keys(VALID)) if (url[k] && VALID[k](url[k]) && !locks.has(k)) fromUrl[k] = url[k];
  // A link may switch "Do not share data" on (any value but "yes"), never off: it can only make the page more private.
  delete fromUrl.share;
  if (url.share && url.share !== 'yes' && !locks.has('share')) fromUrl.share = 'no';

  DB.CONFIG = {
    raw,
    defaults,
    fromUrl,
    locks,
    locked: (k) => locks.has(k),
    sampleRows: int(raw.sampleRows, 5, 1, 100),
    warnTokens: int(raw.warnTokens, 150000, 1000, 100000000),
    text: { intro: str(raw.promptIntro), respond: str(raw.promptRespond), respondFiles: str(raw.promptRespondFiles) },
  };

  /*
   * Final value of a setting.
   *   stored: the visitor's saved choice (or null); builtin: the built-in default.
   */
  DB.setting = function (key, stored, builtin) {
    const C = DB.CONFIG;
    if (C.locked(key)) return C.defaults[key] || builtin;
    return C.fromUrl[key] || (stored && VALID[key] && VALID[key](stored) ? stored : null) || C.defaults[key] || builtin;
  };
})();
