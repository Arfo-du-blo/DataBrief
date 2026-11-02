# Geodata (GeoJSON, GeoPackage)

**GeoJSON** is the JSON format of web maps: a list of *features*, each with properties (name, category, population...) and a
geometry (a point, a line, a polygon...). **GeoPackage** (`.gpkg`) is the open standard of desktop GIS (QGIS, ArcGIS Pro,
GDAL): a SQLite database that holds several *layers*.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

**GeoJSON** (`.geojson`, or any `.json` that holds GeoJSON: it is recognised by its content):

- **Every feature**, one row each: its **properties** as columns (nested properties are flattened, as for JSON), its `id`,
  and its **geometry summarised** in a `geometry` column.
- **The coordinate system:** WGS 84 longitude/latitude (the rule of the format), or the one an older file declares in `crs`.
- **The geometry kinds** and how many features have each, and the **extent** (the rectangle around everything).
- The **name** of the collection, when the file has one (GDAL writes it), as the name of the table.

**GeoPackage** (`.gpkg`):

- **Every layer**: feature layers and attribute tables (tables without geometry), with their columns, rows, keys and
  relationships (it is a SQLite database: see [SQLite](sqlite.md)).
- For each geometry column: the **declared geometry kind** and the **coordinate system** of its layer (`WGS 84 (EPSG:4326)`,
  `RGF93 v1 / Lambert-93 (EPSG:2154)`...).
- The layer's **title and description**, when it has them.

**How a geometry is summarised:** its kind, then its size and extent, never the whole list of coordinates:

| Geometry | In the prompt |
|---|---|
| a point | `POINT (2.3522 48.8566)` |
| a line | `LINESTRING (3 points; x 2.3…2.35, y 48.85…48.86)` |
| a polygon | `POLYGON (1 ring, 5 points; x 2.33…2.36, y 48.85…48.87)` |
| several parts | `MULTIPOLYGON (2 parts, 2 rings, 8 points; x …, y …)` |
| with heights | `POINT Z (…)` |
| none | empty |

The AI then knows what each feature is and where it lies, and can help you analyse the attributes, but it cannot redraw the
map from the prompt.

## The best file to give

- From **QGIS**: right-click the layer → *Export* → *Save Features As…* → GeoPackage or GeoJSON.
- From **GDAL**: `ogr2ogr -f GPKG out.gpkg input.shp` or `ogr2ogr -f GeoJSON out.geojson input.shp`.
- A **shapefile** is several files (`.shp`, `.shx`, `.dbf`, `.prj`): convert it to GeoPackage first, or give its `.dbf`
  (the attributes only, see [DBF](dbf.md)).

## Good to know

- **Tile sets** in a GeoPackage (map images) are counted, not read. The GeoPackage's own tables (`gpkg_*`, `rtree_*`) are
  machinery and are left out.
- **TopoJSON** is not GeoJSON: it is read as plain JSON.
- **Large files:** everything happens in the browser's memory; a GeoJSON of several hundred MB can be slow.
- A geometry that cannot be decoded is shown as `[geometry not readable]`; the rest of the row is read.

## With "Do not share data"

Geometries are **values of the data**: they are never included, like any record. The **extent** and the **number of
features of each geometry kind** are computed from the records, so they are left out too. The coordinate system and the
declared geometry kinds are structure, and stay. Layer and column names count as names; titles and descriptions as free
text. See [the guide to this mode](../no-share.md).

## See also

[JSON](json.md) · [SQLite](sqlite.md) · [DBF](dbf.md)
