/* DataBrief command-line tool - --review: open the prompt in a text editor. GPL-3.0-or-later.
 * Order: the editor named by the user, vim, nano, $VISUAL, $EDITOR, then what the system has. A missing one is skipped
 * (and said), never an error: the first that exists is used; an error only when none does.
 * No shell is used (an editor name is never run through one), except .cmd/.bat launchers on Windows, whose file path is
 * then checked to hold none of the characters cmd.exe reads.
 * env: platform, vars, spawnSync, which(name) -> path or null, waitEnter() -> Promise, nowMs() */
'use strict';

const TERMINAL = new Set(['vi', 'vim', 'nvim', 'nano', 'pico', 'micro', 'hx', 'helix', 'emacs', 'ne', 'joe', 'jed', 'mcedit', 'kak', 'ed', 'editor']);   // ("editor" is Debian's alternative; the tool starts nothing else of Debian's, and a name that is not started stays out of this list)
// Editors that return at once unless asked to wait: the flag that makes them wait
const WAIT_FLAG = { code: '--wait', 'code-insiders': '--wait', codium: '--wait', cursor: '--wait', subl: '--wait', atom: '--wait', gedit: '--wait', kate: '--block', zed: '--wait' };
// Programs that wait without being asked
// (not Notepad: the tabbed Notepad of Windows 11 hands the file to an open window and returns at once)
const WAITS = new Set(TERMINAL);

/* "code --wait" -> ['code', '--wait']; quotes group words; a backslash is kept as it is (Windows paths) */
function splitCommand(s) {
  const out = [];
  let cur = '', q = '', has = false;
  for (const ch of String(s)) {
    if (q) { if (ch === q) q = ''; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

const baseOf = (cmd) => String(cmd).replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();

function candidateList(named, env) {
  const v = env.vars || {};
  const list = [];
  const add = (label, cmdline) => { const w = splitCommand(cmdline); if (w.length) list.push({ label, cmd: w[0], args: w.slice(1) }); };
  if (named && named !== true) add(String(named), String(named));
  add('vim', 'vim');
  add('nano', 'nano');
  if (v.VISUAL) add('$VISUAL (' + v.VISUAL + ')', v.VISUAL);
  if (v.EDITOR) add('$EDITOR (' + v.EDITOR + ')', v.EDITOR);
  if (env.platform === 'win32') { add('notepad', 'notepad'); }
  else if (env.platform === 'darwin') { add('TextEdit', 'open -e -W -n'); }
  else { for (const e of ['editor', 'vi', 'nvim', 'micro', 'hx', 'emacs', 'code', 'gedit', 'kate']) add(e, e); }
  return list;
}

/* -> { chosen: {label, exe, args, wait}, skipped: [labels] } or null */
function choose(named, env) {
  const skipped = [];
  for (const c of candidateList(named, env)) {
    const exe = env.which(c.cmd);
    if (!exe) { if (!skipped.includes(c.label)) skipped.push(c.label); continue; }
    const b = baseOf(c.cmd);
    const args = c.args.slice();
    if (WAIT_FLAG[b] && !args.some((a) => /^(-w|--wait|--block)$/.test(a))) args.unshift(WAIT_FLAG[b]);
    // The prompt holds text from the file (the last rows, the file name): editors that obey settings written in a file must
    // not here. Vim and Neovim: no modelines for this buffer (set before it is read, so a vimrc cannot turn them back on);
    // Emacs: no file-local variables. ("vi" may be a vi that knows no --cmd: it is left as it is.)
    if (['vim', 'nvim', 'gvim', 'mvim', 'vimx'].includes(b)) args.unshift('--cmd', 'au BufReadPre * setlocal nomodeline');
    if (b === 'emacs' || b === 'emacsclient') args.unshift('--eval', '(setq enable-local-variables nil)');
    return { chosen: { label: c.label, exe, args, name: b, waits: WAITS.has(b) || !!WAIT_FLAG[b] || (b === 'open' && args.includes('-W')) }, skipped };
  }
  return null;
}

// Even inside double quotes cmd.exe reads "%" (variables) and ends the string at a double quote: such a path is not given to a .cmd/.bat launcher
const CMD_UNSAFE = /["%\u0000-\u001f]/;

/* Opens `file` and returns when the editing is over -> { ok, error, note } */
async function edit(file, named, env) {
  const pick = choose(named, env);
  const skippedNote = (p) => (p.skipped.length ? p.skipped.join(', ') + (p.skipped.length === 1 ? ' is' : ' are') + ' not available, ' : '');
  if (!pick) return { ok: false, error: 'No text editor was found (tried vim, nano, $VISUAL, $EDITOR and the usual ones). Install one, or set the EDITOR variable.' };
  const { chosen } = pick;
  let exe = chosen.exe, args = chosen.args.concat([file]);
  const opts = { stdio: 'inherit', windowsHide: false };
  if (env.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    if (CMD_UNSAFE.test(file) || CMD_UNSAFE.test(chosen.args.join(' '))) return { ok: false, error: 'The prompt\'s path holds a character that cmd.exe would read (' + file + '): use a simpler --out folder, or an editor that is not a .cmd file' };
    const q = (s) => '"' + s + '"';
    args = ['/d', '/s', '/c', '"' + [q(exe)].concat(chosen.args.map(q), [q(file)]).join(' ') + '"'];
    // a full path: a bare "cmd.exe" would be looked for in the current folder first
    exe = env.vars.ComSpec || ((env.vars.SystemRoot || env.vars.windir || 'C:\\Windows') + '\\System32\\cmd.exe');
    opts.windowsVerbatimArguments = true;
  }
  const t0 = env.nowMs();
  const r = env.spawnSync(exe, args, opts);
  if (r && r.error) return { ok: false, error: 'Could not start ' + chosen.label + ': ' + r.error.message };
  const quick = env.nowMs() - t0 < 3000;
  let note = skippedNote(pick) ? skippedNote(pick) + 'used ' + chosen.label : '';
  if (r && r.status) note += (note ? '; ' : '') + chosen.label + ' ended with code ' + r.status + ': the file is used as it is';
  // An editor that opens a window and returns at once: wait for the user
  if (!chosen.waits && quick) {
    env.say('Press Enter here when you have saved and closed the file in ' + chosen.label + '...');
    await env.waitEnter();
  }
  return { ok: true, editor: chosen.label, note };
}

module.exports = { edit, choose, splitCommand, candidateList, WAITS, TERMINAL };
