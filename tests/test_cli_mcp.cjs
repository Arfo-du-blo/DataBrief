#!/usr/bin/env node
/* databrief --mcp: the command-line tool as a local MCP server (cli/mcp.cjs), for AI agents.
 *   node tests/test_cli_mcp.cjs
 * Runs the tool from the source tree AND the built single file (tools/build-cli.cjs), each under a guard that makes every way of starting a
 * process throw. Checks: the command line (--mcp takes nothing but --root); the handshake; one tool, no widget, no resource; the same prompt as
 * the command line in both modes; Do not share data keeps canaries out of the answer, its errors and the log, a parser error included;
 * --root (inside, outside, "..", a missing file answered like an outside one, links out of the folder, letter case on Windows); refusals;
 * several calls at once; stdout holds protocol only; the server ends when its input ends. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failed = 0, total = 0;
// A call that is never answered leaves nothing for Node to do, and Node then ends with exit 0 without the summary: that is a failure.
let finished = false;
process.on('exit', (code) => { if (!finished && code === 0) { console.log('FAIL the test stopped before its end (something was never answered)'); process.exitCode = 1; } });
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } else console.log('ok   ' + name); };
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-climcp-'));
const GUARD = path.join(tmp, 'guard.cjs');
fs.writeFileSync(GUARD, "const cp = require('child_process'); for (const k of ['spawn','spawnSync','fork','exec','execSync','execFile','execFileSync']) cp[k] = function () { throw new Error('GUARD: a subprocess was started (' + k + ')'); };\n");
const SOURCE = path.join(ROOT, 'cli', 'databrief.cjs');
const BUILT = path.join(tmp, 'databrief-cli.cjs');
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-cli.cjs'), BUILT], { stdio: 'ignore' });

class Client {
  constructor(cli, args) {
    this.child = spawn(process.execPath, ['--require', GUARD, cli, '--mcp'].concat(args || []), { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.buf = ''; this.err = ''; this.waiting = new Map(); this.id = 0; this.badLines = 0;
    this.exit = new Promise((r) => this.child.on('close', (code) => r(code)));
    this.child.stdout.on('data', (c) => {
      this.buf += c;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch (e) { this.badLines++; continue; }
        if (m.jsonrpc !== '2.0') this.badLines++;
        const w = this.waiting.get(m.id); if (w) { this.waiting.delete(m.id); w(m); } else this.unexpected = (this.unexpected || 0) + 1;
      }
    });
    this.child.stderr.on('data', (c) => { this.err += c; });
  }
  call(method, params) { const id = ++this.id; return new Promise((res) => { this.waiting.set(id, res); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
  raw(s) { this.child.stdin.write(s); }
  close() { this.child.stdin.end(); const t = setTimeout(() => this.child.kill(), 5000); return this.exit.then((c) => { clearTimeout(t); return c; }); }
}
const cliJson = (args) => JSON.parse(execFileSync(process.execPath, [SOURCE, '--json', '--no-copy'].concat(args), { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'));
const text = (r) => r.result.content[0].text;

(async () => {
  // ---- the command line
  const opt = (args) => spawnSync(process.execPath, [SOURCE].concat(args), { input: '', encoding: 'utf8' });
  for (const [name, args] of [['a file', ['--mcp', 'x.csv']], ['--print', ['--mcp', '--print']], ['--no-share', ['--mcp', '--no-share']], ['--root without --mcp', ['--root', '.', 'x.csv']], ['--root that does not exist', ['--mcp', '--root', path.join(tmp, 'nope')]], ['--root that is a file', ['--mcp', '--root', GUARD]], ['--root without a value', ['--mcp', '--root']]]) {
    const r = opt(args);
    check('command line refused (exit 2, nothing on stdout): --mcp with ' + name, r.status === 2 && r.stdout === '', r.status + ' ' + r.stderr.trim());
  }
  const help = opt(['--help']).stdout;
  check('--help describes --mcp and --root', /--mcp\s/.test(help) && /--root DIR/.test(help) && /databrief --mcp --root \./.test(help));

  // ---- fixtures
  const data = path.join(tmp, 'data'); fs.mkdirSync(data);
  const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside);
  const CANARY = 'CANARY-Mc9p-' + crypto.randomBytes(3).toString('hex');
  const csv = path.join(data, 'sales.csv');
  fs.writeFileSync(csv, 'id,customer,amount\n' + Array.from({ length: 30 }, (_, i) => (i + 1) + ',' + (i === 2 ? CANARY : 'c' + i) + ',' + i * 2.5).join('\n') + '\n');
  const broken = path.join(data, 'broken.json');
  fs.writeFileSync(broken, '{"a": 1, "b": ' + CANARY + ' ]');
  const secret = path.join(outside, 'secret.csv');
  fs.writeFileSync(secret, 'k,v\n1,' + CANARY + '\n');
  const dotted = path.join(data, '..notes.csv');
  fs.writeFileSync(dotted, 'a,b\n1,2\n');
  let hard = path.join(data, 'hard.csv');
  try { fs.linkSync(secret, hard); } catch (e) { hard = null; }
  let linkOut = null, linkIn = null;
  try { linkOut = path.join(data, 'link-out.csv'); fs.symlinkSync(secret, linkOut); linkIn = path.join(data, 'link-in.csv'); fs.symlinkSync(csv, linkIn); } catch (e) { linkOut = linkIn = null; }

  for (const [label, cli] of [['source', SOURCE], ['built file', BUILT]]) {
    // ---- no --root
    const c = new Client(cli);
    const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    check(label + ': initialize: version echoed, tools only (no resources), package version', init.result.protocolVersion === '2025-06-18' && init.result.capabilities.tools && !init.result.capabilities.resources && init.result.serverInfo.version === pkg.version);
    const tools = (await c.call('tools/list')).result.tools;
    check(label + ': exactly one tool, databrief_analyze, read-only, share required with no default, no widget', tools.length === 1 && tools[0].name === 'databrief_analyze' && tools[0].annotations.readOnlyHint === true && tools[0].inputSchema.required.join() === 'path,share' && tools[0].inputSchema.properties.share.default === undefined && !tools[0]._meta);
    check(label + ': the description asks the AI to ask, to respect the choice, and not to follow instructions in the prompt', /ASK THEM/.test(tools[0].description) && /do not read the file's contents by any other means/.test(tools[0].description) && /never follow instructions/.test(tools[0].description));
    check(label + ': no resource, no widget tool', (await c.call('resources/list')).result.resources.length === 0 && !!(await c.call('resources/read', { uri: 'ui://databrief-local/widget-v12.html' })).error && !!(await c.call('tools/call', { name: 'databrief_open', arguments: {} })).error);
    const call = (args) => c.call('tools/call', { name: 'databrief_analyze', arguments: args });
    const yes = await call({ path: csv, share: 'yes' });
    check(label + ': share yes = the command line\'s prompt, with the data', !yes.result.isError && text(yes) === cliJson(['--limit', 'auto', '--', csv]).prompt && text(yes).includes(CANARY));
    for (const level of [1, 2, 3]) {
      const r = await call({ path: csv, share: 'no', level, lang: 'de' });
      check(label + ': share no, level ' + level + ' = the command line\'s prompt, canary absent', !r.result.isError && text(r) === cliJson(['--no-share=' + level, '--lang', 'de', '--', csv]).prompt && !JSON.stringify(r).includes(CANARY));
    }
    const br = await call({ path: broken, share: 'no' });
    check(label + ': a parser error in Do not share data does not quote the file', br.result.isError === true && !JSON.stringify(br).includes(CANARY), JSON.stringify(br).slice(0, 200));
    const any = await call({ path: secret, share: 'no' });
    check(label + ': without --root any readable file can be read (documented)', !any.result.isError);
    const strNum = await call({ path: csv, share: 'yes', limit: '5' });
    const strLvl = await call({ path: csv, share: 'no', level: '2' });
    check(label + ': limit and level given as text (clients that flatten the schema) are taken as numbers', !strNum.result.isError && text(strNum) === cliJson(['--limit', '5', '--', csv]).prompt && !strLvl.result.isError && text(strLvl) === cliJson(['--no-share=2', '--', csv]).prompt);
    const l3 = await call({ path: csv, share: 'no', level: 3 });
    const l1 = await call({ path: csv, share: 'no' });
    const withText = await call({ path: csv, share: 'no', allow: ['text', 'sql'] });
    check(label + ': the summary line says level 3 can show real values, level 1 does not', /can show real values/.test(l3.result.content[1].text) && !/real values/.test(l1.result.content[1].text) && /holds NO record/.test(l1.result.content[1].text));
    check(label + ': the summary line says when the file\'s own text or SQL code is included', /INCLUDES the file's own written text and its SQL code/.test(withText.result.content[1].text));
    check(label + ': the schema says text and sql can put the file\'s contents in the prompt', /only when the user asked/.test(tools[0].inputSchema.properties.allow.description) && /OWN WRITTEN TEXT/.test(tools[0].inputSchema.properties.allow.description));
    if (process.platform === 'win32') {
      for (const unc of ['\\\\127.0.0.1\\c$\\x.csv', '//127.0.0.1/c$/x.csv', '\\\\?\\C:\\x.csv', '\\\\.\\NUL']) {
        const u = await call({ path: unc, share: 'yes' });
        check(label + ': without --root too, a network or device path is refused: ' + unc, u.result.isError === true && /network and device paths/.test(text(u)));
      }
    }
    for (const [name, args] of [['share missing', { path: csv }], ['relative path', { path: 'sales.csv', share: 'no' }], ['option as a path', { path: '--version', share: 'no' }], ['bad level', { path: csv, share: 'no', level: 7 }], ['arguments not an object', [csv, 'no']]]) {
      const r = await call(args);
      check(label + ': refused with a message: ' + name, r.result && r.result.isError === true && r.result.content[0].text.length > 10);
    }
    // several calls at once: every answer comes back with its own id
    const many = await Promise.all([1, 2, 3].map((l) => call({ path: csv, share: 'no', level: l })));
    check(label + ': three calls at once, three answers in order of their ids', many.every((r, i) => !r.result.isError && r.id === many[0].id + i));
    c.raw('not json\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    check(label + ': alive after a bad line and a notification', (await c.call('ping')).result !== undefined);
    const code = await c.close();
    check(label + ': ends with exit 0 when its input ends', code === 0, String(code));
    check(label + ': stdout held protocol messages only, and no answer to a notification', c.badLines === 0 && !c.unexpected);
    check(label + ': the log holds no path, file name or content', /MCP server started, version/.test(c.err) && !c.err.includes(CANARY) && !c.err.includes(data) && !c.err.includes('sales.csv') && !c.err.includes(tmp), c.err.slice(0, 300));
    check(label + ': no subprocess was attempted', !c.err.includes('GUARD'));

    // ---- with --root
    const r = new Client(cli, ['--root', data]);
    await r.call('initialize', { protocolVersion: '2025-06-18' });
    const rc = (args) => r.call('tools/call', { name: 'databrief_analyze', arguments: args });
    const inside = await rc({ path: csv, share: 'no' });
    check(label + ': --root: a file inside is read', !inside.result.isError);
    const out = await rc({ path: secret, share: 'yes' });
    const missingIn = await rc({ path: path.join(data, 'nope.csv'), share: 'no' });
    check(label + ': --root: a file outside is refused, with the same answer as a missing file (nothing told about what exists)', out.result.isError === true && !JSON.stringify(out).includes(CANARY) && text(out) === text(missingIn));
    const dots = await rc({ path: path.join(data, '..', 'outside', 'secret.csv'), share: 'yes' });
    check(label + ': --root: ".." out of the folder is refused', dots.result.isError === true && !JSON.stringify(dots).includes(CANARY));
    const rootItself = await rc({ path: data, share: 'no' });
    check(label + ': --root: the folder itself is not a file', rootItself.result.isError === true);
    if (linkOut) {
      const lo = await rc({ path: linkOut, share: 'yes' });
      check(label + ': --root: a link inside that points outside is refused', lo.result.isError === true && !JSON.stringify(lo).includes(CANARY));
      const li = await rc({ path: linkIn, share: 'no' });
      check(label + ': --root: a link inside that points inside is read', !li.result.isError);
    } else console.log('SKIP ' + label + ': links (this system does not let this user create them)');
    if (process.platform === 'win32') {
      const up = await rc({ path: csv.toUpperCase(), share: 'no' });
      check(label + ': --root: another letter case of a file inside is read (Windows)', !up.result.isError);
    }
    const dotName = await rc({ path: dotted, share: 'no' });
    check(label + ': --root: a file whose name starts with ".." is inside, and read', !dotName.result.isError, text(dotName));
    if (hard) {
      const hl = await rc({ path: hard, share: 'yes' });
      check(label + ': --root: a hard link inside to a file outside is refused (a file with two names)', hl.result.isError === true && !JSON.stringify(hl).includes(CANARY) && text(hl) === text(missingIn));
    } else console.log('SKIP ' + label + ': hard links (this file system does not have them)');
    if (process.platform === 'win32') {
      for (const unc of ['\\\\127.0.0.1\\c$\\x.csv', '//127.0.0.1/c$/x.csv', '\\\\?\\UNC\\127.0.0.1\\c$\\x.csv', '\\\\.\\pipe\\x']) {
        const u = await rc({ path: unc, share: 'yes' });
        check(label + ': --root: a network or device path is refused: ' + unc, u.result.isError === true && /network and device paths/.test(text(u)));
      }
    }
    await r.close();
    check(label + ': --root: the log names no folder', !r.err.includes(data) && /limited to the --root folder/.test(r.err));
  }

  // ---- relative --root (as agents' configurations write it: --root .)
  const rel = new Client(SOURCE, ['--root', '.']);
  // the child runs in this process's folder: the repository; a file of it is inside, the temp folder is not
  await rel.call('initialize', {});
  const inRepo = await rel.call('tools/call', { name: 'databrief_analyze', arguments: { path: path.join(ROOT, 'package.json'), share: 'no' } });
  const outRepo = await rel.call('tools/call', { name: 'databrief_analyze', arguments: { path: csv, share: 'no' } });
  check('--root . means the folder the agent starts the server in', !inRepo.result.isError && outRepo.result.isError === true);
  await rel.close();

  // ---- the core (cli/mcp.cjs) with a stand-in reader: what the real one never does in a test
  const mcp = require('../cli/mcp.cjs');
  const fake = (run) => mcp.createServer({ main: { run, defaultEnv: () => ({ spawnSync: () => ({ status: 0 }), which: () => '/usr/bin/xclip', stdinIsTTY: true, stdoutIsTTY: true }) }, version: '0' });   // a real-looking environment: the server must replace all of it
  const callFake = (srv, args) => srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'databrief_analyze', arguments: args } }).then((m) => m.result);
  const boom = () => Promise.reject(new Error('parse failed near ' + CANARY));
  const noAns = await callFake(fake(boom), { path: csv, share: 'no' });
  const yesAns = await callFake(fake(boom), { path: csv, share: 'yes' });
  check('core: a reader that fails in Do not share data: only the kind of error, never its message', noAns.isError && !JSON.stringify(noAns).includes(CANARY) && /\(Error\)/.test(noAns.content[0].text));
  check('core: with the data shared, the message is given (it helps, and the data is shared anyway)', yesAns.isError && JSON.stringify(yesAns).includes(CANARY));
  let seen = null;
  const spy = fake((args, env) => { seen = { args }; try { env.spawnSync('x'); seen.spawn = 'ran'; } catch (e) { seen.spawn = 'refused'; } seen.which = env.which('xclip'); seen.tty = env.stdoutIsTTY || env.stdinIsTTY; env.stdout.write(JSON.stringify({ ok: true, prompt: 'P', format: 'CSV', tokens: 1, shared: false, level: 1 })); return Promise.resolve(0); });
  const spyAns = await callFake(spy, { path: csv, share: 'no' });
  check('core: the reader gets no way to start a program, no clipboard tool, no terminal', seen && seen.spawn === 'refused' && seen.which === null && !seen.tty && spyAns.content[0].text === 'P');
  check('core: the reader gets --json --no-copy, and the path last, after "--"', seen && seen.args[0] === '--json' && seen.args[1] === '--no-copy' && seen.args[seen.args.length - 2] === '--' && seen.args[seen.args.length - 1] === csv);
  const note = await fake(() => Promise.resolve(0)).handle({ jsonrpc: '2.0', method: 'tools/list' });
  check('core: a notification gets no answer', note === undefined);
  const noWidget = fake(() => Promise.resolve(0));
  check('core: no widget given, no databrief_open and no resource', noWidget.tools.map((x) => x.name).join() === 'databrief_analyze');

  // a network path is refused before ANY file system call (opening it could connect to another computer), with or without root
  if (process.platform === 'win32') {
    const touched = [];
    const saved = { real: fs.realpathSync.native, stat: fs.statSync, lstat: fs.lstatSync };
    fs.realpathSync.native = function (p) { touched.push(p); return saved.real.apply(this, arguments); };
    fs.statSync = function (p) { touched.push(p); return saved.stat.apply(this, arguments); };
    fs.lstatSync = function (p) { touched.push(p); return saved.lstat.apply(this, arguments); };
    let refused = 0;
    try {
      for (const p of ['\\\\attacker.example\\s\\a.csv', '//attacker.example/s/a.csv']) for (const root of [null, data]) if (mcp.check({ path: p, share: 'yes' }, root, root).error) refused++;
    } finally { fs.realpathSync.native = saved.real; fs.statSync = saved.stat; fs.lstatSync = saved.lstat; }
    check('core: a network path is refused without any file system call (Windows)', refused === 4 && touched.length === 0, touched.join(' '));
  }
  // with root, a path outside is refused by its name first: nothing outside is looked at
  {
    const touched = [];
    const saved = fs.realpathSync.native;
    fs.realpathSync.native = function (p) { touched.push(p); return saved.apply(this, arguments); };
    let r;
    try { r = mcp.check({ path: secret, share: 'yes' }, fs.realpathSync(data), data); } finally { fs.realpathSync.native = saved; }
    check('core: --root: a path outside is refused before its real path is looked up', !!r.error && touched.length === 0, touched.join(' '));
  }
  let diskRoot = null;
  try { mcp.resolveRoot(path.parse(tmp).root); } catch (e) { diskRoot = e.message; }
  check('core: --root refuses the root of a disk (it would open every file)', /root of a disk/.test(diskRoot || ''), String(diskRoot));
  // a read that runs out of time: answered at once; the queue stays closed (calls are told) until the read really ends
  {
    let release, runs = 0;
    const slow = mcp.createServer({ main: { run: () => (++runs === 1 ? new Promise((r) => { release = () => r(0); }) : Promise.resolve(0)), defaultEnv: () => ({}) }, version: '0', timeoutMs: 150 });
    const ask = () => slow.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'databrief_analyze', arguments: { path: csv, share: 'no' } } }).then((m) => m.result);
    const first = await ask();
    const second = await ask();
    check('core: a read past its time is answered as such, and the next call is told the reader is still busy', first.isError && /given up/.test(first.content[0].text) && second.isError && /still busy/.test(second.content[0].text), first.content[0].text + ' / ' + second.content[0].text);
    release();
    await new Promise((r) => setTimeout(r, 50));
    const third = await ask();
    check('core: once the slow read has really ended, calls are taken again', third.isError && !/still busy/.test(third.content[0].text) && !/given up/.test(third.content[0].text), third.content[0].text);
  }
  // batches over stdio: one array back, every message answered, even past 50
  {
    const { PassThrough } = require('stream');
    const input = new PassThrough(), output = new PassThrough();
    let outText = ''; output.setEncoding('utf8'); output.on('data', (c) => { outText += c; });
    const done = mcp.serveStdio({ main: { run: () => Promise.resolve(0), defaultEnv: () => ({}) }, version: '0', input, output });
    input.write(JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'ping' }))) + '\n');
    input.end();
    await done;
    let arr = null; try { arr = JSON.parse(outText.trim()); } catch (e) { /* */ }
    check('core: a batch of 60 gets ONE array of 60 answers (50 done, 10 refused), not a silence', Array.isArray(arr) && arr.length === 60 && arr.filter((m) => m.result).length === 50 && arr.filter((m) => m.error).length === 10, outText.slice(0, 120));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + (total - failed) + '/' + total + ' checks passed');
  finished = true;
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) { /* */ } process.exit(2); });
