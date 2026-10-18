"""Generates src/lib/cdxTags.ts from Revvity's open-source ChemDraw format code (BSD 3-Clause).

Usage: download github.com/Glysade/chemdraw (chemdraw/*.cpp, *.h and license.txt) into one folder,
copy this script and gen-cdx-tags.types.txt (as types.txt) beside them, and run
    python gen-cdx-tags.py <repo>/src/lib

Reads CDXConstants.h (tag and enum values), CDXObject.cpp (CDXML attribute names), the
XMLPutEnum tables in every *.cpp (enum value names) and the CDXMLPutAttribute calls with the
member declarations in the headers (which enum each property uses).
"""
import re, sys, os, json, glob

D = os.path.dirname(os.path.abspath(__file__))
const = open(os.path.join(D, "CDXConstants.h"), encoding="latin-1").read()
# Strip comments.
const_nc = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", const, flags=re.S))

values = {"kCDXTag_Object": 0x8000, "kCDXTag_UserDefined": 0x4000}
enum_members = {}  # enum name -> [member names]
for m in re.finditer(r"enum\s+(\w+)?\s*(?::\s*\w+\s*)?\{(.*?)\}", const_nc, flags=re.S):
    name = m.group(1) or "_anon"
    body = m.group(2)
    nxt = 0
    members = []
    for part in body.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            k, expr = part.split("=", 1)
            k = k.strip()
            expr = expr.strip()
            e = re.sub(r"\b(k\w+)\b", lambda mm: str(values.get(mm.group(1), 0)), expr)
            e = e.replace("UL", "").replace("L", "") if re.fullmatch(r"[0-9xXa-fA-F\s|<>&()+\-UL]+", e) else e
            try:
                v = int(eval(e, {}, {}))
            except Exception:
                continue
        else:
            k = part
            v = nxt
        if not re.fullmatch(r"\w+", k):
            continue
        values[k] = v
        members.append(k)
        nxt = v + 1
    enum_members.setdefault(name, []).extend(members)

# Objects.
OBJ_XML = {
    "Document": "CDXML", "Page": "page", "Group": "group", "Fragment": "fragment", "Node": "n", "Bond": "b", "Text": "t",
    "Graphic": "graphic", "Curve": "curve", "EmbeddedObject": "embeddedobject", "NamedAlternativeGroup": "altgroup",
    "TemplateGrid": "templategrid", "RegistryNumber": "regnum", "ReactionScheme": "scheme", "ReactionStep": "step",
    "ObjectDefinition": "objectdefinition", "Spectrum": "spectrum", "ObjectTag": "objecttag", "Sequence": "sequence",
    "CrossReference": "crossreference", "Splitter": "splitter", "Table": "table", "BracketedGroup": "bracketedgroup",
    "BracketAttachment": "bracketattachment", "CrossingBond": "crossingbond", "Border": "border", "Geometry": "geometry",
    "Constraint": "constraint", "TLCPlate": "tlcplate", "TLCLane": "tlclane", "TLCSpot": "tlcspot",
    "ChemicalProperty": "chemicalproperty", "Arrow": "arrow", "StoichiometryGrid": "stoichiometrygrid",
    "SGComponent": "sgcomponent", "SGDatum": "sgdatum", "BioShape": "bioshape", "PlasmidMap": "plasmidmap",
    "PlasmidMarker": "plasmidmarker", "PlasmidRegion": "plasmidregion", "RLogic": "rlogic", "RLogicItem": "rlogicitem",
    "Annotation": "annotation", "GEPPlate": "gepplate", "GEPBand": "gepband", "Marker": "marker", "GEPLane": "geplane",
    "DocumentProperties": "DocumentProperties", "Property": "Property", "ColoredMolecularArea": "ColoredMolecularArea",
}
objects = {}
for k, v in values.items():
    if k.startswith("kCDXObj_") and k[8:] in OBJ_XML:
        objects[v] = OBJ_XML[k[8:]]

