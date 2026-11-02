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
    // A page whose scripts do not even start (a syntax error) must stop the run at once, not hang every test for minutes
    if (!(await page.evaluate(() => typeof window.DataBrief === 'object'))) {
      console.log('FAIL the page did not start (window.DataBrief is missing): ' + problems.slice(-3).join(' | '));
      process.exit(1);
    }
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

  // ---------- data profile (on by default, switched off with the checkbox) ----------
  {
    const page = await newPage();
    const first = await load(page, F('profile.csv'));
    const onByDefault = first.md.includes('## Data profile') && await page.evaluate(() => document.getElementById('profileOn').checked);
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
    if (onByDefault && !missing.length && offAgain) pass('data profile', 'on by default; every kind of column; switches off again');
    else fail('data profile', (onByDefault ? '' : 'not on by default; ') + (offAgain ? '' : 'did not switch off; ') + 'missing: ' + JSON.stringify(missing));
    await page.close();

    const page2 = await newPage();
    await load(page2, F('dupes.csv')); // the profile is on by default
    await new Promise((res) => setTimeout(res, 300));
    const md2 = await page2.evaluate(() => window.DataBrief.getMarkdown());
    if (md2.includes('**Duplicate rows:** 1')) pass('data profile: duplicate rows', '1 duplicate row found');
    else fail('data profile: duplicate rows', md2.slice(md2.indexOf('## Data profile'), md2.indexOf('## Data profile') + 400));
    await page2.close();
  }

  // ---------- data profile: the team can switch it off by default (and lock it) ----------
  {
    const BLOCK = /(<script id="databrief-config" type="application\/json">)[\s\S]*?(<\/script>)/;
    const make = (name, cfg) => {
      const f = path.join(outDir, name);
      fs.writeFileSync(f, fs.readFileSync(htmlPath, 'utf8').replace(BLOCK, (m, a, b) => a + '\n' + cfg + '\n' + b));
      return 'file://' + f;
    };
    const checks = [];
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 200));
    const state = (p) => p.evaluate(() => ({ md: window.DataBrief.getMarkdown(), on: document.getElementById('profileOn').checked, hidden: document.getElementById('profileOpt').classList.contains('locked-hidden') }));
    // default "no": off, but the user can switch it on
    const pOff = await newPageAt(make('cfg_profile_off.html', '{"profile":"no"}'));
    await load(pOff, F('profile.csv'));
    let s = await state(pOff);
    if (s.on || s.md.includes('## Data profile') || s.hidden) checks.push('profile "no": expected off and still switchable, got ' + JSON.stringify({ on: s.on, hidden: s.hidden }));
    await pOff.click('#profileOn'); await wait(300);
    s = await state(pOff);
    if (!s.on || !s.md.includes('## Data profile')) checks.push('profile "no": the user could not switch it on');
    await pOff.close();
    // locked "no": off, the checkbox is hidden
    const pLock = await newPageAt(make('cfg_profile_locked.html', '{"profile":"no","lock":["profile"]}'));
    await load(pLock, F('profile.csv'));
    s = await state(pLock);
    if (s.md.includes('## Data profile') || !s.hidden) checks.push('profile locked "no": expected off and hidden, got ' + JSON.stringify({ on: s.on, hidden: s.hidden }));
    await pLock.close();
    // locked without a value: stays on (the default), hidden
    const pLockOn = await newPageAt(make('cfg_profile_lockon.html', '{"lock":["profile"]}'));
    await load(pLockOn, F('profile.csv'));
    s = await state(pLockOn);
    if (!s.md.includes('## Data profile') || !s.hidden) checks.push('profile locked (default): expected on and hidden, got ' + JSON.stringify({ on: s.on, hidden: s.hidden }));
    await pLockOn.close();
    if (!checks.length) pass('data profile: team setting', 'default off, lock off, lock on');
    else fail('data profile: team setting', checks.join(' | '));
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
    ok(await p3.evaluate(() => document.getElementById('nsOn').classList.contains('locked-hidden') && !document.getElementById('nsTeam').classList.contains('hidden')), 'locked: switch hidden, team note shown');
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
      { f: 'sql.sql', txt: true, lab: true, sql: true }, { f: 'pgdump.dump', txt: true, lab: true, sql: true }, { f: 'dbf.dbf', names: 'CONF_COL' }, { f: 'access.accdb' }, { f: 'dacpac.dacpac', noRec: true, txt: true, lab: true, sql: true },
      { f: 'csvgz.csv.gz' },   // the section is named after the file inside the gzip: the file name too
      { f: 'geojson.geojson' }, { f: 'gpkg.gpkg' },   // coordinates are records; layer and column names are names
      { f: 'ipynb.ipynb', txt: true },   // code and outputs never (they hold values); Markdown is free text; the table's columns are names
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
      if (!c.noRec && !first.md.includes('CONFIDENTIAL_REC')) bad('normal mode should contain the records (control)');
      if (c.frm && !first.md.includes('CONFIDENTIAL_FORMULA')) bad('normal mode should show the formula (control)');
      await page.click('#nsOn'); await wait(300);
      const never = (s, where) => { for (const k of ['CONFIDENTIAL_REC', 'CONFIDENTIAL_FORMULA']) if (s.includes(k)) bad(k + ' in ' + where); };
      const notByDefault = (s, where) => { for (const k of ['CONFIDENTIAL_TEXT', 'CONFIDENTIAL_SQL']) if (s.includes(k)) bad(k + ' in ' + where); };
      for (const level of [1, 2, 3]) {
        await page.click('#nsLevelGroup button[data-level="' + level + '"]'); await wait();
        const s = await md(page);
        never(s, 'level ' + level); notByDefault(s, 'level ' + level);
        if (level === 1) {
          if (!s.includes(c.names || 'CONFIDENTIAL_COL')) bad('names should be present at level 1 (control)');
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
      if (s.includes(c.names || 'CONFIDENTIAL_COL')) bad('names should be replaced when off');
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
      await load(p, F(file));
      await p.click('#nsOn'); await wait(); // the switch is in the "Do not share data" section, once a file is loaded
      if (lv && lv > 1) await level(p, lv);
      return p;
    };

    // 8: the switch only exists once a file is loaded (section "Do not share data"); switching releases the rows
    {
      const p = await newPage();
      ok(await p.evaluate(() => document.getElementById('nsOn').offsetParent === null), '8: switch must not be visible before a file is read');
      ok(await p.evaluate(() => document.getElementById('chips').children.length === 24 && !document.getElementById('nsToggleWrap').offsetParent), '8: chips shown, no "Do not share data" text on the home screen');
      const r0 = await load(p, F('confidential.csv'));
      ok(r0.md.includes('CONFIDENTIAL_CUSTOMER_74291') && await p.evaluate(() => document.getElementById('nsOn').offsetParent !== null && !document.getElementById('nsOn').checked), '8: after loading: data included, switch visible and off');
      const order = await p.evaluate(() => ['secSummary', 'secShare', 'secOutput'].map((id) => document.getElementById(id).getBoundingClientRect().top));
      ok(order[0] < order[1] && order[1] < order[2], '8: sections in the order summary, do not share, output');
      ok(await p.evaluate(() => document.getElementById('shareBox').classList.contains('hidden')), '8: levels hidden while the mode is off');
      await p.click('#nsOn'); await wait();
      ok((await md(p)).includes('(data not shared)') && await p.evaluate(() => window.DataBrief.getState().doc === null && !document.getElementById('shareBox').classList.contains('hidden')), '8: switched on after reading: no-share prompt, rows released, levels shown');
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
    if (chips !== 24) checks.push('expected 24 clickable formats, got ' + chips);
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
      for (const l of I.langs.map((x) => x.code)) for (const k of ['Csv', 'Excel', 'Json', 'Xml', 'Yaml', 'Html', 'Spss', 'Parquet', 'Sqlite', 'Sql', 'Pgdump', 'Dbf', 'Duckdb', 'Access', 'Dacpac', 'Geojson', 'Gpkg', 'Ipynb']) for (const p of ['Reads', 'Best', 'Good']) if (!I.ui[l]['fc' + k + p]) out.push(l + ':' + k + p);
      return out;
    });
    if (miss.length) checks.push('missing card texts: ' + miss.join(','));
    // the guides the cards link to exist in the repository
    for (const g of ['csv', 'excel', 'json', 'xml', 'yaml', 'html', 'spss', 'parquet', 'sqlite', 'sql', 'pgdump', 'dbf', 'duckdb', 'access', 'dacpac', 'geodata', 'notebook']) {
      if (!fs.existsSync(path.join(path.dirname(htmlPath), 'docs', 'formats', g + '.md'))) checks.push('guide docs/formats/' + g + '.md is missing');
    }
    // "what was found"
    await load(page, F('relations.xlsx'));
    const found = await page.$eval('#foundLine', (el) => el.textContent);
    if (found !== 'Found: 7 sections · 16 columns · 5 relationships (0 declared, 5 inferred)') checks.push('found line: ' + found);
    await page.close();
    if (checks.length) fail('format cards', checks.join(' | '));
    else pass('format cards', '24 clickable formats, 3 blocks each, guide links, all 15 languages, "what was found" line');
  }

  // ---------- export helper (commands to export a database) ----------
  {
    const checks = [];
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 120));
    const page = await newPage();
    await page.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); }; });
    await page.evaluate(() => document.getElementById('exportBtn').click()); await wait();
    const engines = await page.evaluate(() => window.DB.EXPORT_ENGINES.map((e) => e.key));
    if (!await page.evaluate(() => document.getElementById('exportDialog').open)) checks.push('dialog did not open');
    if (engines.length !== 13) checks.push('expected 13 engines, got ' + engines.length);
    for (const key of engines) {
      await page.select('#exEngine', key); await wait(40);
      const r = await page.evaluate(() => ({
        blocks: document.querySelectorAll('#exBlocks pre.cmd-text').length, copies: document.querySelectorAll('#exBlocks button').length,
        docs: document.getElementById('exDocs').getAttribute('href'), notes: document.getElementById('exNotes').textContent,
        text: [...document.querySelectorAll('#exBlocks pre.cmd-text')].map((e) => e.textContent),
      }));
      const e = await page.evaluate((k) => window.DB.EXPORT_ENGINES.find((x) => x.key === k), key);
      if (!/^https:\/\//.test(r.docs || '')) checks.push(key + ': docs link ' + r.docs);
      if (!r.notes) checks.push(key + ': no notes');
      if (key !== 'access' && (e.schema && !r.text.includes(e.schema))) checks.push(key + ': schema command not shown as written');
      if (key !== 'access' && e.fks && !r.text.includes(e.fks)) checks.push(key + ': fk command not shown as written');
      if (key === 'access' && r.text.length) checks.push('access should show no command');
      if (/(^|\s)(-p\S|--password=|--password\s+[^-\s]|-P\S)|PASSWORD=|IDENTIFIED BY/.test(r.text.join('\n'))) checks.push(key + ': a password seems to be on the command line');
      if (e.tested && !/\d/.test(e.tested)) checks.push(key + ': tested label without version');
    }
    await page.select('#exEngine', 'postgresql'); await wait(40);
    await page.evaluate(() => document.querySelector('#exBlocks button').click()); await wait(200);
    const clip = await page.evaluate(() => window.__clip);
    if (clip.length !== 1 || !clip[0].startsWith('pg_dump --schema-only')) checks.push('copy button: ' + JSON.stringify(clip).slice(0, 100));
    const en = await page.$eval('#exTitle', (el) => el.textContent);
    await page.select('#uiLang', 'fr'); await wait(200);
    const fr = await page.$eval('#exTitle', (el) => el.textContent);
    if (fr === en || !await page.evaluate(() => document.getElementById('exportDialog').open)) checks.push('language switch did not translate the open dialog');
    await page.evaluate(() => document.getElementById('exClose').click()); await wait();
    if (await page.evaluate(() => document.getElementById('exportDialog').open)) checks.push('close button');
    const miss = await page.evaluate(() => {
      const I = window.DB_I18N, out = [];
      for (const l of I.langs.map((x) => x.code)) for (const k of ['exLink', 'exTitle', 'exIntro', 'exEngine', 'exSchema', 'exFull', 'exFks', 'exTested', 'exUntested', 'exDocs', 'exNoFk', 'exUnenforced', 'exGiveFile', 'exPassword', 'exNone']) if (!I.ui[l][k]) out.push(l + ':' + k);
      return out;
    });
    if (miss.length) checks.push('missing texts: ' + miss.join(','));
    if (!fs.existsSync(path.join(path.dirname(htmlPath), 'docs', 'export-your-database.md'))) checks.push('docs/export-your-database.md is missing');
    await page.close();
    if (checks.length) fail('export helper', checks.join(' | '));
    else pass('export helper', '13 engines, 3 commands each as written, copy button, docs links, language switch while open, 15 languages');
  }

  // ---------- geodata: GeoJSON and GeoPackage (real files written by GDAL, tests/v14-fixtures) ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 300));
    const docOf = (p) => p.evaluate(() => {
      const d = window.DataBrief.getState().doc;
      return d && { key: d.formatKey, name: d.formatName, secs: d.sections.map((s) => ({ n: s.name, rows: s.rows.length, cols: s.columns.map((c) => c.name + ':' + c.type) })) };
    });
    let p = await newPage();
    let r = await load(p, F('places.geojson'));
    let d = r.ok && await docOf(p);
    if (!d || d.key !== 'geojson' || d.name !== 'GeoJSON' || d.secs.length !== 1 || d.secs[0].n !== 'places' || d.secs[0].rows !== 5 ||
      d.secs[0].cols.join(',') !== 'id:integer,name:text,category:text,geometry:geometry') bad('places.geojson: ' + JSON.stringify(d || r.err));
    if (r.ok) {
      const md = r.md;
      for (const s of ['POINT (2.3522 48.8566)', 'MULTIPOLYGON (2 parts, 2 rings, 8 points; x 2.34…2.37, y 48.85…48.86)', 'Coordinate reference system',
        'WGS 84 (longitude, latitude)', 'Point: 1, LineString: 1, Polygon: 1, MultiPolygon: 1, no geometry: 1', 'x 2.3…2.37, y 48.85…48.87', '| geometry |']) if (!md.includes(s)) bad('geojson prompt lacks: ' + s);
      if (/POINT \(2\.3522 48\.8566\): 1/.test(md)) bad('a geometry was counted as a category in the statistics');
      // "Do not share data": the coordinate system stays, the geometries, the extent and the counts per kind go
      await p.click('#nsOn'); await wait(500);
      for (const level of [1, 3]) {
        if (level === 3) { await p.click('#nsLevelGroup button[data-level="3"]'); await wait(400); }
        const ns = await p.evaluate(() => window.DataBrief.getMarkdown());
        if (!ns.includes('WGS 84 (longitude, latitude)')) bad('no-share level ' + level + ': the coordinate system should stay (structure)');
        for (const s of ['2.3522', '48.85', 'LINESTRING (', 'Point: 1', 'Extent']) if (ns.includes(s)) bad('no-share level ' + level + ' leaks: ' + s);
      }
      await p.evaluate(() => localStorage.clear());
    }
    await p.close();

    // GeoJSON saved as .json: recognised by its content
    p = await newPage();
    r = await load(p, F('places_as.json'));
    d = r.ok && await docOf(p);
    if (!d || d.key !== 'geojson') bad('GeoJSON in a .json file: ' + JSON.stringify(d || r.err));
    await p.close();

    // GeoPackage: 3 layers, never the gpkg_* / rtree_* machinery; each geometry column with its coordinate system
    p = await newPage();
    r = await load(p, F('city.gpkg'));
    d = r.ok && await docOf(p);
    const names = d ? d.secs.map((s) => s.n).sort().join(',') : '';
    if (!d || d.key !== 'gpkg' || d.name !== 'GeoPackage' || names !== 'attributes_only,places,places_lambert93') bad('city.gpkg: ' + JSON.stringify(d || r.err));
    if (d) {
      const sec = (n) => d.secs.find((s) => s.n === n);
      if (!sec('places') || !sec('places').cols.includes('geom:geometry') || sec('places').rows !== 5) bad('gpkg places layer: ' + JSON.stringify(sec('places')));
      if (!sec('attributes_only') || sec('attributes_only').cols.some((c) => /geometry/.test(c))) bad('gpkg attributes table should have no geometry column: ' + JSON.stringify(sec('attributes_only')));
    }
    if (r.ok) {
      for (const s of ['GeoPackage content', '2 feature layers, 1 attribute table', 'EPSG:4326', 'Lambert-93 (EPSG:2154)', 'POINT (2.3522 48.8566)']) if (!r.md.includes(s)) bad('gpkg prompt lacks: ' + s);
      if (/gpkg_|rtree_/.test(r.md)) bad('the GeoPackage machinery tables should not be in the prompt');
    }
    await p.close();
    if (checks.length) fail('geodata', checks.join(' | '));
    else pass('geodata', 'GeoJSON (also as .json) and GeoPackage written by GDAL: layers, summarised geometries, coordinate systems, no machinery tables; no-share keeps the system, drops coordinates, extent and counts');
  }

  // ---------- Jupyter notebooks (executed by a real kernel, tests/v14-fixtures) ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 300));
    const docOf = (p) => p.evaluate(() => {
      const d = window.DataBrief.getState().doc;
      return d && { key: d.formatKey, name: d.formatName, secs: d.sections.map((s) => s.name + ':' + s.rows.length) };
    });
    let p = await newPage();
    let r = await load(p, F('analysis.ipynb'));
    let d = r.ok && await docOf(p);
    if (!d || d.key !== 'ipynb' || d.name !== 'Jupyter notebook' || d.secs.join(',') !== 'customers:4,orders.head(2):2,big:10') bad('analysis.ipynb: ' + JSON.stringify(d || r.err));
    if (r.ok) {
      const md = r.md;
      for (const s of ['## Notebook contents', '7 cells: 5 code, 2 Markdown, 0 other', '**Cell 1 · Markdown**\n> # Customer analysis', '**Cell 2 · code [1]**\n```python\nimport pandas as pd',
        '- Output: table, section 1 `customers`', '- Printed output:\n```text\n4\n```', '- Error: `ZeroDivisionError` `division by zero`', 'Name: total',
        '**Language:** python 3.12', 'Rows included: the first 10 of 300 (partial)', '**Tables from a notebook:**', '| Ana Lima |', '## Sections and columns']) if (!md.includes(s)) bad('prompt lacks: ' + JSON.stringify(s));
      if (md.indexOf('## Notebook contents') > md.indexOf('## Sections and columns')) bad('the contents should come before the sections');
      // "Do not share data": no code, no output, no value; the Markdown only with free text; the cell -> table links stay
      await p.click('#nsOn'); await wait(500);
      for (const level of [1, 3]) {
        if (level === 3) { await p.click('#nsLevelGroup button[data-level="3"]'); await wait(400); }
        const ns = await p.evaluate(() => window.DataBrief.getMarkdown());
        for (const s of ['## Notebook contents', '**Cell 2 · code [1]**: _(not shared)_', '- Output: table, section 1 `customers`', '- Printed output: _(not shared)_', '- Error: `ZeroDivisionError`',
          "The notebook's code and the outputs of its cells"]) if (!ns.includes(s)) bad('no-share level ' + level + ' lacks: ' + JSON.stringify(s));
        for (const s of ['import pandas', 'division by zero', '24.90', 'Ana Lima', 'Customer analysis', 'range(300)']) if (ns.includes(s)) bad('no-share level ' + level + ' leaks: ' + s);
      }
      await p.evaluate(() => document.querySelector('[data-sw="text"]').click()); await wait();
      const txt = await p.evaluate(() => window.DataBrief.getMarkdown());
      if (!txt.includes('> # Customer analysis')) bad('no-share with free text: the Markdown should appear');
      for (const s of ['import pandas', 'division by zero', '24.90']) if (txt.includes(s)) bad('no-share with free text leaks code or output: ' + s);
      await p.evaluate(() => localStorage.clear());
    }
    await p.close();

    // a notebook saved as .json: recognised by its content
    p = await newPage();
    r = await load(p, F('analysis_as.json'));
    d = r.ok && await docOf(p);
    if (!d || d.key !== 'ipynb') bad('notebook in a .json file: ' + JSON.stringify(d || r.err));
    await p.close();

    // pandas MultiIndex, a frame too wide, the Styler, Polars types, stderr, an image, a cell never run
    p = await newPage();
    r = await load(p, F('shapes.ipynb'));
    d = r.ok && await docOf(p);
    if (!d || d.secs.length !== 8) bad('shapes.ipynb: ' + JSON.stringify(d || r.err));
    if (r.ok) {
      for (const s of ['`amount / 2023`', '(20 of 30 columns stored)', '| Type in the notebook |', '| `region` | text | str |', '- Messages (stderr):', '- Output: image (image/png), not read',
        '**Cell 10 · code · not run**', '| North | 22.5 |']) if (!r.md.includes(s)) bad('shapes prompt lacks: ' + JSON.stringify(s));
      if (r.md.includes('"North"')) bad('Polars quotes should be removed');
    }
    await p.close();

    // a notebook without any table output: still a prompt (its cells), no empty "Data" part
    p = await newPage();
    r = await load(p, F('no_tables.ipynb'));
    if (!r.ok) bad('no_tables.ipynb: ' + r.err);
    else {
      if (!r.md.includes('rows: 120') || !r.md.includes('> # Plan')) bad('no_tables prompt lacks its cells');
      if (/\n## (Data|Sections and columns)\n/.test(r.md)) bad('no_tables: empty data headings');
      const found = await p.$eval('#foundLine', (el) => el.textContent);
      if (!/^Found: 0 sections/.test(found)) bad('no_tables found line: ' + found);
    }
    await p.close();
    if (checks.length) fail('notebooks', checks.join(' | '));
    else pass('notebooks', 'executed notebooks: data frames as sections (pandas, MultiIndex, Styler, Polars), cells as context; no-share keeps cell kinds and table links, never code or outputs');
  }

  // ---------- SQL dumps and PostgreSQL archives (real dumps of tests/sql-fixtures) ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms || 200));
    const docOf = (p) => p.evaluate(() => {
      const d = window.DataBrief.getState().doc;
      return d && { key: d.formatKey, name: d.formatName, kind: d.sectionKind, secs: d.sections.map((s) => ({ n: s.name, rows: s.rows.length, total: s.totalRows, types: s.columns.map((c) => c.type) })),
        declared: (d.relationships || []).filter((r) => r.source === 'declared').length };
    });
    const sec = (d, n) => d.secs.find((s) => s.n === n);
    const stat = (p, id) => p.$eval('#' + id, (el) => el.textContent);

    // a text dump
    let p = await newPage();
    let r = await load(p, F('pg16-default.sql'));
    let d = r.ok && await docOf(p);
    if (!d || d.key !== 'sql' || d.name !== 'SQL dump' || d.kind !== 'tables' || d.secs.length !== 8 || sec(d, 'customers').rows !== 6 || d.declared !== 7) bad('pg16-default.sql: ' + JSON.stringify(d || r.err));
    if (r.ok && !(r.md.includes('**SQL dialect:** PostgreSQL') && r.md.includes('many to many') && r.md.includes('Free text written by the sales team') &&
      r.md.includes('People who bought something') && r.md.includes('Bob O\'Brien'))) bad('pg16-default.sql: the prompt misses the dialect, the relationships, the comments or a value');
    if (r.ok && (await stat(p, 'stFormat')) !== 'SQL') bad('format stat: ' + (await stat(p, 'stFormat')));
    await p.close();

    // a binary archive, zstd, recognised by its content under any name
    fs.copyFileSync(F('pg17-custom-zstd.dump'), path.join(outDir, 'renamed.bin'));
    p = await newPage();
    r = await load(p, path.join(outDir, 'renamed.bin'));
    d = r.ok && await docOf(p);
    if (!d || d.key !== 'pgdump' || d.name !== 'PostgreSQL archive (pg_dump)' || d.secs.length !== 8 || sec(d, 'orders').rows !== 5) bad('zstd archive named .bin: ' + JSON.stringify(d || r.err));
    if (r.ok && !r.md.includes('custom archive 1.16.0 · zstd · pg_dump 17.11 · PostgreSQL 17.11')) bad('archive line missing');
    await p.close();

    // a dump of the structure only: no row, the column kinds come from the SQL types
    p = await newPage();
    r = await load(p, F('pg16-schema-only.sql'));
    d = r.ok && await docOf(p);
    const cu = d && sec(d, 'customers');
    if (!cu || cu.rows !== 0 || cu.types[0] !== 'integer' || cu.types[4] !== 'datetime' || cu.types[1] !== 'text') bad('schema-only: column kinds ' + JSON.stringify(cu || r.err));
    if (r.ok && !r.md.includes('| `id` | integer |')) bad('schema-only: the column table should show the kind from the SQL type');
    await p.close();

    // a cut archive: a clear message (nothing technical)
    fs.writeFileSync(path.join(outDir, 'cut.dump'), fs.readFileSync(F('pg16-custom.dump')).subarray(0, 400));
    p = await newPage();
    r = await load(p, path.join(outDir, 'cut.dump'));
    if (r.ok || !r.err.includes('damaged or incomplete')) bad('cut archive: ' + JSON.stringify({ ok: r.ok, err: r.err }));
    await p.close();

    // a plain SQL text file named .dump (not an archive): read as SQL
    fs.copyFileSync(F('pg16-default.sql'), path.join(outDir, 'plain.dump'));
    p = await newPage();
    r = await load(p, path.join(outDir, 'plain.dump'));
    d = r.ok && await docOf(p);
    if (!d || d.key !== 'sql' || d.secs.length !== 8) bad('plain text named .dump: ' + JSON.stringify(d || r.err));
    await p.close();

    // a binary file named .sql: refused, not shown as garbage
    fs.writeFileSync(path.join(outDir, 'binary.sql'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37) % 251)));
    p = await newPage();
    r = await load(p, path.join(outDir, 'binary.sql'));
    if (r.ok) bad('a binary file named .sql should be refused');
    await p.close();

    // a large dump: only the first 250,000 rows of a table are kept, the counts and the notes tell it
    const lines = ['CREATE TABLE big (id int PRIMARY KEY, name text, amount numeric(10,2));'];
    for (let i = 0; i < 300; i++) {
      const vals = [];
      for (let j = i * 1000 + 1; j <= (i + 1) * 1000; j++) vals.push('(' + j + ",'name " + j + "'," + (j % 100) + '.50)');
      lines.push('INSERT INTO big VALUES ' + vals.join(',') + ';');
    }
    fs.writeFileSync(path.join(outDir, 'big.sql'), lines.join('\n'));
    p = await newPage();
    r = await load(p, path.join(outDir, 'big.sql'));
    d = r.ok && await docOf(p);
    if (!d || sec(d, 'big').rows !== 250000 || sec(d, 'big').total !== 300000) bad('large dump: ' + JSON.stringify(d || r.err));
    if (r.ok) {
      if ((await stat(p, 'stRows')) !== '300,000') bad('large dump: the Rows stat should be 300,000, got ' + (await stat(p, 'stRows')));
      if (!r.md.includes('300,000') || !r.md.includes('250000') || !r.md.includes('Some tables are larger than what was read')) bad('large dump: the prompt does not say that rows were cut');
      await p.click('#nsOn'); await wait(500);
      const ns = await p.evaluate(() => window.DataBrief.getMarkdown());
      if (!ns.includes('300,000') || ns.includes('name 1,')) bad('large dump, no-share: the true row count is missing or a row leaked');
    }
    await p.evaluate(() => localStorage.clear());
    await p.close();

    // a DuckDB export (schema.sql + load.sql): the data is in other files, whose names come from the tables
    const duckDir = path.join(__dirname, 'sql-fixtures', 'duckdb-export-csv');
    fs.writeFileSync(path.join(outDir, 'duck.sql'), fs.readFileSync(path.join(duckDir, 'schema.sql'), 'utf8') + '\n' + fs.readFileSync(path.join(duckDir, 'load.sql'), 'utf8'));
    p = await newPage();
    r = await load(p, path.join(outDir, 'duck.sql'));
    if (!r.ok || !r.md.includes('`customers.csv`') || !r.md.includes('Data stored in other files')) bad('duckdb export: the other files should be named (normal mode)');
    if (r.ok) {
      await p.click('#nsOn'); await wait(500);
      let s = await p.evaluate(() => window.DataBrief.getMarkdown());
      if (!s.includes('`customers.csv`')) bad('duckdb export, no-share: file names should be shown while names are shared (control)');
      await p.evaluate(() => document.querySelector('[data-sw="names"]').click()); await wait(400);
      s = await p.evaluate(() => window.DataBrief.getMarkdown());
      if (s.includes('customers') || s.includes('.csv')) bad('duckdb export, no-share: file names derived from table names must be hidden with the names');
    }
    await p.evaluate(() => localStorage.clear());
    await p.close();

    if (checks.length) fail('SQL dumps and PostgreSQL archives', checks.join(' | '));
    else pass('SQL dumps and PostgreSQL archives', 'text dump, zstd archive recognised by content, structure-only types, cut archive, .dump that is text, binary .sql, large dump cut at 250,000 rows');
  }

  // ---------- DBF files (real files written by an independent library, tests/dbf-fixtures) ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    let p = await newPage();
    let r = await load(p, F('dbase3.dbf'));
    if (!r.ok || !r.md.includes("Zoë O'Brien") || !r.md.includes('**DBF version:** dBase III with memo (0x83)') || !r.md.includes('**Deleted records (not read):** 1') ||
      !r.md.includes('**Memo fields (text stored in a separate file, not read):** `NOTE`') || r.md.includes('deleted row') || r.md.includes('a memo that is not read')) bad('dbase3.dbf: ' + (r.ok ? 'the prompt misses the version, the memo, the deleted count or has a deleted row / a memo text' : r.err));
    if (r.ok) {
      const info = await p.evaluate(() => { const d = window.DataBrief.getState().doc; return { k: d.formatKey, n: d.formatName, secs: d.sections.length, rows: d.sections[0].rows.length, s: d.sections[0].name }; });
      if (info.k !== 'dbf' || info.secs !== 1 || info.rows !== 4 || info.s !== 'dbase3') bad('dbase3.dbf state: ' + JSON.stringify(info));
      if ((await p.$eval('#stFormat', (el) => el.textContent)) !== 'DBF') bad('the Format stat should say DBF');
    }
    await p.close();
    // Cyrillic text in a DOS code page, and a Visual FoxPro file
    p = await newPage();
    r = await load(p, F('cyrillic866.dbf'));
    if (!r.ok || !r.md.includes('Санкт-Петербург') || !r.md.includes('ibm866')) bad('cyrillic866.dbf: the text should be read in code page 866');
    await p.close();
    p = await newPage();
    r = await load(p, F('vfp.dbf'));
    if (!r.ok || !r.md.includes('2024-03-09 14:30:05') || !r.md.includes('Visual FoxPro (0x30)')) bad('vfp.dbf: datetime or version missing');
    await p.close();
    // a cut file: read as far as it goes, and says so
    p = await newPage();
    r = await load(p, F('cut.dbf'));
    if (!r.ok || !r.md.includes('missing from the file (the file is cut):** 2')) bad('cut.dbf: the missing records should be counted');
    await p.close();
    // a text file named .dbf: the clear error
    fs.writeFileSync(path.join(outDir, 'fake.dbf'), 'a,b\n1,2\n');
    p = await newPage();
    r = await load(p, path.join(outDir, 'fake.dbf'));
    if (r.ok || !r.err) bad('a text file named .dbf should be refused with a message');
    await p.close();
    // every text in all 15 languages
    p = await newPage();
    const miss = await p.evaluate(() => {
      const I = window.DB_I18N, out = [];
      for (const l of I.langs.map((x) => x.code)) {
        for (const k of ['fcDbfReads', 'fcDbfBest', 'fcDbfGood']) if (!I.ui[l][k]) out.push(l + ':' + k);
        for (const k of ['mDbVersion', 'mMemo', 'mDeleted', 'mCutRecords']) if (!I.prompt[l][k]) out.push(l + ':' + k);
      }
      return out;
    });
    if (miss.length) bad('missing texts: ' + miss.join(','));
    await p.close();
    if (checks.length) fail('DBF files', checks.join(' | '));
    else pass('DBF files', 'dBase III with memo and a deleted record, DOS code page 866, Visual FoxPro, a cut file, a text file named .dbf, 15 languages');
  }

  // ---------- SQL Server data-tier packages (.dacpac built by Microsoft's own DacFx: tests/dacpac-fixtures) ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    let p = await newPage();
    let r = await load(p, F('shop.dacpac'));
    if (!r.ok) { bad('shop.dacpac: ' + r.err); } else {
      const d = await p.evaluate(() => {
        const x = window.DataBrief.getState().doc;
        const by = Object.fromEntries(x.sections.map((s) => [s.name, s]));
        const c = by.Customers;
        return {
          k: x.formatKey, names: x.sections.map((s) => s.name).sort(), cols: c.columns.map((q) => q.name + ':' + q.meta.sqlType), pk: c.constraints.pk, unique: c.constraints.unique.map((u) => u.name + ':' + u.cols),
          idx: by.Orders.constraints.indexes.map((u) => u.name + ':' + u.cols), desc: c.description, label: c.columns.find((q) => q.name === 'Notes').meta.label, gen: c.columns.find((q) => q.name === 'Label').meta.generated,
          fks: x.sections.flatMap((s) => s.constraints.fks.map((f) => s.name + '(' + f.from + ')->' + f.table + '(' + f.to + ')' + (f.onDelete ? ' ' + f.onDelete : ''))).sort(),
          rel: (x.relationships || []).filter((q) => q.source === 'declared').map((q) => q.cardinality).sort(), views: x.views.map((v) => v.name + ':' + /SUM\(\[Total\]\)/.test(v.sql)),
          types: c.columns.map((q) => q.type), kinds: by.Products.columns.map((q) => q.name + ':' + q.meta.sqlType + ':' + q.type), rows: x.sections.reduce((a, s) => a + s.rows.length, 0),
        };
      });
      const want = {
        names: ['Customers', 'OrderItems', 'Orders', 'ProductTags', 'Products', 'Shipments', 'Tags', 'audit.Log'],
        cols: ['Id:int IDENTITY', 'Email:nvarchar(255)', 'Name:nvarchar(100)', 'Country:char(2)', 'CreatedAt:datetime2(0)', 'Notes:nvarchar(MAX)', 'Balance:decimal(10,2)', 'Active:bit', 'Label:'],
        fks: ['OrderItems(OrderId)->Orders(Id)', 'OrderItems(ProductId)->Products(Id)', 'Orders(CustomerId)->Customers(Id) CASCADE', 'ProductTags(ProductId)->Products(Id) CASCADE', 'ProductTags(TagId)->Tags(Id)',
          'Shipments(OrderId,LineNo)->OrderItems(OrderId,LineNo)'],
      };
      if (d.k !== 'dacpac' || JSON.stringify(d.names) !== JSON.stringify(want.names)) bad('shop.dacpac tables: ' + JSON.stringify(d.names));
      if (JSON.stringify(d.cols) !== JSON.stringify(want.cols)) bad('shop.dacpac Customers columns: ' + JSON.stringify(d.cols));
      if (JSON.stringify(d.fks) !== JSON.stringify(want.fks)) bad('shop.dacpac foreign keys: ' + JSON.stringify(d.fks));
      if (JSON.stringify(d.pk) !== '["Id"]' || JSON.stringify(d.unique) !== '["UQ_Customers_Email:Email"]' || JSON.stringify(d.idx) !== '["IX_Orders_Customer:CustomerId"]') bad('keys and indexes: ' + JSON.stringify([d.pk, d.unique, d.idx]));
      if (d.desc !== 'People who bought something; one row per person' || d.label !== 'Free text written by the sales team') bad('descriptions: ' + JSON.stringify([d.desc, d.label]));
      if (JSON.stringify(d.rel) !== JSON.stringify(['many_to_many', 'many_to_one', 'many_to_one', 'many_to_one', 'many_to_one', 'many_to_one', 'many_to_one'])) bad('relationships (6 foreign keys and the junction table): ' + JSON.stringify(d.rel));
      if (JSON.stringify(d.views) !== '["v_order_totals:true"]' || d.gen.key !== 'genVirtual' || d.rows !== 0) bad('view, computed column or rows: ' + JSON.stringify([d.views, d.gen, d.rows]));
      if (JSON.stringify(d.types) !== JSON.stringify(['integer', 'text', 'text', 'text', 'datetime', 'text', 'decimal', 'boolean', 'text']) || !d.kinds.includes('Unit Price:money:decimal')) bad('column kinds from the SQL Server types: ' + JSON.stringify([d.types, d.kinds]));
      if (!r.md.includes('**SQL dialect:** SQL Server (data-tier package)') || !r.md.includes('**Archive:** dacpac · package version') || !r.md.includes('procedure ×1')) bad('the prompt lines: ' + r.md.slice(0, 600).replace(/\n/g, ' | '));
      if ((await p.$eval('#stFormat', (el) => el.textContent)) !== 'DACPAC') bad('Format stat');
    }
    await p.close();
    // a zip that is not a package: still the spreadsheet path (the clear error); a text file named .dacpac: refused
    fs.writeFileSync(path.join(outDir, 'fake.dacpac'), 'not a zip');
    p = await newPage();
    r = await load(p, path.join(outDir, 'fake.dacpac'));
    if (r.ok || !r.err) bad('a text file named .dacpac should be refused with a message');
    await p.close();
    // no-share: structure and relationships stay, the view SQL only when allowed
    p = await newPage();
    r = await load(p, F('shop.dacpac'));
    await p.click('#nsOn'); await new Promise((res) => setTimeout(res, 500));
    let ns = await p.evaluate(() => window.DataBrief.getMarkdown());
    if (ns.includes('SUM([Total])') || !ns.includes('Shipments') || ns.includes('People who bought something')) bad('no-share on a dacpac: the view SQL or a table comment appeared by default');
    await p.evaluate(() => document.querySelector('[data-sw="sql"]').click()); await new Promise((res) => setTimeout(res, 400));
    ns = await p.evaluate(() => window.DataBrief.getMarkdown());
    if (!ns.includes('SUM([Total])')) bad('no-share: the view SQL should appear when allowed (control)');
    await p.evaluate(() => localStorage.clear());
    await p.close();
    p = await newPage();
    const miss = await p.evaluate(() => { const I = window.DB_I18N, out = []; for (const l of I.langs.map((x) => x.code)) for (const k of ['fcDacpacReads', 'fcDacpacBest', 'fcDacpacGood']) if (!I.ui[l][k]) out.push(l + ':' + k); return out; });
    if (miss.length) bad('missing texts: ' + miss.join(','));
    await p.close();
    if (checks.length) fail('SQL Server data-tier packages', checks.join(' | '));
    else pass('SQL Server data-tier packages', 'real DacFx .dacpac: tables, SQL Server types, keys, indexes, foreign keys with cascade, junction table, view, descriptions, computed column, no row; no-share; 15 languages');
  }

  // ---------- Microsoft Access databases (files written by Jackcess, not by Access: tests/access-fixtures) ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    for (const [file, fmtText] of [['shop.accdb', 'Access 2007 or later (.accdb)'], ['shop.mdb', 'Jet database (.mdb)']]) {
      const p = await newPage();
      const r = await load(p, F(file));
      if (!r.ok) { bad(file + ': ' + r.err); await p.close(); continue; }
      const d = await p.evaluate(() => {
        const x = window.DataBrief.getState().doc;
        return { k: x.formatKey, n: x.sections.length, cust: x.sections.find((s) => s.name === 'Customers').rows.length, declared: (x.relationships || []).filter((q) => q.source === 'declared').length,
          types: x.sections.find((s) => s.name === 'Customers').columns.map((c) => c.type) };
      });
      if (d.k !== 'access' || d.n !== 7 || d.cust !== 6 || d.declared !== 6) bad(file + ': ' + JSON.stringify(d));
      if (JSON.stringify(d.types) !== JSON.stringify(['integer', 'text', 'text', 'text', 'datetime', 'text', 'boolean', 'decimal', 'decimal'])) bad(file + ': column kinds ' + JSON.stringify(d.types));
      if (!r.md.includes('**Access format:** ' + fmtText) || !r.md.includes('**Not read:** saved queries') || !r.md.includes("Bob O'Brien") || !r.md.includes('Unit Price')) bad(file + ': the prompt');
      if ((await p.$eval('#stFormat', (el) => el.textContent)) !== 'Access') bad(file + ': the Format stat should say Access');
      await p.close();
    }
    // a text file named .accdb: the clear error; the page never runs anything from the file
    fs.writeFileSync(path.join(outDir, 'fake.accdb'), 'a,b\n1,2\n');
    let p = await newPage();
    let r = await load(p, path.join(outDir, 'fake.accdb'));
    if (r.ok || !r.err) bad('a text file named .accdb should be refused with a message');
    await p.close();
    // no-share: the rows are dropped, the relationships and the structure stay, names can be hidden
    p = await newPage();
    r = await load(p, F('shop.accdb'));
    await p.click('#nsOn'); await new Promise((res) => setTimeout(res, 500));
    const ns = await p.evaluate(() => window.DataBrief.getMarkdown());
    if (ns.includes('ana.secret@example.com') || ns.includes('CONFIDENTIAL_CUSTOMER_74291') || !ns.includes('Shipments') || !/Declared by the source/.test(ns)) bad('no-share on an Access file: a row leaked, or the structure or relationships are missing');
    await p.evaluate(() => localStorage.clear());
    await p.close();
    // every text in all 15 languages
    p = await newPage();
    const miss = await p.evaluate(() => {
      const I = window.DB_I18N, out = [];
      for (const l of I.langs.map((x) => x.code)) {
        for (const k of ['fcAccessReads', 'fcAccessBest', 'fcAccessGood', 'errAccessProtected']) if (!I.ui[l][k]) out.push(l + ':' + k);
        for (const k of ['mAccess', 'mNotRead']) if (!I.prompt[l][k]) out.push(l + ':' + k);
      }
      return out;
    });
    if (miss.length) bad('missing texts: ' + miss.join(','));
    await p.close();
    if (checks.length) fail('Access databases', checks.join(' | '));
    else pass('Access databases', '.accdb and .mdb read with types, rows and the six stored relationships; a text file named .accdb refused; no-share; 15 languages');
  }

  // ---------- DuckDB "EXPORT DATABASE" folders, zipped (real exports of tests/sql-fixtures) ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    const info = (p) => p.evaluate(() => {
      const d = window.DataBrief.getState().doc;
      return { k: d.formatKey, n: d.sections.length, rows: Object.fromEntries(d.sections.map((s) => [s.name, s.rows.length])), declared: (d.relationships || []).filter((r) => r.source === 'declared').length,
        weird: d.sections.find((s) => s.name === 'weird name').rows, cust: d.sections.find((s) => s.name === 'customers').rows };
    });
    for (const [file, label] of [['duckdb-csv.zip', 'CSV in a folder'], ['duckdb-parquet.zip', 'Parquet, flat']]) {
      const p = await newPage();
      const r = await load(p, F(file));
      if (!r.ok) { bad(label + ': ' + r.err); await p.close(); continue; }
      const d = await info(p);
      const want = { customers: 6, products: 4, tags: 3, product_tags: 4, orders: 5, order_items: 5, shipments: 3, 'weird name': 2 };
      if (d.k !== 'duckdb' || d.n !== 8 || JSON.stringify(Object.entries(d.rows).sort()) !== JSON.stringify(Object.entries(want).sort()) || d.declared !== 7) bad(label + ': ' + JSON.stringify(d));
      if (!r.md.includes('**SQL dialect:** DuckDB (EXPORT DATABASE)') || !r.md.includes('**Archive:** zip archive · 10 files') || r.md.includes('Data stored in other files')) bad(label + ': the prompt lines');
      const bob = d.cust.find((row) => row[0] === '2');
      if (!bob || bob[2] !== "Bob O'Brien" || !bob[5].includes('with semicolon -- not a comment')) bad(label + ': a value was not read right: ' + JSON.stringify(bob));
      if (file === 'duckdb-csv.zip' && (JSON.stringify(d.weird) !== JSON.stringify([['1', 'a;b', '--x'], ['2', '', '/* not a comment */']]) || d.cust.find((row) => row[0] === '4')[5] !== 'back\\slash path C:\\temp')) bad(label + ': the awkward values');
      if (!r.md.includes('many to many')) bad(label + ': the relationships should include the junction table');
      await p.close();
    }
    // a data file missing from the zip: that table is listed as skipped, the others are read
    let p = await newPage();
    let r = await load(p, F('duckdb-missing.zip'));
    if (!r.ok || !r.md.includes('(skipped):** `orders`') || (await info(p)).rows.orders !== 0 || (await info(p)).rows.customers !== 6) bad('missing data file: ' + (r.ok ? 'not reported' : r.err));
    await p.close();
    // a spreadsheet is still a spreadsheet (a zip inside)
    p = await newPage();
    r = await load(p, F('workbook.xlsx'));
    if (!r.ok || !r.md.includes('Globex')) bad('an .xlsx must still be read as a workbook');
    await p.close();
    // no-share: the rows are dropped, the structure stays
    p = await newPage();
    r = await load(p, F('duckdb-csv.zip'));
    await p.click('#nsOn'); await new Promise((res) => setTimeout(res, 500));
    const ns = await p.evaluate(() => window.DataBrief.getMarkdown());
    if (ns.includes('ana.secret@example.com') || ns.includes('CONFIDENTIAL_CUSTOMER_74291') || !ns.includes('many to many')) bad('no-share on a DuckDB export: a row leaked or the relationships are missing');
    await p.evaluate(() => localStorage.clear());
    await p.close();
    // the card exists in all 15 languages
    p = await newPage();
    const miss = await p.evaluate(() => { const I = window.DB_I18N, out = []; for (const l of I.langs.map((x) => x.code)) for (const k of ['fcDuckdbReads', 'fcDuckdbBest', 'fcDuckdbGood']) if (!I.ui[l][k]) out.push(l + ':' + k); return out; });
    if (miss.length) bad('missing texts: ' + miss.join(','));
    await p.close();
    if (checks.length) fail('DuckDB exports', checks.join(' | '));
    else pass('DuckDB exports', 'zipped CSV folder and flat Parquet read with their rows, relationships and awkward values; a missing data file skipped; xlsx still a workbook; no-share; 15 languages');
  }

  // ---------- files recognised but not readable (clear message), and gzip ----------
  {
    const checks = [];
    const bad = (m) => checks.push(m);
    const zlib = require('zlib');
    const pad = (n) => Buffer.alloc(n);
    const ascii = (s) => Buffer.from(s, 'latin1');
    const SAMPLES = [
      ['duckdb', Buffer.concat([pad(8), ascii('DUCK'), pad(200)]), 'DuckDB database'],
      ['hdf5', Buffer.concat([Buffer.from([0x89]), ascii('HDF\r\n'), Buffer.from([0x1a, 0x0a]), pad(100)]), 'HDF5 file'],
      ['arrow', Buffer.concat([ascii('ARROW1'), pad(2), pad(100)]), 'Apache Arrow'],
      ['feather', Buffer.concat([ascii('FEA1'), pad(100)]), 'Apache Arrow'],
      ['orc', Buffer.concat([ascii('ORC'), Buffer.from([0x01, 0x02, 0x00, 0x03]), pad(100)]), 'Apache ORC'],
      ['avro', Buffer.concat([ascii('Obj'), Buffer.from([1]), ascii('\x04\x16avro.schema'), pad(40)]), 'Apache Avro'],
      ['pdf', ascii('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< >>\nendobj\n'), 'PDF document'],
      ['bak', Buffer.concat([ascii('TAPE'), pad(100)]), 'SQL Server backup'],
      ['dmp', Buffer.concat([Buffer.from([0x03, 0x00]), ascii('EXPORT:V19.00.00\nUSCOTT\nRTABLES\n'), pad(100)]), 'Oracle export'],
    ];
    for (const [ext, bytes, phrase] of SAMPLES) {
      const f = path.join(outDir, 'known.' + ext);
      fs.writeFileSync(f, bytes);
      const p = await newPage();
      const r = await load(p, f);
      if (r.ok || !r.err.includes(phrase)) bad(ext + ': expected a message with "' + phrase + '", got ' + JSON.stringify(r.ok ? 'a result' : r.err.slice(0, 80)));
      if (r.detail) bad(ext + ': no technical details expected, got ' + r.detail.slice(0, 60));
      await p.close();
    }
    // the same file with a name that has no extension, or a wrong one: recognised by its content
    fs.writeFileSync(path.join(outDir, 'noext'), SAMPLES[0][1]);
    let p = await newPage();
    let r = await load(p, path.join(outDir, 'noext'));
    if (r.ok || !r.err.includes('DuckDB')) bad('a DuckDB file without extension: ' + r.err.slice(0, 80));
    await p.close();
    // no false alarm: text files that merely START with the same letters are read as usual
    for (const [name, text, key] of [['orchard.csv', 'ORCHARD,kind\n1,apple\n2,pear\n', 'ORCHARD'], ['tape.csv', 'TAPE,length\nA,10\nB,20\n', 'TAPE'], ['obj.csv', 'Obj,x\n1,2\n', 'Obj']]) {
      fs.writeFileSync(path.join(outDir, name), text);
      p = await newPage();
      r = await load(p, path.join(outDir, name));
      if (!r.ok || !r.md.includes(key)) bad(name + ': a CSV starting with the letters of a known format must still be read');
      await p.close();
    }
    // gzip: dump.sql.gz and data.csv.gz are read, and the prompt says the file was compressed
    fs.writeFileSync(path.join(outDir, 'dump.sql.gz'), zlib.gzipSync(fs.readFileSync(F('pg16-default.sql'))));
    p = await newPage();
    r = await load(p, path.join(outDir, 'dump.sql.gz'));
    let d = r.ok && await p.evaluate(() => { const x = window.DataBrief.getState().doc; return { n: x.fileName, k: x.formatKey, s: x.sections.length }; });
    if (!d || d.n !== 'dump.sql.gz' || d.k !== 'sql' || d.s !== 8 || !/\*\*Compression:\*\* gzip · /.test(r.md)) bad('dump.sql.gz: ' + JSON.stringify(d || r.err));
    await p.close();
    fs.writeFileSync(path.join(outDir, 'data.csv.gz'), zlib.gzipSync(Buffer.from('a,b\n1,2\n3,4\n')));
    p = await newPage();
    r = await load(p, path.join(outDir, 'data.csv.gz'));
    if (!r.ok || !r.md.includes('| 3 | 4 |')) bad('data.csv.gz was not read');
    await p.close();
    // a damaged gzip, a gzip of something unknown, a gzip inside a gzip: clear errors, no exception
    const gz = zlib.gzipSync(Buffer.from('a,b\n1,2\n'));
    fs.writeFileSync(path.join(outDir, 'broken.csv.gz'), gz.subarray(0, gz.length - 12));
    p = await newPage();
    r = await load(p, path.join(outDir, 'broken.csv.gz'));
    if (r.ok) bad('a truncated gzip should be refused');
    await p.close();
    fs.writeFileSync(path.join(outDir, 'double.csv.gz'), zlib.gzipSync(gz));
    p = await newPage();
    r = await load(p, path.join(outDir, 'double.csv.gz'));
    if (r.ok) bad('a gzip inside a gzip should be refused');
    await p.close();
    // several gzip members (concatenated files, bgzip with its empty last member): all of them are read
    fs.writeFileSync(path.join(outDir, 'members.csv.gz'), Buffer.concat([zlib.gzipSync('a,b\n1,2\n3,4\n'), zlib.gzipSync('5,6\n'), zlib.gzipSync('')]));
    p = await newPage();
    r = await load(p, path.join(outDir, 'members.csv.gz'));
    if (!r.ok || !r.md.includes('| 5 | 6 |') || !r.md.includes('| 1 | 2 |')) bad('a gzip of several members should be read whole: ' + (r.err || r.md.slice(0, 200)));
    await p.close();
    // a gzip whose stored size lies (says 900 MB): read by its real content, no huge allocation
    const liar = Buffer.from(zlib.gzipSync('a,b\n1,2\n')); liar.writeUInt32LE(900 * 1024 * 1024, liar.length - 4);
    fs.writeFileSync(path.join(outDir, 'liar.csv.gz'), liar);
    p = await newPage();
    r = await load(p, path.join(outDir, 'liar.csv.gz'));
    if (!r.ok && !/too large/i.test(r.err)) bad('a gzip with a wrong stored size: ' + r.err);
    await p.close();
    // a DuckDB export zipped by Windows PowerShell (backslashes), with a damaged entry nobody needs (never decompressed)
    p = await newPage();
    r = await load(p, F('duckdb-windows.zip'));
    d = r.ok && await p.evaluate(() => { const x = window.DataBrief.getState().doc; return { k: x.formatKey, rows: x.sections.map((s) => s.name + ':' + s.rows.length).join(' ') }; });
    if (!d || d.k !== 'duckdb' || !/customers:6/.test(d.rows)) bad('DuckDB export zipped on Windows: ' + JSON.stringify(d || r.err));
    await p.close();
    // file names of other files (COPY ... FROM a file) are hidden with the file name, not only with the names
    p = await newPage();
    r = await load(p, path.join(outDir, 'duck.sql'));
    if (r.ok) {
      await p.click('#nsOn'); await new Promise((res) => setTimeout(res, 400));
      await p.evaluate(() => document.querySelector('[data-sw="file"]').click()); await new Promise((res) => setTimeout(res, 400));
      const s = await p.evaluate(() => window.DataBrief.getMarkdown());
      if (s.includes('customers.csv')) bad('names of other files must be hidden with the file name');
      await p.evaluate(() => localStorage.clear());
    } else bad('duck.sql: ' + r.err);
    await p.close();
    // every message exists in all 15 languages
    p = await newPage();
    const miss = await p.evaluate(() => {
      const I = window.DB_I18N, out = [];
      for (const l of I.langs.map((x) => x.code)) {
        for (const k of ['errKindDuckdb', 'errKindHdf5', 'errKindArrow', 'errKindOrc', 'errKindAvro', 'errKindPdf', 'errKindMssqlBak', 'errKindOracleDmp', 'errTooLarge', 'errPgCorrupt', 'errPgVersion', 'errPgCompression']) if (!I.ui[l][k]) out.push(l + ':' + k);
        if (!I.prompt[l].mCompressed) out.push(l + ':mCompressed');
      }
      return out;
    });
    if (miss.length) bad('missing texts: ' + miss.join(','));
    await p.close();
    if (checks.length) fail('unreadable formats and gzip', checks.join(' | '));
    else pass('unreadable formats and gzip', '9 known formats refused with advice (by content, any name), no false alarm on text, gzip read, damaged and nested gzip refused, 15 languages');
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
