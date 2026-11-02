#!/usr/bin/env node
/* DataBrief command line. GPL-3.0-or-later. See `databrief --help`.
 * Plain JavaScript of the oldest supported Node: the version is checked before anything else is loaded. */
'use strict';
const major = Number(String(process.versions.node).split('.')[0]);
if (major < 18) {
  process.stderr.write('databrief needs Node.js 18 or newer (this is ' + process.versions.node + ').\n');
  process.exit(2);
}
// The last resort: an error nobody caught. Its message can quote the file (a parser's message): in "Do not share data" only
// its kind is shown, and never a control character.
const noShare = process.argv.slice(2).some((a) => a === '--no-share' || a.indexOf('--no-share=') === 0);
const crash = (e) => {
  const text = noShare ? 'unexpected error (' + ((e && e.name) || 'Error') + ')' : 'unexpected error: ' + ((e && e.stack) || e);
  process.stderr.write('databrief: ' + String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '?') + '\n');
  process.exitCode = 1;
};
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);
const main = require('./main.cjs');
main.run(process.argv.slice(2), main.defaultEnv()).then(
  (code) => { process.exitCode = code; },   // not process.exit(): a long prompt on a pipe is still being written
  crash
);
