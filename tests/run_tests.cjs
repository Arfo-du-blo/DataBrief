/* DataBrief end-to-end tests (headless Chrome via Puppeteer).
 *   NODE_PATH=<node_modules> node run_tests.cjs <databrief.html> <fixtures dir> <output dir>
 * Checks every format, error handling, translations, the large-file flow, downloads,
 * and that the page makes no network request at all. */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const XLSX = require('xlsx');

const [htmlPath, fixDir, outDir] = process.argv.slice(2).map((p) => path.resolve(p));
fs.mkdirSync(outDir, { recursive: true });
const url = 'file://' + htmlPath;
const F = (n) => path.join(fixDir, n);

// Extra spreadsheet formats generated from the XLSX fixture.
{
  const wb = XLSX.readFile(F('workbook.xlsx'), { cellNF: true });
  XLSX.writeFile(wb, F('workbook.xls'), { bookType: 'biff8' });
  XLSX.writeFile(wb, F('workbook.ods'), { bookType: 'ods' });
  // The same for the "Do not share data" canary workbook
  const cw = XLSX.readFile(F('CONFIDENTIAL_FILE_xlsx.xlsx'), { cellNF: true });
  XLSX.writeFile(cw, F('CONFIDENTIAL_FILE_xls.xls'), { bookType: 'biff8' });
  XLSX.writeFile(cw, F('CONFIDENTIAL_FILE_ods.ods'), { bookType: 'ods' });
}

const SPSS = [
  'Customer survey 2024', 'Gender of respondent', '1 = Male; 2 = Female; 9 = Refused', '`respondent_identifier`',
  '| 1 | Male | 34 | 2024-01-15 00:00:00 | ok | New York |', '| 4 | Refused | 28 | 2024-03-01 00:00:00 |', '97–99', 'nominal', 'scale', 'x'.repeat(300),
  'Collected by phone.', 'New York', 'Coded values are shown with their labels', 'Dates are in ISO 8601',
];
const PARQUET = ['`geo.lat`', '| 1 | 1.5 | a | true | 2024-01-01 | 2024-01-01 12:00:00 | 10.5 | ["x","y"] | 1 | 2 |', 'INT64', 'data-team', 'DATE'];
const WB = ['| 1 | ACME | 0.3 | 2024-05-01 14:30:00 | 2024-05-03 | true |', '| 2 | Globex | 1234.5 | 2024-05-02 00:00:00 |  | false |', '| 3 | Initech | -7 | 2024-05-02 09:05:07 |', 'Globex', 'separate sheet', '08:30:00'];

const CASES = [
  { file: 'ventes.csv', has: ['| Île-de-France | Café | 12,50 | 2024-01-15 | Très bon; à refaire |', 'ligne 1<br>ligne 2', 'dit "super"', '**Delimiter:** `;`', '| `montant` | decimal |'] },
  { file: 'latin1.csv', has: ['Besançon', 'Nîmes', 'Windows-1252'] },
  { file: 'data.tsv', has: ['| 1 | Alice | true |', '| `active` | boolean |'] },
  { file: 'nohead.txt', has: ['`column_1`', 'No header row was found in section(s) 1', '| 0 | 0.0 | 2020-06-01 |'] },
  { file: 'workbook.xlsx', has: WB.concat(['Hidden sheet', '`C2`: Arfo: Includes VAT', 'This section is empty.', 'merged']) },
  { file: 'workbook.xls', has: WB },
  { file: 'workbook.ods', has: WB },
  { file: 'nested.json', has: ['`(root)`', '`customers`', '`orders`', '`address.city`', '["vip","eu"]', 'meta.source', 'Column names like `a.b.c`', '| 11 | 2 |  |'] },
  { file: 'events.ndjson', has: ['`ctx.user`', '2024-01-01T10:00:00Z'] },
  { file: 'catalog.xml', has: ['`books.book`', '`@id`', '`price.@currency`', '`author.name`', 'Herbert', 'XML attributes', '`<catalog>`'] },
  { file: 'team.yaml', has: ['`members`', '2023-04-01', '["sql","python"]', '| data |'] },
  { file: 'page.html', has: ['Quarterly KPIs', '`Sales / Q1`', '9<br>(est.)', 'a\\|b', 'Merged cells were expanded', '| North | 10 | 12 |', '1 table(s) that contain other tables were skipped'], not: ['alert(1)', 'layout'] },
  { file: 'multi.yaml', has: ['Each document is one row, in the order of the file', '| Service | web | 80 |  |', '| Deployment | web |  | 3 |', '| Service | db | 5432 |  |'] },
  { file: 'survey.sav', has: SPSS },
  { file: 'survey_bytecode.sav', has: SPSS },
  { file: 'survey.zsav', has: SPSS },
  { file: 'table_snappy.parquet', has: PARQUET },
  { file: 'table_gzip.parquet', has: PARQUET },
  { file: 'table_zstd.parquet', has: PARQUET },
  { file: 'table_lz4.parquet', has: PARQUET },
  { file: 'table_none.parquet', has: PARQUET },
  { file: 'table_brotli.parquet', error: /compression|Parquet/ },
  { file: 'shop.sqlite', has: ['`customers`', '`orders`', 'primary key', '→ `customers.id`', '`big_orders`', '[binary 4 bytes]', '| `name` | text | TEXT |  | yes |', 'separate table'] },
  // Relationships. Declared ones (SQLite): composite, implicit, self-reference, one to one, junction (many to many), no inferred noise.
  { file: 'schema_features.sqlite', has: [
    '## Relationships', '**Declared by the source:**',
    '| `child` (`a`, `b`) | `parent` (`k1`, `k2`) | many to one | on delete: CASCADE |',
    '| `refs` (`sid`) | `singles` (`id`) | many to one |  |',
    '| `people` (`manager_id`) | `people` (`id`) | many to one | self-reference |',
    '| `people_tags` (`person_id`) | `people` (`id`) | many to one |  |',
    '| `profiles` (`person_id`) | `people` (`id`) | one to one |  |',
    '| `people` (`id`) | `tags` (`id`) | many to many | via `people_tags` |',
  ], not: ['**Inferred candidates'] },
  // Inferred ones (no declared relationship): names must correspond, values are compared, the best parent wins, nothing is invented.
  { file: 'relations.xlsx', has: [
    '**Inferred candidates (not declared by the source, to be validated before relying on them):**',
    '| `orders` (`customer_id`) | `customers` (`id`) | many to one | high |',
    '| `order_lines` (`order_id`) | `orders` (`order_id`) | many to one | high |',
    '| `order_lines` (`product_id`) | `products` (`product_id`) | many to one | high |',
    '| `profiles` (`customer_id`) | `customers` (`id`) | one to one | high |',
    '| `visits` (`customer_id`) | `customers` (`id`) | many to one | medium |',
    'the column names correspond; 100% of the distinct values exist in the parent column; the parent column is unique',
    '60% of the distinct values exist in the parent column',
  ], not: ['`audit` (`customer_id`)', '| `orders` (`customer_id`) | `profiles`', '**Declared by the source:**'] },
  // Regression tests for the Excel gaps of the audit: formulas without a stored result (used to be dropped, or shown as 0),
  // merged cells, hidden rows and columns, defined names.
  { file: 'features.xlsx', has: [
    '| pen | 2 | 1.5 |  |', '| note | merged value |  |  |',
    '**Formula cells:** 3 · without a stored result, shown empty: 3', '- `D2`: `=B2*C2`',
    '**Merged cells (the value is in the top-left cell only):** `B5:C5`', '**Hidden rows:** 3', '**Hidden columns:** C',
    '**Defined names:** `TotalQty` → `Sales!$B$2:$B$4`',
  ], not: ['| pen | 2 | 1.5 | 0 |'] },
  // Regression tests for confirmed defects (audit P1-P5): nested types, LIST and MAP, required fields, decimals, units,
  // columns taken from the schema (a null struct adds no column; a map is one column), pandas metadata, file layout.
  { file: 'nested.parquet', has: [
    '| `id` | integer | yes | INT64 |', '| `name` | text |  | BYTE_ARRAY / STRING |',
    '| `when` | date-time |  | INT64 / TIMESTAMP (MICROS, UTC) |', '| `price` | decimal |  | FIXED_LEN_BYTE_ARRAY / DECIMAL (12,3) |',
    '| `geo.lat` | decimal |  | DOUBLE |', '| `geo.lon` | decimal |  | DOUBLE |',
    '| `geo.meta.src` | text |  | BYTE_ARRAY / STRING |', '| `geo.meta.acc` | decimal |  | FLOAT |',
    '| `tags` | text |  | LIST<BYTE_ARRAY / STRING> |', '| `items` | text |  | LIST<STRUCT<sku: BYTE_ARRAY / STRING, qty: INT32>> |',
    '| `attrs` | text |  | MAP<BYTE_ARRAY / STRING, INT64> |',
    '| 1 | a | 2024-01-01 12:00:00 | 10.5 | 1.5 | 2.5 | gps | 0.5 | ["x","y"] | [{"sku":"A1","qty":2},{"sku":"B2","qty":1}] | {"k1":1,"k2":2} |',
    '| 2 |  |  | 0.125 | 3.5 | 4.5 |  |  |  |  |  |',
    '| 3 | c | 2024-03-05 08:30:00 |  |  |  |  |  |  |  |  |',
    '`pandas`: ', 'rowkey', 'int64', '**Row groups:** 2 (2 + 1 rows)', '**Compression:** SNAPPY',
  ], not: ['| `geo` |', '`attrs.k1`', 'GROUP'] },
  // Regression tests for confirmed defects (audit S1-S6): generated columns, composite keys, 64-bit integers,
  // implicit foreign-key targets, constraints, indexes, table and view definitions.
  { file: 'schema_features.sqlite', has: [
    '| 1 | 1 | 2 | 3 | 6 | 4 |', '| 2 | 1 | 1 | 4 | 8 | 5 |', ' | Generated |', '| virtual |', '| stored |',
    '9007199254740993', '-9223372036854775808', '9223372036854775807',
    '**Primary key:** `k1`, `k2`', '**Primary key:** `y`, `x`', '**Primary key:** `id`',
    '- (`a`, `b`) → `parent` (`k1`, `k2`) · on delete: CASCADE', '→ `singles.id`', '- (`sid`) → `singles` (`id`)',
    '**Unique constraints and indexes:** `child_qty_a_uq` (`qty`, `a`)', '**Other indexes:** `child_a_ix` (`a`)',
    '**Definition:**', 'CHECK (qty >= 0)', 'GENERATED ALWAYS AS (qty * 2) VIRTUAL',
    '## Views (saved queries, not included as data)', '### `v_child`', 'CREATE VIEW v_child AS SELECT id, a FROM child WHERE qty > 0',
  ], not: ['9007199254740992', '→ `singles.?`'] },
  { file: 'big.csv', big: true },
  { file: 'unknown.xyz', error: /not supported/ },
  { file: 'fake.xlsx', error: /does not match/ },
];

