# PDF (best effort)

A **PDF** is made for printing: it stores text placed at positions on pages, not tables. DataBrief reads the text and
**guesses** the tables from where the text sits. It works well for PDFs exported by a program (Word, Excel, LibreOffice,
a browser, a reporting tool), and it is labelled as a guess in the prompt.

[← Back to the README](../../README.md#supported-formats)

> **Best effort.** When you have the original file (the spreadsheet, the Word document, the export of the database),
> give that instead: its tables are real tables. The PDF reader also makes the page bigger (about 0.5 MB compressed), which
> is why the [ESP32 version](../esp32-arduino.md) leaves it out.

## What DataBrief reads

- **The text of every page**, in order: paragraphs, and headings (text clearly larger than the rest), given to the AI as
  context in a *Pages* part of the prompt.
- **Tables, guessed:** lines of text at the same height are rows; text separated by a wide gap is in separate cells; a
  run of rows whose cells line up (by their left edge, right edge or centre) is a table, and the first row is taken as the
  column names when it looks like one. Numbers aligned to the right stay in their column. Text that wraps inside a cell is
  joined to its row with a space. Each table becomes a section (`page2_table1`…), and the prompt warns the AI that it was
  reconstructed.
- **The document properties:** title, subject, keywords, creation and modification dates, and the program that made
  the PDF. Never the author.

## The best file to give

- The **original file**, when you have it. Otherwise, a PDF **exported** by the program that made it (*File → Export as
  PDF*, *Print → Save as PDF*): its text is real text.
- A **scanned** PDF (pages photographed or scanned) is made of images: there is no text to read (DataBrief does not do
  text recognition), and the prompt says so.

## Good to know

- Columns that sit very close together, cells merged across columns, tables split across pages and rotated text can
  give imperfect tables: check the structure in the preview. A table continued on the next page becomes two tables.
- A line break written inside a cell and a line that wraps look the same in a PDF: both become a space.
- Fonts without a character map (rare, mostly old or unusual generators) and some Asian fonts can give wrong or missing
  characters: that is what the PDF itself says about its text.
- **Password-protected** PDFs are refused with a message: open the file and save a copy without the password.
- Up to 500 pages are read. Nothing in the file is run (no JavaScript, no forms); nothing is loaded from the network.
- The reader is [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), built into the page by `tools/build-pdfjs.sh`
  (its legacy build, which runs in older browsers too; no worker and no `eval`, as the page's security policy requires).

## With "Do not share data"

The guessed **tables** are described like any other data: their structure, and the statistics of the level you choose;
their cells are never included. The **text** of the pages and the document properties written by people (title, subject,
keywords) are free text: included only when you allow *Comments, notes and other free text*. Without it, the
prompt keeps only the outline: for each page, how many blocks of text and which tables.
