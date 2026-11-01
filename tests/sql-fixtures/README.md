# SQL dump fixtures

Real dumps of one small "shop" database, written by the engines' **own tools** (not by hand), so the parsers are tested
on what people really have. They are committed so the tests do not need Docker.

- `src/`: the source database, one file per SQL dialect (same data: 6 customers, 4 products, 5 orders...).
- `expected.json`: what the parser must find (tables, columns, keys, declared relationships, row counts). Written by hand
  from the sources, never from the parser.
- `VERSIONS.txt`: the tool versions that produced each dump.
- Regenerate everything with `tests/make_sql_fixtures.sh` (needs Docker; pulls the images, removes what it pulled).
  `ONLY=mysql8,duckdb bash tests/make_sql_fixtures.sh` regenerates only some parts.

| Files | Tool | What they exercise |
|---|---|---|
| `pg13-*`, `pg16-*`, `pg17-*` `-default.sql` | `pg_dump` | `COPY ... FROM stdin` data, foreign keys in `ALTER TABLE ... ADD CONSTRAINT`, sequences, `COMMENT ON`, enum type, `jsonb`, arrays; PostgreSQL 17 adds `\restrict` lines |
| `-inserts.sql`, `-column-inserts.sql`, `-schema-only.sql`, `-data-only.sql` | `pg_dump` | the other text modes |
| `pg*-custom*.dump`, `pg*-tar.tar` | `pg_dump -Fc` / `-Ft` | binary archives (stage 11): gzip, none, and zstd / lz4 (16+) |
| `mysql8-*`, `mariadb11-*` | `mysqldump`, `mariadb-dump` | inline `CONSTRAINT ... FOREIGN KEY`, backticks, multi-row `INSERT`, `\n` escapes, generated column, `ENUM`, `JSON`; version comments (`/*!40101 ... */`, `/*M!999999\- ... */`) |
| `sqlite-dump.sql` | `sqlite3` `.dump` text | `BEGIN TRANSACTION`, inline `REFERENCES`, `char(10)` for newlines |
| `duckdb-export-csv/`, `duckdb-export-parquet/` | `EXPORT DATABASE` | `schema.sql` + `load.sql` (`COPY ... FROM 'file'`) + data files |
| `clickhouse-*` | `SHOW CREATE TABLE`, `FORMAT SQLInsert` | no foreign keys at all; `Nullable`, `Enum8`, `Array` types |

The data holds the same canary values as the "Do not share data" tests (`CONFIDENTIAL_CUSTOMER_74291`...), so the
no-share suite can prove that nothing leaks from a SQL dump.

Notes:
- These files are stored byte for byte (`-text` in `.gitattributes`): no line-ending conversion, on any computer.
- The generator needs Docker and internet. A start-up can occasionally time out; rerun just that part with `ONLY=<name>`.
- Nothing personal is kept: DuckDB's export is written with relative paths, the passwords are throw-away values of
  containers that publish no port, and the dumps contain no host name.
