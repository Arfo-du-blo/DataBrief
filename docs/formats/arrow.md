# Apache Arrow and Feather (.arrow, .arrows, .feather)

**Apache Arrow** is the columnar memory format behind pandas, Polars, R's arrow package, DuckDB and Spark. Its files:

- the **Arrow IPC file** (`.arrow`, also `.ipc`), and the **Arrow IPC stream** (`.arrows`);
- **Feather v2** (`.feather`), which *is* an Arrow IPC file, often compressed with LZ4 or Zstandard;
- **Feather v1**, the older format (before 2020), with simple columns only.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **Every column and row**, with the **Arrow type** of each column: `int64`, `decimal128(9,2)`, `dictionary<string>`
  (a categorical column), `timestamp[ms, Europe/Paris]`, `list<string>`, `large_string`…
- **Structs are flattened** into columns (`shipping.carrier`, `shipping.days`); lists, maps and unions are one column of
  JSON text.
- **Values as people read them:** decimals with their scale (`19.90`), dictionary values decoded, dates, times and
  timestamps (shown in UTC: the column type says which time zone the writer gave), binary in hexadecimal.
- The **number of record batches**, and the **metadata** the writer added to the schema (pandas' and Polars' included,
  pandas' summarised).
- Compression: **LZ4** and **Zstandard** (and none).

## The best file to give

- From **pandas**: `df.to_feather("data.feather")`. From **Polars**: `df.write_ipc("data.arrow")`.
  From **R**: `arrow::write_feather(df, "data.feather")`. From **pyarrow**: `pyarrow.feather.write_feather(table, ...)`.
- A [Parquet](parquet.md) file is just as good, and usually smaller.

## Good to know

- Only the **first 250,000 rows** are kept; the row count stays exact.
- A stream (`.arrows`) is recognised by its extension and content; the other files by their content, whatever their name.
- Feather v1 files are read with their simple types (numbers, text, categories, dates, times, timestamps).
- Arrow IPC files are read by [flechette](https://github.com/uwdata/flechette) (BSD-3-Clause), built into the page by
  `tools/build-flechette.sh` with one added check: a damaged file is refused instead of using all the memory.

## With "Do not share data"

Records are never included. Column names are names, and so are the field names inside a struct type
(`struct<string, int8>` when names are not shared). The writer's metadata counts as free text and names (shown only when
both are allowed).
