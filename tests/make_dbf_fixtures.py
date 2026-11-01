"""Regenerates tests/dbf-fixtures/: REAL .dbf files written by the independent `dbf` library (not by DataBrief) in several flavours
and code pages, with expected.json = the values that went IN (the oracle of tests/test_dbf.cjs). Run in the test environment:
    python tests/make_dbf_fixtures.py
The results are committed, so the tests do not need this library. Memo files (.dbt/.fpt) are deliberately not kept: DataBrief
reads the .dbf only. All values are made up; nothing personal."""
import datetime as dt
import decimal
import json
import os
import shutil
import dbf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "dbf-fixtures")
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
expected = {}


def fmt_num(v, dec):
    return "" if v is None else (f"{v:.{dec}f}" if dec else str(int(v)))


def make(name, spec, rows, dbf_type, codepage, kinds, delete=(), nulls=False):
    """kinds: how each value is written in the expected text: C text, N(dec) number, D date, L logical, M memo, I int, Y currency, B double, T datetime."""
    path = os.path.join(OUT, name + ".dbf")
    t = dbf.Table(path, spec, dbf_type=dbf_type, codepage=codepage, on_disk=True)
    t.open(dbf.READ_WRITE)
    for r in rows:
        t.append(tuple(r))
    for i in delete:
        dbf.delete(t[i])
    t.close()
    for ext in (".dbt", ".fpt", ".cdx", ".idx"):
        p = os.path.join(OUT, name + ext)
        if os.path.exists(p):
            os.remove(p)
    exp_rows = []
    for k, r in enumerate(rows):
        if k in delete:
            continue
        out = []
        for v, kind in zip(r, kinds):
            if v is None and kind in ("I", "Y"):
                out.append("0")          # this library stores a null integer / currency as zero bytes (it does not write VFP null flags)
            elif v is None or kind == "M":
                out.append("")
            elif kind == "C":
                out.append(v.rstrip(" "))
            elif kind.startswith("N"):
                out.append(fmt_num(v, int(kind[1:] or 0)))
            elif kind == "D":
                out.append(v.isoformat())
            elif kind == "L":
                out.append("true" if v else "false")
            elif kind == "I":
                out.append(str(int(v)))
            elif kind == "Y":
                out.append(format(decimal.Decimal(str(v)).normalize(), "f"))
            elif kind == "B":
                out.append(repr(float(v))[:-2] if repr(float(v)).endswith(".0") else repr(float(v)))
            elif kind == "T":
                out.append(v.strftime("%Y-%m-%d %H:%M:%S"))
            else:
                raise ValueError(kind)
        exp_rows.append(out)
    expected[name] = {"columns": [part.split()[0].upper() for part in spec.split(";")], "rows": exp_rows, "deleted": len(delete), "records": len(rows), "codepage": codepage, "type": dbf_type}


D = dt.date
# 1. dBase III, Windows-1252: text, numbers, a date, a logical, a memo (not read), an empty record and a deleted one
make("dbase3", "NAME C(20); AMOUNT N(10,2); QTY N(5,0); DAY D; OK L; NOTE M",
     [("Alice Martin", 12.5, 3, D(2024, 1, 15), True, "a memo that is not read"),
      ("René Dupré", -7.25, 0, D(2024, 2, 29), False, ""),
      ("", None, None, None, None, ""),
      ("Zoë O'Brien", 1000000.0, 12345, D(1999, 12, 31), True, "x"),
      ("deleted row", 1.0, 1, D(2000, 1, 1), True, "")],
     "db3", "cp1252", ["C", "N2", "N", "D", "L", "M"], delete=(4,))
# 2. DOS code page 437 (accents and box characters as written by old software)
make("dos437", "LABEL C(24); N N(6,1)",
     [("Café ñandú über", 1.5), ("£ ¥ ½ ¼ ± ÷ °", 2.0), ("æ Æ ô ö û ÿ", 3.25)],
     "db3", "cp437", ["C", "N1"])
