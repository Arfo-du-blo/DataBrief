# Export your database for DataBrief

DataBrief never connects to a database. You export a file with your database's own tool, then drop that file on the page.
The same commands are in the page itself (**How do I export my database?**, under the list of formats), with a Copy button.

[← Back to the README](../README.md)

## What to give

| You want | Give | Why |
|---|---|---|
| The AI to understand your tables and how they connect, **without any record** | **The structure only** (a schema-only dump, a `.dacpac`, a `.schema`) | Small, fast, and the natural file for [Do not share data](no-share.md). It holds every key and relationship. |
| The AI to see the rows too | **Structure and data** (a full dump, the database file itself, or one CSV per table) | Rows are read up to 250,000 per table; the counts stay exact. |
| Relationships that your database does not declare (warehouses, ClickHouse, old systems) | Nothing special | DataBrief infers likely relationships from column names and values, and marks them **inferred**. Command 3 below lists the declared foreign keys as a table if you want them in the prompt as well. |

**Rules that apply everywhere**

- **Every command only reads.** None of them changes your database. Run them on a copy first if you are unsure.
- **Never type a password inside a command** (it stays in your shell history and is visible to other users). Let the tool ask
  for it, or use its own password file or an environment variable.
- Replace the example names `localhost`, `myuser`, `mydb` and `customers` with yours.
- **What "tested" means below:** the commands were run against a real server in a container, on a small database, and the
  files they wrote were read by DataBrief's own readers. **"Not tested"** means the commands come from the official
  documentation and were **not** run here: try them on a copy first.
- Documentation links were checked on **2026-11-01**. Two sites (MySQL, IBM) refuse automated requests, so their links could not be
  checked by a script.

## PostgreSQL — tested (PostgreSQL 16)

