/* Loaded before the command-line tool in tests/test_cli_privacy.cjs:  node --require tests/guard_cli.cjs dist/databrief-cli.cjs ...
 * Every way Node has to reach the network is replaced by a function that writes a line to $GUARD_LOG and throws; every
 * program the tool starts is written there too (it may start one: the clipboard tool or the editor). The test then reads
 * the log: no network line at all, and only the programs it expects. */
'use strict';
const fs = require('fs');
const LOG = process.env.GUARD_LOG;
const note = (kind, what) => { if (LOG) fs.appendFileSync(LOG, JSON.stringify({ kind, what: String(what).slice(0, 200) }) + '\n'); };
const block = (name) => function () { note('network', name); throw new Error('guard_cli: ' + name + ' is not allowed'); };

const net = require('net');
for (const k of ['connect', 'createConnection', 'createServer']) net[k] = block('net.' + k);
net.Socket.prototype.connect = block('net.Socket.connect');
const tls = require('tls');
tls.connect = block('tls.connect');
const dgram = require('dgram');
dgram.createSocket = block('dgram.createSocket');
const dns = require('dns');
for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) dns[k] = block('dns.' + k);
if (dns.promises) for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) dns.promises[k] = block('dns.promises.' + k);
for (const m of ['http', 'https']) { const mod = require(m); mod.request = block(m + '.request'); mod.get = block(m + '.get'); mod.createServer = block(m + '.createServer'); }
const http2 = require('http2');
http2.connect = block('http2.connect');
for (const g of ['fetch', 'WebSocket', 'EventSource']) if (typeof globalThis[g] !== 'undefined') globalThis[g] = block(g);

const cp = require('child_process');
for (const k of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const orig = cp[k];
  cp[k] = function (cmd, args, opts) {
    const shell = (Array.isArray(args) ? opts : args) && (Array.isArray(args) ? opts : args).shell;
    note(k === 'exec' || k === 'execSync' || shell ? 'shell' : 'spawn', k + ' ' + cmd);
    return orig.apply(this, arguments);
  };
}
note('start', process.argv.slice(2).join(' '));
