/* DataBrief command-line tool - window.DOMParser for Node. GPL-3.0-or-later.
 *
 * Node has no DOMParser. Three readers of the page use one: XML (src/parsers.js), SQL Server projects (src/dacpac.js) and
 * HTML tables (src/parsers.js). So that the tool runs THE SAME reader code as the page, this file gives them a DOMParser:
 *   - XML: @xmldom/xmldom (vendor/xmldom.min.js). A document with an error gets a <parsererror> element, as in browsers.
 *   - HTML: parse5 (vendor/parse5.min.js), which builds the tree with the browser's own algorithm (WHATWG), wrapped in the
 *     few DOM features the HTML table reader uses: querySelectorAll / querySelector with tag names, rows (of a table and of
 *     thead / tbody / tfoot), tHead,
 *     caption, tr.cells, tagName, rowSpan / colSpan (reflected as browsers do), id, getAttribute, textContent, and
 *     cloneNode / replaceWith / remove, childNodes / nodeType / nodeValue (the page read as a document). Anything else is not
 *     there: a reader that starts using it fails in the tests.
 * Loaded by cli/realm.cjs into the tool's realm, after vendor/xmldom.min.js and vendor/parse5.min.js. Not part of the page. */
'use strict';
(function () {
  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  /* ---------- XML: the DOCTYPE's internal subset, as browsers use it ----------
   * Browsers (libxml2) read the declarations inside <!DOCTYPE x [ ... ]>: internal entities are expanded (their text is
   * parsed as markup), external entities are never loaded and read as nothing, attribute defaults (ATTLIST) are filled in.
   * xmldom does none of it, so this pass does it before xmldom parses: the declarations are read, the subset removed, the
   * references replaced in the text. Limits: an entity that refers to itself, an expansion over AMPLIFY times the file
   * (plus 100 kB: browsers refuse a few hundred kB out of a small file, accept tens of kB), parameter entities (%name;) and conditional sections give an error (a <parsererror>). */
  const AMPLIFY = 10, ALLOWANCE = 100 * 1024;
  const PREDEF = { lt: 1, gt: 1, amp: 1, quot: 1, apos: 1 };
  const NAME = /^[A-Za-z_:][\w.:\u00b7\u00c0-\uffff-]*/;
  class XmlError extends Error {}
  const charRefs = (s) => s.replace(/&#(x[0-9a-fA-F]+|\d+);/g, (m, n) => {
    const c = n[0] === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    if (!(c > 0 && c <= 0x10ffff)) throw new XmlError('bad character reference ' + m);
    return String.fromCodePoint(c);
  });
  // -> { start, end, decls } of the internal subset, or null when there is none. Scanned by hand, in one pass (a regular
  // expression here backtracked for minutes on "<!DOCTYPE" followed by many spaces or quotes).
  function findSubset(text) {
    const lim = Math.min(text.length, 1 << 20);
    const p = text.indexOf('<!DOCTYPE');
    if (p < 0 || p >= lim) return null;
    let k = p + 9, quote = '';
    for (; k < lim; k++) {
      const ch = text[k];
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '[') break;
      if (ch === '>') return null;
    }
    if (k >= lim) return null;
    const start = k + 1;
    let i = start, q = '';
    for (; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === q) q = ''; continue; }
      if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) throw new XmlError('unclosed comment'); i = e + 2; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === ']') break;
    }
    const close = /^\]\s*>/.exec(text.slice(i, i + 200));
    if (!close) throw new XmlError('unclosed DOCTYPE');
    return { start, end: i, after: i + close[0].length, body: text.slice(start, i) };
  }
  // The tokens of an ATTLIST declaration: { v, quoted } for "..." / '...', { v, group } for ( ... ), { v } otherwise
  function attTokens(s) {
    const out = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
      const ch = s[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (ch === '"' || ch === "'") { const e = s.indexOf(ch, i + 1); if (e < 0) throw new XmlError('bad ATTLIST'); out.push({ v: s.slice(i + 1, e), quoted: true }); i = e + 1; continue; }
      if (ch === '(') { const e = s.indexOf(')', i + 1); if (e < 0) throw new XmlError('bad ATTLIST'); out.push({ v: s.slice(i, e + 1), group: true }); i = e + 1; continue; }
      let j = i;
      while (j < n && !/[\s"'(]/.test(s[j])) j++;
      out.push({ v: s.slice(i, j) });
      i = j;
    }
    return out;
  }
  function readDecls(body) {
    const ents = new Map(), atts = new Map();
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(ENTITY|ATTLIST|ELEMENT|NOTATION)\s((?:[^>"']|"[^"]*"|'[^']*')*)>|%[^;\s]*;|<!\[|(\S)/g;
    let m;
    while ((m = re.exec(body))) {
      if (m[0][0] === '%' || m[0] === '<![') throw new XmlError('parameter entities and conditional sections are not read');
      if (m[3]) throw new XmlError('unexpected text in the DOCTYPE');
      if (m[1] === 'ENTITY') {
        const d = m[2].trim();
        if (d[0] === '%') throw new XmlError('parameter entities are not read');
        const n = NAME.exec(d);
        if (!n) throw new XmlError('bad entity name');
        const rest = d.slice(n[0].length).trim();
        let ent;
        const lit = /^("([^"]*)"|'([^']*)')\s*$/.exec(rest);
        if (lit) {
          const v = lit[2] !== undefined ? lit[2] : lit[3];
          if (/%/.test(v)) throw new XmlError('parameter entities are not read');
          ent = { text: charRefs(v) };
        } else if (/^(SYSTEM|PUBLIC)\b/.test(rest)) {
          ent = /\bNDATA\b/.test(rest) ? { unparsed: true } : { text: '', external: true };
        } else throw new XmlError('bad entity declaration');
        if (!ents.has(n[0])) ents.set(n[0], ent);      // the first declaration wins
      } else if (m[1] === 'ATTLIST') {
        // read by hand, token by token (a regular expression here backtracked for minutes on a long name)
        const tok = attTokens(m[2]);
        if (!tok.length) throw new XmlError('bad ATTLIST');
        const el = tok[0].v;
        const list = atts.get(el) || new Map();
        let k = 1;
        while (k < tok.length) {
          const name = tok[k++], type = tok[k++];
          if (!name || !type || name.quoted || name.group || type.quoted) throw new XmlError('bad ATTLIST');
          let typeName = type.v;
          if (typeName === 'NOTATION') { const g = tok[k++]; if (!g || !g.group) throw new XmlError('bad ATTLIST'); typeName = 'NOTATION'; }
          else if (type.group) typeName = 'ENUM';
          let d = tok[k++];
          if (!d) throw new XmlError('bad ATTLIST');
          let value = null;
          if (d.v === '#FIXED') { d = tok[k++]; if (!d || !d.quoted) throw new XmlError('bad ATTLIST'); value = d.v; }
          else if (d.quoted) value = d.v;
          else if (d.v !== '#REQUIRED' && d.v !== '#IMPLIED') throw new XmlError('bad ATTLIST');
          if (list.has(name.v)) continue;               // the first definition wins
          if (value === null) { list.set(name.v, null); continue; }
          let v = charRefs(value);
          if (typeName !== 'CDATA') v = v.replace(/\s+/g, ' ').trim();
          list.set(name.v, v);
        }
        atts.set(el, list);
      }
    }
    return { ents, atts };
  }
  // Replaces the entity references of the document text (not in comments, CDATA or processing instructions)
  // The work is counted, not only the output: every reference costs its name, every expansion its length (an entity that
  // expands to nothing, used a billion times, is work too), and each entity is expanded once (memo, per context).
  function expand(text, ents, limit) {
    let out = '', total = 0;
    const memo = [new Map(), new Map()];   // [in content, in an attribute]
    const cost = (k) => { total += k; if (total > limit) throw new XmlError('entities expand too much'); };
    const replace = (name, inAttr, stack) => {
      cost(name.length + 2);
      if (PREDEF[name]) return '&' + name + ';';
      const e = ents.get(name);
      if (!e) return '&' + name + ';';                // undefined: left for the parser, which reports it
      if (e.unparsed) throw new XmlError('reference to an unparsed entity');
      if (e.external) { if (inAttr) throw new XmlError('external entity in an attribute'); return ''; }
      const cache = memo[inAttr ? 1 : 0];
      if (cache.has(name)) { const c = cache.get(name); cost(c.length); return c; }
      if (stack.includes(name)) throw new XmlError('entity refers to itself: ' + name);
      const r = e.text.replace(/&([A-Za-z_:][\w.:\u00b7\u00c0-\uffff-]*);/g, (m, n) => replace(n, inAttr, stack.concat(name)));
      if (inAttr && r.includes('<')) throw new XmlError('"<" in an attribute value');
      cache.set(name, r);
      cost(r.length);
      return r;
    };
    let i = 0, inTag = false, q = '';
    const n = text.length;
    const next = /[<>&"']/g;
    while (i < n) {
      next.lastIndex = i;
      const hit = next.exec(text);
      const j0 = hit ? hit.index : n;
      if (j0 > i) { out += text.slice(i, j0); i = j0; if (i >= n) break; }
      if (!inTag) {
        if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); const j = e < 0 ? n : e + 3; out += text.slice(i, j); i = j; continue; }
        if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i + 9); const j = e < 0 ? n : e + 3; out += text.slice(i, j); i = j; continue; }
        if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); const j = e < 0 ? n : e + 2; out += text.slice(i, j); i = j; continue; }
      }
      const ch = text[i];
      if (inTag) {
        if (q) { if (ch === q) q = ''; }
        else if (ch === '"' || ch === "'") q = ch;
        else if (ch === '>') inTag = false;
      } else if (ch === '<') inTag = true;
      if (ch === '&' && (!inTag || q)) {
        const m = /^&([A-Za-z_:][\w.:\u00b7\u00c0-\uffff-]*);/.exec(text.slice(i, i + 300));
        if (m) {
          let r = replace(m[1], inTag, []);
          if (inTag && r !== '&' + m[1] + ';') r = r.replace(/&(?!(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(new RegExp(q, 'g'), q === '"' ? '&quot;' : '&apos;');
          out += r;
          i += m[0].length;
          continue;
        }
      }
      out += ch;
      i++;
    }
    return out;
  }
  // Attribute defaults: added to the elements that do not have them
  function addDefaults(doc, atts) {
    for (const [el, list] of atts) {
      const found = doc.getElementsByTagName(el);
      for (let k = 0; k < found.length; k++) {
        for (const [a, v] of list) if (v !== null && !found[k].hasAttribute(a)) found[k].setAttribute(a, v);
      }
    }
  }
  function withSubset(text) {
    const s = findSubset(text);
    if (!s) return { text, atts: null };
    const { ents, atts } = readDecls(s.body);
    const doc = text.slice(0, s.start - 1).replace(/\s*$/, '') + '>' + text.slice(s.after);
    return { text: ents.size ? expand(doc, ents, AMPLIFY * text.length + ALLOWANCE) : doc, atts: atts.size ? atts : null };
  }

  /* ---------- XML ---------- */
  function xmlDocument(text, mime) {
    let problem = '';
    let doc = null;
    let atts = null;
    try { const w = withSubset(text); text = w.text; atts = w.atts; } catch (e) { problem = String(e.message || e); }
    if (!problem) try {
      doc = new window.xmldom.DOMParser({
        onError: (level, msg) => { if (level !== 'warning' && !problem) problem = String(msg || 'error'); },
      }).parseFromString(text, mime === 'text/xml' ? 'text/xml' : 'application/xml');
    } catch (e) { problem = String((e && e.message) || e || 'error'); }
    if (!problem && doc && doc.documentElement) { if (atts) addDefaults(doc, atts); return doc; }
    // As browsers do: the document holds a <parsererror> element with the message
    const out = new window.xmldom.DOMParser().parseFromString('<parsererror/>', 'application/xml');
    out.documentElement.appendChild(out.createTextNode(problem || 'no root element'));
    return out;
  }

  /* ---------- HTML ---------- */
  const isEl = (n) => !!n && typeof n.tagName === 'string';
  const isHtml = (n, tag) => isEl(n) && n.namespaceURI === HTML_NS && (!tag || n.tagName === tag);
  const kids = (n) => n.childNodes || [];
  const cache = new WeakMap();
  const wrap = (n) => {
    if (!n) return null;
    let w = cache.get(n);
    if (!w) { w = n.nodeName === '#document' ? new Doc(n) : isEl(n) ? new El(n) : new Txt(n); cache.set(n, w); }
    return w;
  };
  // Descendants in tree order (not the node itself; <template> contents are not children, as in browsers)
  function descendants(n, test) {
    const out = [];
    const stack = kids(n).slice().reverse();
    while (stack.length) {
      const x = stack.pop();
      if (test(x)) out.push(x);
      const c = kids(x);
      for (let i = c.length - 1; i >= 0; i--) stack.push(c[i]);
    }
    return out;
  }
  // Selectors: tag names separated by commas, nothing else
  function matcher(sel) {
    const tags = String(sel).split(',').map((s) => s.trim().toLowerCase());
    if (!tags.every((t) => /^[a-z][a-z0-9-]*$/.test(t))) throw new Error('dom-shim: unsupported selector ' + sel);
    return (x) => isHtml(x) && tags.includes(x.tagName);
  }
  function textOf(n) {
    if (n.nodeName === '#text') return n.value;
    let s = '';
    for (const x of descendants(n, (y) => y.nodeName === '#text')) s += x.value;
    return s;
  }
  // HTML "rules for parsing non-negative integers"; null when there is no number
  function nonNegative(v) {
    if (v == null) return null;
    const m = /^[\t\n\f\r ]*(\+?)(\d+)/.exec(v);
    return m ? Number(m[2]) : null;
  }
  // A deep copy, without recursion (a cell can be thousands of levels deep)
  function clone(n0, parent0) {
    const copyOne = (n, parent) => {
      const c = Object.assign({}, n, { parentNode: parent || null });
      if (n.attrs) c.attrs = n.attrs.map((a) => Object.assign({}, a));
      if (n.childNodes) c.childNodes = [];
      return c;
    };
    const root = copyOne(n0, parent0);
    const stack = [[n0, root]];
    while (stack.length) {
      const [src, dst] = stack.pop();
      for (const x of src.childNodes || []) {
        const c = copyOne(x, dst);
        dst.childNodes.push(c);
        if (x.childNodes && x.childNodes.length) stack.push([x, c]);
      }
    }
    return root;
  }

  class Node0 {
    constructor(n) { this._n = n; }
    get textContent() { return textOf(this._n); }
    // the children in order (the HTML reader walks the page as a document); <template> contents are not children
    get childNodes() { return kids(this._n).map(wrap); }
    remove() {
      const p = this._n.parentNode;
      if (!p) return;
      const i = p.childNodes.indexOf(this._n);
      if (i >= 0) p.childNodes.splice(i, 1);
      this._n.parentNode = null;
    }
    replaceWith(text) {
      const p = this._n.parentNode;
      if (!p) return;
      const i = p.childNodes.indexOf(this._n);
      if (i < 0) return;
      p.childNodes.splice(i, 1, { nodeName: '#text', value: String(text), parentNode: p });
      this._n.parentNode = null;
    }
    querySelectorAll(sel) { return descendants(this._n, matcher(sel)).map(wrap); }
    querySelector(sel) { const m = matcher(sel); return wrap(descendants(this._n, m)[0] || null); }
  }
  class Txt extends Node0 {
    get nodeType() { return this._n.nodeName === '#text' ? 3 : this._n.nodeName === '#comment' ? 8 : 10; }
    get nodeValue() { return this._n.nodeName === '#text' ? this._n.value : this._n.nodeName === '#comment' ? this._n.data : null; }
  }
  class Doc extends Node0 {
    get nodeType() { return 9; }
    get documentElement() { return wrap(kids(this._n).find(isEl) || null); }
  }
  class El extends Node0 {
    get nodeType() { return 1; }
    get tagName() { return this._n.namespaceURI === HTML_NS ? this._n.tagName.toUpperCase() : this._n.tagName; }
    get nodeName() { return this.tagName; }
    getAttribute(name) {
      const k = this._n.namespaceURI === HTML_NS ? String(name).toLowerCase() : String(name);
      const a = (this._n.attrs || []).find((x) => x.name === k);
      return a ? a.value : null;
    }
    get id() { return this.getAttribute('id') || ''; }
    cloneNode(deep) {
      const c = deep ? clone(this._n, null) : Object.assign({}, this._n, { parentNode: null, childNodes: [] });
      return wrap(c);
    }
    // table
    get rows() {
      // thead / tbody / tfoot: their own rows
      if (isHtml(this._n, 'thead') || isHtml(this._n, 'tbody') || isHtml(this._n, 'tfoot')) return kids(this._n).filter((x) => isHtml(x, 'tr')).map(wrap);
      if (!isHtml(this._n, 'table')) return undefined;
      const head = [], body = [], foot = [];
      for (const c of kids(this._n)) {
        if (isHtml(c, 'tr')) body.push(c);
        else if (isHtml(c, 'thead')) head.push(...kids(c).filter((x) => isHtml(x, 'tr')));
        else if (isHtml(c, 'tbody')) body.push(...kids(c).filter((x) => isHtml(x, 'tr')));
        else if (isHtml(c, 'tfoot')) foot.push(...kids(c).filter((x) => isHtml(x, 'tr')));
      }
      return head.concat(body, foot).map(wrap);
    }
    get tHead() { return isHtml(this._n, 'table') ? wrap(kids(this._n).find((x) => isHtml(x, 'thead')) || null) : undefined; }
    get caption() { return isHtml(this._n, 'table') ? wrap(kids(this._n).find((x) => isHtml(x, 'caption')) || null) : undefined; }
    // row and cells
    get cells() { return isHtml(this._n, 'tr') ? kids(this._n).filter((x) => isHtml(x, 'td') || isHtml(x, 'th')).map(wrap) : undefined; }
    get rowSpan() { const v = nonNegative(this.getAttribute('rowspan')); return v === null ? 1 : Math.min(v, 65534); }
    get colSpan() { const v = nonNegative(this.getAttribute('colspan')); return v === null ? 1 : Math.min(Math.max(v, 1), 1000); }
  }

  /* parse5 slows down with the square of the nesting depth (minutes for 200,000 nested <div>); browsers flatten the tree at a
   * depth of 512, parse5 does not. The depth is estimated first, in one pass: past MAX_DEPTH the file is refused (the page,
   * in a browser, would read it: a known difference, for files no tool writes). Elements HTML closes by itself (p, li, td,
   * tr ...) and void elements are not counted, nor text inside script, style, textarea and title. */
  const MAX_DEPTH = 5000;
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'keygen', 'frame', 'basefont', 'bgsound', 'image']);
  const SELF_CLOSING = new Set(['p', 'li', 'td', 'th', 'tr', 'dt', 'dd', 'option', 'optgroup', 'thead', 'tbody', 'tfoot', 'colgroup', 'caption', 'rb', 'rt', 'rtc', 'rp', 'html', 'head', 'body']);
  const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
  function htmlDepth(text) {
    const lower = text.length > 20000000 ? null : text.toLowerCase();
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g;
    let depth = 0, max = 0, m;
    while ((m = re.exec(text))) {
      const tag = m[2].toLowerCase();
      if (VOID.has(tag) || SELF_CLOSING.has(tag)) continue;
      if (m[1]) { if (depth > 0) depth--; continue; }
      if (m[0].endsWith('/>')) continue;
      if (RAW.has(tag) && lower) { const e = lower.indexOf('</' + tag, re.lastIndex); if (e < 0) break; re.lastIndex = e; continue; }
      if (++depth > max) { max = depth; if (max > MAX_DEPTH) return max; }
    }
    return max;
  }
  function htmlDocument(text) {
    if (htmlDepth(text) > MAX_DEPTH) throw new Error('the HTML is nested more than ' + MAX_DEPTH + ' levels deep (the command-line tool does not read it)');
    // DOMParser documents have scripting disabled: <noscript> content is parsed as markup, as in browsers
    return wrap(window.parse5.parse(text, { scriptingEnabled: false }));
  }

  window.DOMParser = class DOMParser {
    parseFromString(text, mime) {
      if (mime === 'text/html') return htmlDocument(String(text));
      return xmlDocument(String(text), mime);
    }
  };
})();
