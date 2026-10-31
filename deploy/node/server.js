#!/usr/bin/env node
/*
 * DataBrief - small web server for teams (Node.js 18+, built-in modules only, no npm install).
 *
 * It serves databrief.html with your team settings written into it. The data files users open
 * never reach this server: DataBrief works entirely in the browser.
 *
 *   node server.js                     start with databrief.conf / environment variables / defaults
 *   node server.js --setup             answer a few questions (and optionally save them), then start
 *   node server.js --port 9000 --lang fr --lock lang,mode
 *   node server.js --help              every option
 *
 * Settings priority: command-line option > environment variable > databrief.conf > built-in default.
 * GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');

const HERE = __dirname;
const LANGS = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'zh', 'ja', 'ko', 'hi', 'ar'];
const LOCKABLE = ['lang', 'promptLang', 'mode', 'layout', 'theme', 'limit', 'edit', 'view'];

// name, environment variable, default, page config key (null = server setting), question for --setup
const SETTINGS = [
  ['lang', 'DATABRIEF_LANG', '', 'lang', `Interface language (${LANGS.join(' ')}; empty = visitor's choice)`],
  ['prompt-lang', 'DATABRIEF_PROMPT_LANG', '', 'promptLang', 'Prompt language (same codes; empty = same as the interface)'],
  ['mode', 'DATABRIEF_MODE', 'inline', 'mode', 'Give the data to the AI: inline (inside the prompt) or files (separate CSV files)'],
  ['layout', 'DATABRIEF_LAYOUT', 'auto', 'layout', 'Data layout: auto, table or csv'],
  ['theme', 'DATABRIEF_THEME', 'system', 'theme', 'Theme: system, light or dark'],
  ['sample-rows', 'DATABRIEF_SAMPLE_ROWS', '5', 'sampleRows', 'Sample rows per section in CSV-files mode (1-100)'],
  ['warn-tokens', 'DATABRIEF_WARN_TOKENS', '150000', 'warnTokens', 'Large-file warning above how many tokens'],
  ['lock', 'DATABRIEF_LOCK', '', 'lock', `Settings to lock, comma-separated (${LOCKABLE.join(',')}; empty = none)`],
  ['prompt-intro', 'DATABRIEF_PROMPT_INTRO', '', 'promptIntro', null],
  ['prompt-respond', 'DATABRIEF_PROMPT_RESPOND', '', 'promptRespond', null],
  ['prompt-respond-files', 'DATABRIEF_PROMPT_RESPOND_FILES', '', 'promptRespondFiles', null],
  ['host', 'DATABRIEF_HOST', '0.0.0.0', null, 'Address to listen on (0.0.0.0 = whole network, 127.0.0.1 = this computer only)'],
  ['port', 'DATABRIEF_PORT', '8080', null, 'Port'],
  ['max-connections', 'DATABRIEF_MAX_CONNECTIONS', '256', null, 'Maximum open connections'],
  ['base-path', 'DATABRIEF_BASE_PATH', '/', null, 'URL path, e.g. / or /databrief/'],
  ['access-log', 'DATABRIEF_ACCESS_LOG', 'true', null, 'Log every request (true/false)'],
  ['frame-ancestors', 'DATABRIEF_FRAME_ANCESTORS', "'self'", null, "Sites allowed to embed DataBrief in a frame ('self' = none other)"],
  ['html', 'DATABRIEF_HTML', '', null, null],
];
const BY_NAME = Object.fromEntries(SETTINGS.map((s) => [s[0], s]));

/* ---------------------------------------------------------------- config file ---------- */
function confUnquote(v) {
  v = v.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[c] || m));
  }
  return v;
}
function confQuote(v) {
  v = String(v);
  return v === '' || /[\s"#\\]/.test(v)
    ? '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"'
    : v;
}
function readConf(file) {
  const out = {};
  for (let line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = confUnquote(line.slice(i + 1));
  }
  return out;
}
function writeConf(file, values) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const done = new Set();
  lines.forEach((line, i) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1] in values) { lines[i] = m[1] + '=' + confQuote(values[m[1]]); done.add(m[1]); }
  });
  for (const [k, v] of Object.entries(values)) if (!done.has(k)) lines.push(k + '=' + confQuote(v));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
function findConf(explicit) {
  if (explicit) return explicit;
  for (const p of [process.env.DATABRIEF_CONFIG, path.join(process.cwd(), 'databrief.conf'), path.join(HERE, '..', 'databrief.conf'), '/config/databrief.conf']) {
    if (p && isFile(p)) return path.resolve(p);
  }
  return null;
}
function findHtml(explicit) {
  for (const p of [explicit, path.join(process.cwd(), 'databrief.html'), path.join(HERE, 'databrief.html'), path.join(HERE, '..', '..', 'databrief.html'), '/app/databrief.html']) {
    if (p && isFile(p)) return path.resolve(p);
  }
  return null;
}

