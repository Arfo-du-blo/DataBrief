# Microsoft Access databases (`.mdb`, `.accdb`)

An Access database keeps its tables, and the **relationships** between them, in one file. DataBrief reads the tables and the
relationships. It works without Access installed.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

Files ending in `.mdb` (Access 97 to 2003) or `.accdb` (Access 2007 and later), recognised by their content.

- **Every table**, as a section: the columns with their Access types (`TEXT(255)`, `INTEGER`, `CURRENCY`, `DATETIME`,
  `BOOLEAN`, `MEMO`...), and the rows. Yes/No fields become `true` / `false`, currency and decimals keep their decimals, dates
  are written `YYYY-MM-DD`, binary and OLE values `[binary N bytes]`.
- **The relationships defined in Access**, with their columns (composite keys too) and **cascading deletes**. They become
  *declared* relationships, like foreign keys in a SQL database.
- **The creation date**, and which kind of file it is.

## The best file to give

The `.accdb` / `.mdb` file itself, as a **copy made while Access is closed** (a database that is open can have unsaved
changes). For a database **split into a front end and a back end**, give the **back end**: it holds the tables.

## Good to know

- **Not read:** saved queries, forms, reports, macros and VBA code, and **primary keys and indexes** (the reading library does
  not expose them). Because primary keys are unknown, a junction table is not shown as a many-to-many link; the relationships
  that Access stores are still listed.
- **Linked tables** keep their data in another file or server: they are listed, not read.
- **Password-protected or encrypted databases cannot be opened.** DataBrief says so; in Access, *File, Info, Decrypt Database*
  saves a copy without the password, or export the tables to CSV or Excel.
- **Large tables:** only the first **250,000 rows** of each table are kept; the row counts stay exact.
- Nothing in the file is executed: the macros and code are never run.
- **How it was tested:** the test databases were written by *Jackcess*, an independent open-source library that creates real
  `.mdb` and `.accdb` files. They were not made by Microsoft Access itself, which was not available.

## With "Do not share data"

The rows are dropped as soon as the mode is on. Table and column names can be replaced by neutral names (relationships keep
their shape), and the names of linked tables count as names. See [the guide to this mode](../no-share.md).

## See also

[SQL dumps](sql.md) · [SQLite](sqlite.md) · [DBF](dbf.md) · [Excel](excel.md)
