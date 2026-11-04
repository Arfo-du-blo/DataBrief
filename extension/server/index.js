#!/usr/bin/env node
/*
 * DataBrief - the Claude Desktop extension (.mcpb): a LOCAL MCP server over stdio, with no dependency and no network.
 *
 * Two tools:
 *   databrief_open     opens the DataBrief page as a widget (MCP Apps), the same page as the hosted connector serves;
 *   databrief_analyze  reads a file BY ITS PATH, on this computer, with the same code as the command-line tool (databrief-cli.cjs,
 *                      run with --json) and returns the prompt. "share" is a required parameter with no default: the AI has to
 *                      decide, and to ask the user when they have not said whether the data may be shared.
 * Nothing leaves this computer from here: the file is read inside this process, by the code of the command-line tool, which opens no connection, and the answer goes to the
 * app that started this server. stdout carries the protocol ONLY (one JSON message per line); logs go to stderr and never hold a
 * path, a prompt or any content.
 * GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HERE = __dirname;
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MIME = 'text/html;profile=mcp-app';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'manifest.json'), 'utf8'));
const URIS = JSON.parse(fs.readFileSync(path.join(HERE, 'uris.json'), 'utf8'));
const ALL_URIS = [URIS.current].concat(URIS.previous || []);
const WIDGET_FILE = path.join(HERE, 'widget.html');
const CLI_FILE = path.join(HERE, 'databrief-cli.cjs');
const LANGS = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'zh', 'ja', 'ko', 'hi', 'ar'];
const NS_PARTS = ['names', 'labels', 'rel', 'file', 'text', 'sql'];
const RES_META = { ui: { prefersBorder: true, permissions: { clipboardWrite: {} } } };
const TIMEOUT_MS = 180000;           // a file that takes longer than this is not read
const MAX_OUT = 200 * 1024 * 1024;   // the largest answer taken from the reader
const log = (s) => process.stderr.write('[databrief] ' + s + '\n');

const NONE = { type: 'object', properties: {}, additionalProperties: false };
const TOOLS = [
  {
    name: 'databrief_open',
    title: 'DataBrief',
    description: 'Opens DataBrief, a page where the user picks a data file (CSV, Excel, Parquet, SQLite, SQL dump, PDF, Word and many more) and turns it into a prompt for an AI, with an option to share no records at all. ' +
      'Use it when the user wants to look at the page or drop a file in it. If the user gives you the PATH of a file on their computer, use databrief_analyze instead. ' +
      'You cannot see the widget: the user picks the file in it. When the user says the prompt or the data was added to the widget context, read that context first (for example with read_widget_context) and follow it; do not ask the user to paste it. Takes no arguments.',
    inputSchema: NONE,
    annotations: { title: 'DataBrief', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: URIS.current }, 'ui/resourceUri': URIS.current },
  },
  {
    name: 'databrief_analyze',
    title: 'Read a file with DataBrief',
    description: 'Reads a data file on the user\'s computer, BY ITS PATH, and returns a prompt that describes it (CSV, Excel, Parquet, SQLite, SQL dumps, PostgreSQL archives, JSON, PDF, Word and many more formats). ' +
      'The file is read locally by DataBrief and is not sent anywhere by this tool; what you read in the answer is what DataBrief produced. ' +
      '"share" is REQUIRED and has no default: "no" is "Do not share data" (the prompt describes the file, its columns, types, keys and statistics, and holds NO record); "yes" puts the data itself in the prompt. ' +
      'If the user has not said whether the data may be shared, ASK THEM before calling this tool. When the user says "no data" or "only statistics", use share "no" (level 3 for "all the statistics").',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute path of the file on the user\'s computer, for example C:\\Users\\me\\sales.xlsx or /Users/me/sales.csv.' },
        share: { type: 'string', enum: ['yes', 'no'], description: 'REQUIRED. "no": Do not share data, no record in the prompt. "yes": the data is in the prompt. Ask the user if they have not said.' },
        level: { type: 'integer', enum: [1, 2, 3], description: 'With share "no" only. 1 = structure only (default, the least revealing), 2 = + counts, 3 = + summaries of the columns (all the statistics; they can show real values such as a minimum, a maximum or category names).' },
        lang: { type: 'string', enum: LANGS, description: 'The language of the prompt: the user\'s language. Default: en.' },
        limit: { anyOf: [{ type: 'integer', minimum: 1, maximum: 1000000 }, { type: 'string', enum: ['auto'] }], description: 'With share "yes" only. Rows kept per table: a whole number, or "auto" (default) which keeps a large file small enough for an AI to read.' },
        allow: { type: 'array', items: { type: 'string', enum: NS_PARTS }, description: 'With share "no" only. Also include these parts (names, labels, rel, file, text, sql). Default: the standard set.' },
        hide: { type: 'array', items: { type: 'string', enum: NS_PARTS }, description: 'With share "no" only. Leave these parts out (for example "file" hides the file name everywhere).' },
      },
      required: ['path', 'share'],
      additionalProperties: false,
    },
    annotations: { title: 'Read a file with DataBrief', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const OPEN_TEXT = 'DataBrief is open. The user chooses a file inside the widget; it is read on their computer and goes nowhere else. ' +
  'You cannot see the widget. Tell the user to choose a file in it and use its buttons (Put in the chat, Add to context, or Ask about this data); do not ask them to paste anything. ' +
  'When they say the prompt or the data was added to the widget context, read that context first (for example with read_widget_context), then follow it. ' +
  'If the user gives you the path of a file on their computer, you can read it yourself with databrief_analyze.';

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const reply = (msg, result) => send({ jsonrpc: '2.0', id: msg.id, result });
const fail = (msg, code, text) => send({ jsonrpc: '2.0', id: msg.id, error: { code, message: text } });
const toolError = (text) => ({ isError: true, content: [{ type: 'text', text }] });

// What the AI sent, checked. Returns { args } for the reader or { error } for the AI to correct itself.
function check(a) {
  if (!a || typeof a !== 'object') return { error: 'The arguments are missing: path and share are required.' };
  if (typeof a.path !== 'string' || !a.path || a.path.length > 4096 || a.path.includes('\0')) return { error: 'path must be the absolute path of a file, as a string.' };
  if (!path.isAbsolute(a.path)) return { error: 'path must be ABSOLUTE (for example C:\\Users\\me\\sales.xlsx or /Users/me/sales.csv); ask the user for the full path if you only have a name.' };
  if (a.share !== 'yes' && a.share !== 'no') return { error: 'share is REQUIRED and must be "yes" or "no": "no" = Do not share data (no record in the prompt), "yes" = the data is in the prompt. Ask the user which they want, then call again.' };
  if (a.lang !== undefined && !LANGS.includes(a.lang)) return { error: 'lang must be one of: ' + LANGS.join(', ') + '.' };
  const args = ['--json', '--no-copy'];
  const notes = [];
  if (a.lang !== undefined) args.push('--lang', a.lang);
  if (a.share === 'no') {
    const level = a.level === undefined ? 1 : a.level;
    if (![1, 2, 3].includes(level)) return { error: 'level must be 1, 2 or 3.' };
    args.push('--no-share=' + level);
    for (const key of ['allow', 'hide']) {
      if (a[key] === undefined) continue;
      if (!Array.isArray(a[key]) || a[key].some((x) => !NS_PARTS.includes(x))) return { error: key + ' must be a list made of: ' + NS_PARTS.join(', ') + '.' };
      if (a[key].length) args.push('--' + key + '=' + a[key].join(','));
    }
    if (a.limit !== undefined) notes.push('limit was ignored: it only applies when the data is shared.');
  } else {
    let limit = a.limit === undefined ? 'auto' : a.limit;
    if (limit !== 'auto' && !(Number.isInteger(limit) && limit >= 1 && limit <= 1000000)) return { error: 'limit must be "auto" or a whole number of rows (1 to 1000000).' };
    args.push('--limit', String(limit));
    if (a.level !== undefined || a.allow !== undefined || a.hide !== undefined) notes.push('level, allow and hide were ignored: they only apply with share "no".');
  }
  args.push('--', a.path);
  return { args, notes };
}

// Runs the command-line tool's own code (databrief-cli.cjs, built as a library) INSIDE this process. It cannot be a subprocess: Claude
// Desktop's built-in Node refuses to start one. The tool gets stand-ins for the terminal (its output is captured, nothing is written to
// our stdout, which carries the protocol), no clipboard and no way to start a program. One file at a time, so memory stays bounded.
let cliMain = null;
let chain = Promise.resolve();
function runReader(args) {
  const job = chain.then(() => runOnce(args));
  chain = job.then(() => {}, () => {});
  return job;
}
function runOnce(args) {
  return new Promise((resolve) => {
    let size = 0, over = false, done = false;
    const out = [], err = [];
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => finish({ code: -1, out: '', err: '', timedOut: true }), TIMEOUT_MS);
    try {
      if (!cliMain) cliMain = require(CLI_FILE);
      const sink = (list, count) => ({ isTTY: false, write(c) { if (count) { size += Buffer.byteLength(String(c)); if (size > MAX_OUT) { over = true; return true; } } if (list.length < 40 || count) list.push(String(c)); return true; } });
      const env = Object.assign(cliMain.defaultEnv(), {
        stdout: sink(out, true), stderr: sink(err, false), stdinIsTTY: false, stdoutIsTTY: false,
        say() {}, waitEnter: () => Promise.resolve(),
        spawnSync() { throw new Error('this extension starts no program'); },
        which() { return null; },
      });
      cliMain.run(args, env).then(
        (code) => finish({ code, out: out.join(''), err: err.join('').slice(-600), over }),
        (e) => finish({ code: -1, out: '', err: String(e && e.message) })
      );
    } catch (e) { finish({ code: -1, out: '', err: String(e && e.message) }); }
  });
}

async function analyze(a) {
  const t0 = Date.now();
  const c = check(a);
  if (c.error) return toolError(c.error);
  const r = await runReader(c.args);
  if (r.timedOut) return toolError('DataBrief took longer than ' + TIMEOUT_MS / 1000 + ' seconds to read the file and stopped. Try share "no", or a smaller file.');
  if (r.over) return toolError('The prompt is larger than the extension accepts. Try share "no", or a smaller limit.');
  let j;
  try { j = JSON.parse(r.out); } catch (e) { return toolError('DataBrief could not read the file (' + (r.err.trim().split('\n').pop() || 'no answer') + ').'); }
  if (!j.ok) return toolError('DataBrief could not read the file: ' + ((j.error && j.error.message) || 'unknown error'));
  const facts = ['DataBrief: ' + j.format + ', about ' + j.tokens + ' tokens. ' + (j.shared ? 'This prompt HOLDS THE DATA of the file.' : 'Do not share data (level ' + j.level + '): this prompt holds NO record of the file.')];
  for (const w of [].concat(j.warnings || [], j.notes || [], c.notes)) facts.push(String(w));
  if (j.large) facts.push('The file is large: the prompt may be too big for some AIs; a smaller limit or share "no" keeps it small.');
  log('analyze ok: ' + j.format + ', ' + (j.shared ? 'data shared' : 'no data') + ', ' + (Date.now() - t0) + ' ms');
  return { content: [{ type: 'text', text: j.prompt }, { type: 'text', text: facts.join('\n') }] };
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return;
  const isRequest = 'id' in msg && (typeof msg.id === 'string' || (typeof msg.id === 'number' && Number.isFinite(msg.id)));
  const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (msg.method) {
    case 'initialize':
      if (!isRequest) return;
      return reply(msg, {
        protocolVersion: SUPPORTED.includes(p.protocolVersion) ? p.protocolVersion : SUPPORTED[0],
        capabilities: { tools: { listChanged: false }, resources: {} },
        serverInfo: { name: 'databrief', title: 'DataBrief', version: MANIFEST.version, websiteUrl: 'https://github.com/Arfo-du-blo/DataBrief' },
        instructions: 'DataBrief turns a data file into a prompt for an AI, with an option to share no records. To read a file by its path call databrief_analyze (ask the user whether the data may be shared); to show the page call databrief_open.',
      });
    case 'ping': return isRequest ? reply(msg, {}) : undefined;
    case 'tools/list': return isRequest ? reply(msg, { tools: TOOLS }) : undefined;
    case 'tools/call': {
      if (!isRequest) return;
      if (p.name === 'databrief_open') return reply(msg, { content: [{ type: 'text', text: OPEN_TEXT }] });
      if (p.name === 'databrief_analyze') {
        let result;
        try { result = await analyze(p.arguments); } catch (e) { log('error: ' + (e && e.message)); result = toolError('DataBrief failed: ' + ((e && e.message) || 'unknown error')); }
        return reply(msg, result);
      }
      return fail(msg, -32602, 'Unknown tool');
    }
    case 'resources/list':
      return isRequest ? reply(msg, { resources: [{ uri: URIS.current, name: 'databrief-widget', title: 'DataBrief', mimeType: MIME, _meta: RES_META }] }) : undefined;
    case 'resources/templates/list': return isRequest ? reply(msg, { resourceTemplates: [] }) : undefined;
    case 'resources/read': {
      if (!isRequest) return;
      if (!ALL_URIS.includes(p.uri)) return fail(msg, -32002, 'Resource not found');
      let text;
      try { text = fs.readFileSync(WIDGET_FILE, 'utf8'); } catch (e) { return fail(msg, -32603, 'The widget page is missing from the extension'); }
      return reply(msg, { contents: [{ uri: p.uri, mimeType: MIME, text, _meta: RES_META }] });
    }
    default:
      if (isRequest) fail(msg, -32601, 'Method not found');
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) { log('a line that is not JSON was ignored'); return; }
  for (const m of [].concat(msg)) handle(m).catch((e) => log('error: ' + (e && e.message)));
});
rl.on('close', () => process.exit(0));
log('started, version ' + MANIFEST.version + ' (Node ' + process.version + ')');
