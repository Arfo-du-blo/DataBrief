# SQL Server data-tier packages (`.dacpac`, `.bacpac`)

A **data-tier package** describes a SQL Server database: tables, keys, views... in one file, without needing SQL Server to
read it. It is what *Extract Data-tier Application* writes, and what a Visual Studio *SQL Server Database Project* builds. It is
the practical way to give DataBrief a SQL Server schema, because a `.bak` backup can only be opened by SQL Server.

[← Back to the README](../../README.md#supported-formats)

Need to produce this file? See [Export your database](../export-your-database.md).

## What DataBrief reads

Files ending in `.dacpac` (or `.bacpac`), recognised by their content.

- **Every table**, with its columns and their **SQL Server types** (`int IDENTITY`, `nvarchar(255)`, `decimal(10,2)`,
  `datetime2(0)`, `nvarchar(MAX)`...), nullable or not, and **computed columns**.
- **Primary keys** (in order), **unique constraints** and **indexes**.
- **Foreign keys**, with their columns (composite keys too) and `ON DELETE` / `ON UPDATE` actions. They become *declared*
  relationships, and a junction table is recognised as a **many-to-many** link.
- **Views**, with their query.
- **Descriptions** written with `MS_Description` on tables and columns.
- Tables outside the `dbo` schema are written `schema.table`.

## The best file to give

A `.dacpac`:

- **From SQL Server Management Studio:** right-click the database, *Tasks*, *Extract Data-tier Application...*
- **From Visual Studio:** build a *SQL Server Database Project*; the `.dacpac` is in `bin`.
- **From the command line:** `sqlpackage /Action:Extract /SourceConnectionString:... /TargetFile:shop.dacpac`

A `.dacpac` is the **schema only**: it is small, holds no row, and suits [Do not share data](../no-share.md) well.

## Good to know

- **No rows.** A `.dacpac` never contains data. A `.bacpac` (*Export Data-tier Application*) also holds the rows, as BCP files:
  **DataBrief reads only its schema**, and the prompt says that the rows were not read.
- **Stored procedures, functions and triggers** are not read; they are listed with their count.
- Nothing is executed.
- **How it was tested:** the test packages were built by Microsoft's own DacFx library from a T-SQL schema.

## With "Do not share data"

The structure and the relationships are the input this mode is made for. Table and column names can be replaced by neutral
names; **custom type names** are names too. The views' SQL and the **table descriptions** (free text) appear only when you
allow them. See [the guide to this mode](../no-share.md).

## See also

[SQL dumps](sql.md) · [Access](access.md) · [SQLite](sqlite.md)
