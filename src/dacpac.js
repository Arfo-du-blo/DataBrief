/* DataBrief - SQL Server data-tier packages (.dacpac, and the schema of a .bacpac). GPL-3.0-or-later.
 *
 * A .dacpac is a zip whose model.xml describes a database: tables, columns and types, keys, foreign keys, indexes, views,
 * descriptions. It holds no rows. (A .bacpac adds the rows as BCP files: not read, said in the prompt.) Nothing is executed.
 *
 *   DB.isDacpacNames(names) -> boolean       (model.xml with Origin.xml or DacMetadata.xml)
 *   DB.parseDacpac(modelXml, originXml, hasData) -> the same result shape as DB.parseSqlDump (sections, views, info.ignored ...)
 * Uses the browser's DOMParser: it is tested in the page, not in Node. */
'use strict';
(function () {
  const DB = window.DB;
  const NS = 'http://schemas.microsoft.com/sqlserver/dac/Serialization/2012/02';

  DB.isDacpacNames = (names) => names.includes('model.xml') && (names.includes('Origin.xml') || names.includes('DacMetadata.xml'));

  const kids = (e, name) => Array.from(e.children).filter((c) => c.localName === name);
  const rel = (e, name) => kids(e, 'Relationship').find((r) => r.getAttribute('Name') === name);
  const entries = (r) => (r ? kids(r, 'Entry') : []);
  const refOf = (entry) => { const r = kids(entry, 'References')[0]; return r ? { name: r.getAttribute('Name'), builtin: r.getAttribute('ExternalSource') === 'BuiltIns' } : null; };
  const refs = (e, relName) => entries(rel(e, relName)).map(refOf).filter(Boolean);
  function prop(e, name) {
    for (const c of e.children) {
      if (c.localName !== 'Property' || c.getAttribute('Name') !== name) continue;
      const v = c.getAttribute('Value');
      if (v !== null) return v;
      const t = c.getElementsByTagNameNS(NS, 'Value')[0];
      return t ? t.textContent : null;
    }
    return null;
  }
  // "[dbo].[Customers].[Id]" -> ["dbo", "Customers", "Id"]   ("]]" is a closing bracket inside a name)
  const parts = (n) => (String(n || '').match(/\[(?:[^\]]|\]\])*\]/g) || []).map((x) => x.slice(1, -1).replace(/\]\]/g, ']'));
  // N'text with ''quotes''' -> text with 'quotes'
  const unliteral = (s) => { const m = /^N?'([\s\S]*)'$/.exec(String(s || '').trim()); return m ? m[1].replace(/''/g, "'") : String(s || ''); };

  function typeOf(col) {
    const spec = entries(rel(col, 'TypeSpecifier')).map((e) => kids(e, 'Element')[0]).filter(Boolean)[0];
    if (!spec) return { sql: '', anon: '' };
    const ref = refs(spec, 'Type')[0];
    if (!ref) return { sql: '', anon: '' };
    const p = parts(ref.name);
    const base = ref.builtin ? p[p.length - 1].toLowerCase() : p.join('.');
    let args = '';
    if (prop(spec, 'IsMax') === 'True') args = '(MAX)';
    else if (prop(spec, 'Length')) args = '(' + prop(spec, 'Length') + ')';
    else if (prop(spec, 'Precision')) args = '(' + prop(spec, 'Precision') + ',' + (prop(spec, 'Scale') || '0') + ')';
    else if (['datetime2', 'datetimeoffset', 'time'].includes(base)) args = '(' + (prop(spec, 'Scale') || '0') + ')';
    return { sql: base + args, anon: ref.builtin ? base + args : 'custom_type' };
  }

  const IGNORED = { SqlProcedure: 'procedure', SqlScalarFunction: 'function', SqlInlineTableValuedFunction: 'function', SqlMultiStatementTableValuedFunction: 'function',
    SqlDmlTrigger: 'trigger', SqlDatabaseDdlTrigger: 'trigger', SqlServerDdlTrigger: 'trigger' };
  const ACTIONS = { 1: 'CASCADE', 2: 'SET NULL', 3: 'SET DEFAULT' };

  DB.parseDacpac = function (modelXml, originXml, hasData) {
    const doc = new DOMParser().parseFromString(modelXml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !doc.documentElement || doc.documentElement.localName !== 'DataSchemaModel') throw new DB.UserError('errCorrupt', { ext: '.dacpac' });
    const model = kids(doc.documentElement, 'Model')[0];
    const els = model ? kids(model, 'Element') : [];
    const tables = new Map();           // "[dbo].[Customers]" -> table
    const order = [];
    const ignored = {};
    for (const e of els) {
      if (e.getAttribute('Type') !== 'SqlTable') continue;
      const name = e.getAttribute('Name');
      const p = parts(name);
      const t = { key: name, schema: p[0] || '', name: p[p.length - 1], columns: [], pk: [], unique: [], indexes: [], fks: [], description: '' };
      for (const entry of entries(rel(e, 'Columns'))) {
        const col = kids(entry, 'Element')[0];
        if (!col) continue;
        const cp = parts(col.getAttribute('Name'));
        const c = { name: cp[cp.length - 1], sqlType: '', anon: '', notNull: prop(col, 'IsNullable') === 'False', generated: '', identity: prop(col, 'IsIdentity') === 'True', comment: '' };
        if (col.getAttribute('Type') === 'SqlComputedColumn') { c.generated = prop(col, 'IsPersisted') === 'True' ? 'stored' : 'virtual'; }
        else { const ty = typeOf(col); c.sqlType = ty.sql; c.anon = ty.anon; }
        if (c.identity && c.sqlType) { c.sqlType += ' IDENTITY'; c.anon += ' IDENTITY'; }
        t.columns.push(c);
      }
      tables.set(name, t);
      order.push(t);
    }
    const colsOf = (e) => entries(rel(e, 'ColumnSpecifications')).map((en) => kids(en, 'Element')[0]).filter(Boolean)
      .map((spec) => refs(spec, 'Column')[0]).filter(Boolean).map((r) => { const p = parts(r.name); return p[p.length - 1]; });
    const lastName = (e) => { const n = e.getAttribute('Name'); return n ? parts(n).pop() : ''; };
    const tableOf = (e, relName) => { const r = refs(e, relName)[0]; return r ? tables.get(r.name) : null; };
    for (const e of els) {
      const type = e.getAttribute('Type');
      if (type === 'SqlPrimaryKeyConstraint') { const t = tableOf(e, 'DefiningTable'); if (t) t.pk = colsOf(e); }
      else if (type === 'SqlUniqueConstraint') { const t = tableOf(e, 'DefiningTable'); if (t) t.unique.push({ name: lastName(e), cols: colsOf(e) }); }
      else if (type === 'SqlIndex') {
        const t = tableOf(e, 'IndexedObject');
        if (t) (prop(e, 'IsUnique') === 'True' ? t.unique : t.indexes).push({ name: lastName(e), cols: colsOf(e) });
      } else if (type === 'SqlForeignKeyConstraint') {
        const t = tableOf(e, 'DefiningTable'), target = tableOf(e, 'ForeignTable');
        const last = (r) => { const p = parts(r.name); return p[p.length - 1]; };
        if (t && target) {
          t.fks.push({ target, from: refs(e, 'Columns').map(last), to: refs(e, 'ForeignColumns').map(last),
            onDelete: ACTIONS[prop(e, 'OnDeleteAction')] || '', onUpdate: ACTIONS[prop(e, 'OnUpdateAction')] || '' });
        }
      } else if (type === 'SqlExtendedProperty' && /\[MS_Description\]$/.test(e.getAttribute('Name') || '')) {
        const p = parts(e.getAttribute('Name'));              // [SqlTableBase].[dbo].[T].[MS_Description] or [SqlColumn].[dbo].[T].[C].[MS_Description]
        const text = unliteral(prop(e, 'Value'));
        const t = tables.get('[' + p[1] + '].[' + p[2] + ']');
        if (t && p[0] === 'SqlTableBase') t.description = text;
        else if (t && p[0] === 'SqlColumn') { const c = t.columns.find((x) => x.name === p[3]); if (c) c.comment = text; }
      } else if (IGNORED[type]) ignored[IGNORED[type]] = (ignored[IGNORED[type]] || 0) + 1;
    }
    // table names: "dbo" is left out, any other schema is part of the name
    const display = (t) => (t.schema && t.schema.toLowerCase() !== 'dbo' ? t.schema + '.' + t.name : t.name);
    const sections = order.map((t) => ({
      name: display(t), rows: [], rowsTotal: 0, description: t.description, externalData: '', externalInfo: null,
      columns: t.columns.map((c) => {
        const arrows = [];
        for (const f of t.fks) { const i = f.from.indexOf(c.name); if (i >= 0) arrows.push('→ `' + display(f.target) + '.' + (f.to[i] || '?') + '`'); }
        const meta = { sqlType: c.sqlType, key: [t.pk.includes(c.name) ? { key: 'pk' } : null].concat(arrows).filter(Boolean), notNull: c.notNull ? { key: 'yes' } : '' };
        if (c.anon && c.anon !== c.sqlType) meta.sqlTypeAnon = c.anon;
        if (c.generated) meta.generated = { key: c.generated === 'stored' ? 'genStored' : 'genVirtual' };
        if (c.comment) meta.label = c.comment;
        return { name: c.name, meta };
      }),
      constraints: {
        pk: t.pk, unique: t.unique, indexes: t.indexes, ddl: '',
        fks: t.fks.map((f) => ({ table: display(f.target), from: f.from, to: f.to, onDelete: f.onDelete, onUpdate: f.onUpdate })),
      },
    }));
    const views = els.filter((e) => e.getAttribute('Type') === 'SqlView').map((e) => {
      const p = parts(e.getAttribute('Name'));
      return { name: p[p.length - 1], sql: 'CREATE VIEW [' + p.join('].[') + '] AS' + (prop(e, 'QueryScript') || '') };
    });
    let model12 = '';
    if (originXml) { const m = /<Version>([^<]+)<\/Version>/.exec(originXml); model12 = m ? m[1] : ''; }
    const fileMeta = [];
    if (views.length) fileMeta.push(['mViews', views.map((v) => '`' + v.name + '`').join(', ')]);
    return { sections, views, fileMeta, notes: {}, dialectName: 'SQL Server (data-tier package)', packageVersion: model12, hasData: !!hasData,
      info: { ignored, errors: {}, externalFiles: [], truncated: false } };
  };
})();
