"""Writes the v1.4 fixtures that Python libraries produce (run INSIDE the container of tests/make_v14_fixtures.sh, never by hand):
Avro (fastavro), Arrow IPC file / stream and Feather v1 / v2 (pyarrow), Word .docx (python-docx), PowerPoint .pptx (python-pptx),
a Jupyter notebook EXECUTED by a real kernel (nbclient + ipykernel), and the CSV-with-WKT sources GDAL turns into GeoJSON and
GeoPackage. Every format also gets a canary file (CONFIDENTIAL_ markers, same meaning as in tests/make_fixtures.py):
  CONFIDENTIAL_REC   a record (cell value)          CONFIDENTIAL_COL   a name (column, table, layer, sheet)
  CONFIDENTIAL_TEXT  free text (paragraph, heading, notes, metadata)   CONFIDENTIAL_FILE  the file name
The data is the same small "shop" everywhere: what a reader must find is written by hand in expected.json, not by a reader."""
import datetime as dt
import decimal
import json
import os
import sys

OUT = sys.argv[1]
def P(*parts):
    p = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p

# ---------------------------------------------------------------- the shared data ----------
CUSTOMERS = [  # id, name, country, signup, notes (awkward text: comma, quote, newline, non-Latin)
    (1, "Ana Lima", "PT", dt.date(2023, 1, 5), 'Prefers email, "never" calls'),
    (2, "Bo Chen", "CN", dt.date(2023, 3, 17), "陈博\nsecond line"),
    (3, "Chloé Martin", "FR", dt.date(2024, 7, 2), ""),
    (4, "Dmitri O'Brien", "IE", dt.date(2024, 11, 30), None),
]
ORDERS = [  # id, customer_id, total, status
    (10, 1, decimal.Decimal("19.90"), "paid"),
    (11, 1, decimal.Decimal("5.00"), "refunded"),
    (12, 2, decimal.Decimal("120.00"), "paid"),
    (13, 4, decimal.Decimal("42.42"), "pending"),
]
CANARY_ROWS = [(i, f"CONFIDENTIAL_REC_{i:02d}", 100 + i) for i in range(1, 7)]


# ---------------------------------------------------------------- Avro (fastavro) ----------
def avro():
    import fastavro
    schema = fastavro.parse_schema({
        "type": "record", "name": "Customer", "namespace": "shop", "doc": "one customer",
        "fields": [
            {"name": "id", "type": "long"},
            {"name": "name", "type": "string"},
            {"name": "country", "type": {"type": "enum", "name": "Country", "symbols": ["PT", "CN", "FR", "IE"]}},
            {"name": "signup", "type": {"type": "int", "logicalType": "date"}},
            {"name": "notes", "type": ["null", "string"], "default": None},
            {"name": "balance", "type": {"type": "bytes", "logicalType": "decimal", "precision": 9, "scale": 2}},
            {"name": "tags", "type": {"type": "array", "items": "string"}},
            {"name": "address", "type": {"type": "record", "name": "Address", "fields": [
                {"name": "city", "type": "string"}, {"name": "zip", "type": ["null", "string"]}]}},
            {"name": "prefs", "type": {"type": "map", "values": "boolean"}},
            {"name": "last_login", "type": ["null", {"type": "long", "logicalType": "timestamp-millis"}]},
        ]})
    recs = []
    for k, (i, name, country, signup, notes) in enumerate(CUSTOMERS):
        recs.append({"id": i, "name": name, "country": country, "signup": signup, "notes": notes,
                     "balance": decimal.Decimal("10.50") * (k + 1), "tags": ["vip"] if k == 0 else [],
                     "address": {"city": ["Lisbon", "Shanghai", "Lyon", "Cork"][k], "zip": None if k == 1 else "1000"},
                     "prefs": {"email": k % 2 == 0}, "last_login": None if k == 3 else dt.datetime(2025, 1, k + 1, 9, 30, tzinfo=dt.timezone.utc)})
    for codec in ("null", "deflate", "snappy", "zstandard"):
        with open(P("arrow-fixtures", f"customers-{codec}.avro"), "wb") as f:
            fastavro.writer(f, schema, recs, codec=codec)
    canary = fastavro.parse_schema({"type": "record", "name": "CONFIDENTIAL_COL_RECORD", "doc": "CONFIDENTIAL_TEXT_AVRO_DOC",
                                    "fields": [{"name": "id", "type": "long"}, {"name": "CONFIDENTIAL_COL_A", "type": "string"},
                                               {"name": "amount", "type": "long"}]})
    with open(P("canary", "CONFIDENTIAL_FILE_avro.avro"), "wb") as f:
        fastavro.writer(f, canary, [{"id": i, "CONFIDENTIAL_COL_A": s, "amount": a} for i, s, a in CANARY_ROWS], codec="deflate",
                        metadata={"note": "CONFIDENTIAL_TEXT_AVRO_META"})
    return "fastavro " + fastavro.__version__


