# Do not share data

Your data cannot leave your computer, and sometimes it cannot even be shared with an AI: patient records, customer files, employee data, confidential research, a client's database. DataBrief can still help.

**Do not share data** produces an AI-ready description of your file (its structure, its metadata and, if you allow it, aggregate statistics) **without a single record**. You can then ask the AI how to analyse the data, which statistical methods to use, which relationships to investigate and which questions to ask, without giving it access to the underlying observations.

[← Back to the README](../README.md) · [Check it yourself](verify-privacy.md)

---

## Two different requests

| | Normal mode | Do not share data |
|---|---|---|
| What the AI receives | your data (or a sample, with CSV files) | a **description** of your data |
| What you ask the AI | "Here is my data. Help me analyse it." | "Here is what my data looks like. Help me **plan** how to analyse it." |
| The AI can | compute, find, summarise | suggest methods, questions, checks, **code you run locally** |
| The AI must not | | pretend it has seen the data, or invent values, distributions or conclusions |

The no-share prompt is **not** the normal prompt with the rows removed: it is a different prompt with a different purpose, written around one constraint ("you have **not** received the records"), a list of what the AI does not have, and a request for an analysis *plan*.

## How to use it

1. Tick **Do not share data**, under the drop zone (you can do it before choosing the file).
2. Drop your file. DataBrief analyses it locally.
3. Choose **how much to include** (below), and **what to include** (switches).
4. **Read the prompt** in the preview, then copy it or download the `.md`.
5. Paste it into your AI and describe your goal: what you want to find out or decide.

The mode is remembered: DataBrief never silently goes back to sharing your data. Leaving it asks for confirmation ("Include my data" / "Keep my data out"), then reads the file again.

## How much to include: three levels

| Level | The prompt contains | Typical use |
|---|---|---|
| **1. Structure only** (default) | format, tables or sheets, **column names and types**, keys, constraints, **declared relationships**, labels and value labels (SPSS), the number of rows | the safest: nothing computed from the values |
| **2. + counts** | + missing values, **distinct counts for categorical columns**, duplicate rows, constant columns, the **kind** of each column (identifier, categorical, continuous, date), **inferred relationships** (without ratios) | to help choose methods |
| **3. + summaries** (opt-in, with a warning) | + for continuous columns: minimum, maximum, mean, standard deviation, median, outliers; date ranges; **category frequencies** (groups of **fewer than 5 records are hidden**, plus one more group when needed so a hidden group cannot be worked out by subtraction); the overlap ratio of inferred relationships | when you accept that aggregates are shared |

> ⚠️ **Level 3 can reveal real values.** A minimum or a maximum *is* a record, and the names of frequent categories are data. Ranges are hidden for columns with fewer than 10 values. Read the prompt before sending it.

## What to include: the switches

| Switch | Default | When off |
|---|---|---|
| **Table and column names** | on | neutral names (`table_1`, `column_3`); relationships and keys keep their shape; SQL definitions are removed |
| **Labels and value labels** | on | variable labels, value labels and HTML captions used as names are left out |
| **Relationships between tables** | on | the Relationships section is left out |
| **File name** | on | the file is called `dataset.csv` (also for the download) |
| **Comments, notes and other free text** | **off** | (Excel comments, SPSS file label and notes, embedded metadata) left out unless you allow them |
| **SQL definitions** of tables and views | **off** | they can contain literal values (`DEFAULT 'Smith'`); only available when names are shared |

Some names are **replaced even when names are on**, because they may be data themselves: the first row of a file **without a header row** (it may be a record), and JSON / XML / YAML **keys that look like values** (an e-mail, a number, an identifier, a date). The prompt says when that happened.

## What is never included

- **Any record**: no row, no sample, no example value, no raw JSON or XML value, no `INSERT` value.
- **No CSV files, no "Download all"**: those buttons are hidden in this mode and refuse to run even if triggered.
- **No formula text** (a formula can contain a value).
- **No technical error details** (an error message can quote part of your file).

## How it is built so a record cannot slip in

This is not a hidden button or a text filter:

1. DataBrief reads your file locally, as always.
2. It makes a **record-free copy** that contains only what the chosen level allows: structure, metadata, keys, relationships and aggregates. Category groups smaller than 5 and the ranges of tiny columns are removed **when the copy is made**.
3. The page **releases the parsed rows**. Only the copy stays in memory.
4. A **separate prompt builder** receives that copy and nothing else. It cannot write a record: it never receives one.
5. Copy, download, preview and the formatted view all use the same record-free prompt.

The automated tests prove it with canary values placed in every format (CSV, Excel, JSON, XML, YAML, HTML, SPSS, Parquet, SQLite…): records, formula literals, free text, SQL literals, names, labels and file names are searched for in the prompt, the preview and the page state, at every level and for every switch; the same promise is checked in all 15 languages on a sample file. An independent review also tried to break the mode, and everything it found was fixed and covered by a test.

## Team settings

| How | Effect |
|---|---|
| `DATABRIEF_SHARE=no` (servers, Docker, Kubernetes, `databrief.conf`) or the **settings page** | the page opens in this mode |
| lock `share` | users cannot switch it off (the control is hidden) |
| link `?share=no` | opens in this mode. A link can switch it **on**, never off |

A value that is not `yes` or `no` is refused by the servers and Docker; in the page, any `share` value other than `yes` means "do not share". Locking `share` **without** `no` locks the page to *sharing*: the settings page says so.

## Honest limits

- It reduces the risk, it **does not anonymise**. Column names, category names, value labels and even file names can themselves be sensitive: use the switches, and **read the prompt before you send it**.
- **Level 3** shares aggregates. A rare combination or an extreme value in a small data set can identify someone.
- DataBrief cannot know what is sensitive in *your* file. You decide.
- The privacy of the page itself (nothing is sent anywhere) is a separate guarantee, which you can [check yourself](verify-privacy.md).

## See also

[The format guides](../README.md#supported-formats) · [Check it yourself](verify-privacy.md) · [Learn deployment with DataBrief](learn.md)
