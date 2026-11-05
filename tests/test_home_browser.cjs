#!/usr/bin/env node
/* The hosted server's home page (/) in a real browser, next to the real tool (/app):
 *   NODE_PATH=<node_modules with puppeteer> node tests/test_home_browser.cjs
 * Checks: English by default; the language chosen on the home page is the one the tool opens with (fr here, through the tool's own stored choice) and the language
 * chosen in the tool is the one the home page shows next time; the theme is shared the same way; all 15 languages (their words are the tool's own for the shared texts,
 * Arabic is right to left); on a phone-sized screen nothing goes off the side, in any language; the Copy button; no script error, no request to anywhere but the
 * server, no Content-Security-Policy violation; with JavaScript off the English page is whole and the language button is not shown. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const { build } = require('../tools/build-widget.cjs');
const { createServer, loadConfig } = require('../mcp/server.js');
let failed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } else console.log('PASS ' + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp', 'home-i18n.json'), 'utf8'));
const tool = (() => { const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8'), sb); return sb.window.DB_I18N; })();
const CODES = home.langs.map((l) => l.code);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-home-test-'));
  const widgetFile = path.join(tmp, 'databrief-widget.html');
  fs.writeFileSync(widgetFile, build());
  const server = createServer(loadConfig({ DATABRIEF_WIDGET: widgetFile, DATABRIEF_LOG: 'off', DATABRIEF_PUBLIC_URL: 'https://databrief.example.org', DATABRIEF_RATE_PER_MIN: '0' }), () => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const external = [], errors = [], csp = [];

  async function open(opts) {   // a clean browser context for every scenario: the stored choices are what is tested
    opts = opts || {};
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.ctx = ctx;
    await page.setViewport(opts.phone ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1100, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !/^(data|blob|about):/.test(u)) { external.push(u); r.abort(); } else r.continue(); });
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 100)));
    page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 140)); });
    if (opts.noJs) await page.setJavaScriptEnabled(false);
    await page.goto(origin + '/', { waitUntil: 'load' });
    return page;
  }
  const close = async (page) => { await page.close(); await page.ctx.close(); };
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
  const ls = (page, k) => page.evaluate((key) => { try { return localStorage.getItem(key); } catch (e) { return null; } }, k);
  const overflow = (page) => page.evaluate(() => {
    const w = window.innerWidth, bad = [];
    if (document.documentElement.scrollWidth > w + 1) bad.push('page ' + document.documentElement.scrollWidth + '>' + w);
    for (const el of document.querySelectorAll('.btn,.chip,.links a,.step,.addr input,.privacy,.control,h1,.tagline,.purpose,.lead')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 1 || r.left < -1)) bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
    return bad.slice(0, 4).join(' | ');
  });

  // ---- English by default, and the page without JavaScript
  let page = await open();
  check('English by default: html lang en, left to right, the tool\'s own tagline, the language list on English, the tool link in English',
    (await page.evaluate(() => document.documentElement.lang + '/' + document.documentElement.dir)) === 'en/ltr' && (await text(page, '.tagline')) === tool.ui.en.tagline && (await page.$eval('#uiLang', (s) => s.value)) === 'en' && (await page.$eval('#toolLink', (a) => a.getAttribute('href'))) === '/app?lang=en');
  check('the language list shows the tool\'s 15 languages, by their own names', (await page.$$eval('#uiLang option', (o) => o.map((x) => x.value + ':' + x.textContent).join('|'))) === tool.langs.map((l) => l.code + ':' + l.name).join('|'));
  await close(page);
  page = await open({ noJs: true });
  check('with JavaScript off the English page is whole (title, button, address, steps, footer) and the language and theme buttons are not shown', (await text(page, '.tagline')) === tool.ui.en.tagline && (await page.$eval('#toolLink', (a) => a.getAttribute('href'))) === '/app' && (await page.$eval('#addr', (i) => i.value)) === 'https://databrief.example.org/mcp' && (await page.$$eval('.step li', (l) => l.length)) === 7 && (await page.$eval('#uiLangWrap', (e) => e.hidden)) && (await page.$eval('#themeBtn', (e) => e.hidden)) && (await text(page, 'footer')).includes('GNU GPL v3'));
  await close(page);

  // ---- choose French on the home page: the tool opens in French
  page = await open();
  await page.select('#uiLang', 'fr');
  await sleep(100);
  check('French on the home page: the tool\'s French words, French steps, French footer, French copy button, lang fr, the choice stored under the tool\'s own key (databrief.ui)',
    (await text(page, '.tagline')) === tool.ui.fr.tagline && (await text(page, '.purpose')) === tool.ui.fr.purpose && (await text(page, '.privacy span')) === tool.ui.fr.privacy && (await text(page, '[data-i18n=c1]')) === home.texts.fr.c1.replace(/\*/g, '') && (await text(page, '[data-i18n=footer]')) === tool.ui.fr.footer && (await text(page, '#copy')) === 'Copier' && (await page.evaluate(() => document.documentElement.lang)) === 'fr' && (await ls(page, 'databrief.ui')) === 'fr');
  check('the steps keep their bold words (<em>) in French', (await page.$eval('[data-i18n=c1]', (e) => e.querySelectorAll('em').length)) === 2 && (await page.$eval('[data-i18n=c1] em', (e) => e.textContent)) === 'Paramètres');
  check('the version is in the "Check this page" text, in French', (await text(page, '[data-i18n=verifyText]')).includes(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version) && (await text(page, '[data-i18n=verifyText]')).startsWith('Version '));
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#toolLink')]);
  await page.waitForSelector('#uiLang', { timeout: 20000 });
  check('the button "Open the tool" goes to /app?lang=fr and the tool is in French (its language list says French, its tagline is the French one)', page.url() === origin + '/app?lang=fr' && (await page.$eval('#uiLang', (s) => s.value)) === 'fr' && (await text(page, '.tagline')) === tool.ui.fr.tagline);
  // ---- and the other way round: choose German in the tool, the home page follows
  await page.select('#uiLang', 'de');
  await sleep(200);
  check('German chosen in the tool is stored under the same key', (await ls(page, 'databrief.ui')) === 'de');
  await page.goto(origin + '/', { waitUntil: 'load' });
  check('then the home page opens in German (the language chosen in the tool)', (await text(page, '.tagline')) === tool.ui.de.tagline && (await page.$eval('#uiLang', (s) => s.value)) === 'de' && (await page.$eval('#toolLink', (a) => a.getAttribute('href'))) === '/app?lang=de');
  await close(page);

  // ---- the stored choice alone is enough: the tool opened WITHOUT the ?lang= of the button is in the language chosen on the home page
  page = await open();
  await page.select('#uiLang', 'ja');
  await page.goto(origin + '/app', { waitUntil: 'load' });
  await page.waitForSelector('#uiLang', { timeout: 20000 });
  check('the tool opened directly (no ?lang=) is in the language chosen on the home page, through the stored choice alone (Japanese here)', (await page.$eval('#uiLang', (e) => e.value)) === 'ja' && (await text(page, '.tagline')) === tool.ui.ja.tagline);
  await close(page);
  // ---- the same plain visit without a stored choice stays English even if the browser speaks another language
  page = await open();
  await page.evaluate(() => localStorage.setItem('databrief.ui', 'xx'));
  await page.reload({ waitUntil: 'load' });
  check('an unknown stored language is ignored: English', (await text(page, '.tagline')) === tool.ui.en.tagline && (await page.$eval('#uiLang', (s) => s.value)) === 'en');
  await close(page);

  // ---- theme: shared with the tool
  page = await open();
  const start = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#themeBtn');
  const chosen = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('the theme button switches the theme and stores it under the tool\'s key (databrief.theme)', start === null && (chosen === 'dark' || chosen === 'light') && (await ls(page, 'databrief.theme')) === chosen);
  await page.goto(origin + '/app', { waitUntil: 'load' });
  await page.waitForSelector('#uiLang', { timeout: 20000 });
  check('the tool opens in the theme chosen on the home page', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === chosen);
  await close(page);

  // ---- the Copy button
  page = await open();
  await page.click('#copy');
  await sleep(100);
  check('the Copy button gives feedback (green, "Copied") and the address is selected', (await text(page, '#copy')) === 'Copied' && (await page.$eval('#copy', (b) => b.classList.contains('done'))) && (await page.evaluate(() => { const a = document.getElementById('addr'); return a.selectionStart === 0 && a.selectionEnd === a.value.length; })));
  await sleep(2000);
  check('and goes back to "Copy" after two seconds', (await text(page, '#copy')) === 'Copy');
  await close(page);

  // ---- every language: the tool's words, nothing empty, right to left for Arabic, and no horizontal scroll on a phone
  const problems = [];
  for (const phone of [true, false]) {
    page = await open({ phone });
    for (const code of CODES) {
      await page.select('#uiLang', code);
      const info = await page.evaluate(() => ({ dir: document.documentElement.dir, empty: [...document.querySelectorAll('[data-i18n]')].filter((e) => !e.textContent.trim()).length, tag: document.querySelector('.tagline').textContent.trim() }));
      if (info.tag !== tool.ui[code].tagline) problems.push(code + ': tagline');
      if (info.empty) problems.push(code + ': ' + info.empty + ' empty text(s)');
      if ((code === 'ar') !== (info.dir === 'rtl')) problems.push(code + ': direction ' + info.dir);
      const ov = await overflow(page);
      if (ov) problems.push((phone ? 'phone ' : 'desktop ') + code + ': ' + ov);
    }
    await close(page);
  }
  check('all 15 languages, on a phone (390 px) and on a desktop: the tool\'s tagline, no empty text, Arabic right to left, nothing off the side of the screen', problems.length === 0, problems.slice(0, 5).join('; '));

  // phone layout: one column, full-width buttons, touch-sized controls
  page = await open({ phone: true });
  const lay = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const steps = [...document.querySelectorAll('.step')].map((e) => e.getBoundingClientRect());
    return { cta: r('#toolLink').width, vw: window.innerWidth, oneColumn: steps.length === 2 && Math.abs(steps[0].left - steps[1].left) < 2 && steps[1].top > steps[0].bottom - 1, addrBtn: r('#copy').width, addrH: r('#addr').height, addrW: r('#addr').width, h: r('#toolLink').height, hc: r('#copy').height, link: [...document.querySelectorAll('.links a')].every((a) => a.getBoundingClientRect().height >= 28) };
  });
  check('phone: the main button and the address field span the width (the field is not squashed), the steps are in one column, the controls are tall enough to touch', lay.cta > lay.vw - 40 && lay.oneColumn && lay.addrBtn > lay.vw - 80 && lay.addrH >= 38 && lay.addrW > lay.vw - 80 && lay.h >= 44 && lay.hc >= 38 && lay.link, JSON.stringify(lay));
  await close(page);

  check('no script error on any page', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('no request to anywhere but the server itself', external.length === 0, external.slice(0, 3).join(' '));
  check('no Content-Security-Policy violation (the one inline script is allowed by its hash)', csp.length === 0, csp.slice(0, 2).join(' | '));

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + (total - failed) + '/' + total + ' passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
