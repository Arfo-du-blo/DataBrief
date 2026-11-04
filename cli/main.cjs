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
const mcp = require('./mcp.cjs');

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
    stdin: process.stdin, stdout: process.stdout, stderr: process.stderr,
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
const MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;   // what Node reads into one buffer

/* Text for a terminal: control characters (escape sequences could change the terminal, its title or clipboard) and the
 * characters that reverse the reading direction (they can make a name look like another) are replaced. Line breaks and tabs
 * stay unless `oneLine`. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const forTerminal = (s, oneLine) => { const t = String(s).replace(CONTROL, '\ufffd'); return oneLine ? t.replace(/[\r\n\t]/g, '\ufffd') : t; };

/* ---------- run ---------- */
async function run(argv, env) {
  // everything on standard error is the tool's own text, plus names and messages that can come from the file: made safe
  const say = (s) => env.stderr.write(forTerminal(s) + '\n');
  const { opts, errors } = parse(argv);
  const version = env.version || realmLib.version();
  if (opts.help) { env.stdout.write(HELP); return EXIT.OK; }
  if (opts.version) { env.stdout.write('databrief ' + version + '\n'); return EXIT.OK; }
  // --mcp: a local MCP server on standard input and output; every other option comes from the AI, call by call
  if (opts.mcp) {
    const extra = Object.keys(opts).filter((k) => !['file', 'mcp', 'root'].includes(k) && opts[k] !== undefined);
    if (errors.length || opts.file !== null || extra.length) {
      for (const e of errors) say('databrief: ' + e);
      if (opts.file !== null || extra.length) say('databrief: --mcp takes no file and no option but --root: the AI gives the file and the settings in each call');
      return EXIT.OPTIONS;
    }
    const log = (s) => env.stderr.write('[databrief] ' + forTerminal(s, true) + '\n');
    try {
      const done = mcp.serveStdio({ main: { run, defaultEnv }, version, root: opts.root, input: env.stdin, output: env.stdout, log });
      log('MCP server started, version ' + version + (opts.root !== undefined ? ', files limited to the --root folder' : '') + ' (Node ' + process.versions.node + ')');
      await done;
    } catch (e) { say('databrief: ' + e.message); return EXIT.OPTIONS; }
    return EXIT.OK;
  }
  if (opts.root !== undefined) { say('databrief: --root only goes with --mcp'); return EXIT.OPTIONS; }
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
  if (o.share === 'no') {
    // the page has no such settings in "Do not share data": said, not silently dropped
    const ignored = [o.limit !== null ? '--limit' : '', opts.mode !== undefined ? '--mode' : '', opts.layout !== undefined ? '--layout' : '', opts.noProfile ? '--no-profile' : ''].filter(Boolean);
    if (ignored.length) notes.push(ignored.join(', ') + (ignored.length > 1 ? ' are' : ' is') + ' ignored with --no-share (the prompt has no rows).');
    o.limit = null;
  }
  if (o.share !== 'no' && o.mode === 'files' && !o.csv) warnings.push('--mode files: the prompt asks the AI to load CSV files; add --csv to write them (or give the AI the data another way).');
  // an --out folder that cannot be used is said before the file is read (that can take minutes)
  if (opts.out !== undefined) {
    try { outfiles.baseFolder(opts.out, env, { check: true }); } catch (e) {
      if (e instanceof outfiles.OutError) { say('databrief: ' + e.message); return EXIT.OPTIONS; }
      throw e;
    }
  }

  // --hide=file: the file's name is kept out of everything the tool shows, its error messages too
  const fileHidden = o.share === 'no' && !!o.sw && o.sw.file === false;
  const fileRef = fileHidden ? 'the file' : opts.file;
  const fail = (code, info) => {
    if (fileHidden && info.key === 'errUnsupported') info = Object.assign({}, info, { message: 'This file type is not supported.' });
    if (opts.json) env.stdout.write(JSON.stringify({ ok: false, error: info }, null, 2) + '\n');
    say('databrief: ' + info.message + (info.detail ? '\n  (' + info.detail + ')' : ''));
    return code;
  };
  let bytes;
  try {
    const st = env.fs.statSync(opts.file);
    if (st.isDirectory()) return fail(EXIT.FILE, { key: 'errIsFolder', message: fileRef + ' is a folder, not a file' });
    // a device, a pipe or a socket (/dev/zero, a FIFO) would be read forever: only regular files (a link to one is fine)
    if (!st.isFile()) return fail(EXIT.FILE, { key: 'errNotFile', message: fileRef + ' is not a regular file (a device, a pipe or a socket)' });
    if (st.size > MAX_BYTES) return fail(EXIT.FILE, { key: 'errRead', message: fileRef + ' is too large for the command-line tool (2 GB at most)' });
    // read through the descriptor that is checked again: the path cannot be swapped for a pipe between the check and the read
    // (opened without waiting, so a pipe put there in between does not block the open either)
    const fd = env.fs.openSync(opts.file, env.fs.constants.O_RDONLY | (env.fs.constants.O_NONBLOCK || 0));
    try {
      const st2 = env.fs.fstatSync(fd);
      if (!st2.isFile()) return fail(EXIT.FILE, { key: 'errNotFile', message: fileRef + ' is not a regular file (a device, a pipe or a socket)' });
      if (st2.size > MAX_BYTES) return fail(EXIT.FILE, { key: 'errRead', message: fileRef + ' is too large for the command-line tool (2 GB at most)' });
      bytes = env.fs.readFileSync(fd);
    } finally { env.fs.closeSync(fd); }
  } catch (e) {
    const m = e.code === 'ENOENT' ? 'File not found: ' + fileRef
      : e.code === 'EACCES' || e.code === 'EPERM' ? 'No permission to read ' + fileRef
        : e.code === 'ERR_FS_FILE_TOO_LARGE' || e.code === 'ERR_OUT_OF_RANGE' ? fileRef + ' is too large for the command-line tool (2 GB at most)'
          : 'Cannot read ' + fileRef + ': ' + (fileHidden ? String(e.code || 'error') : e.message);
    return fail(EXIT.FILE, { key: 'errRead', message: m });
  }
  let res;
  try { res = await realm.prepare(bytes, env.path.basename(opts.file), o); } catch (e) {
    const i = realm.errorInfo(e, o.share === 'no');
    return fail(EXIT.FILE, i);
  }
  bytes = null;

  /* "Do not share data" with the file name or the names hidden (--hide=file / --hide=names): they are kept out of everything
   * the tool shows (summary, JSON, the paths it prints), not only out of the prompt: an AI agent reads those too. The
   * folder is then named "dataset_..." and the CSV files data.csv / data_01.csv ... */
  const baseName = env.path.basename(opts.file);
  const shownName = fileHidden ? 'the file' : baseName;

  /* the output folder */
  const result = { prompt: res.md, files: [], folder: '', copied: null, printed: false };
  let promptPath = '';
  let writeError = '';
  if (writes) {
    try {
      const base = outfiles.baseFolder(opts.out, env);
      if (base.note) notes.push(base.note);
      const dir = outfiles.newFolder(base.dir, fileHidden ? 'dataset' : baseName, env);
      result.folder = dir;
      if (opts.review !== undefined) outfiles.write(dir, 'initial_prompt.md', res.md, env);
      promptPath = outfiles.write(dir, 'prompt.md', res.md, env);
      if (o.csv) {
        // the names the prompt gives them (src/markdown.js DB.dataFileNames; in "Do not share data" the core named them by
        // the prompt's rules); changed only where the disk would refuse them or a name could fool the eye, and then said
        const names = outfiles.dataNames(res.files);
        res.files.forEach((f, i) => {
          result.files.push(outfiles.write(dir, names[i], f.text, env));
          if (names[i] !== f.name) notes.push('the data file the prompt calls "' + f.name + '" was written as "' + names[i] + '" (a name the disk refuses or that could mislead).');
        });
        if (!res.files.length) notes.push('--csv: this file holds no table, so there is no data file to write.');
      }
    } catch (e) {
      if (!(e instanceof outfiles.OutError)) throw e;
      writeError = e.message;   // the clipboard and --print still get the prompt; the exit code says what failed
    }
  }

  /* --review: the user edits prompt.md */
  let final = res.md;
  let reviewed = null;
  if (writeError && opts.review !== undefined) return fail(EXIT.DELIVERY, { key: 'errOut', message: writeError + ' (--review needs prompt.md: nothing was copied)' });
  if (opts.review !== undefined) {
    const r = await editor.edit(promptPath, opts.review === true ? null : opts.review, Object.assign({}, env, { say }));
    if (!r.ok) return fail(EXIT.DELIVERY, { key: 'errEditor', message: r.error + ' (prompt.md and initial_prompt.md are in ' + result.folder + '; nothing was copied)' });
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
  if (opts.print) {
    // on a terminal, control characters of the data are shown as \ufffd (a file can hold escape sequences); a pipe gets the prompt as it is
    const shown = env.stdoutIsTTY ? forTerminal(final) : final;
    if (shown !== final) notes.push('control characters of the data were shown as \ufffd on the terminal; the clipboard, the files and a pipe get them as they are.');
    env.stdout.write(shown);
    result.printed = true;
  }

  /* the summary (standard error) */
  const tokens = reviewed && reviewed.changed ? realm.DB.estimateTokens(final) : res.tokens;
  if (res.large && res.shared && o.limit === null) {
    warnings.push('The prompt is about ' + fmtN(res.large.tokens) + ' tokens, over the ' + fmtN(realm.DB.CONFIG.warnTokens) + ' most AI tools take. Use --limit auto (about ' + fmtN(res.large.limit) + ' rows per table fit), --mode files, or --no-share.');
  }
  if (!res.shared && o.level === 3) {
    // the page's warning at level 3 (src/i18n-noshare.js nsL3Warn): summaries are real values
    const I = realm.context.DB_I18N;
    warnings.push(String((I.ui.en && I.ui.en.nsL3Warn) || 'Summaries can reveal real values: check the prompt before sending it.'));
  }
  if (!res.shared && o.csv && result.files.length) notes.push('--csv writes the data of the file on this computer: the prompt holds no data, the CSV files do.');
  if (writeError) warnings.push('No file was written: ' + writeError);
  const lines = [];
  lines.push('Read ' + shownName + (res.formatName ? ' (' + res.formatName + ')' : '') + '. The prompt is about ' + fmtN(tokens) + ' tokens' + (reviewed && reviewed.changed ? ' (edited)' : '') + '.');
  lines.push(res.shared ? 'The prompt holds the data of the file.'
    : o.level === 3 ? 'The prompt holds no record (Do not share data, level 3), but its summaries can include real values: check it before sending.'
      : 'The prompt holds NO data (Do not share data, level ' + o.level + ').');
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
    let text = JSON.stringify({
      ok: true, version, file: fileHidden ? null : baseName, format: res.formatName, shared: res.shared, level: res.shared ? null : o.level,
      tokens, prompt: final, copied: result.copied ? result.copied.ok : false, folder: result.folder || null, files: result.files,
      reviewed: reviewed ? { editor: reviewed.editor, changed: reviewed.changed } : null, large: res.large, notes, warnings,
      writeError: writeError || null,
    }, null, 2) + '\n';
    // JSON escapes C0 controls only: on a terminal, C1 controls and direction overrides are escaped too (the same JSON value)
    if (env.stdoutIsTTY) text = text.replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    env.stdout.write(text);
  }
  if (writeError) { say('databrief: the files were not written (' + writeError + ')'); return EXIT.DELIVERY; }
  if (!delivered) { say('databrief: nothing was delivered. Use --print, or --csv / --out to write files, or install a clipboard tool.'); return EXIT.DELIVERY; }
  return EXIT.OK;
}

module.exports = { run, defaultEnv, which, EXIT };
