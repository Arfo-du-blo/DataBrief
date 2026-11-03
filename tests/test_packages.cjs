#!/usr/bin/env node
/* The packages of the command-line tool, built from the sources and looked at: the npm package, the Debian / Ubuntu package, the
 * Homebrew formula and the Scoop manifest, and the release workflow that publishes them.   node tests/test_packages.cjs
 * (what needs Linux, npm or dpkg-deb is skipped, and said, where it is missing; the installs in clean Ubuntu and Debian systems are
 *  tests/test_packages.sh, with Docker.) DATABRIEF_ROOT: another copy of the repository (to check that these tests catch a change). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = process.env.DATABRIEF_ROOT || path.join(__dirname, '..');
let pass = 0, fail = 0, skipped = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 700) : '')); } };
const skip = (name, why) => { skipped++; console.log('SKIP ' + name + ' (' + why + ')'); };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-packages-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const run = (file, args, opt) => cp.spawnSync(file, args, Object.assign({ encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 28 }, opt || {}));
const node = (script, args, env) => run(process.execPath, [path.join(ROOT, 'tools', script)].concat(args), { env: Object.assign({}, process.env, env || {}) });
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const V = rootPkg.version;
const NOREPLY = '75902371+Arfo-du-blo@users.noreply.github.com';
const npmBin = [path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm')].find((p) => fs.existsSync(p));

/* ---------------------------------------------------------------- 1. the npm package ---------- */
{
  const dir = path.join(tmpRoot, 'npm');
  const b = node('build-npm.cjs', [dir]);
  ok('npm: the package folder is built', b.status === 0 && fs.existsSync(path.join(dir, 'package.json')), b.stderr);
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  ok('npm: name, version, license, engines, repository', p.name === 'databrief' && p.version === V && p.license === 'GPL-3.0-or-later' && p.engines.node === '>=18' && /Arfo-du-blo\/DataBrief/.test(p.repository.url) && !p.private, JSON.stringify(p).slice(0, 300));
  ok('npm: the author is the noreply address, no other e-mail anywhere in the package files', p.author.includes(NOREPLY) && !fs.readdirSync(dir).filter((n) => /\.(json|md)$/.test(n)).some((n) => /arfo_dublo@|@boards\.digital/.test(fs.readFileSync(path.join(dir, n), 'utf8'))));
  ok('npm: bin, man and files', p.bin.databrief === 'databrief-cli.cjs' && p.man[0] === './man/databrief.1' && p.files.includes('databrief-cli.cjs') && p.files.includes('licenses'), JSON.stringify([p.bin, p.man, p.files]));
  ok('npm: no scripts (nothing runs at install), no dependencies', !p.scripts && !p.dependencies && !p.devDependencies && !p.optionalDependencies && !p.peerDependencies);
  ok('npm: provenance is not forced by the package (it only works from the release workflow)', !(p.publishConfig && p.publishConfig.provenance));
  const cli = fs.readFileSync(path.join(dir, 'databrief-cli.cjs'));
  const ref = path.join(tmpRoot, 'ref-cli.cjs');
  node('build-cli.cjs', [ref]);
  ok('npm: the tool in the package is byte for byte the one of the release (same build)', cli.equals(fs.readFileSync(ref)) && cli.toString('utf8', 0, 20).startsWith('#!/usr/bin/env node'));
  ok('npm: the licenses of the bundled libraries and the notices are in it', ['fflate', 'flechette', 'parse5', 'pdfjs', 'sheetjs', 'sqljs', 'xmldom'].every((n) => fs.existsSync(path.join(dir, 'licenses', 'LICENSE-' + n + '.txt'))) && fs.existsSync(path.join(dir, 'THIRD-PARTY-NOTICES.md')) && fs.existsSync(path.join(dir, 'LICENSE')));
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  ok('npm: the README says what it is, the privacy limit and links the guide', /29 formats/.test(readme) && /can often read the file itself/.test(readme) && /docs\/cli\.md/.test(readme) && /npx databrief/.test(readme));
  const rc = path.join(tmpRoot, 'npm-rc');
  const r = node('build-npm.cjs', [rc, '--version', '1.5.0-rc.1']);
  const rcv = run(process.execPath, [path.join(rc, 'databrief-cli.cjs'), '--version']);
  ok('npm: a release candidate says its own version in package.json and in the tool', r.status === 0 && JSON.parse(fs.readFileSync(path.join(rc, 'package.json'), 'utf8')).version === '1.5.0-rc.1' && rcv.stdout === 'databrief 1.5.0-rc.1\n', rcv.stdout + r.stderr);
  ok('npm: a version that is not one is refused', node('build-npm.cjs', [path.join(tmpRoot, 'x'), '--version', '1.5']).status !== 0 && node('build-npm.cjs', [path.join(tmpRoot, 'x'), '--version', '1.5.0; rm -rf /']).status !== 0);
  const foreign = path.join(tmpRoot, 'foreign');
  fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'precious.txt'), 'keep me');
  ok('npm: a folder that holds other files is never cleaned', node('build-npm.cjs', [foreign]).status !== 0 && fs.existsSync(path.join(foreign, 'precious.txt')));

  if (!npmBin) skip('npm: pack, install and run', 'no npm next to this Node');
  else {
    const pack = run(npmBin, ['pack', '--pack-destination', tmpRoot], { cwd: dir, shell: process.platform === 'win32' });
    const tgz = path.join(tmpRoot, 'databrief-' + V + '.tgz');
    ok('npm: npm pack makes the tarball (' + (fs.existsSync(tgz) ? (fs.statSync(tgz).size / 1048576).toFixed(1) + ' MB' : 'none') + ')', pack.status === 0 && fs.existsSync(tgz), pack.stderr);
    const prefix = path.join(tmpRoot, 'prefix');
    const inst = run(npmBin, ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tgz], { shell: process.platform === 'win32', env: Object.assign({}, process.env, { npm_config_update_notifier: 'false' }) });
    const bin = process.platform === 'win32' ? path.join(prefix, 'databrief.cmd') : path.join(prefix, 'bin', 'databrief');
    ok('npm: the tarball installs globally and the databrief command exists', inst.status === 0 && fs.existsSync(bin), inst.stderr || inst.stdout);
    if (fs.existsSync(bin)) {
      const env = Object.assign({}, process.env, { PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '') });
      const v = run(bin, ['--version'], { env, shell: process.platform === 'win32' });
      ok('npm: the installed command runs (--version)', v.stdout === 'databrief ' + V + '\n', v.stdout + v.stderr);
      const csv = path.join(tmpRoot, 'people.csv');
      fs.writeFileSync(csv, 'name,amount\nZelda,12\nBo,8\n');   // (not "Ana": the Do-not-share-data prompt says "Analysis")
      const ns = run(bin, [csv, '--print', '--no-copy', '--quiet', '--no-share'], { env, shell: process.platform === 'win32' });
      ok('npm: the installed command builds a Do-not-share-data prompt from a file', ns.status === 0 && /data not shared/.test(ns.stdout) && !/Zelda/.test(ns.stdout), ns.stdout.slice(0, 200) + ns.stderr);
    }
    if (process.platform !== 'win32') {
      const manLink = path.join(prefix, 'share', 'man', 'man1', 'databrief.1');
      ok('npm: a global install links the manual page (man databrief)', fs.existsSync(manLink), manLink);
    }
  }
}

