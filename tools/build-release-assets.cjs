#!/usr/bin/env node
/* Builds the AI-app files of a release into one folder (both CI systems call this, so they publish the same set):
 *   node tools/build-release-assets.cjs [OUTDIR] [--tag vX.Y.Z]
 *     databrief-widget.html        the page with the widget layer (tools/build-widget.cjs)
 *     databrief.mcpb               the Claude Desktop extension (tools/build-mcpb.cjs)
 *     databrief-skill.zip          the skill for AI agents (tools/build-agents.cjs)
 *     AGENTS-snippet.md, mcp.json  the paste-in text and the `databrief --mcp` configuration
 *     databrief-plugin.zip         the Claude plugin, ONLY when DATABRIEF_MCP_URL is set (https://HOST/mcp: the address of the connector server;
 *                                  it is given here and is not in the repository)
 *     databrief-mcp-compose.yml    Docker Compose for the hosted server from the published image, with this version as its default
 *     databrief-mcp.env.example    the settings file for it, pointing at the same image and version
 * It stops when the tag is not package.json's version (the files carry that version). The folder holds only the files; it prints their names, one per line.
 * databrief.html must exist (build.ps1 writes it; it is committed). */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const IMAGE = 'ghcr.io/arfo-du-blo/databrief-mcp';

function composeFor(tag) {
  const lf = (s) => s.replace(/\r\n/g, '\n');
  const once = (s, from, to, what) => { if (s.split(from).length !== 2) throw new Error('mcp/ changed: "' + what + '" is not there exactly once'); return s.replace(from, () => to); };
  let compose = lf(fs.readFileSync(path.join(ROOT, 'mcp', 'docker-compose.release.yml'), 'utf8'));
  compose = once(compose, '${DATABRIEF_MCP_VERSION:-latest}', '${DATABRIEF_MCP_VERSION:-' + tag + '}', 'the default version of the image');
  let env = lf(fs.readFileSync(path.join(ROOT, 'mcp', '.env.example'), 'utf8'));
  env = once(env, 'DATABRIEF_MCP_IMAGE=databrief-mcp\n', 'DATABRIEF_MCP_IMAGE=' + IMAGE + '\n', 'the image name');
  env = once(env, 'DATABRIEF_MCP_VERSION=local\n', 'DATABRIEF_MCP_VERSION=' + tag + '\n', 'the image version');
  return { compose, env };
}

function main() {
  const args = process.argv.slice(2);
  const ti = args.indexOf('--tag');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const tag = ti >= 0 ? args[ti + 1] : 'v' + pkg.version;
  if (tag !== 'v' + pkg.version) { console.error('The tag ' + tag + ' is not package.json\'s version (v' + pkg.version + '): the files would say another version.'); process.exit(1); }
  const rest = args.filter((a, i) => ti < 0 || (i !== ti && i !== ti + 1));
  const out = path.resolve(rest[0] || path.join(ROOT, 'dist', 'release'));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const node = (script, a) => execFileSync(process.execPath, [path.join(__dirname, script)].concat(a), { stdio: ['ignore', 'ignore', 'inherit'] });
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'databrief-release-'));
  try {
    node('build-widget.cjs', [path.join(out, 'databrief-widget.html')]);
    node('build-mcpb.cjs', [path.join(out, 'databrief.mcpb')]);
    node('build-agents.cjs', [tmp]);
    for (const f of ['databrief-skill.zip', 'AGENTS-snippet.md', 'mcp.json']) fs.copyFileSync(path.join(tmp, f), path.join(out, f));
    const url = (process.env.DATABRIEF_MCP_URL || '').trim();
    if (url) {
      node('build-plugin.cjs', ['--url', url, tmp]);
      fs.copyFileSync(path.join(tmp, 'databrief-plugin.zip'), path.join(out, 'databrief-plugin.zip'));
    } else console.error('DATABRIEF_MCP_URL is not set: no plugin in this release (it needs the address of the connector server).');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const c = composeFor(tag);
  fs.writeFileSync(path.join(out, 'databrief-mcp-compose.yml'), c.compose);
  fs.writeFileSync(path.join(out, 'databrief-mcp.env.example'), c.env);
  for (const f of fs.readdirSync(out).sort()) console.log(f);
}

if (require.main === module) main();
module.exports = { composeFor, IMAGE };
