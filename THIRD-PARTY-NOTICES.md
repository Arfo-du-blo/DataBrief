# Third-party notices

DataBrief is licensed under the GNU General Public License v3.0 or later (see `LICENSE`).
`databrief.html` embeds the following libraries, unmodified except where noted. Each keeps its own license,
and all of them are compatible with GPL-3.0. The full license texts are in `vendor/`.

| Library | Version | License | Used for | License file |
|---|---|---|---|---|
| [SheetJS Community Edition](https://sheetjs.com) | 0.20.3 | Apache-2.0 | XLSX, XLSM, XLS, ODS | `vendor/LICENSE-sheetjs.txt` |
| [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly) | 1.14.2 | MIT (SQLite itself: public domain) | SQLite databases | `vendor/LICENSE-sqljs.txt` |
| [hyparquet](https://github.com/hyparam/hyparquet) | 1.31.4 | MIT | Parquet | `vendor/LICENSE-hyparquet.txt` |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | MIT | Gzip/zlib (Parquet, .zsav), ZIP export | `vendor/LICENSE-fflate.txt` |
| [fzstd](https://github.com/101arrowz/fzstd) | 0.1.1 | MIT | Zstandard (Parquet) | `vendor/LICENSE-fzstd.txt` |
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.1.0 | MIT | YAML | `vendor/LICENSE-js-yaml.txt` |
| [marked](https://github.com/markedjs/marked) | 18.1.1 | MIT | Formatted preview of the prompt | `vendor/LICENSE-marked.txt` |

Notes:
- `vendor/hyparquet.js` is the jsDelivr ES-module bundle of hyparquet, wrapped in a function so that it can run
  as a classic inline script (`window.hyparquet`). The code itself is unchanged.
- The SPSS `.sav` / `.zsav` reader (`src/spss.js`) is original code written for DataBrief from the public
  description of the format in the GNU PSPP documentation.
