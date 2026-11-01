# PostgreSQL archives (`pg_dump -Fc` and `-Ft`)

`pg_dump` can write a database as a **plain SQL text file**, or as a **binary archive**: the *custom* format (`-Fc`) or the
*tar* format (`-Ft`). The binary archives are smaller and are what `pg_restore` expects. DataBrief reads them and gives the
same result as the plain SQL dump of the same database.

[← Back to the README](../../README.md#supported-formats)

Need to produce this file? See [Export your database](../export-your-database.md).

## What DataBrief reads

Files recognised **by their content** (the first bytes), whatever their name: usually `.dump`, `.backup` or `.tar`.

- **The same information as a [SQL dump](sql.md):** tables, columns and types, primary, unique and foreign keys, indexes,
  views, comments, enum labels, relationships, and the rows of every table.
- **Compressed or not:** gzip (the default), **lz4** and **zstd** (PostgreSQL 16 and later), or no compression.
- **Archive versions** written by **PostgreSQL 9.0 to 17**.
- **What it came from:** the archive's version, its compression and the `pg_dump` and server versions are written in the
  prompt.

DataBrief rebuilds the SQL text that `pg_restore` would print and reads it. **Nothing is restored, nothing is executed**, and
no database is needed.

## The best file to give

- `pg_dump -Fc mydb > mydb.dump`
- `pg_dump -Fc --schema-only mydb > schema.dump` when the structure is enough: smaller, and ideal for
  [Do not share data](../no-share.md).
- A plain SQL dump (`pg_dump mydb > dump.sql`) works as well and is easier to inspect.

## Good to know

- **The directory format (`-Fd`)** is a **folder** of files, which cannot be dropped as one file. Use `-Fc`, `-Ft` or a plain
  SQL dump instead.
- **Large objects** (`lo_*`) are not read.
- **Damaged or cut archives:** a table whose data cannot be read is listed as skipped and the other tables are still read.
  An archive that cannot be read at all gives a clear message.
- **Very large archives:** as for SQL dumps, the first **250,000 rows of each table** are kept and the row counts stay exact.
- **Encryption:** `pg_dump` does not encrypt; a file encrypted afterwards (with `gpg`, for example) must be decrypted first.

## With "Do not share data"

The archive is read in the page and the rows are dropped as soon as the mode is on: the prompt holds the structure only, with
the same switches as for [SQL dumps](sql.md#with-do-not-share-data).

## See also

[SQL dumps](sql.md) · [SQLite](sqlite.md) · [Parquet](parquet.md)
