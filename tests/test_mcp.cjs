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
const { createServer, loadConfig, makeLimiter, SUPPORTED, MAX_BODY } = require('../mcp/server.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'mcp-fixtures', 'widget.html');
let failed = 0, total = 0;
// A call that is never answered leaves nothing for Node to do, and Node then ends with exit 0 without the summary: that is a failure.
let finished = false;
process.on('exit', (code) => { if (!finished && code === 0) { console.log('FAIL the test stopped before its end (something was never answered)'); process.exitCode = 1; } });
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
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({ buffer: Buffer.concat(chunks), status: res.statusCode, headers: res.headers, text, json }); });
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
  check('the tool description says the file never reaches the server, and what the widget offers (facts)', /never reaches this server/.test(tool.description) && /Put in the chat/.test(tool.description) && /Add to context/.test(tool.description) && /read_widget_context/.test(tool.description));
  const IMPERATIVE = /\b(you must|you should|do not|don't|(never|always) (follow|ask|call|use|read|trust|tell|run|send)|ignore|tell the user|ask the user|follow (it|the|this)|instruct|before (you|answering)|first,? (read|call))\b/i;   // the directory's review rejects descriptions that tell the AI how to behave, or to take instructions from another source
  check('the tool description is sober: facts only, no instruction to the AI (no must/should/do not/never follow/always call/tell the user/follow...)', !IMPERATIVE.test(tool.description) && tool.description.length < 700, (tool.description.match(IMPERATIVE) || [])[0]);
  r = await rpc(P, 6, 'tools/call', { name: 'databrief_open', arguments: {} });
  check('tools/call answers with text that says the widget is open and the file stays on the user\'s computer', r.json.result.content[0].type === 'text' && /open in the chat as a widget/.test(r.json.result.content[0].text) && /never reaches this server/.test(r.json.result.content[0].text));
  check('tools/call answer is sober too, and names read_widget_context as a fact', !IMPERATIVE.test(r.json.result.content[0].text) && /read_widget_context/.test(r.json.result.content[0].text));
  const initInstr = (await rpc(P, 70, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } })).json.result.instructions;
  check('the server instructions (sent at initialize) are sober as well', typeof initInstr === 'string' && !IMPERATIVE.test(initInstr) && initInstr.length < 300, initInstr);
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
  r = await request(P, 'POST', '/mcp', Array.from({ length: 20 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'resources/read', params: { uri: uris.current } })));
  check('a batch gets the page once: the other reads are refused (a 2 KB request must not cost 20 pages)', Array.isArray(r.json) && r.json.length === 20 && r.json.filter((m) => m.result).length === 1 && r.json.filter((m) => m.error).length === 19, r.text.slice(0, 200));
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
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://claude.ai' });
  check('an allowed origin gets the CORS answer a browser needs to read the reply', r.headers['access-control-allow-origin'] === 'https://claude.ai' && /Origin/.test(r.headers.vary || ''));
  r = await request(P, 'OPTIONS', '/mcp', undefined, { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
  check('the browser preflight (OPTIONS) of an allowed origin is answered', r.status === 204 && r.headers['access-control-allow-origin'] === 'https://claude.ai' && /POST/.test(r.headers['access-control-allow-methods'] || '') && /Content-Type/i.test(r.headers['access-control-allow-headers'] || ''));
  r = await request(P, 'OPTIONS', '/mcp', undefined, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
  check('the preflight of an origin that is not allowed is refused, with no CORS header', r.status === 403 && !r.headers['access-control-allow-origin']);
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', id: null, method: 'initialize', params: {} });
  check('a request with id null is refused (MCP: never null), not taken as a notification', r.status === 200 && r.json.error && r.json.error.code === -32600);
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', id: { a: 1 }, method: 'ping' });
  check('a request whose id is an object is refused and its id is not echoed', r.json.error && r.json.error.code === -32600 && r.json.id === null);
  r = await request(P, 'POST', '/mcp', { jsonrpc: '2.0', id: 'x1', method: 'ping' });
  check('a string id is fine', r.json.id === 'x1' && r.json.result);

  /* ---------- the other routes ---------- */
  r = await request(P, 'GET', '/healthz');
  check('/healthz', r.status === 200 && r.text.trim() === 'ok');
  r = await request(P, 'GET', '/icon.svg');
  check('/icon.svg is the DataBrief icon', r.status === 200 && /image\/svg\+xml/.test(r.headers['content-type']) && /#4f5bd5/.test(r.text));
  r = await request(P, 'GET', '/favicon.ico');
  check('/favicon.ico answers', r.status === 200);
  r = await request(P, 'GET', '/');
  const inlineScript = (/<script>([\s\S]*?)<\/script>/.exec(r.text) || [])[1] || '';
  check('the home page says the file never reaches the server, has the button to the tool and the connector address with a Copy button and the guide on GitHub', r.status === 200 && /never receives your files/.test(r.text) && /href="\/app"[^>]*>Open the tool/.test(r.text) && /id="addr" readonly value="[^"]*\/mcp"/.test(r.text) && /id="copy"/.test(r.text) && /github\.com\/Arfo-du-blo\/DataBrief\/blob\/main\/docs\/connector\.md/.test(r.text));
  check('the home page loads nothing from outside and its CSP allows only its own inline script (by hash)', !/(src|href)="https?:\/\/[^"]*\.(js|css|png|jpg|svg)/.test(r.text) && /default-src 'none'/.test(r.headers['content-security-policy']) && /frame-ancestors 'none'/.test(r.headers['content-security-policy']) && inlineScript.length > 20 && r.headers['content-security-policy'].includes("script-src 'sha256-" + crypto.createHash('sha256').update(inlineScript).digest('base64') + "'") && (r.text.match(/<script/g) || []).length === 1);
  check('the home page states the version and the SHA-256 of the page it serves at /app', r.text.includes(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version) && r.text.includes(require('crypto').createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex')));
  const appPlain = await request(P, 'GET', '/app', undefined, { Accept: 'text/html' });
  check('/app serves the page itself, byte for byte (the file the chat apps get as the widget)', appPlain.status === 200 && /text\/html/.test(appPlain.headers['content-type']) && appPlain.buffer.equals(fs.readFileSync(FIXTURE)) && /frame-ancestors 'none'/.test(appPlain.headers['content-security-policy']));
  const appGz = await request(P, 'GET', '/app', undefined, { 'Accept-Encoding': 'gzip' });
  check('/app is sent compressed when the browser accepts it, and decompresses to the same bytes', appGz.headers['content-encoding'] === 'gzip' && require('zlib').gunzipSync(appGz.buffer).equals(fs.readFileSync(FIXTURE)) && /Accept-Encoding/i.test(appGz.headers.vary || ''));
  const app304 = await request(P, 'GET', '/app', undefined, { 'If-None-Match': appPlain.headers.etag });
  check('/app has the page hash as its ETag and answers 304 with no body when the browser copy is current', app304.status === 304 && app304.buffer.length === 0 && appPlain.headers.etag === '"' + crypto.createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex') + '"');
  const appHead = await request(P, 'HEAD', '/app');
  const appPost = await request(P, 'POST', '/app', {});
  check('/app: HEAD has no body, POST is refused (405)', appHead.status === 200 && appHead.buffer.length === 0 && appPost.status === 405);
  r = await request(P, 'GET', '/nothing');
  check('anything else is 404', r.status === 404);
  check('nosniff on every answer', r.headers['x-content-type-options'] === 'nosniff');

  /* ---------- the log: method names and timings only ---------- */
  await rpc(P, 15, 'tools/call', { name: 'databrief_open', arguments: { secret: 'CANARY_ARGUMENT_9Q', file: 'C:/Users/CANARY_USER_PATH/data.csv' } }, { 'X-Forwarded-For': '203.0.113.77', Authorization: 'Bearer CANARY_TOKEN_5Z', Cookie: 'sid=CANARY_COOKIE_3K', 'User-Agent': 'Claude-User/1.0 (CANARY_UA_DETAIL)' });
  await rpc(P, 16, 'CANARY_METHOD_NAME/' + 'x'.repeat(40));
  await new Promise((r2) => setTimeout(r2, 50));
  const all = lines.join('\n');
  check('a method the server does not know is logged as "other", never with the client\'s text', /"methods":"other"/.test(all) && !/CANARY_METHOD/.test(all));
  check('the log has entries', lines.length > 10);
  check('the log has the method names and the tool name', /"methods":"tools\/call"/.test(all) && /"tool":"databrief_open"/.test(all));
  check('the log has no argument, header, cookie, token or address', !/CANARY_/.test(all) && !/203\.0\.113\.77/.test(all) && !/127\.0\.0\.1/.test(all) && !/::1/.test(all));
  check('the log has only the user-agent product name, not its details', /"ua":"Claude-User"/.test(all) && !/CANARY_UA/.test(all));
  check('the log has no widget content', !/Stand-in for dist/.test(all) && !/databrief-widget/.test(all.replace(/"widgetSha256"/g, '')));
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
  const lim3 = await start(baseConfig({ ratePerMin: 8 }), () => {});
  let apps = 0; let lastApp = 200;
  for (; apps < 10 && lastApp === 200; apps++) lastApp = (await request(lim3.port, 'GET', '/app')).status;
  check('/app counts five requests, like the page read over MCP', apps === 2 && lastApp === 429, 'apps=' + apps + ' last=' + lastApp);
  await lim3.close();
  const lim4 = await start(baseConfig({ ratePerMin: 8 }), () => {});
  const etagNow = '"' + crypto.createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex') + '"';
  let okCurrent = 0; for (let i = 0; i < 6; i++) if ((await request(lim4.port, 'GET', '/app', undefined, { 'If-None-Match': etagNow })).status === 304) okCurrent++;
  check('/app answered 304 counts one, so a browser that already has the page is not blocked', okCurrent >= 6, 'ok=' + okCurrent);
  await lim4.close();
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
  // the proxy's header is believed only from this machine or a private network (anyone reaching the port directly could write any address)
  const { isPrivate, sourceOf } = require('../mcp/server.js');
  check('the header is believed from loopback, a private network and Docker\'s networks, not from a public address', ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '192.168.1.5', '172.18.0.3', 'fd00::5'].every(isPrivate) && !['8.8.8.8', '198.51.100.1', '172.32.0.1', '2001:db8::1', '::ffff:8.8.8.8'].some(isPrivate));
  check('one IPv6 network (/64) is one source; IPv4 addresses stay themselves', sourceOf('2001:db8:1:2:3:4:5:6') === sourceOf('2001:db8:1:2::9') && sourceOf('2001:db8:1:2::9') !== sourceOf('2001:db8:1:3::9') && sourceOf('::ffff:1.2.3.4') === '1.2.3.4' && sourceOf('1.2.3.4') !== sourceOf('1.2.3.5'));

  // The guard's memory is bounded, and filling it never resets the counters (a flood of new addresses would otherwise wipe every limit).
  const g = makeLimiter(3, 2);
  g('a', 1); g('a', 1); g('b', 1);
  const newcomers = ['c', 'd', 'e', 'f'].map((k) => g(k, 1));
  check('the guard full: new sources share one counter, which fills up (no reset)', newcomers[0] === 0 && newcomers[2] === 0 && newcomers[3] > 0, newcomers.join());
  check('the guard full: the sources it already knew keep their counts', g('a', 1) === 0 && g('a', 1) > 0);

  /* ---------- the pages the directory asks for: documentation, privacy policy, support, a sample file ---------- */
  const doc = (n) => fs.readFileSync(path.join(ROOT, 'docs', n), 'utf8').replace(/\r\n/g, '\n');
  const priv = doc('privacy.md');
  check('privacy policy: data collection, usage and storage, third parties, retention, contact, children (what the directory requires)', ['Your files', 'What the server receives and logs', 'How long it is kept', 'Who else is involved', 'Your rights and contact', 'Children, cookies, tracking'].every((h) => priv.includes('## ' + h)));
  check('privacy policy: says the log has no IP address and no content, that the files stay in the browser, names Cloudflare and the chat apps as the other parties', /no IP address, no header, no cookie, no token, no argument and no content/.test(priv) && /never receives them/.test(priv) && /Cloudflare/.test(priv) && /Anthropic/.test(priv) && /OpenAI/.test(priv));
  check('privacy policy: what it says the log holds is what the server logs (the same fields: method, tool, client name, first word of the user agent)', /protocol method/.test(priv) && /first word of its user agent/.test(priv) && new RegExp('methods: info\\.methods').test(fs.readFileSync(path.join(ROOT, 'mcp', 'server.js'), 'utf8')) && !/req\.socket\.remoteAddress[^;\n]*log\(/.test(fs.readFileSync(path.join(ROOT, 'mcp', 'server.js'), 'utf8')));
  const sup = doc('support.md'), con = doc('connector.md');
  check('support page: the issue tracker, a private way to report a security problem, a warning that issues are public', /github\.com\/Arfo-du-blo\/DataBrief\/issues/.test(sup) && /Report a vulnerability/.test(sup) && /public/.test(sup));
  check('connector guide: how to add and use it, what each button does, what was tested (only Claude and ChatGPT), and the sample file it names exists', /Add it/.test(con) && /Put in the chat/.test(con) && /Only \*\*Claude\*\*/.test(con) && con.includes('sample/orders-sample.csv') && fs.existsSync(path.join(ROOT, 'docs', 'sample', 'orders-sample.csv')));
  check('sample file: a CSV of invented orders with a header and at least 50 rows', (() => { const l = doc('sample/orders-sample.csv').trim().split('\n'); return /^order_id,order_date,customer,region,product,quantity,unit_price,status$/.test(l[0]) && l.length > 50; })());
  const mdServer = doc('mcp-server.md');
  check('the docs describe / and /app (the privacy policy says plain page requests are not logged and that the file is still read in the browser)', mdServer.includes('`/app`') && /Open the tool/.test(mdServer) && priv.includes('/app') && priv.includes('does **not** log them') && /never receives your file/.test(priv) && /Without a chat/.test(con));

  /* ---------- the deployment files: Compose, .env.example, the operations guide ---------- */
  const compose = fs.readFileSync(path.join(ROOT, 'mcp', 'docker-compose.yml'), 'utf8');
  const envEx = fs.readFileSync(path.join(ROOT, 'mcp', '.env.example'), 'utf8');
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const envKeys = new Set([...envEx.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const readByCompose = [...new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))];
  check('every variable the Compose file reads is documented in .env.example', readByCompose.every((k) => envKeys.has(k)), readByCompose.filter((k) => !envKeys.has(k)).join());
  const { SETTINGS } = require('../mcp/server.js');
  const fixedByImage = new Set(['DATABRIEF_MCP_PORT', 'DATABRIEF_MCP_HOST', 'DATABRIEF_WIDGET']);   // the image and the published port set these
  const missed = SETTINGS.map((s) => s[1]).filter((n) => !fixedByImage.has(n) && !(new RegExp('^\\s+' + n + ':', 'm').test(compose) && envKeys.has(n)));
  check('every setting of the server is passed by Compose and documented in .env.example (or fixed by the image)', missed.length === 0, missed.join());
  check('.env.example holds no tunnel token', /^TUNNEL_TOKEN=\s*$/m.test(envEx));
  check('the real .env (it holds the token) is git-ignored', /^mcp\/\.env\s*$/m.test(gitignore) && !/^mcp\/\.env\.example/m.test(gitignore));
  check('both services restart by themselves, run read-only, without Linux capabilities, with a memory limit', (compose.match(/restart: unless-stopped/g) || []).length === 2 && (compose.match(/read_only: true/g) || []).length === 2 && (compose.match(/cap_drop: \[ALL\]/g) || []).length === 2 && (compose.match(/mem_limit:/g) || []).length === 2);
  const tunnelBlock = compose.slice(compose.indexOf('  cloudflared:'));
  check('the tunnel publishes no port, reaches the server over Docker\'s network and waits for it to be healthy', !/\bports:/.test(tunnelBlock) && /condition: service_healthy/.test(tunnelBlock) && /profiles: \["tunnel"\]/.test(tunnelBlock));
  check('the tunnel software is pinned to a version, not "latest"', !/cloudflared:latest/.test(compose + envEx) && /CLOUDFLARED_IMAGE=cloudflare\/cloudflared:\d{4}\.\d+\.\d+/.test(envEx));
  check('the tunnel is on by default in .env.example and the logs rotate', /^COMPOSE_PROFILES=tunnel\s*$/m.test(envEx) && (compose.match(/max-size/g) || []).length === 2);
  const ops = fs.readFileSync(path.join(ROOT, 'docs', 'mcp-operations.md'), 'utf8');
  check('the operations guide covers start, tunnel, update, check, when it fails, logs, shut down and revoke', ['## Start it', '## The Cloudflare Tunnel', '## Update it', '## Check it', '## When it does not work', '## What the logs hold', '## Shut it down and revoke it'].every((h) => ops.includes(h)));
  check('the operations guide names no private address or secret', !/boards\.digital|eyJ[A-Za-z0-9]{20,}/.test(ops + envEx + compose));

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
  finished = true;
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(2); });
