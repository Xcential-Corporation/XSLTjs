/**
 * @file Functions.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const XPath = require('xpath');
const { XsltError } = require('./XsltError');
const { NumberFormat } = require('./NumberFormat');
const { Names } = require('./Names');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc The functions available to XPath expressions in a stylesheet:
 *   the XPath 1.0 core library, the XSLT 1.0 additions, a few XPath 2.0
 *   string functions kept for compatibility, functions declared with
 *   xsl:function, and custom functions supplied by the caller.
 */
const Functions = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static XSLT_NS = 'http://www.w3.org/1999/XSL/Transform';

  static XSLT_INSTRUCTIONS = [
    'apply-imports', 'apply-templates', 'attribute', 'call-template', 'choose', 'comment', 'copy',
    'copy-of', 'element', 'fallback', 'for-each', 'if', 'message', 'number', 'processing-instruction',
    'text', 'value-of', 'variable'
  ];

  static XSLT_FUNCTIONS = [
    'current', 'document', 'element-available', 'format-number', 'function-available', 'generate-id',
    'key', 'system-property', 'unparsed-entity-uri'
  ];

  static EXTRA_FUNCTIONS = ['replace', 'matches', 'lower-case', 'upper-case', 'ends-with', 'string-join', 'tokenize', 'counter'];

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance initialization
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  constructor (
    processor
  ) {
    this.processor = processor;
    this.core = new XPath.FunctionResolver();
    this.counterValue = 1;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * The function resolver given to the XPath engine.
   */
  resolver () {
    const functions = this;
    return {
      thisArg: { XPath },
      getFunction: (localName, namespaceURI) => functions.find(localName, namespaceURI || '')
    };
  }

  /**
   * Finds a function by expanded name.
   */
  find (
    localName,
    namespaceURI
  ) {
    const processor = this.processor;
    if (namespaceURI === '') {
      const core = this.core.functions['{}' + localName];
      if (core) {
        const coreThis = this.core.thisArg;
        return (c, ...args) => core.apply(coreThis, [c, ...args]);
      }
      const name = Functions.camel(localName);
      if ((Functions.XSLT_FUNCTIONS.includes(localName) || Functions.EXTRA_FUNCTIONS.includes(localName)) && this[name]) {
        return (c, ...args) => this[name](c, ...args);
      }
    }

    const custom = processor.customFunctions[namespaceURI];
    if (custom && typeof custom[localName] === 'function') {
      const thisArg = { XPath, processor };
      return (c, ...args) => {
        const result = custom[localName].call(thisArg, c, ...args);
        return Functions.toXPathValue(result);
      };
    }

    const declared = processor.stylesheet.functions.get(Names.key(namespaceURI, localName));
    if (declared) {
      return (c, ...args) => this.callStylesheetFunction(declared, c, args);
    }
    return undefined;
  }

  /**
   * Is a function available, for function-available()?
   */
  isAvailable (
    localName,
    namespaceURI
  ) {
    return !!this.find(localName, namespaceURI);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static internal methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static camel (
    name
  ) {
    return name.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
  }

  /**
   * Converts a JavaScript value returned by a custom function to an XPath value.
   */
  static toXPathValue (
    value
  ) {
    if (value instanceof XPath.XNodeSet || value instanceof XPath.XString || value instanceof XPath.XNumber || value instanceof XPath.XBoolean) {
      return value;
    }
    if (value === null || value === undefined) {
      return new XPath.XString('');
    }
    if (typeof value === 'number') {
      return new XPath.XNumber(value);
    }
    if (typeof value === 'boolean') {
      return new XPath.XBoolean(value);
    }
    if (value.nodeType) {
      const nodeSet = new XPath.XNodeSet();
      nodeSet.add(value);
      return nodeSet;
    }
    if (value.evaluate && value.stringValue) {
      return value;
    }
    return new XPath.XString(String(value));
  }

  /**
   * Evaluates an argument expression.
   */
  static arg (
    c,
    expr
  ) {
    return (expr === undefined) ? undefined : expr.evaluate(c);
  }

  static str (
    c,
    expr
  ) {
    return (expr === undefined) ? '' : expr.evaluate(c).stringValue();
  }

  static nodeSet (
    nodes
  ) {
    const nodeSet = new XPath.XNodeSet();
    nodeSet.addArray(nodes);
    return nodeSet;
  }

  /**
   * Resolves a QName passed as a string to a function, using the
   * namespaces of the stylesheet element the expression is on.
   */
  static resolveName (
    c,
    qname
  ) {
    const colon = qname.indexOf(':');
    if (colon < 0) {
      return ['', qname];
    }
    const uri = c.namespaceResolver.getNamespace(qname.slice(0, colon), c.contextNode);
    if (uri === null || uri === undefined) {
      throw new XsltError('XTDE1400', 'Undeclared prefix in "' + qname + '"', c.xslt && c.xslt.styleNode);
    }
    return [uri, qname.slice(colon + 1)];
  }

  /**
   * Converts a pattern-style regular expression flag string for JavaScript.
   */
  static regex (
    pattern,
    flags = ''
  ) {
    const jsFlags = flags.replace(/[^ims]/g, '') + 'u';
    const source = flags.includes('x') ? pattern.replace(/\s+/g, '') : pattern;
    return new RegExp(source, jsFlags);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - XSLT 1.0 functions
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  current (
    c
  ) {
    return Functions.nodeSet([c.xslt.ctx.current]);
  }

  document (
    c,
    uriExpr,
    baseExpr
  ) {
    const processor = this.processor;
    const value = uriExpr.evaluate(c);
    const styleNode = c.xslt.styleNode;
    const styleBase = processor.stylesheet.baseURIOf(styleNode);
    let baseOverride = null;
    if (baseExpr) {
      const baseValue = baseExpr.evaluate(c);
      const first = (baseValue instanceof XPath.XNodeSet) ? baseValue.toArray()[0] : null;
      baseOverride = first ? processor.stylesheet.baseURIOfSource(first, processor) : null;
    }
    const results = [];
    const load = (uri, base) => {
      if (uri === '' && !baseExpr) {
        const doc = styleNode ? (styleNode.ownerDocument || styleNode) : null;
        if (doc) {
          results.push(doc);
        }
        return;
      }
      const resolved = processor.stylesheet.resolveURI(uri.replace(/#.*$/, ''), base);
      const doc = processor.loadDocument(resolved, styleNode);
      if (doc) {
        results.push(doc);
      }
    };
    if (value instanceof XPath.XNodeSet) {
      for (const node of value.toArray()) {
        const base = baseOverride || processor.stylesheet.baseURIOfSource(node, processor) || styleBase;
        load(XPath.XNodeSet.prototype.stringForNode(node), base);
      }
    } else {
      load(value.stringValue(), baseOverride || styleBase);
    }
    return Functions.nodeSet(results);
  }

  key (
    c,
    nameExpr,
    valueExpr
  ) {
    const processor = this.processor;
    const name = Functions.str(c, nameExpr);
    const [uri, local] = Functions.resolveName(c, name);
    const keyName = '{' + uri + '}' + local;
    const value = valueExpr.evaluate(c);
    const results = [];
    const lookup = (v) => {
      for (const node of processor.keyLookup(keyName, v, c.contextNode, c.xslt.styleNode)) {
        results.push(node);
      }
    };
    if (value instanceof XPath.XNodeSet) {
      for (const node of value.toArray()) {
        lookup(XPath.XNodeSet.prototype.stringForNode(node));
      }
    } else {
      lookup(value.stringValue());
    }
    return Functions.nodeSet(results);
  }

  formatNumber (
    c,
    numberExpr,
    pictureExpr,
    nameExpr
  ) {
    const number = numberExpr.evaluate(c).numberValue();
    const picture = Functions.str(c, pictureExpr);
    let decimalFormat;
    if (nameExpr) {
      const [uri, local] = Functions.resolveName(c, Functions.str(c, nameExpr));
      decimalFormat = this.processor.stylesheet.decimalFormats.get('{' + uri + '}' + local);
      if (!decimalFormat) {
        throw new XsltError('XTDE1280', 'No decimal format named ' + Functions.str(c, nameExpr), c.xslt.styleNode);
      }
    } else {
      decimalFormat = this.processor.stylesheet.decimalFormats.get('') || NumberFormat.DEFAULT_DECIMAL_FORMAT;
    }
    return new XPath.XString(NumberFormat.formatNumber(number, picture, decimalFormat, c.xslt.styleNode));
  }

  generateId (
    c,
    nodeSetExpr
  ) {
    let node = c.contextNode;
    if (nodeSetExpr) {
      const value = nodeSetExpr.evaluate(c);
      if (!(value instanceof XPath.XNodeSet)) {
        throw new XsltError('XTTE0520', 'generate-id() requires a node-set', c.xslt.styleNode);
      }
      node = value.toArray()[0];
      if (!node) {
        return new XPath.XString('');
      }
    }
    return new XPath.XString(this.processor.generateId(node));
  }

  systemProperty (
    c,
    nameExpr
  ) {
    const [uri, local] = Functions.resolveName(c, Functions.str(c, nameExpr));
    if (uri !== Functions.XSLT_NS) {
      return new XPath.XString('');
    }
    switch (local) {
      case 'version': return new XPath.XNumber(1.0);
      case 'vendor': return new XPath.XString('Xcential');
      case 'vendor-url': return new XPath.XString('https://github.com/Xcential-Corporation/XSLTjs');
      default: return new XPath.XString('');
    }
  }

  elementAvailable (
    c,
    nameExpr
  ) {
    const name = Functions.str(c, nameExpr);
    const colon = name.indexOf(':');
    const uri = (colon < 0) ? c.namespaceResolver.getNamespace('', c.contextNode) || '' : Functions.resolveName(c, name)[0];
    const local = name.slice(colon + 1);
    return new XPath.XBoolean(uri === Functions.XSLT_NS && Functions.XSLT_INSTRUCTIONS.includes(local));
  }

  functionAvailable (
    c,
    nameExpr
  ) {
    const [uri, local] = Functions.resolveName(c, Functions.str(c, nameExpr));
    return new XPath.XBoolean(this.isAvailable(local, uri));
  }

  unparsedEntityUri (
    c
  ) {
    return new XPath.XString('');
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - XPath 2.0 functions kept for compatibility
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  replace (
    c,
    textExpr,
    patternExpr,
    replacementExpr,
    flagsExpr
  ) {
    const text = Functions.str(c, textExpr);
    const re = Functions.regex(Functions.str(c, patternExpr), Functions.str(c, flagsExpr));
    const replacement = Functions.str(c, replacementExpr).replace(/\\\$/g, '$$$$').replace(/\$(\d)/g, '$$$1');
    return new XPath.XString(text.replace(new RegExp(re.source, re.flags + 'g'), replacement));
  }

  matches (
    c,
    textExpr,
    patternExpr,
    flagsExpr
  ) {
    const re = Functions.regex(Functions.str(c, patternExpr), Functions.str(c, flagsExpr));
    return new XPath.XBoolean(re.test(Functions.str(c, textExpr)));
  }

  lowerCase (
    c,
    textExpr
  ) {
    return new XPath.XString(Functions.str(c, textExpr).toLowerCase());
  }

  upperCase (
    c,
    textExpr
  ) {
    return new XPath.XString(Functions.str(c, textExpr).toUpperCase());
  }

  endsWith (
    c,
    textExpr,
    suffixExpr
  ) {
    return new XPath.XBoolean(Functions.str(c, textExpr).endsWith(Functions.str(c, suffixExpr)));
  }

  stringJoin (
    c,
    itemsExpr,
    separatorExpr
  ) {
    const value = itemsExpr.evaluate(c);
    const items = (value instanceof XPath.XNodeSet)
      ? value.toArray().map((n) => XPath.XNodeSet.prototype.stringForNode(n))
      : [value.stringValue()];
    return new XPath.XString(items.join(Functions.str(c, separatorExpr)));
  }

  /**
   * tokenize(), returning the tokens as text nodes so that they can be
   * iterated with xsl:for-each.
   */
  tokenize (
    c,
    textExpr,
    patternExpr,
    flagsExpr
  ) {
    const text = Functions.str(c, textExpr);
    const pattern = (patternExpr === undefined) ? '\\s+' : Functions.str(c, patternExpr);
    const source = (patternExpr === undefined) ? text.trim() : text;
    if (source === '') {
      return Functions.nodeSet([]);
    }
    const re = Functions.regex(pattern, Functions.str(c, flagsExpr));
    const doc = this.processor.resultDoc;
    const fragment = doc.createDocumentFragment();
    const nodes = source.split(re).map((t) => fragment.appendChild(doc.createTextNode(t)));
    return Functions.nodeSet(nodes);
  }

  /**
   * counter(): an extension returning 1, 2, 3 and so on with each call.
   */
  counter () {
    return new XPath.XString(String(this.counterValue++));
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Stylesheet functions
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Calls a function declared with xsl:function. A function body made of
   * xsl:sequence returns those values; other content returns a string,
   * or the nodes it built when the function's "as" type names nodes.
   */
  callStylesheetFunction (
    declaration,
    c,
    args
  ) {
    const processor = this.processor;
    const element = declaration.node;
    const values = args.map((a) => a.evaluate(c));
    const params = new Map();
    let i = 0;
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && child.namespaceURI === Functions.XSLT_NS && child.localName === 'param') {
        if (i < values.length) {
          params.set(Names.expand(child.getAttribute('name'), child), values[i]);
        }
        i++;
      }
    }
    const fragment = processor.resultDoc.createDocumentFragment();
    const sequence = [];
    const ctx = { ...c.xslt.ctx, node: c.contextNode, position: c.contextPosition, size: c.contextSize, scope: null, out: fragment, sequence, rule: null };
    processor.executeChildren(element, ctx, params);
    if (sequence.length === 1 && !fragment.firstChild) {
      return sequence[0];
    }
    const as = element.getAttribute('as') || '';
    if ((/node\(\)|element\(|document-node|item\(\)/).test(as)) {
      const nodes = [];
      for (let child = fragment.firstChild; child; child = child.nextSibling) {
        nodes.push(child);
      }
      for (const value of sequence) {
        if (value instanceof XPath.XNodeSet) {
          nodes.push(...value.toArray());
        }
      }
      return Functions.nodeSet(nodes);
    }
    const text = XPath.XNodeSet.prototype.stringForContainerNode(fragment) + sequence.map((v) => v.stringValue()).join('');
    if ((/xs:(integer|decimal|double|float)/).test(as)) {
      return new XPath.XNumber(Number(text));
    }
    if ((/xs:boolean/).test(as) && sequence.length === 1) {
      return new XPath.XBoolean(sequence[0].booleanValue());
    }
    return new XPath.XString(text);
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.Functions = Functions;

// ----------------------------------------------------------------------------
