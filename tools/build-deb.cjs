#!/usr/bin/env node
/* Builds the Debian / Ubuntu package:   node tools/build-deb.cjs [OUTPUT.deb] [--version 1.5.0-rc.1]      (Linux, needs dpkg-deb)
 * The package is one architecture-independent file (Architecture: all):
 *   /usr/bin/databrief                        a small shell script: runs the tool with node (or nodejs), or says how to get Node
 *   /usr/lib/databrief/databrief-cli.cjs      the one-file tool (tools/build-cli.cjs)
 *   /usr/share/man/man1/databrief.1.gz        the manual
 *   /usr/share/doc/databrief/                 copyright, changelog, THIRD-PARTY-NOTICES.md, licenses/ of the bundled libraries
 * Node.js is Recommended, not Depended on: the Node of an older Ubuntu or Debian is too old (the tool needs 18 or newer), and a
 * Node installed another way (nvm, NodeSource) is not known to dpkg. Without a usable Node the launcher says what to do.
 * Reproducible: file times come from SOURCE_DATE_EPOCH (else the last commit's time, else 0), owners root, gzip/xz without names. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
let version = process.env.DATABRIEF_VERSION || '';
let output = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version') version = args[++i] || '';
  else if (!output) output = args[i];
  else throw new Error('Unexpected argument: ' + args[i]);
}
const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
version = version || root.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('Not a version: ' + version);
const debVersion = version.replace('-', '~');   // 1.5.0-rc.1 sorts before 1.5.0 in dpkg when written 1.5.0~rc.1
if (process.platform === 'win32') { console.error('build-deb needs Linux (dpkg-deb): use WSL or the release workflow'); process.exit(2); }
if (cp.spawnSync('dpkg-deb', ['--version']).status !== 0) { console.error('build-deb needs dpkg-deb (sudo apt install dpkg)'); process.exit(2); }

const email = /<([^>]+)>/.exec(root.author)[1];
const maintainer = 'Arfo <' + email + '>';
let epoch = Number(process.env.SOURCE_DATE_EPOCH);
if (!Number.isFinite(epoch) || epoch <= 0) {
  const g = cp.spawnSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8' });
  epoch = g.status === 0 && /^\d+$/.test(g.stdout.trim()) ? Number(g.stdout.trim()) : 0;
}
// OUTPUT is a file, or a folder (dist/): then the package is named databrief_<version>_all.deb in it
const debName = 'databrief_' + debVersion + '_all.deb';
output = output || path.join(ROOT, 'dist') + path.sep;
output = path.resolve(/[\\/]$/.test(output) || (fs.existsSync(output) && fs.statSync(output).isDirectory()) ? path.join(output, debName) : output);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-deb-'));
const pkg = path.join(work, 'pkg');
const put = (rel, data, mode) => { const f = path.join(pkg, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); fs.chmodSync(f, mode); return f; };
const lf = (s) => s.replace(/\r\n?/g, '\n');

try {
  // the tool and the manual
  const cli = path.join(work, 'databrief-cli.cjs');
  const b = cp.spawnSync(process.execPath, [path.join(__dirname, 'build-cli.cjs'), cli], { env: Object.assign({}, process.env, { DATABRIEF_VERSION: version }), encoding: 'utf8' });
  if (b.status !== 0) throw new Error('build-cli failed: ' + (b.stderr || b.stdout));
  put('usr/lib/databrief/databrief-cli.cjs', fs.readFileSync(cli), 0o755);   // (it starts with #!/usr/bin/env node)
  put('usr/bin/databrief', [
    '#!/bin/sh',
    '# databrief: runs the DataBrief command-line tool with Node.js (see /usr/share/doc/databrief)',
    'for n in node nodejs; do',
    '  if command -v "$n" >/dev/null 2>&1; then exec "$n" /usr/lib/databrief/databrief-cli.cjs "$@"; fi',
    'done',
    'echo "databrief needs Node.js 18 or newer. Install it with:  sudo apt install nodejs" >&2',
    'exit 127',
    '',
  ].join('\n'), 0o755);
  const manText = cp.spawnSync(process.execPath, [path.join(__dirname, 'build-man.cjs'), path.join(work, 'databrief.1')], { encoding: 'utf8' });
  if (manText.status !== 0) throw new Error('build-man failed');
  // (gzip with no name and no time: the same bytes every time)
  put('usr/share/man/man1/databrief.1.gz', zlib.gzipSync(fs.readFileSync(path.join(work, 'databrief.1')), { level: 9 }).fill(0, 4, 8), 0o644);

  // the documentation: copyright (the licenses of the libraries inside the tool are in licenses/), changelog, notices
  const libs = fs.readdirSync(path.join(ROOT, 'vendor')).filter((n) => /^LICENSE-.*\.txt$/.test(n)).sort();
  for (const f of libs) put('usr/share/doc/databrief/licenses/' + f, lf(fs.readFileSync(path.join(ROOT, 'vendor', f), 'utf8')), 0o644);
  put('usr/share/doc/databrief/THIRD-PARTY-NOTICES.md', lf(fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')), 0o644);
  put('usr/share/doc/databrief/copyright', [
    'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
    'Upstream-Name: DataBrief',
    'Upstream-Contact: ' + maintainer,
    'Source: ' + root.homepage,
    '',
    'Files: *',
    'Copyright: ' + new Date(epoch * 1000).getUTCFullYear() + ' Arfo and the DataBrief contributors',
    'License: GPL-3+',
    ' This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as',
    ' published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.',
    ' .',
    ' On Debian systems, the complete text of the GNU General Public License version 3 can be found in',
    ' /usr/share/common-licenses/GPL-3.',
    '',
    'Files: usr/lib/databrief/databrief-cli.cjs',
    'Copyright: ' + new Date(epoch * 1000).getUTCFullYear() + ' Arfo and the DataBrief contributors, and the authors of the libraries bundled in it',
    'License: GPL-3+ and others',
    ' The tool is one file that contains libraries (SheetJS, sql.js, hyparquet, fflate, fzstd, js-yaml, marked, mdb-reader, flechette,',
    ' pdf.js, xmldom, parse5). Each keeps its own license (Apache-2.0, MIT, BSD-3-Clause, all compatible with the GPL); the texts are',
    ' in /usr/share/doc/databrief/licenses/ and the list in /usr/share/doc/databrief/THIRD-PARTY-NOTICES.md.',
    '',
  ].join('\n'), 0o644);
  put('usr/share/doc/databrief/changelog.gz', zlib.gzipSync(Buffer.from([
    'databrief (' + debVersion + ') unstable; urgency=medium',
    '',
    '  * Release ' + version + '. Changes: github.com/Arfo-du-blo/DataBrief/releases',
    '',
    ' -- ' + maintainer + '  ' + new Date(epoch * 1000).toUTCString().replace('GMT', '+0000'),
    '',
  ].join('\n')), { level: 9 }).fill(0, 4, 8), 0o644);

  // size, control file
  let kb = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else kb += Math.ceil(fs.statSync(p).size / 1024); } };
  walk(pkg);
  fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
    'Package: databrief',
    'Version: ' + debVersion,
    'Section: utils',
    'Priority: optional',
    'Architecture: all',
    'Installed-Size: ' + kb,
    'Maintainer: ' + maintainer,
    'Recommends: nodejs',
    'Homepage: ' + root.homepage,
    'Description: turn a data file into a prompt for an AI, offline',
    ' DataBrief reads 29 formats (spreadsheets, CSV, JSON, XML, YAML, HTML,',
    ' SPSS, Parquet, Avro, Arrow, SQLite, SQL dumps, PostgreSQL archives,',
    ' DuckDB exports, SQL Server packages, Access, DBF, GeoJSON, GeoPackage,',
    ' Jupyter notebooks, Word, PowerPoint, OpenDocument, PDF) and writes a',
    ' Markdown prompt that gives an AI assistant the data and its context:',
    ' the structure, the types, the keys and relationships, the metadata.',
    ' .',
    ' With --no-share it describes the file without a single record. It makes',
    ' no network connection. It needs Node.js 18 or newer.',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(pkg, 'DEBIAN'), 0o755);
  fs.chmodSync(path.join(pkg, 'DEBIAN', 'control'), 0o644);

  // every file and folder gets the same time, so that the package is the same every time
  const touch = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) touch(p); fs.utimesSync(p, epoch, epoch); } };
  touch(pkg); fs.utimesSync(pkg, epoch, epoch);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const r = cp.spawnSync('dpkg-deb', ['--root-owner-group', '-Zxz', '--build', pkg, output], { env: Object.assign({}, process.env, { SOURCE_DATE_EPOCH: String(epoch) }), encoding: 'utf8' });
  if (r.status !== 0) throw new Error('dpkg-deb failed: ' + (r.stderr || r.stdout));
  console.log(path.relative(process.cwd(), output) + '  ' + (fs.statSync(output).size / 1048576).toFixed(2) + ' MB  version ' + debVersion);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