# ---------------------------------------------------------------- Arrow / Feather (pyarrow) ----------
def arrow():
    import pyarrow as pa
    import pyarrow.feather as feather
    import pyarrow.ipc as ipc
    cat = pa.array(["paid", "refunded", "paid", "pending"]).dictionary_encode()
    t = pa.table({
        "id": pa.array([o[0] for o in ORDERS], pa.int64()),
        "customer_id": pa.array([o[1] for o in ORDERS], pa.int32()),
        "total": pa.array([o[2] for o in ORDERS], pa.decimal128(9, 2)),
        "status": cat,
        "ordered_at": pa.array([dt.datetime(2025, 2, d, 12, 0) for d in (1, 2, 3, 4)], pa.timestamp("ms", tz="Europe/Paris")),
        "items": pa.array([["a", "b"], [], None, ["c"]], pa.list_(pa.string())),
        "shipping": pa.array([{"carrier": "UPS", "days": 2}, None, {"carrier": "DHL", "days": 5}, {"carrier": None, "days": None}],
                             pa.struct([("carrier", pa.string()), ("days", pa.int8())])),
        "note": pa.array(["ok", None, "陈", "x\ny"], pa.large_string()),
    }, metadata={"source": "shop"})
    feather.write_feather(t, P("arrow-fixtures", "orders-v2-lz4.feather"), compression="lz4")
    feather.write_feather(t, P("arrow-fixtures", "orders-v2-zstd.feather"), compression="zstd")
    feather.write_feather(t, P("arrow-fixtures", "orders-v2-uncompressed.feather"), compression="uncompressed")
    flat = t.select(["id", "customer_id", "note"]).cast(pa.schema([("id", pa.int64()), ("customer_id", pa.int32()), ("note", pa.string())]))
    feather.write_feather(flat, P("arrow-fixtures", "orders-v1.feather"), version=1)     # the old format: flat columns only
    with ipc.new_file(P("arrow-fixtures", "orders.arrow"), t.schema) as w:               # Arrow IPC file (ARROW1 magic)
        w.write_table(t, max_chunksize=2)                                               # two record batches
    with ipc.new_stream(P("arrow-fixtures", "orders.arrows"), t.schema) as w:            # Arrow IPC stream (no magic)
        w.write_table(t)
    c = pa.table({"id": [r[0] for r in CANARY_ROWS], "CONFIDENTIAL_COL_A": [r[1] for r in CANARY_ROWS], "amount": [r[2] for r in CANARY_ROWS]},
                 metadata={"note": "CONFIDENTIAL_TEXT_ARROW_META"})
    feather.write_feather(c, P("canary", "CONFIDENTIAL_FILE_feather.feather"))
    with ipc.new_file(P("canary", "CONFIDENTIAL_FILE_arrow.arrow"), c.schema) as w:
        w.write_table(c)
    return "pyarrow " + pa.__version__


