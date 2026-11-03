#!/usr/bin/env node
/* The widget layer in a real browser, with fake MCP Apps hosts.
 *   NODE_PATH=<node_modules with puppeteer> node tests/test_widget_browser.cjs
 * A small local server serves a fake host page and dist/databrief-widget.html (built here). The host page holds the widget in an
 * iframe and answers like Claude, ChatGPT, an unknown host, a host that never answers... and records every message it gets. A
 * real CSV file is opened in the page, and the buttons are clicked. Checks: what each host is offered, that the messages posted
 * equal the prompt the page shows, that "Do not share data" keeps the records out, the two clicks, sizes that only warn, downloads
 * and links through the host, the 15 languages, messages from other windows ignored, no outside request, and the plain page. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');
const { build } = require('../tools/build-widget.cjs');

const CANARY = 'CONFIDENTIAL_CELL_77';
const csv = 'customer,email,segment,amount\nAcme Ltd,ceo@acme.example,gold,100.50\n' + CANARY + ',x@y.example,silver,20.00\nBeta SA,b@beta.example,gold,7.25\n';
const csvFile = path.join(os.tmpdir(), 'widget-test-' + process.pid + '.csv');
fs.writeFileSync(csvFile, csv);

let failed = 0, total = 0;
const check = (name, ok, detail) => { total++; if (!ok) { failed++; console.log('FAIL ' + name + (detail !== undefined ? ' :: ' + detail : '')); } else console.log('ok   ' + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HOST_PAGE = `<!doctype html><meta charset="utf-8"><body><iframe id="w" src="/widget.html" style="width:760px;height:900px;border:0"></iframe>
<script>
const cfg = JSON.parse(decodeURIComponent(location.search.slice(1)));
window.__log = [];
const frame = document.getElementById('w');
function reply(id, result) { frame.contentWindow.postMessage({ jsonrpc: '2.0', id, result }, '*'); }
function fail(id, code, message) { frame.contentWindow.postMessage({ jsonrpc: '2.0', id, error: { code, message } }, '*'); }
window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data;
  window.__log.push(m);
  if (m.method === 'ui/initialize') { if (cfg.silent) return; reply(m.id, { protocolVersion: '2026-01-26', hostInfo: cfg.hostInfo, hostCapabilities: cfg.caps, hostContext: { containerDimensions: { maxHeight: 5000 } } }); return; }
  if (m.id !== undefined && m.method) { if (cfg.fail && cfg.fail[m.method]) fail(m.id, -32000, cfg.fail[m.method]); else reply(m.id, cfg.results && cfg.results[m.method] || {}); }
});
window.__request = (method, params) => new Promise((ok) => { const id = 9000 + Math.floor(Math.random() * 1000); const h = (e) => { if (e.source === frame.contentWindow && e.data && e.data.id === id && !e.data.method) { removeEventListener('message', h); ok(e.data); } }; addEventListener('message', h); frame.contentWindow.postMessage({ jsonrpc: '2.0', id, method, params: params || {} }, '*'); });
if (cfg.rogue) { const s = document.createElement('iframe'); s.srcdoc = '<script>setInterval(()=>parent.frames[0].postMessage({jsonrpc:"2.0",id:1,result:{hostInfo:{name:"Claude"},hostCapabilities:{message:{},updateModelContext:{}}}},"*"),200)<\\/script>'; document.body.appendChild(s); }
</script>`;

const CLAUDE = { hostInfo: { name: 'Claude', version: '1.0.0' }, caps: { openLinks: {}, downloadFile: {}, updateModelContext: { text: {} }, message: { text: {} }, serverTools: {}, sandbox: {} } };
const CHATGPT = { hostInfo: { name: 'chatgpt', version: 'unknown' }, caps: { experimental: { 'openai/modelContext': {}, 'openai/message': { draft: {} } }, openLinks: {}, serverTools: {}, message: { text: {} }, updateModelContext: { text: {} } } };
const ACME = { hostInfo: { name: 'acme-chat', version: '2' }, caps: { openLinks: {}, downloadFile: {}, updateModelContext: { text: {} }, message: { text: {} } } };

(async () => {
  const widgetHtml = build();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/host')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HOST_PAGE); return; }
    if (req.url === '/widget.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(widgetHtml); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const external = [];
  let popups = 0, downloads = 0;
  // A download started by the page itself (not through the host) is seen here: all downloads are denied and counted.
  const bc = await browser.target().createCDPSession();
  await bc.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
  bc.on('Browser.downloadWillBegin', () => { downloads++; });

  async function open(cfg, opts) {
    opts = opts || {};
    // a clean browser context for every scenario: the page remembers 'Do not share data' between visits, by design
    const ctxB = await browser.createBrowserContext();
    await bc.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true, browserContextId: ctxB.id });
    const page = await ctxB.newPage();
    page.ctxB = ctxB;
    await page.setViewport({ width: 900, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !/^(data|blob|about):/.test(u)) { external.push(u); r.abort(); } else r.continue();
    });
    page.on('popup', () => { popups++; });
    page.on('pageerror', (e) => { check('no script error in the page (' + (e.message || e).toString().slice(0, 80) + ')', false); });
    await page.goto(origin + '/host?' + encodeURIComponent(JSON.stringify(cfg)), { waitUntil: 'load' });
    let frame = null;
    for (let i = 0; i < 100 && !frame; i++) { frame = page.frames().find((f) => f.url().endsWith('/widget.html')); if (!frame) await sleep(100); }
    await frame.waitForSelector('#fileInput', { timeout: 20000 });
    if (!opts.noFile) {
      await (await frame.$('#fileInput')).uploadFile(csvFile);
      await frame.waitForFunction(() => !document.getElementById('copyBtn').disabled && window.DataBriefPage && window.DataBriefPage.state.md, { timeout: 30000 });
    }
    return { page, frame };
  }
  const closePage = async (page) => { await page.close(); if (page.ctxB) await page.ctxB.close(); };
  const log = (page) => page.evaluate(() => window.__log);
  const sent = async (page, method) => (await log(page)).filter((m) => m.method === method);
  const waitFor = async (page, method, n, ms) => { const end = Date.now() + (ms || 4000); for (;;) { const l = await sent(page, method); if (l.length >= n || Date.now() > end) return l; await sleep(60); } };
  const md = (frame) => frame.evaluate(() => window.DataBriefPage.state.md);
  const text = (frame, sel) => frame.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
  const exists = (frame, sel) => frame.$(sel).then((e) => !!e);
  const boxText = (frame) => frame.$eval('.dbw-box', (e) => e.textContent).catch(() => '');
  const boxTone = (frame) => frame.$eval('.dbw-box', (e) => e.className).catch(() => '');
  const click = async (frame, sel) => { await (await frame.$(sel)).click(); await sleep(120); };
  const hidden = (frame, sel) => frame.$eval(sel, (e) => getComputedStyle(e).display === 'none').catch(() => true);
  const clearPrompt = async (page) => { await page.evaluate(() => { window.__log.length = 0; }); };

  /* ================= Claude: the message box is filled ================= */
  let { page, frame } = await open(CLAUDE);
  const rows = ['#dbwChat', '#dbwCtx', '#dbwAsk', '#dbwQ'];
  check('Claude: Put in the chat, Add to context and the question block are there', (await Promise.all(rows.map((s) => exists(frame, s)))).every(Boolean));
  const labels = await frame.evaluate(() => [...document.querySelectorAll('#dbwChat .dbw-label, #dbwCtx .dbw-label, #dbwAsk .dbw-label')].map((e) => e.textContent));
  check('Claude: the buttons are labelled in English', labels.join('|') === 'Put in the chat|Add to context|Ask this question', labels.join('|'));
  const hs = await sent(page, 'ui/initialize');
  check('the handshake: protocol version, appInfo, then initialized', hs.length === 1 && hs[0].params.protocolVersion === '2026-01-26' && hs[0].params.appInfo.name === 'databrief' && (await sent(page, 'ui/notifications/initialized')).length === 1);
  check('the size is reported to the host', (await sent(page, 'ui/notifications/size-changed')).length >= 1);
  check('the brand name of an app is nowhere in the buttons', !/claude|chatgpt|openai|anthropic/i.test(labels.join(' ') + await frame.$eval('.dbw-ask', (e) => e.textContent)));
  const prompt = await md(frame);
  check('the page produced a prompt with the data', prompt.length > 200 && prompt.includes(CANARY) && prompt.includes('ceo@acme.example'));

  await clearPrompt(page);
  await click(frame, '#dbwChat');
  check('first click: the button becomes Confirm, amber because the prompt holds data', (await text(frame, '#dbwChat')) === 'Confirm' && (await frame.$eval('#dbwChat', (e) => e.classList.contains('dbw-armed-warn'))));
  check('first click: nothing is sent yet', (await sent(page, 'ui/message')).length === 0 && (await sent(page, 'ui/update-model-context')).length === 0);
  check('first click: a box says it holds the data, its size, and where the prompt goes', /Contains the data/.test(await boxText(frame)) && /characters/.test(await boxText(frame)) && /message box/.test(await boxText(frame)) && /warn/.test(await boxTone(frame)));
  check('first click: a cancel cross appears', await exists(frame, '#dbwChat + button'));
  await click(frame, '#dbwChat');
  let ms = await waitFor(page, 'ui/message', 1);
  check('second click: the whole prompt goes to ui/message, as a list of text blocks', ms.length === 1 && Array.isArray(ms[0].params.content) && ms[0].params.content[0].type === 'text' && ms[0].params.role === 'user');
  check('the prompt posted is exactly the prompt the page shows (the one Copy copies)', ms[0] && ms[0].params.content[0].text === prompt);
  check('no context was set for the whole-prompt route', (await sent(page, 'ui/update-model-context')).length === 0);
  check('the button goes back to its label', (await text(frame, '#dbwChat')) === 'Put in the chat');
  check('a green box says the prompt is in the message box, then it fades', /message box/.test(await boxText(frame)) && /ok/.test(await boxTone(frame)));

  await clearPrompt(page);
  await click(frame, '#dbwCtx'); await click(frame, '#dbwCtx');
  const ctx = await waitFor(page, 'ui/update-model-context', 1), msg2 = await waitFor(page, 'ui/message', 1);
  check('Add to context: the context holds the prompt', ctx.length === 1 && ctx[0].params.content[0].text === prompt);
  check('Add to context: then a short line in the prompt\'s language goes to the message box', msg2.length === 1 && msg2[0].params.content[0].text === 'Read the DataBrief widget context (read_widget_context) and follow the prompt in it.');
  const order = (await log(page)).map((m) => m.method).filter((m) => /ui\/(update-model-context|message)$/.test(m || ''));
  check('Add to context: the context comes first, the line after', order.join() === 'ui/update-model-context,ui/message', order.join());

  await clearPrompt(page);
  await frame.type('#dbwQ', 'What is the total amount per segment?');
  await click(frame, '#dbwAsk'); await click(frame, '#dbwAsk');
  const msg3 = await waitFor(page, 'ui/message', 1);
  check('Ask on Claude: ONE message holds the question first and the whole prompt after it', msg3.length === 1 && msg3[0].params.content[0].text === 'My question about this file: What is the total amount per segment?\n\n' + prompt);
  check('Ask on Claude: no context is set (the AI does not need to open anything)', (await sent(page, 'ui/update-model-context')).length === 0);
  await clearPrompt(page);
  await frame.$eval('#dbwQ', (e) => { e.value = ''; });
  await click(frame, '#dbwAsk');
  check('Ask with no question: a message asks for it, nothing is armed or sent', /Type your question first/.test(await boxText(frame)) && (await text(frame, '#dbwAsk')) === 'Ask this question' && (await sent(page, 'ui/message')).length === 0);
  await frame.type('#dbwQ', 'second question');
  await frame.focus('#dbwQ');
  await page.keyboard.press('Enter');
  await sleep(150);
  check('Enter in the question field arms the button', (await text(frame, '#dbwAsk')) === 'Confirm');
  await page.keyboard.press('Escape');
  await sleep(150);
  check('Escape cancels: the button is back and nothing was sent', (await text(frame, '#dbwAsk')) === 'Ask this question' && (await sent(page, 'ui/message')).length === 0);
  await click(frame, '#dbwChat');
  await frame.click('.tagline');
  await sleep(200);
  check('a click elsewhere cancels the armed button', (await text(frame, '#dbwChat')) === 'Put in the chat');
  await click(frame, '#dbwChat');
  await click(frame, '#dbwChat + button');
  check('the cross cancels, and nothing was sent', (await text(frame, '#dbwChat')) === 'Put in the chat' && (await sent(page, 'ui/message')).length === 0);

  // the prompt language decides the line, the interface language decides the labels
  await frame.select('#promptLang', 'fr');
  await sleep(500);
  await click(frame, '#dbwCtx'); await click(frame, '#dbwCtx');
  const frLine = (await waitFor(page, 'ui/message', 1))[0];
  check('prompt language French: the line is French', frLine && frLine.params.content[0].text === "Lis le contexte du widget DataBrief (read_widget_context) et suis le prompt qu'il contient.", frLine && frLine.params.content[0].text);
  check('the interface stays English while only the prompt language changed', (await text(frame, '#dbwChat .dbw-label')) === 'Put in the chat');
  await frame.select('#promptLang', 'en');

  // downloads through the host
  await clearPrompt(page);
  const mdBtnBefore = await md(frame);
  await click(frame, '#downloadBtn');
  const dl = await waitFor(page, 'ui/download-file', 1);
  check('Download .md goes through ui/download-file, as text/markdown, with the prompt', dl.length === 1 && dl[0].params.contents[0].resource.mimeType === 'text/markdown' && dl[0].params.contents[0].resource.text === mdBtnBefore && /^file:\/\/\/.*\.md$/.test(dl[0].params.contents[0].resource.uri), JSON.stringify(dl[0] && dl[0].params.contents[0].resource).slice(0, 120));
  // the data buttons of the page exist in "separate CSV files" mode only
  await click(frame, '#modeGroup button[data-mode="files"]');
  await frame.waitForFunction(() => !document.getElementById('dataBtn').classList.contains('hidden'), { timeout: 10000 });
  await clearPrompt(page);
  await click(frame, '#dataBtn');
  const dl2 = await waitFor(page, 'ui/download-file', 1);
  check('the CSV button goes through ui/download-file with the complete data', dl2.length === 1 && /csv/.test(dl2[0].params.contents[0].resource.mimeType) && dl2[0].params.contents[0].resource.text.includes(CANARY), JSON.stringify(dl2[0] && dl2[0].params.contents[0].resource.mimeType));
  await sleep(300);
  check('no plain browser download was started by the page', downloads === 0, String(downloads));

  // links through the host
  await clearPrompt(page);
  const href = await frame.$eval('a.more', (a) => a.href);
  await click(frame, 'a.more');
  const lk = await waitFor(page, 'ui/open-link', 1);
  check('a link of the page goes to ui/open-link with its address', lk.length === 1 && lk[0].params.url === href, href);
  check('no new tab or window was opened by the link', popups === 0, String(popups));

  // the host talks to the widget
  const td = await page.evaluate(() => window.__request('ui/resource-teardown'));
  check('the host\'s teardown request is answered', td.result && Object.keys(td.result).length === 0);
  const unk = await page.evaluate(() => window.__request('something/else'));
  check('an unknown request from the host gets "method not found"', unk.error && unk.error.code === -32601);
  const pg = await page.evaluate(() => window.__request('ping'));
  check('ping is answered', pg.result && Object.keys(pg.result).length === 0);

  // sizes only warn
  await frame.evaluate(() => { window.DataBriefPage.state.md = 'x'.repeat(150000); });
  await clearPrompt(page);
  await click(frame, '#dbwChat');
  check('a message above 100 KB: the box turns red and warns', /large/i.test(await boxText(frame)) && /err/.test(await boxTone(frame)), await boxText(frame));
  check('the warning does not block: the button is still Confirm', (await text(frame, '#dbwChat')) === 'Confirm');
  await click(frame, '#dbwChat');
  const big = await waitFor(page, 'ui/message', 1);
  check('and the big message is sent when the user confirms', big.length === 1 && big[0].params.content[0].text.length === 150000);
  await frame.evaluate(() => { window.DataBriefPage.state.md = 'y'.repeat(70000); window.DataBriefPage.state.tokens = 17500; });
  await clearPrompt(page);
  await click(frame, '#dbwCtx');
  check('a context above about 16,000 tokens warns too', /large/i.test(await boxText(frame)) && /16,000/.test(await boxText(frame)), await boxText(frame));
  await page.keyboard.press('Escape');

  // errors are shown, and the user is told what to do
  await closePage(page);
  ({ page, frame } = await open(Object.assign({}, CLAUDE, { fail: { 'ui/message': 'refused by the host' } })));
  await click(frame, '#dbwChat'); await click(frame, '#dbwChat');
  await sleep(300);
  check('a refused message shows a red box that says to use Copy', /refused by the host/.test(await boxText(frame)) && /Copy/.test(await boxText(frame)) && /err/.test(await boxTone(frame)));
  await closePage(page);
  ({ page, frame } = await open(Object.assign({}, CLAUDE, { fail: { 'ui/update-model-context': 'too big' } })));
  await click(frame, '#dbwCtx'); await click(frame, '#dbwCtx');
  await sleep(300);
  check('a refused context shows an error and sends no line', /too big/.test(await boxText(frame)) && (await sent(page, 'ui/message')).length === 0);
  await closePage(page);
  ({ page, frame } = await open(Object.assign({}, CLAUDE, { fail: { 'ui/download-file': 'no storage' } })));
  await click(frame, '#downloadBtn');
  await sleep(300);
  check('a failed download is said, with its file name', /no storage/.test(await boxText(frame)) && /\.md/.test(await boxText(frame)));
  await closePage(page);

  /* ================= Do not share data ================= */
  ({ page, frame } = await open(CLAUDE));
  await click(frame, '#nsOn');
  await frame.waitForFunction(() => window.DataBriefPage.state.share === 'no' && window.DataBriefPage.state.md && !document.getElementById('copyBtn').disabled, { timeout: 20000 });
  const nsPrompt = await md(frame);
  check('Do not share data: the prompt holds no record, no value, no e-mail', !nsPrompt.includes(CANARY) && !nsPrompt.includes('ceo@acme.example') && !nsPrompt.includes('100.50'));
  await clearPrompt(page);
  await click(frame, '#dbwChat');
  check('Do not share data: the Confirm button is green and the box says no records', (await frame.$eval('#dbwChat', (e) => e.classList.contains('dbw-armed-ok'))) && /no records/.test(await boxText(frame)) && /ok/.test(await boxTone(frame)));
  await click(frame, '#dbwChat');
  const nsMsg = await waitFor(page, 'ui/message', 1);
  check('Do not share data: what goes to the host holds none of the data', nsMsg.length === 1 && nsMsg[0].params.content[0].text === nsPrompt && !JSON.stringify(await log(page)).includes(CANARY));
  await clearPrompt(page);
  await frame.type('#dbwQ', 'describe the columns');
  await click(frame, '#dbwAsk'); await click(frame, '#dbwAsk');
  await waitFor(page, 'ui/message', 1);
  check('Do not share data: the context holds none of the data either (the question route)', !JSON.stringify(await log(page)).includes(CANARY) && !JSON.stringify(await log(page)).includes('ceo@acme.example'));
  check('Do not share data: the CSV and zip buttons stay hidden by the page', await hidden(frame, '#dataBtn') && await hidden(frame, '#allBtn'));
  await closePage(page);

  /* ================= ChatGPT: a message is sent at once ================= */
  ({ page, frame } = await open(CHATGPT));
  check('ChatGPT: Put in the chat and the question block are there, Add to context is not', (await exists(frame, '#dbwChat')) && (await exists(frame, '#dbwAsk')) && !(await exists(frame, '#dbwCtx')));
  await click(frame, '#modeGroup button[data-mode="files"]');
  await frame.waitForFunction(() => !document.getElementById('dataBtn').classList.contains('hidden'), { timeout: 10000 });
  check('ChatGPT: the download buttons are hidden by the layer, even those the page shows (the host cannot download)', await hidden(frame, '#downloadBtn') && await hidden(frame, '#dataBtn') && await hidden(frame, '#allBtn'));
  await click(frame, '#modeGroup button[data-mode="inline"]');
  await frame.waitForFunction(() => document.getElementById('dataBtn').classList.contains('hidden'), { timeout: 10000 });
  const gptPrompt = await md(frame);
  await clearPrompt(page);
  await click(frame, '#dbwChat');
  check('ChatGPT: the box says the message is sent at once and shows the line', /sent at once/.test(await boxText(frame)) && /Read the DataBrief widget context and follow the prompt in it\./.test(await boxText(frame)));
  await click(frame, '#dbwChat');
  const gctx = await waitFor(page, 'ui/update-model-context', 1), gmsg = await waitFor(page, 'ui/message', 1);
  check('ChatGPT: Put in the chat = the prompt in the context, then the short line as the message (never the whole prompt)', gctx.length === 1 && gctx[0].params.content[0].text === gptPrompt && gmsg.length === 1 && gmsg[0].params.content[0].text === 'Read the DataBrief widget context and follow the prompt in it.');
  check('ChatGPT: the confirmation says it was sent', /Sent/.test(await boxText(frame)));
  await clearPrompt(page);
  await frame.type('#dbwQ', 'Which segment is largest?');
  await click(frame, '#dbwAsk');
  check('ChatGPT: the question route says the question is sent at once', /sent at once/.test(await boxText(frame)) && /Which segment is largest\?/.test(await boxText(frame)));
  await click(frame, '#dbwAsk');
  const ga = await waitFor(page, 'ui/message', 1);
  check('ChatGPT: the question goes as the message', ga.length === 1 && ga[0].params.content[0].text === 'Read the DataBrief widget context, then answer: Which segment is largest?');
  await frame.select('#uiLang', 'fr');
  await sleep(700);
  check('French interface: the labels follow', (await text(frame, '#dbwChat .dbw-label')) === 'Mettre dans le chat' && (await text(frame, '.dbw-ask-title')) === 'Interroger ces données');
  await closePage(page);

  /* ================= an unknown host: only what it says it supports, neutral words ================= */
  ({ page, frame } = await open(ACME));
  check('unknown host: Put in the chat is offered, Add to context is not', (await exists(frame, '#dbwChat')) && !(await exists(frame, '#dbwCtx')));
  await clearPrompt(page);
  await click(frame, '#dbwChat');
  check('unknown host: the words say "sent, or placed in your message box, depending on the app"', /depending on the app/.test(await boxText(frame)));
  await click(frame, '#dbwChat');
  const am = await waitFor(page, 'ui/message', 1);
  check('unknown host: only the short line is posted, never the whole prompt', am.length === 1 && am[0].params.content[0].text === 'Read the DataBrief widget context and follow the prompt in it.');
  await closePage(page);
  ({ page, frame } = await open({ hostInfo: { name: 'bare' }, caps: { openLinks: {} } }));
  check('a host without message or context support: no chat button and no question block', !(await exists(frame, '#dbwChat')) && !(await exists(frame, '#dbwAsk')) && !(await exists(frame, '#dbwCtx')));
  check('a host without downloads: the download buttons are hidden, Copy stays', (await hidden(frame, '#downloadBtn')) && !(await hidden(frame, '#copyBtn')));
  await closePage(page);
  ({ page, frame } = await open({ hostInfo: { name: 'Claude' }, caps: { message: {}, updateModelContext: {}, downloadFile: {} } }));
  await clearPrompt(page);
  await click(frame, 'a.more');
  await sleep(300);
  check('a host without link support: the link opens nothing and sends nothing', (await sent(page, 'ui/open-link')).length === 0 && popups === 0);
  await closePage(page);

  /* ================= a host that never answers, and a window that is not the host ================= */
  ({ page, frame } = await open({ silent: true }));
  await sleep(1200);
  check('a host that never answers: no widget buttons, the page works as it is', !(await exists(frame, '#dbwChat')) && !(await exists(frame, '#dbwAsk')) && !(await hidden(frame, '#copyBtn')));
  await closePage(page);
  ({ page, frame } = await open({ silent: true, rogue: true }));
  await sleep(1500);
  check('a message from another window (not the host) is ignored: no buttons appear', !(await exists(frame, '#dbwChat')) && !(await exists(frame, '#dbwAsk')));
  await closePage(page);

  /* ================= the same page opened on its own ================= */
  page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(data|blob|about):/.test(r.url())) { external.push(r.url()); r.abort(); } else r.continue(); });
  await page.goto(origin + '/widget.html', { waitUntil: 'load' });
  await (await page.$('#fileInput')).uploadFile(csvFile);
  await page.waitForFunction(() => !document.getElementById('copyBtn').disabled, { timeout: 30000 });
  await sleep(1000);
  check('opened on its own (not in a frame): no widget button, no question block, nothing different', !(await page.$('#dbwChat')) && !(await page.$('#dbwAsk')) && !(await page.$('.dbw-box')));
  check('opened on its own: the download buttons are all there', (await page.$eval('#downloadBtn', (e) => getComputedStyle(e).display)) !== 'none');
  check('opened on its own: the page still gives its prompt', (await page.evaluate(() => window.DataBriefPage.state.md)).includes(CANARY));
  await closePage(page);

  /* ================= the interface in the 15 languages ================= */
  ({ page, frame } = await open(CLAUDE));
  const I = await frame.evaluate(() => window.DB_WIDGET_I18N);
  let langOk = true, langBad = '';
  for (const code of Object.keys(I)) {
    await frame.select('#uiLang', code);
    await sleep(550);
    const got = await frame.evaluate(() => [document.querySelector('#dbwChat .dbw-label').textContent, document.querySelector('#dbwCtx .dbw-label').textContent, document.querySelector('#dbwAsk .dbw-label').textContent, document.querySelector('.dbw-ask-title').textContent, document.getElementById('dbwQ').placeholder]);
    const want = [I[code].chatBtn, I[code].ctxBtn, I[code].askBtn, I[code].askTitle, I[code].askPlaceholder];
    if (JSON.stringify(got) !== JSON.stringify(want)) { langOk = false; langBad += code + ' '; }
  }
  check('all 15 interface languages: the labels, the title and the placeholder follow the page language', langOk, langBad);
  await frame.select('#uiLang', 'ar');
  await sleep(500);
  await clearPrompt(page);
  await click(frame, '#dbwChat');
  check('Arabic (right to left): the confirmation box is filled in Arabic', /[؀-ۿ]/.test(await boxText(frame)));
  await closePage(page);

  check('the page and the layer made no request outside the local server', external.length === 0, external.join(' '));
  await browser.close();
  server.close();
  fs.unlinkSync(csvFile);
  console.log('\n' + (total - failed) + '/' + total + ' passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('ERROR', (e && e.stack) || e); try { fs.unlinkSync(csvFile); } catch (x) { /* already gone */ } process.exit(2); });
