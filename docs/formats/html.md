# HTML pages and tables

Give DataBrief a saved web page, a report or an HTML export. It extracts **every table** as its own section, and reads
**the page itself as a document**: its title, description, headings, paragraphs and lists, in order, with each table where it stands.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

**The tables are the data:**

- **Every `<table>` of the page**, each as a section.
- **The name of a table** comes from its `<caption>`, then its `aria-label`, `id` or `summary` attribute, otherwise `table_1`, `table_2`…
- **Header rows:** the `<thead>` rows, or the leading rows made only of `<th>` cells (up to three). **Several header rows are joined** (`Sales / Q1`).
- **Merged cells** (`colspan`, `rowspan`) are **expanded**: the value is repeated in every cell it covers, and the prompt says so.
- Line breaks (`<br>`) inside cells are kept; the table caption is shown.

**Everything else is context**, in a *Document contents* part of the prompt, as for a Word document:

- **The headings** (`<h1>` to `<h6>`, with their level), **the paragraphs and the list items**, in order, with the place of each table.
- **The page's properties:** its `<title>`, its description and keywords (`<meta name="description">`, `"keywords"`) and the program
  that generated it (`"generator"`). **Never the author** (`<meta name="author">`): who wrote a page is not shown.
- **Left out:** navigation (`<nav>`), side bars (`<aside>`), footers, forms and buttons, scripts, styles, images, video, frames,
  SVG and anything inside `<template>` or `<noscript>`. They are menus and decoration, not content.

A page **without any table** is read as a document too: its text is the content.

## The best file to give

- A page whose tables use **`<th>` for the header cells** and a **`<caption>` for the title**, and whose text is in real
  paragraphs and headings.
- To keep a web page: **Save As → "Webpage, HTML only"** in your browser. (A page that builds its content with scripts holds
  none of it when saved: the saved file is what the page looked like before the scripts ran.)

## How to get it

| From | How |
|---|---|
| A web page | browser **Save As… → HTML** |
| Excel | **Save As → Web Page (.htm)** |
| Python (pandas) | `df.to_html("table.html", index=False)` |
| R | `knitr::kable(df, format = "html")` saved to a file |

## Good to know

- **Tables that contain other tables** (old-style page layout) are **read as text, not as data**: only the innermost tables
  are data. The prompt says how many were read as text.
- **Scripts are never run, styles are ignored and images are never loaded.**
- Numbers are text in HTML: the detected column type is based on what the cells look like.
- The text is cut after about 200,000 characters (the prompt says how much was left out).
- The file is read entirely into memory.
- The [command-line tool](../cli.md) reads HTML with the same algorithm as a browser (parse5); a page nested more than 5000
  levels deep is refused there (the page reads it).

## With "Do not share data"

The **tables** are described by their structure (column names and the number of rows); no cell value is included. A table
named by its **caption, label or summary** is a piece of free text: its name is replaced (`table_1`) when labels are not
shared. The **text of the page** (headings, paragraphs, lists) and its **title, description and keywords** are free text:
included only when you allow *Comments, notes and other free text*. Without it, the prompt keeps only the outline: the level
of each heading, how many paragraphs, and where each table is. See [the guide to this mode](../no-share.md).

## See also

[Word and PowerPoint](documents.md) · [XML](xml.md) · [CSV](csv.md) · [Excel](excel.md)
