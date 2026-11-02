#!/usr/bin/env node
/* Writes the Homebrew formula and the Scoop manifest for a release, from packaging/:
 *   node tools/update-packages.cjs --version 1.5.0 --cli-sha SHA256 --man-sha SHA256 [--tap DIR] [--bucket DIR]
 *   node tools/update-packages.cjs --skeleton [--tap DIR] [--bucket DIR]     only the READMEs and the tap's workflow (the first push)
 * DIR is a clone of Arfo-du-blo/homebrew-databrief (gets Formula/databrief.rb, README.md, .github/workflows/test.yml) and of
 * Arfo-du-blo/scoop-databrief (gets bucket/databrief.json, README.md). The release workflow runs it after the GitHub release
 * exists, with the fingerprints of the files it published; it prints what changed and never touches anything else.
 * Exit code 0 also when nothing changed. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skeleton') { opt.skeleton = true; continue; }
  if (!/^--(version|cli-sha|man-sha|tap|bucket)$/.test(args[i]) || i + 1 >= args.length) throw new Error('Unknown or incomplete argument: ' + args[i]);
  opt[args[i].slice(2)] = args[++i];
}
const need = (k) => { if (!opt[k]) throw new Error('--' + k + ' is required'); return opt[k]; };
if (!opt.tap && !opt.bucket) throw new Error('give --tap and/or --bucket');
let version = '', cliSha = '', manSha = '';
if (!opt.skeleton) {
  version = need('version'); cliSha = need('cli-sha').toLowerCase(); manSha = need('man-sha').toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A release version (no pre-release): ' + version);
  for (const [k, v] of [['cli-sha', cliSha], ['man-sha', manSha]]) if (!/^[0-9a-f]{64}$/.test(v)) throw new Error('--' + k + ' is not a SHA-256: ' + v);
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');
const fill = (tpl) => tpl.replace(/@VERSION@/g, version).replace(/@CLI_SHA256@/g, cliSha).replace(/@MAN_SHA256@/g, manSha);
const write = (dir, rel, text) => {
  const f = path.join(path.resolve(dir), rel);
  if (/@[A-Z0-9_]+@/.test(text)) throw new Error('A placeholder is left in ' + rel);
  const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  if (old === text) { console.log('unchanged ' + rel); return; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  console.log((old === null ? 'created   ' : 'updated   ') + rel);
};

if (opt.tap) {
  if (!opt.skeleton) write(opt.tap, 'Formula/databrief.rb', fill(read('packaging/homebrew/databrief.rb.tpl')));
  write(opt.tap, 'README.md', read('packaging/homebrew/README.md'));
  write(opt.tap, '.github/workflows/test.yml', read('packaging/homebrew/test.yml'));
}
if (opt.bucket) {
  if (!opt.skeleton) {
    const json = fill(read('packaging/scoop/databrief.json.tpl'));
    JSON.parse(json);   // a manifest that is not valid JSON must never be published
    write(opt.bucket, 'bucket/databrief.json', json);
  }
  write(opt.bucket, 'README.md', read('packaging/scoop/README.md'));
}
