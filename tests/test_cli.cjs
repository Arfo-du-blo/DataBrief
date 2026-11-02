#!/usr/bin/env node
/* Tests of the command-line tool (cli/*.cjs and the one-file build dist/databrief-cli.cjs) in Node, without a browser:
 *   node tests/test_cli.cjs
 * 1. The options: parsing, every wrong combination (exit code 2, nothing written).
 * 2. What happens with the prompt: clipboard, --print, --csv, --out, --no-share, --json, exit codes, the summary on standard
 *    error. The computer is replaced by stand-ins (clipboard tools, editors, clock, terminal); files are real, in a temp folder.
 * 3. The clipboard on Windows, macOS, Linux (X11, Wayland) and WSL: the command and the bytes it gets.
 * 4. --review: the editor chain (named, vim, nano, $VISUAL, $EDITOR, the system's), initial_prompt.md and prompt.md, the edited
 *    prompt on the clipboard, editors that return at once, errors, no terminal.
 * 5. Names: folders and data files, hostile names.
 * 6. Real processes (the source tree and the built file) on the committed test files: the same prompt as the reading core, the
 *    bundle equals the source tree, the build is reproducible, output on a pipe is complete, error exit codes.
 * DATABRIEF_CLI: another copy of cli/main.cjs's folder (to check that these tests catch a change). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CLI = process.env.DATABRIEF_CLI || path.join(ROOT, 'cli');
const { parse } = require(path.join(CLI, 'args.cjs'));
const main = require(path.join(CLI, 'main.cjs'));
const clipboard = require(path.join(CLI, 'clipboard.cjs'));
const outfiles = require(path.join(CLI, 'outfiles.cjs'));
const editor = require(path.join(CLI, 'editor.cjs'));
const realmLib = require(path.join(CLI, 'realm.cjs'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-cli-'));
let tmpN = 0;
const tmp = () => { const d = path.join(tmpRoot, 'w' + ++tmpN); fs.mkdirSync(d); return d; };
const CANARY = 'CANARY_RECORD_7731';
const csvText = 'name,amount,city\n' + CANARY + ',12.5,Paris\nBob,8,Lyon\nCleo,3,Nice\n';

const realm = realmLib.create();
const sink = () => ({ text: '', write(s) { this.text += s; } });

/* An environment with stand-ins; `over` replaces parts of it */
function mkEnv(over) {
  const cwd = tmp();
  const calls = [];
  const state = { enters: 0, ms: 0, clip: [] };
  const env = {
    fs, path, cwd, platform: 'linux', vars: { PATH: '/bin' }, stdout: sink(), stderr: sink(), stdinIsTTY: false, stdoutIsTTY: false,
    spawnSync: (exe, args, opt) => { calls.push({ exe, args, opt }); return { status: 0 }; },
    now: () => new Date(2026, 10, 2, 14, 35, 7), nowMs: () => (state.ms += 5),
    which: (n) => (n === 'xclip' ? '/usr/bin/xclip' : null), isWsl: () => false,
    waitEnter: async () => { state.enters++; }, say: (s) => env.stderr.write(s + '\n'),
    createRealm: () => realm, version: '9.9.9',
  };
  Object.assign(env, over || {});
  env.calls = calls; env.state = state;
  env.file = (name, content) => { const f = path.join(cwd, name); fs.writeFileSync(f, content); return f; };
  return env;
}
const clipText = (env) => env.calls.filter((c) => /xclip|pbcopy|wl-copy|xsel|powershell|clip/.test(path.basename(c.exe))).map((c) => c.opt.input && c.opt.input.toString('utf8'));
const tree = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(path.join(d, e.name)).map((x) => e.name + '/' + x) : [e.name])).sort() : []);
async function go(args, over, content) {
  const env = mkEnv(over);
  const file = env.file('people.csv', content == null ? csvText : content);
  const code = await main.run(args.map((a) => (a === 'FILE' ? file : a)), env);
  return { code, env, out: env.stdout.text, err: env.stderr.text, file };
}

