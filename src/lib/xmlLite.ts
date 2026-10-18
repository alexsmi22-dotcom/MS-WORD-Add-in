/**
 * A small XML reader for document formats (CDXML first): elements, attributes and text, with
 * every limit checked before the work it bounds. Pure — no DOM (it runs in tests and workers
 * alike) — and it never fetches anything: a DOCTYPE is skipped, never resolved, and entities
 * other than the five predefined ones and numeric references are refused by name (no
 * entity-expansion attacks, no external entities).
 *
 * Malformed input is refused with the line it was found on, never repaired into a guess.
 */

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Character data directly inside this element (concatenated, entities decoded). */
  text: string;
  /** 1-based line of the element's start tag. */
  line: number;
}

export interface XmlLimits {
  /** Characters of input. */
  chars: number;
  /** Elements in all. */
  elements: number;
  /** Nesting depth. */
  depth: number;
  /** Attributes on one element. */
  attrs: number;
}

export const XML_LIMITS: XmlLimits = { chars: 40 * 1024 * 1024, elements: 1_000_000, depth: 64, attrs: 400 };

const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes entity and character references; null names the first one that is not allowed. */
function decode(s: string): { ok: true; text: string } | { ok: false; bad: string } {
  if (s.indexOf("&") < 0) return { ok: true, text: s };
  let out = "";
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf("&", i);
    if (amp < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, amp);
    const semi = s.indexOf(";", amp);
    if (semi < 0 || semi - amp > 12) return { ok: false, bad: s.slice(amp, amp + 12) };
    const ref = s.slice(amp + 1, semi);
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && /^#(x[0-9a-fA-F]+|X[0-9a-fA-F]+|[0-9]+)$/.test(ref);
      if (!valid) return { ok: false, bad: "&" + ref + ";" };
      out += String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(PREDEFINED, ref)) out += PREDEFINED[ref];
    else return { ok: false, bad: "&" + ref + ";" };
    i = semi + 1;
  }
  return { ok: true, text: out };
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const SPACE = /[ \t\r\n]*/y;

