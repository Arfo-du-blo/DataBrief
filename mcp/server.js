#!/usr/bin/env node
/*
 * DataBrief - hosted MCP server (Node.js 18+, built-in modules only, no npm install).
 *
 * It lets Claude (web, Desktop, mobile) and ChatGPT open the DataBrief page as an interactive widget inside a chat.
 * One tool (databrief_open) points at one resource (the widget page). The files users open NEVER reach this server:
 * the page reads them in the browser, inside the chat.
 *
 *   node mcp/server.js                 start, with environment variables (below) or the defaults
 *   node mcp/server.js --help          every setting
 *
 * It is stateless (Streamable HTTP, JSON answers, no session, no stream): nothing is stored, nothing is written.
 * Logs hold method names and timings only: no content, no arguments, no IP address.
 * GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');

const HERE = __dirname;
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26'];   // MCP versions spoken, newest first
const MIME = 'text/html;profile=mcp-app';
const MAX_BODY = 64 * 1024;       // requests are tiny: a tool call or a resource name
const MAX_BATCH = 20;
const DEFAULT_ORIGINS = ['https://claude.ai', 'https://claude.com', 'https://chatgpt.com'];
const MAX_KEYS = 50000;           // the flood guard remembers at most this many sources
// The log names a method only if it is one of these; anything else a client sends is logged as "other" (the log holds no client text).
const KNOWN_METHODS = new Set(['initialize', 'ping', 'notifications/initialized', 'notifications/cancelled', 'notifications/progress',
  'notifications/roots/list_changed', 'tools/list', 'tools/call', 'resources/list', 'resources/read', 'resources/templates/list',
  'resources/subscribe', 'resources/unsubscribe', 'prompts/list', 'prompts/get', 'completion/complete', 'logging/setLevel', 'server/discover']);

// name, environment variable, default, description
const SETTINGS = [
  ['port', 'DATABRIEF_MCP_PORT', '8787', 'Port to listen on'],
  ['host', 'DATABRIEF_MCP_HOST', '0.0.0.0', 'Address to listen on (127.0.0.1 = this computer only)'],
  ['widget', 'DATABRIEF_WIDGET', '', 'The widget page to serve (default: widget.html next to the server, else dist/databrief-widget.html of the repository, built by tools/build-widget.cjs)'],
  ['public-url', 'DATABRIEF_PUBLIC_URL', '', 'Public address of this server, e.g. https://databrief.example.com (used for the absolute icon address)'],
  ['rate-per-min', 'DATABRIEF_RATE_PER_MIN', '600', 'Flood guard: requests per minute per source (0 = off). Generous on purpose: Claude and ChatGPT call from shared cloud addresses'],
  ['trust-proxy-header', 'DATABRIEF_TRUST_PROXY_HEADER', '', 'Header that carries the real client address behind a proxy, e.g. CF-Connecting-IP (empty = the connection address; set it ONLY behind that proxy)'],
  ['allowed-origins', 'DATABRIEF_ALLOWED_ORIGINS', '', 'Extra browser origins allowed to call /mcp, comma-separated (server-to-server calls send no Origin and are always allowed)'],
  ['log', 'DATABRIEF_LOG', 'on', 'Request log (method names and timings only): on or off'],
];

function loadConfig(env) {
  env = env || process.env;
  const get = (name) => { const s = SETTINGS.find((x) => x[0] === name); return env[s[1]] !== undefined && env[s[1]] !== '' ? env[s[1]] : s[2]; };
  const num = (name) => { const v = Number(get(name)); if (!Number.isInteger(v) || v < 0) throw new Error(name + ' must be a whole number, 0 or more'); return v; };
  const pkgFile = [path.join(HERE, 'package.json'), path.join(HERE, '..', 'package.json')].find((f) => fs.existsSync(f));
  const builtWidget = path.join(HERE, '..', 'dist', 'databrief-widget.html');
  const widget = get('widget') || [path.join(HERE, 'widget.html'), builtWidget].find((f) => fs.existsSync(f)) || builtWidget;
  const origins = DEFAULT_ORIGINS.concat(get('allowed-origins').split(',').map((s) => s.trim()).filter(Boolean));
  return {
    port: num('port'),
    host: get('host'),
    widgetFile: widget,
    publicUrl: get('public-url').replace(/\/+$/, ''),
    ratePerMin: num('rate-per-min'),
    trustProxyHeader: get('trust-proxy-header').toLowerCase(),
    origins,
    log: get('log') !== 'off',
    version: pkgFile ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version : '0.0.0',
    urisFile: path.join(HERE, 'uris.json'),
    homeTextsFile: path.join(HERE, 'home-i18n.json'),
    iconFile: path.join(HERE, 'icon.svg'),
  };
}

// The home page (/): the look of the tool itself (same colours, font, header, buttons, chips, cards and footer), its 15 languages and the same stored choices
// (language and theme: what is chosen here is what the tool at /app opens with, and the other way round). What DataBrief is, a button to the tool, and how to add
// the connector to Claude or ChatGPT. English is the default and is in the page itself; the other languages (mcp/home-i18n.json, written by tools/build-home-i18n.cjs)
// travel in a JSON block. One inline script (language, theme, Copy) is allowed by the hash of its text in the page's own Content-Security-Policy; the page loads
// nothing from outside, and puts every text in with textContent.
const HOME_SCRIPT = [
  "(function(){var d=document,r=d.documentElement,K='databrief.ui',T='databrief.theme';",
  "function g(k){try{return localStorage.getItem(k)}catch(e){return null}}function s(k,v){try{localStorage.setItem(k,v)}catch(e){}}",
  "var th=g(T);if(th==='light'||th==='dark')r.setAttribute('data-theme',th);",
  "d.addEventListener('DOMContentLoaded',function(){",
  "var D=JSON.parse(d.getElementById('i18n').textContent),X=D.texts,en=X.en,lang='en',sel=d.getElementById('uiLang'),tl=d.getElementById('toolLink'),cp=d.getElementById('copy'),ad=d.getElementById('addr'),tb=d.getElementById('themeBtn');",
  "function md(el,v){el.textContent='';v.split('*').forEach(function(p,i){if(!p)return;if(i%2){var e=d.createElement('em');e.textContent=p;el.appendChild(e)}else{el.appendChild(d.createTextNode(p))}})}",
  "function tx(k){var v=X[lang][k];return(v===undefined?en[k]:v).replace('{v}',D.version)}",
  "function apply(c){lang=X[c]?c:'en';r.setAttribute('lang',lang);r.setAttribute('dir',D.rtl.indexOf(lang)>=0?'rtl':'ltr');",
  "d.querySelectorAll('[data-i18n]').forEach(function(el){var k=el.getAttribute('data-i18n');if(el.hasAttribute('data-md')){md(el,tx(k))}else{el.textContent=tx(k)}});",
  "d.querySelectorAll('[data-i18n-aria]').forEach(function(el){el.setAttribute('aria-label',tx(el.getAttribute('data-i18n-aria')))});",
  "sel.value=lang;tl.setAttribute('href','/app?lang='+lang)}",
  "apply(g(K));d.getElementById('uiLangWrap').hidden=false;sel.onchange=function(){s(K,sel.value);apply(sel.value)};",
  "tb.hidden=false;tb.onclick=function(){var c=r.getAttribute('data-theme')||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),n=c==='dark'?'light':'dark';r.setAttribute('data-theme',n);s(T,n)};",
  "cp.hidden=false;cp.onclick=function(){ad.select();var k=function(){cp.classList.add('done');cp.lastChild.textContent=tx('copied');setTimeout(function(){cp.classList.remove('done');cp.lastChild.textContent=tx('copy')},1800)};",
  "if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ad.value).then(k,function(){try{d.execCommand('copy')}catch(e){}k()})}else{try{d.execCommand('copy')}catch(e){}k()}}",
  "});})();",
].join('');
const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const GUIDE = 'https://github.com/Arfo-du-blo/DataBrief/blob/main/docs/';
// The styles are the tool's own (src/styles.css): the same variables in the light and dark themes, the same hero, buttons, chips, cards, language and theme buttons and footer.
const HOME_CSS = ':root{--bg:#f6f6f7;--surface:#ffffff;--surface-2:#f1f1f3;--text:#18181b;--text-2:#52525b;--muted:#71717a;--border:#e4e4e7;--border-strong:#d4d4d8;--accent:#4f5bd5;--accent-hover:#4350c4;--accent-soft:#eef0fc;--accent-text:#ffffff;--ok:#1f7a4d;' +
  '--shadow:0 1px 2px rgba(16,16,24,.04),0 4px 16px rgba(16,16,24,.05);--radius:14px;--font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"Cascadia Code","SF Mono",Menlo,Consolas,"Liberation Mono",monospace;color-scheme:light}' +
  '@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e0f11;--surface:#16171a;--surface-2:#1d1e22;--text:#ececee;--text-2:#b4b4bb;--muted:#8b8b94;--border:#2a2b30;--border-strong:#3a3b42;--accent:#8c96f2;--accent-hover:#a2abf6;--accent-soft:#23253a;--accent-text:#0e0f11;--ok:#6fd3a0;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);color-scheme:dark}}' +
  ':root[data-theme="dark"]{--bg:#0e0f11;--surface:#16171a;--surface-2:#1d1e22;--text:#ececee;--text-2:#b4b4bb;--muted:#8b8b94;--border:#2a2b30;--border-strong:#3a3b42;--accent:#8c96f2;--accent-hover:#a2abf6;--accent-soft:#23253a;--accent-text:#0e0f11;--ok:#6fd3a0;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);color-scheme:dark}' +
  '*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column}' +
  'button,input,select{font:inherit;color:inherit}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}a{color:var(--accent)}[hidden]{display:none!important}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
  '.topbar{display:flex;justify-content:flex-end;gap:8px;padding:14px 16px 0}[dir="rtl"] .topbar{justify-content:flex-start}' +
  '.control{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;background:var(--surface);border:1px solid var(--border);border-radius:9px;color:var(--text-2)}.control svg{width:16px;height:16px;flex:none}' +
  '.control select{border:0;background:transparent;outline:none;cursor:pointer;max-width:9.5rem}.control select option{background:var(--surface);color:var(--text)}' +
  '.icon-btn{width:34px;padding:0;justify-content:center;cursor:pointer}.icon-btn:hover,.control:hover{border-color:var(--border-strong);color:var(--text)}' +
  'main{width:100%;max-width:780px;margin:0 auto;padding:8px 16px 32px;flex:1}.hero{text-align:center;padding:28px 0 18px}' +
  '.brand{display:inline-flex;align-items:center;gap:10px;margin:0;font-size:30px;font-weight:700;letter-spacing:-.02em}.brand-mark{width:34px;height:34px;border-radius:10px;background:var(--accent);color:var(--accent-text);display:grid;place-items:center}.brand-mark svg{width:20px;height:20px}' +
  '.tagline{margin:10px 0 6px;font-size:18px;font-weight:500}.purpose{margin:0 auto;max-width:600px;color:var(--text-2)}' +
  '.privacy{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:4px 12px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:13px;font-weight:500}.privacy svg{width:14px;height:14px;flex:none}' +
  '.cta{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:22px 0 6px}' +
  '.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:10px;border:1px solid transparent;cursor:pointer;font-weight:500;font-size:14px;text-decoration:none;transition:background .15s,border-color .15s}.btn svg{width:16px;height:16px;flex:none}[dir="rtl"] .btn svg.dir{transform:scaleX(-1)}' +
  '.btn-lg{height:46px;padding:0 24px;font-size:15px}.btn-primary{background:var(--accent);color:var(--accent-text)}.btn-primary:hover{background:var(--accent-hover)}.btn-outline{background:var(--surface);border-color:var(--border-strong);color:var(--text)}.btn-outline:hover{border-color:var(--accent);color:var(--accent)}.btn.done{background:var(--ok);border-color:var(--ok);color:#fff}' +
  '.formats{text-align:center;margin:18px 0 6px}.formats-title{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px}.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}' +
  '.chip{font-family:var(--mono);font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text-2)}' +
  '.card{margin-top:22px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}.card-body{padding:22px 24px}.card h2{margin:0 0 6px;font-size:20px;text-align:center}.card .lead{margin:0 auto 16px;max-width:560px;text-align:center;color:var(--text-2)}' +
  '.addr{display:flex;gap:8px;max-width:560px;margin:0 auto}.addr input{flex:1;min-width:0;height:40px;padding:0 12px;border:1px solid var(--border-strong);border-radius:10px;background:var(--surface-2);font-family:var(--mono);font-size:13px;direction:ltr;text-align:left}' +
  '.steps{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.step{background:var(--surface-2);border-radius:12px;padding:14px 16px}.step h3{margin:0 0 6px;font-size:15px}.step ol{margin:0;padding-inline-start:18px;color:var(--text-2);font-size:14px}.step li{margin:3px 0}.step em{font-style:normal;color:var(--text);font-weight:500}' +
  '.links{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:18px}.links a{font-size:14px;text-decoration:none;padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text-2)}.links a:hover{border-color:var(--accent);color:var(--accent)}.links a::after{content:" \\2197";opacity:.7}' +
  '.verify{margin:20px auto 0;max-width:600px;text-align:center;font-size:13px;color:var(--muted)}.verify summary{cursor:pointer;display:inline-block}.verify p{margin:8px 0 0}.verify code{font-family:var(--mono);font-size:12px;word-break:break-all;background:var(--surface-2);padding:2px 6px;border-radius:6px;direction:ltr;unicode-bidi:isolate}' +
  'footer{text-align:center;color:var(--muted);font-size:13px;padding:20px 16px 28px}footer a{color:inherit}footer .sep{margin:0 6px;opacity:.6}footer .powered{font-weight:600;color:var(--text-2)}' +
  '@media(max-width:560px){.steps{grid-template-columns:1fr}.card-body{padding:18px 16px}.addr{flex-direction:column}.addr input{flex:none;width:100%}.addr .btn{width:100%}.cta .btn{flex:1 1 100%}.brand{font-size:26px}}';
const svg = (inner, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + inner + '</svg>';
const ICON_ARROW = svg('<path d="M5 12h14M13 6l6 6-6 6"/>', ' class="dir"');
const ICON_COPY = svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>');
const ICON_DOWN = svg('<path d="M12 5v14M6 13l6 6 6-6"/>');
function homePage(o) {   // o: { publicUrl, version, sha, i18n: { langs, texts } }
  const address = (o.publicUrl || 'https://YOUR-SERVER') + '/mcp';
  const en = o.i18n.texts.en;
  const T = (k) => escapeHtml(en[k].replace('{v}', o.version));
  const M = (k) => escapeHtml(en[k]).replace(/\*([^*]+)\*/g, '<em>$1</em>');   // *bold* words of the steps
  const FORMATS = ['CSV', 'Excel', 'Parquet', 'SQLite', 'SQL dumps', 'JSON', 'PDF', 'Word', 'Access', 'Avro', 'Notebooks'];
  const options = o.i18n.langs.map((l) => '<option value="' + l.code + '"' + (l.code === 'en' ? ' selected' : '') + '>' + escapeHtml(l.name) + '</option>').join('');
  const data = JSON.stringify({ version: o.version, rtl: o.i18n.langs.filter((l) => l.rtl).map((l) => l.code), texts: o.i18n.texts }).replace(/</g, '\\u003c');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">' +
    '<title>DataBrief</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><style>' + HOME_CSS + '</style><script>' + HOME_SCRIPT + '</script></head><body>' +
    '<div class="topbar"><label class="control" id="uiLangWrap" hidden>' + svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') + '<span class="sr-only" data-i18n="uiLang">' + T('uiLang') + '</span><select id="uiLang">' + options + '</select></label>' +
    '<button class="control icon-btn" id="themeBtn" type="button" hidden data-i18n-aria="theme" aria-label="' + T('theme') + '">' + svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>') + '</button></div>' +
    '<main><header class="hero"><h1 class="brand"><span class="brand-mark">' + svg('<path d="M6 7h12M6 12h12M6 17h7"/>') + '</span>DataBrief</h1>' +
    '<p class="tagline" data-i18n="tagline">' + T('tagline') + '</p>' +
    '<p class="purpose" data-i18n="purpose">' + T('purpose') + '</p>' +
    '<div class="privacy">' + svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>') + '<span data-i18n="privacy">' + T('privacy') + '</span></div>' +
    '<div class="cta"><a class="btn btn-primary btn-lg" id="toolLink" href="/app"><span data-i18n="openTool">' + T('openTool') + '</span>' + ICON_ARROW + '</a><a class="btn btn-outline btn-lg" href="#connector"><span data-i18n="useChat">' + T('useChat') + '</span>' + ICON_DOWN + '</a></div></header>' +
    '<section class="formats"><div class="formats-title" data-i18n="accepted">' + T('accepted') + '</div><div class="chips">' + FORMATS.map((f) => '<span class="chip">' + escapeHtml(f) + '</span>').join('') + '<span class="chip" data-i18n="moreFormats">' + T('moreFormats') + '</span></div></section>' +
    '<section class="card" id="connector"><div class="card-body"><h2 data-i18n="useChat">' + T('useChat') + '</h2>' +
    '<p class="lead" data-i18n="cardLead">' + T('cardLead') + '</p>' +
    '<div class="addr"><input id="addr" readonly value="' + escapeHtml(address) + '" data-i18n-aria="addrLabel" aria-label="' + T('addrLabel') + '"><button class="btn btn-primary" id="copy" type="button" hidden>' + ICON_COPY + '<span data-i18n="copy">' + T('copy') + '</span></button></div>' +
    '<div class="steps"><div class="step"><h3>Claude</h3><ol><li data-i18n="c1" data-md>' + M('c1') + '</li><li data-i18n="c2" data-md>' + M('c2') + '</li><li data-i18n="c3" data-md>' + M('c3') + '</li><li data-i18n="c4" data-md>' + M('c4') + '</li><li data-i18n="c5" data-md>' + M('c5') + '</li></ol></div>' +
    '<div class="step"><h3>ChatGPT</h3><ol><li data-i18n="g1" data-md>' + M('g1') + '</li><li data-i18n="g2" data-md>' + M('g2') + '</li><li data-i18n="g3" data-md>' + M('g3') + '</li><li data-i18n="g4" data-md>' + M('g4') + '</li><li data-i18n="g5" data-md>' + M('g5') + '</li></ol></div></div>' +
    '<div class="links"><a href="' + GUIDE + 'connector.md" target="_blank" rel="noopener noreferrer" data-i18n="linkGuide">' + T('linkGuide') + '</a><a href="' + GUIDE + 'privacy.md" target="_blank" rel="noopener noreferrer" data-i18n="linkPrivacy">' + T('linkPrivacy') + '</a><a href="' + GUIDE + 'support.md" target="_blank" rel="noopener noreferrer" data-i18n="linkSupport">' + T('linkSupport') + '</a><a href="https://github.com/Arfo-du-blo/DataBrief" target="_blank" rel="noopener noreferrer" data-i18n="linkSource">' + T('linkSource') + '</a></div></div></section>' +
    '<details class="verify"><summary data-i18n="verifyTitle">' + T('verifyTitle') + '</summary><p data-i18n="verifyText">' + T('verifyText') + '</p><p><code>' + escapeHtml(o.sha) + '</code></p></details>' +
    '</main><footer><span class="powered">Powered by <a href="https://github.com/Arfo-du-blo/DataBrief" target="_blank" rel="noopener noreferrer">L\'Arfo</a></span><span class="sep">·</span><span data-i18n="footer">' + T('footer') + '</span><span class="sep">·</span><span data-i18n="license">' + T('license') + '</span></footer>' +
    '<script type="application/json" id="i18n">' + data + '</script></body></html>';
  const csp = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'sha256-" + crypto.createHash('sha256').update(HOME_SCRIPT).digest('base64') + "'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  return { html, csp };
}

