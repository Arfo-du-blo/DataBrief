"""Generate test files for DataBrief, one per supported format (plus edge cases).
Run inside an isolated venv with: pandas pyarrow pyreadstat openpyxl
    python make_fixtures.py OUT_DIR
"""
import datetime as dt
import decimal
import json
import os
import shutil
import sqlite3
import sys

import openpyxl
from openpyxl.comments import Comment
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pyreadstat

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
P = lambda name: os.path.join(out, name)

# --- CSV (semicolon, quotes, embedded newline, accents) ---
with open(P("ventes.csv"), "w", encoding="utf-8", newline="") as f:
    f.write('région;produit;montant;date;commentaire\n')
    f.write('Île-de-France;Café;12,50;2024-01-15;"Très bon; à refaire"\n')
    f.write('Bretagne;Thé;8,00;2024-02-01;"ligne 1\nligne 2"\n')
    f.write('Occitanie;Chocolat;;2024-03-10;"dit ""super"""\n')

# --- CSV in Windows-1252 ---
with open(P("latin1.csv"), "w", encoding="cp1252", newline="") as f:
    f.write("nom,ville,prix\nRené,Besançon,3.5\nZoë,Nîmes,4\n")

# --- TSV ---
with open(P("data.tsv"), "w", encoding="utf-8", newline="") as f:
    f.write("id\tname\tactive\n1\tAlice\ttrue\n2\tBob\tfalse\n")

# --- TXT without header, pipe-delimited ---
with open(P("nohead.txt"), "w", encoding="utf-8", newline="") as f:
    for i in range(5):
        f.write(f"{i}|{i * 1.5}|{2020 + i}-06-01\n")

# --- XLSX: 3 sheets (one hidden), dates, times, booleans, comments, merged cells, float noise ---
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Orders"
ws.append(["order_id", "customer", "amount", "ordered_at", "delivered", "paid"])
ws.append([1, "ACME", 0.1 + 0.2, dt.datetime(2024, 5, 1, 14, 30, 0), dt.date(2024, 5, 3), True])
ws.append([2, "Globex", 1234.5, dt.datetime(2024, 5, 2, 0, 0, 0), None, False])
ws.append([3, "Initech", -7, dt.datetime(2024, 5, 2, 9, 5, 7), dt.date(2024, 5, 9), True])
ws["C2"].comment = Comment("Includes VAT", "Arfo")
ws2 = wb.create_sheet("Customers")
ws2.append(["name", "country", "since"])
ws2.append(["ACME", "US", dt.time(8, 30)])
ws2.append(["Globex", "FR", dt.time(17, 45)])
ws2.merge_cells("B4:C4")
ws2["A4"] = "Total"
ws2["B4"] = "merged"
ws3 = wb.create_sheet("Secret")
ws3.append(["k", "v"])
ws3.append(["a", 1])
ws3.sheet_state = "hidden"
wb.create_sheet("Empty")
wb.save(P("workbook.xlsx"))

# --- XLSX: formulas without a stored result, merged cells, hidden row and column, defined name ---
from openpyxl.workbook.defined_name import DefinedName  # noqa: E402
wf = openpyxl.Workbook()
sales = wf.active
sales.title = "Sales"
sales.append(["item", "qty", "price", "total"])
sales.append(["pen", 2, 1.5, "=B2*C2"])
sales.append(["ink", 3, 4.0, "=B3*C3"])
sales.append(["pad", 1, 9.9, "=B4*C4"])
sales.append(["note", "merged value"])
sales.merge_cells("B5:C5")
sales.row_dimensions[3].hidden = True
sales.column_dimensions["C"].hidden = True
wf.defined_names["TotalQty"] = DefinedName("TotalQty", attr_text="Sales!$B$2:$B$4")
wf.create_sheet("Notes")["A1"] = "plain"
wf.save(P("features.xlsx"))

