# databrief

Turn a data file into a prompt for an AI, **offline**. It reads **29 formats in 12 areas** (spreadsheets, CSV, JSON, XML, YAML,
HTML, SPSS, Parquet, Avro, Arrow, SQLite, SQL dumps, PostgreSQL archives, DuckDB exports, SQL Server packages, Access, DBF,
GeoJSON, GeoPackage, Jupyter notebooks, Word, PowerPoint, OpenDocument, PDF) and writes a Markdown prompt that gives an AI
assistant the data **and** its context: the structure, the types, the keys and relationships, the metadata and, for documents,
the text around the tables.

When your data cannot be shared, even with an AI, `--no-share` describes the file **without a single record**.

This is the command-line tool of [DataBrief](https://github.com/Arfo-du-blo/DataBrief). It runs the same readers as the DataBrief
web page and gives the same prompt. **It makes no network connection**, runs no shell, and has no dependencies.

## Use it

Needs Node.js 18 or newer.

```bash
npx databrief sales.xlsx                  # the prompt is copied to the clipboard
npx databrief sales.xlsx --no-share       # the same, with no data in it
npx databrief orders.parquet --csv        # prompt.md and the data as CSV files, in ./databrief/
npx databrief report.docx --review        # edit the prompt in your editor before it is copied
npx databrief dump.sql --print --no-copy  # print it
```

Or install it: `npm install -g databrief`, then `databrief --help` (and `man databrief` on Linux and macOS).

## Good to know

- `--no-share` controls what DataBrief outputs. **An AI agent that can run commands can often read the file itself.**
- The author, the last editor and the company of a file are never shown, in any mode.
- The package is built and published by GitHub Actions from the repository, with a provenance record.
- Every option, the files it writes, the exit codes and the limits: the
  [guide](https://github.com/Arfo-du-blo/DataBrief/blob/main/docs/cli.md).

GPL-3.0-or-later. The libraries bundled in the tool keep their own licenses: see `THIRD-PARTY-NOTICES.md` and `licenses/`.
