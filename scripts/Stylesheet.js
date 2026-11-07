/**
 * @file Stylesheet.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { DOMParser, DOMImplementation } = require('@xmldom/xmldom');
const { XsltError } = require('./XsltError');
const { Pattern } = require('./Pattern');
const { Names } = require('./Names');
const { NumberFormat } = require('./NumberFormat');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc A compiled stylesheet: its modules loaded through xsl:include
 *   and xsl:import, with import precedence worked out, and its declarations
 *   gathered into lookup tables. Template rules are sorted once, by import
 *   precedence, then priority, then position, and indexed by name, so that
 *   finding the rule for a node is a short scan.
 */
const Stylesheet = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static XSLT_NS = 'http://www.w3.org/1999/XSL/Transform';

  static DECLARATIONS = [
    'import', 'include', 'strip-space', 'preserve-space', 'output', 'key', 'decimal-format',
    'namespace-alias', 'attribute-set', 'variable', 'param', 'template', 'function'
  ];

  static DECIMAL_FORMAT_ATTRIBUTES = {
    'decimal-separator': 'decimalSeparator',
    'grouping-separator': 'groupingSeparator',
    infinity: 'infinity',
    'minus-sign': 'minusSign',
    NaN: 'NaN',
    percent: 'percent',
    'per-mille': 'perMille',
    'zero-digit': 'zeroDigit',
    digit: 'digit',
    'pattern-separator': 'patternSeparator'
  };

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance initialization
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  constructor (
    options = {}
  ) {
    this.options = options;
    this.loader = options.loader || Stylesheet.defaultLoader;
    this.modules = [];
    this.rules = [];
    this.modes = new Map();
    this.namedTemplates = new Map();
    this.globals = new Map();
    this.keys = new Map();
    this.attributeSets = new Map();
    this.decimalFormats = new Map();
    this.namespaceAliases = new Map();
    this.functions = new Map();
    this.output = {};
    this.outputPrecedence = {};
    this.cdataSectionElements = new Set();
    this.spaceRules = [];
    this.patterns = new Map();
    this.literals = new WeakMap();
    this.position = 0;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Compiles a stylesheet document.
   * @param {Document} doc - The stylesheet.
   * @param {Object} [options]
   * @param {string} [options.baseURI] - Where the stylesheet came from, for
   *   resolving xsl:include, xsl:import and document().
   * @param {Function} [options.loader] - async (uri) => text, to load modules.
   * @returns {Promise<Stylesheet>}
   */
  static async compile (
    doc,
    options = {}
  ) {
    const stylesheet = new Stylesheet(options);
    const root = await stylesheet.loadModule(doc, options.baseURI || '', []);
    let precedence = 0;
    const assign = (module) => {
      const first = precedence + 1;
      for (const imported of module.imports) {
        assign(imported);
      }
      module.precedence = ++precedence;
      module.minImportPrecedence = first;
    };
    assign(root);
    stylesheet.root = root;
    stylesheet.register(root);
    stylesheet.finish();
    return stylesheet;
  }

  /**
   * Loads a module's text from a file path, file: URL or http(s) URL.
   */
  static async defaultLoader (
    uri
  ) {
    if ((/^https?:/i).test(uri)) {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' loading ' + uri);
      }
      return response.text();
    }
    const filePath = (/^file:/i).test(uri) ? decodeURIComponent(new URL(uri).pathname) : uri;
    return fs.promises.readFile(filePath, 'utf-8');
  }

  /**
   * Resolves a relative URI against a base, which may be a URL or a file path.
   */
  static resolve (
    href,
    base
  ) {
    if ((/^[a-z][a-z0-9+.-]*:/i).test(href)) {
      return href;
    }
    if ((/^[a-z][a-z0-9+.-]*:/i).test(base || '')) {
      return new URL(href, base).href;
    }
    if (!base) {
      return href;
    }
    return path.resolve(path.dirname(base), href);
  }

  /**
   * Parses XML text, reporting well-formedness errors as XsltErrors.
   */
  static parse (
    text,
    uri,
    code = 'XTSE0165'
  ) {
    let failure = null;
    const parser = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning' && !failure) {
          failure = message;
        }
      }
    });
    let doc;
    try {
      doc = parser.parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
    } catch (error) {
      failure = failure || error.message;
    }
    if (failure || !doc || !doc.documentElement) {
      throw new XsltError(code, 'Could not parse ' + (uri || 'document') + ': ' + (failure || 'no root element'));
    }
    return doc;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance internal methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Loads a stylesheet module and, recursively, the modules it includes and imports.
   * @returns {Object} The module: { doc, baseURI, imports, declarations }.
   */
  async loadModule (
    doc,
    baseURI,
    loading
  ) {
    doc.xsltBaseURI = baseURI;
    Stylesheet.stripDocumentLevel(doc);
    Stylesheet.stripStylesheet(doc.documentElement);
    let root = doc.documentElement;
    const isStylesheet = root.namespaceURI === Stylesheet.XSLT_NS && ['stylesheet', 'transform'].includes(root.localName);
    if (!isStylesheet) {
      if (!root.getAttributeNodeNS(Stylesheet.XSLT_NS, 'version')) {
        throw new XsltError('XTSE0150', 'The document element is neither xsl:stylesheet nor a literal result element with xsl:version', root);
      }
      root = Stylesheet.simplified(doc, root);
    } else if (!root.getAttribute('version')) {
      throw new XsltError('XTSE0010', 'xsl:stylesheet has no version attribute', root);
    }

    const module = { doc, root, baseURI, imports: [], declarations: [] };
    this.modules.push(module);
    await this.gather(module, root, baseURI, [...loading, baseURI], true);
    return module;
  }

  /**
   * Turns a simplified stylesheet (a literal result element as the document
   * element) into a stylesheet with one template matching "/".
   */
  static simplified (
    doc,
    element
  ) {
    const stylesheet = doc.createElementNS(Stylesheet.XSLT_NS, 'xsl:stylesheet');
    stylesheet.setAttribute('version', element.getAttributeNS(Stylesheet.XSLT_NS, 'version'));
    const template = doc.createElementNS(Stylesheet.XSLT_NS, 'xsl:template');
    template.setAttribute('match', '/');
    doc.replaceChild(stylesheet, element);
    stylesheet.appendChild(template);
    template.appendChild(element);
    for (let i = 0; i < element.attributes.length; i++) {
      const a = element.attributes[i];
      if (a.name === 'xmlns' || a.prefix === 'xmlns') {
        stylesheet.setAttributeNS(Names.XMLNS_NS, a.name, a.value);
      }
    }
    return stylesheet;
  }

  /**
   * Gathers the top-level elements of a module, expanding xsl:include in
   * place and loading xsl:import modules.
   */
  async gather (
    module,
    root,
    baseURI,
    loading,
    importsAllowed
  ) {
    for (let child = root.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) {
        if (child.nodeType === 3 && child.data.trim()) {
          throw new XsltError('XTSE0120', 'Text is not allowed at the top level of a stylesheet', child);
        }
        continue;
      }
      if (child.namespaceURI === Stylesheet.XSLT_NS && (child.localName === 'import' || child.localName === 'include')) {
        const href = child.getAttribute('href');
        if (!href) {
          throw new XsltError('XTSE0010', 'xsl:' + child.localName + ' has no href', child);
        }
        const uri = Stylesheet.resolve(href, baseURI);
        if (loading.includes(uri)) {
          throw new XsltError('XTSE0180', 'Stylesheet module ' + href + ' includes or imports itself', child);
        }
        let text;
        try {
          text = await this.loader(uri);
        } catch (error) {
          throw new XsltError('XTSE0165', 'Could not load ' + href + ': ' + error.message, child);
        }
        const doc = Stylesheet.parse(text, uri);
        if (child.localName === 'import') {
          if (!importsAllowed) {
            throw new XsltError('XTSE0190', 'xsl:import must come before all other top-level elements', child);
          }
          module.imports.push(await this.loadModule(doc, uri, loading));
        } else {
          doc.xsltBaseURI = uri;
          Stylesheet.stripStylesheet(doc.documentElement);
          let includedRoot = doc.documentElement;
          if (!(includedRoot.namespaceURI === Stylesheet.XSLT_NS && ['stylesheet', 'transform'].includes(includedRoot.localName))) {
            includedRoot = Stylesheet.simplified(doc, includedRoot);
          }
          await this.gather(module, includedRoot, uri, [...loading, uri], true);
        }
        continue;
      }
      importsAllowed = false;
      module.declarations.push(child);
    }
  }

  /**
   * Removes text and the XML declaration (which the parser keeps as a
   * processing instruction) from the top level of a stylesheet document.
   */
  static stripDocumentLevel (
    doc
  ) {
    let child = doc.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (child.nodeType === 3 || child.nodeType === 7 || child.nodeType === 8) {
        doc.removeChild(child);
      }
      child = next;
    }
  }

  /**
   * Removes whitespace-only text, comments and processing instructions
   * from a stylesheet, except inside xsl:text or under xml:space="preserve".
   */
  static stripStylesheet (
    element,
    preserve = false
  ) {
    const space = element.getAttributeNS && element.getAttributeNS(Names.XML_NS, 'space');
    if (space === 'preserve') {
      preserve = true;
    } else if (space === 'default') {
      preserve = false;
    }
    const isText = element.namespaceURI === Stylesheet.XSLT_NS && element.localName === 'text';
    let child = element.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (child.nodeType === 8 || child.nodeType === 7) {
        element.removeChild(child);
      } else if ((child.nodeType === 3 || child.nodeType === 4) && !isText && !preserve && !child.data.trim()) {
        element.removeChild(child);
      } else if (child.nodeType === 1) {
        Stylesheet.stripStylesheet(child, preserve);
      }
      child = next;
    }
    Stylesheet.mergeText(element);
  }

  /**
   * Merges adjacent text and CDATA nodes left after stripping.
   */
  static mergeText (
    element
  ) {
    let child = element.firstChild;
    while (child) {
      const next = child.nextSibling;
      if ((child.nodeType === 3 || child.nodeType === 4) && next && (next.nodeType === 3 || next.nodeType === 4)) {
        const text = element.ownerDocument.createTextNode(child.data + next.data);
        element.replaceChild(text, child);
        element.removeChild(next);
        child = text;
        continue;
      }
      if (child.nodeType === 4) {
        const text = element.ownerDocument.createTextNode(child.data);
        element.replaceChild(text, child);
        child = text;
      }
      child = child.nextSibling;
    }
  }

  /**
   * Registers a module's declarations, imported modules first.
   */
  register (
    module
  ) {
    for (const imported of module.imports) {
      this.register(imported);
    }
    for (const element of module.declarations) {
      this.declare(element, module);
    }
  }

  /**
   * Registers one top-level element.
   */
  declare (
    element,
    module
  ) {
    const position = this.position++;
    const precedence = module.precedence;
    if (element.namespaceURI !== Stylesheet.XSLT_NS) {
      if (!element.namespaceURI) {
        throw new XsltError('XTSE0130', 'Top-level element ' + element.nodeName + ' must be in a namespace', element);
      }
      return; // User-defined data elements are ignored.
    }

    switch (element.localName) {
      case 'template': {
        const match = element.getAttribute('match');
        const name = element.getAttribute('name');
        if (!match && !name) {
          throw new XsltError('XTSE0500', 'xsl:template needs a match or a name attribute', element);
        }
        if (name) {
          const key = Names.expand(name, element);
          const existing = this.namedTemplates.get(key);
          if (existing && existing.precedence === precedence) {
            throw new XsltError('XTSE0660', 'Two templates are named ' + name, element);
          }
          if (!existing || existing.precedence < precedence) {
            this.namedTemplates.set(key, { node: element, precedence });
          }
        }
        if (match) {
          const pattern = new Pattern(match, element);
          const modeName = element.getAttribute('mode');
          const mode = modeName ? Names.expand(modeName, element) : '#default';
          const priorityAttr = element.getAttribute('priority');
          if (priorityAttr && Number.isNaN(Number(priorityAttr))) {
            throw new XsltError('XTSE0530', 'Invalid priority "' + priorityAttr + '"', element);
          }
          for (const alternative of pattern.alternatives) {
            this.rules.push({
              template: element,
              pattern,
              alternative,
              mode,
              module,
              precedence,
              priority: priorityAttr ? Number(priorityAttr) : alternative.priority,
              position
            });
          }
        }
        break;
      }
      case 'variable':
      case 'param': {
        const key = Names.expand(element.getAttribute('name'), element);
        const existing = this.globals.get(key);
        if (existing && existing.precedence === precedence) {
          throw new XsltError('XTSE0630', 'Two global variables are named $' + element.getAttribute('name'), element);
        }
        if (!existing || existing.precedence < precedence) {
          this.globals.set(key, { node: element, isParam: element.localName === 'param', precedence });
        }
        break;
      }
      case 'key': {
        const key = Names.expand(element.getAttribute('name'), element);
        const match = element.getAttribute('match');
        const use = element.getAttribute('use');
        if (!match || !use) {
          throw new XsltError('XTSE0010', 'xsl:key needs match and use attributes', element);
        }
        const list = this.keys.get(key) || [];
        list.push({ node: element, pattern: new Pattern(match, element), use });
        this.keys.set(key, list);
        break;
      }
      case 'attribute-set': {
        const key = Names.expand(element.getAttribute('name'), element);
        const list = this.attributeSets.get(key) || [];
        list.push(element);
        list.precedences = list.precedences || [];
        list.precedences.push(precedence);
        this.attributeSets.set(key, list);
        break;
      }
      case 'decimal-format': {
        const name = element.getAttribute('name');
        const key = name ? Names.expand(name, element) : '';
        const format = { ...(this.decimalFormats.get(key) || NumberFormat.DEFAULT_DECIMAL_FORMAT) };
        for (const [attr, prop] of Object.entries(Stylesheet.DECIMAL_FORMAT_ATTRIBUTES)) {
          if (element.hasAttribute(attr)) {
            format[prop] = element.getAttribute(attr);
          }
        }
        this.decimalFormats.set(key, format);
        break;
      }
      case 'namespace-alias': {
        const from = element.getAttribute('stylesheet-prefix');
        const to = element.getAttribute('result-prefix');
        const fromURI = Names.lookup(element, from === '#default' ? null : from);
        const toURI = Names.lookup(element, to === '#default' ? null : to);
        if (fromURI === null || toURI === null) {
          throw new XsltError('XTSE0812', 'Undeclared prefix in xsl:namespace-alias', element);
        }
        const existing = this.namespaceAliases.get(fromURI);
        if (!existing || existing.precedence <= precedence) {
          this.namespaceAliases.set(fromURI, { uri: toURI, prefix: (to === '#default') ? '' : to, precedence });
        }
        break;
      }
      case 'output':
        this.declareOutput(element, precedence);
        break;
      case 'strip-space':
      case 'preserve-space': {
        const elements = (element.getAttribute('elements') || '').trim();
        if (!elements) {
          throw new XsltError('XTSE0010', 'xsl:' + element.localName + ' needs an elements attribute', element);
        }
        for (const test of elements.split(/\s+/)) {
          this.spaceRules.push(Stylesheet.spaceRule(test, element, element.localName === 'strip-space', precedence, position));
        }
        break;
      }
      case 'function': {
        const key = Names.expand(element.getAttribute('name'), element);
        this.functions.set(key, { node: element, precedence });
        break;
      }
      default:
        if (!Stylesheet.isForwardsCompatible(element)) {
          throw new XsltError('XTSE0010', 'Unknown top-level element ' + element.nodeName, element);
        }
    }
  }

  /**
   * Merges an xsl:output declaration.
   */
  declareOutput (
    element,
    precedence
  ) {
    const map = {
      method: 'method',
      version: 'version',
      encoding: 'encoding',
      'omit-xml-declaration': 'omitXmlDeclaration',
      standalone: 'standalone',
      'doctype-public': 'doctypePublic',
      'doctype-system': 'doctypeSystem',
      indent: 'indent',
      'media-type': 'mediaType'
    };
    for (const [attr, prop] of Object.entries(map)) {
      if (element.hasAttribute(attr)) {
        if (this.outputPrecedence[prop] === undefined || this.outputPrecedence[prop] <= precedence) {
          let value = element.getAttribute(attr).trim();
          if (prop === 'method' && value.includes(':')) {
            value = Names.expand(value, element);
          }
          this.output[prop] = value;
          this.outputPrecedence[prop] = precedence;
        }
      }
    }
    const cdata = element.getAttribute('cdata-section-elements');
    if (cdata && cdata.trim()) {
      for (const name of cdata.trim().split(/\s+/)) {
        const colon = name.indexOf(':');
        const uri = (colon < 0) ? (Names.lookup(element, null) || '') : Names.lookup(element, name.slice(0, colon));
        this.cdataSectionElements.add(Names.key(uri, name.slice(colon + 1)));
      }
    }
  }

  /**
   * A rule for xsl:strip-space or xsl:preserve-space.
   */
  static spaceRule (
    test,
    element,
    strip,
    precedence,
    position
  ) {
    if (test === '*') {
      return { uri: null, localName: null, strip, precedence, priority: -0.5, position };
    }
    const colon = test.indexOf(':');
    const prefix = (colon < 0) ? null : test.slice(0, colon);
    const local = test.slice(colon + 1);
    const uri = prefix ? Names.lookup(element, prefix) : '';
    if (uri === null) {
      throw new XsltError('XTSE0280', 'Undeclared prefix in "' + test + '"', element);
    }
    if (local === '*') {
      return { uri, localName: null, strip, precedence, priority: -0.25, position };
    }
    return { uri, localName: local, strip, precedence, priority: 0, position };
  }

  /**
   * Is an element processed in forwards-compatible mode (version above 1.0)?
   */
  static isForwardsCompatible (
    element
  ) {
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      const version = (e.namespaceURI === Stylesheet.XSLT_NS) ? e.getAttribute('version') : e.getAttributeNS(Stylesheet.XSLT_NS, 'version');
      if (version) {
        return Number(version) !== 1;
      }
    }
    return false;
  }

  /**
   * Sorts the template rules and indexes them by mode and name.
   */
  finish () {
    this.rules.sort((a, b) => (b.precedence - a.precedence) || (b.priority - a.priority) || (b.position - a.position));
    for (const rule of this.rules) {
      let mode = this.modes.get(rule.mode);
      if (!mode) {
        mode = { rules: [], byElementName: new Map(), byAttributeName: new Map(), generic: [], cache: new Map() };
        this.modes.set(rule.mode, mode);
      }
      mode.rules.push(rule);
      const name = rule.alternative.lastName;
      if (name) {
        const index = name.isAttribute ? mode.byAttributeName : mode.byElementName;
        const list = index.get(name.localName) || [];
        list.push(rule);
        index.set(name.localName, list);
      } else {
        mode.generic.push(rule);
      }
    }
    for (const [key, sets] of this.attributeSets) {
      const order = sets.map((s, i) => ({ s, p: sets.precedences[i], i }));
      order.sort((a, b) => (a.p - b.p) || (a.i - b.i));
      this.attributeSets.set(key, order.map((o) => o.s));
    }
    this.spaceRules.sort((a, b) => (b.precedence - a.precedence) || (b.priority - a.priority) || (b.position - a.position));
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Finds the template rule for a node in a mode.
   * @param {Node} node - The node.
   * @param {string} mode - The mode.
   * @param {Object} [bounds] - { min, max } import precedence, for apply-imports.
   * @param {Function} makeContext - Builds XPath contexts for predicates.
   * @returns {Object|null} The rule.
   */
  findRule (
    node,
    mode,
    bounds,
    makeContext
  ) {
    const index = this.modes.get(mode);
    if (!index) {
      return null;
    }
    for (const rule of this.candidates(index, node)) {
      if (bounds && (rule.precedence < bounds.min || rule.precedence > bounds.max)) {
        continue;
      }
      if (rule.pattern.matchesAlternative(node, rule.alternative, (n) => makeContext(n, rule.template))) {
        return rule;
      }
    }
    return null;
  }

  /**
   * The rules that could match a node, in priority order.
   */
  candidates (
    index,
    node
  ) {
    let named = null;
    let cacheKey;
    if (node.nodeType === 1) {
      named = index.byElementName.get(node.localName || node.nodeName);
      cacheKey = 'e:' + (node.localName || node.nodeName);
    } else if (node.nodeType === 2) {
      named = index.byAttributeName.get(node.localName || node.nodeName);
      cacheKey = 'a:' + (node.localName || node.nodeName);
    }
    if (!named) {
      return index.generic;
    }
    let merged = index.cache.get(cacheKey);
    if (!merged) {
      const set = new Set([...named, ...index.generic]);
      merged = index.rules.filter((r) => set.has(r));
      index.cache.set(cacheKey, merged);
    }
    return merged;
  }

  /**
   * A pattern, compiled once, for xsl:number count and from attributes.
   */
  pattern (
    text,
    element
  ) {
    let pattern = this.patterns.get(text);
    if (!pattern) {
      pattern = new Pattern(text, element);
      this.patterns.set(text, pattern);
    }
    return pattern;
  }

  /**
   * Is an element an extension element, declared with extension-element-prefixes?
   */
  isExtensionElement (
    element
  ) {
    const uri = element.namespaceURI;
    if (!uri) {
      return false;
    }
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      const prefixes = (e.namespaceURI === Stylesheet.XSLT_NS)
        ? e.getAttribute('extension-element-prefixes')
        : e.getAttributeNS(Stylesheet.XSLT_NS, 'extension-element-prefixes');
      if (prefixes) {
        for (const prefix of prefixes.trim().split(/\s+/)) {
          if (Names.lookup(e, prefix === '#default' ? null : prefix) === uri) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * What a literal result element produces: its name, namespace, the
   * namespaces to copy and its attributes, worked out once.
   */
  literalInfo (
    element
  ) {
    let info = this.literals.get(element);
    if (info) {
      return info;
    }

    const excluded = new Set([Stylesheet.XSLT_NS]);
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      const isXslt = e.namespaceURI === Stylesheet.XSLT_NS;
      for (const attr of ['exclude-result-prefixes', 'extension-element-prefixes']) {
        const value = isXslt ? e.getAttribute(attr) : e.getAttributeNS(Stylesheet.XSLT_NS, attr);
        if (value && (isXslt ? ['stylesheet', 'transform'].includes(e.localName) : true)) {
          for (const prefix of value.trim().split(/\s+/)) {
            const uri = (prefix === '#default') ? Names.lookup(e, null) : Names.lookup(e, prefix);
            if (uri === null) {
              throw new XsltError('XTSE0808', 'Undeclared prefix "' + prefix + '" in ' + attr, e);
            }
            excluded.add(uri);
          }
        }
      }
    }

    const alias = (uri) => this.namespaceAliases.get(uri || '') || null;
    const namespaces = new Map();
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      for (let i = 0; i < e.attributes.length; i++) {
        const a = e.attributes[i];
        if (a.name === 'xmlns' || a.prefix === 'xmlns') {
          const prefix = (a.name === 'xmlns') ? '' : a.localName;
          if (!namespaces.has(prefix)) {
            namespaces.set(prefix, a.value);
          }
        }
      }
    }
    const copied = new Map();
    for (const [prefix, uri] of namespaces) {
      if (uri === '' || excluded.has(uri)) {
        continue;
      }
      const target = alias(uri);
      if (target) {
        continue;
      }
      if (this.isAliasSource(uri)) {
        continue;
      }
      copied.set(prefix, uri);
    }

    let namespaceURI = element.namespaceURI || '';
    let qname = element.nodeName;
    const elementAlias = alias(namespaceURI);
    if (elementAlias) {
      namespaceURI = elementAlias.uri;
      qname = (elementAlias.prefix ? elementAlias.prefix + ':' : '') + element.localName;
      if (namespaceURI) {
        copied.set(elementAlias.prefix, namespaceURI);
      }
    }

    const attributes = [];
    for (let i = 0; i < element.attributes.length; i++) {
      const a = element.attributes[i];
      if (a.name === 'xmlns' || a.prefix === 'xmlns' || a.namespaceURI === Stylesheet.XSLT_NS) {
        continue;
      }
      let uri = a.namespaceURI || null;
      let name = a.name;
      const attrAlias = uri ? alias(uri) : null;
      if (attrAlias) {
        uri = attrAlias.uri || null;
        name = (attrAlias.prefix ? attrAlias.prefix + ':' : '') + a.localName;
      }
      attributes.push({ node: a, namespaceURI: uri, qname: name });
    }

    info = { namespaceURI, qname, namespaces: copied, attributes };
    this.literals.set(element, info);
    return info;
  }

  /**
   * Is a namespace the source of an xsl:namespace-alias?
   */
  isAliasSource (
    uri
  ) {
    return this.namespaceAliases.has(uri);
  }

  /**
   * Strips whitespace-only text nodes from a source document as
   * xsl:strip-space and xsl:preserve-space direct. The document is copied
   * first, so the caller's document is not changed.
   */
  stripSource (
    doc
  ) {
    if (!doc) {
      return doc;
    }
    const stray = (n) => (n.nodeType === 3) || (n.nodeType === 7 && n.target.toLowerCase() === 'xml');
    let hasStray = false;
    for (let child = doc.firstChild; child; child = child.nextSibling) {
      if (stray(child)) {
        hasStray = true;
      }
    }
    const stripping = this.spaceRules.some((r) => r.strip);
    if (!hasStray && !stripping) {
      return doc;
    }
    // A new document with imported nodes, since xmldom's cloneNode gives a
    // document whose nodes cannot be compared for document order.
    const copy = new DOMImplementation().createDocument(null, null, null);
    copy.xsltBaseURI = doc.xsltBaseURI;
    for (let child = doc.firstChild; child; child = child.nextSibling) {
      if (!stray(child) && child.nodeType !== 10) {
        copy.appendChild(copy.importNode(child, true));
      }
    }
    if (!stripping) {
      return copy;
    }
    const visit = (element, preserve) => {
      const space = element.getAttributeNS(Names.XML_NS, 'space');
      if (space === 'preserve') {
        preserve = true;
      } else if (space === 'default') {
        preserve = false;
      }
      const strip = !preserve && this.shouldStrip(element);
      let c = element.firstChild;
      while (c) {
        const next = c.nextSibling;
        if (c.nodeType === 3 && strip && !c.data.trim()) {
          element.removeChild(c);
        } else if (c.nodeType === 1) {
          visit(c, preserve);
        }
        c = next;
      }
    };
    if (copy.documentElement) {
      visit(copy.documentElement, false);
    }
    return copy;
  }

  /**
   * Does xsl:strip-space apply to an element?
   */
  shouldStrip (
    element
  ) {
    const uri = element.namespaceURI || '';
    const local = element.localName || element.nodeName;
    for (const rule of this.spaceRules) {
      if ((rule.uri === null || rule.uri === uri) && (rule.localName === null || rule.localName === local)) {
        return rule.strip;
      }
    }
    return false;
  }

  /**
   * The base URI of the stylesheet module a node belongs to.
   */
  baseURIOf (
    node
  ) {
    const doc = node ? (node.nodeType === 9 ? node : node.ownerDocument) : null;
    return (doc && doc.xsltBaseURI) || '';
  }

  /**
   * The base URI of a source node, for document().
   */
  baseURIOfSource (
    node,
    processor
  ) {
    const doc = node ? (node.nodeType === 9 ? node : node.ownerDocument) : null;
    if (doc && doc.xsltBaseURI) {
      return doc.xsltBaseURI;
    }
    if (doc && doc === processor.sourceDoc) {
      return processor.options.inputURL || '';
    }
    return '';
  }

  /**
   * Resolves a URI for document().
   */
  resolveURI (
    href,
    base
  ) {
    return Stylesheet.resolve(href, base);
  }

  /**
   * Loads a document synchronously, for document(). A custom loader, given
   * as the documentLoader option, may return a Document or XML text.
   */
  loadDocumentSync (
    uri,
    customLoader
  ) {
    if (customLoader) {
      const result = customLoader(uri);
      if (result === null || result === undefined) {
        return null;
      }
      const doc = (typeof result === 'string') ? Stylesheet.parse(result, uri, 'XTDE1160') : result;
      doc.xsltBaseURI = doc.xsltBaseURI || uri;
      return doc;
    }
    if ((/^https?:/i).test(uri)) {
      throw new Error('document() cannot fetch ' + uri + ' without a documentLoader option');
    }
    const filePath = (/^file:/i).test(uri) ? decodeURIComponent(new URL(uri).pathname) : uri;
    const doc = Stylesheet.parse(fs.readFileSync(filePath, 'utf-8'), uri, 'XTDE1160');
    doc.xsltBaseURI = uri;
    return doc;
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.Stylesheet = Stylesheet;

// ----------------------------------------------------------------------------
