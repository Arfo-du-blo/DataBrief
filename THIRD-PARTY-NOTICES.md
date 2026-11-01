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
| [mdb-reader](https://github.com/andipaetzold/mdb-reader) and the packages bundled with it (buffer, pako, fast-xml-parser and a few small ones) | 3.2.0 | MIT (pako: MIT and Zlib; ieee754: BSD-3-Clause) | Microsoft Access databases | `vendor/LICENSE-mdb-reader.txt` (the license of every bundled package) |

Notes:
- `vendor/hyparquet.js` is the jsDelivr ES-module bundle of hyparquet, wrapped in a function so that it can run
  as a classic inline script (`window.hyparquet`). The code itself is unchanged.
- `vendor/mdb-reader.min.js` is built by `tools/build-mdb-reader.sh` from the npm package `mdb-reader` with esbuild. Its two encryption
  libraries are replaced by stubs (password-protected Access databases are refused), and Node's `Buffer` comes from the `buffer` package.
- The DBF reader (`src/dbf.js`), the SQL dump reader (`src/sqldump.js`) and the PostgreSQL archive reader (`src/pgarchive.js`) are original
  code written for DataBrief from the public descriptions of the formats; `src/dbf-codepages.js` is generated from Python's codecs.
- The SPSS `.sav` / `.zsav` reader (`src/spss.js`) is original code written for DataBrief from the public
  description of the format in the GNU PSPP documentation.
