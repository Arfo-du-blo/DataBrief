/* Tests the tampered privacy demo (examples/tampered, docs/verify-privacy.md) in headless Chrome:
 *   1. the leaking copy sends the file name, and only the name, to the demo receiver, and the request is visible;
 *   2. the copy that keeps DataBrief's security policy is blocked: a CSP violation, nothing received;
 *   3. both copies are clearly marked and differ from the real page.
 *   NODE_PATH=<node_modules> node test_privacy_demo.cjs <repo root> <python> <fixture file>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const [root, python, fixture] = process.argv.slice(2).map((p, i) => (i === 1 ? p : path.resolve(p)));
const dir = path.join(root, 'examples', 'tampered');
const results = [];
const check = (name, ok, msg) => results.push({ name, ok: !!ok, msg: ok ? '' : msg || '' });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

(async () => {
  // ---- static checks
  const real = fs.readFileSync(path.join(root, 'databrief.html'), 'utf8');
  for (const [f, code] of [['corrupted_databrief.html', 'injected_code.js'], ['corrupted_databrief_blocked.html', 'injected_code.js'], ['corrupted_databrief_navigation.html', 'injected_navigation.js']]) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    check(`${f}: marked as a demo (banner, title, comment)`,
      html.includes('DEMO: deliberately TAMPERED copy') && html.includes('<title>TAMPERED DEMO - DataBrief</title>') &&
      html.startsWith('<!doctype html>\n<!-- DEMO ONLY'));
    check(`${f}: fingerprint differs from databrief.html`, sha(path.join(dir, f)) !== sha(path.join(root, 'databrief.html')));
    check(`${f}: contains the injected code`, html.includes(fs.readFileSync(path.join(dir, code), 'utf8')));
  }
  const leaky = fs.readFileSync(path.join(dir, 'corrupted_databrief.html'), 'utf8');
  const blocked = fs.readFileSync(path.join(dir, 'corrupted_databrief_blocked.html'), 'utf8');
  check('leaking copy loosens the policy', leaky.includes('connect-src http://127.0.0.1:8765') && !leaky.includes("connect-src 'none'"));
  check('blocked copy keeps the policy', blocked.includes("connect-src 'none'") && real.includes("connect-src 'none'"));

  // ---- the receiver
  const rx = spawn(python, [path.join(dir, 'receiver.py')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  rx.stdout.on('data', (d) => { out += d; });
  rx.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50 && !out.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100));
  check('receiver starts', out.includes('listening'), out);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  async function openAndLoad(url) {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    await page.goto(url, { waitUntil: 'load' });
    await (await page.$('#fileInput')).uploadFile(fixture);
    await page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'), { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1500));
    const md = await page.evaluate(() => window.DataBrief.getMarkdown());
    const csp = await page.evaluate(() => window.__csp);
    await page.close();
    return { requests, md, csp };
  }
  const name = path.basename(fixture);

  // 1. leaking copy
  const a = await openAndLoad('http://127.0.0.1:8765/');
  const sent = a.requests.filter((u) => u.includes('/collect'));
  check('leaking copy: the tool still works normally', a.md && a.md.length > 100);
  check('leaking copy: request visible to the browser (Network tab)', sent.length === 1 && sent[0] === 'http://127.0.0.1:8765/collect?name=' + encodeURIComponent(name), JSON.stringify(sent));
  check('leaking copy: the receiver got the file name', out.includes(`file name = '${name}'`), out);
  const content = fs.readFileSync(fixture, 'utf8').split('\n')[1].trim();
  check('leaking copy: only the name is sent, never the content', !out.includes(content) && !sent.some((u) => u.includes(encodeURIComponent(content))));

  // 2. blocked copy
  const before = (out.match(/RECEIVED/g) || []).length;
  const b = await openAndLoad('http://127.0.0.1:8765/blocked');
  check('blocked copy: the tool still works normally', b.md && b.md.length > 100);
  check('blocked copy: the browser reports a security-policy violation', b.csp.some((v) => v.startsWith('connect-src') && v.includes('127.0.0.1:8765')), JSON.stringify(b.csp));
  check('blocked copy: nothing reaches the receiver', (out.match(/RECEIVED/g) || []).length === before, out);

  // 3. navigation copy: the policy is intact, yet a page can still send the tab to an address that carries the file name.
  //    This is why the README says the policy stops requests, not navigation (and why the Network tab matters).
  const nav = fs.readFileSync(path.join(dir, 'corrupted_databrief_navigation.html'), 'utf8');
  check('navigation copy keeps the policy', nav.includes("connect-src 'none'") && !nav.includes('connect-src http'));
  {
    const page = await browser.newPage();
    const docs = [];
    page.on('request', (r) => { if (r.resourceType() === 'document') docs.push(r.url()); });
    await page.evaluateOnNewDocument(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
    await page.goto('http://127.0.0.1:8765/navigation', { waitUntil: 'load' });
    const nowNav = page.waitForNavigation({ waitUntil: 'load', timeout: 20000 });
    await (await page.$('#fileInput')).uploadFile(fixture);
    await nowNav;
    const here = page.url();
    check('navigation copy: the tab is sent to the receiver with the file name in the address', here === 'http://127.0.0.1:8765/navigated?name=' + encodeURIComponent(name), here);
    check('navigation copy: visible as a "document" request (Network tab)', docs.some((u) => u.includes('/navigated?name=')), JSON.stringify(docs));
    check('navigation copy: the receiver got the file name', out.includes(`RECEIVED by navigation: file name = '${name}'`), out);
    await page.close();
  }

  await browser.close();
  rx.kill();

  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.msg ? '  —  ' + r.msg : ''));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
