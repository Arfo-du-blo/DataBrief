#!/usr/bin/env node
/* Builds the terminal pack for AI agents:
 *   node tools/build-agents.cjs [OUTPUT_DIR]        (default dist/agents)
 * OUTPUT_DIR/databrief-skill.zip     the skill (databrief/SKILL.md, databrief/scripts/databrief.cjs, LICENSE): upload it to Claude (Settings, Capabilities,
 *                                    Skills), or unzip the folder into ~/.claude/skills/ (Claude Code) or any agent's skills folder
 * OUTPUT_DIR/databrief-skill/        the same folder, unzipped
 * OUTPUT_DIR/AGENTS-snippet.md       the text to paste into AGENTS.md, CLAUDE.md, GEMINI.md or a rules file
 * OUTPUT_DIR/mcp.json               an MCP configuration that starts `databrief --mcp --root .` (the pinned version, through npx)
 * The texts are agents/skill/SKILL.md and agents/AGENTS-snippet.md with {{VERSION}} replaced by package.json's version (the pinned npx fallback).
 * The script is the command-line tool's single file (tools/build-cli.cjs). Reproducible: same sources, same bytes (tests/test_agents.cjs). */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { zip } = require('./build-mcpb.cjs');

const ROOT = path.join(__dirname, '..');
const lf = (s) => s.replace(/\r\n?/g, '\n');

function files() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const text = (p) => lf(fs.readFileSync(path.join(ROOT, p), 'utf8')).split('{{VERSION}}').join(pkg.version);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-agents-'));
  let cli;
  try {
    const target = path.join(tmp, 'databrief.cjs');
    execFileSync(process.execPath, [path.join(__dirname, 'build-cli.cjs'), target], { env: Object.assign({}, process.env, { DATABRIEF_VERSION: pkg.version }), stdio: ['ignore', 'ignore', 'inherit'] });
    cli = fs.readFileSync(target);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return {
    skill: [
      { name: 'databrief/SKILL.md', data: Buffer.from(text('agents/skill/SKILL.md'), 'utf8') },
      { name: 'databrief/scripts/databrief.cjs', data: cli },
      { name: 'databrief/LICENSE', data: Buffer.from(lf(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')), 'utf8') },
      { name: 'databrief/THIRD-PARTY-NOTICES.md', data: Buffer.from(lf(fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')), 'utf8') },
    ],
    snippet: Buffer.from(text('agents/AGENTS-snippet.md'), 'utf8'),
    mcpConfig: Buffer.from(text('agents/mcp.json'), 'utf8'),
  };
}

function build() { const f = files(); return { zip: zip(f.skill), skill: f.skill, snippet: f.snippet, mcpConfig: f.mcpConfig }; }

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'agents'));
  const b = build();
  fs.rmSync(path.join(out, 'databrief-skill'), { recursive: true, force: true });
  for (const f of b.skill) { const p = path.join(out, 'databrief-skill', f.name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }
  fs.writeFileSync(path.join(out, 'databrief-skill.zip'), b.zip);
  fs.writeFileSync(path.join(out, 'AGENTS-snippet.md'), b.snippet);
  fs.writeFileSync(path.join(out, 'mcp.json'), b.mcpConfig);
  console.log('Built ' + path.relative(process.cwd(), out) + ': databrief-skill.zip (' + b.zip.length.toLocaleString('en-US') + ' bytes), databrief-skill/, AGENTS-snippet.md, mcp.json');
}
module.exports = { build, files };
