# XML

XML is read with the browser's own parser and turned into tables the same way as [JSON](json.md).

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **Repeated elements become records** (one row each) and form a section, found at any depth.
- **Attributes** become columns prefixed with `@` (`@id`, `price.@currency`); the **text** of an element that also has attributes or children becomes `#text`.
- **Nested elements** become columns named `a.b.c`.
- The **root element** is named in the overview of the prompt.
- The prompt explains the `@` and `#text` conventions when they are used.

## The best file to give

- A **flat list of repeated elements, one per record**, with a consistent structure:
  ```xml
  <catalog>
    <book id="1"><title>Dune</title><price currency="EUR">9.5</price></book>
    <book id="2"><title>Emma</title><price currency="EUR">7</price></book>
  </catalog>
  ```
- Declared **encoding** (`<?xml version="1.0" encoding="UTF-8"?>`).

## How to get it

Most tools can export XML: databases (`FOR XML` in SQL Server, `xmlelement` in PostgreSQL), spreadsheets (Excel XML), APIs. If you can choose, prefer [JSON](json.md) or [CSV](csv.md), which are simpler.

## Good to know

- **Namespaces** keep their prefix in names (`ns:item`); the namespace addresses are not listed.
- **Comments and processing instructions** are dropped.
- **Mixed content** (text between child elements) is collapsed into `#text`.
- An element with the same name repeated makes a list; **lists of objects inside a record stay as JSON text**.
- **Invalid XML** is reported with the parser's message.
- The file is read entirely into memory.

## With "Do not share data"

Element and attribute names are the column names; the **root element name** is a name too and is replaced when names are not shared. Values are never included. See [the guide to this mode](../no-share.md).

## See also

[JSON](json.md) · [YAML](yaml.md) · [HTML tables](html.md)
