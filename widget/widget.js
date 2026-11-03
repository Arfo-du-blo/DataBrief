/* DataBrief - the widget layer. GPL-3.0-or-later.
 *
 * tools/build-widget.cjs puts this file, widget-i18n.js and widget.css into a copy of databrief.html (dist/databrief-widget.html).
 * The page itself is not changed by it, except for two small anchored patches the build makes in the copy: window.DataBriefPage
 * (read access to the page's state) and a hook in the page's save() that lets this layer route downloads through the host.
 *
 * Inert unless the page is in a frame whose host answers the MCP Apps handshake (Claude, ChatGPT and other hosts of MCP Apps).
 * Opened on its own, the file is the normal page. It makes no network request; it only talks to the host with postMessage.
 *
 * What it adds, from what the host says it supports (hostCapabilities), never from guesses:
 *   Put in the chat   Claude: the whole prompt goes into the message box (ui/message). ChatGPT and unknown hosts: the prompt goes
 *                     into the chat context (ui/update-model-context) and a short line is sent (ui/message).
 *   Add to context    Claude only: context + the short line in the message box.
 *   Ask about this data   a question field: context + the question (in the message box, or sent at once).
 *   Downloads         through ui/download-file; hidden when the host cannot download.
 *   Links             through ui/open-link (plain links are blocked in the frame).
 * Every send waits for a second click on the same button (it turns into Confirm: amber when the prompt holds data, green when
 * "Do not share data" is on); a box under it says what will happen. Size warnings never block. */
