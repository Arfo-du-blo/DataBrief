/* DataBrief command-line tool - the program. GPL-3.0-or-later.
 * run(argv, env) -> exit code. env holds everything that touches the computer (file system, clipboard, editor, clock), so that
 * the tests can run it with stand-ins; defaultEnv() is the real one. */
'use strict';
const nodeFs = require('fs');
const nodePath = require('path');
const cp = require('child_process');
const { parse, HELP, NS_SWITCHES, MODES, LAYOUTS } = require('./args.cjs');
const clipboard = require('./clipboard.cjs');
const outfiles = require('./outfiles.cjs');
const editor = require('./editor.cjs');
const realmLib = require('./realm.cjs');

const EXIT = { OK: 0, FILE: 1, OPTIONS: 2, DELIVERY: 3 };

/* ---------- the real environment ---------- */
function which(name, vars, platform, fs, path) {
  const win = platform === 'win32';
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  const exts = win ? String(vars.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const tryOne = (base) => {
    const names = win && /\.[A-Za-z0-9]+$/.test(base) ? [base] : exts.map((e) => base + e);
    for (const n of names) {
      if (!isFile(n)) continue;
      if (!win) { try { fs.accessSync(n, fs.constants.X_OK); } catch (e) { continue; } }
      return n;
    }
    return null;
  };
  if (/[\\/]/.test(name)) return tryOne(name);
  for (const dir of String(vars.PATH || vars.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    const r = tryOne(path.join(dir.replace(/^"|"$/g, ''), name));
    if (r) return r;
  }
  return null;
}

function defaultEnv() {
  const fs = nodeFs, path = nodePath;
  return {
    fs, path, cwd: process.cwd(), platform: process.platform, vars: process.env,
    stdout: process.stdout, stderr: process.stderr,
    stdinIsTTY: !!process.stdin.isTTY, stdoutIsTTY: !!process.stdout.isTTY,
    spawnSync: cp.spawnSync, now: () => new Date(), nowMs: () => Date.now(),
    which: (name) => which(name, process.env, process.platform, fs, path),
    isWsl: () => { try { return process.platform === 'linux' && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch (e) { return false; } },
    waitEnter: () => new Promise((resolve) => {
      const rl = require('readline').createInterface({ input: process.stdin, terminal: false });
      rl.once('line', () => { rl.close(); resolve(); });
      rl.once('close', resolve);
    }),
    say: (s) => process.stderr.write(s + '\n'),
    createRealm: (o) => realmLib.create(o),
  };
}

const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ---------- run ---------- */
async function run(argv, env) {
  const say = (s) => env.stderr.write(s + '\n');
  const { opts, errors } = parse(argv);
  const version = env.version || realmLib.version();
  if (opts.help) { env.stdout.write(HELP); return EXIT.OK; }
  if (opts.version) { env.stdout.write('databrief ' + version + '\n'); return EXIT.OK; }
  if (!errors.length && !opts.file) { say('Usage: databrief FILE [options]   (databrief --help lists the options)'); return EXIT.OPTIONS; }

  /* options that need no knowledge of the page */
  const bad = errors.slice();
  const lc = (v) => String(v).trim().toLowerCase();
  const o = { share: 'yes', level: 1, lang: 'en', mode: 'inline', layout: 'auto', profile: true, limit: null, sw: null };
  if (opts.noShare !== undefined) {
    o.share = 'no';
    if (opts.noShare !== true) { if (/^[123]$/.test(String(opts.noShare))) o.level = Number(opts.noShare); else bad.push('--no-share=LEVEL: LEVEL is 1, 2 or 3 (got "' + opts.noShare + '")'); }
  }
  const list = (key, flag) => {
    if (opts[key] === undefined) return [];
    if (o.share !== 'no') bad.push(flag + ' only goes with --no-share');
    const items = String(opts[key]).split(',').map(lc).filter(Boolean);
    for (const i of items) if (!NS_SWITCHES.includes(i)) bad.push(flag + ': "' + i + '" is not one of ' + NS_SWITCHES.join(', '));
    return items;
  };
  const allow = list('allow', '--allow'), hide = list('hide', '--hide');
  for (const a of allow) if (hide.includes(a)) bad.push('"' + a + '" is in both --allow and --hide');
  if (allow.length || hide.length) { o.sw = {}; for (const a of allow) o.sw[a] = true; for (const h of hide) o.sw[h] = false; }
  if (opts.mode !== undefined) { o.mode = lc(opts.mode); if (!MODES.includes(o.mode)) bad.push('--mode is inline or files (got "' + opts.mode + '")'); }
  if (opts.layout !== undefined) { o.layout = lc(opts.layout); if (!LAYOUTS.includes(o.layout)) bad.push('--layout is auto, table or csv (got "' + opts.layout + '")'); }
  if (opts.limit !== undefined) {
    if (lc(opts.limit) === 'auto') o.limit = 'auto';
    else if (/^[1-9]\d{0,9}$/.test(String(opts.limit).trim())) o.limit = Number(opts.limit);
    else bad.push('--limit is a whole number from 1, or auto (got "' + opts.limit + '")');
  }
  if (opts.profile && opts.noProfile) bad.push('--profile and --no-profile together');
  if (opts.noProfile) o.profile = false;
  if (opts.print && opts.json) bad.push('--print and --json together (--json already holds the prompt)');
  if (opts.out !== undefined && opts.out !== true && !String(opts.out).trim()) bad.push('--out needs a folder');
  const writes = !!(opts.csv || opts.out !== undefined || opts.review !== undefined);
  if (opts.noCopy && !opts.print && !opts.json && !writes) bad.push('--no-copy leaves nothing to do: add --print, --csv, --out, --review or --json');
  if (opts.noCopy && opts.copy) bad.push('--copy and --no-copy together');
  if (opts.review !== undefined) {
    if (!env.stdinIsTTY || !env.stdoutIsTTY) bad.push('--review needs an interactive terminal (standard input and output must be a terminal): it cannot run from a pipe, a script or an AI agent\'s shell. Use --csv or --out, and edit prompt.md yourself');
    else if (opts.json) bad.push('--review and --json together');
  }
  if (bad.length) { for (const b of bad) say('databrief: ' + b); return EXIT.OPTIONS; }
  const wantCopy = !opts.noCopy;
  o.csv = !!opts.csv;

  /* the page's code: languages, then the file */
  let realm;
  try { realm = env.createRealm({ pdf: true }); } catch (e) { say('databrief: the reading code did not load: ' + e.message); return EXIT.FILE; }
  if (opts.lang !== undefined) {
    o.lang = lc(opts.lang);
    if (!realm.langs.includes(o.lang)) { say('databrief: --lang: "' + opts.lang + '" is not a prompt language (' + realm.langs.join(', ') + ')'); return EXIT.OPTIONS; }
  }
  const notes = [], warnings = [];
  if (o.limit !== null && o.mode === 'files') { notes.push('--limit is ignored in files mode (the prompt holds only a sample).'); o.limit = null; }
  if (o.limit !== null && o.share === 'no') { notes.push('--limit is ignored with --no-share (there are no rows).'); o.limit = null; }

  const fail = (code, info) => {
    if (opts.json) env.stdout.write(JSON.stringify({ ok: false, error: info }, null, 2) + '\n');
    say('databrief: ' + info.message + (info.detail ? '\n  (' + info.detail + ')' : ''));
    return code;
  };
  let bytes;
  try {
    const st = env.fs.statSync(opts.file);
    if (st.isDirectory()) return fail(EXIT.FILE, { key: 'errIsFolder', message: opts.file + ' is a folder, not a file' });
    bytes = env.fs.readFileSync(opts.file);
  } catch (e) {
    const m = e.code === 'ENOENT' ? 'File not found: ' + opts.file
      : e.code === 'EACCES' || e.code === 'EPERM' ? 'No permission to read ' + opts.file
        : e.code === 'ERR_FS_FILE_TOO_LARGE' || e.code === 'ERR_OUT_OF_RANGE' ? opts.file + ' is too large for the command-line tool (2 GB at most)'
          : 'Cannot read ' + opts.file + ': ' + e.message;
    return fail(EXIT.FILE, { key: 'errRead', message: m });
  }
  let res;
  try { res = await realm.prepare(bytes, env.path.basename(opts.file), o); } catch (e) {
    const i = realm.errorInfo(e, o.share === 'no');
    return fail(EXIT.FILE, i);
  }
  bytes = null;

  /* the output folder */
  const result = { prompt: res.md, files: [], folder: '', copied: null, printed: false };
  let promptPath = '';
  if (writes) {
    try {
      const base = outfiles.baseFolder(opts.out, env);
      if (base.note) notes.push(base.note);
      const dir = outfiles.newFolder(base.dir, env.path.basename(opts.file), env);
      result.folder = dir;
      if (opts.review !== undefined) outfiles.write(dir, 'initial_prompt.md', res.md, env);
      promptPath = outfiles.write(dir, 'prompt.md', res.md, env);
      if (o.csv) {
        const names = outfiles.dataNames(res.files);
        res.files.forEach((f, i) => { result.files.push(outfiles.write(dir, names[i], f.text, env)); });
        if (!res.files.length) notes.push('--csv: this file holds no table, so there is no data file to write.');
      }
    } catch (e) {
      if (e instanceof outfiles.OutError) return fail(EXIT.OPTIONS, { key: 'errOut', message: e.message });
      throw e;
    }
  }

  /* --review: the user edits prompt.md */
  let final = res.md;
  let reviewed = null;
  if (opts.review !== undefined) {
    const r = await editor.edit(promptPath, opts.review === true ? null : opts.review, Object.assign({ say }, env));
    if (!r.ok) return fail(EXIT.OPTIONS, { key: 'errEditor', message: r.error + ' (prompt.md and initial_prompt.md are in ' + result.folder + ')' });
    try { final = env.fs.readFileSync(promptPath, 'utf8'); } catch (e) { return fail(EXIT.FILE, { key: 'errRead', message: 'Cannot read the edited ' + promptPath + ': ' + e.message }); }
    if (!final.trim()) return fail(EXIT.DELIVERY, { key: 'errEmpty', message: 'The edited prompt is empty: nothing was copied (initial_prompt.md has the original)' });
    reviewed = { editor: r.editor, changed: final !== res.md, note: r.note };
    result.prompt = final;
  }

  /* the clipboard, stdout */
  let copyFailed = false;
  if (wantCopy) {
    const c = clipboard.copy(final, env);
    result.copied = c;
    if (!c.ok) copyFailed = true;
  }
  const delivered = !copyFailed || opts.print || opts.json || !!result.folder;
  if (opts.print) { env.stdout.write(final); result.printed = true; }

  /* the summary (standard error) */
  const tokens = reviewed && reviewed.changed ? realm.DB.estimateTokens(final) : res.tokens;
  if (res.large && res.shared && o.limit === null) {
    warnings.push('The prompt is about ' + fmtN(res.large.tokens) + ' tokens, over the ' + fmtN(150000) + ' most AI tools take. Use --limit auto (about ' + fmtN(res.large.limit) + ' rows per table fit), --mode files, or --no-share.');
  }
  if (!res.shared && o.csv && result.files.length) notes.push('--csv writes the data of the file on this computer: the prompt holds no data, the CSV files do.');
  const lines = [];
  lines.push('Read ' + env.path.basename(opts.file) + (res.formatName ? ' (' + res.formatName + ')' : '') + '. The prompt is about ' + fmtN(tokens) + ' tokens' + (reviewed && reviewed.changed ? ' (edited)' : '') + '.');
  lines.push(res.shared ? 'The prompt holds the data of the file.' : 'The prompt holds NO data (Do not share data, level ' + o.level + ').');
  if (reviewed) lines.push('Reviewed in ' + reviewed.editor + (reviewed.note ? ' (' + reviewed.note + ')' : '') + (reviewed.changed ? ': your edits are used.' : ': unchanged.'));
  if (result.folder) {
    const written = [reviewed ? 'initial_prompt.md' : null, 'prompt.md'].filter(Boolean).concat(result.files.map((f) => env.path.basename(f)));
    lines.push('Wrote ' + written.length + ' file' + (written.length === 1 ? '' : 's') + ' in ' + result.folder + ': ' + written.join(', '));
  }
  if (wantCopy) lines.push(result.copied.ok ? 'Copied to the clipboard (' + result.copied.tool + ').' : 'NOT copied to the clipboard: ' + result.copied.error + '.');
  else lines.push('Not copied to the clipboard (--no-copy).');
  if (result.printed) lines.push('Printed on standard output.');
  if (!opts.quiet) { for (const l of lines) say(l); for (const n of notes) say('Note: ' + n); for (const w of warnings) say('Warning: ' + w); }
  else if (copyFailed) say('databrief: NOT copied to the clipboard: ' + result.copied.error);

  if (opts.json) {
    env.stdout.write(JSON.stringify({
      ok: true, version, file: env.path.basename(opts.file), format: res.formatName, shared: res.shared, level: res.shared ? null : o.level,
      tokens, prompt: final, copied: result.copied ? result.copied.ok : false, folder: result.folder || null, files: result.files,
      reviewed: reviewed ? { editor: reviewed.editor, changed: reviewed.changed } : null, large: res.large, notes, warnings,
    }, null, 2) + '\n');
  }
  if (!delivered) { say('databrief: nothing was delivered. Use --print, or --csv / --out to write files, or install a clipboard tool.'); return EXIT.DELIVERY; }
  return EXIT.OK;
}

module.exports = { run, defaultEnv, which, EXIT };
