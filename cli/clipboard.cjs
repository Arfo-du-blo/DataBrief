/* DataBrief command-line tool - the clipboard. GPL-3.0-or-later.
 * copy(text, env) -> { ok, tool, error }. No shell is used: the text goes to the tool's standard input.
 *   Windows and WSL: PowerShell (Set-Clipboard, text read as UTF-8), else clip.exe (UTF-16)
 *   macOS: pbcopy        Linux: wl-copy (Wayland), xclip, xsel (X11)
 * env: platform, vars (environment variables), spawnSync, which(name) -> path or null, isWsl() */
'use strict';

const PS_SCRIPT = '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t';

function candidates(env) {
  const wsl = env.isWsl && env.isWsl();
  if (env.platform === 'win32' || wsl) {
    const out = [];
    for (const exe of wsl ? ['powershell.exe', 'pwsh.exe'] : ['powershell.exe', 'pwsh.exe', 'powershell', 'pwsh']) {
      out.push({ name: exe, args: ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], input: (t) => Buffer.from(t, 'utf8') });
    }
    // clip.exe reads UTF-16 text when the stream starts with a byte order mark
    out.push({ name: 'clip.exe', args: [], input: (t) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]) });
    return out;
  }
  if (env.platform === 'darwin') return [{ name: 'pbcopy', args: [], input: (t) => Buffer.from(t, 'utf8'), env: { LC_CTYPE: 'UTF-8' } }];
  const out = [];
  const v = env.vars || {};
  if (v.WAYLAND_DISPLAY) out.push({ name: 'wl-copy', args: [], bg: true, input: (t) => Buffer.from(t, 'utf8') });
  out.push({ name: 'xclip', args: ['-selection', 'clipboard', '-in'], bg: true, input: (t) => Buffer.from(t, 'utf8') });
  out.push({ name: 'xsel', args: ['--clipboard', '--input'], bg: true, input: (t) => Buffer.from(t, 'utf8') });
  if (!v.WAYLAND_DISPLAY) out.push({ name: 'wl-copy', args: [], bg: true, input: (t) => Buffer.from(t, 'utf8') });
  return out;
}

function copy(text, env) {
  const tried = [];
  for (const c of candidates(env)) {
    const exe = env.which(c.name);
    if (!exe) continue;
    // Linux tools keep serving the clipboard from a background process that inherits the pipes: nothing is read from them
    const r = env.spawnSync(exe, c.args, {
      input: c.input(text), stdio: ['pipe', 'ignore', c.bg ? 'ignore' : 'pipe'], timeout: 20000, windowsHide: true,
      env: Object.assign({}, env.vars || {}, c.env || {}),
    });
    if (r && !r.error && r.status === 0) return { ok: true, tool: c.name };
    tried.push(c.name + ': ' + String((r && r.error && r.error.message) || (r && r.stderr && String(r.stderr).trim().slice(0, 120)) || 'exit ' + (r && r.status)));
  }
  const hint = env.platform === 'win32' ? 'PowerShell was not found or failed'
    : env.platform === 'darwin' ? 'pbcopy was not found'
      : 'none of wl-copy, xclip or xsel was found (install wl-clipboard, xclip or xsel)';
  return { ok: false, error: tried.length ? 'the clipboard tool failed (' + tried.join('; ') + ')' : hint };
}

module.exports = { copy, candidates, PS_SCRIPT };