const results = [];
const fail = (name, msg) => results.push({ name, ok: false, msg });
const pass = (name, msg) => results.push({ name, ok: true, msg: msg || '' });

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const external = [];
  const fileRequests = new Set();
  const problems = [];

  async function newPage() {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith('data:') || u.startsWith('blob:')) return;
      if (u.startsWith('file://')) { fileRequests.add(u); return; }
      external.push(u);
    });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/^(Error|UserError)/.test(m.text()) && !m.text().includes('JSHandle')) problems.push('console: ' + m.text()); });
    await page.goto(url, { waitUntil: 'load' });
    // Start every page from a clean state (English, default theme): settings are kept in localStorage.
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });
    await page.reload({ waitUntil: 'load' });
    return page;
  }

  async function newPageAt(u) {
    const page = await browser.newPage();
    page.on('request', (r) => {
      const x = r.url();
      if (x.startsWith('data:') || x.startsWith('blob:') || x.startsWith('file://')) return;
      external.push(x);
    });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    await page.goto(u, { waitUntil: 'load' });
    return page;
  }
  const BLOCK_RE = /<script id="databrief-config" type="application\/json">([\s\S]*?)<\/script>/;

  async function load(page, file) {
    const input = await page.$('#fileInput');
    await input.uploadFile(file);
    await page.waitForFunction((name) => (!document.getElementById('result').classList.contains('hidden') &&
      document.getElementById('fileName').textContent === name) ||
      !document.getElementById('errorBox').classList.contains('hidden'), { timeout: 120000 }, path.basename(file));
    return page.evaluate(() => ({
      ok: !document.getElementById('result').classList.contains('hidden'),
      md: window.DataBrief.getMarkdown(),
      err: document.getElementById('errorMsg').textContent,
      detail: document.getElementById('errorCode').textContent,
      tokens: document.getElementById('stTokens').textContent,
      warn: !document.getElementById('warnBox').classList.contains('hidden'),
      csp: window.__csp,
    }));
  }

  // ---------- formats ----------
  for (const c of CASES) {
    const page = await newPage();
    const t0 = Date.now();
    let r;
    try { r = await load(page, F(c.file)); } catch (e) { fail(c.file, 'timeout/exception: ' + e.message); await page.close(); continue; }
    const ms = Date.now() - t0;
    if (r.ok) fs.writeFileSync(path.join(outDir, c.file + '.md'), r.md);
    if (r.csp.length) fail(c.file + ' CSP', r.csp.join('; '));
    if (c.error) {
      if (!r.ok && c.error.test(r.err + ' ' + r.detail)) pass(c.file, 'error shown: ' + r.err);
      else fail(c.file, r.ok ? 'expected an error, got a result' : 'unexpected error text: ' + r.err + ' / ' + r.detail);
    } else if (!r.ok) {
      fail(c.file, 'error: ' + r.err + ' / ' + r.detail);
    } else if (c.big) {
      if (!r.warn) fail(c.file, 'warning not shown (' + r.tokens + ')');
      else {
        const before = r.tokens;
        await page.click('#limitOn');
        await new Promise((res) => setTimeout(res, 300));
        const after = await page.evaluate(() => ({ t: document.getElementById('stTokens').textContent, md: window.DataBrief.getMarkdown(), n: document.getElementById('limitN').value, shown: document.getElementById('limitShown').textContent }));
        await page.$eval('#limitN', (el) => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await new Promise((res) => setTimeout(res, 600));
        const after50 = await page.evaluate(() => ({ t: document.getElementById('stTokens').textContent, md: window.DataBrief.getMarkdown() }));
        const num = (s) => parseInt(s.replace(/[^\d]/g, ''), 10);
        const lines50 = after50.md.split('\n').filter((l) => /^(\| )?\d+( \| |,)item number/.test(l)).length;
        if (num(after.t) < num(before) && num(after.t) <= 150000 && after.md.includes('**Partial data:**') && lines50 === 50 && num(after50.t) < num(after.t)) {
          pass(c.file, `warn ok; ${before} → ${after.t} (suggested N=${after.n}, ${after.shown}) → N=50: ${after50.t}; ${ms} ms`);
        } else fail(c.file, `limit flow wrong: ${before} → ${after.t}, N=${after.n}, rows at 50 = ${lines50}, ${after50.t}`);
      }
    } else {
      const missing = (c.has || []).filter((s) => !r.md.includes(s));
      const unwanted = (c.not || []).filter((s) => r.md.includes(s));
      if (missing.length || unwanted.length) fail(c.file, 'missing: ' + JSON.stringify(missing) + (unwanted.length ? ' unwanted: ' + JSON.stringify(unwanted) : ''));
      else pass(c.file, `${r.tokens}, ${ms} ms`);
    }
    await page.close();
  }

  // ---------- translations ----------
  {
    const page = await newPage();
    const info = await page.evaluate(() => {
      const I = window.DB_I18N;
      const out = {};
      for (const part of ['ui', 'prompt']) {
        const ref = Object.keys(I[part].en);
        for (const l of I.langs) {
          const have = I[part][l.code] || {};
          const missing = ref.filter((k) => !(k in have));
          const extra = Object.keys(have).filter((k) => !(k in I[part].en));
          const ph = ref.filter((k) => k in have && (String(I[part].en[k]).match(/\{\w+\}/g) || []).sort().join() !== (String(have[k]).match(/\{\w+\}/g) || []).sort().join());
          if (missing.length || extra.length || ph.length) out[part + ':' + l.code] = { missing, extra, placeholders: ph };
        }
      }
      return { problems: out, langs: I.langs.map((l) => l.code) };
    });
    if (Object.keys(info.problems).length) fail('i18n keys', JSON.stringify(info.problems));
    else pass('i18n keys', info.langs.length + ' languages complete (ui + prompt, placeholders match)');

    await load(page, F('shop.sqlite'));
    const titles = await page.evaluate(() => Object.fromEntries(Object.entries(window.DB_I18N.prompt).map(([k, v]) => [k, v.title.split('`')[0]])));
    const bad = [];
    for (const code of info.langs) {
      await page.select('#uiLang', code);
      const s = await page.evaluate(() => ({
        lang: document.documentElement.lang, dir: document.documentElement.dir, prompt: document.getElementById('promptLang').value,
        md: window.DataBrief.getMarkdown().slice(0, 200), empty: Array.from(document.querySelectorAll('[data-i18n]')).filter((e) => !e.textContent.trim()).map((e) => e.dataset.i18n),
      }));
      if (s.lang !== code || s.prompt !== code || !s.md.startsWith('# ' + titles[code]) || (code === 'ar') !== (s.dir === 'rtl') || s.empty.length) bad.push(code + ':' + JSON.stringify(s).slice(0, 200));
      if (['ar', 'ja', 'hi'].includes(code)) await page.screenshot({ path: path.join(outDir, `ui_${code}.png`), fullPage: true });
    }
    if (bad.length) fail('i18n switching', bad.join(' | '));
    else pass('i18n switching', 'interface + prompt follow the selected language; Arabic is RTL');
    // prompt language independent of the interface
    await page.select('#uiLang', 'fr');
    await page.select('#promptLang', 'de');
    const mix = await page.evaluate(() => ({ ui: document.querySelector('[data-i18n="copy"]').textContent, md: window.DataBrief.getMarkdown().slice(0, 40) }));
    if (mix.ui === 'Copier' && mix.md.startsWith('# Geteilte Datendatei')) pass('prompt language selector', 'UI fr + prompt de');
    else fail('prompt language selector', JSON.stringify(mix));
    await page.close();
  }

  // ---------- data profile (optional: off by default, switched on with the checkbox) ----------
  {
    const page = await newPage();
    const first = await load(page, F('profile.csv'));
    const offByDefault = !first.md.includes('## Data profile');
    await page.click('#profileOn');
    await new Promise((res) => setTimeout(res, 400));
    const md = await page.evaluate(() => window.DataBrief.getMarkdown());
    const expected = [
      '## Data profile', 'Statistics computed from all rows (observed facts). The kind of each column is an inference.',
      '| Column | Kind | Missing | Distinct | Summary |',
      '| `id` | identifier (candidate) | 0 | 10 |  |',
      '| `group` | categorical | 0 | 3 | A: 5 (50%) · B: 4 (40%) · C: 1 (10%) |',
      '| `score` | continuous | 0 | 2 | min: 1.5 · max: 11.5 · mean: 2.5 · standard deviation: 3.16228 · median: 1.5 · beyond 1.5 × IQR: 1 |',
      '| `day` | date/time | 0 | 10 | min: 2024-01-01 · max: 2024-01-10 |',
      '| `note` | text | 0 | 10 |  |',
      '| `flag` | categorical | 0 | 1 | x: 10 (100%) |',
      '| `mix` | mixed types | 0 | 4 |  |',
      '| `empty` | empty | 10 (100%) | 0 |  |',
      '| `price_fr` | continuous | 0 | 10 | min: 3.5 · max: 12.5 · mean: 7.87 · standard deviation:',
      '| `amb` | continuous | 0 | 10 | numbers in an ambiguous format, not summarised |',
      '**Constant columns:** `flag`',
    ];
    const missing = expected.filter((s) => !md.includes(s));
    await page.click('#profileOn');
    await new Promise((res) => setTimeout(res, 300));
    const offAgain = !(await page.evaluate(() => window.DataBrief.getMarkdown())).includes('## Data profile');
    if (offByDefault && !missing.length && offAgain) pass('data profile', 'off by default; every kind of column; switches off again');
    else fail('data profile', (offByDefault ? '' : 'on by default; ') + (offAgain ? '' : 'did not switch off; ') + 'missing: ' + JSON.stringify(missing));
    await page.close();

    const page2 = await newPage();
    await load(page2, F('dupes.csv'));
    await page2.click('#profileOn');
    await new Promise((res) => setTimeout(res, 300));
    const md2 = await page2.evaluate(() => window.DataBrief.getMarkdown());
    if (md2.includes('**Duplicate rows:** 1')) pass('data profile: duplicate rows', '1 duplicate row found');
    else fail('data profile: duplicate rows', md2.slice(md2.indexOf('## Data profile'), md2.indexOf('## Data profile') + 400));
    await page2.close();
  }

  // ---------- "Do not share data": no record in any output, at any level; the structure stays ----------
  {
    const CANARIES = ['CONFIDENTIAL_CUSTOMER_74291', 'ana.secret@example.com', 'CONFIDENTIAL_SEGMENT_X', 'CONFIDENTIAL_NOTE_123', 'CONFIDENTIAL_EDIT_555'];
    const checks = [];
    const ok = (cond, msg) => { if (!cond) checks.push(msg); };
    const leaks = (text) => CANARIES.filter((c) => String(text).includes(c));
    const md = (p) => p.evaluate(() => window.DataBrief.getMarkdown());
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 300));
    const stateJson = (p) => p.evaluate(() => JSON.stringify(window.DataBrief.getState(), (k, v) => (typeof v === 'bigint' ? String(v) : v)));

    const page = await newPage();
    const dl = path.join(outDir, 'downloads_ns');
    fs.rmSync(dl, { recursive: true, force: true });
    fs.mkdirSync(dl, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    await page.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); }; });

    const normal = await load(page, F('confidential.csv'));
    ok(normal.md.includes('CONFIDENTIAL_CUSTOMER_74291'), 'normal mode should contain the data (sanity check)');
    // An edit made in normal mode with a record in it must never appear in the no-share prompt.
    await page.evaluate(() => { window.DataBrief.getState().edits.inline.respond = 'CONFIDENTIAL_EDIT_555'; });

    await page.click('#nsOn'); await wait();
    const l1 = await md(page);
    ok(l1.startsWith('# Analysis planning request (data not shared): `confidential.csv`'), 'L1 title');
    ok(l1.includes('| `customer` |') && l1.includes('| `segment` |') && l1.includes('You have **not** received the records'), 'L1 structure and constraint');
    ok(l1.includes('structure only (no statistics)') && !l1.includes('## Statistics') && !l1.includes('gold'), 'L1 has no statistics and no category');
    ok(!leaks(l1).length, 'L1 leaks ' + leaks(l1));
    ok(await page.evaluate(() => window.DataBrief.getState().doc === null), 'the parsed rows should be released (state.doc null)');
    // The page state may keep the user's own normal-mode edit (restored if they share again), never a record.
    const st = await stateJson(page);
    ok(!leaks(st).filter((c) => c !== 'CONFIDENTIAL_EDIT_555').length, 'page state leaks ' + leaks(st));
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('modeBox')).display === 'none'), 'data mode choice should be hidden');

    await page.click('#nsLevelGroup button[data-level="2"]'); await wait();
    const l2 = await md(page);
    ok(l2.includes('| `segment` | categorical | 0 | 3 |') && l2.includes('| `customer` | identifier (candidate) | 0 |  |'), 'L2 counts (distinct for categorical only)');
    ok(!l2.includes('gold') && !leaks(l2).length, 'L2 leaks ' + leaks(l2));

    await page.click('#nsLevelGroup button[data-level="3"]'); await wait();
    const l3 = await md(page);
    ok(l3.includes('gold: 6 (50%) · hidden groups: 6') && !l3.includes('silver'), 'L3 categories: the small group hidden, plus one more so it cannot be worked out by subtraction');
    ok(!leaks(l3).length, 'L3 leaks ' + leaks(l3));
    ok(await page.evaluate(() => !document.getElementById('nsL3Warn').classList.contains('hidden')), 'L3 warning shown');

    // Every output: preview, formatted view, clipboard, download, data buttons (hidden, and inert if clicked)
    ok(!leaks(await page.$eval('#preview', (el) => el.textContent)).length, 'preview leaks');
    await page.click('#viewBtn'); await wait();
    ok(!leaks(await page.$eval('#mdBody', (el) => el.innerHTML)).length, 'formatted view leaks');
    await page.evaluate(() => document.getElementById('mdDialog').close());
    await page.click('#copyBtn'); await wait();
    const clip = await page.evaluate(() => window.__clip[window.__clip.length - 1] || '');
    ok(clip === l3 && !leaks(clip).length, 'clipboard leaks or differs from the prompt');
    await page.click('#downloadBtn'); await wait(800);
    await page.evaluate(() => { document.getElementById('dataBtn').click(); document.getElementById('allBtn').click(); }); await wait(800);
    const files = fs.readdirSync(dl);
    ok(files.length === 1 && files[0].endsWith('.md'), 'only the .md should be downloaded, got ' + files.join(', '));
    if (files[0]) ok(!leaks(fs.readFileSync(path.join(dl, files[0]), 'utf8')).length, 'downloaded file leaks');

    // Switches: neutral names, hidden file name; another prompt language
    await page.evaluate(() => { document.querySelector('[data-sw="names"]').click(); document.querySelector('[data-sw="file"]').click(); }); await wait();
    const anon = await md(page);
    ok(anon.includes('`table_1`') && anon.includes('`column_1`') && !anon.includes('`customer`') && !anon.includes('confidential.csv') && anon.includes('dataset.csv'), 'neutral names and hidden file name');
    await page.select('#promptLang', 'fr'); await wait();
    const fr = await md(page);
    ok(fr.startsWith('# Demande d') && !leaks(fr).length, 'French no-share prompt');
    await page.evaluate(() => { document.querySelector('[data-sw="names"]').click(); document.querySelector('[data-sw="file"]').click(); });
    await page.select('#promptLang', 'en'); await wait();

    // Leaving asks first; "Keep my data out" keeps it; "Include my data" reads the file again (edits kept)
    await page.click('#nsOn'); await wait();
    ok(await page.evaluate(() => document.getElementById('nsLeaveDialog').open), 'leave dialog should open');
    await page.click('#nsLeaveNo'); await wait();
    ok(await page.evaluate(() => document.getElementById('nsOn').checked) && (await md(page)).includes('(data not shared)'), '"keep my data out" should stay in no-share');
    await page.click('#nsOn'); await wait();
    await page.click('#nsLeaveYes');
    await page.waitForFunction(() => window.DataBrief.getMarkdown().includes('CONFIDENTIAL_CUSTOMER_74291'), { timeout: 20000 }).catch(() => {});
    const back = await md(page);
    ok(back.includes('CONFIDENTIAL_CUSTOMER_74291') && back.includes('CONFIDENTIAL_EDIT_555'), 'back to normal: data again and the normal edit kept');

    // Remembered: after a reload the page is still in no-share mode
    await page.click('#nsOn'); await wait();
    await page.reload({ waitUntil: 'load' });
    const again = await load(page, F('confidential.csv'));
    ok(again.md.includes('(data not shared)') && !leaks(again.md).length, 'no-share should be remembered after a reload');
    // Errors in no-share mode carry no technical details (they can quote the file)
    const bad = await load(page, F('fake.xlsx'));
    ok(!bad.ok && bad.detail === '', 'no technical details in no-share errors, got: ' + bad.detail);
    await page.close();

    // A link can switch it on (?share=no), never off (?share=yes)
    const p2 = await newPage();
    await p2.goto(url + '?share=no', { waitUntil: 'load' });
    ok((await load(p2, F('confidential.csv'))).md.includes('(data not shared)'), '?share=no should switch it on');
    await p2.goto(url + '?share=yes', { waitUntil: 'load' });
    ok((await load(p2, F('confidential.csv'))).md.includes('(data not shared)'), '?share=yes must not switch it off');
    await p2.evaluate(() => localStorage.clear());
    await p2.close();

    // Team lock: no-share imposed, the switch is hidden and cannot be turned off
    const BLOCK = /(<script id="databrief-config" type="application\/json">)[\s\S]*?(<\/script>)/;
    const lockedFile = path.join(outDir, 'cfg_noshare_locked.html');
    fs.writeFileSync(lockedFile, fs.readFileSync(htmlPath, 'utf8').replace(BLOCK, (m, a, b) => a + '\n{"share":"no","lock":["share"]}\n' + b));
    const p3 = await newPageAt('file://' + lockedFile);
    await p3.evaluate(() => localStorage.clear()); await p3.reload({ waitUntil: 'load' });
    const locked = await load(p3, F('confidential.csv'));
    ok(locked.md.includes('(data not shared)'), 'team lock should impose no-share');
    ok(await p3.evaluate(() => document.getElementById('nsToggleWrap').classList.contains('locked-hidden') && !document.getElementById('nsTeam').classList.contains('hidden')), 'locked: switch hidden, team note shown');
    await p3.evaluate(() => { const x = document.getElementById('nsOn'); x.checked = false; x.dispatchEvent(new Event('change')); }); await wait();
    ok((await md(p3)).includes('(data not shared)') && !(await p3.evaluate(() => document.getElementById('nsLeaveDialog').open)), 'locked: cannot be turned off');
    await p3.close();

    // A database with neutral names: relationships keep their shape, the real names disappear
    const p4 = await newPage();
    await p4.click('#nsOn').catch(() => {});
    await load(p4, F('schema_features.sqlite'));
    await p4.click('#nsOn'); await wait();
    await p4.evaluate(() => document.querySelector('[data-sw="names"]').click()); await wait();
    const db = await md(p4);
    ok(db.includes('many to many') && db.includes('`table_') && !db.includes('people_tags') && !db.includes('CREATE TABLE'), 'database with neutral names: relationships kept, no real names, no SQL');
    await p4.evaluate(() => localStorage.clear());
    await p4.close();

    if (checks.length) fail('do not share data', checks.join(' | '));
    else pass('do not share data', '3 levels, every output checked (prompt, preview, formatted view, clipboard, download, state), switches, leave dialog, reload, URL, team lock, errors');
  }

  // ---------- "Do not share data": every format ----------
  // Canary values (see tests/make_fixtures.py): records and formula literals never; free text, SQL literals, names, labels and the
  // file name only when the user allows them. Each "only when allowed" rule also has a positive control, so a test cannot pass
  // just because nothing was ever there.
  {
    const FILES = [
      { f: 'csv.csv' }, { f: 'tsv.tsv' }, { f: 'txt.txt' },
      { f: 'xlsx.xlsx', txt: true, frm: true }, { f: 'xls.xls' }, { f: 'ods.ods' },
      { f: 'json.json' }, { f: 'ndjson.ndjson' }, { f: 'yaml.yaml' }, { f: 'xml.xml' }, { f: 'html.html', cap: true },
      { f: 'sav.sav', txt: true, lab: true }, { f: 'zsav.zsav', txt: true, lab: true },
      { f: 'parquet.parquet', txt: true }, { f: 'sqlite.sqlite', sql: true },
    ];
    const checks = [];
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 150));
    const md = (p) => p.evaluate(() => window.DataBrief.getMarkdown());
    const sw = (p, name) => p.evaluate((n) => document.querySelector('[data-sw="' + n + '"]').click(), name);
    for (const c of FILES) {
      const label = c.f.split('.')[0];
      const bad = (msg) => checks.push(label + ': ' + msg);
      const page = await newPage();
      const first = await load(page, F('CONFIDENTIAL_FILE_' + c.f));
      if (!first.ok) { bad('could not be read: ' + first.err); await page.close(); continue; }
      if (!first.md.includes('CONFIDENTIAL_REC')) bad('normal mode should contain the records (control)');
      if (c.frm && !first.md.includes('CONFIDENTIAL_FORMULA')) bad('normal mode should show the formula (control)');
      await page.click('#nsOn'); await wait(300);
      const never = (s, where) => { for (const k of ['CONFIDENTIAL_REC', 'CONFIDENTIAL_FORMULA']) if (s.includes(k)) bad(k + ' in ' + where); };
      const notByDefault = (s, where) => { for (const k of ['CONFIDENTIAL_TEXT', 'CONFIDENTIAL_SQL']) if (s.includes(k)) bad(k + ' in ' + where); };
      for (const level of [1, 2, 3]) {
        await page.click('#nsLevelGroup button[data-level="' + level + '"]'); await wait();
        const s = await md(page);
        never(s, 'level ' + level); notByDefault(s, 'level ' + level);
        if (level === 1) {
          if (!s.includes('CONFIDENTIAL_COL')) bad('names should be present at level 1 (control)');
          if (!s.includes('CONFIDENTIAL_FILE')) bad('file name should be present by default (control)');
          if (c.lab && !s.includes('CONFIDENTIAL_LABEL')) bad('labels should be present by default (control)');
        }
      }
      // level 3 (the most permissive): the other outputs of the page
      never(await page.$eval('#preview', (el) => el.textContent), 'preview');
      never(await page.evaluate(() => JSON.stringify(window.DataBrief.getState(), (k, v) => (typeof v === 'bigint' ? String(v) : v))), 'page state');
      // file name off alone (a section can be named after the file), then names off alone
      await sw(page, 'file'); await wait();
      let s = await md(page);
      never(s, 'file name off'); notByDefault(s, 'file name off');
      if (s.includes('CONFIDENTIAL_FILE')) bad('file name should be hidden when off, even with names on');
      await sw(page, 'file');
      await sw(page, 'names'); await wait();
      s = await md(page);
      never(s, 'names off'); notByDefault(s, 'names off');
      if (s.includes('CONFIDENTIAL_COL')) bad('names should be replaced when off');
      await sw(page, 'names');
      if (c.cap) { // a table named by its caption: the caption is a label
        await sw(page, 'labels'); await wait(); s = await md(page);
        if (s.includes('CONFIDENTIAL_COL_CAPTION')) bad('a caption used as table name should be hidden when labels are off');
        await sw(page, 'labels');
      }
      if (c.lab) {
        await sw(page, 'labels'); await wait(); s = await md(page);
        never(s, 'labels off');
        if (s.includes('CONFIDENTIAL_LABEL')) bad('labels should be hidden when off');
        await sw(page, 'labels');
      }
      await sw(page, 'text'); await wait(); s = await md(page);
      never(s, 'free text on');
      if (c.txt && !s.includes('CONFIDENTIAL_TEXT')) bad('free text should appear when allowed (control)');
      await sw(page, 'text');
      await sw(page, 'sql'); await wait(); s = await md(page);
      never(s, 'SQL on');
      if (c.sql && !s.includes('CONFIDENTIAL_SQL')) bad('SQL definitions should appear when allowed (control)');
      await page.evaluate(() => localStorage.clear());
      await page.close();
    }
    if (checks.length) fail('do not share data: every format', checks.join(' | '));
    else pass('do not share data: every format', FILES.length + ' formats x 3 levels x switches: no record, formula, free text, SQL, name, label or file name beyond what is allowed');
  }

  // ---------- "Do not share data": regression tests for the findings of the independent review ----------
  {
    const checks = [];
    const ok = (cond, msg) => { if (!cond) checks.push(msg); };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 200));
    const md = (p) => p.evaluate(() => window.DataBrief.getMarkdown());
    const level = async (p, n) => { await p.click('#nsLevelGroup button[data-level="' + n + '"]'); await p.waitForFunction((x) => window.DataBrief.getState().nsLevel === x && !window.DataBrief.getState().busy, {}, n); await wait(); };
    const nsPage = async (file, lv) => {
      const p = await newPage();
      await p.click('#nsOn'); await wait(); // set before the file is read (the switch is next to the drop zone)
      await load(p, F(file));
      if (lv && lv > 1) await level(p, lv);
      return p;
    };

    // 8: the switch is reachable before any file is read, and then the rows are never kept
    {
      const p = await newPage();
      ok(await p.evaluate(() => document.getElementById('nsOn').offsetParent !== null), '8: switch not visible before a file is read');
      await p.click('#nsOn'); await wait();
      const r = await load(p, F('confidential.csv'));
      ok(r.md.includes('(data not shared)') && await p.evaluate(() => window.DataBrief.getState().doc === null), '8: switched on before reading: no-share prompt, no rows kept');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 1: a file without header row: the first record is not used as column names
    {
      const p = await nsPage('headerless.csv');
      const s = await md(p);
      ok(!s.includes('CONFIDENTIAL_REC') && s.includes('`column_1`') && s.includes('Some names that look like data'), '1: headerless CSV leaks its first record as column names');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 2: level 3 shows no range for a column with only 1 or 2 values
    {
      const p = await nsPage('fewvalues.csv', 3);
      const s = await md(p);
      ok(!/987654|111111|222222|2019-03-14/.test(s), '2: a column with 1-2 values shows them at level 3');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 3: a "date" with text after it is not printed as a range (even beyond the type-detection window)
    {
      const p = await nsPage('longdates.csv', 3);
      ok(!(await md(p)).includes('CONFIDENTIAL_REC'), '3: text after a date leaks through the date range');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 5: page state: no file handle, no error details, no statistics the level does not allow
    {
      const p = await nsPage('confidential.csv');
      const st1 = await p.evaluate(() => { const s = window.DataBrief.getState(); return { file: s.file, prof: s.ns.sections.every((x) => x.profile === null) }; });
      ok(st1.file === null && st1.prof, '5: at level 1 the state holds a file handle or statistics');
      await level(p, 2);
      ok(await p.evaluate(() => window.DataBrief.getState().ns.sections.every((x) => x.profile && x.profile.columns.every((c) => !c.summary))), '5: at level 2 the state holds summaries (values)');
      await level(p, 3);
      ok(await p.evaluate(() => window.DataBrief.getState().ns.sections.some((x) => x.profile && x.profile.columns.some((c) => c.summary))), '5: level 3 should have summaries (control)');
      await level(p, 1);
      ok(await p.evaluate(() => window.DataBrief.getState().ns.sections.every((x) => x.profile === null)), '5: going back to level 1 should drop the statistics');
      const bad = await load(p, F('broken.json'));
      const err = await p.evaluate(() => JSON.stringify(window.DataBrief.getState().lastErr));
      ok(!bad.ok && !err.includes('CONFIDENTIAL_REC') && bad.detail === '', '5: error details reach the state or the screen: ' + err);
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 6: embedded pandas metadata lists the real column names: hidden when names are off, even with free text on
    {
      const p = await nsPage('nested.parquet');
      await p.evaluate(() => { document.querySelector('[data-sw="names"]').click(); document.querySelector('[data-sw="text"]').click(); }); await wait();
      const s = await md(p);
      ok(!s.includes('rowkey') && !s.includes('`geo.lat`'), '6: pandas metadata or nested names leak with names off');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 7: JSON keys that are data (e-mails) are not shown as column names
    {
      const p = await nsPage('mapkeys.json');
      const s = await md(p);
      ok(!s.includes('@example.org') && s.includes('scores.key'), '7: data keys shown as names');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 9: one hidden group could be worked out by subtraction: one more group is hidden
    {
      const p = await nsPage('flags.csv', 3);
      const s = await md(p);
      ok(!s.includes('false: 27') && s.includes('hidden groups: 30'), '9: a hidden group can be worked out by subtraction');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 10, 16: settings fail closed; a team default "no" wins over a stored "yes"
    {
      const BLOCK = /(<script id="databrief-config" type="application\/json">)[\s\S]*?(<\/script>)/;
      const variant = (name, cfg) => { const f = path.join(outDir, name); fs.writeFileSync(f, fs.readFileSync(htmlPath, 'utf8').replace(BLOCK, (m, a, b) => a + '\n' + cfg + '\n' + b)); return 'file://' + f; };
      for (const [name, cfg] of [['cfg_share_NO.html', '{"share":"NO"}'], ['cfg_share_false.html', '{"share":"false"}']]) {
        const p = await newPage(); await p.goto(variant(name, cfg), { waitUntil: 'load' });
        ok((await load(p, F('confidential.csv'))).md.includes('(data not shared)'), '10: ' + cfg + ' should mean "do not share"');
        await p.evaluate(() => localStorage.clear()); await p.close();
      }
      const p = await newPage(); await p.goto(url + '?share=0', { waitUntil: 'load' });
      ok((await load(p, F('confidential.csv'))).md.includes('(data not shared)'), '10: ?share=0 should mean "do not share"');
      await p.evaluate(() => localStorage.setItem('databrief.share', 'yes'));
      await p.goto(variant('cfg_share_no.html', '{"share":"no"}'), { waitUntil: 'load' });
      ok((await load(p, F('confidential.csv'))).md.includes('(data not shared)'), '16: a stored "yes" overrides the team default "no"');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    // 12: inferred relationships (computed from the values) are not at level 1; their ratios only at level 3
    {
      const p = await nsPage('relations.xlsx');
      const s1 = await md(p);
      await level(p, 2); const s2 = await md(p);
      await level(p, 3); const s3 = await md(p);
      ok(!s1.includes('Inferred candidates') && s1.includes('Relationships inferred by comparing the values'), '12: inferred relationships at level 1');
      ok(s2.includes('Inferred candidates') && !s2.includes('% of the distinct values'), '12: level 2 should list them without ratios');
      ok(s3.includes('% of the distinct values'), '12: level 3 should give the ratios');
      await p.evaluate(() => localStorage.clear()); await p.close();
    }
    if (checks.length) fail('do not share data: review findings', checks.join(' | '));
    else pass('do not share data: review findings', 'headerless files, few values, dates with text, page state per level, embedded metadata, data keys, subtraction, fail-closed settings, team default, relationships per level, switch before reading');
  }

  // ---------- format cards (click a format) and the "what was found" line ----------
  {
    const checks = [];
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 150));
    const page = await newPage();
    const chips = await page.$$eval('#chips button.chip', (els) => els.length);
    if (chips !== 15) checks.push('expected 15 clickable formats, got ' + chips);
    for (let i = 0; i < chips; i++) {
      await page.evaluate((n) => document.querySelectorAll('#chips button.chip')[n].click(), i); await wait(60);
      const r = await page.evaluate(() => ({
        open: document.getElementById('fmtDialog').open, title: document.getElementById('fmtTitle').textContent,
        reads: document.getElementById('fmtReads').textContent, best: document.getElementById('fmtBest').textContent,
        good: document.getElementById('fmtGood').textContent, href: document.getElementById('fmtGuide').getAttribute('href'),
      }));
      if (!r.open || !r.reads || !r.best || !r.good || !/\/docs\/formats\/[a-z]+\.md$/.test(r.href || '')) checks.push('card ' + i + ' (' + r.title + ') incomplete: ' + JSON.stringify(r).slice(0, 150));
      await page.evaluate(() => document.getElementById('fmtDialog').close());
    }
    // every card in every language, with the guide link
    const miss = await page.evaluate(() => {
      const I = window.DB_I18N, out = [];
      for (const l of I.langs.map((x) => x.code)) for (const k of ['Csv', 'Excel', 'Json', 'Xml', 'Yaml', 'Html', 'Spss', 'Parquet', 'Sqlite']) for (const p of ['Reads', 'Best', 'Good']) if (!I.ui[l]['fc' + k + p]) out.push(l + ':' + k + p);
      return out;
    });
    if (miss.length) checks.push('missing card texts: ' + miss.join(','));
    // the guides the cards link to exist in the repository
    for (const g of ['csv', 'excel', 'json', 'xml', 'yaml', 'html', 'spss', 'parquet', 'sqlite']) {
      if (!fs.existsSync(path.join(path.dirname(htmlPath), 'docs', 'formats', g + '.md'))) checks.push('guide docs/formats/' + g + '.md is missing');
    }
    // "what was found"
    await load(page, F('relations.xlsx'));
    const found = await page.$eval('#foundLine', (el) => el.textContent);
    if (found !== 'Found: 7 sections · 16 columns · 5 relationships (0 declared, 5 inferred)') checks.push('found line: ' + found);
    await page.close();
    if (checks.length) fail('format cards', checks.join(' | '));
    else pass('format cards', '15 clickable formats, 3 blocks each, guide links, all 15 languages, "what was found" line');
  }

  // ---------- "Do not share data": the same promise in all 15 languages, and the strings are really translated ----------
  {
    const checks = [];
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 200));
    const page = await newPage();
    await load(page, F('CONFIDENTIAL_FILE_csv.csv'));
    await page.click('#nsOn'); await wait(300);
    await page.click('#nsLevelGroup button[data-level="3"]'); await wait();
    const langs = await page.evaluate(() => window.DB_I18N.langs.map((l) => l.code));
    for (const code of langs) {
      await page.select('#promptLang', code); await wait();
      const r = await page.evaluate((c) => {
        const P = window.DB_I18N.prompt[c], U = window.DB_I18N.ui[c];
        return { s: window.DataBrief.getMarkdown(), title: P.nsTitle.split('{file}')[0], c1: P.nsC1, c2: P.nsC2, ctx: P.nsContextL3, small: P.nsOtherSmall, warn: U.nsL3Warn };
      }, code);
      const bad = (m) => checks.push(code + ': ' + m);
      if (!r.s.startsWith('# ' + r.title)) bad('title');
      if (!r.s.includes(r.c1) || !r.s.includes(r.c2)) bad('"you have not received the records" constraint missing');
      if (/\{\w+\}/.test(r.s)) bad('unreplaced placeholder');
      if (r.s.includes('CONFIDENTIAL_REC')) bad('a record leaked');
      // the thresholds written in the text must be the ones the code applies (groups under 5, tables under 10 rows)
      if (!/5/.test(r.ctx) || !/10/.test(r.ctx) || !/5/.test(r.warn)) bad('the thresholds 5 / 10 are not in the text');
    }
    // Translations: a new string identical to English is a missed translation, except for words that really are the same
    const same = await page.evaluate(() => {
      const I = window.DB_I18N;
      const NEW = /^(ns|rel|card|conf|prof|kind|stat|tbl|gen|x[A-Z]|mCodec|mRowGroups|mNames|fmtYamlDocs|fmtNested|onDelete|onUpdate|cGenerated|profile)/;
      const out = [];
      for (const part of ['ui', 'prompt']) {
        for (const k of Object.keys(I[part].en).filter((x) => NEW.test(x))) {
          for (const l of I.langs.map((x) => x.code).filter((x) => x !== 'en')) if (I[part][l][k] === I[part].en[k]) out.push(part + '.' + l + '.' + k);
        }
      }
      return out;
    });
    const ALLOWED = new Set(['prompt.fr.mCodec', 'prompt.fr.relVia', 'prompt.fr.statMin', 'prompt.fr.statMax', 'prompt.es.genVirtual', 'prompt.de.tblDdl',
      'prompt.it.statMin', 'prompt.it.statMax', 'prompt.pt.genVirtual', 'prompt.pt.relVia', 'prompt.nl.relVia']);
    const missed = same.filter((x) => !ALLOWED.has(x));
    if (missed.length) checks.push('identical to English (missed translation?): ' + missed.join(', '));
    await page.evaluate(() => localStorage.clear());
    await page.close();
    if (checks.length) fail('do not share data: 15 languages', checks.join(' | '));
    else pass('do not share data: 15 languages', 'constraint, no leak, thresholds and no missed translation in all ' + langs.length + ' languages');
  }

  // ---------- layout toggle + downloads ----------
  {
    const page = await newPage();
    const dl = path.join(outDir, 'downloads');
    fs.rmSync(dl, { recursive: true, force: true });
    fs.mkdirSync(dl, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    await load(page, F('shop.sqlite'));
    await page.click('#layoutGroup button[data-layout="csv"]');
    const csvMd = await page.evaluate(() => window.DataBrief.getMarkdown());
    await page.click('#layoutGroup button[data-layout="table"]');
    const tableMd = await page.evaluate(() => window.DataBrief.getMarkdown());
    if (csvMd.includes('```csv\nid,name,email\n1,Ana,ana@example.com') && tableMd.includes('| 1 | Ana | ana@example.com |') && !tableMd.includes('```csv')) pass('layout toggle', 'CSV and table modes');
    else fail('layout toggle', 'unexpected output');
    await page.click('#downloadBtn');
    await new Promise((res) => setTimeout(res, 800));
    const md = fs.readdirSync(dl).find((f) => f.endsWith('.md'));
    const mdOk = md && fs.readFileSync(path.join(dl, md), 'utf8') === tableMd;

    // ---------- CSV files mode ----------
    const hiddenInline = await page.evaluate(() => ['dataBtn', 'allBtn'].every((id) => document.getElementById(id).classList.contains('hidden')));
    await page.click('#modeGroup button[data-mode="files"]');
    await page.click('#layoutGroup button[data-layout="auto"]');
    const fm = await page.evaluate(() => window.DataBrief.getMarkdown());
    await page.click('#dataBtn');
    await page.click('#allBtn');
    await new Promise((res) => setTimeout(res, 1500));
    const files = fs.readdirSync(dl);
    const isZip = (f) => f && fs.readFileSync(path.join(dl, f)).subarray(0, 2).toString() === 'PK';
    const dataZip = files.find((f) => f.endsWith('_data.zip'));
    const allZip = files.find((f) => f.endsWith('_databrief.zip'));
    const allHasMd = allZip && fs.readFileSync(path.join(dl, allZip)).includes('shop.md');
    const fmChecks = [
      '**Before anything else:**', 'ask the user to provide them: the rows shown in this prompt are only a short sample',
      '**File:** `01_customers.csv`', '**File:** `02_orders.csv`', '## Data sample',
      'First 2 of 2 rows. Full data: `01_customers.csv`.', 'Load the attached CSV files with code', 'shows only the first 5 rows',
    ].filter((s) => !fm.includes(s));
    if (fm.includes('**Partial data:**') || fm.includes('## Data\n')) fmChecks.push('inline-only text present');
    if (mdOk && hiddenInline && isZip(dataZip) && allHasMd && !fmChecks.length) pass('downloads + CSV files mode', files.join(', '));
    else fail('downloads + CSV files mode', `md=${mdOk} hiddenInline=${hiddenInline} files=${files.join(',')} allHasMd=${allHasMd} missing=${JSON.stringify(fmChecks)}`);
    await page.close();
  }

  // ---------- files mode on a large file: small prompt, 5-row sample, no warning ----------
  {
    const page = await newPage();
    await load(page, F('big.csv'));
    await page.click('#modeGroup button[data-mode="files"]');
    const r = await page.evaluate(() => ({
      md: window.DataBrief.getMarkdown(), t: document.getElementById('stTokens').textContent,
      warn: !document.getElementById('warnBox').classList.contains('hidden'),
    }));
    const rows = r.md.split('\n').filter((l) => /^(\| )?\d+( \| |,)item number/.test(l)).length;
    const tokens = parseInt(r.t.replace(/[^\d]/g, ''), 10);
    await page.click('#modeGroup button[data-mode="inline"]');
    const back = await page.evaluate(() => !document.getElementById('warnBox').classList.contains('hidden'));
    if (rows === 5 && tokens < 3000 && !r.warn && back && r.md.includes('First 5 of 120,000 rows. Full data: `big.csv`.')) pass('files mode (large file)', `${r.t} tokens, 5 sample rows, warning only in inline mode`);
    else fail('files mode (large file)', `rows=${rows} tokens=${tokens} warn=${r.warn} back=${back}`);
    await page.close();
  }

  // ---------- formatted view: real Markdown rendering, nothing from the data executed or loaded ----------
  {
    const page = await newPage();
    const checks = [];
    await load(page, F('tricky.csv'));
    await page.click('#viewBtn');
    await page.waitForSelector('#mdDialog[open]');
    const v = await page.evaluate(() => {
      const b = document.getElementById('mdBody');
      return {
        h1: b.querySelectorAll('h1').length, tables: b.querySelectorAll('table').length, strong: b.querySelectorAll('strong').length,
        imgs: b.querySelectorAll('img').length, scripts: b.querySelectorAll('script').length,
        jsLinks: b.querySelectorAll('a[href^="javascript"]').length, okLink: !!b.querySelector('a[href="https://example.org"][target="_blank"]'),
        text: b.textContent, onerror: b.innerHTML.includes('onerror=') && !b.querySelector('[onerror]'),
      };
    });
    if (v.h1 !== 1 || v.tables < 2 || v.strong < 3) checks.push('rendering: ' + JSON.stringify({ h1: v.h1, tables: v.tables, strong: v.strong }));
    if (v.imgs || v.scripts || v.jsLinks) checks.push('unsafe elements: ' + JSON.stringify({ imgs: v.imgs, scripts: v.scripts, js: v.jsLinks }));
    if (!v.text.includes('<img src=https://example.com/x.png') || !v.text.includes('<script>alert(2)</script>')) checks.push('HTML not shown as text');
    if (!v.okLink) checks.push('https link missing');
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => !document.getElementById('mdDialog').open);
    if (!closed) checks.push('Escape did not close');
    await load(page, F('page.html'));
    await page.click('#viewBtn');
    const br = await page.evaluate(() => Array.from(document.querySelectorAll('#mdBody td')).some((td) => td.querySelector('br') && td.textContent === '9(est.)'));
    if (!br) checks.push('<br> in table cell not rendered');
    await page.screenshot({ path: path.join(outDir, 'ui_formatted.png') });
    if (checks.length) fail('formatted view', checks.join(' | '));
    else pass('formatted view', 'headings/tables/bold rendered; HTML, images and javascript: links neutralised; Esc closes');
    await page.close();
  }

  // ---------- prompt editing ----------
  {
    const page = await newPage();
    await page.select('#uiLang', 'en');
    await load(page, F('workbook.xlsx'));
    const get = () => page.evaluate(() => ({
      md: window.DataBrief.getMarkdown(), t: document.getElementById('stTokens').textContent,
      label: document.getElementById('editLabel').textContent, badge: !document.getElementById('editedBadge').classList.contains('hidden'),
    }));
    const typeAtEnd = async (key, text) => {
      await page.evaluate((k) => {
        const el = document.querySelector('#preview .ed[data-k="' + k + '"]');
        el.focus();
        const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }, key);
      await page.keyboard.type(text);
    };
    const num = (s) => parseInt(s.replace(/[^\d]/g, ''), 10);
    const before = await get();
    const checks = [];
    const ok = (cond, msg) => { if (!cond) checks.push(msg); };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Answer the "keep my text / regenerate" dialog.
    const answer = async (choice) => {
      await page.waitForSelector('#changeDialog[open]', { timeout: 3000 });
      await page.click(choice === 'keep' ? '#keepBtn' : '#regenBtn');
      await page.waitForFunction(() => !document.getElementById('changeDialog').open);
      await sleep(150);
    };
    const dialogOpen = () => page.evaluate(() => document.getElementById('changeDialog').open);

    await page.$eval('#preview', (el) => { el.scrollTop = 300; });
    await page.click('#editBtn');
    const info = await page.evaluate(() => {
      const pre = document.getElementById('preview');
      const eds = Array.from(pre.querySelectorAll('[contenteditable]'));
      const locked = Array.from(pre.querySelectorAll('.lk')).map((e) => e.textContent).join('');
      return {
        scroll: pre.scrollTop, keys: eds.map((e) => e.dataset.k).join(','), label: document.getElementById('editLabel').textContent,
        disabled: ['copyBtn', 'downloadBtn', 'promptLang', 'viewBtn'].every((id) => document.getElementById(id).disabled),
        locked: ['# Shared data file: `workbook.xlsx`', '## Overview', '**Format:** Excel (XLSX)', '## Sections and columns',
          '| `order_id` | integer |', '| 1 | ACME |', '_End of the shared file._'].every((s) => locked.includes(s)),
        leaked: eds.some((e) => /ACME|order_id|Includes VAT|Excel \(XLSX\)|Shared data file|End of the shared file/.test(e.textContent)),
      };
    });
    ok(info.label === 'Confirm', 'button label in edit mode: ' + info.label);
    ok(info.keys === 'intro,respond,fmt', 'editable blocks: ' + info.keys);
    ok(info.disabled, 'actions not disabled while editing');
    ok(info.locked && !info.leaked, 'overview / columns / data must be locked');
    ok(Math.abs(info.scroll - 300) < 2, 'scroll position changed: ' + info.scroll);

    // Typing works right after clicking Edit (cursor placed automatically).
    const focus = await page.evaluate(() => ({ ed: document.activeElement.classList.contains('ed'), k: document.activeElement.dataset.k }));
    ok(focus.ed, 'no editable part focused after clicking Edit');
    await page.keyboard.type('Q');
    const typed = await page.evaluate((k) => document.querySelector('#preview .ed[data-k="' + k + '"]').textContent.startsWith('Q'), focus.k);
    ok(typed, 'typing right after Edit did not insert text in ' + focus.k);
    await page.keyboard.press('Backspace');
    // Clicking locked text (the overview) flashes the hint.
    await page.$eval('#preview', (el) => { el.scrollTop = 0; });
    // The page scrolls smoothly to the result after a file is read: wait until it stops, or the click lands elsewhere.
    await page.evaluate(() => new Promise((resolve) => {
      let last = -1, still = 0;
      const tick = () => { const y = window.scrollY; if (y === last) { if (++still >= 8) return resolve(); } else { still = 0; last = y; } requestAnimationFrame(tick); };
      tick();
    }));
    const pt = await page.evaluate(() => {
      const box = document.getElementById('preview').getBoundingClientRect();
      for (const el of document.querySelectorAll('#preview .lk')) {
        for (const r of el.getClientRects()) if (r.width > 6 && r.top >= box.top + 80 && r.bottom <= box.bottom) return { x: r.left + 3, y: r.top + r.height / 2 };
      }
      return null;
    });
    await page.mouse.click(pt.x, pt.y);
    ok(await page.evaluate(() => document.getElementById('editHint').classList.contains('flash')), 'hint did not flash on locked click');

    // Free text: add a new line at the end of the instructions, rewrite the title completely.
    const RULE = '\n- EXTRA RULE: keep it under 50 words.';
    await typeAtEnd('fmt', RULE);
    const live = await get();
    ok(num(live.t) > num(before.t), `live tokens did not grow: ${before.t} -> ${live.t}`);
    ok(live.md === before.md, 'markdown changed before Confirm');
    await page.click('#editBtn');
    const after = await get();
    ok(after.md.includes(RULE + '\n\n## Sections and columns'), 'new line not applied: ' +
      JSON.stringify(after.md.slice(Math.max(0, after.md.indexOf('EXTRA') - 60), after.md.indexOf('EXTRA') + 80)));
    ok(after.t === live.t, `confirmed tokens ${after.t} != live ${live.t}`);
    ok(after.badge && after.label === 'Edit', 'badge/label after confirm');
    ok(after.md.replace(RULE, '') === before.md, 'something else changed');

    await page.click('#editBtn');
    await page.evaluate(() => {
      const el = document.querySelector('#preview .ed[data-k="intro"]');
      el.textContent = 'Custom intro written by the user.';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#editBtn');
    ok((await get()).md.startsWith('# Shared data file: `workbook.xlsx`\n\nCustom intro written by the user.\n\n## Overview'), 'intro not replaced');

    // A layout change regenerates the format notes: the dialog asks; "keep" keeps the edited text.
    await page.click('#layoutGroup button[data-layout="csv"]');
    await answer('keep');
    const csvKept = await get();
    ok(csvKept.md.includes('EXTRA RULE') && csvKept.md.includes('```csv'), 'keep after layout change');
    await page.click('#layoutGroup button[data-layout="auto"]');
    await answer('keep');

    // Edits are kept per mode: files mode has its own (none), switching back restores them. No dialog.
    await page.click('#modeGroup button[data-mode="files"]');
    const filesMd = await get();
    ok(!(await dialogOpen()) && !filesMd.md.includes('EXTRA RULE') && filesMd.md.startsWith('# Shared data file') && !filesMd.badge, 'files mode should have its own text');
    await page.click('#modeGroup button[data-mode="inline"]');
    ok((await get()).md.includes('EXTRA RULE'), 'inline edits lost after mode round-trip');

    // Cancel discards changes made during the edit.
    await page.click('#editBtn');
    await typeAtEnd('respond', ' SHOULD NOT STAY');
    await page.click('#cancelEditBtn');
    const cancelled = await get();
    ok(!cancelled.md.includes('SHOULD NOT STAY') && cancelled.md.includes('EXTRA RULE') && cancelled.label === 'Edit', 'cancel flow');

    // Language: "keep" keeps the user's text (locked sections switch language), "regenerate" replaces it.
    await page.select('#promptLang', 'fr');
    await answer('keep');
    const frKept = await get();
    ok(frKept.md.startsWith('# Fichier de données partagé') && frKept.md.includes('Custom intro written by the user.') &&
      frKept.md.includes("## Vue d'ensemble") && frKept.md.includes('EXTRA RULE') && frKept.md.includes('_Fin du fichier partagé._'), 'keep on language change');
    await page.select('#promptLang', 'de');
    await answer('regen');
    const de = await get();
    ok(de.md.startsWith('# Geteilte Datendatei') && !de.md.includes('EXTRA RULE') && !de.badge, 'regenerate on language change');
    await page.select('#promptLang', 'en');
    await sleep(150);
    ok(!(await dialogOpen()), 'dialog shown although nothing was edited');

    await page.click('#editBtn');
    await typeAtEnd('respond', ' Thanks!');
    await page.click('#editBtn');
    ok((await get()).badge, 'edit before reset');
    await page.click('#resetBtn');
    const reset = await get();
    ok(reset.md === before.md && !reset.badge, 'reset to original');

    await page.click('#editBtn');
    await page.screenshot({ path: path.join(outDir, 'ui_editing.png'), fullPage: true });
    await page.click('#cancelEditBtn');
    if (checks.length) fail('prompt editing', checks.join(' | '));
    else pass('prompt editing', `3 free blocks (intro, how to respond, format notes); title/overview/columns/data/closing line locked, live tokens ${before.t} → ${live.t}, keep/regenerate dialog, per-mode edits`);
    await page.close();
  }

  // ---------- team settings: config block, locks, URL parameters, team text ----------
  {
    const checks = [];
    const ok = (cond, msg) => { if (!cond) checks.push(msg); };
    const BLOCK = /(<script id="databrief-config" type="application\/json">)[\s\S]*?(<\/script>)/;
    const source = fs.readFileSync(htmlPath, 'utf8');
    const variant = (name, cfg) => {
      const file = path.join(outDir, name);
      fs.writeFileSync(file, source.replace(BLOCK, (m, a, b) => a + '\n' + JSON.stringify(cfg).replace(/</g, '\\u003c') + '\n' + b));
      return file;
    };
    // A: locked French + files mode + Edit hidden + team text; the URL tries to override the locked settings.
    const a = variant('cfg_locked.html', {
      lang: 'fr', mode: 'files', lock: ['lang', 'mode', 'edit'],
      promptIntro: 'TEAM INTRO <script>alert(1)</script>', promptRespondFiles: '## Team rules\n- Rule A',
    });
    let page = await newPageAt('file://' + a + '?lang=de&mode=inline');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* */ } });
    await page.reload();
    await load(page, F('workbook.xlsx'));
    const A = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      hidden: ['uiLangWrap', 'modeBox', 'editBtn'].map((id) => getComputedStyle(document.getElementById(id)).display === 'none'),
      shown: ['themeBtn', 'layoutOpt', 'viewBtn', 'promptLangOpt'].map((id) => getComputedStyle(document.getElementById(id)).display !== 'none'),
      md: window.DataBrief.getMarkdown(),
    }));
    ok(A.lang === 'fr', 'locked language: ' + A.lang);
    ok(A.hidden.every(Boolean), 'locked controls not hidden: ' + A.hidden);
    ok(A.shown.every(Boolean), 'unlocked controls hidden: ' + A.shown);
    ok(A.md.startsWith('# Fichier de données partagé') && A.md.includes("TEAM INTRO <script>alert(1)</script>\n\n## Vue d'"), 'team intro');
    ok(A.md.includes('## Team rules\n- Rule A\n\n## Format de ce fichier'), 'team "how to respond" text (files mode)');
    ok(A.md.includes('## Échantillon de données') && !A.md.includes('## Comment répondre'), 'files mode locked + team text replaces the generated one');
    await page.close();

    // B: unlocked defaults; URL parameters win; custom sample rows and warning threshold.
    const b = variant('cfg_defaults.html', { layout: 'csv', theme: 'dark', sampleRows: 3, warnTokens: 1000 });
    page = await newPageAt('file://' + b + '?layout=table&prompt=es');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* */ } });
    await page.reload();
    await load(page, F('workbook.xlsx'));
    const B1 = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'), md: window.DataBrief.getMarkdown(),
      layout: document.querySelector('#layoutGroup button[aria-pressed="true"]').dataset.layout,
      warn: !document.getElementById('warnBox').classList.contains('hidden'), ui: document.documentElement.lang,
    }));
    ok(B1.theme === 'dark' && B1.layout === 'table' && B1.ui === 'en' && B1.md.startsWith('# Archivo de datos compartido'), 'defaults/URL: ' + JSON.stringify({ t: B1.theme, l: B1.layout, ui: B1.ui }));
    await load(page, F('big.csv'));
    const suggested = await page.evaluate(() => parseInt(document.getElementById('limitN').value, 10));
    ok(suggested > 0 && suggested < 100, 'custom warning threshold (1000 tokens) should give a small suggested row limit, got ' + suggested);
    await page.click('#modeGroup button[data-mode="files"]');
    const B2 = await page.evaluate(() => ({ md: window.DataBrief.getMarkdown(), hint: document.getElementById('modeHint').textContent }));
    ok(/Primeras 3 de 120.000 filas/.test(B2.md), 'sample rows = 3');
    ok(B2.hint.includes('3 sample rows'), 'mode hint uses the sample row count: ' + B2.hint);
    await page.close();

    // C: an invalid config block is ignored (page still works).
    const c = path.join(outDir, 'cfg_broken.html');
    fs.writeFileSync(c, source.replace(BLOCK, (m, x, y) => x + '\n{ not json\n' + y));
    page = await newPageAt('file://' + c);
    await load(page, F('data.tsv'));
    ok((await page.evaluate(() => window.DataBrief.getMarkdown())).startsWith('# Shared data file'), 'broken config block should be ignored');
    await page.close();

    if (checks.length) fail('team settings', checks.join(' | '));
    else pass('team settings', 'locks hide + fix values, URL params only for unlocked, team texts, sample rows, warning threshold, broken block ignored');
  }

  // ---------- settings page: databrief_set_default.html ----------
  {
    const checks = [];
    const ok = (cond, msg) => { if (!cond) checks.push(msg); };
    const page = await newPageAt('file://' + path.join(path.dirname(htmlPath), 'databrief_set_default.html'));
    const dl = path.join(outDir, 'downloads_settings');
    fs.rmSync(dl, { recursive: true, force: true });
    fs.mkdirSync(dl, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    page.on('dialog', (d) => d.accept());
    await page.select('#f_lang', 'fr');
    await page.click('input[data-lock="lang"]');
    await page.select('#f_mode', 'files');
    await page.click('input[data-lock="edit"]');
    await page.click('button[data-fill="intro"]');
    const intro = await page.$eval('#t_intro', (el) => el.value);
    ok(intro.startsWith("L'utilisateur a partagé"), 'fill intro from generated French text: ' + intro.slice(0, 40));
    await page.click('button[data-fill="respondFiles"]');
    const rf = await page.$eval('#t_respondFiles', (el) => el.value);
    ok(rf.startsWith('## Comment répondre') && rf.includes('**Avant toute chose :**'), 'fill files-mode respond text');
    await page.$eval('#t_respondFiles', (el) => { el.value = '## Nos règles\n- Répondre en français.'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const env = await page.$eval('#envOut', (el) => el.textContent);
    ok(env.includes('DATABRIEF_LANG=fr') && env.includes('DATABRIEF_LOCK=lang,edit') && env.includes('DATABRIEF_MODE=files') &&
      env.includes('DATABRIEF_PROMPT_RESPOND_FILES="## Nos règles\\n- Répondre en français."'), 'environment variables output: ' + env);
    const popup = new Promise((res) => browser.once('targetcreated', res));
    await page.click('#previewBtn');
    const target = await Promise.race([popup, new Promise((r) => setTimeout(() => r(null), 5000))]);
    ok(!!target, 'preview did not open a new tab');
    if (target) { const p2 = await target.page(); if (p2) await p2.close(); }
    await page.click('#downloadBtn');
    await new Promise((r) => setTimeout(r, 1500));
    const out = path.join(dl, 'databrief.html');
    ok(fs.existsSync(out), 'databrief.html not downloaded');
    if (fs.existsSync(out)) {
      const html = fs.readFileSync(out, 'utf8');
      const cfg = JSON.parse(BLOCK_RE.exec(html)[1]);
      ok(cfg.lang === 'fr' && cfg.mode === 'files' && cfg.lock.join() === 'lang,edit' && cfg.promptIntro.startsWith("L'utilisateur"), 'config written: ' + JSON.stringify(cfg).slice(0, 120));
      ok(html.length > 2000000 && !html.includes('/*@inline'), 'downloaded file is the complete tool');
      const p = await newPageAt('file://' + out);
      await load(p, F('workbook.xlsx'));
      const r = await p.evaluate(() => ({ lang: document.documentElement.lang, md: window.DataBrief.getMarkdown(), editHidden: getComputedStyle(document.getElementById('editBtn')).display === 'none' }));
      ok(r.lang === 'fr' && r.editHidden && r.md.includes('## Nos règles\n- Répondre en français.'), 'downloaded file applies the settings');
      await p.close();
      // load the settings back into the page
      await page.click('#resetAllBtn');
      const input = await page.$('#loadInput');
      await input.uploadFile(out);
      await new Promise((r2) => setTimeout(r2, 500));
      const back = await page.evaluate(() => window.DataBriefSettings.readForm());
      ok(back.lang === 'fr' && back.mode === 'files' && (back.lock || []).join() === 'lang,edit', 'load settings from a databrief.html');
    }
    await page.screenshot({ path: path.join(outDir, 'ui_settings_page.png'), fullPage: true });
    await page.close();
    if (checks.length) fail('settings page', checks.join(' | '));
    else pass('settings page', 'fields + locks + team text → env output, preview tab, download applies settings, load back');
  }

  // ---------- screenshots ----------
  {
    const page = await newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(outDir, 'ui_empty_light.png'), fullPage: true });
    await load(page, F('workbook.xlsx'));
    await page.screenshot({ path: path.join(outDir, 'ui_result_light.png'), fullPage: true });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.screenshot({ path: path.join(outDir, 'ui_result_dark.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.screenshot({ path: path.join(outDir, 'ui_mobile_dark.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) fail('mobile layout', 'horizontal overflow at 390px'); else pass('mobile layout', 'no horizontal scroll at 390px');
    await page.setViewport({ width: 1280, height: 900 });
    await load(page, F('big.csv'));
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.screenshot({ path: path.join(outDir, 'ui_big_warning.png'), fullPage: false });
    await page.close();
  }

  await browser.close();

  if (external.length) fail('NO NETWORK', external.length + ' external request(s): ' + [...new Set(external)].join(', '));
  else pass('NO NETWORK', 'zero external requests; file requests: ' + [...fileRequests].map((u) => path.basename(u)).join(', '));
  const otherFiles = [...fileRequests].filter((u) => !u.split('?')[0].endsWith('/databrief.html') && !/\/cfg_[^/]*\.html$/.test(u)); // ?share=no links and the tests' own cfg_*.html variants
  if (otherFiles.length) fail('single file', 'page loaded other files: ' + otherFiles.join(', '));
  if (problems.length) fail('console/page errors', [...new Set(problems)].join(' | '));

  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.msg ? '  —  ' + r.msg : ''));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