# --- JSON (nested object with two record lists + root fields) ---
json.dump({
    "meta": {"source": "crm", "version": 3},
    "customers": [
        {"id": 1, "name": "Ana", "address": {"city": "Lisboa", "zip": "1000"}, "tags": ["vip", "eu"]},
        {"id": 2, "name": "Ben", "address": {"city": "Berlin"}, "tags": []},
    ],
    "orders": [{"id": 10, "customer": 1, "total": 99.9}, {"id": 11, "customer": 2, "total": None}],
}, open(P("nested.json"), "w", encoding="utf-8"), ensure_ascii=False)

# --- NDJSON ---
with open(P("events.ndjson"), "w", encoding="utf-8") as f:
    for i in range(3):
        f.write(json.dumps({"ts": f"2024-01-0{i + 1}T10:00:00Z", "level": "info", "ctx": {"user": i}}) + "\n")

# --- XML ---
with open(P("catalog.xml"), "w", encoding="utf-8") as f:
    f.write("""<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <books>
    <book id="b1" lang="en"><title>Dune</title><price currency="EUR">9.99</price><author><name>Herbert</name></author></book>
    <book id="b2" lang="fr"><title>L'Étranger</title><price currency="EUR">7.5</price><author><name>Camus</name></author></book>
  </books>
  <stores><store>Paris</store><store>Lyon</store></stores>
</catalog>""")

# --- YAML ---
with open(P("team.yaml"), "w", encoding="utf-8") as f:
    f.write("""team: data
members:
  - name: Kim
    joined: 2023-04-01
    skills: [sql, python]
  - name: Lee
    joined: 2024-09-15
    skills: [r]
""")

# --- YAML with several documents (Kubernetes style) ---
with open(P("multi.yaml"), "w", encoding="utf-8") as f:
    f.write("kind: Service\nname: web\nport: 80\n---\nkind: Deployment\nname: web\nreplicas: 3\n---\nkind: Service\nname: db\nport: 5432\n")

# --- HTML (two data tables, spans, caption, a layout table containing another table) ---
with open(P("page.html"), "w", encoding="utf-8") as f:
    f.write("""<!doctype html><html><head><title>Report</title><script>alert(1)</script></head><body>
<table><tr><td>layout<table id="kpis"><caption>Quarterly KPIs</caption>
<thead><tr><th rowspan="2">Region</th><th colspan="2">Sales</th></tr><tr><th>Q1</th><th>Q2</th></tr></thead>
<tbody><tr><td>North</td><td>10</td><td>12</td></tr><tr><td>South</td><td>8</td><td>9<br>(est.)</td></tr></tbody>
</table></td></tr></table>
<table><tr><td>a|b</td><td>1</td></tr><tr><td>c</td><td>2</td></tr></table>
<img src="https://example.com/tracker.png">
</body></html>""")

# --- SPSS: labels, value labels, missing values, measure, dates, long names, long strings ---
df = pd.DataFrame({
    "respondent_identifier": [1, 2, 3, 4],
    "gender": [1, 2, 2, 9],
    "age": [34, 51, None, 28],
    "visit": [dt.datetime(2024, 1, 15), dt.datetime(2024, 2, 20), None, dt.datetime(2024, 3, 1)],
    "comment": ["ok", "très bien", "", "x" * 300],
    "city": ["NY", "LA", "SF", "NY"],
})
meta_args = dict(
    file_label="Customer survey 2024",
    column_labels=["Respondent ID", "Gender of respondent", "Age in years", "Visit date", "Free comment", "City"],
    variable_value_labels={"gender": {1: "Male", 2: "Female", 9: "Refused"}, "city": {"NY": "New York", "LA": "Los Angeles"}},
    missing_ranges={"gender": [9], "age": [{"lo": 97, "hi": 99}]},
    variable_measure={"gender": "nominal", "age": "scale", "city": "nominal"},
    note="Collected by phone.",
)
pyreadstat.write_sav(df, P("survey.sav"), **meta_args)
pyreadstat.write_sav(df, P("survey_bytecode.sav"), row_compress=True, **meta_args)
pyreadstat.write_sav(df, P("survey.zsav"), compress=True, **meta_args)