# 3. Cyrillic (DOS 866) and Windows-1251
make("cyrillic866", "CITY C(20); POP N(8,0)", [("Москва", 12600000), ("Санкт-Петербург", 5600000), ("Київ", 2900000)], "db3", "cp866", ["C", "N"])
make("cyrillic1251", "CITY C(20); POP N(8,0)", [("Москва", 12600000), ("Новосибирск", 1600000)], "db3", "cp1251", ["C", "N"])
# 4. FoxPro 2.x with a memo
make("foxpro", "TITLE C(30); PRICE N(8,2); ADDED D; DESCR M",
     [("Widget", 9.99, D(2023, 5, 1), "long text"), ("Gadget", 24.5, D(2023, 6, 15), "")],
     "fp", "cp1252", ["C", "N2", "D", "M"])
# 5. Visual FoxPro: integer, currency, double, datetime, nullable text, logical
make("vfp", "ID I; PRICE Y; RATIO B; STAMP T; NAME C(12) null; FLAG L; QTY I null; AMT Y null",
     [(1, 12.34, 3.14159, dt.datetime(2024, 3, 9, 14, 30, 5), "alpha", True, 7, 1.5),
      (2, 0.5, -2.5, dt.datetime(2020, 12, 31, 23, 59, 59), None, False, None, None),
      (-3, 1000.0, 0.0, dt.datetime(1999, 1, 1, 0, 0, 0), "", None, 0, 0.0)],
     "vfp", "cp1252", ["I", "Y", "B", "T", "C", "L", "I", "Y"])
# 6. No record at all
make("empty", "A C(5); B N(3,0)", [], "db3", "cp1252", ["C", "N"])

with open(os.path.join(OUT, "expected.json"), "w", encoding="utf-8") as f:
    json.dump(expected, f, ensure_ascii=False, indent=1)
# The canary of the "Do not share data" tests (see make_fixtures.py): field names are limited to 10 characters, so the name marker is CONF_COL.
os.makedirs(os.path.join(OUT, "canary"), exist_ok=True)
C_CAT = ["common"] * 8 + ["other"] * 3 + ["CONFIDENTIAL_REC_RARE"]
cpath = os.path.join(OUT, "canary", "CONFIDENTIAL_FILE_dbf.dbf")
ct = dbf.Table(cpath, "CONF_COL_A C(24); CONF_COL_B N(5,0); CONF_COL_C C(24); CONF_COL_M M", dbf_type="db3", codepage="cp1252", on_disk=True)
ct.open(dbf.READ_WRITE)
for i in range(12):
    ct.append(("CONFIDENTIAL_REC_%02d" % (i + 1), 100 + i * 3, C_CAT[i], "CONFIDENTIAL_TEXT_MEMO"))
ct.close()
for ext in (".dbt", ".fpt"):
    if os.path.exists(cpath[:-4] + ext):
        os.remove(cpath[:-4] + ext)
# 7. A cut file: the header promises more records than the file holds
src = open(os.path.join(OUT, "dbase3.dbf"), "rb").read()
open(os.path.join(OUT, "cut.dbf"), "wb").write(src[: len(src) - 90])
# The DOS code pages TextDecoder does not know: bytes 128-255 as Python's own codecs decode them (undefined bytes -> U+FFFD).
# They become src/dbf-codepages.js (generated: do not edit by hand).
DOS = ("cp437", "cp850", "cp852", "cp857", "cp737", "cp860", "cp861", "cp863", "cp865")
lines = ["/* DataBrief - DOS code pages for DBF files: the characters of bytes 128-255. GENERATED by tests/make_dbf_fixtures.py from Python's",
         " * codecs: do not edit by hand. GPL-3.0-or-later. */", "'use strict';", "window.DB = window.DB || {};", "window.DB.DBF_CODEPAGES = {"]
for cp in DOS:
    lines.append("  %s: %s," % (cp[2:], json.dumps(bytes(range(128, 256)).decode(cp, errors="replace"), ensure_ascii=True)))
lines.append("};")
open(os.path.join(HERE, "..", "src", "dbf-codepages.js"), "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
# the language-driver byte -> code page, as the library knows it: the oracle of the reader's own table
import dbf.tables as _T
json.dump({"0x%02x" % k: v[0] for k, v in _T.code_pages.items()}, open(os.path.join(OUT, "langids.json"), "w"), indent=1, sort_keys=True)
print("dbf", dbf.version, "->", sorted(os.listdir(OUT)))
