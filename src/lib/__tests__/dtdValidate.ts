/**
 * A strict validator for the constructs WIPO's ST.26 DTD actually uses (Annex II, V1_3): element content models of
 * sequences, choices and ? * + over child elements, (#PCDATA)-only elements, and CDATA / ID attributes that are
 * #REQUIRED or #IMPLIED. Anything else in a DTD — parameter entities, conditional sections, ANY, EMPTY, mixed content,
 * enumerations, #FIXED, NOTATION — is REFUSED when the DTD is read, so the validator never silently ignores a rule it
 * does not understand (hit-list #14: the bundled xmllint-wasm has no DTD validation; this one was cross-checked against
 * libxml2's on every listing and mutant in st26Dtd.test.ts).
 *
 * Its verdicts were checked against libxml2 on every listing the builder writes and on one broken listing per kind of
 * error, plus the review's extra cases (whitespace, xmlns, duplicate declarations) — all agree. It is NOT a general DTD
 * validator: a non-deterministic content model, for one, is not refused here although libxml2 refuses it.
 *
 * The rules, as libxml2 applies them to these constructs: every element and attribute must be declared; children must match
 * the content model in order; an element-only element may hold whitespace between its children but no other text; a
 * (#PCDATA) element holds no child element; ID values are XML names and unique in the document.
 */
import { parseXml, type XNode } from "../xmlLite";

interface ElementDecl {
  /** Anchored regex over the child element names, each written as `<name>`; null = (#PCDATA). */
  model: RegExp | null;
}
interface AttrDecl {
  type: "CDATA" | "ID";
  required: boolean;
}
export interface Dtd {
  elements: Map<string, ElementDecl>;
  attrs: Map<string, Map<string, AttrDecl>>;
}

const NAME = "[A-Za-z_:][-A-Za-z0-9._:]*";
/** An XML Name with non-ASCII letters (an ID value; libxml2 accepts "ét1"). */
const ID_NAME = new RegExp("^[" + "\\p{L}_:][" + "\\p{L}\\p{N}\\p{M}._:-]*$", "u");
/** XML whitespace is space, tab, CR and LF only — not the no-break or em space that String.trim also removes (review). */
const NON_XML_SPACE = /[^ \t\r\n]/;

/** A content model "(a, (b | c)?, d+)" as a regex over "<a><b><d><d>". */
function modelRegex(model: string, element: string): RegExp {
  // Whitespace between two names is a malformed model ("(a b)"), never read as "(ab)" (review).
  if (/[-A-Za-z0-9._:]\s+[A-Za-z_:]/.test(model)) throw new Error(`DTD: the content model of ${element} has two names with no , or | between them: ${model}`);
  const src = model.replace(/\s+/g, "");
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(`DTD: the content model of ${element} is outside this validator (${why}): ${model}`);
  };
  const occurrence = (): string => {
    const c = src[i];
    if (c === "?" || c === "*" || c === "+") {
      i++;
      return c;
    }
    return "";
  };
  const particle = (): string => {
    if (src[i] === "(") {
      i++;
      const items = [particle()];
      let sep = "";
      while (src[i] === "," || src[i] === "|") {
        if (sep && src[i] !== sep) fail("mixed , and | in one group");
        sep = src[i];
        i++;
        items.push(particle());
      }
      if (src[i] !== ")") fail("unclosed group");
      i++;
      return `(?:${items.join(sep === "|" ? "|" : "")})${occurrence()}`;
    }
    const m = new RegExp(`^${NAME}`).exec(src.slice(i));
    if (!m || m[0].startsWith("#")) fail("a name was expected");
    i += m![0].length;
    return `(?:<${m![0].replace(/[.]/g, "\\.")}>)${occurrence()}`;
  };
  const body = particle();
  if (i !== src.length) fail("trailing characters");
  return new RegExp(`^${body}$`);
}