# --- Parquet: several codecs and types ---
table = pa.table({
    "id": pa.array([1, 2, 3], pa.int64()),
    "price": pa.array([1.5, None, 3.25]),
    "name": pa.array(["a", "b", None]),
    "ok": pa.array([True, False, True]),
    "day": pa.array([dt.date(2024, 1, 1), dt.date(2024, 1, 2), None], pa.date32()),
    "at": pa.array([dt.datetime(2024, 1, 1, 12, 0), dt.datetime(2024, 1, 2, 0, 0), None], pa.timestamp("ms")),
    "amount": pa.array([decimal.Decimal("10.50"), decimal.Decimal("0.01"), None], pa.decimal128(10, 2)),
    "tags": pa.array([["x", "y"], [], None], pa.list_(pa.string())),
    "geo": pa.array([{"lat": 1.0, "lon": 2.0}, {"lat": 3.0, "lon": 4.0}, None], pa.struct([("lat", pa.float64()), ("lon", pa.float64())])),
}).replace_schema_metadata({"owner": "data-team"})
for codec in ["snappy", "gzip", "zstd", "lz4", "none", "brotli"]:
    pq.write_table(table, P(f"table_{codec}.parquet"), compression=codec)

# --- Parquet: nested types (struct in struct, list, list of struct, map), required field, decimal, timestamp with unit, pandas metadata ---
import pandas as pd  # noqa: E402
nested_schema = pa.schema([
    pa.field("id", pa.int64(), nullable=False),
    pa.field("name", pa.string()),
    pa.field("when", pa.timestamp("us", tz="UTC")),
    pa.field("price", pa.decimal128(12, 3)),
    pa.field("geo", pa.struct([("lat", pa.float64()), ("lon", pa.float64()), ("meta", pa.struct([("src", pa.string()), ("acc", pa.float32())]))])),
    pa.field("tags", pa.list_(pa.string())),
    pa.field("items", pa.list_(pa.struct([("sku", pa.string()), ("qty", pa.int32())]))),
    pa.field("attrs", pa.map_(pa.string(), pa.int64())),
])
nested_rows = {
    "id": [1, 2, 3],
    "name": ["a", None, "c"],
    "when": [dt.datetime(2024, 1, 1, 12, 0, tzinfo=dt.timezone.utc), None, dt.datetime(2024, 3, 5, 8, 30, tzinfo=dt.timezone.utc)],
    "price": [decimal.Decimal("10.500"), decimal.Decimal("0.125"), None],
    "geo": [{"lat": 1.5, "lon": 2.5, "meta": {"src": "gps", "acc": 0.5}}, {"lat": 3.5, "lon": 4.5, "meta": None}, None],
    "tags": [["x", "y"], [], None],
    "items": [[{"sku": "A1", "qty": 2}, {"sku": "B2", "qty": 1}], [], None],
    "attrs": [[("k1", 1), ("k2", 2)], [], None],
}
pdf = pd.DataFrame({"id": nested_rows["id"], "name": nested_rows["name"]}, index=pd.Index([10, 11, 12], name="rowkey"))
base = pa.Table.from_pandas(pdf, preserve_index=True)  # carries the pandas metadata
nested_table = pa.table({k: pa.array(v, type=nested_schema.field(k).type) for k, v in nested_rows.items()}, schema=nested_schema)
nested_table = nested_table.replace_schema_metadata(base.schema.metadata)
pq.write_table(nested_table, P("nested.parquet"), compression="snappy", row_group_size=2)

# --- SQLite: FK, view, NULLs, BLOB ---
db_path = P("shop.sqlite")
if os.path.exists(db_path):
    os.remove(db_path)
con = sqlite3.connect(db_path)
con.executescript("""
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), total REAL, note BLOB);
CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 50;
INSERT INTO customers VALUES (1, 'Ana', 'ana@example.com'), (2, 'Ben', NULL);
INSERT INTO orders VALUES (10, 1, 99.9, X'DEADBEEF'), (11, 2, NULL, NULL);
""")
con.commit()
con.close()

# --- SQLite: composite keys, generated columns, 64-bit integers, indexes, implicit FK, view with definition ---
db_path = P("schema_features.sqlite")
if os.path.exists(db_path):
    os.remove(db_path)
