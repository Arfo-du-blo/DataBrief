/* DataBrief - the "how do I export my database?" helper. GPL-3.0-or-later.
 *
 * For each common database engine: read-only commands that write (1) the structure, (2) the structure and the data, (3) the
 * foreign keys as a table. DataBrief never connects to a database and never runs these commands: it only shows them, and the
 * user runs them. No password is ever written in a command (the tool asks, or uses its own password file or environment variable).
 *
 * tested: the engine and version the commands were run against, with their real output given to DataBrief's own readers
 *         (tests/test_export_commands.sh); '' = taken from the official documentation, NOT run here (the dialog says so).
 * fk:     'declared' (the engine enforces foreign keys), 'unenforced' (it records them without enforcing), 'none' (it has none).
 * file:   DataBrief can read the database file itself (the commands are then an alternative).
 * The example names (localhost, myuser, mydb, customers) are meant to be replaced by the user's own. */
'use strict';
(function () {
  const DB = window.DB;
  const FKQ_PG = "SELECT c.conrelid::regclass AS table_name, a.attname AS column_name, c.confrelid::regclass AS referenced_table, af.attname AS referenced_column " +
    "FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(attnum, fattnum) " +
    "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = k.fattnum " +
    "WHERE c.contype = 'f' ORDER BY 1, 2";
  const FKQ_MYSQL = "SELECT table_name, column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage " +
    "WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL ORDER BY table_name, constraint_name, ordinal_position";

  DB.EXPORT_ENGINES = [
    {
      key: 'postgresql', label: 'PostgreSQL', tested: 'PostgreSQL 16', fk: 'declared', file: false,
      docs: 'https://www.postgresql.org/docs/current/app-pgdump.html',
      schema: 'pg_dump --schema-only --no-owner --no-privileges -h localhost -U myuser -d mydb -f schema.sql',
      full: 'pg_dump --no-owner --no-privileges -h localhost -U myuser -d mydb -f dump.sql',
      fks: 'psql -h localhost -U myuser -d mydb --csv -c "' + FKQ_PG + '" > foreign_keys.csv',
    },
    {
      key: 'mysql', label: 'MySQL', tested: 'MySQL 8.4', fk: 'declared', file: false,
      docs: 'https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html',
      schema: 'mysqldump --no-data -h localhost -u myuser -p mydb > schema.sql',
      full: 'mysqldump --single-transaction -h localhost -u myuser -p mydb > dump.sql',
      fks: 'mysql -h localhost -u myuser -p --batch --raw mydb -e "' + FKQ_MYSQL + '" > foreign_keys.tsv',
    },
    {
      key: 'mariadb', label: 'MariaDB', tested: 'MariaDB 11.8', fk: 'declared', file: false,
      docs: 'https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump',
      schema: 'mariadb-dump --no-data -h localhost -u myuser -p mydb > schema.sql',
      full: 'mariadb-dump --single-transaction -h localhost -u myuser -p mydb > dump.sql',
      fks: 'mariadb -h localhost -u myuser -p --batch --raw mydb -e "' + FKQ_MYSQL + '" > foreign_keys.tsv',
    },
    {
      key: 'sqlserver', label: 'SQL Server', tested: '', fk: 'declared', file: false,
      docs: 'https://learn.microsoft.com/en-us/sql/tools/sqlpackage/sqlpackage-extract',
      schema: 'sqlpackage /Action:Extract /SourceConnectionString:"Server=localhost;Database=mydb;Integrated Security=True;TrustServerCertificate=True" /TargetFile:schema.dacpac',
      full: 'sqlcmd -S localhost -d mydb -E -C -W -s "," -Q "SET NOCOUNT ON; SELECT * FROM dbo.customers" -o customers.csv',
      fks: 'sqlcmd -S localhost -d mydb -E -C -W -s "," -Q "SET NOCOUNT ON; SELECT OBJECT_NAME(fkc.parent_object_id) AS table_name, pc.name AS column_name, ' +
        'OBJECT_NAME(fkc.referenced_object_id) AS referenced_table, rc.name AS referenced_column FROM sys.foreign_key_columns fkc ' +
        'JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id ' +
        'JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id ' +
        'ORDER BY 1, fkc.constraint_object_id, fkc.constraint_column_id" -o foreign_keys.csv',
    },
    {
      key: 'oracle', label: 'Oracle', tested: '', fk: 'declared', file: false,
      docs: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_METADATA.html',
      schema: "sqlplus -S myuser@//localhost:1521/MYSERVICE <<'EOF' > schema.sql\n" +
        "SET LONG 1000000 PAGESIZE 0 LINESIZE 32767 TRIMSPOOL ON FEEDBACK OFF\n" +
        "EXEC DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);\n" +
        "SELECT DBMS_METADATA.GET_DDL('TABLE', table_name) FROM user_tables;\n" +
        "SELECT DBMS_METADATA.GET_DDL('REF_CONSTRAINT', constraint_name) FROM user_constraints WHERE constraint_type = 'R';\n" +
        "EOF",
      full: "sqlplus -S myuser@//localhost:1521/MYSERVICE <<'EOF' > customers.csv\n" +
        "SET MARKUP CSV ON QUOTE ON\nSET FEEDBACK OFF\nSELECT * FROM customers;\nEOF",
      fks: "sqlplus -S myuser@//localhost:1521/MYSERVICE <<'EOF' > foreign_keys.csv\n" +
        "SET MARKUP CSV ON QUOTE ON\nSET FEEDBACK OFF\n" +
        "SELECT a.table_name, a.column_name, c_pk.table_name AS referenced_table, b.column_name AS referenced_column FROM user_constraints c " +
        "JOIN user_cons_columns a ON a.constraint_name = c.constraint_name JOIN user_constraints c_pk ON c_pk.constraint_name = c.r_constraint_name " +
        "JOIN user_cons_columns b ON b.constraint_name = c_pk.constraint_name AND b.position = a.position WHERE c.constraint_type = 'R' " +
        "ORDER BY a.table_name, c.constraint_name, a.position;\nEOF",
    },
    {
      key: 'duckdb', label: 'DuckDB', tested: '', fk: 'declared', file: false,
      docs: 'https://duckdb.org/docs/stable/sql/statements/export',
      schema: 'duckdb mydb.duckdb -noheader -list -c "SELECT sql || \';\' FROM duckdb_tables() UNION ALL SELECT sql FROM duckdb_views() WHERE NOT internal" > schema.sql',
      full: "duckdb mydb.duckdb -c \"EXPORT DATABASE 'export'\"\nzip -r export.zip export",
      fks: 'duckdb mydb.duckdb -csv -c "SELECT table_name, constraint_column_names, referenced_table, referenced_column_names FROM duckdb_constraints() WHERE constraint_type = \'FOREIGN KEY\'" > foreign_keys.csv',
    },
    {
      key: 'sqlite', label: 'SQLite', tested: 'SQLite 3.53', fk: 'declared', file: true,
      docs: 'https://www.sqlite.org/cli.html',
      schema: 'sqlite3 mydb.sqlite ".schema" > schema.sql',
      full: 'sqlite3 mydb.sqlite ".dump" > dump.sql',
      fks: 'sqlite3 -header -csv mydb.sqlite "SELECT m.name AS table_name, f.\\"from\\" AS column_name, f.\\"table\\" AS referenced_table, f.\\"to\\" AS referenced_column FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = \'table\'" > foreign_keys.csv',
    },
    {
      key: 'access', label: 'Microsoft Access', tested: '', fk: 'declared', file: true,
      docs: 'https://support.microsoft.com/en-us/access',
      schema: '', full: '', fks: '',
    },
    {
      key: 'db2', label: 'IBM Db2', tested: '', fk: 'declared', file: false,
      docs: 'https://www.ibm.com/docs/en/db2/11.5?topic=commands-db2look-db2-statistics-ddl-extraction-tool',
      schema: 'db2look -d MYDB -e -o schema.sql',
      full: 'db2 "EXPORT TO customers.csv OF DEL MODIFIED BY COLDEL, SELECT * FROM myschema.customers"',
      fks: 'db2 -x "SELECT TABNAME, FK_COLNAMES, REFTABNAME, PK_COLNAMES FROM SYSCAT.REFERENCES" > foreign_keys.txt',
    },
    {
      key: 'snowflake', label: 'Snowflake', tested: '', fk: 'unenforced', file: false,
      docs: 'https://docs.snowflake.com/en/sql-reference/functions/get_ddl',
      schema: 'snowsql -q "SELECT GET_DDL(\'SCHEMA\', \'MYDB.MYSCHEMA\')" -o output_format=plain -o header=false -o timing=false -o friendly=false > schema.sql',
      full: 'snowsql -q "SELECT * FROM mydb.myschema.customers" -o output_format=csv -o header=true -o timing=false -o friendly=false > customers.csv',
      fks: 'snowsql -q "SHOW IMPORTED KEYS IN SCHEMA mydb.myschema" -o output_format=csv -o header=true -o timing=false -o friendly=false > foreign_keys.csv',
    },
    {
      key: 'bigquery', label: 'BigQuery', tested: '', fk: 'unenforced', file: false,
      docs: 'https://docs.cloud.google.com/bigquery/docs/information-schema-tables',
      schema: 'bq query --nouse_legacy_sql --format=json "SELECT ddl FROM mydataset.INFORMATION_SCHEMA.TABLES WHERE table_type = \'BASE TABLE\'" | jq -r \'.[].ddl\' > schema.sql',
      full: 'bq query --nouse_legacy_sql --format=csv --max_rows=1000000 "SELECT * FROM mydataset.customers" > customers.csv',
      fks: 'bq query --nouse_legacy_sql --format=csv "SELECT k.table_name, k.column_name, c.table_name AS referenced_table, c.column_name AS referenced_column ' +
        'FROM mydataset.INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN mydataset.INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE c ON c.constraint_name = k.constraint_name ' +
        'WHERE k.constraint_name IN (SELECT constraint_name FROM mydataset.INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE constraint_type = \'FOREIGN KEY\') ' +
        'AND c.table_name != k.table_name" > foreign_keys.csv',
    },
    {
      key: 'redshift', label: 'Amazon Redshift', tested: '', fk: 'unenforced', file: false,
      docs: 'https://docs.aws.amazon.com/redshift/latest/dg/r_SHOW_TABLE.html',
      schema: 'psql -h mycluster.example.us-east-1.redshift.amazonaws.com -p 5439 -U myuser -d mydb -At -c "SHOW TABLE public.customers" > schema.sql',
      full: 'psql -h mycluster.example.us-east-1.redshift.amazonaws.com -p 5439 -U myuser -d mydb --csv -c "SELECT * FROM public.customers" > customers.csv',
      fks: 'psql -h mycluster.example.us-east-1.redshift.amazonaws.com -p 5439 -U myuser -d mydb --csv -c "' + FKQ_PG + '" > foreign_keys.csv',
    },
    {
      key: 'clickhouse', label: 'ClickHouse', tested: 'ClickHouse 26.10', fk: 'none', file: false,
      docs: 'https://clickhouse.com/docs/reference/statements/show',
      schema: 'clickhouse-client --host localhost --user myuser --password --query "SELECT concat(create_table_query, \';\') FROM system.tables WHERE database = \'mydb\' ORDER BY name FORMAT TSVRaw" > schema.sql',
      full: 'clickhouse-client --host localhost --user myuser --password --query "SELECT * FROM mydb.customers FORMAT CSVWithNames" > customers.csv',
      fks: '',
    },
  ];
})();
