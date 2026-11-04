#!/usr/bin/env node
/*
 * DataBrief - the Claude Desktop extension (.mcpb): a LOCAL MCP server over stdio, with no dependency and no network.
 * The server is the command-line tool's own (cli/mcp.cjs, the same as `databrief --mcp`), taken from databrief-cli.cjs built as a library,
 * with the widget added:
 *   databrief_open     opens the DataBrief page as a widget (MCP Apps), the same page as the hosted connector serves;
 *   databrief_analyze  reads a file BY ITS PATH, on this computer, inside this process (Claude Desktop's built-in Node cannot start a
 *                      subprocess); "share" is a required parameter with no default.
 * stdout carries the protocol ONLY (one JSON message per line); the log goes to stderr and never holds a path, a prompt or any content.
 * GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'manifest.json'), 'utf8'));
const URIS = JSON.parse(fs.readFileSync(path.join(HERE, 'uris.json'), 'utf8'));
const WIDGET_FILE = path.join(HERE, 'widget.html');
const log = (s) => process.stderr.write('[databrief] ' + s + '\n');

// The last resort, as in databrief --mcp: an error nobody caught can quote the file (a parser's message), and the app keeps this log, so only
// its kind is written. The server keeps running: one bad file must not stop it.
const crash = (e) => log('unexpected error (' + String((e && e.name) || 'Error').replace(/[^\w]/g, '').slice(0, 40) + ')');
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);

// The optional "Allowed folder" setting: Claude Desktop passes it in DATABRIEF_ROOT. Empty, absent or not filled in (the placeholder left as it
// is) means no limit. A folder that is set but cannot be used stops the server with a message: reading everything instead would be the wrong failure.
const rootSetting = String(process.env.DATABRIEF_ROOT || '').trim();
const root = rootSetting && !rootSetting.startsWith('${') ? rootSetting : null;

const lib = require(path.join(HERE, 'databrief-cli.cjs'));
let served = null;
try {
  served = lib.mcp.serveStdio({
    main: lib, root, version: MANIFEST.version, input: process.stdin, output: process.stdout, log,
    widget: { uri: URIS.current, previous: URIS.previous || [], read: () => fs.readFileSync(WIDGET_FILE, 'utf8') },
  });
} catch (e) {
  // the allowed folder cannot be used (it does not exist, or is not a folder, or is the root of a disk): say so and stop, rather than read everything
  log('the "Allowed folder" setting cannot be used: choose an existing folder (not the root of a disk), or leave it empty');
  process.exitCode = 1;
}
if (served) {
  served.then(() => { process.exitCode = 0; });   // not process.exit(): the last answer may still be on its way through the pipe
  log('started, version ' + MANIFEST.version + (root ? ', files limited to the allowed folder' : '') + ' (Node ' + process.version + ')');
}