con = sqlite3.connect(db_path)
con.executescript("""
CREATE TABLE parent (k1 INTEGER, k2 INTEGER, label TEXT, PRIMARY KEY (k1, k2));
CREATE TABLE child (
  id INTEGER PRIMARY KEY,
  a INTEGER, b INTEGER,
  qty INTEGER DEFAULT 1 CHECK (qty >= 0),
  total INTEGER GENERATED ALWAYS AS (qty * 2) VIRTUAL,
  stored_total INTEGER GENERATED ALWAYS AS (qty + 1) STORED,
  FOREIGN KEY (a, b) REFERENCES parent (k1, k2) ON DELETE CASCADE
);
CREATE UNIQUE INDEX child_qty_a_uq ON child (qty, a);
CREATE INDEX child_a_ix ON child (a);
CREATE TABLE pk_order (x TEXT, y TEXT, PRIMARY KEY (y, x));
CREATE TABLE singles (id INTEGER PRIMARY KEY, v TEXT);
CREATE TABLE refs (id INTEGER PRIMARY KEY, sid INTEGER REFERENCES singles);
CREATE TABLE big (n INTEGER);
CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, manager_id INTEGER REFERENCES people (id));
CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT);
CREATE TABLE people_tags (person_id INTEGER REFERENCES people (id), tag_id INTEGER REFERENCES tags (id), PRIMARY KEY (person_id, tag_id));
CREATE TABLE profiles (person_id INTEGER PRIMARY KEY REFERENCES people (id), bio TEXT);
CREATE VIEW v_child AS SELECT id, a FROM child WHERE qty > 0;
INSERT INTO parent VALUES (1, 1, 'p11'), (1, 2, 'p12');
INSERT INTO child (id, a, b, qty) VALUES (1, 1, 2, 3), (2, 1, 1, 4);
INSERT INTO big VALUES (9007199254740993), (-9223372036854775808), (9223372036854775807);
""")
con.commit()
con.close()

# --- XLSX without declared relationships: inferred ones, and traps (no overlap, partial overlap, non-unique parent, two parents) ---
wr = openpyxl.Workbook()
sheets = {
    "customers": (["id", "name"], [[1, "Ann"], [2, "Ben"], [3, "Cy"], [4, "Di"], [5, "Ed"]]),
    "orders": (["order_id", "customer_id", "total"], [[1, 1, 9.5], [2, 2, 3.25], [3, 3, 7.0], [4, 3, 1.5], [5, 5, 4.75], [6, 2, 8.0]]),
    "products": (["product_id", "title"], [[10, "pen"], [20, "ink"], [30, "pad"]]),
    "order_lines": (["order_id", "product_id", "qty"], [[1, 10, 2], [1, 20, 1], [2, 10, 5], [3, 30, 1], [3, 20, 2], [6, 10, 4]]),
    "profiles": (["customer_id", "bio"], [[1, "likes pens"], [2, "likes ink"], [3, "likes pads"]]),
    "visits": (["customer_id", "day"], [[1, "2024-01-01"], [2, "2024-01-02"], [3, "2024-01-03"], [90, "2024-01-04"], [91, "2024-01-05"], [1, "2024-01-06"]]),
    "audit": (["customer_id", "event"], [[100 + i, "login"] for i in range(11)]),
}
wr.remove(wr.active)
for sheet_name, (head, body) in sheets.items():
    sh = wr.create_sheet(sheet_name)
    sh.append(head)
    for r in body:
        sh.append(r)
wr.save(P("relations.xlsx"))

