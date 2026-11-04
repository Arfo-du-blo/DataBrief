#!/usr/bin/env node
/* Builds the Claude plugin: the skill (with the offline tool), the DataBrief connector (a hosted MCP server) and a slash command.
 *   node tools/build-plugin.cjs --url https://YOUR-HOST/mcp [OUTPUT_DIR]        (default dist/plugin)
 *   (or DATABRIEF_MCP_URL=https://YOUR-HOST/mcp)
 * The address of the hosted server is NOT in the repository: it is given here, when the plugin is built for a release. It must be https, end with /mcp, hold no
 * login, query or fragment (every person who installs the plugin receives .mcp.json).
 * OUTPUT_DIR/databrief-plugin.zip   upload it in Claude: Customize, Plugins, Add, Upload plugin; or use it as a Claude Code plugin folder (--plugin-dir)
 * OUTPUT_DIR/databrief-plugin/      the same, unzipped
 * Layout (the folder is the zip's single top-level entry): .claude-plugin/plugin.json, .mcp.json, skills/databrief/{SKILL.md, scripts/databrief.cjs},
 * commands/databrief.md, README.md, LICENSE. NO top-level bin/ (it stops claude.ai and Cowork from installing a plugin).
 * Reproducible: same sources and address, same bytes (tests/test_plugin.cjs). */
'use strict';
const fs = require('fs');
const path = require('path');
const { zip } = require('./build-mcpb.cjs');
const { files: agentFiles } = require('./build-agents.cjs');

const ROOT = path.join(__dirname, '..');
const lf = (s) => s.replace(/\r\n?/g, '\n');

function checkUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { throw new Error('The address of the hosted server is not a URL: ' + url); }
  if (u.protocol !== 'https:') throw new Error('The address of the hosted server must be https');
  if (u.username || u.password || u.search || u.hash) throw new Error('The address must hold no login, query or fragment');
  if (u.pathname !== '/mcp') throw new Error('The address must end with /mcp (the server answers there)');
  return u;
}

function build(url) {
  const u = checkUrl(url);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const text = (p) => lf(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const fill = (s) => s.split('{{VERSION}}').join(pkg.version).split('{{MCP_URL}}').join(u.href).split('{{MCP_HOST}}').join(u.host);
  const replaceOnce = (s, from, to, what) => { if (!s.includes(from)) throw new Error('agents/skill/SKILL.md changed: "' + what + '" is not there any more (tools/build-plugin.cjs adapts it)'); return s.replace(from, () => to); };

  // the plugin's skill = the standalone skill, with the script addressed by ${CLAUDE_SKILL_DIR} and the connector's section before the rules
  let skill = fill(text('agents/skill/SKILL.md'));
  skill = replaceOnce(skill, 'The script `scripts/databrief.cjs` is in this skill\'s folder, next to this file. It needs Node.js 18 or newer. Use its full path.', 'The script `scripts/databrief.cjs` is in this skill\'s folder (`${CLAUDE_SKILL_DIR}`). It needs Node.js 18 or newer.', 'the sentence about the script');
  skill = replaceOnce(skill, 'node <skill folder>/scripts/databrief.cjs --json', 'node ${CLAUDE_SKILL_DIR}/scripts/databrief.cjs --json', 'the command');
  skill = replaceOnce(skill, '\n## Rules\n', '\n' + fill(text('agents/plugin/connector-section.md')) + '\n## Rules\n', 'the Rules heading');
  const script = agentFiles().skill.find((f) => f.name === 'databrief/scripts/databrief.cjs').data;
  const P = 'databrief/';
  const buf = (s) => Buffer.from(s, 'utf8');
  const entries = [
    { name: P + '.claude-plugin/plugin.json', data: buf(fill(text('agents/plugin/plugin.json'))) },
    { name: P + '.mcp.json', data: buf(fill(text('agents/plugin/mcp.json'))) },
    { name: P + 'skills/databrief/SKILL.md', data: buf(skill) },
    { name: P + 'skills/databrief/scripts/databrief.cjs', data: script },
    { name: P + 'commands/databrief.md', data: buf(fill(text('agents/plugin/commands/databrief.md'))) },
    { name: P + 'README.md', data: buf(fill(text('agents/plugin/README.md'))) },
    { name: P + 'LICENSE', data: buf(text('LICENSE')) },
  ];
  return { zip: zip(entries), entries };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--url');
  const url = i >= 0 ? args[i + 1] : process.env.DATABRIEF_MCP_URL;
  const rest = args.filter((a, k) => k !== i && k !== i + 1);
  if (!url) { console.error('Give the address of the hosted server: node tools/build-plugin.cjs --url https://YOUR-HOST/mcp'); process.exit(2); }
  const out = path.resolve(rest[0] || path.join(ROOT, 'dist', 'plugin'));
  const b = build(url);
  fs.rmSync(path.join(out, 'databrief-plugin'), { recursive: true, force: true });
  for (const f of b.entries) { const p = path.join(out, 'databrief-plugin', f.name.slice('databrief/'.length)); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }
  fs.writeFileSync(path.join(out, 'databrief-plugin.zip'), b.zip);
  console.log('Built ' + path.relative(process.cwd(), out) + ': databrief-plugin.zip (' + b.zip.length.toLocaleString('en-US') + ' bytes) and databrief-plugin/');
}
module.exports = { build, checkUrl };