# ---------------------------------------------------------------- Word (python-docx) ----------
def docx_files():
    import docx
    from docx.shared import Pt
    def make(path, title, para, head_cust, rows_cust, head_ord, rows_ord, notes_meta):
        d = docx.Document()
        d.core_properties.author = notes_meta
        d.core_properties.title = title
        d.add_heading(title, level=1)
        d.add_paragraph(para)
        d.add_heading("Customers" if "CONFIDENTIAL" not in title else "CONFIDENTIAL_TEXT_HEADING_2", level=2)
        t = d.add_table(rows=1, cols=len(head_cust))
        t.style = "Table Grid"
        for c, h in zip(t.rows[0].cells, head_cust):
            c.text = h
        for r in rows_cust:
            cells = t.add_row().cells
            for c, v in zip(cells, r):
                c.text = "" if v is None else str(v)
        d.add_paragraph("Between the tables: some text.")
        t2 = d.add_table(rows=1, cols=len(head_ord))
        t2.style = "Table Grid"
        for c, h in zip(t2.rows[0].cells, head_ord):
            c.text = h
        for r in rows_ord:
            cells = t2.add_row().cells
            for c, v in zip(cells, r):
                c.text = str(v)
        # a merged header cell above two columns (a third, awkward table); a paragraph first, or Word and LibreOffice join it
        # to the table above (adjacent tables are shown as one)
        d.add_paragraph("Sales by region:")
        t3 = d.add_table(rows=3, cols=3)
        t3.style = "Table Grid"
        a = t3.cell(0, 1).merge(t3.cell(0, 2))
        a.text = "Quarter"
        t3.cell(0, 0).text = "Region"
        for j, v in enumerate(["", "Q1", "Q2"]):
            if v:
                t3.cell(1, j).text = v
        for j, v in enumerate(["North", "10", "12"]):
            t3.cell(2, j).text = v
        p = d.add_paragraph("Last paragraph, ")
        p.add_run("bold part").bold = True
        p.runs[0].font.size = Pt(11)
        d.save(path)
    make(P("doc-fixtures", "report.docx"), "Quarterly report", "This report lists the customers and their orders.",
         ["id", "name", "country", "signup", "notes"], CUSTOMERS, ["id", "customer_id", "total", "status"], ORDERS, "Report author")
    make(P("canary", "CONFIDENTIAL_FILE_docx.docx"), "CONFIDENTIAL_TEXT_TITLE", "CONFIDENTIAL_TEXT_PARAGRAPH",
         ["id", "CONFIDENTIAL_COL_A", "amount"], CANARY_ROWS, ["id", "CONFIDENTIAL_COL_B"], [(1, "CONFIDENTIAL_REC_B1")], "CONFIDENTIAL_TEXT_AUTHOR")
    return "python-docx " + getattr(docx, "__version__", "?")


# ---------------------------------------------------------------- PowerPoint (python-pptx) ----------
def pptx_files():
    import pptx
    from pptx.util import Inches
    def make(path, title, sub, head, rows, notes, author):
        prs = pptx.Presentation()
        prs.core_properties.author = author
        s = prs.slides.add_slide(prs.slide_layouts[0])
        s.shapes.title.text = title
        s.placeholders[1].text = sub
        s2 = prs.slides.add_slide(prs.slide_layouts[5])
        s2.shapes.title.text = "Orders" if "CONFIDENTIAL" not in title else "CONFIDENTIAL_TEXT_SLIDE_TITLE"
        shape = s2.shapes.add_table(len(rows) + 1, len(head), Inches(0.5), Inches(1.5), Inches(9), Inches(3))
        for j, h in enumerate(head):
            shape.table.cell(0, j).text = h
        for i, r in enumerate(rows):
            for j, v in enumerate(r):
                shape.table.cell(i + 1, j).text = str(v)
        s2.notes_slide.notes_text_frame.text = notes
        s3 = prs.slides.add_slide(prs.slide_layouts[1])
        s3.shapes.title.text = "Summary"
        s3.placeholders[1].text = "Three points\nwithout a table"
        prs.save(path)
    make(P("doc-fixtures", "deck.pptx"), "Sales review", "Q1 2025", ["id", "customer_id", "total", "status"], ORDERS, "Speaker notes: say hello", "Deck author")
    make(P("canary", "CONFIDENTIAL_FILE_pptx.pptx"), "CONFIDENTIAL_TEXT_TITLE", "CONFIDENTIAL_TEXT_SUBTITLE", ["id", "CONFIDENTIAL_COL_A", "amount"],
         CANARY_ROWS, "CONFIDENTIAL_TEXT_NOTES", "CONFIDENTIAL_TEXT_AUTHOR")
    return "python-pptx " + pptx.__version__


