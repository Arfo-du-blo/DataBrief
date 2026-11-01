"""Generate test files for DataBrief, one per supported format (plus edge cases).
Run inside an isolated venv with: pandas pyarrow pyreadstat openpyxl
    python make_fixtures.py OUT_DIR
"""
import datetime as dt
import decimal
import json
import os
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
CREATE VIEW v_child AS SELECT id, a FROM child WHERE qty > 0;
INSERT INTO parent VALUES (1, 1, 'p11'), (1, 2, 'p12');
INSERT INTO child (id, a, b, qty) VALUES (1, 1, 2, 3), (2, 1, 1, 4);
INSERT INTO big VALUES (9007199254740993), (-9223372036854775808), (9223372036854775807);
""")
con.commit()
con.close()

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
