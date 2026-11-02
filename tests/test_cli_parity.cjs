#!/usr/bin/env node
/* The command-line tool's reading (cli/realm.cjs + src/core.js) against the page in Chrome: the same prompt, byte for byte.
 *   node tests/test_cli_parity.cjs databrief.html FIXTURES_DIR
 * 1. Every file of FIXTURES_DIR (tests/make_fixtures.py: every format, the canary files, the v1.4 files) in 5 settings: data
 *    in the prompt, data in files, "Do not share data" at levels 1, 2 and 3. Errors: the same error (key and text).
 * 2. The page's other settings on some files: prompt language, layout, no data profile, a row limit (typed and suggested),
 *    each "Do not share data" switch.
 * 3. HTML and XML written here to be awkward (the tool reads them with parse5 and xmldom, the page with the browser's
 *    parsers): broken tables, spans, entities, foreign content, namespaces, entities declared in a DOCTYPE, hostile entities.
 * DATABRIEF_SRC_<NAME> (see cli/realm.cjs) replaces one script of the tool, to check that this test catches a change. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const realmLib = require('../cli/realm.cjs');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'databrief.html'));
const FIX = process.argv[3];
if (!FIX || !fs.existsSync(FIX)) { console.log('usage: node tests/test_cli_parity.cjs databrief.html FIXTURES_DIR'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 600) : '')); } };
const realm = realmLib.create();

/* ---------- the tool ---------- */
async function tool(file, o) {
  const noShare = o.share === 'no';
  try { const r = await realm.prepare(fs.readFileSync(file), path.basename(file), o); return { ok: true, md: r.md }; }
  catch (e) { const i = realm.errorInfo(e, noShare); return { ok: false, err: i.key, msg: i.message }; }
}
/* First line that differs, for the failure message */
function firstDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return 'line ' + (i + 1) + ': page ' + JSON.stringify((x[i] || '').slice(0, 160)) + ' / tool ' + JSON.stringify((y[i] || '').slice(0, 160));
  return '';
}
function same(name, page, mine) {
  if (page.ok && mine.ok) ok(name, page.md === mine.md, firstDiff(page.md, mine.md));
  else if (!page.ok && !mine.ok) ok(name + ' (error ' + page.err + ')', page.err === mine.err && page.msg === mine.msg, 'page ' + page.err + ' "' + page.msg + '" / tool ' + mine.err + ' "' + mine.msg + '"');
  else ok(name, false, page.ok ? 'tool error ' + mine.err + ' ' + mine.msg : 'page error ' + page.err + ' ' + page.msg);
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'], protocolTimeout: 240000 });
  const URL0 = 'file://' + PAGE;
  async function open(q) {
    const ctx = await browser.createBrowserContext();   // a fresh profile: no remembered choice
    const p = await ctx.newPage();
    await p.goto(URL0 + (q || ''), { waitUntil: 'load' });
    if (!(await p.evaluate(() => typeof window.DataBrief === 'object'))) { console.log('FAIL the page did not start'); process.exit(1); }
    p.closeAll = () => ctx.close();
    return p;
  }
  const idle = (p) => p.waitForFunction(() => !window.DataBrief.getState().busy, { timeout: 180000 }).then(() => new Promise((r) => setTimeout(r, 50)));
  async function load(p, file) {
    await (await p.$('#fileInput')).uploadFile(file);
    await p.waitForFunction((name) => (!document.getElementById('result').classList.contains('hidden') && document.getElementById('fileName').textContent === name && !window.DataBrief.getState().busy) ||
      !document.getElementById('errorBox').classList.contains('hidden'), { timeout: 180000 }, path.basename(file));
  }
  const result = (p) => p.evaluate(() => {
    const err = !document.getElementById('errorBox').classList.contains('hidden');
    const s = window.DataBrief.getState();
    return err ? { ok: false, err: s.lastErr && s.lastErr.key ? s.lastErr.key : 'errGeneric', msg: document.getElementById('errorMsg').textContent } : { ok: true, md: window.DataBrief.getMarkdown() };
  });
  const setLevel = async (p, n) => {
    await p.click('#nsLevelGroup button[data-level="' + n + '"]');
    await p.waitForFunction((x) => window.DataBrief.getState().nsLevel === x && !window.DataBrief.getState().busy, { timeout: 180000 }, n);
    await idle(p);
  };

  const ONLY = process.env.PARITY_ONLY;   // "awkward": only part 3 (while working on cli/dom-shim.js)
  /* ---------------------------------------------------------------- 1. every file, 5 settings ---------- */
  const files = ONLY ? [] : fs.readdirSync(FIX).filter((f) => fs.statSync(path.join(FIX, f)).isFile()).sort();
  const t0 = Date.now();
  for (const f of files) {
    const full = path.join(FIX, f);
    for (const [set, q, o] of [['inline', '?mode=inline', {}], ['files', '?mode=files', { mode: 'files' }]]) {
      const p = await open(q);
      await load(p, full);
      same(f + ' · ' + set, await result(p), await tool(full, o));
      await p.closeAll();
    }
    const p = await open('?share=no');
    await load(p, full);
    const r1 = await result(p);
    same(f + ' · do not share, level 1', r1, await tool(full, { share: 'no', level: 1 }));
    if (r1.ok) {
      for (const n of [2, 3]) { await setLevel(p, n); same(f + ' · do not share, level ' + n, await result(p), await tool(full, { share: 'no', level: n })); }
    }
    await p.closeAll();
  }
  console.log('(' + files.length + ' files in ' + Math.round((Date.now() - t0) / 1000) + ' s)');

  /* ---------------------------------------------------------------- 2. the other settings ---------- */
  const SOME = ONLY ? [] : ['ventes.csv', 'workbook.xlsx', 'shop.sqlite', 'catalog.xml', 'page.html', 'shop.dacpac', 'report.docx', 'deck.pdf'].filter((f) => fs.existsSync(path.join(FIX, f)));
  if (!ONLY) ok('settings: the sample files exist', SOME.length >= 6, SOME.join(', '));
  for (const f of SOME) {
    const full = path.join(FIX, f);
    for (const [name, q, o] of [['prompt in French', '?prompt=fr', { lang: 'fr' }], ['layout csv', '?layout=csv', { layout: 'csv' }], ['layout table', '?layout=table', { layout: 'table' }],
      ['no data profile', '?profile=no', { profile: false }], ['do not share, prompt in German', '?share=no&prompt=de', { share: 'no', lang: 'de' }]]) {
      const p = await open(q);
      await load(p, full);
      same(f + ' · ' + name, await result(p), await tool(full, o));
      await p.closeAll();
    }
    // a typed row limit
    {
      const p = await open('?mode=inline');
      await load(p, full);
      if ((await result(p)).ok) {
        await p.$eval('#limitN', (el) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await p.waitForFunction(() => window.DataBrief.getState().limitOn && window.DataBrief.getState().limitN === 2, { timeout: 10000 });
        await idle(p);
        same(f + ' · limit 2 rows', await result(p), await tool(full, { limit: 2 }));
      }
      await p.closeAll();
    }
    // each switch of "Do not share data", turned from its default
    for (const sw of ['names', 'labels', 'rel', 'file', 'text', 'sql']) {
      const p = await open('?share=no');
      await load(p, full);
      if (!(await result(p)).ok) { await p.closeAll(); continue; }
      const def = await p.$eval('#nsOptions [data-sw="' + sw + '"]', (el) => el.checked);
      await p.$eval('#nsOptions [data-sw="' + sw + '"]', (el) => { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); });
      await p.waitForFunction((k, v) => window.DataBrief.getState().nsSw[k] === v, { timeout: 10000 }, sw, !def);
      await idle(p);
      same(f + ' · do not share, switch ' + sw + ' ' + (def ? 'off' : 'on'), await result(p), await tool(full, { share: 'no', sw: { [sw]: !def } }));
      await p.closeAll();
    }
  }
  // the suggested limit of a large file (the page's "show fewer rows")
  if (!ONLY && fs.existsSync(path.join(FIX, 'big.csv'))) {
    const full = path.join(FIX, 'big.csv');
    const p = await open('?mode=inline');
    await load(p, full);
    const warned = await p.evaluate(() => !document.getElementById('warnBox').classList.contains('hidden'));
    await p.click('#limitOn');
    await p.waitForFunction(() => window.DataBrief.getState().limitOn, { timeout: 10000 });
    await idle(p);
    const mine = await realm.prepare(fs.readFileSync(full), 'big.csv', { limit: 'auto' });
    const page = await result(p);
    ok('big.csv · the page warns and the tool reports the size (' + (mine.large && mine.large.tokens) + ' tokens, limit ' + (mine.large && mine.large.limit) + ')', warned && !!mine.large && mine.large.limit === (await p.evaluate(() => window.DataBrief.getState().limitN)));
    same('big.csv · the suggested limit', page, { ok: true, md: mine.md });
    await p.closeAll();
  }

  /* ---------------------------------------------------------------- 3. awkward HTML and XML ---------- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'databrief-parity-'));
  const H = (body) => '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>' + body + '</body></html>';
  const CASES = {
    'h-implicit.html': H('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    'h-unclosed.html': H('<table><tr><td>a<td>b<tr><td>c<td>d</table>'),
    'h-foster.html': H('<table>stray text<tr><td>x</td><td>y</td></tr><p>para</p><tr><td>z</td></tr></table>'),
    'h-entities.html': H('<table><tr><th>n&amp;m</th><th>v</th></tr><tr><td>&hellip; &nbsp;x&lt;y&gt;</td><td>&#x1F600; &eacute;&copy; &notanentity; &amp</td></tr></table>'),
    'h-spans.html': H('<table><tr><th rowspan="0">r0</th><th colspan="0">c0</th><th colspan="5000">wide</th></tr><tr><td rowspan="2px">a</td><td colspan=" +2">b</td><td rowspan="-1">c</td></tr><tr><td>d</td><td>e</td></tr></table>'),
    'h-sections.html': H('<table><tfoot><tr><td>foot</td><td>9</td></tr></tfoot><tbody><tr><td>b1</td><td>1</td></tr></tbody><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>b2</td><td>2</td></tr></tbody></table>'),
    'h-names.html': H('<table summary="S"><tr><td>1</td></tr></table><table aria-label="Label"><tr><td>2</td></tr></table><table id="ident"><tr><td>3</td></tr></table><table><caption>Cap <b>bold</b></caption><caption>second</caption><tr><td>4</td></tr></table><table id="ident"><tr><td>5</td></tr></table>'),
    'h-nested.html': H('<table><tr><td>layout<table id="inner"><tr><th>k</th></tr><tr><td>v</td></tr></table></td><td><table><tr><td>deep<table><tr><td>deeper</td></tr></table></td></tr></table></td></tr></table>'),
    'h-rawtext.html': H('<table><tr><th>c</th></tr><tr><td>a<script>var s="<td>no</td>"</script><style>td{}</style><template><td>t</td></template>b<br>c<br/>d<noscript><b>ns</b></noscript></td></tr></table>'),
    'h-template-only.html': H('<template><table><tr><td>hidden</td></tr></table></template><p>none</p>'),
    'h-foreign.html': H('<svg><foreignObject><table><tr><td>in svg</td></tr></table></foreignObject></svg><math><mtext><table><tr><td>in math</td></tr></table></mtext></math>'),
    'h-upper.html': H('<TABLE ID="Up"><TR><TH ROWSPAN=2>A</TH><TH>B</TH></TR><TR><TD>1</TD></TR></TABLE>'),
    'h-whitespace.html': H('<table><tr><th>  spaced   name </th><th>\n</th></tr><tr><td> \t </td><td>x\n  y</td></tr><tr><td><!-- c --></td><td><span>in</span><i>line</i></td></tr></table>'),
    'h-threehead.html': H('<table><tr><th>a</th><th>b</th></tr><tr><th>c</th><th>d</th></tr><tr><th>e</th><th>f</th></tr><tr><th>g</th><th>h</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    'h-empty.html': H('<table></table><table><tr></tr></table>'),
    'h-notable.html': H('<p>no table here</p>'),
    'h-latin1.html': Buffer.from('<html><head><meta charset="windows-1252"></head><body><table><tr><th>caf\xe9</th></tr><tr><td>\x80 \x93x\x94</td></tr></table></body></html>', 'latin1'),
    'x-ns.xml': '<?xml version="1.0"?><r xmlns="urn:d" xmlns:p="urn:p"><p:item id="1"><p:name>A</p:name></p:item><p:item id="2"><p:name>B</p:name></p:item></r>',
    'x-cdata.xml': '<rows><row><v><![CDATA[a < b & c]]></v><w>x</w></row><row><v>plain</v><w><!-- c -->y</w></row></rows>',
    'x-mixed.xml': '<doc><p>Hello <b>world</b> again</p><p a="1" b="two">text</p><?pi data?></doc>',
    'x-entities.xml': '<r><i>&lt;&gt;&amp;&quot;&apos;</i><i>&#233;&#x20AC;</i></r>',
    'x-internal-entity.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY co "Company &amp; Co">]><r><i>&co;</i><i>2</i></r>',
    'x-laughs.xml': '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;"><!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;"><!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">]><r><i>&lol6;</i></r>',
    'x-external.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xx SYSTEM "file:///etc/passwd">]><r><i>&xx;</i><i>2</i></r>',
    'x-undefined-entity.xml': '<r><i>&nope;</i></r>',
    'x-unclosed.xml': '<r><i>1</i><i>2</r>',
    'x-duplicate-attr.xml': '<r><i a="1" a="2">x</i></r>',
    'x-two-roots.xml': '<a>1</a><b>2</b>',
    'x-latin1.xml': Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><r><i>caf\xe9</i><i>na\xefve</i></r>', 'latin1'),
    'x-bom.xml': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<r><i>bom</i><i>2</i></r>')]),
    'x-space.xml': '<r>\n  <i xml:space="preserve">  kept  </i>\n  <i>  trimmed  </i>\n</r>',
    // the DOCTYPE's internal subset (cli/dom-shim.js reads it as browsers do)
    'x-ent-markup.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY el "<b>bold</b> text">]><r><i>&el;</i><i>2</i></r>',
    'x-ent-http.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xx SYSTEM "http://example.com/x">]><r><i>a&xx;b</i><i>2</i></r>',
    'x-ent-public.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xx PUBLIC "-//X//EN" "x.ent">]><r><i>a&xx;b</i><i>2</i></r>',
    'x-ent-nested.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "A&b;A"><!ENTITY b "B&#38;amp;B"><!ENTITY c \'say "hi"\'>]><r><i>&a;</i><i>&c;</i></r>',
    'x-ent-charref.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "&#233;t&#xE9;">]><r><i>&e;</i><i>2</i></r>',
    'x-ent-attr.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY co "Company &amp; Co"><!ENTITY q \'with "quotes"\'>]><r><i k="&co;" j=\'&q;\'>1</i><i k="x">2</i></r>',
    'x-ent-attr-lt.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY lt2 "a<b">]><r><i k="&lt2;">1</i></r>',
    'x-ent-cycle.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "&b;"><!ENTITY b "&a;">]><r><i>&a;</i></r>',
    'x-ent-twice.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "first"><!ENTITY e "second">]><r><i>&e;</i><i>2</i></r>',
    'x-ent-amplify.xml': (() => { let s = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "abcdefghij">'; let p = 'a'; for (let k = 1; k <= 3; k++) { s += '<!ENTITY e' + k + ' "' + ('&' + p + ';').repeat(10) + '">'; p = 'e' + k; } return s + ']><r><i>&' + p + ';</i><i>2</i></r>'; })(),
    'x-ent-ndata.xml': '<?xml version="1.0"?><!DOCTYPE r [<!NOTATION gif SYSTEM "gif"><!ENTITY pic SYSTEM "p.gif" NDATA gif>]><r><i>&pic;</i></r>',
    'x-ent-in-cdata.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "X">]><r><i><![CDATA[&e;]]></i><i><!-- &e; -->&e;</i></r>',
    'x-dtd-only.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ELEMENT r ANY><!-- a comment ] > --><?pi in dtd?>]><r><i>1</i><i>2</i></r>',
    'x-dtd-external.xml': '<?xml version="1.0"?><!DOCTYPE r PUBLIC "-//X//DTD X//EN" "http://example.com/x.dtd"><r><i>1</i><i>&nbsp;</i></r>',
    'x-dtd-system-subset.xml': '<?xml version="1.0"?><!DOCTYPE r SYSTEM "x.dtd" [<!ENTITY e "v">]><r><i>&e;</i><i>2</i></r>',
    'x-att-default.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ATTLIST i k CDATA "dflt" m (a|b) "b" f CDATA #FIXED "fixed" z CDATA #IMPLIED>]><r><i>1</i><i k="x" m="a">2</i></r>',
    'x-att-twice.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ATTLIST i k CDATA "one"><!ATTLIST i k CDATA "two" n NMTOKEN "  tok  ">]><r><i>1</i><i>2</i></r>',
    'x-param-entity.xml': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY % p "<!ENTITY q \'v\'>"> %p;]><r><i>&q;</i><i>2</i></r>',
  };
  // Known differences: the tool refuses these (an error), it never reads them differently
  const KNOWN = { 'x-param-entity.xml': 'parameter entities (%name;) are not read by the command-line tool' };
  for (const [name, body] of Object.entries(CASES)) fs.writeFileSync(path.join(tmp, name), body);
  for (const name of Object.keys(CASES)) {
    const full = path.join(tmp, name);
    for (const [set, q, o] of [['inline', '?mode=inline', {}], ['do not share, level 3', '?share=no', { share: 'no', level: 3 }]]) {
      const p = await open(q);
      await load(p, full);
      if (o.share === 'no' && (await result(p)).ok) await setLevel(p, 3);
      if (KNOWN[name]) { const mine = await tool(full, o); ok('awkward ' + name + ' · ' + set + ': refused by the tool (' + KNOWN[name] + ')', !mine.ok && mine.err === 'errGeneric', JSON.stringify(mine).slice(0, 200)); }
      else same('awkward ' + name + ' · ' + set, await result(p), await tool(full, o));
      await p.closeAll();
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
