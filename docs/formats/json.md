# JSON and NDJSON

JSON is a tree, DataBrief's model is a set of tables. This guide explains how the tree becomes tables, and how to shape a file so the result is the one you expect.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **`.json`** (one document) and **`.ndjson` / `.jsonl`** (one JSON object per line). A `.json` file that is really one object per line is recognised too.
- **Record lists at any depth become sections.** `{"customers": [...], "orders": [...]}` gives two sections, named by their path (`customers`, `orders`); a list at `data.items` is the section `data.items`. Up to 6 levels deep.
- **Fields of the root** that are not lists are gathered in a section called `(root)`.
- **Nested objects become columns named `a.b.c`** (`address.city`). The prompt says columns come from flattened data.
- **Lists inside a record stay as JSON text** in their cell (`["vip","eu"]`).
- A list of plain values (`["a","b"]`) becomes a one-column section.
- A top-level object whose values are all objects (`{"alice": {...}, "bob": {...}}`) becomes records with a `_key` column.

## The best file to give

- **An array of records** (`[{...}, {...}]`) or **NDJSON**, with **the same keys in every record**.
- Keep **identifiers as values, not as keys**: `{"id": "alice@x.com", "score": 3}` is better than `{"alice@x.com": 3}` (see below).

## How to get it

| From | How |
|---|---|
| Python (pandas) | `df.to_json("data.json", orient="records", force_ascii=False)` or `lines=True` for NDJSON |
| jq | `jq -c '.[]' data.json > data.ndjson` |
| A database / API | export or save the response as is |

## Good to know

- A `.json` file that holds **GeoJSON** (a `FeatureCollection`, a `Feature` or a geometry) is recognised by its content and
  read as geodata: one row per feature, the geometry summarised. See [Geodata](geodata.md).
- A `.json` file that holds a **Jupyter notebook** (`nbformat` and `cells`) is read as a notebook: the tables of its outputs
  and its cells. See [Notebooks](notebook.md).

- **`null`, a missing field and an empty string all become an empty cell.** The prompt says an empty cell means "missing". Records with different keys give the union of the keys, with empty cells where a key is absent.
- **Integers above 2^53** (9,007,199,254,740,992) may lose precision: JSON numbers are read as floating-point numbers. If you have very large identifiers, write them as strings.
- **An object whose keys are data** (a map of e-mail addresses to scores) makes **one column per key**: that is rarely what you want. Prefer a list of `{"email": ..., "score": ...}` records.
- Lists of objects inside a record are not split into their own section; they stay as JSON text. If you want a table, put them at the top level.
- The data is read entirely into memory.

## With "Do not share data"

The prompt lists the sections and columns (the names come from the **keys**), the types and the counts. Because a key can itself be a value, **keys that look like values** (an e-mail, a number, an identifier, a date, or a very long string) are replaced by `key`, and the prompt says some names were replaced. No value is included. See [the guide to this mode](../no-share.md).

## See also

[YAML](yaml.md) · [XML](xml.md) · [CSV](csv.md)
