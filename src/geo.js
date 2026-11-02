/* DataBrief - geodata: GeoJSON, and the geometries of a GeoPackage (a SQLite file, read by parsers.js). GPL-3.0-or-later.
 *   DB.geoJsonDoc(tree, baseName) -> { sections, fileMeta, notes } when the JSON is GeoJSON, else null
 *   DB.gpkgGeometry(u8)           -> { type, text, empty } from a GeoPackage geometry blob ("GP" header + WKB), or null
 *   DB.geoSummary(geom)           -> "POINT (2.35 48.86)", "POLYGON (1 ring, 5 points; x 2.33…2.36, y 48.85…48.87)"
 * A geometry is summarised, never copied whole: its kind, its size and its extent. Coordinates are values of the data:
 * the column is of the kind "geometry" (never counted as categories) and "Do not share data" treats it like any record. */
'use strict';
(function () {
  const DB = window.DB;
  const KINDS = ['', 'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION'];
  const NAME = { POINT: 'Point', LINESTRING: 'LineString', POLYGON: 'Polygon', MULTIPOINT: 'MultiPoint', MULTILINESTRING: 'MultiLineString',
    MULTIPOLYGON: 'MultiPolygon', GEOMETRYCOLLECTION: 'GeometryCollection' };
  const MAX_DEPTH = 32;

  /* ---------------------------------------------------------------- a geometry, whatever its source ----------
     { kind: 'POLYGON', dims: '' | 'Z' | 'M' | 'ZM', parts, rings, points, bbox: [minx, miny, maxx, maxy] | null, first: [x, y], empty } */
  function newGeom(kind, dims) { return { kind, dims: dims || '', parts: 0, rings: 0, points: 0, bbox: null, first: null, empty: true }; }
  function addPoint(g, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    g.points++; g.empty = false;
    if (!g.first) g.first = [x, y];
    if (!g.bbox) g.bbox = [x, y, x, y];
    else { if (x < g.bbox[0]) g.bbox[0] = x; if (y < g.bbox[1]) g.bbox[1] = y; if (x > g.bbox[2]) g.bbox[2] = x; if (y > g.bbox[3]) g.bbox[3] = y; }
  }
  function merge(g, h) {
    g.points += h.points; g.rings += h.rings;
    if (h.empty) return;
    g.empty = false;
    if (!g.first) g.first = h.first;
    if (!g.bbox) g.bbox = h.bbox.slice();
    else { g.bbox[0] = Math.min(g.bbox[0], h.bbox[0]); g.bbox[1] = Math.min(g.bbox[1], h.bbox[1]); g.bbox[2] = Math.max(g.bbox[2], h.bbox[2]); g.bbox[3] = Math.max(g.bbox[3], h.bbox[3]); }
  }

  // Numbers as people read them: no 2.3500000000000001, at most 10 significant digits
  const num = (x) => String(Number(x.toPrecision(10)));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  DB.geoSummary = function (g) {
    if (!g) return '';
    const head = g.kind + (g.dims ? ' ' + g.dims : '');
    if (g.empty) return head + ' EMPTY';
    if (g.kind === 'POINT') return head + ' (' + num(g.first[0]) + ' ' + num(g.first[1]) + ')';
    const bits = [];
    if (g.kind.startsWith('MULTI') || g.kind === 'GEOMETRYCOLLECTION') bits.push(plural(g.parts, 'part', 'parts'));
    if (g.kind.endsWith('POLYGON')) bits.push(plural(g.rings, 'ring', 'rings'));
    bits.push(plural(g.points, 'point', 'points'));
    const b = g.bbox;
    return head + ' (' + bits.join(', ') + '; x ' + num(b[0]) + '…' + num(b[2]) + ', y ' + num(b[1]) + '…' + num(b[3]) + ')';
  };

  /* ---------------------------------------------------------------- WKB (ISO and extended) ----------
     Every count is checked against the bytes left: a damaged or hostile blob gives null, never a huge loop. */
  function readWkb(u8, start, end) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let p = start;
    function geom(depth) {
      if (depth > MAX_DEPTH || p + 5 > end) throw 0;
      const le = u8[p] === 1; p++;
      const u32 = () => { if (p + 4 > end) throw 0; const v = dv.getUint32(p, le); p += 4; return v; };
      let t = u32();
      let z = false, m = false;
      if (t & 0x80000000) z = true;                      // EWKB flags
      if (t & 0x40000000) m = true;
      if (t & 0x20000000) u32();                         // EWKB SRID
      t &= 0x0fffffff;
      const th = Math.floor(t / 1000);                   // ISO: 1000 Z, 2000 M, 3000 ZM
      if (th === 1 || th === 3) z = true;
      if (th === 2 || th === 3) m = true;
      const kind = KINDS[t % 1000];
      if (!kind) throw 0;
      const step = 16 + (z ? 8 : 0) + (m ? 8 : 0);
      const g = newGeom(kind, (z ? 'Z' : '') + (m ? 'M' : ''));
      const points = (n, into) => {
        if (n * step > end - p) throw 0;
        for (let i = 0; i < n; i++) { addPoint(into, dv.getFloat64(p, le), dv.getFloat64(p + 8, le)); p += step; }
      };
      if (kind === 'POINT') { points(1, g); if (g.points && Number.isNaN(g.first[0])) g.empty = true; return g; }
      if (kind === 'LINESTRING') { points(u32(), g); return g; }
      if (kind === 'POLYGON') {
        const rings = u32();
        if (rings * 4 > end - p) throw 0;
        g.rings = rings;
        for (let r = 0; r < rings; r++) points(u32(), g);
        return g;
      }
      const n = u32();                                    // multi-geometries and collections: n geometries, each with its own header
      if (n * 5 > end - p) throw 0;
      g.parts = n;
      for (let i = 0; i < n; i++) merge(g, geom(depth + 1));
      return g;
    }
    try { return geom(0); } catch (e) { return null; }
  }
  DB.readWkb = (u8) => readWkb(u8, 0, u8.length);

  /* GeoPackage geometry: "GP", version, flags, srs_id (int32), envelope (0, 32, 48 or 64 bytes), then WKB */
  DB.gpkgGeometry = function (u8) {
    if (!u8 || !ArrayBuffer.isView(u8) || u8.length < 8 || u8[0] !== 0x47 || u8[1] !== 0x50) return null;   // isView: also across realms
    const flags = u8[3];
    const env = [0, 32, 48, 48, 64][(flags >> 1) & 7];
    if (env === undefined) return null;
    const start = 8 + env;
    if ((flags & 0x20) || start > u8.length) return null;    // "extended" GeoPackage geometries: not standard WKB
    const g = start < u8.length ? readWkb(u8, start, u8.length) : null;
    if (!g) return null;
    if (flags & 0x10) g.empty = true;
    return { type: NAME[g.kind] || g.kind, text: DB.geoSummary(g), empty: g.empty };
  };

  /* ---------------------------------------------------------------- GeoJSON ---------- */
  const GEO_TYPES = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'];
  function fromGeoJson(o, depth) {
    if (!o || typeof o !== 'object' || depth > MAX_DEPTH) return null;
    const kind = Object.keys(NAME).find((k) => NAME[k] === o.type);
    if (!kind) return null;
    const c = o.coordinates;
    let dims = '';
    const g = newGeom(kind, '');
    const pt = (a) => { if (Array.isArray(a) && a.length >= 2) { if (a.length >= 3) dims = 'Z'; addPoint(g, +a[0], +a[1]); } };
    const line = (a) => { if (Array.isArray(a)) a.forEach(pt); };
    const poly = (a) => { if (Array.isArray(a)) { g.rings += a.length; a.forEach(line); } };
    switch (kind) {
      case 'POINT': pt(c); break;
      case 'LINESTRING': case 'MULTIPOINT': line(c); if (kind === 'MULTIPOINT') g.parts = Array.isArray(c) ? c.length : 0; break;
      case 'POLYGON': poly(c); break;
      case 'MULTILINESTRING': if (Array.isArray(c)) { g.parts = c.length; c.forEach(line); } break;
      case 'MULTIPOLYGON': if (Array.isArray(c)) { g.parts = c.length; c.forEach(poly); } break;
      case 'GEOMETRYCOLLECTION': {
        const list = Array.isArray(o.geometries) ? o.geometries : [];
        g.parts = list.length;
        for (const x of list) { const h = fromGeoJson(x, depth + 1); if (h) merge(g, h); }
        break;
      }
      default: break;
    }
    g.dims = dims;
    return g;
  }
  DB.geoFromGeoJson = (o) => fromGeoJson(o, 0);

  // RFC 7946: WGS 84 longitude/latitude unless an old-style "crs" member says otherwise
  function crsOf(tree) {
    const n = tree && tree.crs && tree.crs.properties && tree.crs.properties.name;
    if (!n) return 'WGS 84 (longitude, latitude)';
    const m = /EPSG:{1,2}(\d+)$/i.exec(String(n));
    if (/CRS84$/i.test(String(n)) || (m && m[1] === '4326')) return 'WGS 84 (longitude, latitude)';
    return m ? 'EPSG:' + m[1] : String(n).slice(0, 80);
  }

  DB.isGeoJson = (tree) => !!tree && typeof tree === 'object' && !Array.isArray(tree) &&
    ((tree.type === 'FeatureCollection' && Array.isArray(tree.features)) || (tree.type === 'Feature' && 'geometry' in tree) || GEO_TYPES.includes(tree.type));

  DB.geoJsonDoc = function (tree, baseName) {
    if (!DB.isGeoJson(tree)) return null;
    const features = tree.type === 'FeatureCollection' ? tree.features : tree.type === 'Feature' ? [tree] : [{ type: 'Feature', properties: {}, geometry: tree }];
    const hasPropId = features.some((f) => f && f.properties && Object.prototype.hasOwnProperty.call(f.properties, 'id'));
    const records = [];
    const counts = new Map();
    let bbox = null;
    let geomName = 'geometry';
    for (const f of features) if (f && f.properties && Object.prototype.hasOwnProperty.call(f.properties, geomName)) geomName = 'geometry_';
    for (const f of features) {
      if (!f || typeof f !== 'object') continue;
      const rec = {};
      if (f.id !== undefined && f.id !== null) rec[hasPropId ? 'feature_id' : 'id'] = f.id;
      Object.assign(rec, f.properties && typeof f.properties === 'object' && !Array.isArray(f.properties) ? f.properties : {});
      const g = fromGeoJson(f.geometry, 0);
      rec[geomName] = g ? DB.geoSummary(g) : '';
      const type = g ? (g.empty ? NAME[g.kind] + ' (empty)' : NAME[g.kind]) : 'no geometry';
      counts.set(type, (counts.get(type) || 0) + 1);
      if (g && !g.empty) {
        if (!bbox) bbox = g.bbox.slice();
        else { bbox[0] = Math.min(bbox[0], g.bbox[0]); bbox[1] = Math.min(bbox[1], g.bbox[1]); bbox[2] = Math.max(bbox[2], g.bbox[2]); bbox[3] = Math.max(bbox[3], g.bbox[3]); }
      }
      records.push(rec);
    }
    const flat = DB.flattenRecords(records);
    const notes = {};
    if (flat.flags.flattened) notes.flattened = true;
    if (flat.flags.arrays) notes.arrays = true;
    if (flat.flags.isoDates) notes.isoDates = true;
    const crs = crsOf(tree);
    const types = Array.from(counts.keys()).filter((k) => k !== 'no geometry' && !/\(empty\)$/.test(k));
    const columns = flat.columns.map((n) => ({ name: n, meta: n === geomName ? { geometry: types.join(', ') + (types.length ? ' · ' : '') + crs } : {} }));
    // A FeatureCollection may carry its own (layer) name: GDAL writes it
    const name = typeof tree.name === 'string' && tree.name.trim() ? tree.name.trim().slice(0, 120) : baseName;
    const fileMeta = [['mCrs', crs], ['mGeomTypes', Array.from(counts.entries()).map(([k, v]) => k + ': ' + v).join(', ')]];
    if (bbox) fileMeta.push(['mExtent', 'x ' + num(bbox[0]) + '…' + num(bbox[2]) + ', y ' + num(bbox[1]) + '…' + num(bbox[3])]);
    return { sections: [{ name, columns, rows: flat.rows }], fileMeta, notes };
  };
})();