# --- Data profile: every kind of column ---
with open(P("profile.csv"), "w", encoding="utf-8", newline="") as f:
    f.write("id,group,score,day,note,flag,mix,empty,price_fr,amb\n")
    rows = [
        ("1", "A", "1.5", "2024-01-01", "first note", "x", "true", "", '"12,50"', '"1,5"'),
        ("2", "A", "1.5", "2024-01-02", "second note", "x", "1", "", '"8,00"', "2.5"),
        ("3", "B", "1.5", "2024-01-03", "third note", "x", "false", "", '"7,25"', '"3,5"'),
        ("4", "B", "1.5", "2024-01-04", "fourth note", "x", "2", "", '"9,99"', "4.5"),
        ("5", "A", "1.5", "2024-01-05", "fifth note", "x", "true", "", '"10,00"', '"5,5"'),
        ("6", "C", "11.5", "2024-01-06", "sixth note", "x", "1", "", '"11,11"', "6.5"),
        ("7", "A", "1.5", "2024-01-07", "seventh note", "x", "false", "", '"3,50"', '"7,5"'),
        ("8", "B", "1.5", "2024-01-08", "eighth note", "x", "2", "", '"4,75"', "8.5"),
        ("9", "A", "1.5", "2024-01-09", "ninth note", "x", "true", "", '"6,20"', '"9,5"'),
        ("10", "B", "1.5", "2024-01-10", "tenth note", "x", "1", "", '"5,40"', "10.5"),
    ]
    for r in rows:
        f.write(",".join(r) + "\n")
with open(P("dupes.csv"), "w", encoding="utf-8", newline="") as f:
    f.write("a,b\n1,x\n1,x\n2,y\n")

# --- "Do not share data", every format: one small file per format with canary values wherever something must stay out ---
#   CONFIDENTIAL_REC     a record (cell value): never in the prompt, at any level
#   CONFIDENTIAL_TEXT    free text (comments, file label, notes, embedded metadata): only when the user allows it
#   CONFIDENTIAL_SQL     a literal in a SQL definition: only when the user allows it
#   CONFIDENTIAL_FORMULA a literal inside a spreadsheet formula: never
#   CONFIDENTIAL_COL     a name (column, sheet, table, key, caption): only when names are shared
#   CONFIDENTIAL_LABEL   a variable or value label: only when labels are shared
#   CONFIDENTIAL_FILE    the file name: only when the file name is shared
from openpyxl.workbook.defined_name import DefinedName as _DefinedName  # noqa: E402
NCAN = 12
C_REC = [f"CONFIDENTIAL_REC_{i + 1:02d}" for i in range(NCAN)]
C_NUM = [100 + i * 3 for i in range(NCAN)]
C_CAT = ["common"] * 8 + ["other"] * 3 + ["CONFIDENTIAL_REC_RARE"]   # the rare one has 1 record: always hidden
CA, CB, CC = "CONFIDENTIAL_COL_A", "CONFIDENTIAL_COL_B", "CONFIDENTIAL_COL_C"
def Q(fmt, ext):
    return P(f"CONFIDENTIAL_FILE_{fmt}.{ext}")
for fmt, ext, sep in (("csv", "csv", ","), ("tsv", "tsv", "\t"), ("txt", "txt", ";")):
    with open(Q(fmt, ext), "w", encoding="utf-8", newline="") as f:
        f.write(sep.join([CA, CB, CC]) + "\n")
        for r, n, c in zip(C_REC, C_NUM, C_CAT):
            f.write(sep.join([r, str(n), c]) + "\n")
cwb = openpyxl.Workbook()
csh = cwb.active
csh.title = "CONFIDENTIAL_COL_SHEET"
csh.append([CA, CB, CC, "calc"])
for i, (r, n, c) in enumerate(zip(C_REC, C_NUM, C_CAT)):
    csh.append([r, n, c, ('=IF(A%d="CONFIDENTIAL_FORMULA","x","y")' % (i + 2)) if i < 3 else None])
csh["A2"].comment = Comment("CONFIDENTIAL_TEXT_COMMENT", "tester")
cwb.defined_names["CONFIDENTIAL_COL_NAME"] = _DefinedName("CONFIDENTIAL_COL_NAME", attr_text="CONFIDENTIAL_COL_SHEET!$B$2:$B$13")
cwb.defined_names["CONFIDENTIAL_COL_CONST"] = _DefinedName("CONFIDENTIAL_COL_CONST", attr_text='"CONFIDENTIAL_REC_CONSTVAL"')  # a constant is a value
cwb.save(Q("xlsx", "xlsx"))
c_rows = [{CA: r, CB: n, CC: c, "CONFIDENTIAL_COL_NEST": {"CONFIDENTIAL_COL_DEEP": f"CONFIDENTIAL_REC_DEEP_{i + 1:02d}"}}
          for i, (r, n, c) in enumerate(zip(C_REC, C_NUM, C_CAT))]