/* ---------------------------------------------------------------- 2. the Homebrew formula and the Scoop manifest ---------- */
{
  const tap = path.join(tmpRoot, 'tap'), bucket = path.join(tmpRoot, 'bucket');
  const CLI = 'a'.repeat(64), MAN = 'b'.repeat(64);
  const u = (extra) => node('update-packages.cjs', ['--version', V, '--cli-sha', CLI, '--man-sha', MAN, '--tap', tap, '--bucket', bucket].concat(extra || []));
  const first = u();
  ok('recipes: the formula and the manifest are written', first.status === 0 && fs.existsSync(path.join(tap, 'Formula', 'databrief.rb')) && fs.existsSync(path.join(bucket, 'bucket', 'databrief.json')), first.stderr + first.stdout);
  const rb = fs.readFileSync(path.join(tap, 'Formula', 'databrief.rb'), 'utf8');
  ok('formula: the release file and the manual, each with its SHA-256; the version is in the URL', rb.includes('releases/download/v' + V + '/databrief-cli.cjs"') && rb.includes('sha256 "' + CLI + '"') && rb.includes('releases/download/v' + V + '/databrief.1"') && rb.includes('sha256 "' + MAN + '"') && !/@[A-Z0-9_]+@/.test(rb) && !/^\s*version /m.test(rb), rb.slice(0, 500));
  ok('formula: depends on Homebrew\'s node, GPL license, runs the file with that node, installs the manual', /depends_on "node"/.test(rb) && /license "GPL-3\.0-or-later"/.test(rb) && /Formula\["node"\]\.opt_bin/.test(rb) && /man1\.install "databrief\.1"/.test(rb));
  ok('formula: its test checks the version, a normal prompt and a Do-not-share-data prompt with no record', /databrief #\{version\}/.test(rb) && /--no-share/.test(rb) && /refute_match "Zelda"/.test(rb));
  const ruby = run('ruby', ['-c', path.join(tap, 'Formula', 'databrief.rb')]);
  if (ruby.error) skip('formula: Ruby syntax', 'ruby is not installed here; the tap\'s own workflow runs brew audit, install and test on macOS and Linux');
  else ok('formula: Ruby syntax', ruby.status === 0, ruby.stdout + ruby.stderr);
  const json = fs.readFileSync(path.join(bucket, 'bucket', 'databrief.json'), 'utf8');
  let m = null;
  try { m = JSON.parse(json); } catch (e) { /* reported below */ }
  ok('manifest: valid JSON, the version, the release file with its SHA-256, Node as a dependency', !!m && m.version === V && m.url.endsWith('/v' + V + '/databrief-cli.cjs') && m.hash === CLI && m.depends === 'nodejs-lts' && m.license === 'GPL-3.0-or-later', json.slice(0, 300));
  ok('manifest: a launcher for the .cjs file (Scoop shims programs, not scripts), and the update rules', !!m && m.bin === 'databrief.cmd' && /databrief\.cmd/.test(m.pre_install.join('\n')) && m.checkver === 'github' && /\$version/.test(m.autoupdate.url) && /SHA256SUMS\.txt/.test(m.autoupdate.hash.url));
  if (process.platform === 'win32' && m) {
    const dir = path.join(tmpRoot, 'scoopdir');
    fs.mkdirSync(dir);
    const script = '$dir = ' + JSON.stringify(dir) + "\n" + m.pre_install.filter((l) => !l.startsWith('#')).join('\n');
    const ps = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const cmd = fs.existsSync(path.join(dir, 'databrief.cmd')) ? fs.readFileSync(path.join(dir, 'databrief.cmd'), 'latin1') : '';
    ok('manifest: its pre_install writes the launcher (run here with PowerShell)', ps.status === 0 && cmd === '@echo off\r\nnode "%~dp0databrief-cli.cjs" %*\r\n', JSON.stringify(cmd) + ps.stderr);
  } else skip('manifest: the launcher script run in PowerShell', 'Windows only');
  const again = u();
  ok('recipes: running it again changes nothing', /unchanged +Formula\/databrief\.rb/.test(again.stdout) && /unchanged +bucket\/databrief\.json/.test(again.stdout) && !/created|updated/.test(again.stdout), again.stdout);
  const next = node('update-packages.cjs', ['--version', '1.5.1', '--cli-sha', 'c'.repeat(64), '--man-sha', MAN, '--tap', tap]);
  ok('recipes: a new release updates the formula in place', /updated +Formula\/databrief\.rb/.test(next.stdout) && fs.readFileSync(path.join(tap, 'Formula', 'databrief.rb'), 'utf8').includes('v1.5.1/databrief-cli.cjs'));
  const bad = [['--version', '1.5.0-rc.1'], ['--version', '1.5'], ['--cli-sha', 'xyz'], ['--man-sha', 'A'.repeat(63)], ['--version', '1.5.0; touch x']];
  const refused = bad.map((b) => node('update-packages.cjs', ['--version', V, '--cli-sha', CLI, '--man-sha', MAN, '--tap', path.join(tmpRoot, 't2')].concat(b)).status);
  ok('recipes: a release candidate, a bad version and a bad fingerprint are refused, and nothing is written for them', refused.every((s) => s !== 0) && !fs.existsSync(path.join(tmpRoot, 't2')), refused.join());
  const sk1 = path.join(tmpRoot, 'sk-tap'), sk2 = path.join(tmpRoot, 'sk-bucket');
  const sk = node('update-packages.cjs', ['--skeleton', '--tap', sk1, '--bucket', sk2]);
  ok('recipes: the skeleton (the first push) is the READMEs and the tap\'s workflow, no formula and no manifest, and the workflow waits for a formula', sk.status === 0 && fs.existsSync(path.join(sk1, 'README.md')) && fs.existsSync(path.join(sk1, '.github', 'workflows', 'test.yml')) && fs.existsSync(path.join(sk2, 'README.md')) &&
    !fs.existsSync(path.join(sk1, 'Formula')) && !fs.existsSync(path.join(sk2, 'bucket')) && /paths: \['Formula\/\*\*'\]/.test(fs.readFileSync(path.join(sk1, '.github', 'workflows', 'test.yml'), 'utf8')), sk.stderr + sk.stdout);
  ok('recipes: the tap gets its README and its own workflow (audit, install, test on macOS and Linux)', fs.existsSync(path.join(tap, 'README.md')) && /brew audit --strict/.test(fs.readFileSync(path.join(tap, '.github', 'workflows', 'test.yml'), 'utf8')) && /macos-latest/.test(fs.readFileSync(path.join(tap, '.github', 'workflows', 'test.yml'), 'utf8')));
}

/* ---------------------------------------------------------------- 3. the Debian / Ubuntu package ---------- */
{
  const have = process.platform !== 'win32' && run('dpkg-deb', ['--version']).status === 0;
  if (!have) skip('deb: the package', 'needs Linux with dpkg-deb');
  else {
    const out = path.join(tmpRoot, 'a.deb'), out2 = path.join(tmpRoot, 'b.deb');
    const env = { SOURCE_DATE_EPOCH: '1767225600' };
    const b = node('build-deb.cjs', [out], env), b2 = node('build-deb.cjs', [out2], env);
    ok('deb: the package is built', b.status === 0 && fs.existsSync(out), b.stderr);
    ok('deb: reproducible (two builds, the same bytes)', b2.status === 0 && sha(fs.readFileSync(out)) === sha(fs.readFileSync(out2)));
    const info = run('dpkg-deb', ['-f', out]).stdout;
    const f = (k) => ((new RegExp('^' + k + ': (.*)$', 'm')).exec(info) || [])[1];
    ok('deb: Package, Version, Architecture all, the noreply Maintainer, Node Recommended (not required)', f('Package') === 'databrief' && f('Version') === V && f('Architecture') === 'all' && f('Maintainer') === 'Arfo <' + NOREPLY + '>' && f('Recommends') === 'nodejs' && !f('Depends'), info);
    const list = run('dpkg-deb', ['-c', out]).stdout.split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/));
    const files = list.filter((l) => l[0][0] === '-').map((l) => l[l.length - 1].replace(/^\.\//, ''));
    ok('deb: exactly the expected files, the launcher executable, owned by root', files.includes('usr/bin/databrief') && files.includes('usr/lib/databrief/databrief-cli.cjs') && files.includes('usr/share/man/man1/databrief.1.gz') && files.includes('usr/share/doc/databrief/copyright') && files.includes('usr/share/doc/databrief/changelog.gz') &&
      files.every((n) => /^usr\/(bin|lib|share)\//.test(n)) && list.filter((l) => l[0][0] === '-').every((l) => l[1] === 'root/root') && /^-rwxr-xr-x/.test(list.find((l) => l[l.length - 1].endsWith('usr/bin/databrief'))[0]) && !files.some((n) => /\.(sh|py|ps1)$/.test(n)), files.join(' '));
    const x = path.join(tmpRoot, 'debx');
    run('dpkg-deb', ['-x', out, x]);
    const launcher = fs.readFileSync(path.join(x, 'usr', 'bin', 'databrief'), 'utf8');
    ok('deb: the launcher runs node or nodejs, and says how to get Node when there is none (exit 127)', launcher.startsWith('#!/bin/sh\n') && /for n in node nodejs/.test(launcher) && /exec "\$n" \/usr\/lib\/databrief\/databrief-cli\.cjs "\$@"/.test(launcher) && /exit 127/.test(launcher) && /sudo apt install nodejs/.test(launcher));
    const man = zlib.gunzipSync(fs.readFileSync(path.join(x, 'usr', 'share', 'man', 'man1', 'databrief.1.gz'))).toString();
    ok('deb: the manual is the committed one', man === fs.readFileSync(path.join(ROOT, 'man', 'databrief.1'), 'utf8').replace(/\r\n/g, '\n'));
    ok('deb: the tool is the release file; copyright names the GPL and the bundled libraries; the licenses are there', sha(fs.readFileSync(path.join(x, 'usr', 'lib', 'databrief', 'databrief-cli.cjs'))) === sha(fs.readFileSync(path.join(tmpRoot, 'ref-cli.cjs'))) &&
      /License: GPL-3\+/.test(fs.readFileSync(path.join(x, 'usr', 'share', 'doc', 'databrief', 'copyright'), 'utf8')) && fs.readdirSync(path.join(x, 'usr', 'share', 'doc', 'databrief', 'licenses')).length >= 10);
    const rcDeb = path.join(tmpRoot, 'rc.deb');
    const r = node('build-deb.cjs', [rcDeb, '--version', '1.5.0-rc.1'], env);
    ok('deb: a release candidate is 1.5.0~rc.1 (it sorts before 1.5.0)', r.status === 0 && /^Version: 1\.5\.0~rc\.1$/m.test(run('dpkg-deb', ['-f', rcDeb]).stdout) && run('dpkg', ['--compare-versions', '1.5.0~rc.1', 'lt', '1.5.0']).status === 0);
  }
}

/* ---------------------------------------------------------------- 4. the release workflow ---------- */
{
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
  const jobs = (wf.match(/^  ([a-z-]+):$/gm) || []).map((s) => s.trim().replace(':', ''));
  const job = (n) => { const i = wf.indexOf('\n  ' + n + ':\n'); if (i < 0) return ''; const rest = wf.slice(i + 1); const m = /\n  [a-z-]+:\n/.exec(rest.slice(5)); return m ? rest.slice(0, m.index + 5) : rest; };
  ok('release.yml: jobs release, npm and packages', ['release', 'npm', 'packages'].every((j) => jobs.includes(j)), jobs.join());
  ok('release.yml: the release job builds the tool, the manual and the .deb and publishes them with their fingerprints', /build-deb\.cjs/.test(job('release')) && /sha256sum databrief\.html databrief_set_default\.html databrief-cli\.cjs databrief\.1 databrief_\S+\.deb/.test(job('release')) && /gh release create[\s\S]*\.deb/.test(job('release')));
  ok('release.yml: npm is STAGED with provenance from the workflow (trusted publishing: id-token, no token, no direct publish), approved by the owner, and not twice', /id-token: write/.test(job('npm')) && /npm stage publish .*--provenance/.test(job('npm')) && !/npm publish/.test(job('npm')) && !/NPM_TOKEN|NODE_AUTH_TOKEN/.test(wf) && /needs: release/.test(job('npm')) && /npm view/.test(job('npm')) && /npm@\^11\.15/.test(job('npm')) && /npm stage approve/.test(job('npm')));
  ok('release.yml: a pre-release tag goes to the "next" tag of npm, never "latest"', /\*-\*\) TAG=next/.test(job('npm')) && /--tag "\$TAG"/.test(job('npm')));
  ok('release.yml: the recipes job needs the release, uses PACKAGES_TOKEN only for the two small repositories, and checks the fingerprints of what it downloaded', /needs: release/.test(job('packages')) && /PACKAGES_TOKEN/.test(job('packages')) && /sha256sum -c/.test(job('packages')) && /homebrew-databrief/.test(job('packages')) && /scoop-databrief/.test(job('packages')) && !/PACKAGES_TOKEN/.test(job('release')) && !/PACKAGES_TOKEN/.test(job('npm')));
  ok('release.yml: no permission wider than needed (contents: write only in the release job)', !/contents: write/.test(job('npm')) && !/contents: write/.test(job('packages')));
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed` + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(fail ? 1 : 0);
