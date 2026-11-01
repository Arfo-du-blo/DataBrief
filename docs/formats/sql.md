# SQL dumps

A SQL dump is a text file that rebuilds a database: its tables, keys, views and, usually, its rows. It is what database tools
write when you "export" or "back up" a database, and it carries the **keys, constraints and relationships** that let an AI
understand the data. DataBrief reads it **as text, without running anything**.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

Files ending in `.sql` (also `.dump`, `.backup` or `.tar` when they are really plain SQL text), and **gzip-compressed** ones such as
`dump.sql.gz`: DataBrief unpacks them and says so in the prompt.

- **Table definitions**, as one section each: column names and **SQL types**, **NOT NULL**, **primary keys** (composite too),
  **unique constraints**, **indexes**, **generated columns**, and the original `CREATE TABLE`.
- **Foreign keys**, however the dump writes them: inside `CREATE TABLE`, or later in `ALTER TABLE ... ADD CONSTRAINT` (what
  `pg_dump` does). Composite keys stay **one** relationship; `ON DELETE` / `ON UPDATE` actions are kept.
- **Relationships between the tables:** each foreign key, **one-to-one** when the key column is also unique, and **junction
  tables** as **many-to-many**. A warehouse with **no declared keys** (ClickHouse, Snowflake, BigQuery exports) gets the
  **inferred** candidates, clearly marked.
- **Comments:** `COMMENT ON TABLE / COLUMN` (PostgreSQL), `COMMENT '...'` (MySQL, MariaDB, ClickHouse).
- **Enum types:** their labels are listed with the column, not mixed into the type.
- **Views**, with their SQL (never their results).
- **The rows**, when the dump has them: `INSERT` (one row or many per statement, with or without column names), PostgreSQL
  `COPY ... FROM stdin` blocks (text and CSV), and the usual ways of writing text: doubled quotes, `\n` escapes, `E'...'`,
  `$$...$$`, `unistr()`, `char(10)`, `0x...` binary values.

Recognised dialects: **PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite, ClickHouse**, and generic SQL (for example a
DuckDB `EXPORT DATABASE`). The dialect is detected from the file and written in the prompt.

## The best file to give

- **A dump made by the database's own export tool** (see the table below).
- **A schema-only dump** when the structure is what matters: small, fast, and naturally suited to
  [Do not share data](../no-share.md). It already holds every key and relationship.
- A dump **with the data** when you want the AI to see rows too.

## How to get it

| Database | Structure and data | Structure only |
|---|---|---|
| PostgreSQL | `pg_dump mydb > dump.sql` | `pg_dump --schema-only mydb > schema.sql` |
| MySQL | `mysqldump mydb > dump.sql` | `mysqldump --no-data mydb > schema.sql` |
| MariaDB | `mariadb-dump mydb > dump.sql` | `mariadb-dump --no-data mydb > schema.sql` |
| SQLite | `sqlite3 data.db .dump > dump.sql` | `sqlite3 data.db .schema > schema.sql` |
| DuckDB | `EXPORT DATABASE 'folder'` (give `schema.sql`) | the same: `schema.sql` holds the structure |
| ClickHouse | `SHOW CREATE TABLE t` for each table | the same (ClickHouse has no foreign keys) |

Never put a password on a command line: use your tool's password file or environment variable.

## Good to know

- **Nothing is executed.** A statement like `SELECT pg_sleep(10)` or a value like `load_file('/etc/passwd')` stays plain text;
  DataBrief only reads the text of the file. Procedures, functions and triggers are **not read** and are listed as such.
- **Large dumps:** only the **first 250,000 rows of each table** are kept; the **row counts stay exact** and the prompt says
  how many rows were read. The statistics of such a table describe the rows read, and the prompt says so.
- **Data in other files** (DuckDB's `EXPORT DATABASE` writes a CSV or Parquet file per table) is **not read** when you drop
  `schema.sql` / `load.sql` alone: the file names are listed. To get the rows too, zip the exported folder and drop the zip
  ([DuckDB exports](duckdb.md)).
- **`INSERT ... SELECT`** has no values to read and is skipped. A table whose `CREATE TABLE` is missing gets numbered columns.
- **Binary values** become `[binary N bytes]`.
- **SQL Server** scripts (`GO` batches, `[brackets]`) and **Oracle** scripts are read from their structure; they are less
  tested than the engines above because no real dump could be generated for them here.

## With "Do not share data"

A schema-only dump is an ideal case: the AI gets the **whole schema** and can plan queries and analyses without any record.

- **Names:** table, column, index and view names can be replaced by neutral names; relationships keep their shape. **Custom
  type names** (a PostgreSQL enum, an Oracle object type) are names too and are replaced by `custom_type`.
- **Never included:** the rows, whatever the level.
- **Only when you allow it:** the original `CREATE TABLE` and the views' SQL (they can hold literal values: a default of
  `'Smith'`, a view that filters on a name), and **table comments** (free text written by people).
- **Labels** (column comments, enum labels) follow the "labels" switch.
- **Data in other files:** their names count as names.

See [the guide to this mode](../no-share.md).

## See also

[PostgreSQL archives](pgdump.md) · [DuckDB exports](duckdb.md) · [SQLite](sqlite.md) · [Parquet](parquet.md) · [CSV](csv.md)