json.dump(c_rows, open(Q("json", "json"), "w", encoding="utf-8"))
with open(Q("ndjson", "ndjson"), "w", encoding="utf-8") as f:
    for row in c_rows:
        f.write(json.dumps(row) + "\n")
with open(Q("yaml", "yaml"), "w", encoding="utf-8") as f:
    for r, n, c in zip(C_REC, C_NUM, C_CAT):
        f.write(f"- {CA}: {r}\n  {CB}: {n}\n  {CC}: {c}\n")
with open(Q("xml", "xml"), "w", encoding="utf-8") as f:
    f.write("<CONFIDENTIAL_COL_ROOT>\n")
    for r, n, c in zip(C_REC, C_NUM, C_CAT):
        f.write(f'<row CONFIDENTIAL_COL_ATTR="{r}_ATTR"><{CA}>{r}</{CA}><{CB}>{n}</{CB}><{CC}>{c}</{CC}></row>\n')
    f.write("</CONFIDENTIAL_COL_ROOT>\n")
with open(Q("html", "html"), "w", encoding="utf-8") as f:
    f.write(f"<!doctype html><html><body><table><caption>CONFIDENTIAL_COL_CAPTION</caption><thead><tr><th>{CA}</th><th>{CB}</th><th>{CC}</th></tr></thead><tbody>")
    for r, n, c in zip(C_REC, C_NUM, C_CAT):
        f.write(f"<tr><td>{r}</td><td>{n}</td><td>{c}</td></tr>")
    f.write("</tbody></table></body></html>")
cdf = pd.DataFrame({CA: C_REC, CB: C_NUM, CC: [1] * 8 + [2] * 3 + [3]})
cmeta = dict(file_label="CONFIDENTIAL_TEXT_FILELABEL", note="CONFIDENTIAL_TEXT_NOTE",
             column_labels=["CONFIDENTIAL_LABEL_A", "CONFIDENTIAL_LABEL_B", "CONFIDENTIAL_LABEL_C"],
             variable_value_labels={CC: {1: "common_label", 2: "other_label", 3: "CONFIDENTIAL_LABEL_V3"}})
pyreadstat.write_sav(cdf, Q("sav", "sav"), **cmeta)
pyreadstat.write_sav(cdf, Q("zsav", "zsav"), compress=True, **cmeta)
ctbl = pa.table({
    CA: C_REC, CB: pa.array(C_NUM, pa.int64()), CC: C_CAT,
    "CONFIDENTIAL_COL_STRUCT": pa.array([{"CONFIDENTIAL_COL_FIELD": f"CONFIDENTIAL_REC_S_{i + 1:02d}", "n": i} for i in range(NCAN)],
                                        pa.struct([("CONFIDENTIAL_COL_FIELD", pa.string()), ("n", pa.int64())])),
    "CONFIDENTIAL_COL_ITEMS": pa.array([[{"CONFIDENTIAL_COL_SKU": f"CONFIDENTIAL_REC_ITEM_{i + 1:02d}"}] for i in range(NCAN)],
                                       pa.list_(pa.struct([("CONFIDENTIAL_COL_SKU", pa.string())]))),
}).replace_schema_metadata({"note": "CONFIDENTIAL_TEXT_META"})
pq.write_table(ctbl, Q("parquet", "parquet"), compression="snappy")
cdb = Q("sqlite", "sqlite")
if os.path.exists(cdb):
    os.remove(cdb)