# Attribute names.
objsrc = open(os.path.join(D, "CDXObject.cpp"), encoding="latin-1").read()
attr = {}
for m in re.finditer(r'sCDXMLAttributeNames\[(kCDXProp_\w+)\]\s*=\s*"([^"]+)"', objsrc):
    if m.group(1) in values:
        attr[values[m.group(1)]] = (m.group(1), m.group(2))

# Enum value-name tables.
enum_names = {}
alltext = ""
for f in glob.glob(os.path.join(D, "*.cpp")) + glob.glob(os.path.join(D, "*.h")):
    alltext += open(f, encoding="latin-1").read() + "\n"
for m in re.finditer(r"XMLPutEnum<(\w+)>::Value\s+\w+\[\]\s*=\s*\{(.*?)\};", alltext, flags=re.S):
    t = m.group(1)
    tab = {}
    for e in re.finditer(r'\{\s*(k\w+)\s*,\s*"([^"]*)"\s*\}', m.group(2)):
        if e.group(1) in values and values[e.group(1)] not in tab:
            tab[values[e.group(1)]] = e.group(2)
    enum_names[t] = tab

# Member declarations: "CDXBondDisplay m_display;"
member_type = {}
for m in re.finditer(r"\b(CDX\w+|INT\d+|UINT\d+|bool|double|float)\s+(m_\w+)\s*(?:=[^;]*)?;", alltext):
    member_type.setdefault(m.group(2), m.group(1))
# Which enum each property is written with.
prop_enum = {}
for m in re.finditer(r"CDXMLPutAttribute\s*\(\s*\w+\s*,\s*(kCDXProp_\w+)\s*,\s*([^)]*?)\)", alltext):
    tag, expr = m.group(1), m.group(2).strip()
    mm = re.search(r"\b(m_\w+)\b", expr)
    cast = re.match(r"\(?\s*(CDX\w+)\s*\)", expr)
    t = None
    if cast and cast.group(1) in enum_names:
        t = cast.group(1)
    elif mm and member_type.get(mm.group(1)) in enum_names:
        t = member_type[mm.group(1)]
    if t and tag in values:
        prop_enum.setdefault(values[tag], t)

json.dump({"objects": objects, "attr": {k: v for k, v in attr.items()}, "enums": enum_names, "prop_enum": prop_enum}, open(os.path.join(D, "tags.json"), "w"), indent=0)
print("objects", len(objects), "attrs", len(attr), "enums", len(enum_names), "prop->enum", len(prop_enum))
for tag in sorted(prop_enum):
    print(hex(tag), attr.get(tag, ("?", "?"))[1], prop_enum[tag], len(enum_names[prop_enum[tag]]))

# ---- types: the header's own comments first ("// 0x0012 … (CDXObjectID)"), then the 2010 table.
hdr_types = {}
# Keyed by the property's NAME (its enum value), not the hex in the comment: the header's comments
# number two properties "0x0011", which shifts every comment after them in that block.
for m in re.finditer(r"(kCDXProp_\w+)[^\n]*//[^\n]*\(([A-Za-z0-9_ ]+)\)\s*$", const, flags=re.M):
    if m.group(1) in values:
        hdr_types[values[m.group(1)]] = m.group(2).strip()
old_types = {int(l.split()[0], 16): l.split()[1] for l in open(os.path.join(D, "types.txt")) if l.strip()}
def norm(t):
    t = t.replace(" ", "")
    return t
types = {}
for tag in attr:
    types[tag] = norm(hdr_types.get(tag, old_types.get(tag, "")))
# Where Revvity's reader disagrees with its header comment, the reader wins.
types[values["kCDXProp_Bracket_RepeatCount"]] = "FLOAT64"  # CDXBracketedGroup.cpp reads an 8-byte float
types[values["kCDXProp_Atom_Charge"]] = "INT8"  # 4-byte form (charge × 2^24) handled in cdx.ts
if "kCDXProp_UTF8Text" in values:
    attr[values["kCDXProp_UTF8Text"]] = ("kCDXProp_UTF8Text", "UTF8Text")
    types[values["kCDXProp_UTF8Text"]] = "CDXString"
