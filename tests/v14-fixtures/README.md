# v1.4 fixtures

Real files for the formats of DataBrief v1.4, written by the tools people use, **never by DataBrief and never by hand**.
`bash tests/make_v14_fixtures.sh` regenerates them (Docker; see `VERSIONS.txt` for the exact tools). `make_sources.py` holds
the data given to those tools; `expected.json` says, **by hand**, what a reader must find (the oracle of the tests).

| Folder | Files | Written by |
|---|---|---|
| `arrow-fixtures/` | Avro (no compression, deflate, snappy, zstandard); Arrow IPC file and stream; Feather v1 and v2 (lz4, zstd, none) | fastavro, pyarrow |
| `doc-fixtures/` | `report.docx` / `deck.pptx`, and LibreOffice's own `.docx` / `.pptx`; `.odt` / `.odp`; PDFs | python-docx, python-pptx, LibreOffice, Chrome |
| `ipynb-fixtures/` | a notebook **executed by a real Jupyter kernel** (DataFrame outputs, a long table, an error) | nbclient + ipykernel + pandas |
| `geo-fixtures/` | GeoJSON (5 geometry kinds, one empty), a GeoPackage with 3 layers (WGS 84, Lambert-93, no geometry) | GDAL |
| `canary/` | one file per format with `CONFIDENTIAL_` markers for the "Do not share data" tests | all of the above |

Facts worth knowing (found while making them):

- **Adjacent tables** in a Word document, with nothing between them, are shown as one table by Word and are **merged into one**
  by LibreOffice: the generator puts a paragraph between them.
- **PDF text** comes as pieces with positions: a cell that wraps becomes several pieces (`CONFIDENTIAL_REC_` + `01`), and
  tables can only be guessed from the positions. The no-share tests look for fragments, not only whole markers.
- A **GeoPackage** is a SQLite file; its `gpkg_*` and `rtree_*` tables are machinery, not user data.
