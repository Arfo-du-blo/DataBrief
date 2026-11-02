#!/usr/bin/env node
/* Tests of the geodata reader (src/geo.js) in Node, without a browser.
 *   node tests/test_geo.cjs
 * 1. The REAL files of tests/v14-fixtures/geo-fixtures (written by GDAL) against expected.json and against the coordinates
 *    given to GDAL (make_sources.py): the summaries below are worked out by hand from those coordinates, not from the reader.
 * 2. Hand-made WKB (marked synthetic): both byte orders, ISO and extended (PostGIS) dimension codes, empty points,
 *    GeoPackage headers with an envelope; hostile blobs (huge counts, deep nesting, cut short) give null, quickly.
 * 3. GeoJSON corner cases: a lone Feature, a bare geometry, nested properties, an old "crs", TopoJSON (not GeoJSON).
 * GEO_SRC: another copy of the reader (used to check that these tests catch a broken reader). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'v14-fixtures');
const ctx = { console, TextDecoder, TextEncoder, Intl };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['src/util.js', process.env.GEO_SRC || 'src/geo.js']) vm.runInContext(fs.readFileSync(path.resolve(ROOT, f), 'utf8'), ctx, { filename: f });
const DB = ctx.DB;
const EXP = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  —  ' + String(detail).slice(0, 600) : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The geometries given to GDAL (make_sources.py), summarised by hand
const SUMMARIES = [
  'POINT (2.3522 48.8566)',
  'LINESTRING (3 points; x 2.3…2.35, y 48.85…48.86)',
  'POLYGON (1 ring, 5 points; x 2.33…2.36, y 48.85…48.87)',
  'MULTIPOLYGON (2 parts, 2 rings, 8 points; x 2.34…2.37, y 48.85…48.86)',
  '',
];

/* ---------------------------------------------------------------- 1. real files ---------- */
{
  const tree = JSON.parse(fs.readFileSync(path.join(FIX, 'geo-fixtures', 'places.geojson'), 'utf8'));
  const d = DB.geoJsonDoc(tree, 'places_file');
  const s = d && d.sections[0];
  const e = EXP.geojson;
  ok('geojson (GDAL): recognised, one table named after the collection', !!s && d.sections.length === 1 && s.name === 'places', s && s.name);
  ok('geojson (GDAL): the properties, then the geometry column', s && same(s.columns.map((c) => c.name), e.properties.concat(['geometry'])), s && JSON.stringify(s.columns.map((c) => c.name)));
  ok('geojson (GDAL): 5 features, attributes read', s && s.rows.length === e.features && same(s.rows[0].slice(0, 3), ['1', 'Town hall', 'civic']) && s.rows[4][2] === '', s && JSON.stringify(s.rows));
  ok('geojson (GDAL): every geometry summarised (kind, size, extent)', s && same(s.rows.map((r) => r[3]), SUMMARIES), s && JSON.stringify(s.rows.map((r) => r[3])));
  const meta = d ? Object.fromEntries(d.fileMeta) : {};
  ok('geojson (GDAL): coordinate system and kinds', meta.mCrs === 'WGS 84 (longitude, latitude)' &&
    meta.mGeomTypes === 'Point: 1, LineString: 1, Polygon: 1, MultiPolygon: 1, no geometry: 1', JSON.stringify(meta));
  ok('geojson (GDAL): extent of all geometries', meta.mExtent === 'x 2.3…2.37, y 48.85…48.87', meta.mExtent);
  ok('geojson (GDAL): the geometry column says its kinds and system', s && s.columns[3].meta.geometry === 'Point, LineString, Polygon, MultiPolygon · WGS 84 (longitude, latitude)', s && s.columns[3].meta.geometry);
  const c = JSON.parse(fs.readFileSync(path.join(FIX, 'canary', 'CONFIDENTIAL_FILE_geojson.geojson'), 'utf8'));
  const cd = DB.geoJsonDoc(c, 'x');
  ok('geojson canary: layer name and column name come from the file (names)', cd && cd.sections[0].name === 'CONFIDENTIAL_COL_LAYER' && cd.sections[0].columns.some((x) => x.name === 'CONFIDENTIAL_COL_A'));
}