/** Parses a document; the root element, or a refusal naming the line. */
export function parseXml(src: string, limits: XmlLimits = XML_LIMITS): { ok: true; root: XNode } | { ok: false; reason: string } {
  if (src.length > limits.chars) return { ok: false, reason: `it is larger than ${Math.round(limits.chars / 1048576)} MB of text` };
  let pos = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let elements = 0;
  const stack: XNode[] = [];
  let root: XNode | null = null;
  const fail = (why: string): { ok: false; reason: string } => ({ ok: false, reason: `it is not well-formed XML (line ${line}: ${why})` });
  /** Advances to `to`, counting the lines passed. */
  const advance = (to: number): void => {
    for (let k = pos; k < to; k++) if (src.charCodeAt(k) === 10) line++;
    pos = to;
  };
  const skipSpace = (): void => {
    SPACE.lastIndex = pos;
    SPACE.exec(src);
    advance(SPACE.lastIndex);
  };

  while (pos < src.length) {
    const lt = src.indexOf("<", pos);
    if (lt < 0) {
      const rest = src.slice(pos);
      if (stack.length) return fail(`<${stack[stack.length - 1].name}> is never closed`);
      if (rest.trim()) return fail("text after the document's end");
      advance(src.length);
      break;
    }
    if (lt > pos) {
      const raw = src.slice(pos, lt);
      if (stack.length) {
        const d = decode(raw);
        if (!d.ok) return fail(`the reference ${d.bad} is not one XML defines`);
        stack[stack.length - 1].text += d.text;
      } else if (raw.trim()) return fail(root ? "text after the document's end" : "text before the first element");
      advance(lt);
    }
    if (src.startsWith("<!--", pos)) {
      const end = src.indexOf("-->", pos + 4);
      if (end < 0) return fail("a comment is never closed");
      advance(end + 3);
    } else if (src.startsWith("<![CDATA[", pos)) {
      const end = src.indexOf("]]>", pos + 9);
      if (end < 0) return fail("a CDATA section is never closed");
      if (!stack.length) return fail("CDATA outside the root element");
      stack[stack.length - 1].text += src.slice(pos + 9, end);
      advance(end + 3);
    } else if (src.startsWith("<?", pos)) {
      const end = src.indexOf("?>", pos + 2);
      if (end < 0) return fail("a processing instruction is never closed");
      advance(end + 2);
    } else if (src.startsWith("<!DOCTYPE", pos)) {
      // Skipped, never resolved. An internal subset ([ … ]) could declare entities: refused.
      const end = src.indexOf(">", pos);
      if (end < 0) return fail("the DOCTYPE is never closed");
      if (src.slice(pos, end).indexOf("[") >= 0) return fail("the DOCTYPE declares its own entities, which this reader does not accept");
      if (root || stack.length) return fail("a DOCTYPE after the root element");
      advance(end + 1);
    } else if (src.startsWith("</", pos)) {
      advance(pos + 2);
      NAME.lastIndex = pos;
      const m = NAME.exec(src);
      if (!m) return fail("a closing tag has no name");
      advance(NAME.lastIndex);
      skipSpace();
      if (src[pos] !== ">") return fail(`</${m[0]}> is not closed with >`);
      advance(pos + 1);
      const open = stack.pop();
      if (!open) return fail(`</${m[0]}> closes nothing`);
      if (open.name !== m[0]) return fail(`</${m[0]}> closes <${open.name}> (opened on line ${open.line})`);
    } else {
      // A start tag.
      advance(pos + 1);
      NAME.lastIndex = pos;
      const m = NAME.exec(src);
      if (!m) return fail("a tag has no name");
      if (root && !stack.length) return fail("a second root element");
      if (++elements > limits.elements) return { ok: false, reason: `it has more than ${limits.elements.toLocaleString("en-US")} elements` };
      if (stack.length >= limits.depth) return { ok: false, reason: `its elements are nested more than ${limits.depth} deep` };
      const node: XNode = { name: m[0], attrs: {}, children: [], text: "", line };
      advance(NAME.lastIndex);
      let count = 0;
      for (;;) {
        skipSpace();
        if (src[pos] === ">" || src.startsWith("/>", pos)) break;
        NAME.lastIndex = pos;
        const a = NAME.exec(src);
        if (!a) return fail(`<${node.name}> has something that is not an attribute`);
        advance(NAME.lastIndex);
        skipSpace();
        if (src[pos] !== "=") return fail(`the attribute ${a[0]} on <${node.name}> has no value`);
        advance(pos + 1);
        skipSpace();
        const q = src[pos];
        if (q !== '"' && q !== "'") return fail(`the value of ${a[0]} on <${node.name}> is not quoted`);
        const close = src.indexOf(q, pos + 1);
        if (close < 0) return fail(`the value of ${a[0]} on <${node.name}> is never closed`);
        const rawVal = src.slice(pos + 1, close);
        if (rawVal.indexOf("<") >= 0) return fail(`the value of ${a[0]} on <${node.name}> contains <`);
        const d = decode(rawVal);
        if (!d.ok) return fail(`the reference ${d.bad} is not one XML defines`);
        if (Object.prototype.hasOwnProperty.call(node.attrs, a[0])) return fail(`<${node.name}> has the attribute ${a[0]} twice`);
        if (++count > limits.attrs) return { ok: false, reason: `an element has more than ${limits.attrs} attributes` };
        node.attrs[a[0]] = d.text;
        advance(close + 1);
      }
      const selfClose = src.startsWith("/>", pos);
      advance(pos + (selfClose ? 2 : 1));
      if (stack.length) stack[stack.length - 1].children.push(node);
      else root = node;
      if (!selfClose) stack.push(node);
    }
  }
  if (stack.length) return fail(`<${stack[stack.length - 1].name}> (line ${stack[stack.length - 1].line}) is never closed`);
  if (!root) return { ok: false, reason: "it has no XML elements" };
  return { ok: true, root };
}

/** The first child element with this name. */
export const child = (n: XNode, name: string): XNode | undefined => n.children.find((c) => c.name === name);
