#!/usr/bin/env node
/* Builds the npm package in dist/npm (or the folder given):   node tools/build-npm.cjs [OUTDIR] [--version 1.5.0-rc.1]
 * The package holds the one-file command-line tool (tools/build-cli.cjs) and nothing else of the repository: its manual, the licenses of
 * what is bundled in it, and a short README for the npm page. Stage it from that folder (npm 11.15+):   npm stage publish ./dist/npm --access public
 * (the release workflow does it with provenance; a release candidate is published by hand: --tag next).
 * The root package.json stays private on purpose (so that nothing is ever published from the repository root); the public
 * package.json is written here from its fields. The version is package.json's, or --version (also DATABRIEF_VERSION). */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
let version = process.env.DATABRIEF_VERSION || '';
let outDir = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version') version = args[++i] || '';
  else if (!outDir) outDir = args[i];
  else throw new Error('Unexpected argument: ' + args[i]);
}
outDir = path.resolve(outDir || path.join(ROOT, 'dist', 'npm'));
const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
version = version || root.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('Not a version: ' + version);

// a clean folder: only files this script writes are ever in it (it refuses to reuse a folder holding anything else)
if (fs.existsSync(outDir)) {
  const old = fs.readdirSync(outDir);
  const known = new Set(['package.json', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'databrief-cli.cjs', 'man', 'licenses']);
  if (old.some((n) => !known.has(n) && !/\.tgz$/.test(n))) throw new Error(outDir + ' holds files that are not a previous build of this package: choose another folder');
  for (const n of old) fs.rmSync(path.join(outDir, n), { recursive: true, force: true });
}
fs.mkdirSync(path.join(outDir, 'man'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'licenses'), { recursive: true });

// the tool, at this version
const cliOut = path.join(outDir, 'databrief-cli.cjs');
const b = cp.spawnSync(process.execPath, [path.join(__dirname, 'build-cli.cjs'), cliOut], { env: Object.assign({}, process.env, { DATABRIEF_VERSION: version }), encoding: 'utf8' });
if (b.status !== 0) throw new Error('build-cli failed: ' + (b.stderr || b.stdout));
const man = cp.spawnSync(process.execPath, [path.join(__dirname, 'build-man.cjs'), path.join(outDir, 'man', 'databrief.1')], { encoding: 'utf8' });
if (man.status !== 0) throw new Error('build-man failed: ' + (man.stderr || man.stdout));

const lf = (s) => s.replace(/\r\n?/g, '\n');
fs.writeFileSync(path.join(outDir, 'README.md'), lf(fs.readFileSync(path.join(ROOT, 'packaging', 'npm', 'README.md'), 'utf8')));
fs.writeFileSync(path.join(outDir, 'LICENSE'), lf(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')));
fs.writeFileSync(path.join(outDir, 'THIRD-PARTY-NOTICES.md'), lf(fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')));
for (const f of fs.readdirSync(path.join(ROOT, 'vendor')).filter((n) => /^LICENSE-.*\.txt$/.test(n))) {
  fs.writeFileSync(path.join(outDir, 'licenses', f), lf(fs.readFileSync(path.join(ROOT, 'vendor', f), 'utf8')));
}

const pkg = {
  name: root.name,
  version,
  description: root.description,
  keywords: root.keywords,
  homepage: root.homepage,
  bugs: root.bugs,
  repository: root.repository,
  license: root.license,
  author: root.author,
  bin: { databrief: 'databrief-cli.cjs' },
  man: ['./man/databrief.1'],
  files: ['databrief-cli.cjs', 'man', 'licenses', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
  engines: root.engines,
  publishConfig: { access: 'public' },   // provenance is not set here: it only works from the release workflow (trusted publishing)
};
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(path.relative(process.cwd(), outDir) + '  version ' + version + '  (' + fs.readdirSync(outDir).join(', ') + ')');