/* GeoPackage: the geometry blobs of the real file, read with sql.js (the same SQLite engine as the page) */
const gpkgDone = (async () => {
  let initSqlJs;
  try { initSqlJs = require(path.join(ROOT, 'vendor', 'sql-wasm.js')); } catch (e) { ok('gpkg: sql.js loads in Node', false, e.message); return; }
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(path.join(ROOT, 'vendor', 'sql-wasm.wasm')) });
  const db = new SQL.Database(fs.readFileSync(path.join(FIX, 'geo-fixtures', 'city.gpkg')));
  const blobs = (t) => { const r = db.exec('SELECT geom FROM "' + t + '" ORDER BY fid')[0]; return r.values.map((v) => v[0]); };
  const sum = blobs('places').map((b) => (b ? DB.gpkgGeometry(b).text : ''));
  ok('gpkg (GDAL): WGS 84 layer, every geometry summarised', same(sum, SUMMARIES), JSON.stringify(sum));
  const lam = blobs('places_lambert93').map((b) => (b ? DB.gpkgGeometry(b) : null));
  const p = lam[0] && /^POINT \(([\d.]+) ([\d.]+)\)$/.exec(lam[0].text);
  // Paris town hall in Lambert-93: about x 652,000 and y 6,862,000 (projected metres)
  ok('gpkg (GDAL): Lambert-93 layer, projected coordinates', !!p && Math.abs(+p[1] - 652000) < 2000 && Math.abs(+p[2] - 6862000) < 2000 &&
    lam[3].type === 'MultiPolygon' && lam[4] === null, JSON.stringify(lam.map((x) => x && x.text)));
  const kinds = db.exec('SELECT table_name, data_type FROM gpkg_contents ORDER BY table_name')[0].values;
  ok('gpkg (GDAL): the registry the reader relies on (independent check)', same(kinds, [['attributes_only', 'attributes'], ['places', 'features'], ['places_lambert93', 'features']]), JSON.stringify(kinds));
  db.close();
})();

/* ---------------------------------------------------------------- 2. WKB by hand (synthetic) ---------- */
function wkb(le, type, body) {         // body: array of [kind, value] with kind 'u32' or 'f64'
  const parts = [Buffer.from([le ? 1 : 0])];
  const u32 = (v) => { const b = Buffer.alloc(4); le ? b.writeUInt32LE(v >>> 0) : b.writeUInt32BE(v >>> 0); return b; };
  const f64 = (v) => { const b = Buffer.alloc(8); le ? b.writeDoubleLE(v) : b.writeDoubleBE(v); return b; };
  parts.push(u32(type));
  for (const [k, v] of body) parts.push(k === 'u32' ? u32(v) : k === 'raw' ? v : f64(v));
  return new Uint8Array(Buffer.concat(parts));
}
const S = (u8) => DB.geoSummary(DB.readWkb(u8));
ok('wkb (synthetic): point, little and big endian', S(wkb(true, 1, [['f64', 1.5], ['f64', -2]])) === 'POINT (1.5 -2)' && S(wkb(false, 1, [['f64', 1.5], ['f64', -2]])) === 'POINT (1.5 -2)');
ok('wkb (synthetic): ISO point Z (1001) and extended (PostGIS) point Z with SRID', S(wkb(true, 1001, [['f64', 1], ['f64', 2], ['f64', 3]])) === 'POINT Z (1 2)' &&
  S(wkb(true, 0xA0000001, [['u32', 4326], ['f64', 1], ['f64', 2], ['f64', 3]])) === 'POINT Z (1 2)');
