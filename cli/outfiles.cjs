/* DataBrief command-line tool - the output folder. GPL-3.0-or-later.
 * Everything written goes in ONE new folder  FILE_YYYY-MM-DD_HH-MM-SS  inside a base folder:
 *   --csv alone: ./databrief     --out PATH: PATH (absolute: must exist) or ./databrief/PATH (relative: created)
 * env: fs, path, cwd, platform, now() */
'use strict';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/* A file or folder name: no separators, no control characters, nothing Windows refuses, never empty */
function cleanName(s, max) {
  let n = String(s == null ? '' : s).normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').replace(/\s+/g, ' ').trim();
  n = n.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (RESERVED.test(n)) n = '_' + n;
  if (n.length > (max || 100)) {
    const m = /(\.[A-Za-z0-9]{1,8})$/.exec(n);
    const ext = m ? m[1] : '';
    n = n.slice(0, (max || 100) - ext.length) + ext;
  }
  return n || 'data';
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
}

class OutError extends Error {}

/* The base folder -> { dir, note } where note says that a relative path was placed under ./databrief */
function baseFolder(out, env) {
  const { fs, path } = env;
  if (out === undefined || out === null || out === true) {
    const dir = path.join(env.cwd, 'databrief');
    ensureDir(dir, env);
    return { dir, note: '' };
  }
  const given = String(out);
  if (!given.trim()) throw new OutError('--out needs a folder');
  if (/\u0000/.test(given)) throw new OutError('--out: the path holds a null character');
  const absolute = path.isAbsolute(given) || (env.platform === 'win32' && /^[A-Za-z]:/.test(given));
  if (absolute) {
    let st;
    try { st = fs.statSync(given); } catch (e) { throw new OutError('The folder given with --out does not exist: ' + given + ' (create it first, or give a relative path to have it made under ./databrief)'); }
    if (!st.isDirectory()) throw new OutError('--out is not a folder: ' + given);
    return { dir: path.resolve(given), note: '' };
  }
  const parts = given.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (parts.includes('..')) throw new OutError('A relative --out stays under ./databrief: "..": not allowed (give an absolute path to write elsewhere)');
  const dir = path.join(env.cwd, 'databrief', ...parts);
  ensureDir(dir, env);
  return { dir, note: 'The relative --out ' + given + ' was placed under ./databrief: ' + dir };
}

function ensureDir(dir, env) {
  try { env.fs.mkdirSync(dir, { recursive: true }); } catch (e) { throw new OutError('Cannot create the folder ' + dir + ': ' + e.message); }
}

/* A new folder named after the file and the time (-2, -3 ... when it exists) */
function newFolder(base, fileName, env) {
  const { fs, path } = env;
  const stem = cleanName(String(fileName).replace(/\.[^.]*$/, ''), 60);
  const name = stem + '_' + stamp(env.now());
  for (let k = 1; k < 1000; k++) {
    const dir = path.join(base, k === 1 ? name : name + '-' + k);
    try { fs.mkdirSync(dir); return dir; } catch (e) { if (e.code !== 'EEXIST') throw new OutError('Cannot create the folder ' + dir + ': ' + e.message); }
  }
  throw new OutError('Cannot find a free folder name in ' + base);
}

/* Names of the data files: clean, unique (also on case-insensitive disks), never one of the tool's own files */
function dataNames(files) {
  const used = new Set(['prompt.md', 'initial_prompt.md']);
  return files.map((f) => {
    let n = cleanName(f.name, 120);
    if (!/\.csv$/i.test(n)) n += '.csv';
    const m = /^(.*?)(\.csv)$/i.exec(n);
    let cand = n, k = 2;
    while (used.has(cand.toLowerCase())) cand = m[1] + '-' + k++ + m[2];
    used.add(cand.toLowerCase());
    return cand;
  });
}

function write(dir, name, text, env) {
  const file = env.path.join(dir, name);
  try { env.fs.writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' }); } catch (e) { throw new OutError('Cannot write ' + file + ': ' + e.message); }
  return file;
}

module.exports = { cleanName, stamp, baseFolder, newFolder, dataNames, write, OutError };