# ---------------------------------------------------------------- Jupyter notebook (executed by a real kernel) ----------
def notebook():
    import nbformat
    from nbclient import NotebookClient
    def run(path, cells):
        nb = nbformat.v4.new_notebook()
        nb.cells = [nbformat.v4.new_markdown_cell(c[1]) if c[0] == "md" else nbformat.v4.new_code_cell(c[1]) for c in cells]
        NotebookClient(nb, timeout=120, kernel_name="python3", allow_errors=True).execute()
        nbformat.write(nb, path)
    cust = repr([[c[0], c[1], c[2], str(c[3]), c[4]] for c in CUSTOMERS])   # a Python literal (None, not JSON's null)
    run(P("ipynb-fixtures", "analysis.ipynb"), [
        ("md", "# Customer analysis\nA small notebook with **DataFrame outputs**."),
        ("code", "import pandas as pd\ncustomers = pd.DataFrame(" + cust + ", columns=['id', 'name', 'country', 'signup', 'notes'])\ncustomers"),
        ("code", "orders = pd.DataFrame({'id': [10, 11, 12, 13], 'customer_id': [1, 1, 2, 4], 'total': [19.9, 5.0, 120.0, 42.42]})\nprint(len(orders))\norders.head(2)"),
        ("code", "orders.groupby('customer_id')['total'].sum()"),
        ("code", "big = pd.DataFrame({'n': range(300), 'sq': [i * i for i in range(300)]})\nbig"),
        ("code", "1 / 0"),
        ("md", "Conclusion: *nothing* surprising."),
    ])
    run(P("canary", "CONFIDENTIAL_FILE_ipynb.ipynb"), [
        ("md", "# CONFIDENTIAL_TEXT_MARKDOWN"),
        ("code", "import pandas as pd\n# CONFIDENTIAL_TEXT_CODE_COMMENT\npd.DataFrame({'id': [1, 2, 3, 4, 5, 6], 'CONFIDENTIAL_COL_A': " +
         json.dumps([r[1] for r in CANARY_ROWS]) + "})"),
        ("code", "print('CONFIDENTIAL_REC_PRINTED')"),
    ])
    import nbclient
    return "nbformat " + nbformat.__version__ + ", nbclient " + nbclient.__version__ + ", pandas " + __import__("pandas").__version__


