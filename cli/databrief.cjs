#!/usr/bin/env node
/* DataBrief command line. GPL-3.0-or-later. See `databrief --help`.
 * Plain JavaScript of the oldest supported Node: the version is checked before anything else is loaded. */
'use strict';
const major = Number(String(process.versions.node).split('.')[0]);
if (major < 18) {
  process.stderr.write('databrief needs Node.js 18 or newer (this is ' + process.versions.node + ').\n');
  process.exit(2);
}
const main = require('./main.cjs');
main.run(process.argv.slice(2), main.defaultEnv()).then(
  (code) => { process.exitCode = code; },   // not process.exit(): a long prompt on a pipe is still being written
  (e) => { process.stderr.write('databrief: unexpected error: ' + (e && e.stack || e) + '\n'); process.exitCode = 1; }
);