/* ---------------------------------------------------------------- arguments ------------ */
function parseArgs(argv) {
  const a = { cli: {}, setup: false, check: false, help: false, config: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === 'setup' || t === '--setup') a.setup = true;
    else if (t === '--check') a.check = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else if (t.startsWith('--')) {
      let [name, val] = t.slice(2).split(/=(.*)/s);
      if (val === undefined) val = argv[++i];
      if (name === 'config') a.config = val;
      else if (BY_NAME[name]) a.cli[name] = val === undefined ? '' : val;
      else throw new Error('Unknown option --' + name + ' (see --help)');
    } else throw new Error('Unexpected argument: ' + t);
  }
  return a;
}
function help() {
  console.log('DataBrief web server. Options (priority: option > environment > databrief.conf > default):\n');
  console.log('  --setup                  ask questions, optionally save them to databrief.conf, then start');
  console.log('  --config PATH            path of databrief.conf');
  console.log('  --check                  validate the settings and exit');
  for (const [name, env, def, , q] of SETTINGS) {
    console.log(`  --${name.padEnd(22)} ${(q || name).split(' (')[0]} [env ${env}, default ${def || 'empty'}]`);
  }
}

/* ---------------------------------------------------------------- settings ------------- */
function resolve(args) {
  const confPath = findConf(args.config);
  // --config may name a file that does not exist yet: --setup creates it.
  const conf = confPath && isFile(confPath) ? readConf(confPath) : {};
  const eff = {};
  for (const [name, env, def] of SETTINGS) {
    if (args.cli[name] !== undefined) eff[name] = String(args.cli[name]);
    else if (process.env[env]) eff[name] = process.env[env]; // an empty variable counts as "not set"
    else if (conf[env] !== undefined && conf[env] !== '') eff[name] = conf[env];
    else eff[name] = def;
  }
  return { eff, confPath };
}
const splitList = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean);
function validate(eff) {
  const errors = [];
  for (const k of ['lang', 'prompt-lang']) if (eff[k] && !LANGS.includes(eff[k])) errors.push(`${BY_NAME[k][1]}: '${eff[k]}' is not one of ${LANGS.join(' ')}`);
  const choices = { mode: ['inline', 'files'], layout: ['auto', 'table', 'csv'], theme: ['system', 'light', 'dark'] };
  for (const [k, allowed] of Object.entries(choices)) if (!allowed.includes(eff[k])) errors.push(`${BY_NAME[k][1]}: '${eff[k]}' must be one of ${allowed.join(', ')}`);
  for (const [k, lo, hi] of [['sample-rows', 1, 100], ['warn-tokens', 1000, 100000000], ['port', 1, 65535], ['max-connections', 1, 1000000]]) {
    const n = Number(eff[k]);
    if (!/^\d+$/.test(String(eff[k]).trim()) || n < lo || n > hi) errors.push(`${BY_NAME[k][1]}: '${eff[k]}' must be a number from ${lo} to ${hi}`);
  }
  const bad = splitList(eff.lock).filter((x) => !LOCKABLE.includes(x));
  if (bad.length) errors.push(`DATABRIEF_LOCK: unknown ${bad.join(', ')} (allowed: ${LOCKABLE.join(', ')})`);
  if (!['true', 'false', '1', '0', 'yes', 'no'].includes(String(eff['access-log']).toLowerCase())) errors.push('DATABRIEF_ACCESS_LOG: must be true or false');
  if (!eff['base-path'].startsWith('/')) errors.push('DATABRIEF_BASE_PATH: must start with /');
  return errors;
}
function pageConfig(eff) {
  const c = {};
  for (const [name, , def, key] of SETTINGS) {
    if (!key) continue;
    const v = eff[name];
    if (key === 'lock') { if (splitList(v).length) c.lock = splitList(v); }
    else if (key === 'sampleRows' || key === 'warnTokens') { if (v !== def) c[key] = parseInt(v, 10); }
    else if (v && v !== def) c[key] = v;
  }
  return c;
}
const BLOCK = /(<script id="databrief-config" type="application\/json">)[\s\S]*?(<\/script>)/;
function inject(html, config) {
  const data = JSON.stringify(config, null, 2).replace(/</g, '\\u003c');
  if (!BLOCK.test(html)) throw new Error('This databrief.html has no settings block: rebuild it with build.ps1.');
  return html.replace(BLOCK, (m, open, close) => open + '\n' + data + '\n' + close);
}

