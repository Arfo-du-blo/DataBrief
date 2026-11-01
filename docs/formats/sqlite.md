# SQLite databases

A database is more than its rows: **keys, constraints and relationships** are what let an AI understand it. DataBrief reads them.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

Files ending in `.sqlite`, `.sqlite3`, `.db` or `.db3` (recognised by their content).

- **Every table**, as a section, with each column's **declared SQL type**, **primary key** (in key order for composite keys) and **NOT NULL**.
- **Generated columns** (virtual or stored), marked as such, and included in the rows.
- **Foreign keys**, as one constraint each: composite keys with their ordered columns, `ON DELETE` / `ON UPDATE` actions, and keys that do not name their target (resolved to the primary key of the referenced table).
- **Unique constraints and indexes**, and the original **`CREATE TABLE`** of each table (it carries defaults, `CHECK` constraints and generated-column expressions).
- **Views**, with their SQL (never their results).
- **Relationships between the tables:** each foreign key, **one-to-one** when the key column is also unique, **self-references**, and **junction tables** (a table whose primary key is made of foreign keys) as **many-to-many** between their two parents.
- **64-bit integers exactly**, `NULL` as empty, and binary values as `[binary N bytes]`.

## The best file to give

- **The `.sqlite` / `.db` file itself.** For a database from another system (PostgreSQL, MySQL, SQL Server…), SQL dump support is planned for the next version; for now, export the tables you need to CSV or Parquet, or convert the database to SQLite.

## How to get it

| From | How |
|---|---|
| An application | find its `.db` / `.sqlite` file (often in its data folder) |
| Python | `sqlite3.connect("data.db")` already is one; or `df.to_sql("t", conn)` from pandas |
| DuckDB | `ATTACH 'data.db' (TYPE SQLITE)` or `COPY ... TO` Parquet |
| `sqlite3` shell | `.backup copy.db` makes a clean copy of a live database |

## Good to know

- **Nothing is executed**: DataBrief only reads (tables, structure). The database runs inside the page (SQLite compiled to WebAssembly), nothing leaves the browser.
- **The whole database is read into memory**, rows included, so very large databases may be slow.
- **Tables that cannot be read** (for example some virtual tables) are listed as skipped.
- **Encrypted databases** (SQLCipher) cannot be read.
- A copy taken while the application was writing may miss recent changes: use `.backup` or close the application first.

## With "Do not share data"

A database is an ideal case: the AI gets the **whole schema** — tables, columns, types, keys, relationships, and (if you allow SQL) the definitions — and can suggest queries and analyses without any record. Notes:
- **Names:** table, column, index and view names can be replaced by neutral names (`table_1`, `column_3`); relationships keep their shape. SQL definitions are only available when names are shared (they spell the names out).
- **SQL definitions** may contain **literal values** (a default of `'Smith'`, a view filtering on a name): they are off by default.
- **Inferred relationships** (computed by comparing values) appear from level 2; **declared** ones are structure and appear at every level.

See [the guide to this mode](../no-share.md).

## See also

[Excel](excel.md) · [Parquet](parquet.md) · [CSV](csv.md)
