# YAML

YAML is read like [JSON](json.md): lists of mappings become tables.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **`.yaml` and `.yml`**, one document or several.
- **Lists of mappings** (records) at any depth become sections; **nested mappings** become columns named `a.b.c`; **lists inside a record** stay as JSON text.
- **Several documents** (separated by `---`) become **one row each**, in the order of the file, and the prompt says so. This is the usual shape of Kubernetes manifests.
- **Dates** written as YAML timestamps are shown as ISO dates.

## The best file to give

- **A list of mappings with the same keys:**
  ```yaml
  - name: Ana
    team: data
  - name: Ben
    team: ops
  ```
- Or **one document per record**, separated by `---`.

## Good to know

- **Anchors and aliases** (`&base`, `*base`) are resolved before reading.
- **Nothing in the file is ever run**: YAML tags that could build objects or run code are not interpreted.
- **A document without a list of records** becomes a single row (its fields as columns).
- **Integers above 2^53** may lose precision, as in JSON; quote very large identifiers.
- Missing keys give empty cells (the union of the keys is used).
- The file is read entirely into memory.

## With "Do not share data"

Keys are the column names; **keys that look like values** are replaced by `key` (see [JSON](json.md#with-do-not-share-data)). No value is included. See [the guide to this mode](../no-share.md).

## See also

[JSON](json.md) · [XML](xml.md) · [CSV](csv.md)
