# Word, PowerPoint and OpenDocument (.docx, .pptx, .odt, .odp)

Reports and presentations often carry the tables people need to analyse. DataBrief reads **Word** documents (`.docx`, and
`.docm`), **PowerPoint** presentations (`.pptx`, `.pptm`), and the OpenDocument files of LibreOffice and others (**`.odt`**
text, **`.odp`** presentations).

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

**The tables are the data.** Every table becomes a section, with its columns and rows, like the tables of an HTML page:

- **Merged cells** are repeated in every cell they cover (a region written once for three rows is written three times).
- **The header row** is the one the file marks (Word's *Repeat as header row*, PowerPoint's *Header row*, OpenDocument's
  header rows); otherwise a first row that looks like column names is taken, as for any table. A header cell merged over
  several columns above a row that names them gives combined names (`Quarter / Q1`, `Quarter / Q2`).
- Tables are named `table_1`, `table_2`… in a document (or by their OpenDocument name when someone gave one), and
  `slide2_table1`… in a presentation.

**Everything else is context**, given to the AI in a *Document contents* or *Slides* part of the prompt:

- **Documents:** the headings (with their level, also in a translated Word), paragraphs and list items, in order, with
  the place of each table. Tracked changes are read as accepted (deleted text left out).
- **Presentations:** every slide in order, with its title, its text and its **speaker notes**, and the tables it holds.
- **Document properties:** title, subject, keywords, description, creation and modification dates, and the program that
  wrote the file. **Never the author, the last editor or the company**: who made a file is not shown, in any mode.

## The best file to give

- The `.docx`, `.pptx`, `.odt` or `.odp` file itself. From **Google Docs or Slides**: *File → Download → Microsoft Word /
  PowerPoint*. From **Pages or Keynote**: *File → Export To → Word / PowerPoint*.
- If the table is what matters and you have it as a spreadsheet, give the spreadsheet: it has the real values (a table
  in a report often holds rounded or formatted numbers).
- An old `.doc` or `.ppt` file (before 2007) is not read: save it again as `.docx` or `.pptx`.

## Good to know

- **Not read:** images, charts (their numbers are in the spreadsheet that made them), SmartArt, tables inside text boxes
  or frames, comments, headers and footers, footnotes. A scanned page is an image: its text is not there to read.
- A table whose first row is only styled as a header (PowerPoint's *Header row*, on by default) or whose header is guessed:
  in "Do not share data", when every column holds text, its column names are replaced by neutral names (the first row may
  be a record).
- **Nothing in the file is run:** macros included (`.docm`, `.pptm`).
- Up to 500 tables are read per file; the text given as context is cut after about 200,000 characters (the prompt says
  how much was left out).
- Values are the text written in each cell: a table in a report may hold `1,234.5 €` or `12 %`; the type of each column is
  detected from that text.

## With "Do not share data"

The **tables** are described like any other data: their structure, and the statistics of the level you choose; their
cells are never included. The **text** of the document (headings, paragraphs, slide titles and text, speaker notes) and
the **document properties** that people write (title, subject, keywords, description) are free text: they are
included only when you allow *Comments, notes and other free text*. Without it, the prompt keeps only the outline: the
level of each heading, how many paragraphs, and where each table is.
