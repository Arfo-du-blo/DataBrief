# HTML tables

Give DataBrief a saved web page, a report or an HTML export, and it extracts **every table** as its own section.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **Every `<table>` of the page**, each as a section.
- **The name of a table** comes from its `<caption>`, then its `aria-label`, `id` or `summary` attribute, otherwise `table_1`, `table_2`…
- **Header rows:** the `<thead>` rows, or the leading rows made only of `<th>` cells (up to three). **Several header rows are joined** (`Sales / Q1`).
- **Merged cells** (`colspan`, `rowspan`) are **expanded**: the value is repeated in every cell it covers, and the prompt says so.
- Line breaks (`<br>`) inside cells are kept; the table caption is shown.

## The best file to give

- A page whose tables use **`<th>` for the header cells** and a **`<caption>` for the title**.
- To keep a web page: **Save As → "Webpage, HTML only"** in your browser.

## How to get it

| From | How |
|---|---|
| A web page | browser **Save As… → HTML** |
| Excel | **Save As → Web Page (.htm)** |
| Python (pandas) | `df.to_html("table.html", index=False)` |
| R | `knitr::kable(df, format = "html")` saved to a file |

## Good to know

- **Tables that contain other tables** (old-style page layout) are **skipped**; only the innermost tables are read. The prompt says how many were skipped.
- **Scripts are never run, styles are ignored and images are never loaded.** Script text inside a cell is not read.
- A page **without any `<table>`** gives an error ("no table found").
- Numbers are text in HTML: the detected column type is based on what the cells look like.
- The file is read entirely into memory.

## With "Do not share data"

Column names and the number of rows are described. A table named by its **caption, label or summary** is a piece of free text: its name is replaced (`table_1`) when labels are not shared. No cell value is included. See [the guide to this mode](../no-share.md).

## See also

[XML](xml.md) · [CSV](csv.md) · [Excel](excel.md)