[Official documentation](https://www.postgresql.org/docs/current/app-pgdump.html)

```
# 1. structure only
pg_dump --schema-only --no-owner --no-privileges -h localhost -U myuser -d mydb -f schema.sql
# 2. structure and data
pg_dump --no-owner --no-privileges -h localhost -U myuser -d mydb -f dump.sql
```

`pg_dump -Fc ... -f mydb.dump` (a compressed archive) is also read: see [PostgreSQL archives](formats/pgdump.md).
The password is asked for, or taken from `~/.pgpass` / `PGPASSFILE`.

## MySQL — tested (MySQL 8.4)

[Official documentation](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html) (blocks automated checks)

```
mysqldump --no-data -h localhost -u myuser -p mydb > schema.sql
mysqldump --single-transaction -h localhost -u myuser -p mydb > dump.sql
```

`-p` with nothing after it makes `mysqldump` **ask** for the password.

## MariaDB — tested (MariaDB 11.8)

[Official documentation](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)

```
mariadb-dump --no-data -h localhost -u myuser -p mydb > schema.sql
mariadb-dump --single-transaction -h localhost -u myuser -p mydb > dump.sql
```

Older versions call the tool `mysqldump`.

## SQL Server — not tested

[Official documentation](https://learn.microsoft.com/en-us/sql/tools/sqlpackage/sqlpackage-extract)

```
sqlpackage /Action:Extract /SourceConnectionString:"Server=localhost;Database=mydb;Integrated Security=True;TrustServerCertificate=True" /TargetFile:schema.dacpac
sqlcmd -S localhost -d mydb -E -C -W -s "," -Q "SET NOCOUNT ON; SELECT * FROM dbo.customers" -o customers.csv
```

- The **`.dacpac`** is the schema: give it as it is ([`.dacpac`](formats/dacpac.md)). In SQL Server Management Studio:
  *Tasks, Extract Data-tier Application*. A `.bak` backup cannot be read.
- `sqlcmd -W` writes a second line made of dashes under the header: delete it from the CSV.
- With SQL authentication, `sqlpackage` and `sqlcmd` ask for the password if you leave it out (`sqlcmd -U myuser` without `-P`).
- For the rows as a script: SQL Server Management Studio, *Tasks, Generate Scripts*, with *Types of data to script* set to
  *Schema and data*, gives a `.sql` file that DataBrief reads.

## Oracle — not tested

[Official documentation](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_METADATA.html)

```
sqlplus -S myuser@//localhost:1521/MYSERVICE <<'EOF' > schema.sql
SET LONG 1000000 PAGESIZE 0 LINESIZE 32767 TRIMSPOOL ON FEEDBACK OFF
EXEC DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);
SELECT DBMS_METADATA.GET_DDL('TABLE', table_name) FROM user_tables;
SELECT DBMS_METADATA.GET_DDL('REF_CONSTRAINT', constraint_name) FROM user_constraints WHERE constraint_type = 'R';
EOF
```

`sqlplus` asks for the password when it is not in the connection string. The Data Pump `.dmp` file cannot be read.
SQL Developer can also write the DDL (*Tools, Database Export*).

## DuckDB — SQL tested (DuckDB 1.5), command line not tested

[Official documentation](https://duckdb.org/docs/stable/sql/statements/export)

```
duckdb mydb.duckdb -noheader -list -c "SELECT sql || ';' FROM duckdb_tables() UNION ALL SELECT sql FROM duckdb_views() WHERE NOT internal" > schema.sql
duckdb mydb.duckdb -c "EXPORT DATABASE 'export'"
zip -r export.zip export
```

Give `schema.sql`, or the zip of the exported folder ([DuckDB exports](formats/duckdb.md)). The `.duckdb` file itself cannot be read.
The SQL of these commands was run with DuckDB 1.5 through its Python package, and the files read by DataBrief; DuckDB's
command-line program itself was **not** available here, so its options (`-noheader`, `-list`, `-csv`, `-c`) come from the
documentation. The page therefore shows this engine as "not run here".

## SQLite — tested (SQLite 3.53)

[Official documentation](https://www.sqlite.org/cli.html)

```
sqlite3 mydb.sqlite ".schema" > schema.sql
sqlite3 mydb.sqlite ".dump" > dump.sql
```

You can also give the **`.sqlite` file itself** ([SQLite](formats/sqlite.md)).

## Microsoft Access — nothing to run

[Official documentation](https://support.microsoft.com/en-us/access)

Give the **`.accdb` or `.mdb` file itself** (a copy, made while Access is closed): DataBrief reads the tables, the rows and
the relationships Access stores ([Access](formats/access.md)). For a database split into a front end and a back end, give the
back end.

## IBM Db2 — not tested

[Official documentation](https://www.ibm.com/docs/en/db2/11.5?topic=commands-db2look-db2-statistics-ddl-extraction-tool) (blocks automated checks)

```
db2look -d MYDB -e -o schema.sql
db2 "EXPORT TO customers.csv OF DEL MODIFIED BY COLDEL, SELECT * FROM myschema.customers"
```

## Snowflake — not tested

[Official documentation](https://docs.snowflake.com/en/sql-reference/functions/get_ddl)

```
snowsql -q "SELECT GET_DDL('SCHEMA', 'MYDB.MYSCHEMA')" -o output_format=plain -o header=false -o timing=false -o friendly=false > schema.sql
snowsql -q "SELECT * FROM mydb.myschema.customers" -o output_format=csv -o header=true -o timing=false -o friendly=false > customers.csv
```

Snowflake records primary and foreign keys but **does not enforce** them. They are still read as declared relationships.

## Google BigQuery — not tested

[Official documentation](https://docs.cloud.google.com/bigquery/docs/information-schema-tables)

```
bq query --nouse_legacy_sql --format=json "SELECT ddl FROM mydataset.INFORMATION_SCHEMA.TABLES WHERE table_type = 'BASE TABLE'" | jq -r '.[].ddl' > schema.sql
bq query --nouse_legacy_sql --format=csv --max_rows=1000000 "SELECT * FROM mydataset.customers" > customers.csv
```

The first command needs `jq`. BigQuery's key constraints are informational (not enforced).

## Amazon Redshift — not tested

[Official documentation](https://docs.aws.amazon.com/redshift/latest/dg/r_SHOW_TABLE.html)

```
psql -h mycluster.example.us-east-1.redshift.amazonaws.com -p 5439 -U myuser -d mydb -At -c "SHOW TABLE public.customers" > schema.sql
psql -h mycluster.example.us-east-1.redshift.amazonaws.com -p 5439 -U myuser -d mydb --csv -c "SELECT * FROM public.customers" > customers.csv
```

`SHOW TABLE` writes **one table** per command: repeat it for each table, or use AWS's admin views. Redshift records keys
without enforcing them. To write the whole table to files, `UNLOAD` to Amazon S3 is the usual way.

## ClickHouse — tested (ClickHouse 26.10)

[Official documentation](https://clickhouse.com/docs/reference/statements/show)

```
clickhouse-client --host localhost --user myuser --password --query "SELECT concat(create_table_query, ';') FROM system.tables WHERE database = 'mydb' ORDER BY name FORMAT TSVRaw" > schema.sql
clickhouse-client --host localhost --user myuser --password --query "SELECT * FROM mydb.customers FORMAT CSVWithNames" > customers.csv
```

`--password` with nothing after it makes the client **ask**. ClickHouse has **no foreign keys**: the relationships DataBrief
shows are inferred from the names and values, and marked as such.

## The foreign keys as a table (command 3)

The page also offers, for each engine that has foreign keys, a query that lists them as a small table
(`table_name, column_name, referenced_table, referenced_column`). It is **optional**: the declared keys are already in the
schema export. Give the result next to the other file when you want the AI to have the relationships spelled out, or for a
system whose schema export leaves the keys out.

## How the tested commands were checked

`tests/test_export_commands.sh` starts each engine in a container (PostgreSQL 16.11, MySQL 8.4.13, MariaDB 11.8.9,
ClickHouse 26.10.3, SQLite 3.53.4), loads the same small "shop" database, runs **the command text of the page** as an ordinary
user, and gives the files they write to DataBrief's reader (the tables, the row counts and the six declared relationships
must come out, and the foreign-key query must list each of them). The only change is the password: where you would type
it at a prompt, the test passes it in an environment variable. It needs Docker and is not part of the continuous tests; see
`tests/sql-fixtures/README.md` for the "shop" database.