ccon = sqlite3.connect(cdb)
ccon.executescript(f"""
CREATE TABLE CONFIDENTIAL_COL_PARENT (CONFIDENTIAL_COL_ID INTEGER PRIMARY KEY, label TEXT);
CREATE TABLE CONFIDENTIAL_COL_TABLE ({CA} TEXT DEFAULT 'CONFIDENTIAL_SQL_DEFAULT', {CB} INTEGER, {CC} TEXT,
  CONFIDENTIAL_COL_PID INTEGER REFERENCES CONFIDENTIAL_COL_PARENT (CONFIDENTIAL_COL_ID));
CREATE INDEX CONFIDENTIAL_COL_INDEX ON CONFIDENTIAL_COL_TABLE ({CB});
INSERT INTO CONFIDENTIAL_COL_PARENT VALUES (1, 'CONFIDENTIAL_REC_PARENT');
CREATE VIEW CONFIDENTIAL_COL_VIEW AS SELECT {CA} FROM CONFIDENTIAL_COL_TABLE WHERE {CA} = 'CONFIDENTIAL_SQL_LITERAL';
""")
ccon.executemany("INSERT INTO CONFIDENTIAL_COL_TABLE (CONFIDENTIAL_COL_A, CONFIDENTIAL_COL_B, CONFIDENTIAL_COL_C, CONFIDENTIAL_COL_PID) VALUES (?, ?, ?, 1)", list(zip(C_REC, C_NUM, C_CAT)))
ccon.commit()
ccon.close()

# --- SQL dump and PostgreSQL archive: REAL pg_dump output of a database full of canaries (tests/make_sql_fixtures.sh, src/canary-pg.sql) ---
_canary = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sql-fixtures", "canary")
shutil.copy(os.path.join(_canary, "pg16-canary.sql"), Q("sql", "sql"))
shutil.copy(os.path.join(_canary, "pg16-canary.dump"), Q("pgdump", "dump"))

# --- "Do not share data": the scenarios found by the independent review (stage 7), as regression fixtures ---
with open(P("headerless.csv"), "w", encoding="utf-8", newline="") as f:   # no header row: the first record looks like one
    for i in range(6):
        f.write(f"CONFIDENTIAL_REC_NAME_{i},person{i}.CONFIDENTIAL_REC@corp.com,CONFIDENTIAL_REC_DIAG_{i % 2}\n")
with open(P("fewvalues.csv"), "w", encoding="utf-8", newline="") as f:     # columns with 1 or 2 values in a 12-row table
    f.write("id,salary,two,day\n")
    for i in range(12):
        f.write(f"{i + 1},{'987654' if i == 0 else ''},{('111111' if i == 0 else '222222') if i < 2 else ''},{'2019-03-14' if i == 0 else ''}\n")
with open(P("longdates.csv"), "w", encoding="utf-8", newline="") as f:     # text after a date, beyond the type-detection window
    f.write("id,day\n")
    for i in range(20010):
        day = "2099-12-31 CONFIDENTIAL_REC_DATENOTE" if i >= 20005 else f"2024-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}"
        f.write(f"{i},{day}\n")
with open(P("broken.json"), "w", encoding="utf-8") as f:                   # a parse error message would quote the file
    f.write('{"a": CONFIDENTIAL_REC_ERR }')
with open(P("mapkeys.json"), "w", encoding="utf-8") as f:                  # keys that are data (e-mails)
    json.dump({"scores": {"alice@example.org": 3, "bob@example.org": 5}, "team": "x"}, f)
with open(P("flags.csv"), "w", encoding="utf-8", newline="") as f:         # one hidden group could be worked out by subtraction
    f.write("id,flag\n")
    for i in range(30):
        f.write(f"{i},{'true' if i < 3 else 'false'}\n")

# --- "Do not share data": values that must never reach the prompt, whatever the level ---
with open(P("confidential.csv"), "w", encoding="utf-8", newline="") as f:
    f.write("customer,email,segment,amount,signup,note\n")
    segs = ["gold"] * 6 + ["silver"] * 5 + ["CONFIDENTIAL_SEGMENT_X"]
    for i in range(12):
        cust = "CONFIDENTIAL_CUSTOMER_74291" if i == 0 else f"Cust_{i + 1:02d}"
        email = "ana.secret@example.com" if i == 0 else f"cust{i + 1:02d}@example.com"
        note = "call CONFIDENTIAL_NOTE_123 tomorrow" if i == 0 else f"note number {i + 1}"
        f.write(f"{cust},{email},{segs[i]},{100 + i * 7.25:.2f},2024-01-{i + 1:02d},{note}\n")

