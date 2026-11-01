# DuckDB exports

A DuckDB database (`.duckdb`) is a single binary file that only DuckDB can open, so DataBrief asks for the **export** instead.
`EXPORT DATABASE` writes a folder of plain files that DataBrief reads completely: the structure **and** the rows.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

A **zip of the exported folder**. It must contain `schema.sql` and `load.sql` (the folder name inside the zip does not matter).

- **The structure**, from `schema.sql`, read like any [SQL dump](sql.md): tables, columns and types, primary, unique and foreign
  keys, indexes, views, and the **relationships** between the tables.
- **The rows**, from the data file of each table: **CSV** (`EXPORT DATABASE 'folder'`, the default) or **Parquet**
  (`EXPORT DATABASE 'folder' (FORMAT PARQUET)`). `load.sql` says which file belongs to which table; DataBrief follows it.
- Nothing is executed: `schema.sql` and `load.sql` are read as text.

## The best file to give

1. In DuckDB: `EXPORT DATABASE 'folder';`
2. Zip the folder.
3. Drop the zip.

For the structure only, drop `schema.sql` alone as a `.sql` file: it holds every table, key and view, and nothing else.

## Good to know

- **The `.duckdb` file cannot be read directly.** DataBrief recognises it by its content and explains how to export it.
- Only the first **250,000 rows of each table** are kept (the prompt says so).
- A table whose data file is **missing from the zip** is listed as skipped; the others are still read.
- Paths inside `load.sql` can be absolute or relative: only the file name is used to find the data in the zip.

## With "Do not share data"

The rows are dropped as soon as the mode is on; the prompt holds the structure only, with the same switches as for
[SQL dumps](sql.md#with-do-not-share-data).

## See also

[SQL dumps](sql.md) · [Parquet](parquet.md) · [CSV](csv.md)
