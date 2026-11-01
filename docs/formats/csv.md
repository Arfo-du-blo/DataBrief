# CSV, TSV and TXT (delimited text)

The simplest and most universal way to give DataBrief a table: one file, one table, readable everywhere.

[← Back to the README](../../README.md#supported-formats) · [All formats](../../README.md#supported-formats)

## What DataBrief reads

- **Columns and rows.** Quoted fields, quotes inside quotes (`""`) and line breaks inside a field are handled.
- **The delimiter**, detected among `,` `;` tab and `|`. `.tsv` and `.tab` files start from tab, `.txt` files are detected like CSV.
- **The encoding:** UTF-8 (with or without a BOM), UTF-16 (with a BOM), and Windows-1252 as the fallback for older files. The prompt tells the AI which one was used.
- **The header row.** The first row is taken as the header when every non-empty cell in it is text and the file has more than one row. Otherwise the columns are named `column_1`, `column_2`… and the prompt says so.
- **The type of each column:** integer, decimal (dot or comma), date, date-time, time, boolean, text, empty, or mixed. Values are kept exactly as written (`12,50` stays `12,50`, a leading-zero code such as `007` stays text).
- Empty rows and trailing empty columns are removed.

## The best file to give

- **UTF-8**, with a **header row** in the first row and **one table per file**.
- **ISO dates** (`2024-03-31`) when you can: they are unambiguous for the AI (`03/04/2024` is not).
- No title lines, notes or totals above or below the table: they would be read as data (or as the header).

## How to get it

| From | How |
|---|---|
| Excel | **File → Save As → CSV UTF-8 (Comma delimited)** |
| LibreOffice Calc | **Save As → Text CSV**, character set **Unicode (UTF-8)** |
| Python (pandas) | `df.to_csv("data.csv", index=False)` |
| R | `write.csv(df, "data.csv", row.names = FALSE, fileEncoding = "UTF-8")` |
| PostgreSQL | `\copy (SELECT ...) TO 'data.csv' CSV HEADER` |
| MySQL | `SELECT ... INTO OUTFILE 'data.csv' FIELDS TERMINATED BY ',' ENCLOSED BY '"'` |

## Good to know

- **No header row.** DataBrief guesses the header, so a file *without* one can have its first record taken for the column names. If the columns look like data, add a header row to the file.
- **Large files.** The whole file is read into memory. Above about 150,000 tokens DataBrief warns you and offers to keep only the first *N* rows per section (nothing is cut without your choice).
- **Several tables in one file** are not split: give one file per table, or use a format with several sections (Excel, SQLite).
- Numbers and dates are not converted. If a column mixes `1,5` and `2.5`, the type says `decimal` but the data profile will report the format as ambiguous instead of guessing.

## With "Do not share data"

The prompt describes the columns (names, detected types), the number of rows and, if you allow it, counts and summaries. **No record is included.** A file without a header row gets neutral column names (`column_1`…) because its first record would otherwise become the names. See [the guide to this mode](../no-share.md).

## See also

[Excel](excel.md) · [JSON](json.md) · [SQLite](sqlite.md) · [The data profile and relationships](../../README.md#features)
