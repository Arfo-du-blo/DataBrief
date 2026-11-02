#!/usr/bin/env node
/* "Do not share data" and safety of the command-line tool, run as a real process (the one-file build) under tests/guard_cli.cjs:
 *   node tests/test_cli_privacy.cjs [FIXTURES_DIR]
 * 1. Canaries (the CONFIDENTIAL_FILE_* files of tests/make_fixtures.py when FIXTURES_DIR is given, plus files written here):
 *    in "Do not share data" no record and no formula ever reaches ANY output of the tool (standard output, standard error, the
 *    clipboard, prompt.md, the JSON, the names of the folders and files it writes), at the 3 levels; free text and SQL only
 *    when allowed; with --hide=file / --hide=names / --hide=labels those are nowhere either. Positive controls everywhere.
 * 2. No network: every run is made under a guard that blocks and logs every network API; the only program started is the
 *    clipboard tool, never through a shell.
 * 3. Hostile names (shell syntax, escape sequences, line breaks, direction overrides): nothing runs, the terminal gets no
 *    control character, the folders written have clean names. Data holding escape sequences: none reach a terminal.
 * 4. Special files (a device, a pipe, a link to them, a folder, a file over 2 GB): refused at once.
 * 5. The code: no shell anywhere in cli/.
 * DATABRIEF_CLI_BUILD: use this built file instead of building one, DATABRIEF_CLI: another copy of cli/ (to check that the test
 * catches a change). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const FIX = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : null;
const WIN = process.platform === 'win32';
const CLI = process.env.DATABRIEF_CLI || path.join(ROOT, 'cli');   // another copy of cli/ for the in-process parts (sabotage checks)
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-privacy-'));
let tmpN = 0;
const tmp = () => { const d = path.join(tmpRoot, 'w' + ++tmpN); fs.mkdirSync(d); return d; };
const tree = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [e.name + '/'].concat(tree(path.join(d, e.name)).map((x) => e.name + '/' + x)) : [e.name])).sort() : []);

/* ---------- the tool, the guard, a fake clipboard ---------- */
let DIST = process.env.DATABRIEF_CLI_BUILD;
if (!DIST) {
  DIST = path.join(tmpRoot, 'databrief-cli.cjs');
  const b = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-cli.cjs'), DIST], { encoding: 'utf8' });
  if (b.status !== 0) { console.log('FAIL build: ' + b.stderr); process.exit(1); }
}
const GUARD = path.join(__dirname, 'guard_cli.cjs');
const BIN = path.join(tmpRoot, 'bin');
fs.mkdirSync(BIN);
// The clipboard tools the tool looks for, as scripts that write what they receive to $CLIP_OUT (not on Windows: there the
// runs use --no-copy and the clipboard is checked by tests/test_cli.cjs with stand-ins)
if (!WIN) for (const n of ['xclip', 'pbcopy', 'powershell.exe']) { fs.writeFileSync(path.join(BIN, n), '#!/bin/sh\ncat > "$CLIP_OUT"\n'); fs.chmodSync(path.join(BIN, n), 0o755); }
const baseEnv = Object.assign({}, process.env);
for (const k of ['WAYLAND_DISPLAY', 'DATABRIEF_ROOT', 'VISUAL', 'EDITOR']) delete baseEnv[k];
baseEnv.PATH = WIN ? process.env.PATH : BIN + path.delimiter + '/usr/bin' + path.delimiter + '/bin';

async function tool(args, cwd) {
  const log = path.join(tmpRoot, 'guard-' + ++tmpN + '.log');
  const clip = path.join(tmpRoot, 'clip-' + tmpN + '.txt');
  const env = Object.assign({}, baseEnv, { GUARD_LOG: log, CLIP_OUT: clip });
  const r = await new Promise((resolve) => cp.execFile(process.execPath, ['--require', GUARD, DIST].concat(args), { encoding: 'utf8', maxBuffer: 1 << 28, env, cwd: cwd || tmpRoot, timeout: 120000 },
    (e, so, se) => resolve({ code: e ? (e.killed ? 'killed' : e.code) : 0, out: so, err: se })));
  r.guard = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  r.clip = fs.existsSync(clip) ? fs.readFileSync(clip, 'utf8') : '';
  r.network = r.guard.filter((g) => g.kind === 'network');
  r.shell = r.guard.filter((g) => g.kind === 'shell');
  r.spawns = r.guard.filter((g) => g.kind === 'spawn');
  return r;
}
async function pool(items, n, fn) { const q = items.slice(); await Promise.all(new Array(n).fill(0).map(async () => { while (q.length) await fn(q.shift()); })); }

