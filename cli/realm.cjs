/* DataBrief command-line tool - the page's reading code in Node. GPL-3.0-or-later.
 *
 * Loads the scripts of the page (in the order of src/template.html, without the interface src/app.js), then the tool's
 * additions (vendor/xmldom.min.js, vendor/parse5.min.js, cli/dom-shim.js, src/core.js), into a separate vm realm: the
 * reading code gets the few browser features it uses (text decoding, WebAssembly for SQLite, streams and the stand-ins
 * pdf.js needs) and nothing else - no require, no process, no file system, no fetch or other network API. This keeps the
 * reading code from using Node by accident; it is not a security boundary (Node's vm is not one), the code is DataBrief's.
 *
 *   const realm = require('./realm.cjs').create({ pdf: true });
 *   const res = await realm.prepare(bytes, 'file.xlsx', { share: 'no' });     // see src/core.js
 *   realm.errorInfo(err, noShare)                                              // the page's error text
 *
 * Environment: DATABRIEF_ROOT (another checkout, tests), DATABRIEF_SRC_<NAME>=path replaces one script (sabotage checks:
 * DATABRIEF_SRC_CORE=/tmp/core.js replaces src/core.js). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.DATABRIEF_ROOT || path.join(__dirname, '..');
// After the page's scripts: the XML and HTML parsers Node lacks, and the page's file -> prompt flow
const TOOL_SCRIPTS = ['vendor/xmldom.min.js', 'vendor/parse5.min.js', 'cli/dom-shim.js', 'src/core.js'];

/* The scripts in page order: [{ file } | { wasm }]. pdf: false leaves out the PDF reader block (as the ESP32 page). */
function scriptList(opt) {
  let tpl = fs.readFileSync(path.join(ROOT, 'src/template.html'), 'utf8');
  if (opt && opt.pdf === false) tpl = tpl.replace(/<!-- DataBrief: PDF reader start[\s\S]*?<!-- DataBrief: PDF reader end -->/, '');
  const out = [];
  const re = /<script>\/\*@inline ([^*]+)\*\/<\/script>|window\.DB_SQL_WASM = "\/\*@base64 ([^*]+)\*\/"/g;
  let m;
  while ((m = re.exec(tpl))) {
    if (m[2]) out.push({ wasm: m[2] });
    else if (m[1] !== 'src/app.js') out.push({ file: m[1] });
  }
  if (!out.some((x) => x.file === 'src/parsers.js')) throw new Error('src/template.html: the script list was not found');
  return out.concat(TOOL_SCRIPTS.map((file) => ({ file })));
}

function source(file) {
  const key = 'DATABRIEF_SRC_' + path.basename(file).replace(/\.(min\.)?js$/, '').replace(/\W/g, '_').toUpperCase();
  return fs.readFileSync(process.env[key] || path.join(ROOT, file), 'utf8');
}

function create(opt) {
  opt = opt || {};
  const log = opt.console || { log() {}, info() {}, debug() {}, warn() {}, error() {} };   // the readers' console: silent
  const ctx = {
    console: log, TextDecoder, TextEncoder, Intl, URLSearchParams, URL, atob, btoa, WebAssembly, structuredClone, performance,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    // pdf.js (the legacy build, run on the main thread): streams, messages and these classes; it draws nothing
    Blob, ReadableStream, WritableStream, TransformStream, Response, AbortSignal, AbortController, DOMException,
    EventTarget, Event, MessageChannel, MessagePort,
  };
  ctx.DOMMatrix = class DOMMatrix { constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); } };
  ctx.Path2D = class Path2D {};
  ctx.ImageData = class ImageData {};
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.document = { getElementById: () => null };   // src/config.js: no config block, the built-in defaults
  ctx.location = { search: '' };                    // src/config.js: no URL parameters
  vm.createContext(ctx, { name: 'DataBrief', codeGeneration: { strings: false, wasm: true } });
  for (const s of scriptList(opt)) {
    if (s.wasm) { ctx.DB_SQL_WASM = fs.readFileSync(path.join(ROOT, s.wasm)).toString('base64'); continue; }
    vm.runInContext(source(s.file), ctx, { filename: s.file });
  }
  const DB = ctx.DB;
  const newBytes = vm.runInContext('(n) => new Uint8Array(n)', ctx);
  return {
    DB,
    context: ctx,   // the realm's global object (tests)
    /* bytes: a Uint8Array or Buffer; copied into the realm (some readers check `instanceof ArrayBuffer`) */
    prepare(bytes, fileName, options) {
      const inner = newBytes(bytes.length);
      inner.set(bytes);
      return DB.prepare(inner.buffer, fileName, options);
    },
    errorInfo: (e, noShare, uiLang) => DB.errorInfo(e, noShare, uiLang || 'en'),
  };
}

module.exports = { create, scriptList };