/** Reads a DTD of the supported constructs; throws, naming the construct, on anything else. */
export function readDtd(text: string): Dtd {
  const src = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[\s\S]*?\?>/, "");
  const dtd: Dtd = { elements: new Map(), attrs: new Map() };
  const decls = src.match(/<![\s\S]*?>/g) ?? [];
  const rest = src.replace(/<![\s\S]*?>/g, "").trim();
  if (rest) throw new Error(`DTD: unexpected text outside declarations: ${rest.slice(0, 60)}`);
  for (const d of decls) {
    const el = /^<!ELEMENT\s+(\S+)\s+([\s\S]+)>$/.exec(d);
    if (el) {
      const [, name, model] = el;
      const m = model.trim();
      if (dtd.elements.has(name)) throw new Error(`DTD: ${name} is declared twice.`);
      if (/^\(\s*#PCDATA\s*\)$/.test(m)) dtd.elements.set(name, { model: null });
      else if (/#PCDATA|ANY|EMPTY/.test(m)) throw new Error(`DTD: ${name} uses mixed content, ANY or EMPTY — outside this validator.`);
      else dtd.elements.set(name, { model: modelRegex(m, name) });
      continue;
    }
    const at = /^<!ATTLIST\s+(\S+)([\s\S]*)>$/.exec(d);
    if (at) {
      const [, name, body] = at;
      const map = dtd.attrs.get(name) ?? new Map<string, AttrDecl>();
      const tokens = body.trim().split(/\s+/).filter(Boolean);
      if (tokens.length % 3 !== 0) throw new Error(`DTD: the attribute list of ${name} is outside this validator (only CDATA/ID with #REQUIRED/#IMPLIED).`);
      for (let k = 0; k < tokens.length; k += 3) {
        const [attr, type, def] = tokens.slice(k, k + 3);
        if ((type !== "CDATA" && type !== "ID") || (def !== "#REQUIRED" && def !== "#IMPLIED")) {
          throw new Error(`DTD: attribute ${name}/${attr} (${type} ${def}) is outside this validator.`);
        }
        // The FIRST declaration of an attribute is binding (XML 1.0 §3.3); two ID attributes on one element are an error.
        if (map.has(attr)) continue;
        if (type === "ID" && [...map.values()].some((x) => x.type === "ID")) throw new Error(`DTD: ${name} declares two ID attributes.`);
        map.set(attr, { type, required: def === "#REQUIRED" });
      }
      dtd.attrs.set(name, map);
      continue;
    }
    throw new Error(`DTD: declaration outside this validator: ${d.slice(0, 60)}`);
  }
  return dtd;
}

/** The DOCTYPE's root element name, or null. */
function doctypeRoot(xml: string): string | null {
  return /<!DOCTYPE\s+(\S+)/.exec(xml.replace(/<!--[\s\S]*?-->/g, ""))?.[1] ?? null;
}

/** Every validity error of `xml` against `dtd` (empty = valid), each with its line. */
export function validateAgainstDtd(xml: string, dtd: Dtd): string[] {
  const parsed = parseXml(xml);
  if (!parsed.ok) return [`not well-formed: ${parsed.reason}`];
  const errors: string[] = [];
  const root = parsed.root;
  const declared = doctypeRoot(xml);
  if (declared === null) errors.push("no DOCTYPE declaration");
  else if (declared !== root.name) errors.push(`the DOCTYPE names ${declared} but the root element is ${root.name}`);
  const ids = new Set<string>();
  const visit = (n: XNode): void => {
    const decl = dtd.elements.get(n.name);
    if (!decl) {
      errors.push(`line ${n.line}: element ${n.name} is not declared`);
      return;
    }
    const attrDecls = dtd.attrs.get(n.name) ?? new Map<string, AttrDecl>();
    for (const [a, raw] of Object.entries(n.attrs)) {
      let v = raw;
      // xmlns and xmlns:* are ordinary attributes to a DTD: undeclared, they are errors (libxml2 agrees).
      const ad = attrDecls.get(a);
      if (!ad) {
        errors.push(`line ${n.line}: attribute ${a} is not declared on ${n.name}`);
        continue;
      }
      if (ad.type === "ID") {
        // An ID is a tokenized type: its value is normalised (spaces trimmed and collapsed) before it is checked.
        v = v.replace(/ +/g, " ").trim();
        if (!ID_NAME.test(v)) errors.push(`line ${n.line}: ID ${JSON.stringify(v)} on ${n.name} is not an XML name`);
        else if (ids.has(v)) errors.push(`line ${n.line}: ID ${JSON.stringify(v)} is used twice`);
        else ids.add(v);
      }
    }
    for (const [a, ad] of attrDecls) if (ad.required && !Object.prototype.hasOwnProperty.call(n.attrs, a)) errors.push(`line ${n.line}: ${n.name} lacks its required attribute ${a}`);
    if (decl.model === null) {
      if (n.children.length) errors.push(`line ${n.line}: ${n.name} holds text only, but has the element ${n.children[0].name}`);
    } else {
      if (NON_XML_SPACE.test(n.text)) errors.push(`line ${n.line}: ${n.name} holds elements only, but has the text ${JSON.stringify(n.text.trim().slice(0, 30))}`);
      const seq = n.children.map((c) => `<${c.name}>`).join("");
      if (!decl.model.test(seq)) errors.push(`line ${n.line}: the children of ${n.name} (${n.children.map((c) => c.name).join(", ") || "none"}) do not match its content model`);
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return errors;
}