function makeLimiter(perMin, maxKeys) {
  maxKeys = maxKeys || MAX_KEYS;
  const hits = new Map();
  let sweepAt = Date.now() + 60000, fullSweepAt = 0;
  // Returns 0 when allowed, else the seconds to wait.
  return (key, cost) => {
    if (!perMin) return 0;
    const now = Date.now();
    // the table is cleaned once a minute, and when it is full at most once a second (a full table must not cost a whole scan per request)
    if (now > sweepAt || (hits.size >= maxKeys && now >= fullSweepAt)) { for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); sweepAt = now + 60000; fullSweepAt = now + 1000; }
    // Never forget the counters to make room (a flood of new addresses would reset every limit): when full, new sources share one counter.
    if (!hits.has(key) && hits.size >= maxKeys) key = '\u0000overflow';
    let e = hits.get(key);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + 60000 }; hits.set(key, e); }
    e.n += cost;
    return e.n <= perMin ? 0 : Math.max(1, Math.ceil((e.reset - now) / 1000));
  };
}

// The proxy's header is believed only when the connection itself comes from this machine or a private network (the tunnel, a reverse
// proxy, Docker's network): anyone who reaches the port directly could write any address in it.
const isPrivate = (a) => {
  a = String(a || '').toLowerCase().replace(/^::ffff:/, '');
  return a === '::1' || /^127\./.test(a) || /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe80:/.test(a);
};
// One IPv6 network (/64) is one source: a single computer usually holds a whole /64 and could otherwise fill the table alone.
const sourceOf = (a) => {
  a = String(a || '').trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  if (!a.includes(':') || a === '::1') return a || '?';
  const head = a.split('::')[0].split(':').filter(Boolean);
  const tail = a.includes('::') ? a.split('::')[1].split(':').filter(Boolean) : [];
  const groups = a.includes('::') ? head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail) : head;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=[0-9a-f])/, '')).join(':') + '::/64';
};
function sourceKey(req, header) {
  const direct = req.socket.remoteAddress;
  const said = header && isPrivate(direct) ? String(req.headers[header] || '').split(',')[0].trim() : '';
  return sourceOf(said || direct);
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[^\w ./-]/g, '').slice(0, 40) : '');

