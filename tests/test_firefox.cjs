/* DataBrief smoke test in Firefox (Puppeteer over WebDriver BiDi). The main suite (run_tests.cjs) uses Chrome-only features
 * (DevTools protocol for downloads, clipboard), so this one covers what differs between engines: reading every kind of
 * format (SheetJS, SQLite/WebAssembly, Parquet, SPSS), the interface (dialogs, right-to-left, editing in a contenteditable
 * area), "Do not share data" and its canary values, the data profile (on by default), and zero external requests.
 *   NODE_PATH=<node_modules> node test_firefox.cjs <databrief.html> <fixtures dir>
 * Needs Firefox for Puppeteer:  npx puppeteer browsers install firefox */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const [htmlPath, fixDir] = process.argv.slice(2).map((p) => path.resolve(p));
const url = 'file://' + htmlPath;
const F = (n) => path.join(fixDir, n);
const results = [];
const check = (name, cond, msg) => results.push({ name, ok: !!cond, msg: cond ? '' : msg || '' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 200));

(async () => {
  const browser = await puppeteer.launch({ browser: 'firefox', headless: true, protocol: 'webDriverBiDi' });
  const version = await browser.version();
  const external = [];
  async function open() {
    const p = await browser.newPage();
    p.on('request', (r) => {
      const u = r.url();
      if (/^(data:|blob:|file:|about:|moz-|resource:|chrome:)/.test(u)) return;
      external.push(u);
    });
    p.on('pageerror', (e) => external.push('pageerror: ' + e.message));
    await p.goto(url, { waitUntil: 'load' });
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
    await p.reload({ waitUntil: 'load' });
    return p;
  }
  // Reads a fixture through the page's own file handler (no file dialog, works the same in every engine).
  async function load(p, file) {
    const b64 = fs.readFileSync(file).toString('base64');
    await p.evaluate(async (name, data) => {
      const bin = atob(data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      await window.DataBrief.handleFile(new File([u8], name));
    }, path.basename(file), b64);
    return p.evaluate(() => ({ ok: !document.getElementById('result').classList.contains('hidden'), md: window.DataBrief.getMarkdown(), err: document.getElementById('errorMsg').textContent }));
  }
  const md = (p) => p.evaluate(() => window.DataBrief.getMarkdown());
  const click = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);

  // ---- every kind of reader
  const FORMATS = [
    ['ventes.csv', 'Île-de-France'], ['workbook.xlsx', 'Globex'], ['workbook.xls', 'Globex'], ['workbook.ods', 'Globex'],
    ['nested.json', '`address.city`'], ['events.ndjson', '`ctx.user`'], ['catalog.xml', '`books.book`'], ['team.yaml', '`members`'],
    ['page.html', 'Quarterly KPIs'], ['survey.sav', 'Customer survey 2024'], ['survey.zsav', 'Customer survey 2024'],
    ['table_snappy.parquet', '`geo.lat`'], ['table_zstd.parquet', '`geo.lat`'], ['nested.parquet', 'LIST<'], ['shop.sqlite', '`customers`'],
    ['schema_features.sqlite', '**Primary key:** `k1`, `k2`'], ['relations.xlsx', 'Inferred candidates'], ['features.xlsx', '**Hidden rows:** 3'],
    ['pg16-default.sql', '**SQL dialect:** PostgreSQL'], ['pg17-custom-zstd.dump', 'custom archive 1.16.0 · zstd'], ['pg16-custom-lz4.dump', 'custom archive 1.15.0 · lz4'], ['pg13-tar.tar', 'tar archive'], ['mysql8-default.sql', '**SQL dialect:** MySQL / MariaDB'],
  ];
  for (const [file, expected] of FORMATS) {
    const p = await open();
    try {
      const r = await load(p, F(file));
      check('read ' + file, r.ok && r.md.includes(expected), r.ok ? 'missing ' + JSON.stringify(expected) : 'error: ' + r.err);
    } catch (e) { check('read ' + file, false, String(e.message || e).slice(0, 160)); }
    await p.close();
  }

  // ---- interface: card dialog, right-to-left, editing, profile
  {
    const p = await open();
    await load(p, F('ventes.csv'));
    await click(p, '#chips button.chip');
    await wait();
    check('format card opens (<dialog>)', await p.evaluate(() => document.getElementById('fmtDialog').open && document.getElementById('fmtReads').textContent.length > 20));
    await p.evaluate(() => document.getElementById('fmtDialog').close());
    await p.evaluate(() => { const s = document.getElementById('uiLang'); s.value = 'ar'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(400);
    check('Arabic is right-to-left', await p.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar'));
    await p.evaluate(() => { const s = document.getElementById('uiLang'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(300);
    check('data profile (on by default)', (await md(p)).includes('## Data profile'));
    await click(p, '#profileOn');
    await wait(300);
    check('data profile switches off', !(await md(p)).includes('## Data profile'));
    // editing: the editable parts accept typing (plaintext-only, or the fallback for engines without it)
    await click(p, '#editBtn');
    await wait(300);
    const editable = await p.$('#preview .ed');
    check('edit mode shows editable parts', !!editable);
    if (editable) {
      await editable.click();
      await p.keyboard.type('FIREFOX_EDIT_TEST');
      await click(p, '#editBtn');
      await wait(300);
      check('typed text is kept after Confirm', (await md(p)).includes('FIREFOX_EDIT_TEST'));
    }
    await p.close();
  }

  // ---- "Do not share data": the canary values of the main suite must not appear
  {
    const CANARIES = ['CONFIDENTIAL_CUSTOMER_74291', 'ana.secret@example.com', 'CONFIDENTIAL_SEGMENT_X', 'CONFIDENTIAL_NOTE_123'];
    const p = await open();
    await load(p, F('confidential.csv'));
    await click(p, '#nsOn'); // the switch is in the "Do not share data" section of the result
    await wait(300);
    const r = { md: await md(p) };
    check('no-share: structure present, no record (level 1)', r.md.includes('(data not shared)') && r.md.includes('| `customer` |') && !CANARIES.some((c) => r.md.includes(c)));
    await click(p, '#nsLevelGroup button[data-level="3"]');
    // (Puppeteer's waitForFunction needs Function(), which the page's policy forbids in Firefox: poll instead)
    for (let i = 0; i < 100 && !(await p.evaluate(() => window.DataBrief.getState().nsLevel === 3 && !window.DataBrief.getState().busy)); i++) await wait(200);
    await wait(400);
    const s3 = await md(p);
    check('no-share: no record at level 3, summaries present', !CANARIES.some((c) => s3.includes(c)) && s3.includes('## Statistics'));
    check('no-share: the parsed rows are released and the state holds no record', await p.evaluate((c) => window.DataBrief.getState().doc === null && !c.some((x) => JSON.stringify(window.DataBrief.getState()).includes(x)), CANARIES));
    for (const f of ['CONFIDENTIAL_FILE_xlsx.xlsx', 'CONFIDENTIAL_FILE_sqlite.sqlite', 'CONFIDENTIAL_FILE_parquet.parquet', 'CONFIDENTIAL_FILE_sav.sav']) {
      const q = await load(p, F(f));
      check('no-share: ' + f.replace('CONFIDENTIAL_FILE_', ''), q.ok && !q.md.includes('CONFIDENTIAL_REC'), q.ok ? 'a record leaked' : q.err);
    }
    await p.evaluate(() => localStorage.clear());
    await p.close();
  }

  // ---- the page never asks for anything outside itself
  check('zero external requests and no page errors', external.length === 0, external.join(', '));

  await browser.close();
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.msg ? '  —  ' + r.msg : ''));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed (${version})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