# --- Large CSV to trigger the warning ---
with open(P("big.csv"), "w", encoding="utf-8", newline="") as f:
    f.write("id,label,value,category,created\n")
    for i in range(120000):
        f.write(f"{i},item number {i},{i * 0.37:.2f},cat{i % 7},2024-01-{(i % 28) + 1:02d}\n")

# --- Injection attempts: must be shown as text in the formatted view, never executed or loaded ---
with open(P("tricky.csv"), "w", encoding="utf-8", newline="") as f:
    f.write('name,html,md\n')
    f.write('A,"<img src=https://example.com/x.png onerror=alert(1)>","**bold** [js](javascript:alert(1)) ![i](https://example.com/y.png)"\n')
    f.write('B,"<script>alert(2)</script>","[ok](https://example.org)"\n')

# --- Error cases ---
with open(P("unknown.xyz"), "w") as f:
    f.write("hello")
with open(P("fake.xlsx"), "w") as f:
    f.write("this is not a spreadsheet")

print("fixtures written to", out)

# --- the real SQL dumps and PostgreSQL archives of tests/sql-fixtures, so the browser tests can load them by name ---
_sqlfix = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sql-fixtures")
for _f in sorted(os.listdir(_sqlfix)):
    if _f.endswith((".sql", ".dump", ".tar")) and os.path.isfile(os.path.join(_sqlfix, _f)):
        shutil.copy(os.path.join(_sqlfix, _f), P(_f))

# --- DBF: real files of tests/dbf-fixtures (written by an independent library) and their canary (tests/make_dbf_fixtures.py) ---
_dbf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dbf-fixtures")
for _f in sorted(os.listdir(_dbf)):
    if _f.endswith(".dbf"):
        shutil.copy(os.path.join(_dbf, _f), P(_f))
shutil.copy(os.path.join(_dbf, "canary", "CONFIDENTIAL_FILE_dbf.dbf"), Q("dbf", "dbf"))

# --- DuckDB "EXPORT DATABASE" folders as zip files (real exports of tests/sql-fixtures): CSV in a folder, Parquet flat, and one without a data file ---
import zipfile
for _name, _kind, _prefix, _skip in (("duckdb-csv.zip", "csv", "shop/", None), ("duckdb-parquet.zip", "parquet", "", None), ("duckdb-missing.zip", "csv", "", "orders.csv")):
    _d = os.path.join(_sqlfix, "duckdb-export-" + _kind)
    with zipfile.ZipFile(P(_name), "w", zipfile.ZIP_DEFLATED) as _z:
        for _f in sorted(os.listdir(_d)):
            if _f != _skip:
                _z.write(os.path.join(_d, _f), _prefix + _f)

# --- Access: real files written by Jackcess (NOT by Microsoft Access), and their canary (tests/make_access_fixtures.sh) ---
_acc = os.path.join(os.path.dirname(os.path.abspath(__file__)), "access-fixtures")
for _f in sorted(os.listdir(_acc)):
    if _f.endswith((".accdb", ".mdb")) and not _f.startswith("CONFIDENTIAL"):
        shutil.copy(os.path.join(_acc, _f), P(_f))
shutil.copy(os.path.join(_acc, "CONFIDENTIAL_FILE_access.accdb"), Q("access", "accdb"))

# --- SQL Server data-tier packages: REAL .dacpac files built by Microsoft's DacFx (tests/make_dacpac_fixtures.sh) and their canary ---
_dac = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dacpac-fixtures")
shutil.copy(os.path.join(_dac, "shop.dacpac"), P("shop.dacpac"))
shutil.copy(os.path.join(_dac, "CONFIDENTIAL_FILE_dacpac.dacpac"), Q("dacpac", "dacpac"))
