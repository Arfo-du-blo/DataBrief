# Excel and OpenDocument spreadsheets (XLSX, XLSM, XLS, ODS)

Spreadsheets hold more than values: sheets, comments, merged cells, formulas. DataBrief reads what it can and says what the values alone cannot tell.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **Every sheet as its own section**, including hidden sheets (flagged as hidden).
- **Dates and times** as ISO text, using each cell's number format (so a cell showing `31/03/2024` becomes `2024-03-31`). Floating-point noise is removed (`0.30000000000000004` → `0.3`).
- **Cell comments** (the first 200 per sheet are listed, with their cell; their text only, never who wrote them).
- **The workbook's properties:** title, subject, keywords, description, creation and modification dates, and the program
  that wrote it. **Never the author, the last editor, the manager or the company.**
- **What the values do not say:**
  - the **number of formula cells** per sheet, with examples (`D2: =B2*C2`), and how many have no stored result;
  - **merged ranges** (`B5:C5`: the value is in the top-left cell only);
  - **hidden rows and columns**;
  - **defined names** (named ranges) of the workbook.
- The **type of each column**, like for CSV, and the header row guess (first row all text → header).

## The best file to give

- An **`.xlsx` saved by Excel** (or LibreOffice): it stores the **last calculated result** of every formula, which is what DataBrief shows.
- **Data starting at A1**, a header row, and **one table per sheet**. Avoid merged cells in the header and notes above the table.
- Several related tables → one sheet each: DataBrief then proposes [relationships](../../README.md#features) between sheets (as candidates to validate).

## How to get it

| From | How |
|---|---|
| Excel | **File → Save As → Excel Workbook (.xlsx)** |
| Python (pandas) | `df.to_excel("data.xlsx", index=False)`; several sheets: `pd.ExcelWriter` |
| R | `writexl::write_xlsx(list(sheet1 = df1, sheet2 = df2), "data.xlsx")` |

## Good to know

- **Formulas are never run, macros are ignored** (`.xlsm` is read like `.xlsx`). The values shown are the stored results.
- **A formula without a stored result** (typical for files written by scripts, for example with openpyxl) cannot show a value: its cell is empty and DataBrief **counts** it ("Formula cells: 3 · without a stored result, shown empty: 3") so the AI knows the column is calculated.
- **Merged cells** show their value only in the top-left cell; the others are empty.
- **A sheet with several blocks** (two tables side by side, titles in the middle) is still one section.
- **Password-protected files** cannot be read: save a copy without the password.
- Old `.xls` and `.ods` files are read the same way.
- Excel tables, data validation and charts are not described (not exposed by the reading library).

## With "Do not share data"

Sheet names, column names, types, the number of rows and, if allowed, counts and summaries. Cell **comments** are free text and are left out unless you allow free text. **Formula texts are never included** (a formula can contain a value: `=IF(A2="Smith";…)`); only their number is. Defined names that are constants (such as `="Smith"`) are left out, only references to cells are kept. See [the guide to this mode](../no-share.md).

## See also

[CSV](csv.md) · [SQLite](sqlite.md) · [Check it yourself](../verify-privacy.md)