(async () => {
  /* ---------------------------------------------------------------- 1. canaries ---------- */
  const synth = tmp();
  const SYN = [
    { f: 'CONFIDENTIAL_FILE_synthetic.csv', body: 'CONFIDENTIAL_COL_A,CONFIDENTIAL_COL_B,amount\nCONFIDENTIAL_REC_01,"=CONFIDENTIAL_FORMULA()",10\nCONFIDENTIAL_REC_02,x,12\nCONFIDENTIAL_REC_03,y,14\n' },
    { f: 'CONFIDENTIAL_FILE_synthetic.sql', sql: true, lab: true, body: "-- CONFIDENTIAL_TEXT comment\nCREATE TABLE CONFIDENTIAL_COL_T (CONFIDENTIAL_COL_ID integer PRIMARY KEY, name text DEFAULT 'CONFIDENTIAL_SQL_DEFAULT');\nCOMMENT ON COLUMN CONFIDENTIAL_COL_T.name IS 'CONFIDENTIAL_LABEL_NAME';\nINSERT INTO CONFIDENTIAL_COL_T VALUES (1, 'CONFIDENTIAL_REC_01');\nINSERT INTO CONFIDENTIAL_COL_T VALUES (2, 'CONFIDENTIAL_REC_02');\n" },
    { f: 'CONFIDENTIAL_FILE_synthetic.json', body: JSON.stringify([{ CONFIDENTIAL_COL_X: 'CONFIDENTIAL_REC_01', n: 1 }, { CONFIDENTIAL_COL_X: 'CONFIDENTIAL_REC_02', n: 2 }]) },
  ];
  for (const s of SYN) fs.writeFileSync(path.join(synth, s.f), s.body);
  const FROM_FIX = [
    { f: 'csv.csv' }, { f: 'tsv.tsv' }, { f: 'txt.txt' }, { f: 'xlsx.xlsx', txt: true, frm: true }, { f: 'xls.xls' }, { f: 'ods.ods' },
    { f: 'json.json' }, { f: 'ndjson.ndjson' }, { f: 'yaml.yaml' }, { f: 'xml.xml' }, { f: 'html.html' },
    { f: 'sav.sav', txt: true, lab: true }, { f: 'zsav.zsav', txt: true, lab: true }, { f: 'parquet.parquet', txt: true }, { f: 'sqlite.sqlite', sql: true },
    { f: 'sql.sql', txt: true, lab: true, sql: true }, { f: 'pgdump.dump', txt: true, lab: true, sql: true }, { f: 'dbf.dbf', names: 'CONF_COL' }, { f: 'access.accdb' },
    { f: 'dacpac.dacpac', noRec: true, txt: true, lab: true, sql: true }, { f: 'csvgz.csv.gz' }, { f: 'geojson.geojson' }, { f: 'gpkg.gpkg' }, { f: 'ipynb.ipynb', txt: true },
    { f: 'avro.avro', txt: true }, { f: 'arrow.arrow', txt: true }, { f: 'feather.feather', txt: true },
    { f: 'docx.docx', txt: true }, { f: 'odt.odt', txt: true }, { f: 'pptx.pptx', txt: true }, { f: 'odp.odp', txt: true }, { f: 'pdf.pdf', txt: true }, { f: 'pdfslides.pdf', txt: true },
  ].map((c) => Object.assign(c, { file: FIX ? path.join(FIX, 'CONFIDENTIAL_FILE_' + c.f) : null })).filter((c) => c.file && fs.existsSync(c.file));
  const CASES = SYN.map((s) => Object.assign({}, s, { file: path.join(synth, s.f) })).concat(FROM_FIX);
  console.log('(' + CASES.length + ' files' + (FIX ? '' : ': no FIXTURES_DIR, only the files written here') + ')');
  if (FIX) ok('canaries: the CONFIDENTIAL_FILE_* files of the fixtures are there', FROM_FIX.length >= 30, FROM_FIX.length);

  const copyArgs = WIN ? ['--no-copy'] : [];
  const bad = [];
  let runs = 0, spawnsSeen = 0;
  const VARIANTS = [
    { name: 'level 1', args: ['--no-share=1'] }, { name: 'level 2', args: ['--no-share=2'] }, { name: 'level 3', args: ['--no-share=3'] },
    { name: 'file hidden', args: ['--no-share=3', '--hide=file'], hidden: ['CONFIDENTIAL_FILE'] },
    { name: 'names hidden', args: ['--no-share=3', '--hide=names'], hidden: ['names'] },
    { name: 'labels hidden', args: ['--no-share=3', '--hide=labels'], hidden: ['CONFIDENTIAL_LABEL'] },
    { name: 'text and sql allowed', args: ['--no-share=3', '--allow=text,sql'], allowed: true },
  ];
  await pool(CASES, 4, async (c) => {
    const label = path.basename(c.file);
    const where = (r, outDir) => {
      const files = tree(outDir);
      const md = files.filter((x) => /prompt\.md$/.test(x)).map((x) => fs.readFileSync(path.join(outDir, x), 'utf8')).join('\n');
      return { all: [r.out, r.err, r.clip, md, files.join('\n')].join('\n<<>>\n'), files, md };
    };
    // control: data shared, the records are in the prompt
    const share = await tool([c.file, '--no-copy', '--print', '--quiet']);
    runs++;
    if (!c.noRec && !share.out.includes('CONFIDENTIAL_REC')) bad.push(label + ': shared, the records should be in the prompt (control)');
    if (share.network.length) bad.push(label + ': network use ' + JSON.stringify(share.network));
    if (share.spawns.length || share.shell.length) bad.push(label + ': --no-copy started a program ' + JSON.stringify(share.spawns.concat(share.shell)));
    for (const v of VARIANTS) {
      const outDir = tmp();
      const r = await tool([c.file, '--print', '--csv', '--out', outDir].concat(copyArgs, v.args));
      runs++;
      const w = where(r, outDir);
      const tag = label + ' [' + v.name + ']';
      if (r.code !== 0) { bad.push(tag + ': exit ' + r.code + ' ' + r.err.slice(0, 200)); continue; }
      for (const k of ['CONFIDENTIAL_REC', 'CONFIDENTIAL_FORMULA']) if (w.all.includes(k)) bad.push(tag + ': ' + k + ' in an output');
      if (!v.allowed) for (const k of ['CONFIDENTIAL_TEXT', 'CONFIDENTIAL_SQL']) if (w.all.includes(k)) bad.push(tag + ': ' + k + ' without being allowed');
      if (v.allowed) {
        if (c.txt && !w.md.includes('CONFIDENTIAL_TEXT') && !/\.pdf$/.test(label)) bad.push(tag + ': free text allowed but missing (control)');
        if (c.sql && !w.md.includes('CONFIDENTIAL_SQL')) bad.push(tag + ': SQL allowed but missing (control)');
      }
      for (const h of v.hidden || []) {
        const key = h === 'names' ? (c.names || 'CONFIDENTIAL_COL') : h;
        if (w.all.includes(key)) bad.push(tag + ': ' + key + ' is hidden but appears (' + ['stdout', 'stderr', 'clipboard', 'prompt.md', 'paths'].filter((_, i) => w.all.split('\n<<>>\n')[i].includes(key)).join(', ') + ')');
      }
      if (v.name === 'level 1') {
        if (!w.md.includes(c.names || 'CONFIDENTIAL_COL')) bad.push(tag + ': the names should be there by default (control)');
        if (!w.md.includes('CONFIDENTIAL_FILE')) bad.push(tag + ': the file name should be there by default (control)');
        if (c.lab && !w.md.includes('CONFIDENTIAL_LABEL')) bad.push(tag + ': the labels should be there by default (control)');
        if (!WIN && r.clip !== r.out) bad.push(tag + ': the clipboard should get the prompt that was printed (control)');
        const csvs = w.files.filter((x) => /\.csv$/.test(x));
        if (!c.noRec && !csvs.some((x) => fs.readFileSync(path.join(outDir, x), 'utf8').includes('CONFIDENTIAL_REC'))) bad.push(tag + ': --csv should write the data (control)');
      }
      if (r.network.length) bad.push(tag + ': network use ' + JSON.stringify(r.network));
      if (r.shell.length) bad.push(tag + ': a shell was used ' + JSON.stringify(r.shell));
      spawnsSeen += r.spawns.length;
      if (r.spawns.length > (WIN ? 0 : 1)) bad.push(tag + ': programs started ' + JSON.stringify(r.spawns));
    }
    // JSON (what a program or an AI agent reads), file name and names hidden
    for (const v of [VARIANTS[0], VARIANTS[3], VARIANTS[4]]) {
      const outDir = tmp();
      const r = await tool([c.file, '--json', '--no-copy', '--csv', '--out', outDir].concat(v.args));
      runs++;
      const tag = label + ' [json, ' + v.name + ']';
      let j = null;
      try { j = JSON.parse(r.out); } catch (e) { bad.push(tag + ': no JSON ' + r.out.slice(0, 100)); continue; }
      const all = r.out + r.err;
      for (const k of ['CONFIDENTIAL_REC', 'CONFIDENTIAL_FORMULA', 'CONFIDENTIAL_TEXT', 'CONFIDENTIAL_SQL']) if (all.includes(k)) bad.push(tag + ': ' + k);
      for (const h of v.hidden || []) { const key = h === 'names' ? (c.names || 'CONFIDENTIAL_COL') : h; if (all.includes(key)) bad.push(tag + ': hidden ' + key + ' appears'); }
      if (j.shared !== false) bad.push(tag + ': shared should be false');
      if (v.name === 'file hidden' && j.file !== null) bad.push(tag + ': "file" should be null');
    }
  });
  ok('canaries: in "Do not share data" no record, formula, free text or SQL in any output of the tool, hidden names nowhere, every control there (' + runs + ' runs)', bad.length === 0, bad.slice(0, 12).join(' | '));
  {
    // an error in "Do not share data": the technical message can quote the file, so it is left out (and in --json too)
    const broken = path.join(synth, 'CONFIDENTIAL_FILE_broken.json');
    // (the JSON error quotes about ten characters around the mistake: the canary is put there, and looked for as "CONFIDENTI")
    fs.writeFileSync(broken, '{"a": CONFIDENTIAL_REC_01 CONFIDENTIAL_TEXT }');
    const a = await tool([broken, '--no-share', '--no-copy', '--print']);
    const b = await tool([broken, '--no-share', '--json', '--no-copy']);
    const shared = await tool([broken, '--no-copy', '--print']);
    ok('an unreadable file in "Do not share data": nothing of its content in the error (standard error, JSON); with the data shared the detail is given (control)',
      a.code === 1 && b.code === 1 && !/CONFIDENTI/.test(a.out + a.err + b.out + b.err) && /damaged/.test(a.err) && JSON.parse(b.out).ok === false && /CONFIDENTI|Unexpected token C in JSON/.test(shared.err), a.err + ' / ' + b.out.slice(0, 200) + ' / ' + shared.err);
  }
  ok('no network: no run of the tool used a network API (guard on net, tls, dgram, dns, http, https, http2, fetch, WebSocket)', !bad.some((b) => /network use/.test(b)));
  ok('programs: none with --no-copy, at most the clipboard tool otherwise, never a shell' + (WIN ? '' : ' (' + spawnsSeen + ' clipboard calls)'), !bad.some((b) => /started|shell/.test(b)) && (WIN || spawnsSeen > 0));

  /* ---------------------------------------------------------------- 3. hostile names, escape sequences ---------- */
  if (!WIN) {
    const w = tmp();
    const names = ['$(touch PWNED1).csv', '`touch PWNED2`.csv', 'a;touch PWNED3;.csv', 'x && touch PWNED4.csv', 'esc\u001b]0;TITLE\u0007\u001b[2Jname.csv', 'new\nline.csv', 'rtl\u202egnp.csv', '-dash.csv', ' spaced .csv'];
    for (const n of names) fs.writeFileSync(path.join(w, n), 'a,b\n1,2\n');
    const out = tmp();
    let allGood = true;
    const problems = [];
    for (const n of names) {
      const r = await tool(['--no-copy', '--csv', '--out', out, '--', path.join(w, n)], w);
      if (r.code !== 0) { allGood = false; problems.push(JSON.stringify(n) + ' exit ' + r.code + ' ' + r.err.slice(0, 120)); }
      if (/[\u0000-\u0008\u000b-\u001f\u007f\u202e]/.test(r.err)) { allGood = false; problems.push(JSON.stringify(n) + ': a control character reached the terminal ' + JSON.stringify(r.err.slice(0, 160))); }
      if (r.shell.length) { allGood = false; problems.push('shell used'); }
    }
    const pwned = fs.readdirSync(w).concat(fs.readdirSync(tmpRoot), fs.readdirSync(out), fs.readdirSync(os.tmpdir())).filter((x) => /^PWNED\d$/.test(x));
    ok('hostile file names: read normally, nothing they hold is run', allGood && pwned.length === 0, problems.concat(pwned).join(' | '));
    const folders = fs.readdirSync(out);
    ok('hostile file names: the folders written have no control character, line break, direction override or path separator', folders.length === names.length && folders.every((f) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\/]/.test(f)), JSON.stringify(folders));
    // data holding escape sequences (OSC 52 would set the terminal's clipboard)
    const esc = path.join(w, 'esc.csv');
    const evil = 'v\u001b]52;c;SGFja2Vk\u0007\u001b[2J\u009b31m';
    fs.writeFileSync(esc, 'col\n' + evil + '\nplain\n');
    const piped = await tool([esc, '--no-copy', '--print']);
    ok('escape sequences in the data: a pipe gets the prompt as it is (the same as the page)', piped.out.includes(evil) && !/[\u001b\u0007]/.test(piped.err), JSON.stringify(piped.err.slice(0, 200)));
    const main = require(path.join(CLI, 'main.cjs'));
    const realm = require(path.join(CLI, 'realm.cjs')).create();
    const sink = () => ({ text: '', write(s) { this.text += s; } });
    const mk = (tty) => ({ fs, path, cwd: w, platform: 'linux', vars: {}, stdout: sink(), stderr: sink(), stdinIsTTY: tty, stdoutIsTTY: tty, spawnSync: () => ({ status: 0 }), now: () => new Date(), nowMs: () => 0, which: () => null, isWsl: () => false, waitEnter: async () => {}, createRealm: () => realm, version: 't' });
    const t = mk(true);
    await main.run([esc, '--no-copy', '--print'], t);
    ok('escape sequences in the data: on a terminal they are shown as \ufffd, and the user is told', !/[\u001b\u0007\u009b]/.test(t.stdout.text) && t.stdout.text.includes('v\ufffd]52;c;SGFja2Vk') && /control characters of the data were shown as/.test(t.stderr.text), JSON.stringify(t.stdout.text.slice(-200)));
    const e2 = mk(false);
    fs.writeFileSync(path.join(w, 'bad.json'), '{"a": \u001b[2J }');
    await main.run([path.join(w, 'bad.json'), '--no-copy', '--print'], e2);
    ok('an error message quoting the file (data shared): no control character on the terminal', /Unexpected token/.test(e2.stderr.text) && !/[\u001b]/.test(e2.stderr.text), JSON.stringify(e2.stderr.text));
  }

  /* ---------------------------------------------------------------- 4. special files ---------- */
  {
    const w = tmp();
    const cases = [['a folder', w]];
    if (!WIN) {
      cases.push(['/dev/zero (a device that never ends)', '/dev/zero']);
      const fifo = path.join(w, 'pipe.csv');
      if (cp.spawnSync('mkfifo', [fifo]).status === 0) cases.push(['a named pipe (FIFO)', fifo]);
      fs.symlinkSync('/dev/zero', path.join(w, 'link.csv'));
      cases.push(['a link to /dev/zero', path.join(w, 'link.csv')]);
    }
    for (const [name, p] of cases) {
      const t0 = Date.now();
      const r = await tool([p, '--no-copy', '--print']);
      ok('special file refused at once: ' + name, r.code === 1 && Date.now() - t0 < 20000 && /is a folder|not a regular file/.test(r.err), r.code + ' ' + r.err.slice(0, 200));
    }
    if (!WIN) {
      fs.writeFileSync(path.join(w, 'real.csv'), 'a\n1\n');
      fs.symlinkSync(path.join(w, 'real.csv'), path.join(w, 'tolink.csv'));
      const r = await tool([path.join(w, 'tolink.csv'), '--no-copy', '--print', '--quiet']);
      ok('a link to a regular file is read', r.code === 0 && r.out.length > 50);
    }
    // a file over 2 GB: the size is checked before anything is read (a stand-in file system says 3 GB)
    const main = require(path.join(CLI, 'main.cjs'));
    const realm = require(path.join(CLI, 'realm.cjs')).create();
    const sink = () => ({ text: '', write(s) { this.text += s; } });
    let read = false;
    const fakeFs = Object.assign({}, fs, { statSync: () => ({ isDirectory: () => false, isFile: () => true, size: 3 * 1024 ** 3 }), readFileSync: () => { read = true; return Buffer.alloc(0); } });
    const e = { fs: fakeFs, path, cwd: w, platform: 'linux', vars: {}, stdout: sink(), stderr: sink(), stdinIsTTY: false, stdoutIsTTY: false, spawnSync: () => ({ status: 0 }), now: () => new Date(), nowMs: () => 0, which: () => null, isWsl: () => false, waitEnter: async () => {}, createRealm: () => realm, version: 't' };
    const code = await main.run(['/x/huge.csv', '--print'], e);
    ok('a file over 2 GB: refused before it is read', code === 1 && !read && /too large for the command-line tool \(2 GB at most\)/.test(e.stderr.text), e.stderr.text);
  }

  /* ---------------------------------------------------------------- 5. the code: no shell ---------- */
  {
    const src = fs.readdirSync(CLI).filter((f) => /\.c?js$/.test(f)).map((f) => [f, fs.readFileSync(path.join(CLI, f), 'utf8')]);
    // (a regular expression's .exec( is not a program)
    const found = src.filter(([, s]) => /\bshell\s*:\s*true|(^|[^.\w])exec(Sync)?\s*\(|\.exec(Sync)?\s*\(\s*['"`]/m.test(s)).map(([f]) => f);
    ok('the code: no shell option, no exec / execSync in cli/ (programs get their arguments as a list)', found.length === 0, found.join(', '));
    // invisible characters that change the reading direction, written as they are in the code, make it read differently from
    // what it does ("Trojan source"): they must be written as \u escapes
    const BIDI = new RegExp('[' + String.fromCharCode(0x200e, 0x200f) + String.fromCharCode(0x202a) + '-' + String.fromCharCode(0x202e) + String.fromCharCode(0x2066) + '-' + String.fromCharCode(0x2069) + ']');
    const withBidi = src.concat([['src/core.js', fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8')]]).filter(([, s]) => BIDI.test(s)).map(([f]) => f);
    ok('the code: no invisible direction characters written as they are in cli/ and src/core.js (escapes only)', withBidi.length === 0, withBidi.join(', '));
    const spawns = src.flatMap(([f, s]) => (s.match(/spawnSync\s*\([^)]*\)/g) || []).map((m) => f + ': ' + m));
    ok('the code: every program is started with spawnSync (no other way)', src.every(([, s]) => !/\b(spawn|execFile|fork)\s*\(/.test(s.replace(/spawnSync\s*\(/g, ''))), spawns.join(' | '));
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
