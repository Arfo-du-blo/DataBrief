# SPSS (.sav and .zsav)

SPSS files carry something CSV cannot: the **meaning** of the data. DataBrief has its own reader for them, and it keeps that meaning.

[← Back to the README](../../README.md#supported-formats)

## What DataBrief reads

- **Variables:** names (including long names), and **very long text variables**.
- **Variable labels** ("Gender of respondent") and **value labels** (`1 = Male; 2 = Female; 9 = Refused`). Coded values are **shown with their labels in the data**, and the prompt says so.
- **Measurement level** (nominal, ordinal, scale), **print formats**, **missing-value definitions** (single values and ranges such as `97–99`).
- **Dates and times** converted to ISO text.
- **File metadata:** the file label, the **notes** stored in the file, the weight variable, the encoding and the creation date.
- **Compression:** uncompressed, bytecode-compressed and `.zsav` (zlib) files; text encodings (UTF-8, Windows code pages, Shift-JIS, GBK and others).

## The best file to give

- A **`.sav` or `.zsav` saved from SPSS with its labels**: the labels are what make an analysis plan meaningful.

## How to get it

| From | How |
|---|---|
| SPSS | **File → Save As…** (`.sav`, or `.zsav` for compressed) |
| R | `haven::write_sav(df, "data.sav")` (keeps labelled variables) |
| Python | `pyreadstat.write_sav(df, "data.sav", column_labels=[...], variable_value_labels={...})` |

## Good to know

- **Value labels replace the codes** in the data: `Male` appears where the file stores `1`. The original codes remain visible in the column table (`1 = Male; …`).
- **Missing-value definitions are described, not applied**: a cell holding `9` is shown as `Refused` (its label) and the definition tells the AI that `9` means "missing".
- Weighting variables and multiple-response sets are not described beyond the weight variable's name.
- The file is read entirely into memory.

## With "Do not share data"

SPSS is where the no-share mode is most useful: the AI receives the **variable names, labels, value labels, measurement levels and missing-value definitions**, which is enough to plan statistical methods, without a single observation. Notes: **value labels can name categories** (a diagnosis, for example), so they are shown by default and can be switched off; the **file label and the notes** are free text and are left out unless you allow it. See [the guide to this mode](../no-share.md).

## See also

[Parquet](parquet.md) · [CSV](csv.md) · [Check it yourself](../verify-privacy.md)
