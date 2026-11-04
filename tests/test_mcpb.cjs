#!/usr/bin/env node
/* The Claude Desktop extension (extension/, built by tools/build-mcpb.cjs into databrief.mcpb).
 *   node tests/test_mcpb.cjs
 * Checks: the build is reproducible; the zip's contents and manifest (version, tools equal the server's tools/list); the server
 * EXTRACTED from the zip is run over stdio like Claude Desktop does: handshake, tools, the widget byte-identical to the widget
 * build, every old address; the path tool gives the same prompt as the command-line tool, in both modes; "share" is required;
 * Do not share data keeps a canary out; bad paths are refused; stdout holds protocol only and the log no path or content; the
 * code has no network and no write call. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { build } = require('../tools/build-mcpb.cjs');
const fflate = (() => { const m = { exports: {} }; new Function('module', 'exports', 'self', fs.readFileSync(path.join(ROOT, 'vendor', 'fflate.min.js'), 'utf8'))(m, m.exports, undefined); return m.exports; })();
let failed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } else console.log('ok   ' + name); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Claude Desktop's built-in Node refuses to start any subprocess ("cannot start Claude.exe as a Node.js subprocess"): the server is always run here
// under a guard that makes every way of starting a program throw, so the test fails if the extension ever needs one again.
const GUARD = path.join(os.tmpdir(), 'databrief-mcpb-noprocess-' + process.pid + '.cjs');
fs.writeFileSync(GUARD, "const cp = require('child_process'); for (const k of ['spawn','spawnSync','fork','exec','execSync','execFile','execFileSync']) cp[k] = function () { throw new Error('GUARD: a subprocess was started (' + k + ')'); };\n");

class Client {
  constructor(dir) {
    this.child = spawn(process.execPath, ['--require', GUARD, path.join(dir, 'server', 'index.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buf = ''; this.err = ''; this.out = ''; this.waiting = new Map(); this.id = 0; this.badLines = 0;
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (c) => {
      this.buf += c; this.out += c;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch (e) { this.badLines++; continue; }
        if (m.jsonrpc !== '2.0') this.badLines++;
        const w = this.waiting.get(m.id); if (w) { this.waiting.delete(m.id); w(m); }
      }
    });
    this.child.stderr.on('data', (c) => { this.err += c; });
  }
  call(method, params) { const id = ++this.id; return new Promise((res) => { this.waiting.set(id, res); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
  notify(method, params) { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  raw(s) { this.child.stdin.write(s); }
  close() { return new Promise((r) => { this.child.on('close', r); this.child.stdin.end(); setTimeout(() => this.child.kill(), 3000); }); }
}

function cliJson(args) {   // the command-line tool from the source tree (not the bundle the extension carries)
  return JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'cli', 'databrief.cjs'), '--json', '--no-copy'].concat(args), { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'));
}

(async () => {
  // ---- build, reproducibility, contents
  const a = build(), b = build();
  check('the build is reproducible (two builds, same bytes)', Buffer.compare(a, b) === 0);
  const files = fflate.unzipSync(new Uint8Array(a));
  const names = Object.keys(files);
  check('the zip holds exactly the expected files, in order', JSON.stringify(names) === JSON.stringify(['manifest.json', 'icon.png', 'server/index.js', 'server/uris.json', 'server/widget.html', 'server/databrief-cli.cjs', 'LICENSE', 'THIRD-PARTY-NOTICES.md']), names.join(','));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  check('manifest: version is package.json\'s', manifest.version === pkg.version, manifest.version);
  check('manifest: format 0.3, node server, entry point exists in the zip', manifest.manifest_version === '0.3' && manifest.server.type === 'node' && names.includes(manifest.server.entry_point));
  check('manifest: the command runs node on the entry point', manifest.server.mcp_config.command === 'node' && manifest.server.mcp_config.args[0] === '${__dirname}/' + manifest.server.entry_point);
  check('manifest: icon exists and is a 512x512 PNG', names.includes(manifest.icon) && Buffer.from(files[manifest.icon]).readUInt32BE(16) === 512 && Buffer.from(files[manifest.icon]).readUInt32BE(20) === 512 && Buffer.from(files[manifest.icon]).slice(1, 4).toString() === 'PNG');
  check('manifest: license, author, repository set; GPL', manifest.license === 'GPL-3.0-or-later' && manifest.author && manifest.author.name && manifest.repository && manifest.repository.url);
  check('manifest: Windows and macOS, Node 18', manifest.compatibility.platforms.join() === 'darwin,win32' && /18/.test(manifest.compatibility.runtimes.node));
  const widgetBuilt = require('../tools/build-widget.cjs').build();
  check('the widget in the zip is the widget build, byte for byte', Buffer.compare(Buffer.from(files['server/widget.html']), Buffer.from(widgetBuilt, 'utf8')) === 0);
  const uris = JSON.parse(Buffer.from(files['server/uris.json']).toString('utf8'));
  const hostedUris = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp', 'uris.json'), 'utf8'));
  check('extension/uris.json records the widget\'s SHA-256', uris.widgetSha256 === sha(Buffer.from(widgetBuilt, 'utf8')));
  check('the extension\'s widget addresses differ from the hosted server\'s (different prefix)', uris.current !== hostedUris.current && /^ui:\/\/databrief-local\/widget-v\d+\.html$/.test(uris.current));
  check('the extension\'s widget address moves with the hosted one (same version number)', uris.current.replace(/.*widget-/, '') === hostedUris.current.replace(/.*widget-/, ''));
  const cliText = Buffer.from(files['server/databrief-cli.cjs']).toString('utf8');
  check('the bundled command-line tool says the package version', cliText.includes(JSON.stringify(pkg.version)) || cliText.includes(pkg.version));

  // ---- run the extracted server over stdio
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-mcpb-test-'));
  for (const n of names) { const f = path.join(dir, n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, files[n]); }
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-mcpb-data-'));
  const CANARY = 'CANARY-Zx7q-' + crypto.randomBytes(3).toString('hex');
  const csv = path.join(data, 'sales.csv');
  fs.writeFileSync(csv, 'id,customer,city,amount\n' + Array.from({ length: 40 }, (_, i) => (i + 1) + ',' + (i === 3 ? CANARY : 'client' + i) + ',Lyon,' + (i * 3.5)).join('\n') + '\n');
  const json = path.join(data, 'doc.json');
  fs.writeFileSync(json, JSON.stringify([{ a: 1, b: 'x', c: CANARY }, { a: 2, b: 'y', c: 'z' }]));
  const nop = path.join(data, 'x.unknown');
  fs.writeFileSync(nop, Buffer.from([0, 1, 2, 3, 255, 254, 0, 0, 9]));

  const c = new Client(dir);
  const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, clientInfo: { name: 'test', version: '0' } });
  check('initialize: version echoed, tools and resources offered', init.result.protocolVersion === '2025-06-18' && init.result.capabilities.tools && init.result.capabilities.resources);
  check('initialize: serverInfo carries the package version', init.result.serverInfo.name === 'databrief' && init.result.serverInfo.version === pkg.version);
  const old = await c.call('initialize', { protocolVersion: '1999-01-01' });
  check('an unknown protocol version gets the newest supported', /^\d{4}-\d\d-\d\d$/.test(old.result.protocolVersion));
  c.notify('notifications/initialized');
  const tl = await c.call('tools/list');
  const tools = tl.result.tools;
  check('tools/list: exactly databrief_open and databrief_analyze', tools.map((t) => t.name).join() === 'databrief_open,databrief_analyze');
  check('tools: the manifest lists the same tools', JSON.stringify(manifest.tools.map((t) => t.name)) === JSON.stringify(tools.map((t) => t.name)));
  check('tools: both read-only, closed world', tools.every((t) => t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false && t.annotations.openWorldHint === false));
  const open = tools[0], an = tools[1];
  check('databrief_open: widget address in both _meta forms, equal to uris.json', open._meta.ui.resourceUri === uris.current && open._meta['ui/resourceUri'] === uris.current);
  check('databrief_analyze: no widget', !an._meta);
  check('databrief_analyze: path and share are required, share has no default', an.inputSchema.required.join() === 'path,share' && an.inputSchema.properties.share.default === undefined && an.inputSchema.properties.share.enum.join() === 'yes,no');
  check('databrief_analyze: closed schema', an.inputSchema.additionalProperties === false);
  check('descriptions tell the AI to ask about sharing and that it cannot see the widget', /ASK THEM/.test(an.description) && /cannot see the widget/.test(open.description));
  const open1 = await c.call('tools/call', { name: 'databrief_open', arguments: {} });
  check('databrief_open: answers with text mentioning read_widget_context and databrief_analyze', open1.result.content[0].text.includes('read_widget_context') && open1.result.content[0].text.includes('databrief_analyze'));

  const res = await c.call('resources/list');
  check('resources/list: the widget with the MCP Apps type', res.result.resources.length === 1 && res.result.resources[0].uri === uris.current && res.result.resources[0].mimeType === 'text/html;profile=mcp-app');
  const rd = await c.call('resources/read', { uri: uris.current });
  const content = rd.result.contents[0];
  check('resources/read: the page is byte-identical to the widget build', content.text === widgetBuilt && content.mimeType === 'text/html;profile=mcp-app');
  check('resources/read: asks only for the clipboard', JSON.stringify(Object.keys(content._meta.ui.permissions)) === '["clipboardWrite"]');
  for (const u of uris.previous) { const r = await c.call('resources/read', { uri: u }); check('old address still answers: ' + u, r.result && r.result.contents[0].text === widgetBuilt); }
  const hosted = await c.call('resources/read', { uri: hostedUris.current });
  check('the hosted server\'s address is NOT served here', !!hosted.error && hosted.error.code === -32002);
  const unk = await c.call('resources/read', { uri: 'file:///etc/passwd' });
  check('an unknown resource is refused', !!unk.error);
  const noMethod = await c.call('no/such/method');
  check('an unknown method gets -32601', noMethod.error && noMethod.error.code === -32601);
  const noTool = await c.call('tools/call', { name: 'nope', arguments: {} });
  check('an unknown tool gets an error', !!noTool.error);
  check('ping answers', (await c.call('ping')).result !== undefined);

  // ---- the path tool: parity with the command-line tool
  const text = (r) => r.result.content[0].text;
  const call = (args) => c.call('tools/call', { name: 'databrief_analyze', arguments: args });
  const yes = await call({ path: csv, share: 'yes' });
  const refYes = cliJson(['--limit', 'auto', '--', csv]);
  check('share yes: not an error, the prompt is the first block, equal to the CLI\'s', !yes.result.isError && text(yes) === refYes.prompt, String(yes.result.content && yes.result.content[0].text).slice(0, 120));
  check('share yes: the data is in the prompt', text(yes).includes(CANARY));
  check('share yes: a second block states that the data is shared', /HOLDS THE DATA/.test(yes.result.content[1].text));
  const yes5 = await call({ path: csv, share: 'yes', limit: 5, lang: 'fr' });
  const ref5 = cliJson(['--limit', '5', '--lang', 'fr', '--', csv]);
  check('share yes, limit 5, French: equal to the CLI\'s', text(yes5) === ref5.prompt);
  for (const level of [1, 2, 3]) {
    const r = await call({ path: csv, share: 'no', level });
    const ref = cliJson(['--no-share=' + level, '--', csv]);
    check('share no, level ' + level + ': equal to the CLI\'s', !r.result.isError && text(r) === ref.prompt);
    check('share no, level ' + level + ': no record, canary absent', !text(r).includes(CANARY) && !r.result.content[1].text.includes(CANARY) && /NO record/.test(r.result.content[1].text));
  }
  const dflt = await call({ path: csv, share: 'no' });
  check('share no without level = level 1', text(dflt) === cliJson(['--no-share=1', '--', csv]).prompt);
  const ah = await call({ path: csv, share: 'no', level: 2, allow: ['names', 'labels'], hide: ['file'], lang: 'es' });
  const refAh = cliJson(['--no-share=2', '--allow=names,labels', '--hide=file', '--lang', 'es', '--', csv]);
  check('share no with allow, hide and lang: equal to the CLI\'s', text(ah) === refAh.prompt && !text(ah).includes('sales.csv'));
  const js = await call({ path: json, share: 'no', level: 3 });
  check('JSON file, share no level 3: canary absent', !js.result.isError && !text(js).includes(CANARY));
  const ignored = await call({ path: csv, share: 'no', limit: 3 });
  check('limit with share no is ignored and says so', !ignored.result.isError && /limit was ignored/.test(ignored.result.content[1].text));
  const ignored2 = await call({ path: csv, share: 'yes', level: 3, hide: ['file'] });
  check('level/hide with share yes are ignored and say so; data still shared', /ignored/.test(ignored2.result.content[1].text) && text(ignored2).includes(CANARY));

  // ---- refusals: the AI gets a message it can act on
  const errs = [
    ['share missing', { path: csv }, /share is REQUIRED/],
    ['share not yes/no', { path: csv, share: 'maybe' }, /share is REQUIRED/],
    ['share boolean', { path: csv, share: true }, /share is REQUIRED/],
    ['path missing', { share: 'no' }, /path must be/],
    ['relative path', { path: 'sales.csv', share: 'no' }, /ABSOLUTE/],
    ['directory', { path: data, share: 'no' }, /could not read/],
    ['missing file', { path: path.join(data, 'nope.csv'), share: 'no' }, /could not read/],
    ['unreadable format', { path: nop, share: 'no' }, /could not read|Unsupported|not/i],
    ['bad level', { path: csv, share: 'no', level: 9 }, /level must be/],
    ['bad lang', { path: csv, share: 'no', lang: 'xx' }, /lang must be/],
    ['bad limit', { path: csv, share: 'yes', limit: -3 }, /limit must be/],
    ['bad allow', { path: csv, share: 'no', allow: ['x'] }, /allow must be/],
    ['NUL in the path', { path: csv + '\0x', share: 'no' }, /path must be/],
    ['an option smuggled as a path', { path: '--help', share: 'no' }, /ABSOLUTE/],
    ['an option after --', { path: path.join(data, '--version'), share: 'no' }, /could not read/],
  ];
  for (const [name, args, re] of errs) {
    const r = await call(args);
    check('refused: ' + name, r.result && r.result.isError === true && re.test(r.result.content[0].text), JSON.stringify(r.result || r.error).slice(0, 200));
  }
  const noArgs = await c.call('tools/call', { name: 'databrief_analyze' });
  check('refused: no arguments at all', noArgs.result && noArgs.result.isError === true);
  c.raw('this is not json\n');
  c.raw('{"jsonrpc":"2.0","method":"tools/list"}\n');   // a notification-like request without id: no answer, no crash
  c.raw('[1,2,{"jsonrpc":"2.0","id":"s1","method":"ping"}]\n');
  await new Promise((r) => setTimeout(r, 300));
  check('still alive after garbage lines', (await c.call('ping')).result !== undefined);
  check('a batch is handled, a string id is kept', c.out.includes('"id":"s1"'));
  check('stdout held protocol messages only', c.badLines === 0);
  const log = c.err;
  check('stderr (the log) holds no path, no canary, no file name', !log.includes(CANARY) && !log.includes(data) && !log.includes('sales.csv') && !log.includes('Lyon'));
  check('stderr says it started', /started, version/.test(log));
  await c.close();

  // old addresses: the shipped list is empty today, so try a copy of the server whose list holds one
  const u2 = Object.assign({}, uris, { previous: ['ui://databrief-local/widget-v0.html'] });
  fs.writeFileSync(path.join(dir, 'server', 'uris.json'), JSON.stringify(u2));
  const c2 = new Client(dir);
  const r0 = await c2.call('resources/read', { uri: 'ui://databrief-local/widget-v0.html' });
  check('an address listed in previous still answers with the current page', r0.result && r0.result.contents[0].text === widgetBuilt);
  await c2.close();

  // ---- the code
  const src = fs.readFileSync(path.join(ROOT, 'extension', 'server', 'index.js'), 'utf8');
  check('no network module in the extension\'s code', !/require\(['"](https?|net|dgram|tls|http2|dns)['"]\)|\bfetch\(|XMLHttpRequest|WebSocket/.test(src));
  check('no write call in the extension\'s code', !/writeFile|appendFile|createWriteStream|mkdirSync|unlinkSync|rmSync|renameSync|copyFile/.test(src));
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/spawnSync\(\) \{ throw[^}]*\}/, '');
  check('the extension starts no process (Claude Desktop\'s built-in Node forbids it): no child_process, no execPath, no worker', !/child_process|spawn|fork\(|execSync|execFile|exec\(|process\.execPath|worker_threads/.test(code), (code.match(/child_process|spawn|fork\(|exec\w*\(|process\.execPath|worker_threads/) || [])[0]);
  check('the tool runs in this process with the terminal replaced (output captured, no clipboard, no program)', /cliMain\.run\(args, env\)/.test(src) && /stdout: sink\(out, true\)/.test(src) && /spawnSync\(\) \{ throw/.test(src));
  check('the reader gets --json --no-copy (the clipboard is never touched) and the path after --', /'--json', '--no-copy'/.test(src) && /args\.push\('--', a\.path\)/.test(src));
  check('stdout is written only by the protocol functions', (src.match(/process\.stdout\.write/g) || []).length === 1 && !/console\.log/.test(src));

  fs.rmSync(GUARD, { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
  console.log('\n' + (total - failed) + '/' + total + ' checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