(async () => {
  /* ---------------------------------------------------------------- 1. options ---------- */
  {
    const p = (...a) => parse(a);
    ok('parse: a file and flags', JSON.stringify(p('f.csv', '--print', '--csv').opts) === '{"file":"f.csv","print":true,"csv":true}');
    ok('parse: values with a space or with =', p('f', '--out', 'x').opts.out === 'x' && p('f', '--out=x').opts.out === 'x' && p('--lang=fr', 'f').opts.lang === 'fr');
    ok('parse: --review and --no-share take a value only after =', p('--review', 'f.csv').opts.review === true && p('--review', 'f.csv').opts.file === 'f.csv' && p('--review=vim', 'f').opts.review === 'vim' &&
      p('--no-share=2', 'f').opts.noShare === '2' && p('--no-share', 'f').opts.file === 'f');
    ok('parse: --review vim f.csv is a mistake that says how to name an editor', p('--review', 'vim', 'f.csv').errors.some((e) => /--review=EDITOR/.test(e)));
    ok('parse: the aliases', p('f', '--no_clip').opts.noCopy === true && p('f', '-q').opts.quiet === true && p('-h').opts.help === true && p('-v').opts.version === true);
    ok('parse: -- ends the options, a file may start with a dash', p('--', '-odd.csv').opts.file === '-odd.csv');
    ok('parse: errors', p('f', '--nope').errors.length === 1 && p('f', '--out').errors[0] === '--out needs a value' && p('f', '--print=1').errors.length === 1 && p('a', 'b').errors.length === 1 && p('f', '--csv', '--csv').errors.length === 1);
  }
  const wrong = [
    [['FILE', '--bogus'], /Unknown option/], [['FILE', '--no-share=4'], /LEVEL is 1, 2 or 3/], [['FILE', '--allow=text'], /only goes with --no-share/],
    [['FILE', '--no-share', '--allow=nope'], /"nope" is not one of/], [['FILE', '--no-share', '--allow=text', '--hide=text'], /both --allow and --hide/],
    [['FILE', '--no-copy'], /leaves nothing to do/], [['FILE', '--print', '--json'], /--print and --json/], [['FILE', '--limit', 'x'], /whole number/],
    [['FILE', '--limit', '0'], /whole number/], [['FILE', '--lang', 'xx'], /not a prompt language/], [['FILE', '--mode', 'x'], /inline or files/],
    [['FILE', '--layout', 'x'], /auto, table or csv/], [['FILE', '--profile', '--no-profile'], /together/], [['FILE', '--copy', '--no-copy', '--print'], /together/],
    [['FILE', '--review'], /interactive terminal/], [['FILE', '--out', '/no/such/folder/at/all'], /does not exist/], [['FILE', '--csv', '--out', '../escape'], /not allowed/],
    [['FILE', '--out='], /needs a folder/], [[], /Usage/],
  ];
  for (const [args, re] of wrong) {
    const r = await go(args);
    ok('options: ' + (args.join(' ').replace(/\S*people\.csv/, 'FILE') || '(nothing)') + ' -> exit 2 and says why', r.code === 2 && re.test(r.err) && r.out === '' && r.env.calls.length === 0 && tree(r.env.cwd).join() === 'people.csv', r.code + ' ' + r.err);
  }
  {
    const r = await go(['--help']);
    ok('--help and --version go to standard output, exit 0', r.code === 0 && /Usage:  databrief FILE/.test(r.out) && r.err === '' && (await go(['--version'])).out === 'databrief 9.9.9\n');
    const h = require(path.join(CLI, 'args.cjs')).HELP;
    ok('--help names every option', ['--print', '--no-copy', '--no_clip', '--csv', '--out', '--review', '--json', '--quiet', '--no-share', '--allow', '--hide', '--lang', '--mode', '--limit', '--layout', '--no-profile', '--help', '--version'].every((o) => h.includes(o)));
  }

  /* ---------------------------------------------------------------- 2. what happens with the prompt ---------- */
  {
    const r = await go(['FILE']);
    const prompt = (await realm.prepare(Buffer.from(csvText), 'people.csv', {})).md;
    ok('default: the prompt is copied to the clipboard, nothing is printed, no file is written', r.code === 0 && r.out === '' && clipText(r.env)[0] === prompt && tree(r.env.cwd).join() === 'people.csv', r.err);
    ok('default: the summary on standard error', /Read people\.csv \(CSV\)\. The prompt is about [\d,]+ tokens\./.test(r.err) && /holds the data of the file/.test(r.err) && /Copied to the clipboard \(xclip\)\./.test(r.err), r.err);
    ok('default: xclip gets the right arguments', r.env.calls[0].exe === '/usr/bin/xclip' && r.env.calls[0].args.join(' ') === '-selection clipboard -in');
    const q = await go(['FILE', '--quiet']);
    ok('--quiet: no summary', q.code === 0 && q.err === '' && clipText(q.env).length === 1);
    const nc = await go(['FILE', '--no-copy', '--print']);
    ok('--no-copy --print: the prompt on standard output only, the clipboard untouched', nc.code === 0 && nc.out === prompt && nc.env.calls.length === 0 && /Not copied to the clipboard \(--no-copy\)\./.test(nc.err) && /Printed on standard output/.test(nc.err));
    const both = await go(['FILE', '--print']);
    ok('--print also copies', both.out === prompt && clipText(both.env)[0] === prompt);
    const alias = await go(['FILE', '--no_clip', '--print']);
    ok('--no_clip is --no-copy', alias.env.calls.length === 0 && alias.out === prompt);
  }
  {
    const r = await go(['FILE', '--no-copy', '--csv']);
    const dir = path.join(r.env.cwd, 'databrief', 'people_2026-11-02_14-35-07');
    ok('--csv: ./databrief/FILE_DATE_TIME/ holds prompt.md and the CSV files', r.code === 0 && tree(path.join(r.env.cwd, 'databrief')).join() === 'people_2026-11-02_14-35-07/people.csv,people_2026-11-02_14-35-07/prompt.md', tree(r.env.cwd).join());
    ok('--csv: the CSV holds all the rows, prompt.md is the prompt', fs.readFileSync(path.join(dir, 'people.csv'), 'utf8').includes(CANARY + ',12.5,Paris') &&
      fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8') === (await realm.prepare(Buffer.from(csvText), 'people.csv', {})).md);
    ok('--csv: the summary names the folder and the files', r.err.includes('Wrote 2 files in ' + dir + ': prompt.md, people.csv'), r.err);
    const env = mkEnv();
    const f = env.file('people.csv', csvText);
    await main.run([f, '--no-copy', '--csv', '--quiet'], env);
    await main.run([f, '--no-copy', '--csv', '--quiet'], env);
    ok('--csv twice in the same second: a second folder, nothing overwritten', tree(path.join(env.cwd, 'databrief')).filter((x) => /prompt\.md$/.test(x)).join() === 'people_2026-11-02_14-35-07-2/prompt.md,people_2026-11-02_14-35-07/prompt.md');
    const clip = await go(['FILE', '--csv']);
    ok('--csv still copies the prompt (copy is the default)', clipText(clip.env).length === 1 && /Copied to the clipboard/.test(clip.err));
  }
  {
    const base = tmp();
    const r = await go(['FILE', '--no-copy', '--out', base]);
    ok('--out ABSOLUTE: a dated folder in it, prompt.md only (no --csv)', r.code === 0 && tree(base).join() === 'people_2026-11-02_14-35-07/prompt.md' && tree(path.join(r.env.cwd, 'databrief')).length === 0 && !/was placed under/.test(r.err), tree(base).join());
    const rel = await go(['FILE', '--no-copy', '--out', 'week1/mine']);
    ok('--out RELATIVE: placed under ./databrief, and the user is told', rel.code === 0 && fs.existsSync(path.join(rel.env.cwd, 'databrief', 'week1', 'mine', 'people_2026-11-02_14-35-07', 'prompt.md')) && /The relative --out week1\/mine was placed under \.\/databrief/.test(rel.err), rel.err + tree(rel.env.cwd).join());
    const both = await go(['FILE', '--no-copy', '--csv', '--out', base]);
    ok('--out with --csv: the CSV files go there too', both.code === 0 && tree(base).filter((x) => /people\.csv$/.test(x)).length === 1);
    const notDir = await go(['FILE', '--no-copy', '--out', path.join(base, 'people_2026-11-02_14-35-07', 'prompt.md')]);
    ok('--out a file: refused', notDir.code === 2 && /not a folder/.test(notDir.err));
  }
  {
    const r = await go(['FILE', '--no-share', '--csv', '--no-copy', '--print']);
    const dir = path.join(r.env.cwd, 'databrief', 'people_2026-11-02_14-35-07');
    ok('--no-share --csv: the prompt holds no record, the CSV file holds them, and both are said', r.code === 0 && !r.out.includes(CANARY) && !fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8').includes(CANARY) &&
      fs.readFileSync(path.join(dir, 'people.csv'), 'utf8').includes(CANARY) && /holds NO data \(Do not share data, level 1\)/.test(r.err) && /Note: --csv writes the data of the file on this computer: the prompt holds no data, the CSV files do\./.test(r.err), r.err);
    for (const lvl of [1, 2, 3]) {
      const x = await go(['FILE', '--no-copy', '--print', '--no-share=' + lvl]);
      ok('--no-share=' + lvl + ': no record and the level is said', !x.out.includes(CANARY) && !x.out.includes('Lyon') && x.err.includes('level ' + lvl));
    }
    const hide = await go(['FILE', '--no-copy', '--print', '--no-share', '--hide=names']);
    const allow = await go(['FILE', '--no-copy', '--print', '--no-share', '--allow=text,sql']);
    ok('--hide / --allow change the no-share prompt like the page\'s switches', !hide.out.includes('`amount`') && (await go(['FILE', '--no-copy', '--print', '--no-share'])).out.includes('`amount`') && allow.code === 0);
  }
  {
    const fr = await go(['FILE', '--no-copy', '--print', '--lang', 'fr']);
    ok('--lang fr: the prompt in French', /Fichier/.test(fr.out));
    const np = await go(['FILE', '--no-copy', '--print', '--no-profile']);
    ok('--no-profile', !/## Data profile/.test(np.out) && /## Data profile/.test((await go(['FILE', '--no-copy', '--print'])).out));
    const lim = await go(['FILE', '--no-copy', '--print', '--limit', '2']);
    ok('--limit 2', lim.out.includes('Bob') && !lim.out.includes('Cleo'));
    const lf = await go(['FILE', '--no-copy', '--print', '--mode', 'files', '--limit', '2']);
    ok('--limit in files mode is ignored, and said', /Note: --limit is ignored in files mode/.test(lf.err));
    const lns = await go(['FILE', '--no-copy', '--print', '--no-share', '--limit', '2']);
    ok('--limit with --no-share is ignored, and said', /Note: --limit is ignored with --no-share/.test(lns.err));
    let big = 'id,text,value\n';
    for (let i = 0; i < 30000; i++) big += i + ',some words for row number ' + i + ',' + (i * 1.5) + '\n';
    const w = await go(['FILE', '--no-copy', '--print'], null, big);
    ok('a large file: the warning with the way out', /Warning: The prompt is about [\d,]+ tokens, over the 150,000 most AI tools take\. Use --limit auto/.test(w.err), w.err);
    const a = await go(['FILE', '--no-copy', '--print', '--limit', 'auto'], null, big);
    ok('--limit auto: under the size, no warning', a.out.length < w.out.length && !/Warning/.test(a.err));
  }
  {
    const r = await go(['FILE', '--json', '--no-copy']);
    const j = JSON.parse(r.out);
    ok('--json: one object, the prompt in it, nothing else on standard output', r.code === 0 && j.ok === true && j.version === '9.9.9' && j.file === 'people.csv' && j.format === 'CSV' && j.shared === true && j.copied === false &&
      j.folder === null && j.files.length === 0 && j.prompt.includes(CANARY) && typeof j.tokens === 'number' && j.large === null && Array.isArray(j.notes) && Array.isArray(j.warnings), r.out.slice(0, 300));
    const n = JSON.parse((await go(['FILE', '--json', '--no-copy', '--no-share=2'])).out);
    ok('--json with --no-share: shared false, the level, no record', n.shared === false && n.level === 2 && !n.prompt.includes(CANARY));
    const c = JSON.parse((await go(['FILE', '--json', '--no-copy', '--csv'])).out);
    ok('--json with --csv: the folder and the file paths', c.folder && c.files.length === 1 && fs.existsSync(c.files[0]) && path.dirname(c.files[0]) === c.folder);
    const e = await go(['FILE', '--json', '--no-copy'], null, '');
    ok('--json on an error: {"ok":false,"error":...}, exit 1', e.code === 1 && JSON.parse(e.out).ok === false && JSON.parse(e.out).error.key.startsWith('err'), e.out);
  }
  {
    const env = mkEnv();
    const code = await main.run([path.join(env.cwd, 'missing.csv'), '--print'], env);
    ok('a missing file: exit 1 and "File not found"', code === 1 && /File not found: /.test(env.stderr.text) && env.stdout.text === '');
    const dirCode = await main.run([env.cwd, '--print'], mkEnv({ cwd: env.cwd }));
    ok('a folder instead of a file: exit 1', dirCode === 1);
    const x = mkEnv();
    const code2 = await main.run([x.file('data.xyz', 'abc'), '--print'], x);
    ok('an unsupported type: the page\'s message, exit 1', code2 === 1 && /This file type is not supported: \.xyz/.test(x.stderr.text));
    const broken = mkEnv();
    const code3 = await main.run([broken.file('broken.json', '{"a": ' + CANARY + ' }'), '--print', '--no-share'], broken);
    ok('an error in "Do not share data": no technical detail (it can quote the file)', code3 === 1 && !broken.stderr.text.includes('CANARY') && /damaged/.test(broken.stderr.text), broken.stderr.text);
    const shared = mkEnv();
    await main.run([shared.file('broken.json', '{"a": ' + CANARY + ' }'), '--print'], shared);
    ok('the same error with the data shared: the detail is given', /Unexpected token/.test(shared.stderr.text));
  }
  {
    // the clipboard cannot be used
    const none = await go(['FILE'], { which: () => null });
    ok('no clipboard tool and nothing else asked: exit 3 and what to do', none.code === 3 && /NOT copied to the clipboard: none of wl-copy, xclip or xsel was found/.test(none.err) && /nothing was delivered/.test(none.err), none.err);
    const withPrint = await go(['FILE', '--print'], { which: () => null });
    ok('no clipboard tool but --print: delivered, exit 0, the failure said', withPrint.code === 0 && withPrint.out.length > 100 && /NOT copied/.test(withPrint.err));
    const withCsv = await go(['FILE', '--csv'], { which: () => null });
    ok('no clipboard tool but files written: exit 0', withCsv.code === 0);
    const failing = await go(['FILE'], { spawnSync: () => ({ status: 1, stderr: Buffer.from('boom') }) });
    ok('a clipboard tool that fails: exit 3, its error said', failing.code === 3 && /clipboard tool failed \(xclip: boom\)/.test(failing.err), failing.err);
    const quiet = await go(['FILE', '--quiet'], { which: () => null });
    ok('--quiet still reports a failed copy', quiet.code === 3 && /NOT copied/.test(quiet.err));
  }

  /* ---------------------------------------------------------------- 3. the clipboard ---------- */
  {
    const run = (platform, vars, whichMap, wsl) => {
      const calls = [];
      const r = clipboard.copy('héllo ✓ 日本\nline2', { platform, vars, which: (n) => whichMap[n] || null, isWsl: () => !!wsl, spawnSync: (e, a, o) => { calls.push({ e, a, o }); return { status: 0 }; } });
      return { r, calls };
    };
    const w = run('win32', {}, { 'powershell.exe': 'C:\\ps.exe' });
    ok('clipboard, Windows: PowerShell Set-Clipboard, the text as UTF-8 on standard input', w.r.ok && w.calls[0].e === 'C:\\ps.exe' && w.calls[0].a.includes('-NoProfile') && /Set-Clipboard/.test(w.calls[0].a.join(' ')) && /InputEncoding.*UTF8/.test(w.calls[0].a.join(' ')) &&
      w.calls[0].o.input.toString('utf8') === 'héllo ✓ 日本\nline2' && w.calls[0].o.windowsHide === true);
    const c = run('win32', {}, { 'clip.exe': 'C:\\clip.exe' });
    ok('clipboard, Windows without PowerShell: clip.exe with UTF-16 and its byte order mark', c.r.ok && c.calls[0].o.input[0] === 0xff && c.calls[0].o.input[1] === 0xfe && c.calls[0].o.input.slice(2).toString('utf16le') === 'héllo ✓ 日本\nline2');
    const m = run('darwin', {}, { pbcopy: '/usr/bin/pbcopy' });
    ok('clipboard, macOS: pbcopy with a UTF-8 locale', m.r.ok && m.calls[0].e === '/usr/bin/pbcopy' && m.calls[0].o.env.LC_CTYPE === 'UTF-8' && m.calls[0].o.input.toString() === 'héllo ✓ 日本\nline2');
    const wl = run('linux', { WAYLAND_DISPLAY: 'wayland-0' }, { 'wl-copy': '/usr/bin/wl-copy', xclip: '/usr/bin/xclip' });
    ok('clipboard, Wayland: wl-copy first', wl.calls[0].e === '/usr/bin/wl-copy');
    const x = run('linux', {}, { xclip: '/usr/bin/xclip', 'wl-copy': '/usr/bin/wl-copy' });
    ok('clipboard, X11: xclip first, the background tool is not waited for through its pipes', x.calls[0].e === '/usr/bin/xclip' && x.calls[0].o.stdio[2] === 'ignore');
    const xs = run('linux', {}, { xsel: '/usr/bin/xsel' });
    ok('clipboard: xsel', xs.calls[0].e === '/usr/bin/xsel' && xs.calls[0].a.join(' ') === '--clipboard --input');
    const ws = run('linux', {}, { 'powershell.exe': '/mnt/c/ps.exe', xclip: '/usr/bin/xclip' }, true);
    ok('clipboard, WSL: the Windows clipboard through powershell.exe', ws.calls[0].e === '/mnt/c/ps.exe');
    const fb = clipboard.copy('x', { platform: 'win32', vars: {}, which: (n) => ({ 'powershell.exe': 'a', 'clip.exe': 'b' }[n] || null), isWsl: () => false, spawnSync: (e) => (e === 'a' ? { status: 1 } : { status: 0 }) });
    ok('clipboard: a tool that fails, the next one is tried', fb.ok && fb.tool === 'clip.exe');
    ok('clipboard: no tool', !run('linux', {}, {}).r.ok && !run('darwin', {}, {}).r.ok && !run('win32', {}, {}).r.ok);
  }

  /* ---------------------------------------------------------------- 4. --review ---------- */
  {
    const tty = { stdinIsTTY: true, stdoutIsTTY: true };
    const mk = (whichMap, over) => Object.assign({}, tty, { vars: { PATH: '/bin' }, which: (n) => whichMap[n] || (n === 'xclip' ? '/usr/bin/xclip' : null) }, over || {});

    let env = mkEnv(mk({ vim: '/usr/bin/vim', nano: '/usr/bin/nano' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); if (/vim$/.test(exe)) fs.appendFileSync(args[args.length - 1], '\nEDITED BY THE USER\n'); return { status: 0 }; };
    let file = env.file('people.csv', csvText);
    let code = await main.run([file, '--review'], env);
    const dir = path.join(env.cwd, 'databrief', 'people_2026-11-02_14-35-07');
    const initial = (await realm.prepare(Buffer.from(csvText), 'people.csv', {})).md;
    ok('--review: initial_prompt.md is the original, prompt.md is the edited copy', code === 0 && fs.readFileSync(path.join(dir, 'initial_prompt.md'), 'utf8') === initial && fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8') === initial + '\nEDITED BY THE USER\n');
    ok('--review: vim is tried first, on prompt.md, with the terminal', env.calls[0].exe === '/usr/bin/vim' && env.calls[0].args.join() === path.join(dir, 'prompt.md') && env.calls[0].opt.stdio === 'inherit');
    ok('--review: the clipboard gets the EDITED prompt', clipText(env)[0] === initial + '\nEDITED BY THE USER\n' && /Reviewed in vim: your edits are used\./.test(env.stderr.text) && /Wrote 2 files/.test(env.stderr.text), env.stderr.text);
    ok('--review: nothing is printed, the tool does not wait for Enter after an editor that waits', env.stdout.text === '' && env.state.enters === 0);

    env = mkEnv(mk({ nano: '/usr/bin/nano' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); if (/nano$/.test(exe)) fs.appendFileSync(args[args.length - 1], 'N'); return { status: 0 }; };
    code = await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: vim missing, nano used, and said', code === 0 && env.calls[0].exe === '/usr/bin/nano' && /vim is not available, used nano/.test(env.stderr.text), env.stderr.text);

    env = mkEnv(mk({ nano: '/usr/bin/nano', vim: '/usr/bin/vim' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { status: 0 }; };
    code = await main.run([env.file('people.csv', csvText), '--review=nano'], env);
    ok('--review=nano: the named editor first, even though vim exists', env.calls[0].exe === '/usr/bin/nano' && /Reviewed in nano: unchanged\./.test(env.stderr.text));

    env = mkEnv(mk({ nano: '/usr/bin/nano' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { status: 0 }; };
    code = await main.run([env.file('people.csv', csvText), '--review=emacs'], env);
    ok('--review=emacs, not installed: falls back (vim, then nano) and says so, no error', code === 0 && env.calls[0].exe === '/usr/bin/nano' && /emacs, vim are not available, used nano/.test(env.stderr.text), env.stderr.text);

    env = mkEnv(mk({ myed: '/opt/myed' }, { vars: { PATH: '/bin', EDITOR: 'myed --fast' } }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { status: 0 }; };
    code = await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: $EDITOR with its own arguments', env.calls[0].exe === '/opt/myed' && env.calls[0].args[0] === '--fast' && env.calls[0].args.length === 2 && code === 0);

    env = mkEnv(mk({ myvis: '/opt/myvis' }, { vars: { PATH: '/bin', VISUAL: 'myvis', EDITOR: 'myed' } }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { status: 0 }; };
    await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: $VISUAL before $EDITOR', env.calls[0].exe === '/opt/myvis');

    env = mkEnv(mk({}));
    code = await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: no editor at all: exit 2, the files are kept and said', code === 2 && /No text editor was found/.test(env.stderr.text) && /prompt\.md and initial_prompt\.md are in /.test(env.stderr.text) && env.calls.length === 0);

    env = mkEnv(mk({ code: '/usr/bin/code' }, { vars: { PATH: '/bin', EDITOR: 'code' } }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { status: 0 }; };
    await main.run([env.file('people.csv', csvText), '--review=code'], env);
    ok('--review=code: --wait is added; no wait for Enter', env.calls[0].args[0] === '--wait' && env.state.enters === 0);

    env = mkEnv(mk({ gui: '/usr/bin/gui' }, { vars: { PATH: '/bin', EDITOR: 'gui' } }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); if (exe === '/usr/bin/gui') fs.appendFileSync(args[args.length - 1], 'saved\n'); return { status: 0 }; };   // only the editor edits (the clipboard tool is called too)
    code = await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: an editor that returns at once: the tool waits for Enter, then reads the file', env.state.enters === 1 && /Press Enter here when you have saved and closed the file in \$EDITOR \(gui\)/.test(env.stderr.text) && clipText(env)[0].endsWith('saved\n'), env.stderr.text);

    env = mkEnv(mk({ vim: '/usr/bin/vim' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { status: 1 }; };
    code = await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: an editor that ends with an error: the file is used as it is, and said', code === 0 && /vim ended with code 1: the file is used as it is/.test(env.stderr.text));

    env = mkEnv(mk({ vim: '/usr/bin/vim' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { error: new Error('spawn EACCES') }; };
    code = await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: an editor that cannot start: exit 2', code === 2 && /Could not start vim: spawn EACCES/.test(env.stderr.text));

    env = mkEnv(mk({ vim: '/usr/bin/vim' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); fs.writeFileSync(args[args.length - 1], '  \n'); return { status: 0 }; };
    code = await main.run([env.file('people.csv', csvText), '--review'], env);
    ok('--review: the user emptied the prompt: nothing is copied, exit 3, the original is kept', code === 3 && /The edited prompt is empty/.test(env.stderr.text) && clipText(env).length === 0);

    env = mkEnv(mk({ vim: '/usr/bin/vim' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); if (/vim$/.test(exe)) fs.appendFileSync(args[args.length - 1], 'x'); return { status: 0 }; };
    code = await main.run([env.file('people.csv', csvText), '--review', '--no-copy', '--print'], env);
    ok('--review --no-copy --print: the edited prompt is printed, not copied', code === 0 && env.stdout.text.endsWith('x') && clipText(env).length === 0);

    env = mkEnv(mk({ vim: '/usr/bin/vim' }));
    env.spawnSync = (exe, args, opt) => { env.calls.push({ exe, args, opt }); return { status: 0 }; };
    code = await main.run([env.file('people.csv', csvText), '--review', '--csv', '--no-share'], env);
    ok('--review --csv --no-share: the folder holds initial_prompt.md, prompt.md and the CSV; the prompt has no record', code === 0 && tree(path.join(env.cwd, 'databrief')).join() === 'people_2026-11-02_14-35-07/initial_prompt.md,people_2026-11-02_14-35-07/people.csv,people_2026-11-02_14-35-07/prompt.md');

    // no terminal: an AI agent's shell, a pipe
    for (const [name, over] of [['no terminal', { stdinIsTTY: false, stdoutIsTTY: false }], ['output piped', { stdinIsTTY: true, stdoutIsTTY: false }], ['input piped', { stdinIsTTY: false, stdoutIsTTY: true }]]) {
      const e2 = mkEnv(mk({ vim: '/usr/bin/vim' }, over));
      const c2 = await main.run([e2.file('people.csv', csvText), '--review'], e2);
      ok('--review: ' + name + ': a clear error, exit 2, nothing done (no folder, no editor, no clipboard)', c2 === 2 && /needs an interactive terminal/.test(e2.stderr.text) && /AI agent/.test(e2.stderr.text) && e2.calls.length === 0 && tree(e2.cwd).join() === 'people.csv', e2.stderr.text);
    }
    const j = mkEnv(mk({ vim: '/usr/bin/vim' }));
    ok('--review --json: refused', (await main.run([j.file('people.csv', csvText), '--review', '--json'], j)) === 2 && /--review and --json/.test(j.stderr.text));

    // the editor chain on its own: Windows, macOS, the system's
    const names = (platform, vars, whichMap) => editor.candidateList(null, { platform, vars }).map((c) => c.cmd).join(' ');
    ok('editor chain: Windows ends with notepad, macOS with TextEdit (open -e -W -n), Linux with the usual editors', /^vim nano notepad$/.test(names('win32', {})) && /^vim nano open$/.test(names('darwin', {})) && /^vim nano editor vi nvim micro hx emacs code gedit kate$/.test(names('linux', {})));
    ok('editor chain: macOS TextEdit waits (open -W) and opens a new instance (-n)', editor.choose(null, { platform: 'darwin', vars: {}, which: (n) => (n === 'open' ? '/usr/bin/open' : null) }).chosen.waits === true);
    ok('editor: splitCommand keeps quotes and Windows paths', JSON.stringify(editor.splitCommand('"C:\\Program Files\\Ed\\ed.exe" --wait \'a b\'')) === '["C:\\\\Program Files\\\\Ed\\\\ed.exe","--wait","a b"]');
    // Windows launchers (.cmd): through cmd.exe, only for a path it reads harmlessly
    const winEnv = (file) => { const calls = []; return { calls, env: { platform: 'win32', vars: { ComSpec: 'C:\\Windows\\System32\\cmd.exe', EDITOR: 'code' }, which: (n) => (n === 'code' ? 'C:\\vs\\bin\\code.cmd' : null), spawnSync: (e, a, o) => { calls.push({ e, a, o }); return { status: 0 }; }, nowMs: () => 0, say() {}, waitEnter: async () => {} } }; };
    let we = winEnv();
    let wr = await editor.edit('C:\\work\\prompt.md', null, we.env);
    ok('editor, Windows .cmd: run by cmd.exe with the path quoted, --wait added', wr.ok && we.calls[0].e === 'C:\\Windows\\System32\\cmd.exe' && we.calls[0].a.join(' ') === '/d /s /c ""C:\\vs\\bin\\code.cmd" "--wait" "C:\\work\\prompt.md""' && we.calls[0].o.windowsVerbatimArguments === true, JSON.stringify(we.calls[0]));
    we = winEnv();
    wr = await editor.edit('C:\\work\\100%\\prompt.md', null, we.env);
    ok('editor, Windows .cmd: a path with a character cmd.exe reads even inside quotes (%) is refused, nothing is run', !wr.ok && /cmd\.exe would read/.test(wr.error) && we.calls.length === 0);
    we = winEnv();
    wr = await editor.edit('C:\\Program Files (x86)\\a&b\\prompt.md', null, we.env);
    ok('editor, Windows .cmd: spaces, parentheses and & are safe inside the quotes', wr.ok && we.calls.length === 1);
  }

  /* ---------------------------------------------------------------- 5. names, search path ---------- */
  {
    const c = outfiles.cleanName;
    ok('names: separators, controls and Windows-forbidden characters', c('a/b\\c:d*e?f"g<h>i|j') === 'a_b_c_d_e_f_g_h_i_j' && c('x\u0000y\nz') === 'x_y_z');
    ok('names: leading dots, trailing dots and spaces, empty', c('..hidden') === 'hidden' && c('name. . ') === 'name' && c('') === 'data' && c('...') === 'data' && c(null) === 'data');
    ok('names: Windows device names', c('CON') === '_CON' && c('nul.txt') === '_nul.txt' && c('COM1') === '_COM1' && c('console') === 'console');
    ok('names: long names are cut, the extension kept', c('x'.repeat(300) + '.csv', 50) === 'x'.repeat(46) + '.csv' && c('é'.repeat(70), 60).length === 60);
    ok('names: ../ cannot get out', c('../../etc/passwd') === '_.._etc_passwd', c('../../etc/passwd'));
    const d = outfiles.dataNames([{ name: 'a.csv' }, { name: 'A.csv' }, { name: 'a.csv' }, { name: 'prompt.md' }, { name: 'initial_prompt.md.csv' }, { name: '../x' }, { name: 'CON.csv' }]);
    ok('data file names: unique even on case-insensitive disks, never the tool\'s own files, always .csv', d.join() === 'a.csv,A-2.csv,a-3.csv,prompt.md.csv,initial_prompt.md.csv,_x.csv,_CON.csv', d.join());
    ok('folder stamp: local time, zero padded', outfiles.stamp(new Date(2026, 0, 5, 3, 4, 9)) === '2026-01-05_03-04-09');
    const w = tmp(), bin = path.join(w, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'myed'), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, 'myed'), 0o755);
    fs.writeFileSync(path.join(bin, 'plain'), 'x'); fs.chmodSync(path.join(bin, 'plain'), 0o644);
    const win = process.platform === 'win32';
    ok('which: finds an executable in PATH, and by path', main.which('myed', { PATH: '/nope' + path.delimiter + bin }, win ? 'linux' : process.platform, fs, path) === path.join(bin, 'myed') && main.which(path.join(bin, 'myed'), {}, process.platform, fs, path) !== null);
    ok('which: not a file that is not executable, not a missing one', win || (main.which('plain', { PATH: bin }, process.platform, fs, path) === null && main.which('nothere', { PATH: bin }, process.platform, fs, path) === null));
    fs.writeFileSync(path.join(bin, 'tool.CMD'), '');
    ok('which, Windows: PATHEXT is tried', main.which('tool', { PATH: bin, PATHEXT: '.COM;.EXE;.CMD' }, 'win32', fs, path) === path.join(bin, 'tool.CMD'));
  }

  /* ---------------------------------------------------------------- 6. real processes ---------- */
  {
    const build = path.join(tmpRoot, 'built');
    fs.mkdirSync(build);
    const b1 = path.join(build, 'one.cjs'), b2 = path.join(build, 'two.cjs');
    const cleanEnv = Object.assign({}, process.env);
    delete cleanEnv.DATABRIEF_ROOT;
    const run = (file, args, opt) => cp.spawnSync(process.execPath, [file].concat(args), Object.assign({ encoding: 'utf8', maxBuffer: 1 << 28, env: cleanEnv }, opt || {}));
    const bb = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-cli.cjs'), b1], { encoding: 'utf8' });
    const bc = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-cli.cjs'), b2], { encoding: 'utf8' });
    ok('build: the one-file tool is built (' + (bb.stdout || bb.stderr).trim().slice(-90) + ')', bb.status === 0 && fs.statSync(b1).size > 3e6, bb.stderr);
    ok('build: reproducible (two builds, the same bytes)', bc.status === 0 && fs.readFileSync(b1).equals(fs.readFileSync(b2)));
    {
      // the same bytes from a checkout with Windows line endings (git on Windows turns LF into CRLF in text files)
      const copy = path.join(tmpRoot, 'crlf');
      const conv = (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        for (const e of fs.readdirSync(from, { withFileTypes: true })) {
          const f = path.join(from, e.name), t = path.join(to, e.name);
          if (e.isDirectory()) { if (!['node_modules', '.git', 'dist'].includes(e.name)) conv(f, t); }
          else if (/\.(js|cjs|html|json|css)$/.test(e.name)) fs.writeFileSync(t, fs.readFileSync(f, 'utf8').replace(/\r?\n/g, '\r\n'));
          else fs.copyFileSync(f, t);
        }
      };
      for (const d of ['cli', 'src', 'vendor', 'tools']) conv(path.join(ROOT, d), path.join(copy, d));
      fs.writeFileSync(path.join(copy, 'package.json'), fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/\r?\n/g, '\r\n'));
      const b3 = path.join(build, 'crlf.cjs');
      const bd = cp.spawnSync(process.execPath, [path.join(copy, 'tools', 'build-cli.cjs'), b3], { encoding: 'utf8' });
      ok('build: the same bytes from sources with Windows line endings (CRLF)', bd.status === 0 && fs.readFileSync(b1).equals(fs.readFileSync(b3)), bd.stderr || (fs.statSync(b1).size + ' / ' + fs.statSync(b3).size));
    }
    const built = fs.readFileSync(b1, 'utf8');
    ok('build: shebang, header, no path of this machine', built.startsWith('#!/usr/bin/env node\n/* DataBrief ') && !built.includes(ROOT) && !built.includes(ROOT.replace(/\\/g, '\\\\')) && !built.includes(tmpRoot), built.slice(0, 100));
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    for (const [label, file] of [['source tree', path.join(CLI, 'databrief.cjs')], ['built file', b1]]) {
      const r = run(file, ['--version']);
      ok(label + ': --version', r.status === 0 && r.stdout === 'databrief ' + v + '\n', r.stderr);
      const x = run(file, ['--bogus']);
      ok(label + ': a wrong option exits with 2', x.status === 2 && /Unknown option/.test(x.stderr));
      const m = run(file, [path.join(tmpRoot, 'nofile.csv'), '--print']);
      ok(label + ': a missing file exits with 1', m.status === 1 && /File not found/.test(m.stderr));
    }
    // the test files: the process gives the prompt of the reading core, in the source tree and in the built file
    const dirs = ['v14-fixtures', 'access-fixtures', 'dbf-fixtures', 'dacpac-fixtures', 'sql-fixtures'].map((d) => path.join(__dirname, d));
    const files = [];
    const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); } else if (!/(\.json|\.md|\.py|\.sh|\.txt|\.pl|\.out|\.log)$/i.test(e.name) || /\.(ipynb|geojson)$/.test(e.name)) files.push(p); } };
    for (const d of dirs) if (fs.existsSync(d)) walk(d, 0);
    files.sort();
    ok('process tests: there are test files to read (' + files.length + ')', files.length > 80, files.length);
    let diff = 0, errors = 0, done = 0, firstBad = '';
    const queue = files.slice();
    const t0 = Date.now();
    async function worker() {
      while (queue.length) {
        const f = queue.shift();
        for (const extra of [[], ['--no-share=2']]) {
          const expect = await realm.prepare(fs.readFileSync(f), path.basename(f), extra.length ? { share: 'no', level: 2 } : {}).then((r) => ({ md: r.md }), (e) => ({ err: realm.errorInfo(e, extra.length > 0).key }));
          const r = await new Promise((resolve) => cp.execFile(process.execPath, [b1, f, '--no-copy', '--print', '--quiet'].concat(extra), { encoding: 'utf8', maxBuffer: 1 << 28 }, (e, so, se) => resolve({ code: e ? e.code : 0, so, se })));
          done++;
          const good = expect.md !== undefined ? r.code === 0 && r.so === expect.md : r.code === 1 && r.se.includes('databrief:');
          if (!good) { diff++; if (!firstBad) firstBad = path.basename(f) + ' ' + extra.join(' ') + ' code ' + r.code + ' ' + (r.se || '').slice(0, 150); }
          if (expect.err) errors++;
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    ok('the built file gives the reading core\'s prompt (or its error) for every test file, normal and --no-share=2 (' + done + ' runs, ' + errors + ' expected errors, ' + Math.round((Date.now() - t0) / 1000) + ' s)', diff === 0 && done === files.length * 2, firstBad);
    for (const f of files.filter((x) => /(ventes|orders|shop|report|deck|customers|catalog)\./.test(path.basename(x))).slice(0, 8)) {
      const a = run(path.join(CLI, 'databrief.cjs'), [f, '--no-copy', '--print', '--quiet']), b = run(b1, [f, '--no-copy', '--print', '--quiet']);
      ok('source tree and built file give the same prompt: ' + path.basename(f), a.status === b.status && a.stdout === b.stdout && a.status === 0, a.stderr + b.stderr);
    }
    // a long prompt on a pipe is not cut
    let big = 'id,text,value\n';
    for (let i = 0; i < 120000; i++) big += i + ',a fairly long text value number ' + i + ' with words,' + (i * 1.5) + '\n';
    const bigFile = path.join(tmpRoot, 'big.csv');
    fs.writeFileSync(bigFile, big);
    const p1 = run(b1, [bigFile, '--no-copy', '--print', '--quiet']), p2 = run(b1, [bigFile, '--no-copy', '--json', '--quiet']);
    ok('a prompt of several MB on a pipe arrives whole (' + (p1.stdout.length / 1048576).toFixed(1) + ' MB)', p1.status === 0 && p1.stdout.length > 4e6 && p1.stdout.endsWith('\n') && JSON.parse(p2.stdout).prompt === p1.stdout, p1.stdout.length + ' / ' + p2.stdout.length);
    // a real run writing files
    const w = tmp();
    const r = cp.spawnSync(process.execPath, [b1, bigFile, '--no-copy', '--csv', '--out', w, '--no-share'], { encoding: 'utf8', cwd: w, env: cleanEnv });
    const out = tree(w);
    ok('a real run: --csv --out --no-share writes the folder, the summary says what was done', r.status === 0 && out.length === 2 && out.some((x) => /\/prompt\.md$/.test(x)) && out.some((x) => /\/big\.csv$/.test(x)) && /holds NO data/.test(r.stderr) && /Wrote 2 files in /.test(r.stderr) && r.stdout === '', r.stderr);
    // Node too old: the entry file checks the version before it loads anything (a text check: an old Node is not at hand)
    ok('the version check is the first thing the entry file does, in plain JavaScript', /process\.versions\.node/.test(fs.readFileSync(path.join(CLI, 'databrief.cjs'), 'utf8').split('\n').slice(0, 8).join('\n')) && !/require\(/.test(fs.readFileSync(path.join(CLI, 'databrief.cjs'), 'utf8').split('process.exit(2)')[0]));
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
