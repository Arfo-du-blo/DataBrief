# Apache Avro (.avro)

**Avro** is a row-oriented data format with its schema stored in the file: Kafka (Kafka Connect, the Schema Registry), Spark,
Hive, Flink and many data pipelines write it. An `.avro` data file (an *object container file*) holds the schema, then the
records in blocks, often compressed.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **Every record**, with the **columns of the schema**, in order (even a column that is empty everywhere).
- **The type of each column**, from the schema: `long`, `string`, `enum`, `date`, `decimal(9,2)`, `nullable string`,
  `array<string>`, `map<boolean>`, `timestamp-millis (UTC)`… Fields that cannot be null are marked as required.
- **Nested records are flattened** into columns (`address.city`, `address.zip`), also when the record itself can be null.
  Arrays, maps and unions of several types are one column of JSON text.
- **Values as people read them:** decimals with their scale (`10.50`), dates (`2023-01-05`), timestamps (`2025-01-01
  09:30:00`, in UTC), times, UUIDs; bytes in hexadecimal.
- **Enum symbols** as the column's value labels (`PT, CN, FR, IE`).
- The **documentation** written in the schema: the record's (as a table description) and each field's (as a label).
- The **record name** (`shop.Customer`), the compression, and the metadata the writer added (other than the schema; keys that name a person or a team, such as `owner` or `author`, are left out).
- Compression: none, **deflate**, **snappy** and **Zstandard**.

## The best file to give

- The `.avro` data file itself. From Kafka, a consumer or Kafka Connect's file sink; from Spark,
  `df.write.format("avro").save(...)`; from Python, `fastavro.writer(...)`; from the command line, `avro-tools`.
- A **schema alone** (`.avsc`, JSON) holds no data. Give a data file instead.
- Single Kafka messages in the "Confluent wire format" (a schema id and one record, without the schema) are not Avro files.

## Good to know

- Only the **first 250,000 records** are kept; the record count stays exact (counted from the block headers, without
  decoding the rest).
- **bzip2** and **xz** compression are not read: the page says so.
- A **damaged** file is read up to the damaged block, and the prompt says where the reading stopped.
- Timestamps are shown in **UTC** (the Avro way of storing them); `local-timestamp` values are shown as written.

## With "Do not share data"

Records are never included. The **record name** and the field names are names (replaced by neutral names when names are
not shared). The **documentation** of the record is free text, shown only when you allow it; the documentation of a field
and the **enum symbols** are labels (they can be switched off). The writer's metadata counts as free text and names.
