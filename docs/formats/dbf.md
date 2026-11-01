# DBF files (dBase, FoxPro, Visual FoxPro)

DBF is the table format of dBase and its descendants (FoxBase, FoxPro, Visual FoxPro, Clipper). It is still everywhere: old
business and accounting software, public data sets, and the **attribute tables of shapefiles** (the `.dbf` next to a `.shp`).

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

Files ending in `.dbf`. A DBF file holds **one table**.

- **Every field**, with its name and type (`CHAR(20)`, `NUMERIC(10,2)`, `DATE`, `BOOLEAN`, `INTEGER`, `CURRENCY`, `DOUBLE`,
  `DATETIME`...).
- **Every record that is not deleted.** Dates are written `YYYY-MM-DD`, logical fields `true` / `false`, and an empty or
  invalid value as empty. In Visual FoxPro files, **null** values are read as empty.
- **The text encoding**, taken from the code page recorded in the file: DOS code pages (437, 850, 852, 857, 737, 860, 861,
  863, 865, 866), Windows code pages (1250 to 1257, 874), Mac, Shift-JIS, GBK, Big5 and Korean. A file that records no code
  page is read as UTF-8 when it fits, otherwise as Windows-1252, and the prompt says so.
- **The version** of the format (dBase III, IV, FoxPro 2.x, Visual FoxPro...).

## The best file to give

The `.dbf` file itself. For a **shapefile**, give the `.dbf` (the attribute table); DataBrief does not read the geometry.

## Good to know

- **Memo fields** hold long text in a **separate file** (`.dbt` or `.fpt`). That file is **not read**: the memo fields are
  listed as not read and left empty.
- **Deleted records** (dBase only marks them) are **skipped and counted**.
- **A file cut short** (an interrupted copy, for example) is read as far as it goes, and the prompt says how many records the
  header announced and the file does not have.
- **Large files:** only the first **250,000 records** are kept; the counts stay exact.
- **Field names** are limited to 10 characters by the format, so they are often abbreviations.
- A `.dbf` that is really something else (a renamed text file) gives a clear error.

## With "Do not share data"

The records are never included. The field names can be replaced by neutral names, and the names of the memo fields count as
names. The text encoding, the version and the counts are structure, and stay. See [the guide to this mode](../no-share.md).

## See also

[Excel](excel.md) · [SPSS](spss.md) · [CSV](csv.md) · [SQLite](sqlite.md)