/* ---------------------------------------------------------------- setup ---------------- */
const inDocker = () => fs.existsSync('/.dockerenv') || process.env.DATABRIEF_IN_DOCKER === '1';
async function setup(eff, confPath) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  let waiting = null;
  let closed = false;
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
  rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(''); } });
  const ask = (q) => new Promise((resolve) => {
    process.stdout.write(q);
    if (lines.length) resolve(lines.shift());
    else if (closed) resolve('');
    else waiting = resolve;
  });
  console.log('\nDataBrief setup - press Enter to keep the value in [brackets].\n');
  for (const [name, env, , , question] of SETTINGS) {
    if (!question) continue;
    for (;;) {
      const ans = (await ask(`${question}\n  [${eff[name]}] > `)).trim();
      const old = eff[name];
      if (ans) eff[name] = ans;
      const errs = validate(eff).filter((e) => e.startsWith(env + ':'));
      if (!errs.length) break;
      console.log('  ! ' + errs[0]);
      eff[name] = old;
    }
  }
  console.log("\nTip: your team's own prompt text is easiest to write in databrief_set_default.html,\n     or set DATABRIEF_PROMPT_INTRO / _RESPOND / _RESPOND_FILES in databrief.conf.\n");
  const values = Object.fromEntries(SETTINGS.filter((s) => s[4]).map((s) => [s[1], eff[s[0]]]));
  const target = confPath || path.join(process.cwd(), 'databrief.conf');
  if (inDocker()) console.log('(Inside Docker: prefer the Python image for interactive setup, or pass -e variables.)\n');
  const ans = (await ask(`Save these answers to ${target}? [Y/n] > `)).trim().toLowerCase();
  rl.close();
  if (['', 'y', 'yes', 'o', 'oui'].includes(ans)) { writeConf(target, values); console.log(`Saved to ${target}\n`); }
}

/* ---------------------------------------------------------------- server --------------- */
async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error('Error: ' + e.message); return 2; }
  if (args.help) { help(); return 0; }
  const { eff, confPath } = resolve(args);
  if (args.setup) await setup(eff, confPath);
  const errors = validate(eff);
  if (errors.length) { errors.forEach((e) => console.error('Error: ' + e)); return 2; }

  const htmlPath = findHtml(eff.html);
  if (!htmlPath) { console.error('Error: databrief.html not found. Use --html PATH or DATABRIEF_HTML.'); return 2; }
  let page;
  try { page = Buffer.from(inject(fs.readFileSync(htmlPath, 'utf8'), pageConfig(eff)), 'utf8'); } catch (e) { console.error('Error: ' + e.message); return 2; }
  if (args.check) { console.log('Settings OK. Page config:', JSON.stringify(pageConfig(eff))); return 0; }
  const pageGz = zlib.gzipSync(page, { level: 9 });

  const base = eff['base-path'].endsWith('/') ? eff['base-path'] : eff['base-path'] + '/';
  const pages = new Set([base, base + 'index.html', base + 'databrief.html']);
  const log = ['true', '1', 'yes'].includes(String(eff['access-log']).toLowerCase());
  const common = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': 'frame-ancestors ' + eff['frame-ancestors'],
  };

  const server = http.createServer((req, res) => {
    const send = (code, body, type, extra) => {
      res.writeHead(code, Object.assign({ 'Content-Type': type, 'Content-Length': body.length }, common, extra || {}));
      res.end(req.method === 'HEAD' ? undefined : body);
      if (log) console.log(`${req.socket.remoteAddress} - "${req.method} ${req.url}" ${code}`);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, Buffer.from('Method not allowed\n'), 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
    const p = req.url.split('?')[0].split('#')[0];
    if (p === '/healthz') return send(200, Buffer.from('ok\n'), 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
    if (p + '/' === base) return send(301, Buffer.alloc(0), 'text/plain', { Location: base + req.url.slice(p.length) });
    if (pages.has(p)) {
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const extra = { 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
      if (gz) extra['Content-Encoding'] = 'gzip';
      return send(200, gz ? pageGz : page, 'text/html; charset=utf-8', extra);
    }
    return send(404, Buffer.from('Not found\n'), 'text/plain; charset=utf-8');
  });
  server.maxConnections = parseInt(eff['max-connections'], 10);
  server.on('error', (e) => { console.error('Error: ' + e.message); process.exit(1); });
  server.listen(parseInt(eff.port, 10), eff.host, () => {
    const shown = ['0.0.0.0', '::'].includes(eff.host) ? 'localhost' : eff.host;
    console.log(`DataBrief is running: http://${shown}:${eff.port}${base}`);
    if (['0.0.0.0', '::'].includes(eff.host)) console.log(`Team members can use http://<this computer's name or IP>:${eff.port}${base}`);
    console.log(`Settings file: ${confPath || 'none'} - page: ${htmlPath} - press Ctrl+C to stop`);
  });
  const stop = () => { console.log('\nStopped.'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null;
}

main().then((code) => { if (code !== null && code !== undefined) process.exit(code); }, (e) => { console.error(e); process.exit(1); });
