#!/usr/bin/env node
/* Prints the commands of src/export-helper.js as JSON, exactly as the page shows them, so that
 * tests/test_export_commands.sh runs THE SAME text (and not a copy that could drift).
 *   node tests/export_commands.cjs            -> {"postgresql": {"schema": "...", "full": "...", "fks": "..."}, ...}
 *   node tests/export_commands.cjs postgresql -> the same, one engine */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = { console };
ctx.window = ctx;
ctx.DB = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'export-helper.js'), 'utf8'), ctx, { filename: 'export-helper.js' });
const out = {};
for (const e of ctx.DB.EXPORT_ENGINES) out[e.key] = { schema: e.schema, full: e.full, fks: e.fks, tested: e.tested };
const one = process.argv[2];
process.stdout.write(JSON.stringify(one ? out[one] : out, null, 1) + '\n');
