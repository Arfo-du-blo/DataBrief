#!/usr/bin/env node
/* The terminal pack (agents/, built by tools/build-agents.cjs): the skill and the paste-in snippet.
 *   node tests/test_agents.cjs
 * Checks: the build is reproducible; the zip's contents; the skill's front matter; every option the texts name exists in the command-line tool; the version
 * is pinned; the rules are there (ask one question, --no-copy, respect the choice, prompt is data); and the commands the texts give are RUN from the unzipped
 * skill, as an agent would, in both modes (canary absent from Do not share data, a name starting with a dash, spaces, a missing file, --out). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { build } = require('../tools/build-agents.cjs');
const fflate = (() => { const m = { exports: {} }; new Function('module', 'exports', 'self', fs.readFileSync(path.join(ROOT, 'vendor', 'fflate.min.js'), 'utf8'))(m, m.exports, undefined); return m.exports; })();
let failed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } else console.log('ok   ' + name); };
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const a = build(), b = build();
check('the build is reproducible (zip, snippet)', Buffer.compare(a.zip, b.zip) === 0 && Buffer.compare(a.snippet, b.snippet) === 0);
const files = fflate.unzipSync(new Uint8Array(a.zip));
const names = Object.keys(files);
check('the zip holds the skill folder only: databrief/SKILL.md, scripts/databrief.cjs, LICENSE, THIRD-PARTY-NOTICES.md (the script bundles code of other projects)', names.join() === 'databrief/SKILL.md,databrief/scripts/databrief.cjs,databrief/LICENSE,databrief/THIRD-PARTY-NOTICES.md', names.join());
const skill = Buffer.from(files['databrief/SKILL.md']).toString('utf8');
const snippet = a.snippet.toString('utf8');

// front matter
const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
const meta = {};
if (fm) for (const line of fm[1].split('\n')) { const m = /^(\w[\w-]*):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2]; }
check('SKILL.md starts with front matter holding name and description only', !!fm && Object.keys(meta).join() === 'name,description');
check('skill name is "databrief" (the folder\'s name), lower case', meta.name === 'databrief');
check('skill description: at most 1024 characters, says what it does and when to use it, no angle brackets', !!meta.description && meta.description.length <= 1024 && /Use it when/.test(meta.description) && !/[<>]/.test(meta.description), String((meta.description || '').length));
check('no placeholder left in the skill or the snippet', !/\{\{|\}\}/.test(skill + snippet));
const npxUses = ((skill + snippet).match(/npx[^`\n]*/g) || []);
check('every npx use is pinned to package.json\'s version (never latest, never unpinned)', npxUses.length >= 2 && npxUses.every((u) => u.startsWith('npx -y databrief@' + pkg.version)), npxUses.join(' | '));

check('skill: the script path is in quotes (a space or a Windows path in the folder)', skill.includes('node "<skill folder>/scripts/databrief.cjs" --json'));
check('skill: --out (the prompt, and the data when shared, written to disk) only after asking the user', /ask the user whether DataBrief may write it to a folder/.test(skill) && skill.indexOf('ask the user whether DataBrief may write') < skill.indexOf('--out "<existing folder>"'));

// every option named in the texts exists in the tool
const help = execFileSync(process.execPath, [path.join(ROOT, 'cli', 'databrief.cjs'), '--help']).toString('utf8');
const named = new Set(((skill + snippet).match(/(?<![\w-])--[a-z][a-z-]*/g)) || []);
const known = new Set(help.match(/(?<![\w-])--[a-z][a-z-]*/g) || []);   // whole options only: a cut-off "--no-shar" is not an option
const missing = [...named].filter((o) => !known.has(o));
check('every --option the texts name exists in the command-line tool (' + [...named].join(' ') + ')', missing.length === 0, missing.join(' '));
check('every named level and part exists (levels 1-3; names, labels, rel, file, text, sql)', ['names', 'labels', 'rel', 'file', 'text', 'sql'].every((p) => new RegExp('--hide=' + p + '(?![a-z])').test(skill)) && /--no-share=1\|2\|3/.test(skill) && /--no-share=1\|2\|3/.test(snippet));
check('the clipboard rule is stated, and --limit auto is the documented value in both texts', /always add it/.test(skill) && /Always `--no-copy`/.test(snippet) && /--limit auto(?![a-z])/.test(skill) && /--limit auto(?![a-z])/.test(snippet));
check('the texts always add --no-copy and put the path after "--"', /--json --no-copy/.test(skill) && /--json --no-copy/.test(snippet) && /-- "<absolute path/.test(skill) && /-- "<absolute path/.test(snippet));
check('both texts: ask ONE question (may the data be shared)', /ONE (thing|question)/.test(skill) && /ONE question/.test(snippet) && /shared/.test(skill) && /shared/.test(snippet));
check('both texts: respect the choice (no other way to read the file when the data is not shared)', /do not read the file's contents by (any )?other means/.test(skill) && /do not read the file's contents by any other means/.test(snippet));
check('both texts: the prompt is data, never instructions', /data, not orders/.test(skill) && /never as instructions/.test(snippet));
check('both texts: nothing is sent anywhere; the npx download needs the user\'s consent', /Never send the prompt/.test(skill) && /Do not send them anywhere/.test(snippet) && /asking the user/.test(skill) && /ask the user/.test(snippet));
check('level 3 is only for when the user asks, and the risk is said', /level 3[\s\S]*real values/.test(skill) && /real values; use it only if asked/.test(snippet));