// The server. Throws (with a clear message) if the widget page is missing: a server without its page is useless.
function createServer(config, logger) {
  if (!fs.existsSync(config.widgetFile)) {
    throw new Error('The widget page does not exist: ' + config.widgetFile + '. Build it with node tools/build-widget.cjs (dist/databrief-widget.html) or point DATABRIEF_WIDGET at a file.');
  }
  const widget = fs.readFileSync(config.widgetFile, 'utf8');
  const widgetSha = crypto.createHash('sha256').update(widget).digest('hex');
  const widgetBuf = Buffer.from(widget, 'utf8');
  const widgetGz = zlib.gzipSync(widgetBuf, { level: 9 });   // /app: compressed once at start (about a quarter of the size)
  if (!fs.existsSync(config.homeTextsFile)) throw new Error('The home page texts do not exist: ' + config.homeTextsFile + ' (node tools/build-home-i18n.cjs writes mcp/home-i18n.json).');
  const home = homePage({ publicUrl: config.publicUrl, version: config.version, sha: widgetSha, i18n: JSON.parse(fs.readFileSync(config.homeTextsFile, 'utf8')) });
  const uris = JSON.parse(fs.readFileSync(config.urisFile, 'utf8'));
  const allUris = [uris.current].concat(uris.previous || []);
  const iconSvg = fs.readFileSync(config.iconFile, 'utf8');
  const icons = [{ src: 'data:image/svg+xml;base64,' + Buffer.from(iconSvg).toString('base64'), mimeType: 'image/svg+xml', sizes: ['any'] }];
  if (config.publicUrl) icons.unshift({ src: config.publicUrl + '/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] });
  const log = config.log ? (logger || ((o) => process.stdout.write(JSON.stringify(o) + '\n'))) : () => {};
  const limiter = makeLimiter(config.ratePerMin);

  const RESOURCE_META = { ui: { prefersBorder: true, permissions: { clipboardWrite: {} } } };
  const TOOL = {
    name: 'databrief_open',
    title: 'DataBrief',
    // Facts only (the directory's review rejects descriptions that tell the AI how to behave): what the tool shows, what happens to the file, what the widget offers.
    description: 'Opens DataBrief as a widget in the chat. The user picks a data file in it (CSV, Excel, Parquet, SQLite, SQL dump, PDF, Word and many more formats) and turns it into a prompt that describes the file, with an option to leave every record out. ' +
      'The file is read in the user\'s browser and never reaches this server. Takes no arguments. ' +
      'The widget has the buttons Put in the chat, Add to context and Ask about this data; a prompt added to the context is available through the host\'s read_widget_context tool.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'DataBrief', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: uris.current }, 'ui/resourceUri': uris.current },
  };
  const TOOL_TEXT = 'DataBrief is open in the chat as a widget. The user chooses a file in it; the file is read on their computer and never reaches this server. ' +
    'The widget offers Put in the chat, Add to context and Ask about this data; a prompt added to the context is available through read_widget_context.';
  const INSTRUCTIONS = 'DataBrief shows a page in the chat where the user picks a data file and turns it into a prompt that describes it, with an option to leave every record out.';

  // One JSON-RPC message in, one answer (or null) out. info collects what the log may say: method names, never content.
  function handle(msg, info) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return rpcError(msg && msg.id, -32600, 'Invalid Request');
    if (typeof msg.method !== 'string') return ('result' in msg || 'error' in msg) ? null : rpcError(null, -32600, 'Invalid Request');
    info.methods.push(KNOWN_METHODS.has(msg.method) ? msg.method : 'other');
    if (!('id' in msg)) return null;   // a notification
    // MCP: a request id is a string or a number, never null, an object or a list
    if (!(typeof msg.id === 'string' || (typeof msg.id === 'number' && Number.isFinite(msg.id)))) return rpcError(null, -32600, 'Invalid Request');
    const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
    switch (msg.method) {
      case 'initialize':
        info.client = cleanName(p.clientInfo && p.clientInfo.name);
        return rpcResult(msg.id, {
          protocolVersion: SUPPORTED.includes(p.protocolVersion) ? p.protocolVersion : SUPPORTED[0],
          capabilities: { tools: { listChanged: false }, resources: {} },
          serverInfo: { name: 'databrief', title: 'DataBrief', version: config.version, icons, websiteUrl: 'https://github.com/Arfo-du-blo/DataBrief' },
          instructions: INSTRUCTIONS,
        });
      case 'ping': return rpcResult(msg.id, {});
      case 'tools/list': return rpcResult(msg.id, { tools: [TOOL] });
      case 'tools/call':
        if (p.name === TOOL.name) { info.tool = TOOL.name; return rpcResult(msg.id, { content: [{ type: 'text', text: TOOL_TEXT }] }); }
        return rpcError(msg.id, -32602, 'Unknown tool');
      case 'resources/list':
        return rpcResult(msg.id, { resources: [{ uri: uris.current, name: 'databrief-widget', title: 'DataBrief', mimeType: MIME, _meta: RESOURCE_META }] });
      case 'resources/templates/list': return rpcResult(msg.id, { resourceTemplates: [] });
      case 'resources/read':
        // the page is large (megabytes): one per HTTP request, so a small batch cannot ask for it twenty times
        if (allUris.includes(p.uri) && info.read) return rpcError(msg.id, -32600, 'One resources/read of the page per request');
        if (allUris.includes(p.uri)) { info.read = true; return rpcResult(msg.id, { contents: [{ uri: p.uri, mimeType: MIME, text: widget, _meta: RESOURCE_META }] }); }
        return rpcError(msg.id, -32002, 'Resource not found');
      default: return rpcError(msg.id, -32601, 'Method not found');
    }
  }

  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    const info = { methods: [], tool: null, client: '', read: false };
    const route = (req.url || '/').split('?')[0];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.on('finish', () => {
      if (route !== '/mcp' && route !== '/healthz') return;
      const ua = String(req.headers['user-agent'] || '').split(/[\s/]/)[0].replace(/[^\w.-]/g, '').slice(0, 30);
      log({ t: new Date(t0).toISOString(), route, http: res.statusCode, ms: Date.now() - t0, methods: info.methods.join(','), tool: info.tool || undefined, client: info.client || undefined, ua: ua || undefined });
    });
    const send = (status, body, headers) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      res.writeHead(status, Object.assign({ 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
      res.end(req.method === 'HEAD' ? undefined : text);
    };

    if (route === '/healthz') return send(200, 'ok\n');
    if (route === '/icon.svg' || route === '/favicon.ico' || route === '/favicon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      return res.end(req.method === 'HEAD' ? undefined : iconSvg);
    }
    if (route === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': home.csp });
      return res.end(req.method === 'HEAD' ? undefined : home.html);
    }
    // /app: the DataBrief page itself (the same file the chat apps get as the widget; outside a chat its layer does nothing). It is large, so it counts five requests for
    // the flood guard (one when the browser's copy is current: 304), carries the hash as its ETag and is sent compressed when the browser accepts it.
    if (route === '/app') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed: GET only\n', { Allow: 'GET, HEAD' });
      const etag = '"' + widgetSha + '"';
      const current = String(req.headers['if-none-match'] || '').split(',').map((t) => t.trim()).includes(etag);
      const waitApp = limiter(sourceKey(req, config.trustProxyHeader), current ? 1 : 5);
      if (waitApp) return send(429, 'Too many requests\n', { 'Retry-After': String(waitApp) });
      const headers = { 'Content-Type': 'text/html; charset=utf-8', ETag: etag, 'Cache-Control': 'no-cache', 'Content-Security-Policy': "frame-ancestors 'none'", Vary: 'Accept-Encoding' };
      if (current) { res.writeHead(304, headers); return res.end(); }
      const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
      if (gz) headers['Content-Encoding'] = 'gzip';
      const body = gz ? widgetGz : widgetBuf;
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (route !== '/mcp') return send(404, 'Not found\n');

    // /mcp: stateless Streamable HTTP. POST only; no stream (GET), no session to close (DELETE).
    // A call from a web page carries an Origin: only the allowed ones pass, with the CORS answers a browser needs (preflight included).
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) return send(403, rpcError(null, -32000, 'Origin not allowed'));
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Expose-Headers', 'Retry-After'); }
    if (req.method === 'OPTIONS' && origin) {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    if (req.method !== 'POST') return send(405, rpcError(null, -32000, 'Method not allowed: POST only'), { Allow: 'POST' });
    const key = sourceKey(req, config.trustProxyHeader);
    let wait = limiter(key, 1);
    if (wait) return send(429, rpcError(null, -32000, 'Too many requests'), { 'Retry-After': String(wait) });
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY) { res.setHeader('Connection', 'close'); return send(413, rpcError(null, -32000, 'Request too large')); }

    const chunks = [];
    let size = 0, tooBig = false;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { tooBig = true; return; } chunks.push(c); });
    req.on('error', () => {});
    req.on('end', () => {
      if (tooBig) { res.setHeader('Connection', 'close'); return send(413, rpcError(null, -32000, 'Request too large')); }
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(400, rpcError(null, -32700, 'Parse error')); }
      const batch = Array.isArray(parsed);
      const list = batch ? parsed : [parsed];
      if (!list.length || list.length > MAX_BATCH) return send(400, rpcError(null, -32600, 'Invalid Request'));
      const isInit = list.some((m) => m && m.method === 'initialize');
      const ver = req.headers['mcp-protocol-version'];
      if (ver && !isInit && !SUPPORTED.includes(ver)) return send(400, rpcError(null, -32600, 'Unsupported MCP-Protocol-Version'));
      const answers = list.map((m) => handle(m, info)).filter((a) => a !== null);
      if (info.read && (wait = limiter(key, 4))) return send(429, rpcError(null, -32000, 'Too many requests'), { 'Retry-After': String(wait) });   // the page is heavy: counts 5
      if (!answers.length) { res.writeHead(202, { 'Cache-Control': 'no-store' }); return res.end(); }
      send(200, batch ? answers : answers[0]);
    });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 20000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 512;
  server.databrief = { widgetSha, widgetBytes: Buffer.byteLength(widget), uris: allUris };
  return server;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('DataBrief hosted MCP server. Settings (environment variables):\n\n' + SETTINGS.map((s) => '  ' + s[1].padEnd(30) + s[3] + ' (default: ' + (s[2] || 'none') + ')').join('\n') + '\n');
    return;
  }
  let config, server;
  try { config = loadConfig(); server = createServer(config); } catch (e) { process.stderr.write('databrief-mcp: ' + e.message + '\n'); process.exit(1); }
  server.on('error', (e) => { process.stderr.write('databrief-mcp: ' + (e.code === 'EADDRINUSE' ? 'port ' + config.port + ' is already in use' : e.message) + '\n'); process.exit(1); });
  server.listen(config.port, config.host, () => {
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), started: 'databrief-mcp', version: config.version, listen: config.host + ':' + config.port, widgetBytes: server.databrief.widgetBytes, widgetSha256: server.databrief.widgetSha, uris: server.databrief.uris }) + '\n');
  });
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) main();
module.exports = { createServer, loadConfig, makeLimiter, sourceOf, isPrivate, SETTINGS, SUPPORTED, MAX_BODY };
