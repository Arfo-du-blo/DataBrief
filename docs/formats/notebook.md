# Jupyter notebooks (.ipynb)

A **Jupyter notebook** (`.ipynb`, also written by JupyterLab, VS Code, Google Colab and Kaggle) mixes text, code and the
results of that code. When it is saved after a run, it **stores the outputs**: the tables a cell showed, what it printed, its
errors, its charts.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

A notebook is **read, never run**: DataBrief uses only what the file stores.

- **The tables of the outputs, as data:** every data frame a cell showed (pandas, the pandas Styler, Polars, R's
  `data.frame` and tibbles) becomes a section, with its columns and rows. A table is named after the expression that showed
  it (`customers`, `orders.head(2)`, the argument of `display(...)`) or, when that expression holds anything else, after
  its cell (`cell_7`).
  - A **named index** becomes a column with its name; a **MultiIndex** gives one column per level; MultiIndex column names
    are joined (`amount / 2023`). The default row numbers (0, 1, 2…) are left out.
  - Polars and R column **types** (`str`, `f64`, `<dbl>`) are kept as column metadata.
  - pandas' missing markers (`NaN`, `NaT`, `<NA>`, `None`) are read as empty cells.
- **The notebook itself, for context**, in a *Notebook contents* part of the prompt: every cell in order, with its kind and
  execution number, the **Markdown** text, the **code**, what was **printed** (and `stderr`), **errors** (their kind and
  message), text outputs (a pandas Series, a number), and which section each table became. Images, charts and widgets are
  listed, not read.
- The **language** (Python, R, Julia…) and the notebook format version.

## The best file to give

- The `.ipynb` **after a full run** (*Run All*, then save), so that the outputs are stored in it. A notebook saved without
  its outputs (or cleared with `nbstripout`) gives only its cells.
- For **all the rows** of a table, give the data itself instead of the notebook: `df.to_parquet("data.parquet")` or
  `df.to_csv("data.csv")`, then load that file (see [Parquet](parquet.md) and [CSV](csv.md)).

## Good to know

- **A notebook shows only part of a large table:** pandas stores the first and last 5 rows of a long frame and the first and
  last 10 columns of a wide one. DataBrief reads what is stored and gives the true size (`300 rows × 2 columns`); the
  prompt says which tables were shortened, and statistics describe only the stored rows.
- **Values are as displayed:** a Styler rounds as it was told, pandas writes a newline in a value as `\n`.
- Long code and long outputs are cut in the prompt (60 lines of code, 30 lines of output per cell, 400 cells), with the
  number of lines left out. Up to 200 tables are read per notebook.
- A notebook saved as `.json` is recognised by its content. Old notebooks (nbformat 3) are read too.

## With "Do not share data"

The **tables** are described like any other file: their structure, and the statistics of the level you choose. The
*Notebook contents* part keeps only the **kind of each cell** and **which table each cell produced**:

- **Code is never included**: code often holds values (a list of names, a filter on a client, a file path).
- **Outputs are never included**: printed text, text outputs and error messages are records.
- An error keeps only its kind (`ZeroDivisionError`).
- **Markdown** cells are free text: included only when you allow *Comments, notes and other free text*.
- Table names taken from the code are names: replaced by neutral names when names are not shared.
