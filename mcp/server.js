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

const HERE = __dirname;
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26'];   // MCP versions spoken, newest first
const MIME = 'text/html;profile=mcp-app';
const MAX_BODY = 64 * 1024;       // requests are tiny: a tool call or a resource name
const MAX_BATCH = 20;
const DEFAULT_ORIGINS = ['https://claude.ai', 'https://claude.com', 'https://chatgpt.com'];

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
    iconFile: path.join(HERE, 'icon.svg'),
  };
}

const INFO_PAGE = (url) => '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>DataBrief connector</title><link rel="icon" href="/icon.svg" type="image/svg+xml">' +
  '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}code{background:#8882;padding:.1em .3em;border-radius:4px}</style>' +
  '<h1>DataBrief connector</h1>' +
  '<p>This is the MCP server behind the DataBrief connector for Claude and ChatGPT. Add <code>' + (url || 'https://this-server') + '/mcp</code> as a connector.</p>' +
  '<p>This server <b>never receives your files</b>. The DataBrief page runs in your browser, inside the chat, and reads the file there. The server only serves that page and answers the chat app\'s requests. It stores nothing, and its logs hold no file content and no IP address.</p>' +
  '<p><a href="https://github.com/Arfo-du-blo/DataBrief">DataBrief on GitHub</a> (GPL-3.0-or-later)</p>';

function makeLimiter(perMin) {
  const hits = new Map();
  let sweepAt = Date.now() + 60000;
  // Returns 0 when allowed, else the seconds to wait.
  return (key, cost) => {
    if (!perMin) return 0;
    const now = Date.now();
    if (now > sweepAt || hits.size > 50000) { for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); if (hits.size > 50000) hits.clear(); sweepAt = now + 60000; }
    let e = hits.get(key);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + 60000 }; hits.set(key, e); }
    e.n += cost;
    return e.n <= perMin ? 0 : Math.max(1, Math.ceil((e.reset - now) / 1000));
  };
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
    description: 'Opens DataBrief, a page where the user picks a data file (CSV, Excel, Parquet, SQLite, SQL dump, PDF, Word and many more) and turns it into a prompt for an AI, with an option to share no records at all. ' +
      'Use it when the user wants to prepare, describe or analyse a data file with privacy in mind. The file is read in the user\'s browser and never reaches this server. Takes no arguments. ' +
      'In a terminal there is no widget: use the databrief command-line tool instead.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'DataBrief', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: uris.current }, 'ui/resourceUri': uris.current },
  };
  const TOOL_TEXT = 'DataBrief is open. The user chooses a file inside the widget; it is read on their computer and never reaches this server. ' +
    'If no widget is visible (for example in a terminal), tell the user to use the databrief command-line tool: npm install -g databrief, or see https://github.com/Arfo-du-blo/DataBrief.';
  const INSTRUCTIONS = 'DataBrief turns a data file into a prompt for an AI, with an option to share no records. Call databrief_open when the user wants to prepare or analyse a data file; the user picks the file inside the widget.';

  // One JSON-RPC message in, one answer (or null) out. info collects what the log may say: method names, never content.
  function handle(msg, info) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return rpcError(msg && msg.id, -32600, 'Invalid Request');
    if (typeof msg.method !== 'string') return ('result' in msg || 'error' in msg) ? null : rpcError(msg.id, -32600, 'Invalid Request');
    info.methods.push(msg.method.slice(0, 60));
    if (msg.id === undefined || msg.id === null) return null;   // a notification
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
      return res.end(req.method === 'HEAD' ? undefined : INFO_PAGE(config.publicUrl));
    }
    if (route !== '/mcp') return send(404, 'Not found\n');

    // /mcp: stateless Streamable HTTP. POST only; no stream (GET), no session to close (DELETE).
    if (req.method !== 'POST') return send(405, rpcError(null, -32000, 'Method not allowed: POST only'), { Allow: 'POST' });
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) return send(403, rpcError(null, -32000, 'Origin not allowed'));
    const key = (config.trustProxyHeader && String(req.headers[config.trustProxyHeader] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
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
module.exports = { createServer, loadConfig, SETTINGS, SUPPORTED, MAX_BODY };
