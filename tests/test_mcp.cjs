#!/usr/bin/env node
/* The hosted MCP server (mcp/server.js): a protocol conversation with a test client, and what it must never do.
 *   node tests/test_mcp.cjs
 * Checks: the handshake and version negotiation; the tool (title, read-only hint, widget address); the widget resource is
 * byte-identical to the widget file and keeps its permissions; every address ever published still answers; errors; limits
 * (body size, batch, flood guard); Origin; no stream and no session; and that the log holds method names and timings only
 * (canaries in the arguments, the headers and the address never appear), and that the server writes nothing to disk. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createServer, loadConfig, SUPPORTED, MAX_BODY } = require('../mcp/server.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'mcp-fixtures', 'widget.html');
let failed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } else console.log('ok   ' + name); };

function baseConfig(extra) {
  const cfg = loadConfig({ DATABRIEF_WIDGET: FIXTURE, DATABRIEF_LOG: 'on' });
  return Object.assign(cfg, extra || {});
}
function start(config, logger) {
  return new Promise((resolve) => {
    const server = createServer(config, logger);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) }));
  });
}
function request(port, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const h = Object.assign({ Accept: 'application/json, text/event-stream' }, data !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers || {});
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}
const rpc = (port, id, method, params, headers) => request(port, 'POST', '/mcp', { jsonrpc: '2.0', id, method, params }, headers);

(async () => {
  const lines = [];
  const logger = (o) => lines.push(JSON.stringify(o));
  const widgetText = fs.readFileSync(FIXTURE, 'utf8');
  const uris = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp', 'uris.json'), 'utf8'));

  const s = await start(baseConfig(), logger);
  const P = s.port;

  /* ---------- handshake ---------- */
  let r = await rpc(P, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Anthropic/ClaudeAI', version: '1' } });
  check('initialize answers 200 JSON', r.status === 200 && /application\/json/.test(r.headers['content-type']), r.text.slice(0, 100));
  check('initialize: newest version is echoed', r.json.result.protocolVersion === '2025-11-25');
  check('initialize: server name, title, version, icons', r.json.result.serverInfo.name === 'databrief' && r.json.result.serverInfo.title === 'DataBrief' && /^\d+\.\d+\.\d+/.test(r.json.result.serverInfo.version) && r.json.result.serverInfo.icons.length >= 1 && /^data:image\/svg\+xml;base64,/.test(r.json.result.serverInfo.icons.slice(-1)[0].src));
  check('initialize: tools and resources, nothing else', Object.keys(r.json.result.capabilities).sort().join() === 'resources,tools');
  r = await rpc(P, 2, 'initialize', { protocolVersion: '1999-01-01' });
  check('initialize: an unknown version gets our newest', r.json.result.protocolVersion === SUPPORTED[0]);
  r = await rpc(P, 3, 'initialize', { protocolVersion: '2025-06-18' });
  check('initialize: an older supported version is echoed', r.json.result.protocolVersion === '2025-06-18');
  r = await rpc(P, 4, 'ping', {});
  check('ping', r.status === 200 && r.json.id === 4 && Object.keys(r.json.result).length === 0);
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
  check('a notification gets 202 and no body', r.status === 202 && r.text === '');

  /* ---------- the tool ---------- */
  r = await rpc(P, 5, 'tools/list');
  const tool = r.json.result.tools[0];
  check('exactly one tool: databrief_open', r.json.result.tools.length === 1 && tool.name === 'databrief_open');
  check('the tool has a title and the hints the directory asks for', tool.title === 'DataBrief' && tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false && tool.annotations.openWorldHint === false);
  check('the tool takes no argument', tool.inputSchema.type === 'object' && Object.keys(tool.inputSchema.properties).length === 0 && tool.inputSchema.additionalProperties === false);
  check('the tool points at the widget, in both metadata keys', tool._meta.ui.resourceUri === uris.current && tool._meta['ui/resourceUri'] === uris.current);
  check('the tool description says the file never reaches the server and mentions the terminal', /never reaches this server/.test(tool.description) && /terminal/.test(tool.description));
  r = await rpc(P, 6, 'tools/call', { name: 'databrief_open', arguments: {} });
  check('tools/call answers with text that points terminal users at the CLI', r.json.result.content[0].type === 'text' && /databrief command-line tool/.test(r.json.result.content[0].text));
  r = await rpc(P, 7, 'tools/call', { name: 'nope', arguments: {} });
  check('an unknown tool is an error -32602', r.json.error && r.json.error.code === -32602);

  /* ---------- the widget resource ---------- */
  r = await rpc(P, 8, 'resources/list');
  const res0 = r.json.result.resources[0];
  check('resources/list: the current address, the app MIME type, permissions', res0.uri === uris.current && res0.mimeType === 'text/html;profile=mcp-app' && res0._meta.ui.permissions.clipboardWrite !== undefined && res0._meta.ui.prefersBorder === true);
  r = await rpc(P, 9, 'resources/read', { uri: uris.current });
  const c0 = r.json.result.contents[0];
  check('resources/read: byte-identical to the widget file', Buffer.from(c0.text, 'utf8').equals(fs.readFileSync(FIXTURE)), 'length ' + c0.text.length);
  check('resources/read: MIME type and permissions travel with the content', c0.mimeType === 'text/html;profile=mcp-app' && c0._meta.ui.permissions.clipboardWrite !== undefined);
  check('the server says the widget SHA-256 at start', s.server.databrief.widgetSha === crypto.createHash('sha256').update(widgetText).digest('hex'));
  r = await rpc(P, 10, 'resources/read', { uri: 'ui://databrief/other.html' });
  check('an unknown resource is an error -32002', r.json.error && r.json.error.code === -32002);
  check('every address ever published still answers (mcp/uris.json)', (await Promise.all([uris.current].concat(uris.previous).map((u) => rpc(P, 11, 'resources/read', { uri: u })))).every((x) => x.json.result && x.json.result.contents[0].text === widgetText));
  check('the current address is not also in the old list', !uris.previous.includes(uris.current));

  // The real list of old addresses is empty today, so prove the rule with a list that has two (a temporary file written by the test).
  const tmpUris = path.join(os.tmpdir(), 'databrief-uris-test-' + process.pid + '.json');
  fs.writeFileSync(tmpUris, JSON.stringify({ current: 'ui://databrief/widget-v3.html', previous: ['ui://databrief/widget-v1.html', 'ui://databrief/widget-v2.html'] }));
  const old = await start(baseConfig({ urisFile: tmpUris }), () => {});
  const olds = await Promise.all(['v1', 'v2', 'v3'].map((v) => rpc(old.port, 1, 'resources/read', { uri: 'ui://databrief/widget-' + v + '.html' })));
  check('old addresses (v1, v2) and the current one (v3) all answer with the current page', olds.every((x) => x.json.result && x.json.result.contents[0].text === widgetText));
  check('each answer carries the address that was asked', olds.map((x) => x.json.result.contents[0].uri).join() === 'ui://databrief/widget-v1.html,ui://databrief/widget-v2.html,ui://databrief/widget-v3.html');
  const tl = await rpc(old.port, 2, 'tools/list'), rl = await rpc(old.port, 3, 'resources/list');
  check('the tool and the listing show only the newest address', tl.json.result.tools[0]._meta.ui.resourceUri === 'ui://databrief/widget-v3.html' && rl.json.result.resources.length === 1 && rl.json.result.resources[0].uri === 'ui://databrief/widget-v3.html');
  await old.close();
  fs.unlinkSync(tmpUris);

  /* ---------- errors and protocol rules ---------- */
  r = await rpc(P, 12, 'server/discover');
  check('an unknown method is -32601', r.json.error.code === -32601 && r.json.id === 12);
  r = await request(P, 'POST', '/mcp', '{not json');
  check('bad JSON is 400 / -32700', r.status === 400 && r.json.error.code === -32700);
  r = await request(P, 'POST', '/mcp', { hello: 'world' });
  check('not a JSON-RPC message is -32600', r.json.error.code === -32600);
  r = await request(P, 'POST', '/mcp', []);
  check('an empty batch is refused', r.status === 400);
  r = await request(P, 'POST', '/mcp', [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'b', method: 'tools/list' }]);
  check('a batch answers requests only, in order', Array.isArray(r.json) && r.json.length === 2 && r.json[0].id === 1 && r.json[1].id === 'b');
  r = await request(P, 'POST', '/mcp', new Array(25).fill({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  check('a batch above 20 is refused', r.status === 400);
  r = await rpc(P, 13, 'tools/list', undefined, { 'MCP-Protocol-Version': '1999-01-01' });
  check('an unsupported MCP-Protocol-Version header is 400', r.status === 400);
  r = await rpc(P, 14, 'tools/list', undefined, { 'MCP-Protocol-Version': '2025-06-18' });
  check('a supported MCP-Protocol-Version header is fine', r.status === 200);
  r = await request(P, 'GET', '/mcp');
  check('GET /mcp: no stream, 405 with Allow: POST', r.status === 405 && r.headers.allow === 'POST');
  r = await request(P, 'DELETE', '/mcp');
  check('DELETE /mcp: no session, 405', r.status === 405);
  r = await request(P, 'POST', '/mcp', 'x'.repeat(MAX_BODY + 10));
  check('a body above the limit is 413', r.status === 413);
  r = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: P, method: 'POST', path: '/mcp', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('error', () => resolve({ status: 'error' }));
    for (let i = 0; i < 5; i++) req.write('x'.repeat(MAX_BODY / 2));
    req.end();
  });
  check('a body above the limit with no declared size (chunked) is 413 too', r.status === 413, String(r.status));
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' });
  check('a browser origin that is not allowed is 403', r.status === 403);
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://claude.ai' });
  check('an allowed origin passes', r.status === 200);
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' });
  check('no Origin (server to server) passes', r.status === 200);

  /* ---------- the other routes ---------- */
  r = await request(P, 'GET', '/healthz');
  check('/healthz', r.status === 200 && r.text.trim() === 'ok');
  r = await request(P, 'GET', '/icon.svg');
  check('/icon.svg is the DataBrief icon', r.status === 200 && /image\/svg\+xml/.test(r.headers['content-type']) && /#4f5bd5/.test(r.text));
  r = await request(P, 'GET', '/favicon.ico');
  check('/favicon.ico answers', r.status === 200);
  r = await request(P, 'GET', '/');
  check('the home page says the file never reaches the server, loads nothing from outside', r.status === 200 && /never receives your files/.test(r.text) && !/https?:\/\/(?!github\.com\/Arfo-du-blo)[^"' ]+\.(js|css)/.test(r.text) && /default-src 'none'/.test(r.headers['content-security-policy']));
  r = await request(P, 'GET', '/nothing');
  check('anything else is 404', r.status === 404);
  check('nosniff on every answer', r.headers['x-content-type-options'] === 'nosniff');

  /* ---------- the log: method names and timings only ---------- */
  await rpc(P, 15, 'tools/call', { name: 'databrief_open', arguments: { secret: 'CANARY_ARGUMENT_9Q', file: 'C:/Users/CANARY_USER_PATH/data.csv' } }, { 'X-Forwarded-For': '203.0.113.77', Authorization: 'Bearer CANARY_TOKEN_5Z', Cookie: 'sid=CANARY_COOKIE_3K', 'User-Agent': 'Claude-User/1.0 (CANARY_UA_DETAIL)' });
  await new Promise((r2) => setTimeout(r2, 50));
  const all = lines.join('\n');
  check('the log has entries', lines.length > 10);
  check('the log has the method names and the tool name', /"methods":"tools\/call"/.test(all) && /"tool":"databrief_open"/.test(all));
  check('the log has no argument, header, cookie, token or address', !/CANARY_/.test(all) && !/203\.0\.113\.77/.test(all) && !/127\.0\.0\.1/.test(all) && !/::1/.test(all));
  check('the log has only the user-agent product name, not its details', /"ua":"Claude-User"/.test(all) && !/CANARY_UA/.test(all));
  check('the log has no widget content', !/Stand-in for widget/.test(all));
  const source = fs.readFileSync(path.join(ROOT, 'mcp', 'server.js'), 'utf8');
  check('the server code has no call that writes to disk', !/\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rename|renameSync|unlink|unlinkSync|copyFile|truncate)\b/.test(source));
  check('the server code makes no outgoing request and runs no program', !/\b(http|https)\.(request|get)\(|require\(['"](child_process|net|dns|tls|dgram)['"]\)|\bfetch\(/.test(source));
  await s.close();

  /* ---------- the flood guard ---------- */
  const lim = await start(baseConfig({ ratePerMin: 10 }), () => {});
  let last = 200, n = 0;
  for (; n < 20 && last === 200; n++) last = (await rpc(lim.port, n, 'ping')).status;
  check('the flood guard answers 429 after the limit', last === 429 && n === 11, 'n=' + n + ' last=' + last);
  r = await rpc(lim.port, 99, 'ping');
  check('429 says when to come back', r.status === 429 && Number(r.headers['retry-after']) >= 1);
  await lim.close();
  const lim2 = await start(baseConfig({ ratePerMin: 8 }), () => {});
  let reads = 0; last = 200;
  for (; reads < 10 && last === 200; reads++) last = (await rpc(lim2.port, reads, 'resources/read', { uri: uris.current })).status;
  check('the heavy page read counts five', reads === 2, 'reads=' + reads);
  await lim2.close();
  const off = await start(baseConfig({ ratePerMin: 0 }), () => {});
  let allOk = true;
  for (let i = 0; i < 40; i++) if ((await rpc(off.port, i, 'ping')).status !== 200) allOk = false;
  check('rate 0 turns the flood guard off', allOk);
  await off.close();
  const proxy = await start(baseConfig({ ratePerMin: 3, trustProxyHeader: 'cf-connecting-ip' }), () => {});
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await rpc(proxy.port, i, 'ping', undefined, { 'CF-Connecting-IP': '198.51.100.1' })).status);
  const other = (await rpc(proxy.port, 1, 'ping', undefined, { 'CF-Connecting-IP': '198.51.100.2' })).status;
  check('behind a proxy the limit counts per real address', codes[3] === 429 && other === 200, codes.join() + ' / ' + other);
  await proxy.close();

  /* ---------- log off, config, missing widget ---------- */
  const quiet = [];
  const q = await start(baseConfig({ log: false }), (o) => quiet.push(o));
  await rpc(q.port, 1, 'ping');
  check('DATABRIEF_LOG=off logs nothing', quiet.length === 0);
  await q.close();
  let threw = '';
  try { createServer(baseConfig({ widgetFile: path.join(os.tmpdir(), 'no-such-widget.html') })); } catch (e) { threw = e.message; }
  check('a missing widget page stops the server with a clear message', /widget page does not exist/.test(threw));
  let bad = '';
  try { loadConfig({ DATABRIEF_MCP_PORT: 'abc' }); } catch (e) { bad = e.message; }
  check('a bad setting is refused with its name', /port must be a whole number/.test(bad));
  check('the version comes from package.json', loadConfig({}).version === JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);

  console.log('\n' + (total - failed) + '/' + total + ' passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(2); });