ok('wkb (synthetic): an empty point (NaN coordinates)', S(wkb(true, 1, [['f64', NaN], ['f64', NaN]])) === 'POINT EMPTY');
ok('wkb (synthetic): a line', S(wkb(true, 2, [['u32', 2], ['f64', 0], ['f64', 0], ['f64', 10], ['f64', 5]])) === 'LINESTRING (2 points; x 0…10, y 0…5)');
const inner = wkb(true, 1, [['f64', 3], ['f64', 4]]);
ok('wkb (synthetic): a collection of two points', S(wkb(true, 7, [['u32', 2], ['raw', Buffer.from(inner)], ['raw', Buffer.from(inner)]])) === 'GEOMETRYCOLLECTION (2 parts, 2 points; x 3…3, y 4…4)');
let t0 = Date.now();
ok('wkb (synthetic, hostile): a count of 2 billion points gives null at once', DB.readWkb(wkb(true, 2, [['u32', 0x7fffffff]])) === null && Date.now() - t0 < 50);
let deep = inner;
for (let i = 0; i < 200; i++) deep = wkb(true, 7, [['u32', 1], ['raw', Buffer.from(deep)]]);
t0 = Date.now();
ok('wkb (synthetic, hostile): 200 nested collections give null (depth limit), no stack overflow', DB.readWkb(deep) === null && Date.now() - t0 < 200);
const line = wkb(true, 2, [['u32', 3], ['f64', 0], ['f64', 0], ['f64', 1], ['f64', 1], ['f64', 2], ['f64', 2]]);
ok('wkb (synthetic, hostile): a blob cut short gives null', DB.readWkb(line.subarray(0, line.length - 5)) === null && DB.readWkb(new Uint8Array(0)) === null);
ok('wkb (synthetic, hostile): an unknown geometry code gives null', DB.readWkb(wkb(true, 99, [])) === null);
// GeoPackage header: "GP", version 0, flags (little endian, envelope [minx maxx miny maxy] = code 1), srs_id, envelope, WKB
const gp = (flags, env, w) => new Uint8Array(Buffer.concat([Buffer.from([0x47, 0x50, 0, flags]), Buffer.from([0xe6, 0x10, 0, 0]), Buffer.alloc(env), Buffer.from(w)]));
ok('gpkg header (synthetic): envelope skipped, WKB read', DB.gpkgGeometry(gp(0x03, 32, line)).text === 'LINESTRING (3 points; x 0…2, y 0…2)' && DB.gpkgGeometry(gp(0x01, 0, inner)).text === 'POINT (3 4)');
ok('gpkg header (synthetic): the empty flag, a bad magic, an unknown envelope code', DB.gpkgGeometry(gp(0x11, 0, inner)).text === 'POINT EMPTY' &&
  DB.gpkgGeometry(new Uint8Array([0x58, 0x50, 0, 1, 0, 0, 0, 0, 1])) === null && DB.gpkgGeometry(gp(0x0f, 0, inner)) === null);

/* ---------------------------------------------------------------- 3. GeoJSON corner cases ---------- */
{
  const one = DB.geoJsonDoc({ type: 'Feature', id: 'f1', properties: { a: { b: 1 } }, geometry: { type: 'Point', coordinates: [1, 2, 3] } }, 'base');
  ok('geojson: a lone Feature, its id, nested properties flattened, a 3D point', one && one.sections[0].name === 'base' &&
    same(one.sections[0].columns.map((c) => c.name), ['id', 'a.b', 'geometry']) && same(one.sections[0].rows[0], ['f1', '1', 'POINT Z (1 2)']), one && JSON.stringify(one.sections[0]));
  const bare = DB.geoJsonDoc({ type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]] }, 'b');
  ok('geojson: a bare geometry (a polygon with a hole)', bare && bare.sections[0].rows[0][0] === 'POLYGON (2 rings, 8 points; x 0…4, y 0…4)', bare && JSON.stringify(bare.sections[0].rows));
  const clash = DB.geoJsonDoc({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 7, properties: { id: 1, geometry: 'text' }, geometry: null }] }, 'c');
  ok('geojson: a property named id or geometry does not collide', clash && same(clash.sections[0].columns.map((c) => c.name), ['feature_id', 'id', 'geometry', 'geometry_']), clash && JSON.stringify(clash.sections[0].columns.map((c) => c.name)));
  const old = DB.geoJsonDoc({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2154' } }, features: [] }, 'o');
  ok('geojson: an old-style crs member is reported', old && Object.fromEntries(old.fileMeta).mCrs === 'EPSG:2154', old && JSON.stringify(old.fileMeta));
  ok('geojson: TopoJSON and ordinary JSON are not GeoJSON', DB.geoJsonDoc({ type: 'Topology', objects: {} }, 't') === null && DB.geoJsonDoc([{ type: 'Point' }], 't') === null && DB.geoJsonDoc({ a: 1 }, 't') === null);
  // review of v1.4: an object that merely has "type": "Point" (a chart setting) is ordinary JSON; a real bare geometry is GeoJSON
  ok('geojson: {"type":"Point"} without coordinates is ordinary JSON', DB.geoJsonDoc({ type: 'Point', x: 3, label: 'A' }, 't') === null &&
    DB.geoJsonDoc({ type: 'Point', coordinates: [1, 2] }, 't') !== null && DB.geoJsonDoc({ type: 'GeometryCollection', geometries: [] }, 't') !== null);
  const bad = DB.geoJsonDoc({ type: 'FeatureCollection', features: [null, 5, { type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: 'x' } }] }, 'z');
  ok('geojson: broken features do not throw', bad && bad.sections[0].rows.length === 1 && bad.sections[0].rows[0][0] === 'POINT EMPTY', bad && JSON.stringify(bad.sections[0]));
}

gpkgDone.then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
