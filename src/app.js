/* DataBrief - page controller. GPL-3.0-or-later. */
'use strict';
(function () {
  const DB = window.DB;
  const I = window.DB_I18N;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return window.localStorage.getItem('databrief.' + k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem('databrief.' + k, v); } catch (e) { /* storage unavailable */ } },
  };
  const CFG = DB.CONFIG;     // team settings (src/config.js)
  const WARN_AT = CFG.warnTokens;                 // tokens: show the large-file warning above this
  const BUDGET = Math.round(CFG.warnTokens * 0.8); // tokens: target used to suggest N rows
  const PREVIEW_MAX = 80000; // characters shown in the preview

  const codes = I.langs.map((l) => l.code);
  const state = {
    ui: 'en', prompt: 'en', layout: 'auto', doc: null,
    limitOn: false, limitN: null, fullParts: [], fullMd: '', fullTokens: 0, parts: [], md: '', tokens: 0,
    lastErr: null, busy: false,
    mode: 'inline',  // 'inline': data inside the prompt, 'files': data in separate CSV files
    edits: { inline: {}, files: {} }, // user edits of the free regions, kept separately per mode: { regionId: text }
    editing: false,
    lockedRaw: 0,    // token estimate of the locked parts while editing
  };
  // contenteditable="plaintext-only" keeps pasted text plain (all current engines; fallback handled below).
  const PLAIN_EDIT = (() => {
    try { const s = document.createElement('span'); s.contentEditable = 'plaintext-only'; return s.contentEditable === 'plaintext-only'; } catch (e) { return false; }
  })();
  const curEdits = () => state.edits[state.mode];
  const hasEdits = () => Object.keys(curEdits()).length > 0;
  void codes;
  state.ui = DB.setting('lang', store.get('ui'), 'en');
  // The prompt follows the interface language, unless the team set (or the URL gives) another one.
  state.prompt = DB.setting('promptLang', null, state.ui);
  state.mode = DB.setting('mode', null, 'inline');
  state.layout = DB.setting('layout', null, 'auto');

  /* Settings locked by the team are hidden. */
  const LOCK_TARGETS = {
    lang: ['uiLangWrap'], promptLang: ['promptLangOpt'], mode: ['modeBox'], layout: ['layoutOpt', 'layoutHint'],
    theme: ['themeBtn'], limit: ['limitRow'], edit: ['editBtn'], view: ['viewBtn'],
  };
  for (const [key, ids] of Object.entries(LOCK_TARGETS)) {
    if (CFG.locked(key)) for (const id of ids) { const el = $(id); if (el) el.classList.add('locked-hidden'); }
  }

  const tu = (k, v) => {
    let s = (I.ui[state.ui] && I.ui[state.ui][k]) || I.ui.en[k] || k;
    if (v) s = s.replace(/\{(\w+)\}/g, (m, x) => (v[x] !== undefined ? v[x] : m));
    return s;
  };
  const fmt = (n) => new Intl.NumberFormat(DB.locale(state.ui)).format(n);

  /* ---------- static UI ---------- */
  function fillLangSelect(sel) {
    sel.textContent = '';
    for (const l of I.langs) {
      const o = document.createElement('option');
      o.value = l.code; o.textContent = l.name;
      sel.appendChild(o);
    }
  }
  fillLangSelect($('uiLang'));
  fillLangSelect($('promptLang'));

  const chips = $('chips');
  for (const f of DB.FORMATS) {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = f.key === 'sav' ? 'SPSS .sav' : f.label;
    c.title = f.exts.map((e) => '.' + e).join(' ');
    chips.appendChild(c);
  }
  $('fileInput').setAttribute('accept', DB.ACCEPT);

  function applyUi() {
    const lang = I.langs.find((l) => l.code === state.ui) || I.langs[0];
    document.documentElement.lang = state.ui;
    document.documentElement.dir = lang.rtl ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tu(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', tu(el.dataset.i18nAria)); });
    $('uiLang').value = state.ui;
    if (state.busy) setBusy(true, state.busyName);
    if (state.doc) renderResult();
    if (state.lastErr) showError(state.lastErr);
  }

  /* ---------- theme ---------- */
  function effectiveTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  const theme = DB.setting('theme', store.get('theme'), 'system');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  $('themeBtn').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
  });

  /* ---------- file handling ---------- */
  function setBusy(on, name) {
    state.busy = on; state.busyName = name;
    const drop = $('drop');
    drop.classList.toggle('busy', on);
    $('dropIcon').innerHTML = on ? '<span class="spinner"></span>' : DROP_ICON;
    $('dropTitle').textContent = on ? tu('reading', { file: name }) : tu('dropTitle');
    $('dropSub').textContent = on ? '' : tu('dropSub');
  }
  const DROP_ICON = $('dropIcon').innerHTML;

  function showError(e) {
    const box = $('errorBox');
    let msg, detail;
    if (e instanceof DB.UserError) { msg = tu(e.key, e.vars); detail = e.detail; }
    else { msg = tu('errGeneric'); detail = String((e && e.message) || e); }
    $('errorMsg').textContent = msg;
    $('errorCode').textContent = detail || '';
    $('errorDetails').classList.toggle('hidden', !detail);
    box.classList.remove('hidden');
  }
  function hideError() { state.lastErr = null; $('errorBox').classList.add('hidden'); }

  async function handleFile(file) {
    if (!file || state.busy || state.editing) return; // finish or cancel the edit first
    hideError();
    setBusy(true, file.name);
    await new Promise((r) => setTimeout(r, 40)); // let the spinner appear
    try {
      const buf = await file.arrayBuffer();
      const doc = await DB.parseFile(buf, file.name);
      state.doc = doc;
      state.limitOn = false;
      state.limitN = null;
      state.edits = { inline: {}, files: {} };
      state.editing = false;
      rebuild(true);
      $('result').classList.remove('hidden');
      renderResult();
      $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      state.doc = null;
      state.lastErr = e;
      $('result').classList.add('hidden');
      showError(e);
    } finally {
      setBusy(false);
      $('fileInput').value = '';
    }
  }

  /* ---------- building the result ---------- */
  const SAMPLE_ROWS = CFG.sampleRows;
  /* Team texts (settings page / server) replace the generated intro and "how to respond" text. */
  const baseTexts = () => ({
    intro: CFG.text.intro,
    respond: state.mode === 'files' ? CFG.text.respondFiles : CFG.text.respond,
  });
  const VIEW_ROWS = 500; // rows per table rendered in the formatted view
  const buildOpts = (extra) => Object.assign({
    lang: state.prompt, layout: state.layout, overrides: curEdits(), mode: state.mode, sample: SAMPLE_ROWS, base: baseTexts(),
  }, extra);
  function build(limit) {
    return DB.buildParts(state.doc, buildOpts({ limit }));
  }
  const limitActive = () => state.mode === 'inline' && state.limitOn && state.limitN;
  function rebuild(full) {
    if (!state.doc) return;
    if (full) {
      state.fullParts = build(null);
      state.fullMd = DB.joinParts(state.fullParts);
      state.fullTokens = DB.estimateTokens(state.fullMd);
      if (state.mode === 'inline' && state.fullTokens > WARN_AT && state.limitN == null) {
        state.limitN = DB.suggestLimit(state.doc, { lang: state.prompt, layout: state.layout }, BUDGET);
      }
    }
    if (limitActive()) {
      state.parts = build(state.limitN);
      state.md = DB.joinParts(state.parts);
      state.tokens = DB.estimateTokens(state.md);
    } else {
      state.parts = state.fullParts;
      state.md = state.fullMd;
      state.tokens = state.fullTokens;
    }
  }

  /* ---------- preview (view and edit modes) ---------- */
  /* Text of an editable block. Browsers may insert <br> or <div> for line breaks: turn them back into \n. */
  function readEditable(el) {
    let out = '';
    (function walk(node) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (n.nodeName === 'BR') out += '\n';
        else if (n.nodeType === 1) {
          const block = /^(DIV|P)$/.test(n.nodeName);
          if (block && out && !out.endsWith('\n')) out += '\n';
          walk(n);
        }
      }
    })(el);
    // Browsers add placeholder line breaks after a final newline; the spacing after a block is fixed anyway.
    return out.replace(/\n+$/, '');
  }

  function renderPreview() {
    const pre = $('preview');
    const top = pre.scrollTop;
    pre.textContent = '';
    pre.classList.toggle('editing', state.editing);
    const frag = document.createDocumentFragment();
    let budget = PREVIEW_MAX, cut = false;
    for (const p of state.parts) {
      if (p.k) {
        // Editable text is always shown in full, even past the preview limit.
        const el = document.createElement('span');
        el.className = 'ed';
        el.dataset.k = p.k;
        el.textContent = p.s;
        if (state.editing) el.contentEditable = PLAIN_EDIT ? 'plaintext-only' : 'true';
        frag.appendChild(el);
        continue;
      }
      let s = p.s;
      if (cut) { if (s.length > 300) s = '\n…\n'; }
      else if (s.length > budget) { s = s.slice(0, Math.max(0, budget)) + '\n…\n'; cut = true; }
      budget -= s.length;
      if (state.editing) {
        const el = document.createElement('span');
        el.className = 'lk';
        el.textContent = s;
        frag.appendChild(el);
      } else frag.appendChild(document.createTextNode(s));
    }
    pre.appendChild(frag);
    pre.scrollTop = top; // keep the reading position when switching modes
    $('previewNote').classList.toggle('hidden', !cut);
  }

  function renderEditControls() {
    const ed = state.editing;
    $('editBtn').setAttribute('aria-pressed', String(ed));
    $('editLabel').textContent = tu(ed ? 'confirm' : 'edit');
    $('cancelEditBtn').classList.toggle('hidden', !ed);
    $('editHint').classList.toggle('hidden', !ed);
    $('editedBadge').classList.toggle('hidden', ed || !hasEdits());
    $('resetBtn').classList.toggle('hidden', ed || !hasEdits());
    // While editing, actions use the confirmed version only, so they wait for Confirm or Cancel.
    for (const id of ['copyBtn', 'downloadBtn', 'dataBtn', 'allBtn', 'viewBtn', 'promptLang', 'uiLang', 'limitOn', 'limitN', 'anotherBtn']) $(id).disabled = ed;
    document.querySelectorAll('#layoutGroup button, #modeGroup button').forEach((b) => { b.disabled = ed; });
    $('fileInput').disabled = ed;
  }

  /* Live token estimate while typing: locked parts are counted once, editable spans on every input. */
  function updateLiveTokens() {
    let raw = state.lockedRaw;
    for (const el of $('preview').querySelectorAll('.ed')) raw += DB.estimateTokensRaw(readEditable(el));
    $('stTokens').textContent = '~' + fmt(Math.ceil(raw));
  }

  /* Put the text cursor in an editable part without scrolling the preview. */
  function placeCaret(el, atEnd) {
    el.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  /* First editable part visible in the preview (so the user can type right away). */
  function visibleEditable(after) {
    const box = $('preview').getBoundingClientRect();
    const all = Array.from($('preview').querySelectorAll('.ed'));
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; };
    if (after) {
      // nearest editable part after (or else before) the clicked locked part, if it is on screen
      const pos = (el) => after.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const next = all.find((el) => pos(el));
      const prev = all.filter((el) => !pos(el)).pop();
      return [next, prev].find((el) => el && inView(el)) || null;
    }
    return all.find(inView) || null;
  }
  function flashHint() {
    const h = $('editHint');
    h.classList.remove('flash');
    void h.offsetWidth; // restart the animation
    h.classList.add('flash');
  }

  function startEdit() {
    state.editing = true;
    state.lockedRaw = state.parts.reduce((a, p) => (p.k ? a : a + DB.estimateTokensRaw(p.s)), 0);
    renderEditControls();
    renderPreview();
    updateLiveTokens();
    const first = visibleEditable();
    if (first) placeCaret(first, false);
  }
  function confirmEdit() {
    const orig = new Map(state.parts.filter((p) => p.k).map((p) => [p.k, p.orig]));
    const ov = Object.assign({}, curEdits());
    for (const el of $('preview').querySelectorAll('.ed')) {
      const k = el.dataset.k;
      const v = readEditable(el);
      if (v === orig.get(k)) delete ov[k]; else ov[k] = v;
    }
    state.edits[state.mode] = ov;
    state.editing = false;
    rebuild(true);
    renderResult();
  }
  function cancelEdit() {
    state.editing = false;
    renderResult();
  }

  /* "Keep my text" or "Regenerate": resolves true for Regenerate. Esc keeps the text. */
  function askRegenerate() {
    return new Promise((resolve) => {
      const dlg = $('changeDialog');
      dlg.returnValue = '';
      const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'regen'); };
      dlg.addEventListener('close', done);
      dlg.showModal();
    });
  }
  const regionOrigs = () => Object.fromEntries(state.parts.filter((p) => p.k).map((p) => [p.k, p.orig]));
  /*
   * Applies a setting change. When it regenerates a region the user edited, ask whether to keep the edited
   * text or regenerate it. A language change also concerns the edits of the other mode.
   */
  async function applySetting(mutate, opts) {
    opts = opts || {};
    const after = opts.after || renderResult;
    if (!state.doc) { mutate(); after(); return; }
    const before = regionOrigs();
    mutate();
    rebuild(true);
    const now = regionOrigs();
    const ed = curEdits();
    const affected = Object.keys(ed).filter((k) => before[k] !== now[k]);
    const other = opts.lang ? state.edits[state.mode === 'inline' ? 'files' : 'inline'] : {};
    const otherKeys = Object.keys(other);
    if (affected.length || otherKeys.length) {
      if (await askRegenerate()) {
        for (const k of affected) delete ed[k];
        for (const k of otherKeys) delete other[k];
        rebuild(true);
      }
    }
    after();
  }

  function renderResult() {
    const d = state.doc;
    if (!d) return;
    const fmtDef = DB.FORMATS.find((f) => f.key === d.formatKey || (d.formatKey === 'zsav' && f.key === 'sav'));
    $('fileName').textContent = d.fileName;
    $('fileSub').textContent = d.formatName + ' · ' + DB.fmtBytes(d.fileSize);
    $('stFormat').textContent = fmtDef ? (fmtDef.key === 'sav' ? 'SPSS' : fmtDef.label) : d.formatKey.toUpperCase();
    $('stSections').textContent = fmt(d.sections.length);
    const totalRows = d.sections.reduce((a, s) => a + s.rows.length, 0);
    $('stRows').textContent = fmt(totalRows);
    $('stCols').textContent = fmt(d.sections.reduce((a, s) => a + s.columns.length, 0));
    $('stTokens').textContent = '~' + fmt(state.tokens);
    $('stTokensUnit').textContent = tu('tokensUnit');

    const files = state.mode === 'files';
    document.querySelectorAll('#modeGroup button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    $('modeHint').classList.toggle('hidden', !files);
    $('modeHint').textContent = tu('modeHint', { n: fmt(SAMPLE_ROWS) });
    $('dataBtn').classList.toggle('hidden', !files);
    $('allBtn').classList.toggle('hidden', !files);
    $('dataLabel').textContent = d.sections.length > 1 ? tu('downloadDataZip') : tu('downloadData');

    const big = !files && state.fullTokens > WARN_AT;
    $('warnBox').classList.toggle('hidden', !big);
    if (big) {
      $('warnText').textContent = tu('warnText', { n: fmt(state.fullTokens) });
      $('limitOn').checked = state.limitOn;
      if (document.activeElement !== $('limitN')) $('limitN').value = state.limitN || '';
      const shown = d.sections.reduce((a, s) => a + Math.min(s.rows.length, state.limitOn && state.limitN ? state.limitN : s.rows.length), 0);
      $('limitShown').textContent = state.limitOn ? tu('limitShown', { a: fmt(shown), b: fmt(totalRows) }) : '';
    }
    document.querySelectorAll('#layoutGroup button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout)));
    $('promptLang').value = state.prompt;

    renderEditControls();
    renderPreview();
    if (state.editing) updateLiveTokens();
  }

  /* ---------- downloads ---------- */
  const baseName = () => DB.safeName((state.doc.fileName || 'data').replace(/\.[^.]+$/, ''));
  /* All data files (always complete), as { name: bytes }. */
  function dataFiles() {
    const names = DB.dataFileNames(state.doc);
    const files = {};
    state.doc.sections.forEach((s, i) => { files[names[i]] = window.fflate.strToU8(DB.toCsv(s)); });
    return files;
  }
  const zip = (files) => new Blob([window.fflate.zipSync(files, { level: 6 })], { type: 'application/zip' });
  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ---------- events ---------- */
  const input = $('fileInput');
  const drop = $('drop');
  input.addEventListener('change', () => handleFile(input.files && input.files[0]));
  drop.tabIndex = 0;
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.classList.add('dragging'); $('dropTitle').textContent = state.busy ? $('dropTitle').textContent : tu('dropActive'); });
  window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('dragging'); if (!state.busy) $('dropTitle').textContent = tu('dropTitle'); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; drop.classList.remove('dragging');
    if (!state.busy) $('dropTitle').textContent = tu('dropTitle');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $('anotherBtn').addEventListener('click', () => input.click());

  $('uiLang').addEventListener('change', (e) => {
    const v = e.target.value;
    // The prompt follows the interface language by default.
    // The prompt language follows, unless the team locked it.
    applySetting(() => {
      state.ui = v;
      if (!(CFG.locked('promptLang') && CFG.defaults.promptLang)) state.prompt = v;
      store.set('ui', v);
    }, { lang: true, after: applyUi });
  });
  $('promptLang').addEventListener('change', (e) => {
    const v = e.target.value;
    applySetting(() => { state.prompt = v; }, { lang: true });
  });
  $('keepBtn').addEventListener('click', () => $('changeDialog').close('keep'));
  $('regenBtn').addEventListener('click', () => $('changeDialog').close('regen'));

  $('editBtn').addEventListener('click', () => { if (state.editing) confirmEdit(); else startEdit(); });
  $('cancelEditBtn').addEventListener('click', cancelEdit);
  $('resetBtn').addEventListener('click', () => { state.edits[state.mode] = {}; rebuild(true); renderResult(); });
  const pre = $('preview');
  pre.addEventListener('input', () => { if (state.editing) updateLiveTokens(); });
  // Enter always inserts a plain line break (not a <br> or <div>), in every browser.
  pre.addEventListener('keydown', (e) => {
    if (state.editing && e.key === 'Enter' && !e.isComposing && e.target.closest && e.target.closest('.ed')) {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  });
  if (!PLAIN_EDIT) {
    // Older engines: keep pasted content as plain text.
    pre.addEventListener('paste', (e) => {
      if (!state.editing || !e.target.closest || !e.target.closest('.ed')) return;
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text'));
    });
  }
  document.querySelectorAll('#layoutGroup button').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.layout;
    applySetting(() => { state.layout = v; });
  }));
  $('limitOn').addEventListener('change', (e) => { const v = e.target.checked; applySetting(() => { state.limitOn = v; }); });
  let limitTimer = null;
  $('limitN').addEventListener('input', (e) => {
    clearTimeout(limitTimer);
    limitTimer = setTimeout(() => {
      const n = parseInt(e.target.value, 10);
      if (!(n >= 1)) return;
      applySetting(() => { state.limitN = n; state.limitOn = true; });
    }, 250);
  });

  $('copyBtn').addEventListener('click', async () => {
    const btn = $('copyBtn'), label = $('copyLabel');
    let ok = false;
    try { await navigator.clipboard.writeText(state.md); ok = true; } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = state.md; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e2) { ok = false; }
    }
    label.textContent = ok ? tu('copied') : tu('copyFail');
    btn.classList.toggle('done', ok);
    setTimeout(() => { label.textContent = tu('copy'); btn.classList.remove('done'); }, ok ? 1600 : 3500);
  });
  $('downloadBtn').addEventListener('click', () => {
    save(new Blob([state.md], { type: 'text/markdown;charset=utf-8' }), baseName() + '.md');
  });
  // Data files: one CSV as is, several CSVs in a zip. Always the complete data.
  $('dataBtn').addEventListener('click', () => {
    const files = dataFiles();
    const names = Object.keys(files);
    if (names.length === 1) save(new Blob([files[names[0]]], { type: 'text/csv;charset=utf-8' }), names[0]);
    else save(zip(files), baseName() + '_data.zip');
  });
  // Prompt + data files together.
  $('allBtn').addEventListener('click', () => {
    const files = dataFiles();
    files[baseName() + '.md'] = window.fflate.strToU8(state.md);
    save(zip(files), baseName() + '_databrief.zip');
  });

  document.querySelectorAll('#modeGroup button').forEach((b) => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    rebuild(true);
    renderResult();
  }));

  // Clicking locked text while editing: point to the editable parts instead of doing nothing.
  pre.addEventListener('click', (e) => {
    if (!state.editing || !e.target.closest || !e.target.closest('.lk')) return;
    flashHint();
    const near = visibleEditable(e.target.closest('.lk'));
    if (near) placeCaret(near, !(e.target.closest('.lk').compareDocumentPosition(near) & Node.DOCUMENT_POSITION_FOLLOWING));
  });

  /* ---------- formatted view (Markdown rendered by marked; raw HTML from the data is never executed) ---------- */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let mdRenderer = null;
  function renderer() {
    if (mdRenderer) return mdRenderer;
    mdRenderer = new window.marked.Marked({ gfm: true, breaks: false, async: false });
    mdRenderer.use({
      renderer: {
        // Only the <br> line breaks DataBrief writes in table cells are kept; any other HTML is shown as text.
        html(token) { const t = String(token.text || token.raw || ''); return /^<br\s*\/?>$/i.test(t.trim()) ? '<br>' : esc(t); },
        // No images: they could reach the network, and data is not meant to load anything.
        image(token) { return esc(token.text || token.title || ''); },
        link(token) {
          const inner = this.parser.parseInline(token.tokens);
          const href = String(token.href || '');
          return /^(https?:|mailto:)/i.test(href) ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>' : inner;
        },
      },
    });
    return mdRenderer;
  }
  function openFormatted() {
    const opts = buildOpts({ limit: limitActive() ? state.limitN : null, displayLimit: VIEW_ROWS });
    const md = DB.joinParts(DB.buildParts(state.doc, opts));
    const body = $('mdBody');
    body.innerHTML = renderer().parse(md);
    for (const t of Array.from(body.querySelectorAll('table'))) {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.replaceWith(wrap);
      wrap.appendChild(t);
    }
    const cut = state.doc.sections.some((s) => Math.min(s.rows.length, limitActive() ? state.limitN : Infinity) > VIEW_ROWS && state.mode === 'inline');
    $('mdNote').textContent = cut ? tu('renderCut', { n: fmt(VIEW_ROWS) }) : '';
    $('mdNote').classList.toggle('hidden', !cut);
    body.scrollTop = 0;
    const dlg = $('mdDialog');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  $('viewBtn').addEventListener('click', openFormatted);
  $('mdClose').addEventListener('click', () => $('mdDialog').close());
  $('mdDialog').addEventListener('click', (e) => { if (e.target === $('mdDialog')) $('mdDialog').close(); });

  $('infoBtn').addEventListener('click', () => { const dlg = $('infoDialog'); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); });
  $('infoClose').addEventListener('click', () => { const dlg = $('infoDialog'); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });
  $('infoDialog').addEventListener('click', (e) => { if (e.target === $('infoDialog') && e.target.close) e.target.close(); });

  applyUi();
  window.DataBrief = { handleFile, getMarkdown: () => state.md, getState: () => state };
})();
