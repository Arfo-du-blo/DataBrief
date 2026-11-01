/* DataBrief - SQL dump reader (.sql). GPL-3.0-or-later.
 *
 * Reads the TEXT of a dump. It never executes anything: no statement is run, no function is called, no file or URL is
 * opened. Values written as function calls stay as their text (nextval(...), now(), pg_sleep(10)); only the pure
 * literal forms that dump tools use to write a string are decoded (unistr('\u000a'), char(10), replace(..), ||).
 *
 *   DB.parseSqlDump(text | [chunks], opts) -> { sections, views, fileMeta, notes, info }
 *   new DB.SqlDumpReader(opts): .push(textChunk) ... .end() -> same result (streaming: the text is never held whole)
 *
 * sections[]: { name, columns: [{ name, meta: { sqlType, key, notNull, generated, label, values } }], rows: [[string]],
 *               constraints: { pk, fks: [{ table, from, to, onDelete, onUpdate }], unique, indexes, ddl },
 *               description, rowsTotal, externalData }   (same shape as the SQLite reader: relationships.js works as is)
 * info: { dialect, statements, tables, views, rows, ignored: { kind: n }, errors: { kind: n }, externalFiles, schemas,
 *         truncated, unterminated }   -- counts and names only, never a value of the data.
 *
 * Dialects (detected from the start of the file): postgres, mysql (MySQL, MariaDB), mssql, oracle, sqlite, clickhouse,
 * generic (DuckDB exports, hand-written SQL). The dialect only changes how quotes, comments and statement ends are read.
 *
 * Tested on real dumps (tests/sql-fixtures, tests/test_sql_parser.cjs). Known limits, counted in info.ignored, never guessed:
 *   - PostgreSQL custom / tar archives are binary: read by pgarchive.js, which gives this reader their SQL text.
 *     COPY ... (FORMAT binary) is not read.
 *   - INSERT ... SELECT and CREATE TABLE ... AS SELECT have no values / columns to read.
 *   - DuckDB EXPORT DATABASE and COPY ... FROM 'file': the data is in other files, only their names are kept.
 *   - Not handled: Oracle q'[...]' strings, PostgreSQL U&'...' UESCAPE, MySQL ANSI_QUOTES dumps ("x" read as text).
 *   - SQL Server batches without ';' are cut before INSERT, session SET options, CREATE/ALTER TABLE and INDEX only.
 * Notes for the "Do not share data" mode: table comments (description), column comments (meta.label), enum labels
 * (meta.values), definitions with literals (constraints.ddl, views) and external file names are written by people. */