missing = sorted(t for t in attr if not types[t])
print("no type:", [(hex(t), attr[t][1]) for t in missing])
print("type kinds:", sorted(set(types.values())))
json.dump({"types": types}, open(os.path.join(D, "types.json"), "w"))

# ---- emit src/lib/cdxTags.ts
lic = open(os.path.join(D, "license.txt"), encoding="latin-1").read().strip()
for k in (0x1201, 0x1601):  # member-name collisions in the scan: not that enum
    prop_enum.pop(k, None)
TYPEMAP = {"bool": "CDXBoolean", "int": "INT32", "string": "CDXString"}
for k in (0xbb4, 0xbb5, 0xbb6, 0xbb7, 0xbb8, 0xbb9, 0xbba, 0xbbb, 0xbbc, 0xbbd, 0xbbe, 0xbbf, 0xbc0, 0xbc1, 0xbc2, 0xbc3, 0xbc4, 0xbc5, 0xbc6, 0xbc7, 0xbc8, 0xbc9, 0xbca):
    types[k] = "CDXString"  # the document's property captions ("Chemical Formula: ")
used_enums = sorted(set(prop_enum.values()))
def is_flags(tab):
    nz = [v for v in tab if v]
    return len(nz) > 2 and all(v & (v - 1) == 0 for v in nz)
out = []
out.append("/**")
out.append(" * ChemDraw CDX tags → CDXML names, value types and enum names (generated; do not edit).")
out.append(" *")
out.append(" * Generated by scripts/gen-cdx-tags.py from Revvity's open-source ChemDraw file-format code")
out.append(" * (github.com/Glysade/chemdraw, chemdraw/CDXConstants.h, CDXObject.cpp and the XMLPutEnum tables),")
out.append(" * released under the BSD 3-Clause License, whose notice follows as that licence requires:")
out.append(" *")
for line in lic.splitlines():
    out.append((" * " + line).rstrip())
out.append(" */")
out.append("")
out.append("/** Object tag → CDXML element name. */")
out.append("export const CDX_OBJECTS: Record<number, string> = {")
for k in sorted(objects):
    out.append(f"  0x{k:04x}: {json.dumps(objects[k])},")
out.append("};")
out.append("")
out.append("/** Property tag → [CDXML attribute name, CDX data type] (type '' = not read: named in a note). */")
out.append("export const CDX_PROPS: Record<number, [string, string]> = {")
for k in sorted(attr):
    t = TYPEMAP.get(types.get(k, ""), types.get(k, ""))
    if t == "varies":
        t = ""
    out.append(f"  0x{k:04x}: [{json.dumps(attr[k][1])}, {json.dumps(t)}],")
out.append("};")
out.append("")
out.append("/** Property tag → the enum its values are named from. */")
out.append("export const CDX_PROP_ENUM: Record<number, string> = {")
for k in sorted(prop_enum):
    out.append(f"  0x{k:04x}: {json.dumps(prop_enum[k][3:])},")
out.append("};")
out.append("")
out.append("/** Enum → value → CDXML name. */")
out.append("export const CDX_ENUMS: Record<string, Record<number, string>> = {")
for e in used_enums:
    tab = enum_names[e]
    body = ", ".join((f"\"{v}\"" if v < 0 else str(v)) + f": {json.dumps(n)}" for v, n in sorted(tab.items()))
    out.append(f"  {e[3:]}: {{ {body} }},")
out.append("};")
out.append("")
out.append("/** Enums whose values are bit flags (a value may name several, written space-separated). */")
out.append("export const CDX_FLAG_ENUMS: ReadonlySet<string> = new Set([" + ", ".join(json.dumps(e[3:]) for e in used_enums if is_flags(enum_names[e])) + "]);")
out.append("")
dst = os.path.join(sys.argv[1] if len(sys.argv) > 1 else D, "cdxTags.ts")
open(dst, "w", encoding="utf-8", newline="\n").write("\n".join(out))
print("wrote", dst, len(out), "lines; flags:", [e for e in used_enums if is_flags(enum_names[e])])