# ---------------------------------------------------------------- notebook outputs of other shapes (stage 19) ----------
def notebook_shapes():
    """The HTML that pandas, the pandas Styler and Polars really write: a named index, a MultiIndex on rows and on columns,
    a frame too wide for pandas (columns shortened), two frames shown with display() in one cell, an image, stderr,
    and a code cell added AFTER the run (never executed)."""
    import nbformat
    from nbclient import NotebookClient
    import polars
    nb = nbformat.v4.new_notebook()
    src = [
        ("md", "## Shapes of outputs\nWritten by `make_sources.py`."),
        ("code", "import pandas as pd\nsales = pd.DataFrame({'region': ['North', 'North', 'South', 'South'], 'year': [2023, 2024, 2023, 2024],\n"
                 "                      'amount': [10.5, 12.0, 7.25, 9.0], 'qty': [3, 4, 2, 5]})\nby_region = sales.set_index('region')\nby_region"),
        ("code", "pivot = sales.pivot_table(index='region', columns='year', values=['amount', 'qty'], aggfunc='sum')\npivot"),
        ("code", "two_levels = sales.set_index(['region', 'year'])\ntwo_levels"),
        ("code", "wide = pd.DataFrame([[i * j for j in range(30)] for i in range(3)], columns=[f'c{j}' for j in range(30)])\nwide"),
        ("code", "first = sales.head(1)\nsecond = sales.tail(1)\ndisplay(first)\ndisplay(second)"),
        ("code", "sales.style.format(precision=1)"),
        ("code", "import polars as pl\npl_sales = pl.DataFrame({'region': ['North', 'South'], 'amount': [22.5, 16.25]})\npl_sales"),
        ("code", "import base64, sys\nfrom IPython.display import Image\nprint('careful: small sample', file=sys.stderr)\n"
                 "Image(data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))"),
    ]
    nb.cells = [nbformat.v4.new_markdown_cell(c[1]) if c[0] == "md" else nbformat.v4.new_code_cell(c[1]) for c in src]
    NotebookClient(nb, timeout=120, kernel_name="python3", allow_errors=True).execute()
    nb.cells.append(nbformat.v4.new_code_cell("sales.describe()"))   # added after the run: never executed
    nbformat.write(nb, P("ipynb-fixtures", "shapes.ipynb"))
    return "nbformat " + nbformat.__version__ + ", pandas " + __import__("pandas").__version__ + ", polars " + polars.__version__


# ---------------------------------------------------------------- geodata sources (GDAL writes the real files) ----------
def geo_sources():
    rows = [
        ("1", "Town hall", "civic", "POINT (2.3522 48.8566)"),
        ("2", "River walk", "leisure", "LINESTRING (2.30 48.85, 2.32 48.86, 2.35 48.86)"),
        ("3", "Old quarter", "district", "POLYGON ((2.33 48.85, 2.36 48.85, 2.36 48.87, 2.33 48.87, 2.33 48.85))"),
        ("4", "Two islands", "nature", "MULTIPOLYGON (((2.34 48.85, 2.35 48.85, 2.35 48.86, 2.34 48.85)), ((2.36 48.85, 2.37 48.85, 2.37 48.86, 2.36 48.85)))"),
        ("5", "Unknown spot", "", ""),
    ]
    with open(P("geo-src", "places.csv"), "w", encoding="utf-8", newline="") as f:
        f.write("id,name,category,wkt\n")
        for r in rows:
            f.write(",".join('"' + x.replace('"', '""') + '"' for x in r) + "\n")
    with open(P("geo-src", "CONFIDENTIAL_COL_LAYER.csv"), "w", encoding="utf-8", newline="") as f:
        f.write("id,CONFIDENTIAL_COL_A,wkt\n")
        for i, s, a in CANARY_ROWS:
            f.write(f'{i},{s},"POINT ({a / 50:.3f} {a / 100:.3f})"\n')
    return "sources"


VERS = {}
ALL = (avro, arrow, docx_files, pptx_files, notebook, notebook_shapes, geo_sources)
ONLY = sys.argv[2].split(",") if len(sys.argv) > 2 and sys.argv[2] else None   # make_v14_fixtures.sh ONLY=...
for fn in ALL:
    if ONLY is None or fn.__name__ in ONLY:
        VERS[fn.__name__] = fn()
with open(P(".python-versions.txt"), "w") as f:
    f.write("\n".join(f"{k}: {v}" for k, v in VERS.items()) + "\n")
print("python fixtures written")
