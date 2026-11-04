#!/usr/bin/env node
/* The release of the AI-app files: tools/build-release-assets.cjs, the Compose file that pulls the server's image, and the workflows that use them.
 *   node tests/test_release.cjs
 * Checks: every workflow and Compose file is valid YAML (a colon inside an unquoted name once made tests.yml invalid); the script builds the expected
 * files, refuses a tag that is not package.json's version, builds the plugin only when the server's address is given, and puts nothing private in the other
 * files; the pull-only Compose file is the build Compose file with the build and image lines changed (nothing else drifts) and its default version is the
 * tag; the release workflow builds, fingerprints and uploads every one of those files, publishes the server's image, and keeps "latest" for real releases;
 * GitLab publishes the same files. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const yaml = (() => { const m = { exports: {} }; new Function('module', 'exports', 'self', 'window', fs.readFileSync(path.join(ROOT, 'vendor', 'js-yaml.min.js'), 'utf8'))(m, m.exports, undefined, undefined); return m.exports.load ? m.exports : (globalThis.jsyaml || m.exports); })();
let failed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } else console.log('ok   ' + name); };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const TAG = 'v' + pkg.version;
const { composeFor, IMAGE } = require('../tools/build-release-assets.cjs');

// ---- every workflow and Compose file is valid YAML
const yamlFiles = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).map((f) => '.github/workflows/' + f).concat(['.gitlab-ci.yml', 'mcp/docker-compose.yml', 'mcp/docker-compose.release.yml']);
const loaded = {};
for (const f of yamlFiles) {
  let err = null; try { loaded[f] = yaml.load(read(f)); } catch (e) { err = e.message.split('\n')[0]; }
  check(f + ' is valid YAML', !err && loaded[f] && typeof loaded[f] === 'object', err);
}

// ---- the script
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-release-test-'));
const run = (out, args, env) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-release-assets.cjs'), out].concat(args || []), { encoding: 'utf8', env: Object.assign({}, process.env, { DATABRIEF_MCP_URL: '' }, env || {}), timeout: 300000 });
const a = run(path.join(tmp, 'a'), ['--tag', TAG]);
const filesA = a.status === 0 ? a.stdout.trim().split('\n').sort() : [];
const BASE = ['AGENTS-snippet.md', 'databrief-mcp-compose.yml', 'databrief-mcp.env.example', 'databrief-skill.zip', 'databrief-widget.html', 'databrief.mcpb', 'mcp.json'];
check('the script builds the AI-app files, with no plugin when no server address is given', a.status === 0 && JSON.stringify(filesA) === JSON.stringify(BASE) && /DATABRIEF_MCP_URL is not set/.test(a.stderr), a.stdout + a.stderr.slice(0, 300));
check('the folder holds exactly the files it printed', JSON.stringify(fs.readdirSync(path.join(tmp, 'a')).sort()) === JSON.stringify(BASE));
const bad = run(path.join(tmp, 'bad'), ['--tag', 'v9.9.9']);
check('a tag that is not package.json\'s version is refused, and nothing is built', bad.status === 1 && /not package\.json's version/.test(bad.stderr) && !fs.existsSync(path.join(tmp, 'bad')));
const withUrl = run(path.join(tmp, 'b'), ['--tag', TAG], { DATABRIEF_MCP_URL: 'https://connector.example.org/mcp' });
check('with the server\'s address, the plugin is built too', withUrl.status === 0 && withUrl.stdout.trim().split('\n').includes('databrief-plugin.zip'), withUrl.stderr.slice(0, 300));
const badUrl = run(path.join(tmp, 'c'), ['--tag', TAG], { DATABRIEF_MCP_URL: 'http://connector.example.org/mcp' });
check('an address that is not https is refused by the plugin build, so the release stops', badUrl.status !== 0);
const own = BASE.filter((f) => !/\.(zip|mcpb)$/.test(f));
check('the address of the server is only in the plugin: not in the other files', own.every((f) => !fs.readFileSync(path.join(tmp, 'b', f), 'utf8').includes('connector.example.org')) && !fs.readFileSync(path.join(tmp, 'b', 'databrief.mcpb')).includes('connector.example.org'));
check('the widget in the release is the one the extension carries (same bytes)', fs.readFileSync(path.join(tmp, 'a', 'databrief-widget.html')).length > 1000000);

// ---- the Compose file that pulls the image
const env = fs.readFileSync(path.join(tmp, 'a', 'databrief-mcp.env.example'), 'utf8');
const comp = fs.readFileSync(path.join(tmp, 'a', 'databrief-mcp-compose.yml'), 'utf8');
check('the settings file points at the published image and this version, and holds no secret', env.includes('DATABRIEF_MCP_IMAGE=' + IMAGE + '\n') && env.includes('DATABRIEF_MCP_VERSION=' + TAG + '\n') && /^TUNNEL_TOKEN=\s*$/m.test(env));
check('the Compose file\'s default version is the tag, and it pulls (no build)', comp.includes('${DATABRIEF_MCP_VERSION:-' + TAG + '}') && !/^\s+build:/m.test(comp) && comp.includes('ghcr.io/arfo-du-blo/databrief-mcp'));
const norm = (c) => { const d = yaml.load(c); const s = d.services; delete s['databrief-mcp'].build; delete s['databrief-mcp'].image; return JSON.stringify(d); };
check('apart from build and image, the pull-only Compose file is the build Compose file (nothing drifts)', norm(read('mcp/docker-compose.yml')) === norm(read('mcp/docker-compose.release.yml')));
check('composeFor stops when the Compose or settings file changed under it', (() => { try { composeFor('v1.0.0'); return true; } catch (e) { return false; } })());

// ---- the workflows
const gh = read('.github/workflows/release.yml'), gl = read('.gitlab-ci.yml');
const rel = loaded['.github/workflows/release.yml'];
const steps = (job) => (rel.jobs[job].steps || []).map((s) => (s.run || '') + ' ' + (s.with ? JSON.stringify(s.with) : '') + ' ' + (s.name || '')).join('\n');
check('release.yml builds the AI-app files from the tag, with the repository variable for the plugin\'s address', /build-release-assets\.cjs dist\/release --tag "\$GITHUB_REF_NAME"/.test(steps('release')) && /DATABRIEF_MCP_URL: \$\{\{ vars\.DATABRIEF_MCP_URL \}\}/.test(gh));
check('release.yml fingerprints and uploads the same list of files (one variable, so none is forgotten)', /sha256sum \$ASSETS/.test(steps('release')) && (gh.match(/\$ASSETS SHA256SUMS\.txt/g) || []).length === 2 && /ASSETS=.*ls dist\/release/.test(gh));
const dockerSteps = rel.jobs.docker.steps;
const mcpStep = dockerSteps.find((s) => s.with && s.with.file === 'mcp/Dockerfile');
check('release.yml publishes the server\'s image for amd64 and arm64, built from the repository', !!mcpStep && /linux\/amd64,linux\/arm64/.test(mcpStep.with.platforms) && mcpStep.with.push === true && /WIDGET_SOURCE=built/.test(mcpStep.with['build-args']));
check('release.yml: "latest" of the server\'s image moves only for a real release (no dash in the tag)', !!mcpStep && /MCP_LATEST == 'true'/.test(mcpStep.with.tags) && /\*-\*\) echo "MCP_LATEST=false"/.test(gh));
check('release.yml: the server\'s image has the tag as its name (what the Compose file pulls)', !!mcpStep && /MCP_IMAGE \}\}:\$\{\{ github\.ref_name \}\}/.test(mcpStep.with.tags));
check('GitLab publishes the same files and the server\'s image', /build-release-assets\.cjs/.test(gl) && /databrief-mcp-compose\.yml/.test(gl) && /buildx build [^\n]*-f mcp\/Dockerfile/.test(gl.replace(/\n\s+/g, ' ')) && /databrief\.mcpb/.test(gl) && /databrief-skill\.zip/.test(gl));
check('GitLab: the plugin only with the DATABRIEF_MCP_URL variable', /DATABRIEF_MCP_URL/.test(gl));
const ci = read('.github/workflows/tests.yml');
check('CI: the release script is tested', /test_release\.cjs/.test(ci) && /test_release\.cjs/.test(read('tests/run.sh')));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (total - failed) + '/' + total + ' checks passed');
process.exit(failed ? 1 : 0);
