#!/usr/bin/env node
/* Builds dist/databrief.mcpb: the Claude Desktop extension (a zip with manifest.json and a local MCP server over stdio).
 *   node tools/build-mcpb.cjs [OUTPUT]
 * Inside: extension/manifest.json (its version = package.json's), icon.png (drawn here, same design as mcp/icon.svg),
 * server/index.js, server/uris.json, server/widget.html (the widget page, tools/build-widget.cjs), server/databrief-cli.cjs
 * (the command-line tool, tools/build-cli.cjs), LICENSE and THIRD-PARTY-NOTICES.md.
 * Reproducible: files in a fixed order, a fixed date, LF line endings, no machine-dependent field; the same sources give the same
 * bytes everywhere (tests/test_mcpb.cjs builds twice and compares). The zip is written here, with fflate's deflate (pure JS).
 * The build fails when extension/uris.json does not record the widget's SHA-256 (a changed widget needs a new address:
 * node tools/build-widget.cjs --new-address). */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const fflate = (() => { const m = { exports: {} }; new Function('module', 'exports', 'self', fs.readFileSync(path.join(ROOT, 'vendor', 'fflate.min.js'), 'utf8'))(m, m.exports, undefined); return typeof m.exports.deflateSync === 'function' ? m.exports : (() => { throw new Error('fflate did not load'); })(); })();
const lf = (s) => s.replace(/\r\n?/g, '\n');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---- the icon: a rounded square with three rounded bars (mcp/icon.svg, 32 units, drawn at 512 px), anti-aliased by 4x4 sampling
function icon() {
  const N = 512, K = 16, SS = 4;
  const bars = [[9, 10, 23], [9, 16, 23], [9, 22, 18]];   // x1, y, x2 (units); stroke 2.6, round caps
  const inBar = (x, y) => bars.some(([x1, by, x2]) => {
    const cx = Math.min(Math.max(x, x1), x2);
    return (x - cx) * (x - cx) + (y - by) * (y - by) <= 1.3 * 1.3;
  });
  const inSquare = (x, y) => {
    const r = 8, cx = Math.min(Math.max(x, r), 32 - r), cy = Math.min(Math.max(y, r), 32 - r);
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
  };
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let py = 0; py < N; py++) {
    raw[py * (N * 4 + 1)] = 0;
    for (let px = 0; px < N; px++) {
      let sq = 0, bar = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / K, y = (py + (sy + 0.5) / SS) / K;
        if (inSquare(x, y)) { sq++; if (inBar(x, y)) bar++; }
      }
      const total = SS * SS, o = py * (N * 4 + 1) + 1 + px * 4;
      const a = sq / total, w = sq ? bar / sq : 0;
      raw[o] = Math.round(0x4f + (255 - 0x4f) * w);
      raw[o + 1] = Math.round(0x5b + (255 - 0x5b) * w);
      raw[o + 2] = Math.round(0xd5 + (255 - 0xd5) * w);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const idat = Buffer.from(fflate.zlibSync(raw, { level: 9 }));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- zip writer
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files) {   // files: [{ name, data: Buffer }] in the order to write
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;   // 1980-01-01 00:00:00
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const deflated = Buffer.from(fflate.deflateSync(f.data, { level: 9 }));
    const useDeflate = deflated.length < f.data.length;
    const body = useDeflate ? deflated : f.data;
    const crc = crc32(f.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDeflate ? 8 : 0, 8);
    h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    locals.push(h, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([central, end]));
}

function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  const widget = Buffer.from(require('./build-widget.cjs').build(), 'utf8');
  const uris = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'uris.json'), 'utf8'));
  if (uris.widgetSha256 !== sha(widget)) throw new Error('extension/uris.json does not record this widget page (SHA-256 ' + sha(widget) + '): run  node tools/build-widget.cjs --new-address');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-mcpb-'));
  let cli;
  try {
    const target = path.join(tmp, 'databrief-cli.cjs');
    execFileSync(process.execPath, [path.join(__dirname, 'build-cli.cjs'), target], { env: Object.assign({}, process.env, { DATABRIEF_VERSION: pkg.version, DATABRIEF_LIBRARY: '1' }), stdio: ['ignore', 'ignore', 'inherit'] });
    cli = fs.readFileSync(target);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const text = (p) => Buffer.from(lf(fs.readFileSync(path.join(ROOT, p), 'utf8')), 'utf8');
  return zip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') },
    { name: 'icon.png', data: icon() },
    { name: 'server/index.js', data: text('extension/server/index.js') },
    { name: 'server/uris.json', data: text('extension/uris.json') },
    { name: 'server/widget.html', data: widget },
    { name: 'server/databrief-cli.cjs', data: cli },
    { name: 'LICENSE', data: text('LICENSE') },
    { name: 'THIRD-PARTY-NOTICES.md', data: text('THIRD-PARTY-NOTICES.md') },
  ]);
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'databrief.mcpb'));
  const bytes = build();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bytes);
  console.log('Built ' + path.relative(process.cwd(), out) + ' (' + bytes.length.toLocaleString('en-US') + ' bytes, SHA-256 ' + sha(bytes) + ')');
}
module.exports = { build, zip, icon, crc32 };
