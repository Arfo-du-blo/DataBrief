/* DataBrief - Microsoft Access reader (.mdb Jet 3/4, .accdb Access 2007+), on top of the vendored mdb-reader (MIT, vendor/mdb-reader.min.js,
 * window.MDBReaderLib). GPL-3.0-or-later.
 *
 *   DB.isAccess(u8) -> boolean                 ("Standard Jet DB" / "Standard ACE DB" at byte 4)
 *   DB.parseAccess(u8, { maxRows }) -> { sections, fileMeta, notes }
 *
 * Read: every normal table (columns, Access types, rows), and the RELATIONSHIPS Access stores in its system table MSysRelationships
 * (composite keys, cascading deletes). Not read: saved queries, forms, reports, macros and VBA code; linked tables (their data is
 * elsewhere: they are listed); password-protected databases (refused with a message); primary keys and indexes (the library does
 * not expose them). Nothing in the file is executed. */
'use strict';
(function () {
  const DB = window.DB;

  DB.isAccess = function (u8) {
    if (u8.length < 32 || u8[0] !== 0 || u8[1] !== 1 || u8[2] !== 0 || u8[3] !== 0) return false;
    const s = String.fromCharCode.apply(null, u8.subarray(4, 19));
    return s === 'Standard Jet DB' || s === 'Standard ACE DB';
  };

  // Access type -> a SQL-like name (the same words as the other database formats)
  function sqlType(c) {
    switch (c.type) {
      case 'boolean': return 'BOOLEAN';
      case 'byte': return 'BYTE';
      case 'integer': return 'SMALLINT';
      case 'long': return 'INTEGER';
      case 'currency': return 'CURRENCY';
      case 'float': return 'REAL';
      case 'double': return 'DOUBLE';
      case 'datetime': return 'DATETIME';
      case 'text': return 'TEXT(' + Math.round((c.size || 0) / (c.unicode === false ? 1 : 2)) + ')';
      case 'memo': return 'MEMO';
      case 'binary': return 'BINARY(' + (c.size || 0) + ')';
      case 'ole': return 'OLE';
      case 'repid': return 'GUID';
      case 'numeric': return c.precision ? 'NUMERIC(' + c.precision + ',' + (c.scale || 0) + ')' : 'NUMERIC';
      case 'complex': return 'COMPLEX';
      default: return String(c.type || '').toUpperCase();
    }
  }
  // "12.5000" -> "12.5", "8.0000" -> "8", "-7.2500" -> "-7.25" (money and decimals come as text with all their decimals)
  const numText = (s) => (/^-?\d+\.\d+$/.test(s) ? s.replace(/\.?0+$/, '') : s);

  function cell(v, type) {
    if (v === null || v === undefined) return '';
    switch (type) {
      case 'boolean': return v ? 'true' : 'false';
      case 'currency': case 'numeric': return numText(String(v));
      case 'datetime': return v instanceof Date ? DB.isoFromDate(v) : DB.str(v);
      default: return DB.str(v);
    }
  }

  function open(u8) {
    const R = window.MDBReaderLib && window.MDBReaderLib.default;
    if (!R) throw new DB.UserError('errCorrupt', { ext: '.mdb' });
    try {
      return new R(window.Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength));
    } catch (e) {
      // a protected database: the encryption libraries are not part of the page (stubs raise code ENCRYPTED)
      if (e && (e.code === 'ENCRYPTED' || /password|encrypt|decrypt|codec|unsupported/i.test(String(e.message)))) throw new DB.UserError('errAccessProtected');
      throw new DB.UserError('errCorrupt', { ext: '.mdb' });
    }
  }

  DB.parseAccess = function (u8, opts) {
    const maxRows = (opts && opts.maxRows) || 0;
    const reader = open(u8);
    const sections = [], skipped = [];
    let names;
    try { names = reader.getTableNames(); } catch (e) { throw new DB.UserError('errCorrupt', { ext: '.mdb' }); }
    for (const name of names) {
      try {
        const t = reader.getTable(name);
        const cols = t.getColumns();
        const total = t.rowCount;
        const data = maxRows && total > maxRows ? t.getData({ rowLimit: maxRows }) : t.getData();
        const rows = data.map((r) => cols.map((c) => cell(r[c.name], c.type)));
        sections.push({
          name, columns: cols.map((c) => ({ name: c.name, meta: { sqlType: sqlType(c) } })), rows, rowsTotal: total,
          constraints: { pk: [], fks: [], unique: [], indexes: [], ddl: '' },
        });
      } catch (e) { skipped.push(name); }
    }

    // Relationships: MSysRelationships, one row per column of a relationship (icolumn = the position in a composite key)
    try {
      const rel = reader.getTable('MSysRelationships').getData();
      const groups = new Map();
      for (const r of rel) {
        if (!groups.has(r.szRelationship)) groups.set(r.szRelationship, []);
        groups.get(r.szRelationship).push(r);
      }
      for (const rows of groups.values()) {
        rows.sort((a, b) => a.icolumn - b.icolumn);
        const child = sections.find((s) => s.name === rows[0].szObject), parent = sections.find((s) => s.name === rows[0].szReferencedObject);
        if (!child || !parent) continue;                                       // a link to a system or linked table
        const g = rows[0].grbit || 0;
        child.constraints.fks.push({
          table: parent.name, from: rows.map((x) => x.szColumn), to: rows.map((x) => x.szReferencedColumn),
          onDelete: g & 0x1000 ? 'CASCADE' : g & 0x2000 ? 'SET NULL' : '', onUpdate: g & 0x100 ? 'CASCADE' : '',
        });
      }
    } catch (e) { /* a database without that table: no relationship */ }

    if (!sections.length && !skipped.length) throw new DB.UserError('errEmpty');
    const fileMeta = [];
    let created = '';
    try { created = DB.isoFromDate(reader.getCreationDate()); } catch (e) { /* none */ }
    if (created) fileMeta.push(['mCreated', created.slice(0, 10)]);
    fileMeta.push(['mAccess', String.fromCharCode.apply(null, u8.subarray(4, 19)) === 'Standard ACE DB' ? 'Access 2007 or later (.accdb)' : 'Jet database (.mdb)']);
    let linked = [];
    try { linked = reader.getTableNames({ normalTables: false, linkedTables: true }); } catch (e) { /* none */ }
    if (linked.length) fileMeta.push(['mExternal', linked.map((x) => '`' + x + '`').join(', ')]);
    if (skipped.length) fileMeta.push(['mSkipped', skipped.map((x) => '`' + x + '`').join(', ')]);
    fileMeta.push(['mNotRead', 'saved queries, forms, reports, macros and code; primary keys and indexes']);
    if (sections.some((s) => s.rowsTotal > s.rows.length)) fileMeta.push(['mRowsCut', String(maxRows)]);
    return { sections, fileMeta, notes: {} };
  };
})();