'use strict';
(function () {
  const DB = window.DB;

  /* ---------------------------------------------------------------- dialect ---------- */
  const DIALECT_NAMES = { postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', mssql: 'SQL Server', oracle: 'Oracle', sqlite: 'SQLite', clickhouse: 'ClickHouse', generic: 'SQL' };
  const SIGNS = [
    ['postgres', /PostgreSQL database dump|-- Dumped (from|by) (database version|pg_dump)/i, 6], ['postgres', /\bFROM stdin;/i, 3],
    ['postgres', /^SET (standard_conforming_strings|client_encoding|search_path|default_tablespace)\b/mi, 2], ['postgres', /\bpg_catalog\./, 3],
    ['postgres', /^\\(connect|restrict)\b/m, 3],
    ['mysql', /^-- (MySQL|MariaDB) dump/mi, 6], ['mysql', /\/\*M?!\d{5}/, 3], ['mysql', /\bENGINE\s*=\s*(InnoDB|MyISAM|Aria|MEMORY|CSV|ARCHIVE)\b/i, 4],
    ['mysql', /^LOCK TABLES `/m, 3], ['mysql', /\bAUTO_INCREMENT\b/i, 1],
    // mysqldump --compact --no-create-info: no comment, no ENGINE=, only INSERT INTO `t` with \' escapes
    ['mysql', /^INSERT (IGNORE )?INTO `/m, 3], ['mysql', /[^\\]\\'/, 1],
    ['mssql', /^\s*GO\s*$/mi, 3], ['mssql', /\[dbo\]\./i, 4], ['mssql', /\bSET ANSI_NULLS (ON|OFF)\b/i, 3], ['mssql', /\bIDENTITY\s*\(\s*\d/i, 2],
    ['mssql', /\bN?VARCHAR\s*\(\s*MAX\s*\)/i, 2],
    ['oracle', /\bVARCHAR2\b/i, 4], ['oracle', /\bNUMBER\s*\(\s*\d/i, 2], ['oracle', /\bALTER SESSION SET\b/i, 2], ['oracle', /^\s*\/\s*$/m, 1],
    ['sqlite', /^PRAGMA foreign_keys\s*=/mi, 4], ['sqlite', /\bsqlite_sequence\b/, 3], ['sqlite', /\bunistr\(/, 1], ['sqlite', /^BEGIN TRANSACTION;/mi, 1],
    ['clickhouse', /\bENGINE\s*=\s*(Replicated)?(Replacing|Summing|Aggregating|Collapsing|VersionedCollapsing|Graphite)?MergeTree\b/, 6],
    ['clickhouse', /\bENGINE\s*=\s*(Log|TinyLog|StripeLog|Memory|Null|Distributed)\b/, 4],
    ['clickhouse', /\b(U?Int(8|16|32|64|128|256)|Float(32|64)|LowCardinality|Nullable|DateTime64)\b/, 2],
  ];
  function detectDialect(head) {
    const score = {};
    for (const [d, re, w] of SIGNS) if (re.test(head)) score[d] = (score[d] || 0) + w;
    let best = 'generic', top = 0;
    for (const [d, v] of Object.entries(score)) if (v > top) { best = d; top = v; }
    return best;
  }
  // How the text is read in each dialect.
  function lexFor(d) {
    return {
      backslash: d === 'mysql' || d === 'clickhouse',   // \' \n ... inside every string
      esc: d === 'mysql' ? 'my' : d === 'clickhouse' ? 'ch' : 'pg', // which escapes: MySQL has no octal, \x or \u
      dollar: d === 'postgres' || d === 'generic',      // $tag$ ... $tag$ strings
      nested: d === 'postgres',                          // /* /* */ */
      hash: d === 'mysql',                               // # comment
      mysqlDash: d === 'mysql',                          // "--" starts a comment only when followed by a space
      brackets: d === 'mssql',                           // [identifier]
      go: d === 'mssql',                                 // GO on its own line ends a batch
      slash: d === 'oracle',                             // / on its own line ends a block
      routines: d === 'mssql' || d === 'oracle',         // ';' inside procedure bodies does not end the statement
    };
  }

  /* ---------------------------------------------------------------- statement splitter (streaming) ---------- */
  // Splits the text into statements, chunk by chunk, keeping its state between chunks: inside a string, a comment, a
  // dollar quote, a COPY ... FROM stdin data block. The result does not depend on where the chunks are cut.
  const LOOK = 256; // characters kept back at the end of a chunk so that every look-ahead is complete
  const ROUTINE_HEAD = /^\s*(?:CREATE|ALTER)\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PROCEDURE|PROC|FUNCTION|PACKAGE|TRIGGER|TYPE\s+BODY)\b|^\s*(?:DECLARE|BEGIN)\b/i;
  // SQL Server: BEGIN TRANSACTION, BEGIN TRY, DECLARE @x are ordinary statements (an Oracle PL/SQL block starts with them)
  const ROUTINE_HEAD_MSSQL = /^\s*(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:PROCEDURE|PROC|FUNCTION|TRIGGER)\b/i;
  const esc = (s) => s.replace(/[\\^\]\-[]/g, '\\$&');

  class Splitter {
    constructor(lex, sink) {
      this.lex = lex; this.sink = sink;
      this.buf = ''; this.i = 0; this.start = 0;
      this.mode = 'n';          // n normal, q quoted, l line comment, b block comment, d dollar quote
      this.q = ''; this.qbs = false; this.depth = 0; this.tag = '';
      this.exec = 0;            // open MySQL executable comments /*!40101 ... */
      this.has = false;         // the current statement has code (not only spaces and comments)
      this.lineStart = true;
      this.delim = ';';
      this.copy = 0;            // 0 no, 1 skip the rest of the COPY line, 2 data lines
      this.noStd = false;       // PostgreSQL standard_conforming_strings = off: backslashes in every string
      this.buildRe();
    }
    buildRe() {
      const set = new Set(["'", '"', '`', '-', '/', '\n', '\\', '*']);
      if (this.lex.hash) set.add('#');
      if (this.lex.dollar) set.add('$');
      if (this.lex.brackets) set.add('[');
      set.add(this.delim[0]);
      this.reN = new RegExp('[' + Array.from(set).map(esc).join('') + ']', 'g');
    }
    push(chunk, final) {
      const keep = this.copy ? this.i : this.start;
      if (keep > 0) { this.buf = this.buf.slice(keep); this.i -= keep; this.start = this.copy ? 0 : this.start - keep; }
      this.buf += chunk;
      this.scan(!!final);
    }
    end() {
      this.scan(true);
      if (this.copy === 2) this.sink.copyEnd(false);
      if (this.has) this.emit(this.buf.length, this.buf.length);
      return { unterminated: this.mode === 'q' || this.mode === 'd' || this.mode === 'b' };
    }
    emit(endAt, next) {
      const text = this.buf.slice(this.start, endAt);
      const had = this.has;
      this.start = next; this.has = false; this.exec = 0;
      if (!had) return;
      const r = this.sink.statement(text) || {};
      if (r.copy) this.copy = 1;
      if (r.noStd != null) this.noStd = r.noStd;
      if (r.backslash != null) this.lex.backslash = r.backslash;
    }
    // A line at the start of which something special may stand: psql meta-command, DELIMITER, GO, a lone "/".
    lineCheck(i, final) {
      const buf = this.buf;
      let nl = buf.indexOf('\n', i);
      if (nl < 0 && !final && buf.length - i < LOOK) return -2; // wait for the rest of the line
      if (nl < 0) nl = buf.length;
      if (nl - i > 200) return -1;                              // special lines are short
      const line = buf.slice(i, nl).replace(/\r$/, '');
      const next = Math.min(nl + 1, buf.length);
      if (!this.has && line.charAt(0) === '\\') {               // \connect, \restrict, \unrestrict ... (psql)
        this.sink.ignore('psql');
        this.start = next; this.lineStart = true; return next;
      }
      let m;
      if (!this.has && (m = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line))) {
        this.delim = m[1]; this.buildRe();
        this.start = next; this.lineStart = true; return next;
      }
      if ((this.lex.go && /^\s*GO(\s+\d+)?\s*$/i.test(line)) || (this.lex.slash && /^\s*\/\s*$/.test(line))) {
        this.emit(i, next); this.lineStart = true; return next;
      }
      return -1;
    }
    scan(final) {
      const buf = this.buf, lex = this.lex;
      const limit = final ? buf.length : buf.length - LOOK;
      let i = this.i;
      outer:
      while (i < limit || (this.copy === 2 && i < buf.length)) {
        /* COPY ... FROM stdin: one record per line, until a line "\." */
        if (this.copy) {
          const nl = buf.indexOf('\n', i);
          if (nl < 0 && !final) break;
          const end = nl < 0 ? buf.length : nl;
          if (this.copy === 1) { this.copy = 2; i = end + 1; continue; }
          const line = buf.slice(i, end).replace(/\r$/, '');
          i = end + 1;
          if (line === '\\.') { this.copy = 0; this.sink.copyEnd(true); this.start = i; this.lineStart = true; continue; }
          this.sink.copyRow(line);
          continue;
        }
        switch (this.mode) {
          case 'q': {
            const close = this.q === '[' ? ']' : this.q;
            let k = buf.indexOf(close, i), b = this.qbs ? buf.indexOf('\\', i) : -1;   // kept while ahead: linear
            for (;;) {
              if (k >= 0 && k < i) k = buf.indexOf(close, i);
              if (b >= 0 && b < i) b = buf.indexOf('\\', i);
              if (b >= 0 && (k < 0 || b < k)) {
                if (b + 1 >= buf.length && !final) { this.i = b; return; }
                i = b + 2; continue;
              }
              if (k < 0) { i = buf.length; if (!final) { this.i = i; return; } break outer; }
              if (k + 1 >= buf.length && !final) { this.i = k; return; }  // a doubled quote cannot be told yet
              if (buf[k + 1] === close) { i = k + 2; continue; }
              i = k + 1; this.mode = 'n'; break;
            }
            continue;
          }
          case 'l': {
            const k = buf.indexOf('\n', i);
            if (k < 0) { i = buf.length; if (!final) { this.i = i; return; } break outer; }
            i = k; this.mode = 'n';
            continue;
          }
          case 'b': {
            let k = buf.indexOf('*/', i), o = lex.nested ? buf.indexOf('/*', i) : -1;   // both kept while ahead: linear
            for (;;) {
              if (k >= 0 && k < i) k = buf.indexOf('*/', i);
              if (o >= 0 && o < i) o = buf.indexOf('/*', i);
              if (o >= 0 && (k < 0 || o < k)) { this.depth++; i = o + 2; continue; }
              if (k < 0) { i = Math.max(i, buf.length - 1); if (!final) { this.i = i; return; } i = buf.length; break outer; }
              i = k + 2;
              if (--this.depth === 0) { this.mode = 'n'; break; }
            }
            continue;
          }
          case 'd': {
            const k = buf.indexOf(this.tag, i);
            if (k < 0) { i = Math.max(i, buf.length - this.tag.length); if (!final) { this.i = i; return; } i = buf.length; break outer; }
            i = k + this.tag.length; this.mode = 'n';
            continue;
          }
          default: break;
        }
        /* normal code */
        if (this.lineStart) {
          this.lineStart = false;
          const r = this.lineCheck(i, final);
          if (r === -2) { this.lineStart = true; break; }
          if (r >= 0) { i = r; continue; }
        }
        this.reN.lastIndex = i;
        const m = this.reN.exec(buf);
        const k = m ? m.index : buf.length;
        if (!this.has && k > i && /\S/.test(buf.slice(i, k))) this.has = true;
        if (k >= limit) { i = Math.max(i, limit); if (!m && final) i = buf.length; break; }
        const c = buf[k];
        i = k;
        if (c === '\n') { this.lineStart = true; i = k + 1; continue; }
        if (buf.startsWith(this.delim, k)) {
          if (lex.routines && this.delim === ';' && (lex.go ? ROUTINE_HEAD_MSSQL : ROUTINE_HEAD).test(stripComments(buf.slice(this.start, Math.min(k, this.start + 400))))) {
            this.has = true; i = k + 1; continue;              // a ';' inside a procedure body
          }
          this.emit(k, k + this.delim.length);
          i = k + this.delim.length;
          continue;
        }
        switch (c) {
          case "'": {
            const p = buf[k - 1], pp = buf[k - 2];
            const eStr = (p === 'E' || p === 'e') && !/[\w$]/.test(pp || '');
            this.mode = 'q'; this.q = "'"; this.qbs = lex.backslash || this.noStd || eStr; this.has = true; i = k + 1; break;
          }
          case '"': this.mode = 'q'; this.q = '"'; this.qbs = lex.backslash; this.has = true; i = k + 1; break;
          case '`': this.mode = 'q'; this.q = '`'; this.qbs = false; this.has = true; i = k + 1; break;
          case '[': this.mode = 'q'; this.q = '['; this.qbs = false; this.has = true; i = k + 1; break;
          case '-':
            if (buf[k + 1] === '-' && (!lex.mysqlDash || /\s/.test(buf[k + 2] || '\n'))) { this.mode = 'l'; i = k + 2; }
            else { this.has = true; i = k + 1; }
            break;
          case '#': this.mode = 'l'; i = k + 1; break;
          case '/':
            if (buf[k + 1] === '*') {
              const x = /\/\*M?!\d*/y; x.lastIndex = k;
              const mm = x.exec(buf);
              if (mm && buf[k + mm[0].length] !== '\\') { this.exec++; i = k + mm[0].length; break; }
              this.mode = 'b'; this.depth = 1; i = k + 2;
            } else { this.has = true; i = k + 1; }
            break;
          case '*':
            if (this.exec > 0 && buf[k + 1] === '/') { this.exec--; i = k + 2; } else { this.has = true; i = k + 1; }
            break;
          case '$': {
            const x = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y; x.lastIndex = k;
            const mm = x.exec(buf);
            if (mm && !/[\w$]/.test(buf[k - 1] || '')) { this.mode = 'd'; this.tag = mm[0]; i = k + mm[0].length; }
            else i = k + 1;
            this.has = true;
            break;
          }
          case '\\':
            if (!this.has) {                                     // psql meta-command after a ';' on the same line
              const nl = buf.indexOf('\n', k);
              if (nl < 0 && !final) { i = k; break outer; }
              this.sink.ignore('psql');
              i = nl < 0 ? buf.length : nl + 1; this.start = i; this.lineStart = true;
            } else { this.has = true; i = k + 1; }
            break;
          default: this.has = true; i = k + 1;
        }
      }
      this.i = i;
    }
  }
  function stripComments(s) { return s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' '); }
  // ClickHouse data-skipping index: INDEX name expression TYPE kind GRANULARITY n
  function st2HasType(c, b) { for (let k = c.i + 2; k < b; k++) { const x = c.t[k]; if (x.k === 'w' && x.u === 'TYPE') return true; } return false; }

  /* ---------------------------------------------------------------- tokenizer (one statement) ---------- */
  // Token kinds: w word, i quoted identifier (`x` [x]), d double-quoted (identifier, or a string in MySQL), s string,
  // n number, x binary literal, p punctuation, o operator.
  const OPS = ['::', '||', '->>', '->', '<=', '>=', '<>', '!=', ':=', '=>', '<<', '>>', '&&', '#>>', '#>'];
  const CHARSET_INTRO = /^_(utf8mb4|utf8mb3|utf8|latin1|latin2|binary|ascii|ucs2|utf16|utf16le|utf32|cp1250|cp1251|cp1252|cp850|gbk|big5|sjis|euckr|ujis|koi8r|greek|hebrew|tis620|armscii8|geostd8|swe7|dec8|hp8|keybcs2|macce|macroman|cp852|cp866|cp932|eucjpms|gb2312|gb18030)$/i;

  // mode: 'my' MySQL / MariaDB (\0 is NUL, \x \u \U are plain letters, \% \_ keep the backslash), 'ch' ClickHouse (\xHH),
  // 'pg' PostgreSQL E'' strings (octal, \xHH, \uXXXX, \UXXXXXXXX)
  function escapeAt(t, j, mode) {
    const c = t[j + 1];
    if (c === undefined) return { v: '\\', e: j + 1 };
    if (mode === 'my' || mode === 'ch') {
      if (c === '0') return { v: '\0', e: j + 2 };
      if (c === '%' || c === '_') return { v: mode === 'my' ? '\\' + c : c, e: j + 2 };
      if (c === 'u' || c === 'U' || (c === 'x' && mode === 'my')) return { v: c, e: j + 2 };
    }
    if (mode === 'pg' && (c === '%' || c === '_')) return { v: c, e: j + 2 };
    switch (c) {
      case 'n': return { v: '\n', e: j + 2 };
      case 'r': return { v: '\r', e: j + 2 };
      case 't': return { v: '\t', e: j + 2 };
      case 'b': return { v: '\b', e: j + 2 };
      case 'f': return { v: '\f', e: j + 2 };
      case 'v': return { v: '\v', e: j + 2 };
      case 'Z': return { v: '\x1a', e: j + 2 };
      case 'x': { const m = /^[0-9a-fA-F]{1,2}/.exec(t.slice(j + 2, j + 4)); if (m) return { v: String.fromCharCode(parseInt(m[0], 16)), e: j + 2 + m[0].length }; break; }
      case 'u': { const m = /^[0-9a-fA-F]{4}/.exec(t.slice(j + 2, j + 6)); if (m) return { v: String.fromCharCode(parseInt(m[0], 16)), e: j + 6 }; break; }
      case 'U': {   // beyond U+10FFFF is not a character: kept as written (String.fromCodePoint would throw)
        const m = /^[0-9a-fA-F]{8}/.exec(t.slice(j + 2, j + 10));
        if (m && parseInt(m[0], 16) <= 0x10ffff) return { v: String.fromCodePoint(parseInt(m[0], 16)), e: j + 10 };
        break;
      }
      default: {
        const m = mode === 'pg' && /^[0-7]{1,3}/.exec(t.slice(j + 1, j + 4));
        if (m) return { v: String.fromCharCode(parseInt(m[0], 8)), e: j + 1 + m[0].length };
      }
    }
    return { v: c, e: j + 2 };
  }
  // bs: the escape mode of escapeAt ('my', 'ch', 'pg'), or nothing when a backslash is an ordinary character
  function readQuoted(t, i, close, bs) {
    let out = '', from = i + 1, j = i + 1;
    let k = t.indexOf(close, j), b = bs ? t.indexOf('\\', j) : -1;   // both kept while ahead: linear
    for (;;) {
      if (k >= 0 && k < j) k = t.indexOf(close, j);
      if (b >= 0 && b < j) b = t.indexOf('\\', j);
      if (b >= 0 && (k < 0 || b < k)) { out += t.slice(from, b); const r = escapeAt(t, b, bs); out += r.v; j = from = r.e; continue; }
      if (k < 0) return { v: out + t.slice(from), e: t.length, open: true };
      if (t[k + 1] === close) { out += t.slice(from, k) + close; j = from = k + 2; continue; }
      return { v: out + t.slice(from, k), e: k + 1 };
    }
  }
  function blobText(hex) { return '[binary ' + Math.floor(hex.replace(/\s/g, '').length / 2) + ' bytes]'; }

  function tokenize(text, lex, noStd) {
    const toks = [], hidden = [];
    const n = text.length;
    let i = 0, exec = 0, open = false;
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; continue; }
      if (c === '-' && text[i + 1] === '-' && (!lex.mysqlDash || i + 2 >= n || /\s/.test(text[i + 2]))) { const k = text.indexOf('\n', i); i = k < 0 ? n : k; continue; }
      if (c === '#' && lex.hash) { const k = text.indexOf('\n', i); i = k < 0 ? n : k; continue; }
      if (c === '/' && text[i + 1] === '*') {
        const x = /\/\*M?!\d*/y; x.lastIndex = i;
        const mm = x.exec(text);
        if (mm && text[i + mm[0].length] !== '\\') { hidden.push([i, i + mm[0].length]); exec++; i += mm[0].length; continue; }
        let depth = 1, j = i + 2;
        while (j < n && depth) {
          if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2; } else if (lex.nested && text[j] === '/' && text[j + 1] === '*') { depth++; j += 2; } else j++;
        }
        i = j; continue;
      }
      if (c === '*' && text[i + 1] === '/' && exec > 0) { hidden.push([i, i + 2]); exec--; i += 2; continue; }
      const s = i;
      if (c === "'") { const r = readQuoted(text, i, "'", lex.backslash ? lex.esc : noStd ? 'pg' : ''); toks.push({ k: 's', v: r.v, s, e: r.e }); open = open || !!r.open; i = r.e; continue; }
      if (c === '"') { const r = readQuoted(text, i, '"', lex.backslash ? lex.esc : ''); toks.push({ k: 'd', v: r.v, s, e: r.e }); open = open || !!r.open; i = r.e; continue; }
      if (c === '`') { const r = readQuoted(text, i, '`', false); toks.push({ k: 'i', v: r.v, s, e: r.e }); i = r.e; continue; }
      if (c === '[' && lex.brackets) { const r = readQuoted(text, i, ']', false); toks.push({ k: 'i', v: r.v, s, e: r.e }); i = r.e; continue; }
      if (c === '$') {
        const x = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y; x.lastIndex = i;
        const mm = lex.dollar && x.exec(text);
        if (mm) {
          const k = text.indexOf(mm[0], i + mm[0].length);
          const e = k < 0 ? n : k + mm[0].length;
          toks.push({ k: 's', v: text.slice(i + mm[0].length, k < 0 ? n : k), s, e }); i = e; continue;
        }
        const p = /\$\d+/y; p.lastIndex = i;
        const pm = p.exec(text);
        if (pm) { toks.push({ k: 'o', v: pm[0], s, e: i + pm[0].length }); i += pm[0].length; continue; }
      }
      if (c >= '0' && c <= '9' || (c === '.' && text[i + 1] >= '0' && text[i + 1] <= '9')) {
        if (c === '0' && (text[i + 1] === 'x' || text[i + 1] === 'X') && /[0-9a-fA-F]/.test(text[i + 2] || '')) {
          const x = /0[xX][0-9a-fA-F]+/y; x.lastIndex = i;
          const mm = x.exec(text);
          toks.push({ k: 'x', v: blobText(mm[0].slice(2)), s, e: i + mm[0].length }); i += mm[0].length; continue;
        }
        const x = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y; x.lastIndex = i;
        const mm = x.exec(text);
        toks.push({ k: 'n', v: mm[0], s, e: i + mm[0].length }); i += mm[0].length; continue;
      }
      if (/[A-Za-z_\u0080-￿]/.test(c)) {
        const x = /[A-Za-z_\u0080-￿][\w$\u0080-￿]*/y; x.lastIndex = i;
        const w = x.exec(text)[0];
        let j = i + w.length;
        const U = w.toUpperCase();
        // prefixed strings: E'..' (escapes), N'..', X'..' (hex), B'..' (bits), _utf8mb4'..' (character set)
        if (text[j] === "'" && (U === 'E' || U === 'N' || U === 'X' || U === 'B' || U === 'U&')) {
          const r = readQuoted(text, j, "'", lex.backslash ? lex.esc : (U === 'E' || noStd) ? 'pg' : '');
          if (U === 'X') toks.push({ k: 'x', v: blobText(r.v), s, e: r.e });
          else toks.push({ k: 's', v: r.v, s, e: r.e });
          i = r.e; continue;
        }
        if (CHARSET_INTRO.test(w)) {
          let q = j; while (text[q] === ' ') q++;
          if (text[q] === "'") {
            const r = readQuoted(text, q, "'", lex.backslash ? lex.esc : noStd ? 'pg' : '');
            toks.push(U === '_BINARY' ? { k: 'x', v: '[binary ' + r.v.length + ' bytes]', s, e: r.e } : { k: 's', v: r.v, s, e: r.e });
            i = r.e; continue;
          }
          if (/^0x/i.test(text.slice(q, q + 2))) { i = q; continue; } // _binary 0x... : the hex literal follows
        }
        if (text[j] === '&' && U === 'U' && text[j + 1] === "'") { i = j + 1; continue; } // U&'...' (rare): read as a plain string
        toks.push({ k: 'w', v: w, u: U, s, e: j }); i = j; continue;
      }
      let op = null;
      for (const o of OPS) if (text.startsWith(o, i)) { op = o; break; }
      if (op) { toks.push({ k: 'o', v: op, s, e: i + op.length }); i += op.length; continue; }
      if ('(),;.[]{}'.includes(c)) { toks.push({ k: 'p', v: c, s, e: i + 1 }); i++; continue; }
      toks.push({ k: 'o', v: c, s, e: i + 1 }); i++;
    }
    return { toks, hidden, text, open };
  }
  // The source text between two positions, without MySQL executable-comment markers.
  function srcSlice(st, a, b) {
    let out = '', at = a;
    for (const [x, y] of st.hidden) {
      if (y <= a || x >= b) continue;
      out += st.text.slice(at, Math.max(at, x)); at = Math.min(b, y);
    }
    return (out + st.text.slice(at, b)).trim();
  }
  const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
  const stEnd = (st) => (st.toks.length ? st.toks[st.toks.length - 1].e : 0);   // end of the last token of a statement

  /* SQL Server scripts often have no ';': one GO batch can hold "SET IDENTITY_INSERT ... ON" and many INSERT lines.
     The batch is cut before each top-level statement keyword (never inside a procedure, function, trigger or view). */
  const MSSQL_SET = /^(IDENTITY_INSERT|ANSI_\w+|QUOTED_IDENTIFIER|NOCOUNT|XACT_ABORT|DATEFORMAT|ARITHABORT|CONCAT_NULL_YIELDS_NULL|NUMERIC_ROUNDABORT)$/;
  function splitBatch(st) {
    const t = st.toks;
    const w = (k) => (t[k] && t[k].k === 'w' ? t[k].u : '');
    if (ROUTINE_HEAD_MSSQL.test(t.slice(0, 6).map((x) => x.v).join(' ')) || /^(CREATE|ALTER)$/.test(w(0)) && ['VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER'].includes(w(1))) return [st];
    const cuts = [0];
    let d = 0;
    for (let k = 1; k < t.length; k++) {
      const x = t[k];
      if (x.k === 'p' && x.v === '(') d++; else if (x.k === 'p' && x.v === ')') d--;
      if (d !== 0 || x.k !== 'w') continue;
      const prev = t[k - 1].k === 'w' ? t[k - 1].u : t[k - 1].v;
      if (x.u === 'INSERT' && !['INSTEAD', 'OF', 'FOR', 'AFTER', 'BEFORE', ','].includes(prev)) cuts.push(k);   // not "AFTER INSERT, UPDATE"
      else if (x.u === 'SET' && MSSQL_SET.test(w(k + 1))) cuts.push(k);
      else if ((x.u === 'CREATE' || x.u === 'ALTER') && ['TABLE', 'INDEX', 'UNIQUE', 'CLUSTERED', 'NONCLUSTERED'].includes(w(k + 1))) cuts.push(k);
    }
    if (cuts.length === 1) return [st];
    cuts.push(t.length);
    const out = [];
    for (let k = 0; k + 1 < cuts.length; k++) out.push({ toks: t.slice(cuts[k], cuts[k + 1]), hidden: st.hidden, text: st.text, open: st.open });
    return out;
  }

  /* ---------------------------------------------------------------- statement reading ---------- */
  class Cur {
    constructor(st) { this.st = st; this.t = st.toks; this.i = 0; }
    get done() { return this.i >= this.t.length; }
    peek(o) { return this.t[this.i + (o || 0)]; }
    next() { return this.t[this.i++]; }
    isW(...names) { const t = this.t[this.i]; return !!t && t.k === 'w' && names.includes(t.u); }
    eatW(...names) { if (this.isW(...names)) { this.i++; return true; } return false; }
    eatSeq(...names) { for (let k = 0; k < names.length; k++) { const t = this.t[this.i + k]; if (!t || t.k !== 'w' || t.u !== names[k]) return false; } this.i += names.length; return true; }
    isP(v) { const t = this.t[this.i]; return !!t && t.k === 'p' && t.v === v; }
    eatP(v) { if (this.isP(v)) { this.i++; return true; } return false; }
    isO(v) { const t = this.t[this.i]; return !!t && t.k === 'o' && t.v === v; }
    // Skips a balanced group starting at "(" (or "[" / "{"); returns the index after it.
    skipGroup() {
      const open = this.peek().v, close = open === '(' ? ')' : open === '[' ? ']' : '}';
      let d = 0;
      while (!this.done) {
        const t = this.next();
        if (t.k === 'p' && t.v === open) d++;
        else if (t.k === 'p' && t.v === close && --d === 0) return;
      }
    }
    ident() {
      const t = this.peek();
      if (!t || !(t.k === 'w' || t.k === 'i' || t.k === 'd')) return null;
      this.i++;
      return t.v;
    }
    name() {
      const first = this.ident();
      if (first == null) return null;
      const parts = [first];
      while (this.isP('.') && this.peek(1) && ['w', 'i', 'd'].includes(this.peek(1).k)) { this.i++; parts.push(this.ident()); }
      return parts;
    }
    // A parenthesised list of column names: (a, b DESC, c(10), lower(d)) -> names, "<expression>" for expressions.
    columnList() {
      if (!this.isP('(')) return [];
      const out = [];
      this.i++;
      let cur = [], d = 0;
      const flush = () => {
        const real = cur.filter((t) => !(t.k === 'w' && ['ASC', 'DESC', 'NULLS', 'FIRST', 'LAST'].includes(t.u)));
        if (!real.length) return;
        const idt = real[0];
        const simple = ['w', 'i', 'd'].includes(idt.k) && (real.length === 1 || (real[1].k === 'p' && real[1].v === '(' && real.length <= 4 && real.slice(2).every((x) => x.k === 'n' || (x.k === 'p' && x.v === ')'))) ||
          (real[1].k === 'w' && ['COLLATE'].includes(real[1].u)) || (real[1].k === 'w' && /_OPS$/.test(real[1].u)));
        out.push(simple ? idt.v : '<expression>');
      };
      while (!this.done) {
        const t = this.next();
        if (t.k === 'p' && (t.v === '(' || t.v === '[')) { d++; cur.push(t); continue; }
        if (t.k === 'p' && (t.v === ')' || t.v === ']')) { if (d === 0) { flush(); break; } d--; cur.push(t); continue; }
        if (t.k === 'p' && t.v === ',' && d === 0) { flush(); cur = []; continue; }
        cur.push(t);
      }
      return out;
    }
  }

  /* Values in INSERT ... VALUES: literals are decoded; anything else stays as its source text (never evaluated). */
  function topSplit(t, a, b, isSep) {
    const parts = [];
    let d = 0, from = a;
    for (let k = a; k < b; k++) {
      const x = t[k];
      if (x.k === 'p' && (x.v === '(' || x.v === '[' || x.v === '{')) d++;
      else if (x.k === 'p' && (x.v === ')' || x.v === ']' || x.v === '}')) d--;
      else if (d === 0 && isSep(x)) { parts.push([from, k]); from = k + 1; }
    }
    parts.push([from, b]);
    return parts;
  }
  /* Words of built-in SQL types (all dialects). Any other name in a type is a name chosen by people (a PostgreSQL enum or
     domain, an Oracle object type): the "Do not share data" mode replaces it (meta.sqlTypeAnon) when names are hidden. */
  const BUILTIN_TYPE = new Set(('INT INTEGER BIGINT SMALLINT TINYINT MEDIUMINT SERIAL BIGSERIAL SMALLSERIAL INT1 INT2 INT4 INT8 INT16 INT32 INT64 INT128 INT256 ' +
    'UINT UINT8 UINT16 UINT32 UINT64 UINT128 UINT256 NUMERIC DECIMAL DEC NUMBER FLOAT FLOAT4 FLOAT8 FLOAT32 FLOAT64 DOUBLE PRECISION REAL MONEY SMALLMONEY ' +
    'DECIMAL32 DECIMAL64 DECIMAL128 DECIMAL256 BINARY_FLOAT BINARY_DOUBLE CHAR CHARACTER VARCHAR VARCHAR2 NVARCHAR NVARCHAR2 NCHAR VARYING NATIONAL TEXT TINYTEXT ' +
    'MEDIUMTEXT LONGTEXT NTEXT CLOB NCLOB BLOB TINYBLOB MEDIUMBLOB LONGBLOB BYTEA BINARY VARBINARY IMAGE RAW LONG BIT BOOL BOOLEAN DATE DATE32 TIME TIMESTAMP ' +
    'TIMESTAMPTZ TIMETZ DATETIME DATETIME2 DATETIME64 DATETIMEOFFSET SMALLDATETIME INTERVAL YEAR MONTH DAY HOUR MINUTE SECOND TO WITH WITHOUT ZONE LOCAL UUID ' +
    'UNIQUEIDENTIFIER JSON JSONB XML ENUM ENUM8 ENUM16 SET ARRAY GEOMETRY GEOGRAPHY POINT LINE LSEG BOX PATH POLYGON CIRCLE INET CIDR MACADDR MACADDR8 TSVECTOR ' +
    'TSQUERY OID ROWID UROWID BFILE STRING FIXEDSTRING LOWCARDINALITY NULLABLE MAP TUPLE NESTED IPV4 IPV6 AGGREGATEFUNCTION SIMPLEAGGREGATEFUNCTION UNSIGNED ' +
    'SIGNED ZEROFILL SQL_VARIANT HIERARCHYID ROWVERSION MAX …').split(' '));
  function anonType(type, lex) {
    const t = tokenize(type, lex, false).toks;
    let out = '', at = 0;
    for (let k = 0; k < t.length; k++) {
      const x = t[k];
      // a quoted or bracketed built-in type ([int], "varchar") is not a name chosen by people: SQL Server scripts write [int]
      const word = x.k === 'w' ? x.u : (x.k === 'i' || x.k === 'd') ? String(x.v).toUpperCase() : null;
      if (word === null || BUILTIN_TYPE.has(word)) continue;
      let e = k;
      while (t[e + 1] && t[e + 1].k === 'p' && t[e + 1].v === '.' && t[e + 2] && (t[e + 2].k === 'w' || t[e + 2].k === 'i' || t[e + 2].k === 'd')) e += 2;
      out += type.slice(at, x.s) + 'custom_type'; at = t[e].e; k = e;
    }
    return out + type.slice(at);
  }
  const NOVAL = {};
  function evalExpr(st, a, b) {
    const t = st.toks;
    if (a >= b) return '';
    // a cast written after the value: 'x'::type, 'x'::type[]
    for (let k = a; k < b; k++) if (t[k].k === 'o' && t[k].v === '::') { const v = evalExpr(st, a, k); return v === NOVAL ? srcSlice(st, t[a].s, t[b - 1].e) : v; }
    const v = evalPure(st, a, b);
    return v === NOVAL ? srcSlice(st, t[a].s, t[b - 1].e) : v;
  }
  function evalPure(st, a, b) {
    const t = st.toks;
    const one = t[a];
    if (b - a === 1) {
      if (one.k === 's' || one.k === 'd' || one.k === 'x') return one.v;
      if (one.k === 'n') return one.v;
      if (one.k === 'w') {
        if (one.u === 'NULL') return null;
        if (one.u === 'TRUE') return 'true';
        if (one.u === 'FALSE') return 'false';
        if (one.u === 'DEFAULT') return '';
      }
      return NOVAL;
    }
    if (b - a === 2 && one.k === 'o' && (one.v === '-' || one.v === '+') && t[a + 1].k === 'n') return (one.v === '-' ? '-' : '') + t[a + 1].v;
    // typed literal: DATE '2024-01-01', TIMESTAMP '...', b'0101'
    if (b - a === 2 && one.k === 'w' && t[a + 1].k === 's' && ['DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'INTERVAL', 'JSON', 'JSONB', 'UUID'].includes(one.u)) return t[a + 1].v;
    // concatenation: 'a' || char(10) || 'b'
    const cat = topSplit(t, a, b, (x) => x.k === 'o' && x.v === '||');
    if (cat.length > 1) {
      let out = '';
      for (const [x, y] of cat) { const v = evalPure(st, x, y); if (v === NOVAL) return NOVAL; if (v === null) return null; out += v; }
      return out;
    }
    // CAST('x' AS type): SQL Server "Generate Scripts" writes every date and decimal like this
    if (one.k === 'w' && one.u === 'CAST' && t[a + 1] && t[a + 1].v === '(' && t[b - 1].v === ')') {
      const parts = topSplit(t, a + 2, b - 1, (x) => x.k === 'w' && x.u === 'AS');
      if (parts.length === 2) return evalPure(st, parts[0][0], parts[0][1]);
      return NOVAL;
    }
    // function calls with literal arguments only
    if (one.k === 'w' && t[a + 1] && t[a + 1].k === 'p' && t[a + 1].v === '(' && t[b - 1].k === 'p' && t[b - 1].v === ')') {
      const args = topSplit(t, a + 2, b - 1, (x) => x.k === 'p' && x.v === ',').filter(([x, y]) => y > x).map(([x, y]) => evalPure(st, x, y));
      if (args.some((x) => x === NOVAL)) return NOVAL;
      switch (one.u) {
        case 'CHAR': case 'CHR': case 'NCHAR':
          if (args.every((x) => x != null && /^\d+$/.test(x))) return args.map((x) => String.fromCodePoint(Number(x))).join('');
          return NOVAL;
        case 'UNISTR':
          if (args.length === 1 && typeof args[0] === 'string') {
            return args[0].replace(/\\(?:u([0-9a-fA-F]{4})|\+([0-9a-fA-F]{6})|U([0-9a-fA-F]{8})|([0-9a-fA-F]{4})|(\\))/g,
              (m, u, p, U8, h, bs) => (bs ? '\\' : String.fromCodePoint(parseInt(u || p || U8 || h, 16))));
          }
          return NOVAL;
        case 'REPLACE':
          if (args.length === 3 && args.every((x) => typeof x === 'string')) return args[1] ? args[0].split(args[1]).join(args[2]) : args[0];
          return NOVAL;
        case 'CONCAT':
          if (args.some((x) => x === null)) return null;
          return args.join('');
        default: return NOVAL;
      }
    }
    return NOVAL;
  }

  /* COPY ... FROM stdin, text format: tab-separated, \N is NULL, backslash escapes. */
  function copyField(f) {
    if (f === '\\N') return null;
    if (f.indexOf('\\') < 0) return f;
    let out = '', i = 0;
    let bytes = [];                                    // \303\251 = the two bytes of "é": decoded together, as UTF-8
    const flush = () => { if (bytes.length) { out += bytesText(bytes); bytes = []; } };
    for (;;) {
      const k = f.indexOf('\\', i);
      if (k < 0) { flush(); return out + f.slice(i); }
      if (k > i) { flush(); out += f.slice(i, k); }
      const c = f[k + 1];
      if (c === 'x') { const m = /^[0-9a-fA-F]{1,2}/.exec(f.slice(k + 2, k + 4)); if (m) { bytes.push(parseInt(m[0], 16)); i = k + 2 + m[0].length; continue; } }
      const o = /^[0-7]{1,3}/.exec(f.slice(k + 1, k + 4));
      if (o) { bytes.push(parseInt(o[0], 8) & 0xff); i = k + 1 + o[0].length; continue; }
      flush();
      if (c in COPY_ESC) { out += COPY_ESC[c]; i = k + 2; continue; }
      out += c === undefined ? '' : c; i = k + 2;
    }
  }
  const COPY_ESC = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
  const UTF8 = new TextDecoder('utf-8', { fatal: true });
  // bytes given as escapes: UTF-8 when they are valid UTF-8, else one character per byte (as before)
  function bytesText(b) {
    try { return UTF8.decode(new Uint8Array(b)); } catch (e) { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; }
  }
  // COPY ... WITH (FORMAT csv): one line per record (pg_dump never writes it; hand-written dumps sometimes do)
  function csvLine(line, sep, nullStr) {
    const out = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        let v = '', j = i + 1;
        for (;;) { const k = line.indexOf('"', j); if (k < 0) { v += line.slice(j); j = line.length; break; } if (line[k + 1] === '"') { v += line.slice(j, k) + '"'; j = k + 2; continue; } v += line.slice(j, k); j = k + 1; break; }
        out.push(v); i = j + 1;
      } else {
        const k = line.indexOf(sep, i);
        const v = line.slice(i, k < 0 ? line.length : k);
        out.push(v === nullStr ? null : v); i = k < 0 ? line.length + 1 : k + 1;
      }
    }
    return out;
  }

  const COL_STOP = new Set(['CONSTRAINT', 'NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'DEFAULT', 'CHECK', 'GENERATED', 'AS', 'AUTO_INCREMENT', 'AUTOINCREMENT',
    'IDENTITY', 'COMMENT', 'COLLATE', 'CODEC', 'MATERIALIZED', 'ALIAS', 'TTL', 'EPHEMERAL', 'ON', 'CHARSET', 'VISIBLE', 'INVISIBLE', 'MASKED', 'ENCODE',
    'SPARSE', 'ROWGUIDCOL', 'FILESTREAM', 'STORAGE', 'COMPRESSION', 'COLUMN_FORMAT', 'SRID', 'SETTINGS', 'STATISTICS']);
  const ACTIONS = ['CASCADE', 'RESTRICT', 'NO ACTION', 'SET NULL', 'SET DEFAULT'];

  /* ---------------------------------------------------------------- the reader ---------- */
  class Reader {
    constructor(opts) {
      this.opts = Object.assign({ maxRows: 0, dialect: null }, opts || {});
      this.pending = '';
      this.split = null;
      this.tables = new Map();   // key schema\u0001name -> table
      this.order = [];
      this.views = new Map();
      this.enums = new Map();    // type name (lower) -> labels
      this.info = { dialect: '', statements: 0, tables: 0, views: 0, rows: 0, ignored: {}, errors: {}, externalFiles: [], schemas: [], truncated: false, unterminated: false };
      this.copyTarget = null;
    }
    push(chunk) {
      if (this.split) { this.split.push(chunk, false); return; }
      this.pending += chunk;
      if (this.opts.dialect || this.pending.length >= 65536) this.begin();   // the dialect is detected on the first 64 KB
    }
    begin() {
      let head = this.pending.replace(/^﻿/, '');
      const d = this.opts.dialect || detectDialect(head.slice(0, 262144));
      this.dialect = d;
      this.info.dialect = d;
      this.lex = lexFor(d);
      this.split = new Splitter(this.lex, this);
      this.pending = '';
      this.split.push(head, false);
    }
    end() {
      if (!this.split) this.begin();
      const r = this.split.end();
      this.info.unterminated = r.unterminated;
      return this.result();
    }
    count(bag, kind) { this.info[bag][kind] = (this.info[bag][kind] || 0) + 1; }
    ignore(kind) { this.count('ignored', kind); }

    /* --- table registry: tables are matched by schema and name, then by name alone (case as written, then any case) --- */
    tableKey(parts) { return (parts.length > 1 ? parts[parts.length - 2] : '') + '\u0001' + parts[parts.length - 1]; }
    findTable(parts) {
      if (!parts) return null;
      const exact = this.tables.get(this.tableKey(parts));
      if (exact) return exact;
      const name = parts[parts.length - 1];
      const same = this.order.filter((t) => t.name === name);
      if (same.length === 1) return same[0];
      const ci = this.order.filter((t) => t.name.toLowerCase() === name.toLowerCase());
      if (ci.length === 1) return ci[0];
      return same[0] || ci[0] || null;
    }
    newTable(parts) {
      const t = { name: parts[parts.length - 1], schema: parts.length > 1 ? parts[parts.length - 2] : '', columns: [], pk: [], fks: [], unique: [], indexes: [],
        ddl: '', description: '', rows: [], rowsTotal: 0, declared: false, externalData: '' };
      this.tables.set(this.tableKey(parts), t);
      this.order.push(t);
      return t;
    }
    // Data (INSERT, COPY) goes to the best match, or to a new table.
    getTable(parts, create) {
      const t = this.findTable(parts);
      return t || (create ? this.newTable(parts) : null);
    }
    // CREATE TABLE: same schema and name only; "sales.items" and "stock.items" are two tables. A table met first without
    // schema (data before its definition) is the same table.
    defineTable(parts) {
      const exact = this.tables.get(this.tableKey(parts));
      if (exact) return exact;
      const name = parts[parts.length - 1];
      if (parts.length > 1) {
        const loose = this.order.find((t) => !t.schema && !t.declared && t.name === name);
        if (loose) { this.tables.delete(this.tableKey([name])); loose.schema = parts[parts.length - 2]; this.tables.set(this.tableKey(parts), loose); return loose; }
      } else {
        const same = this.order.filter((t) => t.name === name);
        if (same.length === 1 && !same[0].declared) return same[0];
      }
      return this.newTable(parts);
    }
    colIndex(t, name) {
      let i = t.columns.findIndex((c) => c.name === name);
      if (i < 0) i = t.columns.findIndex((c) => c.name.toLowerCase() === String(name).toLowerCase());
      return i;
    }
    addColumn(t, name) {
      t.columns.push({ name, sqlType: '', notNull: false, generated: '', comment: '', values: '' });
      return t.columns.length - 1;           // the rows read before are padded once, at the end (padding here was quadratic)
    }

    /* --- one statement --- */
    statement(text) {
      const whole = tokenize(text, this.lex, this.split ? this.split.noStd : false);
      if (!whole.toks.length) return null;
      if (this.dialect !== 'mssql') return this.one(whole);
      let r = null;
      for (const st of splitBatch(whole)) r = this.one(st) || r;
      return r;
    }
    one(st) {
      this.info.statements++;
      const c = new Cur(st);
      const first = st.toks[0].k === 'w' ? st.toks[0].u : '';
      try {
        switch (first) {
          case 'CREATE': return this.create(c);
          case 'ALTER': return this.alter(c);
          case 'INSERT': case 'REPLACE': return this.insert(c);
          case 'COPY': return this.copyStmt(c);
          case 'COMMENT': return this.comment(c);
          case 'SET': return this.set(c);
          default: this.ignore(first ? first.toLowerCase() : 'other'); return null;
        }
      } catch (e) {
        this.count('errors', first ? first.toLowerCase() : 'other');
        return null;
      }
    }
    set(c) {
      const text = c.st.toks.map((t) => t.v).join(' ');
      this.ignore('set');
      if (/^SET standard_conforming_strings = off/i.test(text)) return { noStd: true };
      if (/^SET standard_conforming_strings = on/i.test(text)) return { noStd: false };
      if (this.dialect === 'mysql' && /SQL_MODE/i.test(text)) {
        // mysqldump sets a mode (with a literal) before a trigger and restores it after (SQL_MODE = @saved_sql_mode):
        // a literal pushes the backslash setting, a variable brings the previous one back
        const t = c.st.toks;
        this.modeStack = this.modeStack || [];
        for (let k = 1; k < t.length - 2; k++) {
          if (!(t[k].k === 'w' && t[k].u === 'SQL_MODE' && t[k + 1].v === '=') || (t[k - 1].k === 'o' && t[k - 1].v === '@')) continue;
          const v = t[k + 2];
          if (v.k === 's') { this.modeStack.push(this.lex.backslash); return { backslash: !/NO_BACKSLASH_ESCAPES/i.test(v.v) }; }
          if (v.k === 'o' && v.v === '@') return this.modeStack.length ? { backslash: this.modeStack.pop() } : null;
        }
      }
      return null;
    }
    create(c) {
      c.next();
      // modifiers before the object kind: OR REPLACE, TEMPORARY, UNLOGGED, ALGORITHM=.., DEFINER=.., SQL SECURITY ..
      for (let guard = 0; guard < 20 && !c.done; guard++) {
        if (c.eatSeq('OR', 'REPLACE') || c.eatSeq('OR', 'ALTER') || c.eatW('TEMP', 'TEMPORARY', 'GLOBAL', 'LOCAL', 'UNLOGGED', 'EXTERNAL', 'TRANSIENT', 'VOLATILE', 'EDITIONABLE', 'NONEDITIONABLE')) continue;
        if (c.isW('ALGORITHM', 'DEFINER')) { c.next(); if (c.isO('=')) c.next(); c.next(); while (c.isO('@')) { c.next(); c.next(); } continue; }
        if (c.eatSeq('SQL', 'SECURITY')) { c.next(); continue; }
        break;
      }
      if (c.eatW('TABLE')) return this.createTable(c);
      if (c.isW('UNIQUE', 'INDEX', 'CLUSTERED', 'NONCLUSTERED', 'BITMAP', 'FULLTEXT', 'SPATIAL')) return this.createIndex(c);
      if (c.eatW('VIEW') || c.eatSeq('MATERIALIZED', 'VIEW') || c.eatSeq('LIVE', 'VIEW')) return this.createView(c);
      if (c.eatW('TYPE')) return this.createType(c);
      const kind = c.peek() && c.peek().k === 'w' ? c.peek().u.toLowerCase() : 'other';
      this.ignore(kind === 'proc' ? 'procedure' : kind);
      return null;
    }
    createTable(c) {
      c.eatSeq('IF', 'NOT', 'EXISTS');
      const parts = c.name();
      if (!parts) { this.count('errors', 'create'); return null; }
      if (c.eatW('PARTITION') || c.isW('AS', 'LIKE', 'CLONE', 'OF')) { this.ignore('table without columns'); return null; }
      if (!c.isP('(')) { this.ignore('table without columns'); return null; }
      const t = this.defineTable(parts);
      if (t.declared) { t.columns = []; t.pk = []; t.fks = []; t.unique = []; t.indexes = []; } // defined again: the last definition wins
      t.declared = true;
      t.ddl = srcSlice(c.st, c.st.toks[0].s, stEnd(c.st));
      const open = c.i;
      c.skipGroup();
      const close = c.i - 1;
      for (const [a, b] of topSplit(c.st.toks, open + 1, close, (x) => x.k === 'p' && x.v === ',')) {
        if (b > a) this.tableItem(t, c.st, a, b);
      }
      // table options after the definitions: MySQL COMMENT='..', ClickHouse COMMENT '..'
      c.i = close + 1;
      while (!c.done) {
        if (c.eatW('COMMENT')) { if (c.isO('=')) c.next(); const s = c.peek(); if (s && s.k === 's') { t.description = s.v; c.next(); } continue; }
        c.next();
      }
      return null;
    }
    // One element inside CREATE TABLE ( ... ): a column or a table constraint.
    tableItem(t, st, a, b) {
      const c = new Cur(st); c.i = a;
      let cname = '';
      if (c.isW('CONSTRAINT')) { c.next(); cname = c.ident() || ''; }
      if (c.eatSeq('PRIMARY', 'KEY')) { c.eatW('CLUSTERED', 'NONCLUSTERED'); t.pk = c.columnList(); return; }
      if (c.isW('UNIQUE') && !this.looksLikeColumn(c, b)) {
        c.next(); c.eatW('KEY', 'INDEX'); c.eatW('CLUSTERED', 'NONCLUSTERED');
        let n = cname; if (!c.isP('(')) n = c.ident() || n;
        t.unique.push({ name: n, cols: c.columnList() }); return;
      }
      if (c.eatSeq('FOREIGN', 'KEY')) {
        if (!c.isP('(')) c.ident();
        const from = c.columnList();
        this.references(c, t, from, b);
        return;
      }
      if (c.isW('CHECK', 'EXCLUDE', 'PERIOD', 'PROJECTION', 'LIKE') && !this.looksLikeColumn(c, b)) return;
      if (this.isIndexItem(c, b)) {
        if (st.toks.slice(c.i, b).some((x) => x.k === 'w' && x.u === 'TYPE')) return;   // ClickHouse: INDEX name expr TYPE minmax
        c.next(); c.eatW('KEY', 'INDEX');
        const n = c.isP('(') ? '' : (c.ident() || '');
        if (c.isW('USING')) { c.next(); c.next(); }
        if (c.isP('(')) t.indexes.push({ name: n, cols: c.columnList() });
        return;
      }
      if (cname) return; // CONSTRAINT name <something not understood>
      this.columnDef(t, c, b);
    }
    // MySQL "KEY name (cols)", "INDEX (cols)", "FULLTEXT KEY name (cols)"; a column NAMED key would be quoted in a dump
    isIndexItem(c, b) {
      if (!c.isW('KEY', 'INDEX', 'FULLTEXT', 'SPATIAL')) return false;
      const n1 = c.peek(1), n2 = c.peek(2);
      if (!n1 || c.i + 1 >= b) return false;
      if (n1.k === 'p' && n1.v === '(') return true;
      if (c.isW('FULLTEXT', 'SPATIAL') && n1.k === 'w' && (n1.u === 'KEY' || n1.u === 'INDEX')) return true;
      // pg_dump and SQLite leave a column named key or index unquoted: "key numeric(10,2)" is a column, not an index
      if (n1.k === 'w' && BUILTIN_TYPE.has(n1.u)) return false;
      return ['w', 'i', 'd'].includes(n1.k) && !!n2 && ((n2.k === 'p' && n2.v === '(') || (n2.k === 'w' && (n2.u === 'USING' || n2.u === 'TYPE'))) ||
        (['w', 'i', 'd'].includes(n1.k) && st2HasType(c, b));
    }
    // "unique text" or "key int" can be columns named like keywords: a column has a name followed by a type word.
    looksLikeColumn(c, b) {
      const n = c.peek(1);
      return !!n && c.i + 1 < b && (n.k === 'w') && !['KEY', 'INDEX', 'CLUSTERED', 'NONCLUSTERED'].includes(n.u) && !(n.k === 'p');
    }
    columnDef(t, c, b) {
      const name = c.ident();
      if (name == null) return;
      let idx = this.colIndex(t, name);
      if (idx < 0) idx = this.addColumn(t, name);
      const col = t.columns[idx];
      // the type: everything up to the first column constraint, at depth 0
      const st = c.st, typeFrom = c.i;
      let d = 0;
      while (c.i < b) {
        const x = c.peek();
        if (x.k === 'p' && (x.v === '(' || x.v === '[')) d++;
        else if (x.k === 'p' && (x.v === ')' || x.v === ']')) d--;
        else if (d === 0 && x.k === 'w' && COL_STOP.has(x.u)) break;
        else if (d === 0 && x.k === 'w' && x.u === 'CHARACTER' && c.peek(1) && c.peek(1).u === 'SET') break; // "character varying" is a type
        c.next();
      }
      if (c.i > typeFrom) this.setType(col, st, typeFrom, c.i);
      // column constraints
      while (c.i < b) {
        if (c.eatW('CONSTRAINT')) { c.ident(); continue; }
        if (c.eatSeq('NOT', 'NULL')) { col.notNull = true; continue; }
        if (c.eatW('NULL')) { col.notNull = false; continue; }
        if (c.eatSeq('PRIMARY', 'KEY')) { c.eatW('ASC', 'DESC'); c.eatW('CLUSTERED', 'NONCLUSTERED'); t.pk = [name]; col.notNull = true; continue; }
        if (c.eatW('UNIQUE')) { c.eatW('KEY'); c.eatW('CLUSTERED', 'NONCLUSTERED'); t.unique.push({ name: '', cols: [name] }); continue; }
        if (c.isW('REFERENCES')) { this.references(c, t, [name], b); continue; }
        if (c.eatW('DEFAULT')) { this.skipExpr(c, b); continue; }
        if (c.eatW('CHECK')) { if (c.isP('(')) c.skipGroup(); continue; }
        if (c.eatW('GENERATED')) {
          c.eatW('ALWAYS'); c.eatSeq('BY', 'DEFAULT');
          if (c.eatW('AS')) {
            if (c.eatW('IDENTITY')) { if (c.isP('(')) c.skipGroup(); continue; }
            if (c.isP('(')) c.skipGroup();
            col.generated = c.eatW('VIRTUAL') ? 'virtual' : c.eatW('STORED', 'PERSISTED') ? 'stored' : 'virtual';
          }
          continue;
        }
        if (c.eatW('AS')) {                                   // MySQL "AS (expr) STORED", SQL Server computed "AS expr [PERSISTED]"
          if (c.isP('(')) c.skipGroup(); else this.skipExpr(c, b);
          col.generated = c.eatW('STORED', 'PERSISTED') ? 'stored' : (c.eatW('VIRTUAL'), 'virtual');
          continue;
        }
        if (c.eatW('MATERIALIZED')) { this.skipExpr(c, b); col.generated = 'stored'; continue; }   // ClickHouse
        if (c.eatW('ALIAS')) { this.skipExpr(c, b); col.generated = 'virtual'; continue; }
        if (c.eatW('COMMENT')) { const s = c.peek(); if (s && (s.k === 's' || s.k === 'd')) { col.comment = s.v; c.next(); } continue; }
        if (c.eatW('COLLATE', 'CHARSET')) { c.next(); continue; }
        if (c.eatSeq('CHARACTER', 'SET')) { c.next(); continue; }
        if (c.eatSeq('ON', 'UPDATE')) { this.skipExpr(c, b); continue; }
        if (c.eatW('IDENTITY')) { if (c.isP('(')) c.skipGroup(); continue; }
        if (c.eatW('CODEC', 'TTL', 'EPHEMERAL', 'SETTINGS', 'STATISTICS')) { if (c.isP('(')) c.skipGroup(); else this.skipExpr(c, b); continue; }
        c.next();
      }
    }
    // The column type as written. The labels of an enum or a set are values of the data: they go to "values" (shown with
    // the labels, hidden when the user hides labels) and are cut out of the type, at any depth: enum(..), Nullable(Enum8(..)).
    setType(col, st, a, b) {
      const t = st.toks;
      const labels = [];
      const cuts = [];                                         // [start, end] source spans replaced by "(…)"
      for (let k = a; k < b; k++) {
        const x = t[k];
        if (x.k === 's') { cuts.push([x.s, x.e, "'…'"]); continue; }   // any other quoted text: possibly a value, never kept
        if (!(x.k === 'w' && /^(ENUM|ENUM8|ENUM16|SET)$/.test(x.u) && t[k + 1] && t[k + 1].k === 'p' && t[k + 1].v === '(')) continue;
        let d = 0, m = k + 1;
        for (; m < b; m++) {
          const y = t[m];
          if (y.k === 'p' && y.v === '(') d++;
          else if (y.k === 'p' && y.v === ')' && --d === 0) break;
          else if (y.k === 's') {
            let label = y.v;
            if (t[m + 1] && t[m + 1].v === '=' && t[m + 2] && t[m + 2].k === 'n') label += ' = ' + t[m + 2].v;
            else if (t[m + 1] && t[m + 1].v === '=' && t[m + 2] && t[m + 2].v === '-' && t[m + 3] && t[m + 3].k === 'n') label += ' = -' + t[m + 3].v;
            labels.push(label);
          }
        }
        cuts.push([t[k + 1].s, m < b ? t[m].e : t[b - 1].e]);
        k = m;
      }
      let type = '', at = t[a].s;
      for (const [x, y, r] of cuts) { type += st.text.slice(at, x) + (r || '(…)'); at = y; }
      type = oneLine(type + st.text.slice(at, t[b - 1].e));
      if (labels.length) col.values = labels.join(', ');
      else {
        const en = this.enums.get(type.toLowerCase().replace(/^.*\./, '').replace(/^"|"$/g, ''));
        if (en) col.values = en.join(', ');
      }
      col.sqlType = type;
      col.sqlTypeAnon = anonType(type, this.lex);
    }
    skipExpr(c, b) {
      let d = 0, moved = false;
      while (c.i < b) {
        const x = c.peek();
        if (x.k === 'p' && (x.v === '(' || x.v === '[')) d++;
        else if (x.k === 'p' && (x.v === ')' || x.v === ']')) d--;
        else if (d === 0 && moved && x.k === 'w' && COL_STOP.has(x.u) && x.u !== 'NULL' && x.u !== 'AS') break;
        else if (d === 0 && moved && x.k === 'w' && x.u === 'NULL' && c.peek(-1) && c.peek(-1).u === 'NOT') break;
        c.next(); moved = true;
      }
    }
    references(c, t, from, b) {
      if (!c.eatW('REFERENCES')) return;
      const target = c.name();
      const to = c.isP('(') ? c.columnList() : [];
      const fk = { target, from, to, onDelete: '', onUpdate: '' };
      // what may follow: ON DELETE / ON UPDATE actions, MATCH, DEFERRABLE ... (but not a NOT NULL of the column)
      while (c.i < b) {
        const n1 = c.peek(1);
        if (c.isW('ON') && n1 && (n1.u === 'DELETE' || n1.u === 'UPDATE')) {
          c.next(); c.next();
          let act = '';
          for (const a of ACTIONS) { if (c.eatSeq(...a.split(' '))) { act = a; break; } }
          if (!act) act = (c.next() || {}).v || '';
          if (n1.u === 'DELETE') fk.onDelete = act; else fk.onUpdate = act;
          continue;
        }
        if (c.eatW('MATCH', 'INITIALLY')) { c.next(); continue; }
        if (c.eatSeq('NOT', 'DEFERRABLE') || c.eatSeq('NOT', 'ENFORCED') || c.eatSeq('NOT', 'FOR', 'REPLICATION')) continue;
        if (c.eatW('DEFERRABLE', 'ENFORCED', 'NOVALIDATE', 'VALIDATE', 'ENABLE', 'DISABLE', 'RELY', 'NORELY')) continue;
        break;
      }
      if (target) t.fks.push(fk);
    }
    createIndex(c) {
      const unique = c.eatW('UNIQUE');
      c.eatW('CLUSTERED', 'NONCLUSTERED', 'BITMAP', 'FULLTEXT', 'SPATIAL');
      if (!c.eatW('INDEX')) { this.ignore('index'); return null; }
      c.eatW('CONCURRENTLY'); c.eatSeq('IF', 'NOT', 'EXISTS');
      let name = '';
      if (!c.isW('ON')) { const p = c.name(); name = p ? p[p.length - 1] : ''; }
      if (!c.eatW('ON')) { this.ignore('index'); return null; }
      c.eatW('ONLY');
      const t = this.findTable(c.name());
      if (c.eatW('USING')) c.next();
      if (!t || !c.isP('(')) { this.ignore('index'); return null; }
      const cols = c.columnList();
      (unique ? t.unique : t.indexes).push({ name, cols });
      return null;
    }
    createView(c) {
      c.eatSeq('IF', 'NOT', 'EXISTS');
      const parts = c.name();
      if (!parts) return null;
      if (c.isP('(')) c.skipGroup();
      while (!c.done && !c.isW('AS')) c.next();               // WITH (options), TO table (ClickHouse) ...
      if (!c.eatW('AS') || c.done) return null;
      const query = srcSlice(c.st, c.peek().s, stEnd(c.st));
      const name = parts[parts.length - 1];
      this.views.set((parts.length > 1 ? parts[parts.length - 2] : '') + '\u0001' + name, { name, schema: parts.length > 1 ? parts[parts.length - 2] : '', query });
      return null;
    }
    createType(c) {
      const parts = c.name();
      if (parts && c.eatW('AS') && c.eatW('ENUM') && c.isP('(')) {
        const labels = [];
        const from = c.i; c.skipGroup();
        for (let k = from; k < c.i; k++) if (c.t[k].k === 's') labels.push(c.t[k].v);
        this.enums.set(parts[parts.length - 1].toLowerCase(), labels);
        return null;
      }
      this.ignore('type');
      return null;
    }
    alter(c) {
      c.next();
      if (!c.eatW('TABLE')) { this.ignore('alter ' + (c.peek() && c.peek().k === 'w' ? c.peek().u.toLowerCase() : 'other')); return null; }
      c.eatSeq('IF', 'EXISTS'); c.eatW('ONLY');
      const t = this.findTable(c.name());
      if (!t) { this.ignore('alter table'); return null; }
      const toks = c.st.toks;
      for (const [a, b] of topSplit(toks, c.i, toks.length, (x) => x.k === 'p' && x.v === ',')) {
        const k = new Cur(c.st); k.i = a;
        k.eatSeq('WITH', 'CHECK') || k.eatSeq('WITH', 'NOCHECK');
        if (k.eatW('ADD')) {
          if (k.isW('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL', 'EXCLUDE')) {
            // SQL Server: ADD CONSTRAINT [DF_x] DEFAULT (0) FOR [col] -> a default, not a key
            const save = k.i;
            if (k.eatW('CONSTRAINT')) k.ident();
            if (k.isW('DEFAULT')) continue;
            k.i = save;
            this.tableItem(t, c.st, k.i, b);
          } else if (k.isW('DEFAULT', 'PARTITION', 'PARTITIONS', 'PERIOD', 'SUBPARTITION', 'PROJECTION', 'STATISTICS', 'TTL', 'ROWGUIDCOL', 'PERSISTED', 'MASKED')) {
            continue;                                          // SQL Server ADD DEFAULT ('x') FOR [col], partitions ...: never a column
          } else {
            k.eatW('COLUMN'); k.eatSeq('IF', 'NOT', 'EXISTS');
            // a column is a name followed by its type; anything else (ADD (..), ADD 'x') is not read as one
            const n0 = k.peek(), n1 = k.peek(1);
            if (k.i < b && n0 && ['w', 'i', 'd'].includes(n0.k) && n1 && ['w', 'i', 'd'].includes(n1.k)) this.columnDef(t, k, b);
          }
          continue;
        }
        if (k.eatW('ALTER', 'MODIFY')) {
          k.eatW('COLUMN');
          const name = k.ident();
          const idx = name == null ? -1 : this.colIndex(t, name);
          if (idx >= 0 && k.eatSeq('SET', 'NOT', 'NULL')) t.columns[idx].notNull = true;
          continue;
        }
      }
      return null;
    }
    comment(c) {
      c.next();
      if (!c.eatW('ON')) { this.ignore('comment'); return null; }
      const kind = c.next();
      const parts = c.name();
      if (!c.eatW('IS') || !parts) return null;
      const s = c.peek();
      const text = s && s.k === 's' ? s.v : '';
      if (kind.u === 'TABLE') { const t = this.findTable(parts); if (t) t.description = text; }
      else if (kind.u === 'COLUMN' && parts.length >= 2) {
        const t = this.findTable(parts.slice(0, -1));
        const i = t ? this.colIndex(t, parts[parts.length - 1]) : -1;
        if (i >= 0) t.columns[i].comment = text;
      } else this.ignore('comment');
      return null;
    }
    // The position of each given column in the table (columns met for the first time are added).
    mapping(t, names) {
      if (!names) return null;
      return names.map((n) => { const i = this.colIndex(t, n); return i >= 0 ? i : this.addColumn(t, n); });
    }
    addRow(t, map, values) {
      t.rowsTotal++; this.info.rows++;
      if (this.opts.maxRows && t.rows.length >= this.opts.maxRows) { this.info.truncated = true; return; }
      let row;
      if (map) {
        row = new Array(t.columns.length).fill('');
        for (let k = 0; k < map.length && k < values.length; k++) row[map[k]] = values[k] == null ? '' : values[k];
      } else {
        while (t.columns.length < values.length) this.addColumn(t, 'column_' + (t.columns.length + 1));
        row = values.map((v) => (v == null ? '' : v));
        while (row.length < t.columns.length) row.push('');
      }
      t.rows.push(row);
    }
    insert(c) {
      c.next();
      c.eatW('LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY'); c.eatW('IGNORE'); c.eatW('INTO');
      const parts = c.name();
      if (!parts) { this.count('errors', 'insert'); return null; }
      const t = this.getTable(parts, true);
      let names = null;
      if (c.isP('(')) {
        // a column list, unless it is the start of VALUES without the word (rare) or a SELECT
        const save = c.i;
        const list = c.columnList();
        if (list.length && !list.includes('<expression>')) names = list; else c.i = save;
      }
      while (c.isW('OVERRIDING')) { c.next(); c.next(); c.next(); }
      if (!c.eatW('VALUES', 'VALUE')) { this.ignore(c.isW('SELECT', 'WITH') ? 'insert select' : 'insert'); return null; }
      const map = this.mapping(t, names);
      const toks = c.st.toks;
      while (!c.done) {
        if (c.eatP(',')) continue;
        c.eatW('ROW');
        if (!c.isP('(')) break;                                // ON CONFLICT, ON DUPLICATE KEY UPDATE, RETURNING ...
        const open = c.i;
        c.skipGroup();
        const close = c.i - 1;
        const vals = topSplit(toks, open + 1, close, (x) => x.k === 'p' && x.v === ',').map(([a, b]) => evalExpr(c.st, a, b));
        this.addRow(t, map, vals);
      }
      return null;
    }
    copyStmt(c) {
      c.next();
      if (c.isP('(')) { this.ignore('copy query'); return null; }
      const parts = c.name();
      if (!parts) return null;
      const names = c.isP('(') ? c.columnList() : null;
      if (c.eatW('TO')) { this.ignore('copy to'); return null; }
      if (!c.eatW('FROM')) { this.ignore('copy'); return null; }
      const t = this.getTable(parts, true);
      if (c.eatW('STDIN')) {
        const rest = c.st.toks.slice(c.i);
        const words = rest.filter((x) => x.k === 'w').map((x) => x.u);
        const csv = words.includes('CSV');
        const header = csv && words.includes('HEADER') && !rest.some((x, k) => x.k === 'w' && x.u === 'HEADER' && rest[k + 1] && rest[k + 1].k === 'w' && rest[k + 1].u === 'FALSE');
        const sepTok = rest.find((x, k) => k > 0 && rest[k - 1].k === 'w' && rest[k - 1].u === 'DELIMITER' && x.k === 's');
        const nullTok = rest.find((x, k) => k > 0 && rest[k - 1].k === 'w' && rest[k - 1].u === 'NULL' && x.k === 's');
        this.copyTarget = { t, map: this.mapping(t, names), csv, header, sep: sepTok ? sepTok.v : csv ? ',' : '\t', nullStr: nullTok ? nullTok.v : csv ? '' : '\\N' };
        return { copy: true };
      }
      // COPY t FROM 'customers.csv' (DuckDB EXPORT DATABASE, psql scripts): the data is in another file
      const f = c.peek();
      if (f && f.k === 's') {
        const base = f.v.split(/[\\/]/).pop();
        t.externalData = base;
        const rest = c.st.toks.slice(c.i + 1);
        const after = (w) => { const k = rest.findIndex((x) => x.k === 'w' && x.u === w); return k >= 0 ? rest[k + 1] : null; };
        const fmt = after('FORMAT'), del = after('DELIMITER'), hdr = after('HEADER');
        t.externalInfo = { format: fmt ? String(fmt.v).toLowerCase() : /\.parquet$/i.test(base) ? 'parquet' : 'csv', delimiter: del && del.k === 's' ? del.v : ',',
          header: !(hdr && (hdr.v === '0' || String(hdr.v).toUpperCase() === 'FALSE')) };
        if (!this.info.externalFiles.includes(base)) this.info.externalFiles.push(base);
      }
      this.ignore('copy from file');
      return null;
    }
    copyRow(line) {
      const ct = this.copyTarget;
      if (!ct) return;
      if (ct.header) { ct.header = false; return; }               // the header line of a CSV block
      const vals = ct.csv ? csvLine(line, ct.sep, ct.nullStr) : line.split(ct.sep).map((f) => (f === ct.nullStr ? null : copyField(f)));
      this.addRow(ct.t, ct.map, vals);
    }
    copyEnd() { this.copyTarget = null; }

    /* --- result --- */
    result() {
      const tables = this.order;
      // Schema in the names only when two tables share a name in different schemas.
      const byName = new Map();
      for (const t of tables) byName.set(t.name, (byName.get(t.name) || 0) + 1);
      const display = (t) => (t.schema && byName.get(t.name) > 1 ? t.schema + '.' + t.name : t.name);
      const schemas = Array.from(new Set(tables.map((t) => t.schema).filter(Boolean)));
      this.info.schemas = schemas;
      const sections = tables.map((t) => {
        const fks = t.fks.map((f) => {
          const target = this.findTable(f.target);
          let to = f.to.slice();
          if (!to.length && target && target.pk.length === f.from.length) to = target.pk.slice();
          return { table: target ? display(target) : f.target[f.target.length - 1], from: f.from, to: f.from.map((_, i) => to[i] || null), onDelete: f.onDelete, onUpdate: f.onUpdate };
        });
        const columns = t.columns.map((col) => {
          const arrows = [];
          for (const f of fks) { const i = f.from.indexOf(col.name); if (i >= 0) arrows.push('→ `' + f.table + '.' + (f.to[i] || '?') + '`'); }
          const key = [t.pk.includes(col.name) ? { key: 'pk' } : null].concat(arrows).filter(Boolean);
          const meta = { sqlType: col.sqlType, key, notNull: col.notNull ? { key: 'yes' } : '' };
          if (col.sqlTypeAnon && col.sqlTypeAnon !== col.sqlType) meta.sqlTypeAnon = col.sqlTypeAnon;
          if (col.generated) meta.generated = { key: col.generated === 'stored' ? 'genStored' : 'genVirtual' };
          if (col.comment) meta.label = col.comment;
          if (col.values) meta.values = col.values;
          return { name: col.name, meta };
        });
        const width = t.columns.length;
        for (const r of t.rows) for (let k = r.length; k < width; k++) r.push('');   // columns added after these rows
        return {
          name: display(t), columns, rows: t.rows, rowsTotal: t.rowsTotal, description: t.description, externalData: t.externalData, externalInfo: t.externalInfo || null,
          constraints: { pk: t.pk.slice(), fks, unique: t.unique, indexes: t.indexes, ddl: t.ddl },
        };
      });
      const views = Array.from(this.views.values()).map((v) => ({ name: v.name, sql: 'CREATE VIEW ' + v.name + ' AS ' + v.query }));
      this.info.tables = sections.length;
      this.info.views = views.length;
      const fileMeta = [];
      if (views.length) fileMeta.push(['mViews', views.map((v) => '`' + v.name + '`').join(', ')]);
      return { sections, views, fileMeta, notes: {}, info: this.info, dialectName: DIALECT_NAMES[this.dialect] || 'SQL' };
    }
  }

  DB.SqlDumpReader = Reader;
  DB.detectSqlDialect = detectDialect;
  DB.SQL_DIALECT_NAMES = DIALECT_NAMES;
  DB.parseSqlDump = function (input, opts) {
    const r = new Reader(opts);
    for (const chunk of Array.isArray(input) ? input : [input]) r.push(chunk);
    return r.end();
  };
})();