(function () {
  'use strict';
  if (window.parent === window) return;                 // not in a frame: the normal page, nothing changes
  const VERSION = '__WIDGET_VERSION__';
  const CTX_TOKENS = 15000;      // about what the smallest known host accepts as context (Claude: 16,000 tokens)
  const MSG_CHARS = 100000;      // about what the smallest known host accepts as a message (ChatGPT: between 100 and 250 KB)
  const ARM_MS = 8000, OK_MS = 6000, HANDSHAKE_MS = 5000;
  const $ = (id) => document.getElementById(id);
  const I = window.DB_WIDGET_I18N || {};
  const page = () => window.DataBriefPage;
  window.DataBriefHost = { save: () => false };         // replaced once the host has answered
  if (!page()) { console.error('DataBrief widget: the page hook is missing'); return; }

  /* ---------- texts ---------- */
  function T(key, vars, lang) {
    const table = I[lang || page().state.ui] || I.en || {};
    let s = table[key] || (I.en && I.en[key]) || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, x) => (vars[x] !== undefined ? vars[x] : m));
    return s;
  }
  const num = (n) => new Intl.NumberFormat(page().DB.locale(page().state.ui)).format(n);
  const errText = (e) => (e && (e.message || (e.code !== undefined ? 'error ' + e.code : ''))) || String(e);

  /* ---------- the host (MCP Apps: JSON-RPC over postMessage) ---------- */
  let nextId = 1, host = null, lastHeight = 0, maxHeight = 5000;
  const pending = {};
  const post = (m) => window.parent.postMessage(m, '*');
  function request(method, params) {
    return new Promise((ok, no) => { const id = nextId++; pending[id] = { ok, no }; post({ jsonrpc: '2.0', id, method, params: params || {} }); });
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;             // only the host speaks to us
    const m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id !== undefined && m.id !== null && !m.method && pending[m.id]) {
      const p = pending[m.id]; delete pending[m.id];
      if (m.error) p.no(m.error); else p.ok(m.result || {});
      return;
    }
    if (m.method && m.id !== undefined && m.id !== null) {   // a request from the host
      const known = m.method === 'ping' || m.method === 'ui/resource-teardown';
      post(known ? { jsonrpc: '2.0', id: m.id, result: {} } : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    }
  });
  function reportSize() {
    const h = Math.min(document.documentElement.scrollHeight, maxHeight);
    if (h === lastHeight) return;
    lastHeight = h;
    post({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: document.documentElement.scrollWidth, height: h } });
  }
  const caps = () => (host && host.hostCapabilities) || {};
  const has = () => ({ message: !!caps().message, ctx: !!caps().updateModelContext, dl: !!caps().downloadFile, links: !!caps().openLinks });
  // 'fill': ui/message only fills the message box (Claude). 'send': it sends at once (ChatGPT). 'unknown': we do not know, so
  // the wording says both and the route is the safe one (a short line, never the whole prompt).
  function hostKind() {
    const name = String((host.hostInfo && host.hostInfo.name) || '').toLowerCase();
    if (name === 'claude') return 'fill';
    if (name === 'chatgpt' || (caps().experimental && caps().experimental['openai/message'])) return 'send';
    return 'unknown';
  }

  /* ---------- what the page holds ---------- */
  const current = () => {
    const s = page().state;
    const text = s.md || '';
    return { text, data: s.share !== 'no', tokens: s.tokens || Math.ceil(text.length / 4) };
  };

  /* ---------- the box under the buttons ---------- */
  let box = null, hideTimer = null;
  function show(text, tone, anchor) {
    if (!box) return;
    clearTimeout(hideTimer);
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    if (!text) { box.className = 'dbw-box'; box.textContent = ''; return; }
    box.className = 'dbw-box on ' + (tone || '');
    box.textContent = text;
    if (tone === 'ok') hideTimer = setTimeout(() => show('', '', null), OK_MS);
    reportSize();
  }

  /* ---------- the two clicks: the button turns into Confirm ---------- */
  let armed = null;
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  function disarm() {
    if (!armed) return;
    const a = armed; armed = null;
    clearTimeout(a.timer);
    a.btn.className = a.cls; a.btn.innerHTML = a.html;
    if (a.x) a.x.remove();
  }
  function cancel() { disarm(); show('', '', null); }
  // The line written in the chat, in the prompt language. Where the context stays out of the conversation until the AI asks for it
  // ('fill', Claude), the line names the step to take; elsewhere the context is simply there.
  const lineFor = (kind, q) => (kind === 'ask' ? T('lineAsk', { q }, page().state.prompt) : T(hostKind() === 'fill' ? 'lineReadFill' : 'lineRead', null, page().state.prompt));

  function arm(btn, kind, anchor) {
    if (armed && armed.btn === btn) { go(); return; }
    disarm();
    const cur = current();
    if (!cur.text || $('copyBtn').disabled) { show(T('errNoPrompt'), 'info', anchor); return; }
    const q = kind === 'ask' ? ($('dbwQ').value || '').trim() : '';
    if (kind === 'ask' && !q) { show(T('errQuestion'), 'info', anchor); return; }
    const hk = hostKind();
    // Claude: the AI is not sure to be able to read the context (it can in the browser and in the Code tab, not in the Desktop home
    // chat: tested), so Put in the chat AND Ask send everything in the message itself. Add to context stays a best effort.
    const wholePrompt = (kind === 'chat' || kind === 'ask') && hk === 'fill';
    const message = kind === 'ask' ? T('askBundle', { q }, page().state.prompt) + '\n\n' + cur.text : cur.text;
    const line = wholePrompt ? '' : lineFor(kind, q);
    const big = wholePrompt ? message.length > MSG_CHARS : cur.tokens > CTX_TOKENS;
    let explain;
    if (hk === 'fill') explain = kind === 'chat' ? T('chatFill') : (kind === 'ask' ? T('askFill') : T('ctxFill', { line }));
    else if (hk === 'send') explain = kind === 'chat' ? T('chatSend', { line }) : T('askSend', { line });
    else explain = kind === 'chat' ? T('chatNeutral', { line }) : T('askNeutral', { line });
    const lines = [(cur.data ? '⚠ ' + T('infoData') : '✓ ' + T('infoNoData')) + ' · ' + T('sizeLine', { chars: num(message.length), tokens: num(Math.max(cur.tokens, Math.ceil(message.length / 4))) }), explain];
    if (big) lines.push(T('warnBig', { limit: wholePrompt ? T('aboutKb', { n: '100' }) : T('aboutTokens', { n: num(16000) }) }));
    armed = { btn, kind, cls: btn.className, html: btn.innerHTML, text: cur.text, message, line, hk, anchor, whole: wholePrompt };
    btn.className = btn.className + ' ' + (cur.data ? 'dbw-armed-warn' : 'dbw-armed-ok');
    btn.innerHTML = CHECK + '<span>' + T('confirm') + '</span>';
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'btn btn-ghost btn-sm'; x.textContent = '✕';
    x.title = T('cancel'); x.setAttribute('aria-label', T('cancel'));
    x.onclick = cancel;
    btn.parentNode.insertBefore(x, btn.nextSibling);
    armed.x = x;
    show(lines.join('\n'), big ? 'err' : (cur.data ? 'warn' : 'ok'), anchor);
    armed.timer = setTimeout(cancel, ARM_MS);
  }

  function go() {
    const a = armed;
    disarm();
    if (!a) return;
    show(T('working'), 'info', a.anchor);
    const asText = (t) => ({ role: 'user', content: [{ type: 'text', text: t }] });
    const ctxText = () => request('ui/update-model-context', { content: [{ type: 'text', text: a.text }] });
    const done = (key) => () => show(T(key), 'ok', a.anchor);
    const fail = (key) => (e) => show(T(key, { e: errText(e) }), 'err', a.anchor);
    if (a.whole) {
      request('ui/message', asText(a.message)).then(done(a.kind === 'ask' ? 'doneAskFill' : 'doneChatFill'), fail('errChat'));
      return;
    }
    if (a.hk === 'fill') {
      // Claude Desktop only accepts a message sent right after the user's click ("ui/message without iframe-originated user
      // activation blocked", seen in its log): the line goes FIRST, in this very click, without waiting for the context to be
      // answered. The order does not matter to Claude, which reads the context later, when the AI asks for it.
      const sentLine = request('ui/message', asText(a.line));
      const sentCtx = ctxText();
      sentLine.then(() => sentCtx.then(done('doneCtx'), fail('errCtx')), (e) => { sentCtx.catch(() => {}); fail('errChat')(e); });
      return;
    }
    // The other hosts: the context first, then the line (ChatGPT sends the line at once, so the context must be there before it).
    ctxText().then(() => request('ui/message', asText(a.line)).then(
      done(a.hk === 'send' ? (a.kind === 'ask' ? 'doneAskSent' : 'doneChatSent') : 'doneNeutral'),
      fail('errAsk')), fail(a.kind === 'chat' ? 'errChat' : 'errCtx'));
  }

  /* ---------- downloads and links, through the host ---------- */
  const toBase64 = (blob) => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
  function sendFile(blob, name) {
    const anchor = $('copyBtn').parentNode;
    const type = (blob.type || 'application/octet-stream').split(';')[0];
    const textLike = /^text\//.test(type) || /json|xml/.test(type);
    (textLike ? blob.text().then((text) => ({ text })) : toBase64(blob).then((b) => ({ blob: b })))
      .then((part) => request('ui/download-file', { contents: [{ type: 'resource', resource: Object.assign({ uri: 'file:///' + name, mimeType: type }, part) }] }))
      .then((r) => { if (r && r.isError) show(T('dlCancelled', { name }), 'info', anchor); },
        (e) => show(T('errDownload', { name, e: errText(e) }), 'err', anchor));
  }
  function onLink(e) {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    let url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (x) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    e.preventDefault();                                  // new-tab links are blocked in the frame: the host opens them
    if (!has().links) return;
    request('ui/open-link', { url: url.href }).then(() => {}, (err) => show(T('errLink', { url: url.href, e: errText(err) }), 'err', $('copyBtn').parentNode));
  }

  /* ---------- the buttons ---------- */
  const ICON = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const buttons = [];       // { el, key } : relabelled when the language changes
  function mkBtn(id, svg, key, cls) {
    const el = document.createElement('button');
    el.type = 'button'; el.id = id; el.className = cls || 'btn btn-outline';
    el.innerHTML = ICON(svg) + '<span class="dbw-label"></span>';
    buttons.push({ el, key });
    return el;
  }
  let shownLang = null, askTitle, askHint, askInput, askBtn, hk;
  function relabel() {
    for (const b of buttons) { const s = b.el.querySelector('.dbw-label'); if (s) s.textContent = T(b.key); }
    if (askTitle) askTitle.textContent = T('askTitle');
    if (askInput) askInput.placeholder = T('askPlaceholder');
    if (askHint) askHint.textContent = T(hk === 'fill' ? 'askHintFill' : (hk === 'send' ? 'askHintSend' : 'askHintNeutral'));
  }
  function sync() {
    if (!host) return;
    const lang = page().state.ui + '/' + page().state.prompt;
    if (lang !== shownLang) { shownLang = lang; cancel(); relabel(); }
    const off = $('copyBtn').disabled;
    for (const b of buttons) b.el.disabled = off;
    reportSize();
  }

  function build() {
    hk = hostKind();
    const c = has();
    const row = $('copyBtn').parentNode, dl = $('downloadBtn');
    box = document.createElement('div');
    box.className = 'dbw-box'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    row.parentNode.insertBefore(box, row.nextSibling);
    // Put in the chat: Claude needs ui/message; the other hosts need the context and a message.
    if (hk === 'fill' ? c.message : (c.ctx && c.message)) {
      const b = mkBtn('dbwChat', '<path d="M4 5h16v11H8l-4 4z"/>', 'chatBtn');
      row.insertBefore(b, dl);
      b.onclick = () => arm(b, 'chat', row);
    }
    // Add to context: only where a message fills the message box instead of being sent, and not in the Claude Desktop home chat: the
    // AI there cannot open the widget context (tested, and confirmed by its own log: that chat is a Claude Code session of the app).
    // It is recognised by what its host announces (tested 2026-11-03): the Desktop app (platform "desktop") that offers downloads; the
    // Code tab (no downloads) and the browser (platform "web") work.
    const desktopHome = ((host.hostContext || {}).platform === 'desktop') && c.dl;
    if (hk === 'fill' && c.ctx && c.message && !desktopHome) {
      const b = mkBtn('dbwCtx', '<path d="M12 5v14M5 12h14"/>', 'ctxBtn');
      row.insertBefore(b, dl);
      b.onclick = () => arm(b, 'ctx', row);
    }
    if (c.ctx && c.message) {
      const wrap = document.createElement('div');
      wrap.className = 'dbw-ask';
      askTitle = document.createElement('label'); askTitle.className = 'dbw-ask-title'; askTitle.htmlFor = 'dbwQ';
      askInput = document.createElement('input'); askInput.type = 'text'; askInput.id = 'dbwQ'; askInput.autocomplete = 'off';
      const askRow = document.createElement('div'); askRow.className = 'dbw-ask-row';
      askBtn = mkBtn('dbwAsk', '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>', 'askBtn', 'btn btn-primary');
      askRow.appendChild(askBtn);
      askHint = document.createElement('div'); askHint.className = 'dbw-hint';
      wrap.append(askTitle, askInput, askRow, askHint);
      box.parentNode.insertBefore(wrap, box.nextSibling);
      askBtn.onclick = () => arm(askBtn, 'ask', askRow);
      askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); arm(askBtn, 'ask', askRow); } });
    }
    if (!c.dl) document.documentElement.classList.add('dbw-nodl');
    window.DataBriefHost = { save: (blob, name) => { if (!has().dl) return false; sendFile(blob, name); return true; } };
    document.addEventListener('click', onLink, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) cancel(); }, true);
    document.addEventListener('click', (e) => {
      if (armed && !armed.btn.contains(e.target) && !(armed.x && armed.x.contains(e.target))) cancel();
    }, true);
    document.addEventListener('mousedown', (e) => { if (box && box.classList.contains('err') && !box.contains(e.target)) show('', '', null); }, true);
    window.addEventListener('blur', () => { cancel(); });
    sync();
    setInterval(sync, 400);
  }

  /* ---------- start: the handshake ---------- */
  const waiting = setTimeout(() => console.warn('DataBrief widget: no host answered; the page stays as it is'), HANDSHAKE_MS);
  request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'databrief', version: VERSION }, appCapabilities: {} }).then((r) => {
    clearTimeout(waiting);
    host = r;
    const dim = (r.hostContext && r.hostContext.containerDimensions) || {};
    if (dim.maxHeight) maxHeight = dim.maxHeight;
    post({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    build();
    reportSize();
    try { new ResizeObserver(reportSize).observe(document.documentElement); } catch (e) { setInterval(reportSize, 500); }
  }, (e) => { clearTimeout(waiting); console.warn('DataBrief widget: the host refused the handshake: ' + errText(e)); });
})();