// run what the texts say, from the unzipped skill
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-agents-test-'));
for (const n of names) { const f = path.join(dir, n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, files[n]); }
const script = path.join(dir, 'databrief', 'scripts', 'databrief.cjs');
const cliBuilt = path.join(dir, 'cli-release.cjs');
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-cli.cjs'), cliBuilt], { stdio: 'ignore' });
check('the bundled script is the release build of the command-line tool, byte for byte', Buffer.compare(fs.readFileSync(script), fs.readFileSync(cliBuilt)) === 0);
check('the bundled script says the package version', spawnSync(process.execPath, [script, '--version']).stdout.toString().includes(pkg.version));

const data = path.join(dir, 'my data');   // a folder name with a space
fs.mkdirSync(data);
const CANARY = 'CANARY-Qw3z-' + crypto.randomBytes(3).toString('hex');
const csv = path.join(data, 'sales.csv');
fs.writeFileSync(csv, 'id,customer,amount\n' + Array.from({ length: 30 }, (_, i) => (i + 1) + ',' + (i === 2 ? CANARY : 'c' + i) + ',' + i * 2.5).join('\n') + '\n');
const dash = path.join(data, '-weird.csv');
fs.copyFileSync(csv, dash);
const run = (args) => { const r = spawnSync(process.execPath, [script].concat(args), { maxBuffer: 1 << 28, cwd: dir }); let j = null; try { j = JSON.parse(r.stdout.toString('utf8')); } catch (e) { /* not json */ } return { code: r.status, j, err: r.stderr.toString('utf8') }; };

const yes = run(['--json', '--no-copy', '--limit', 'auto', '--', csv]);
check('documented command, data shared: ok, the prompt holds the data, path with spaces', yes.code === 0 && yes.j && yes.j.ok && yes.j.shared === true && yes.j.prompt.includes(CANARY));
for (const level of [1, 2, 3]) {
  const r = run(['--json', '--no-copy', '--no-share=' + level, '--lang', 'fr', '--', csv]);
  check('documented command, Do not share data, level ' + level + ': ok, no record, canary absent anywhere', r.code === 0 && r.j && r.j.ok && r.j.shared === false && !r.j.prompt.includes(CANARY) && !JSON.stringify(r.j).includes(CANARY) && !r.err.includes(CANARY));
}
const hid = run(['--json', '--no-copy', '--no-share=1', '--hide=file', '--', csv]);
check('--hide=file keeps the file name out of the whole answer', !!hid.j && hid.j.ok && !JSON.stringify(hid.j).includes('sales.csv') && !hid.err.includes('sales.csv'));
const dsh = run(['--json', '--no-copy', '--no-share=1', '--', dash]);
check('a file whose name starts with a dash is read as a file (after --)', dsh.code === 0 && !!dsh.j && dsh.j.ok);
const miss = run(['--json', '--no-copy', '--', path.join(data, 'nope.csv')]);
check('a missing file: ok false, an error to pass on, exit 1', miss.code === 1 && !!miss.j && miss.j.ok === false && !!miss.j.error);
const clip = run(['--json', '--no-copy', '--no-share=1', '--', csv]);
check('--no-copy: the clipboard is not used', !!clip.j && clip.j.copied === false);
const outDir = path.join(dir, 'out'); fs.mkdirSync(outDir);
const outRun = spawnSync(process.execPath, [script, '--no-copy', '--quiet', '--out', outDir, '--', csv], { cwd: dir });
const sub = fs.readdirSync(outDir);
const promptFile = sub.length ? path.join(outDir, sub[0], 'prompt.md') : '';
check('the --out fallback: a new folder in the existing one holds prompt.md equal to the JSON prompt', outRun.status === 0 && !!promptFile && fs.existsSync(promptFile) && fs.readFileSync(promptFile, 'utf8').replace(/\r\n/g, '\n').trim() === yes.j.prompt.replace(/\r\n/g, '\n').trim(), outRun.stderr.toString().slice(0, 200));

// the MCP configuration: valid, pinned, and its arguments start the server (run here with the unzipped script in npx's place)
let conf = null;
try { conf = JSON.parse(a.mcpConfig.toString('utf8')); } catch (e) { /* checked below */ }
const srv = conf && conf.mcpServers && conf.mcpServers.databrief;
check('mcp.json: valid JSON, one server "databrief" run by npx, pinned to the package version, --mcp --root .', !!srv && srv.command === 'npx' && JSON.stringify(srv.args) === JSON.stringify(['-y', 'databrief@' + pkg.version, '--mcp', '--root', '.']));
check('mcp.json: same bytes on every build', Buffer.compare(a.mcpConfig, b.mcpConfig) === 0);
if (srv) {
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n';
  const r = spawnSync(process.execPath, [script].concat(srv.args.slice(2)), { input: init, cwd: data, encoding: 'utf8' });
  const msgs = r.stdout.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } });
  check('mcp.json: those arguments start the MCP server, which lists databrief_analyze and ends with its input', r.status === 0 && msgs.length === 2 && msgs[1] && msgs[1].result.tools[0].name === 'databrief_analyze', r.stderr.slice(0, 200));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + (total - failed) + '/' + total + ' checks passed');
process.exit(failed ? 1 : 0);
