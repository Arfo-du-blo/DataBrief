# Parquet

Parquet is the standard format of data engineering: typed, compressed, often nested. DataBrief reads the **schema in full**, not just the values.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **Every field with its own type**, nested ones included:
  - physical and logical types (`INT64`, `BYTE_ARRAY / STRING`, `INT32 / DATE`, `INT64 / TIMESTAMP (MICROS, UTC)`, `FIXED_LEN_BYTE_ARRAY / DECIMAL (12,3)`);
  - nested types written out: `STRUCT<…>`, `LIST<…>`, `MAP<key, value>`;
  - **required** fields (shown as "not null").
- **Columns follow the schema:** the leaves of structs become columns (`geo.lat`, `geo.meta.src`); a **list or a map is one JSON column**; a null struct adds no stray column.
- **File layout:** the number of **row groups** and their sizes, and the **compression codecs**.
- **Metadata:** the producer (`created_by`), your own key/value metadata, and the **pandas metadata** (index, column types) summarised.
- **Compression:** uncompressed, Snappy, Gzip, Zstd and LZ4 (raw).

## The best file to give

- A single Parquet file written by **pandas, Spark or DuckDB**, compressed with **Snappy or Zstd**.

## How to get it

| From | How |
|---|---|
| Python (pandas) | `df.to_parquet("data.parquet")` |
| DuckDB | `COPY (SELECT ...) TO 'data.parquet' (FORMAT PARQUET)` |
| Spark | `df.write.parquet("path")` then give one part file |
| BigQuery, Snowflake, Redshift | export a table to Parquet, then give one file |

## Good to know

- **Brotli** and **Hadoop-LZ4** compression are not supported (the error says which).
- **Decimals** are read as numbers: `10.500` is shown as `10.5` (trailing zeros are not kept); the type line still says `DECIMAL (12,3)`.
- **64-bit integers** are exact. Timestamps are shown as ISO text.
- **One file at a time:** partitioned datasets (a folder of files) are not read yet.
- The **whole file is read into memory**, so very large files may be slow.
- Statistics stored in the file (minimum, maximum, null counts) are not used yet.

## With "Do not share data"

Names, **full types** (struct field names are replaced along with the other names when names are not shared), counts and, if allowed, summaries. The **key/value metadata** (including the pandas metadata, which lists the columns) is free text: it is left out unless you allow free text, and also when names are not shared. See [the guide to this mode](../no-share.md).

## See also

[SPSS](spss.md) · [CSV](csv.md) · [SQLite](sqlite.md)
