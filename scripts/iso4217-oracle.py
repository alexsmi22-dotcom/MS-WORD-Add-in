"""
ISO 4217 check for fin-currency (Release E5a): reads SIX's "List One: Current currency & funds" XML and writes the
distinct alphabetic codes with numeric code, minor units, name and fund flag, plus the list's published date, to
src/lib/__tests__/fixtures/iso4217-list-one.json. The jest suite compares src/lib/currency.ts against it code by code.

Source: https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
(SIX Financial Information AG is the ISO 4217 maintenance agency). Download it first, then:

Run: jurislab-oracle-venv python -I scripts/iso4217-oracle.py path/to/list-one.xml
"""
import json, os, sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "iso4217-list-one.json")

root = ET.parse(sys.argv[1]).getroot()
codes = {}
for e in root.iter("CcyNtry"):
    c = e.findtext("Ccy")
    if not c:
        continue  # e.g. ANTARCTICA: "No universal currency"
    nm = e.find("CcyNm")
    rec = {"numeric": e.findtext("CcyNbr"), "minor": e.findtext("CcyMnrUnts"), "name": nm.text.strip(), "fund": nm.get("IsFund") == "true"}
    if c in codes and {k: codes[c][k] for k in ("numeric", "minor", "name")} != {k: rec[k] for k in ("numeric", "minor", "name")}:
        raise SystemExit(f"conflicting entries for {c}: {codes[c]} vs {rec}")
    if c in codes:
        codes[c]["fund"] = codes[c]["fund"] or rec["fund"]
    else:
        codes[c] = rec
json.dump({"published": root.get("Pblshd"), "count": len(codes), "codes": dict(sorted(codes.items()))},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", OUT, len(codes), "codes, published", root.get("Pblshd"))
