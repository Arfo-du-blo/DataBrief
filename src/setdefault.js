/* DataBrief - settings page logic. GPL-3.0-or-later.
 * Reads the form, writes the settings into the config block of a fresh copy of databrief.html
 * (embedded in this page, gzip + base64), and offers it as a download. Nothing leaves the browser. */
'use strict';
(function () {
  const DB = window.DB;
  const I = window.DB_I18N;
  const $ = (id) => document.getElementById(id);
  const FIELDS = ['lang', 'promptLang', 'mode', 'layout', 'theme', 'share'];
  const TEXTS = [['promptIntro', 't_intro'], ['promptRespond', 't_respond'], ['promptRespondFiles', 't_respondFiles']];
  /* Settings -> environment variable names used by the servers, Docker and databrief.conf */
  const ENV = {
    lang: 'DATABRIEF_LANG', promptLang: 'DATABRIEF_PROMPT_LANG', mode: 'DATABRIEF_MODE', layout: 'DATABRIEF_LAYOUT',
    theme: 'DATABRIEF_THEME', share: 'DATABRIEF_SHARE', sampleRows: 'DATABRIEF_SAMPLE_ROWS', warnTokens: 'DATABRIEF_WARN_TOKENS', lock: 'DATABRIEF_LOCK',
    promptIntro: 'DATABRIEF_PROMPT_INTRO', promptRespond: 'DATABRIEF_PROMPT_RESPOND', promptRespondFiles: 'DATABRIEF_PROMPT_RESPOND_FILES',
  };

  for (const id of ['f_lang', 'f_promptLang']) {
    for (const l of I.langs) {
      const o = document.createElement('option');
      o.value = l.code; o.textContent = l.name;
      $(id).appendChild(o);
    }
  }

  $('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  });

  /* ---------- form <-> settings ---------- */
  function readForm() {
    const c = {};
    for (const k of FIELDS) { const v = $('f_' + k).value; if (v) c[k] = v; }
    const sr = parseInt($('f_sampleRows').value, 10);
    if (sr >= 1 && sr <= 100 && sr !== 5) c.sampleRows = sr;
    const wt = parseInt($('f_warnTokens').value, 10);
    if (wt >= 1000 && wt !== 150000) c.warnTokens = wt;
    const lock = Array.from(document.querySelectorAll('[data-lock]')).filter((x) => x.checked).map((x) => x.dataset.lock);
    if (lock.length) c.lock = lock;
    for (const [key, id] of TEXTS) {
      const v = $(id).value.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
      if (v.trim()) c[key] = v;
    }
    return c;
  }
  function applyConfig(c) {
    for (const k of FIELDS) $('f_' + k).value = c[k] && Array.from($('f_' + k).options).some((o) => o.value === c[k]) ? c[k] : '';
    $('f_sampleRows').value = c.sampleRows || '';
    $('f_warnTokens').value = c.warnTokens || '';
    const locks = new Set(Array.isArray(c.lock) ? c.lock : String(c.lock || '').split(','));
    document.querySelectorAll('[data-lock]').forEach((x) => { x.checked = locks.has(x.dataset.lock); });
    for (const [key, id] of TEXTS) $(id).value = typeof c[key] === 'string' ? c[key] : '';
    update();
  }

  /* ---------- the embedded databrief.html ---------- */
  let appCache = null;
  function appSource() {
    if (appCache) return appCache;
    const bin = atob(window.DB_APP_GZ);
    const gz = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    appCache = new TextDecoder('utf-8').decode(window.fflate.gunzipSync(gz));
    return appCache;
  }
  const BLOCK = /(<script id="databrief-config" type="application\/json">)[\s\S]*?(<\/script>)/;
  function makeHtml() {
    const json = JSON.stringify(readForm(), null, 2).replace(/</g, '\\u003c');
    return appSource().replace(BLOCK, (m, open, close) => open + '\n' + json + '\n' + close);
  }
  const htmlBlob = () => new Blob([makeHtml()], { type: 'text/html;charset=utf-8' });

  /* ---------- environment variables / databrief.conf equivalent ---------- */
  const confValue = (v) => {
    const s = String(v);
    return /[\s"'#\\]/.test(s) || s === '' ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"' : s;
  };
  function update() {
    const c = readForm();
    const lines = Object.keys(c).map((k) => ENV[k] + '=' + confValue(Array.isArray(c[k]) ? c[k].join(',') : c[k]));
    $('envOut').textContent = lines.length ? lines.join('\n') : '# Nothing set: DataBrief uses its built-in defaults.';
  }
  document.querySelector('main').addEventListener('input', update);
  document.querySelector('main').addEventListener('change', update);

  /* ---------- actions ---------- */
  document.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
    const which = b.dataset.fill;
    const lang = $('f_promptLang').value || $('f_lang').value || 'en';
    const id = which === 'intro' ? 't_intro' : which === 'respond' ? 't_respond' : 't_respondFiles';
    const text = DB.generatedText(lang, which === 'respondFiles' ? 'files' : 'inline', which === 'intro' ? 'intro' : 'respond');
    if ($(id).value.trim() && !window.confirm('Replace the text in this box?')) return;
    $(id).value = text;
    update();
  }));

  $('downloadBtn').addEventListener('click', () => {
    const url = URL.createObjectURL(htmlBlob());
    const a = document.createElement('a');
    a.href = url; a.download = 'databrief.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $('previewBtn').addEventListener('click', () => {
    const url = URL.createObjectURL(htmlBlob());
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  $('resetAllBtn').addEventListener('click', () => { if (window.confirm('Clear every setting on this page?')) applyConfig({}); });

  $('loadInput').addEventListener('change', async () => {
    const f = $('loadInput').files && $('loadInput').files[0];
    const msg = $('loadMsg');
    if (!f) return;
    msg.classList.remove('hidden', 'ok', 'err');
    try {
      const m = BLOCK.exec(await f.text());
      if (!m) throw new Error('no settings block');
      const json = /<script id="databrief-config" type="application\/json">([\s\S]*?)<\/script>/.exec(m[0])[1].trim();
      applyConfig(json ? JSON.parse(json) : {});
      msg.textContent = 'Settings loaded from ' + f.name + '.';
      msg.classList.add('ok');
    } catch (e) {
      msg.textContent = 'This file does not look like a databrief.html (' + e.message + ').';
      msg.classList.add('err');
    }
    $('loadInput').value = '';
  });

  update();
  window.DataBriefSettings = { readForm, applyConfig, makeHtml };
})();
