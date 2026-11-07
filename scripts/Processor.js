/**
 * @file Processor.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const XPath = require('xpath');
const { DOMImplementation } = require('@xmldom/xmldom');
const { XsltError } = require('./XsltError');
const { Pattern } = require('./Pattern');
const { NumberFormat } = require('./NumberFormat');
const { Functions } = require('./Functions');
const { Names } = require('./Names');
require('./XPathFixes');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc Runs a compiled stylesheet against a source document. The
 *   stylesheet is interpreted directly from its DOM; XPath expressions,
 *   attribute value templates and patterns are compiled once and cached.
 *   Execution is synchronous.
 */
const Processor = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static XSLT_NS = 'http://www.w3.org/1999/XSL/Transform';
  static MAX_DEPTH = 3000;

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance initialization
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * @param {Stylesheet} stylesheet - The compiled stylesheet.
   * @param {Object} [options]
   * @param {Object} [options.customFunctions] - { namespaceURI: { name: function } }.
   * @param {Function} [options.documentLoader] - (uri) => Document, for document().
   * @param {Function} [options.onMessage] - (text, terminate) => void, for xsl:message.
   * @param {Object} [options.logger] - An object with debug, info, warn and error methods.
   */
  constructor (
    stylesheet,
    options = {}
  ) {
    this.stylesheet = stylesheet;
    this.options = options;
    this.logger = options.logger || console;
    this.customFunctions = options.customFunctions || {};
    this.resultDoc = new DOMImplementation().createDocument(null, null, null);
    this.resultDoc.xsltScratch = true;
    this.expressions = new Map();
    this.avts = new WeakMap();
    this.namespaceResolvers = new WeakMap();
    this.globals = new Map();
    this.keyIndexes = new Map();
    this.documents = new Map();
    this.ids = new WeakMap();
    this.nextId = 1;
    this.depth = 0;
    this.functions = new Functions(this);
    this.functionResolver = this.functions.resolver();
    this.emptyScope = null;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Transforms a source document.
   * @param {Document} sourceDoc - The source document.
   * @param {Object} [params] - Values for global parameters, by name.
   * @param {Object} [options] - initialMode and initialTemplate.
   * @returns {DocumentFragment} The result tree.
   */
  transform (
    sourceDoc,
    params = {},
    options = {}
  ) {
    this.sourceDoc = this.stylesheet.stripSource(sourceDoc);
    this.params = params;
    const root = this.sourceDoc;
    const result = this.resultDoc.createDocumentFragment();
    const ctx = {
      node: root,
      position: 1,
      size: 1,
      current: root,
      scope: null,
      mode: options.initialMode ? Names.expand(options.initialMode) : '#default',
      rule: null,
      out: result
    };
    this.rootContext = ctx;

    if (options.initialTemplate) {
      const template = this.stylesheet.namedTemplates.get(Names.expand(options.initialTemplate));
      if (!template) {
        throw new XsltError('XTDE0040', 'No template named ' + options.initialTemplate);
      }
      this.invokeTemplate(template.node, ctx, new Map(), null);
    } else {
      this.applyTemplatesTo([root], ctx, ctx.mode, new Map(), null);
    }
    return result;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - XPath evaluation
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Compiles an expression, once.
   */
  compile (
    text,
    styleNode
  ) {
    let expression = this.expressions.get(text);
    if (!expression) {
      try {
        expression = XPath.parse(text).expression.expression;
      } catch (error) {
        throw new XsltError('XPST0003', 'Invalid expression "' + text + '": ' + error.message, styleNode);
      }
      this.expressions.set(text, expression);
    }
    return expression;
  }

  /**
   * Resolves namespace prefixes used in a stylesheet node's expressions.
   */
  namespaceResolver (
    styleNode
  ) {
    const element = (styleNode && styleNode.nodeType === 2) ? styleNode.ownerElement : styleNode;
    if (!element) {
      return { getNamespace: (prefix) => (prefix === 'xml') ? Names.XML_NS : null };
    }
    let resolver = this.namespaceResolvers.get(element);
    if (!resolver) {
      const cache = new Map();
      resolver = {
        getNamespace: (prefix) => {
          if (prefix === 'xml') {
            return Names.XML_NS;
          }
          if (!cache.has(prefix)) {
            cache.set(prefix, Names.lookup(element, prefix));
          }
          return cache.get(prefix);
        }
      };
      this.namespaceResolvers.set(element, resolver);
    }
    return resolver;
  }

  /**
   * Builds an XPath context for evaluating an expression.
   */
  makeXPathContext (
    ctx,
    styleNode
  ) {
    const processor = this;
    const scope = ctx.scope;
    const variableResolver = {
      getVariable: (localName, namespaceURI) => processor.getVariable(Names.key(namespaceURI, localName), scope, styleNode)
    };
    const c = new XPath.XPathContext(variableResolver, this.namespaceResolver(styleNode), this.functionResolver);
    c.contextNode = ctx.node;
    c.expressionContextNode = ctx.node;
    c.contextPosition = ctx.position;
    c.contextSize = ctx.size;
    c.caseInsensitive = false;
    c.xslt = { processor: this, ctx, styleNode };
    const root = this.rootOf(ctx.node);
    if (root && root.nodeType === 11) {
      c.virtualRoot = root;
    }
    return c;
  }

  /**
   * The root of the tree a node belongs to.
   */
  rootOf (
    node
  ) {
    if (!node) {
      return null;
    }
    if (node.nodeType === 9) {
      return node;
    }
    const doc = node.ownerDocument;
    if (doc && !doc.xsltScratch && doc !== this.resultDoc) {
      return doc;
    }
    let root = node;
    while (Pattern.parentOf(root)) {
      root = Pattern.parentOf(root);
    }
    return root;
  }

  /**
   * Evaluates an expression and returns its XPath value.
   */
  evaluate (
    text,
    ctx,
    styleNode
  ) {
    const expression = this.compile(text, styleNode);
    try {
      return expression.evaluate(this.makeXPathContext(ctx, styleNode));
    } catch (error) {
      throw XsltError.wrap(error, styleNode, 'XPTY0004');
    }
  }

  /**
   * Evaluates an expression that must return a node-set.
   * @returns {Node[]} The nodes, in document order.
   */
  selectNodes (
    text,
    ctx,
    styleNode
  ) {
    const value = this.evaluate(text, ctx, styleNode);
    if (!(value instanceof XPath.XNodeSet)) {
      throw new XsltError('XTTE0520', 'The expression "' + text + '" does not return a node-set', styleNode);
    }
    return value.toArray();
  }

  evaluateString (
    text,
    ctx,
    styleNode
  ) {
    return this.evaluate(text, ctx, styleNode).stringValue();
  }

  evaluateBoolean (
    text,
    ctx,
    styleNode
  ) {
    return this.evaluate(text, ctx, styleNode).booleanValue();
  }

  /**
   * Evaluates an attribute value template, such as "{@type}-title".
   */
  evaluateAVT (
    attribute,
    ctx
  ) {
    let parts = this.avts.get(attribute);
    if (!parts) {
      parts = Processor.parseAVT(attribute.value, attribute);
      this.avts.set(attribute, parts);
    }
    if (parts.length === 1 && typeof parts[0] === 'string') {
      return parts[0];
    }
    let result = '';
    for (const part of parts) {
      result += (typeof part === 'string') ? part : this.evaluateString(part.expr, ctx, attribute.ownerElement);
    }
    return result;
  }

  /**
   * Evaluates an optional attribute value template on an element.
   */
  attributeValue (
    element,
    name,
    ctx,
    fallback = null
  ) {
    const attribute = element.getAttributeNode(name);
    return attribute ? this.evaluateAVT(attribute, ctx) : fallback;
  }

  /**
   * Splits an attribute value template into literal strings and expressions.
   */
  static parseAVT (
    text,
    node
  ) {
    const parts = [];
    let literal = '';
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '{') {
        if (text[i + 1] === '{') {
          literal += '{';
          i += 2;
          continue;
        }
        let j = i + 1;
        let quote = null;
        while (j < text.length && (quote || text[j] !== '}')) {
          if (quote) {
            if (text[j] === quote) {
              quote = null;
            }
          } else if (text[j] === '"' || text[j] === "'") {
            quote = text[j];
          }
          j++;
        }
        if (j >= text.length) {
          throw new XsltError('XTSE0350', 'Unmatched "{" in attribute value template "' + text + '"', node);
        }
        if (literal) {
          parts.push(literal);
          literal = '';
        }
        const expr = text.slice(i + 1, j);
        if (!expr.trim()) {
          throw new XsltError('XTSE0350', 'Empty expression in attribute value template "' + text + '"', node);
        }
        parts.push({ expr });
        i = j + 1;
      } else if (c === '}') {
        if (text[i + 1] === '}') {
          literal += '}';
          i += 2;
          continue;
        }
        throw new XsltError('XTSE0370', 'Unmatched "}" in attribute value template "' + text + '"', node);
      } else {
        literal += c;
        i++;
      }
    }
    if (literal || parts.length === 0) {
      parts.push(literal);
    }
    return parts;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Looks up a variable: locals in scope first, then globals.
   */
  getVariable (
    key,
    scope,
    styleNode
  ) {
    for (let s = scope; s; s = s.parent) {
      if (s.key === key) {
        return s.value;
      }
    }
    return this.getGlobal(key, styleNode);
  }

  /**
   * Evaluates a global variable or parameter on first use.
   */
  getGlobal (
    key,
    styleNode
  ) {
    const state = this.globals.get(key);
    if (state) {
      if (state.evaluating) {
        throw new XsltError('XTDE0640', 'Circular definition of variable $' + Names.display(key), state.node);
      }
      return state.value;
    }
    const declaration = this.stylesheet.globals.get(key);
    if (!declaration) {
      // An extension kept for compatibility: a parameter passed by the
      // caller can be used even if the stylesheet does not declare it.
      const name = Names.display(key);
      if (key.startsWith('{}') && Object.prototype.hasOwnProperty.call(this.params, name)) {
        const value = Processor.toXPathValue(this.params[name]);
        this.globals.set(key, { evaluating: false, node: null, value });
        return value;
      }
      throw new XsltError('XPST0008', 'Variable $' + name + ' has not been declared', styleNode);
    }
    const entry = { evaluating: true, node: declaration.node, value: null };
    this.globals.set(key, entry);
    try {
      const localName = key.replace(/^\{[^}]*\}/, '');
      if (declaration.isParam && Object.prototype.hasOwnProperty.call(this.params, localName) && (key.startsWith('{}') || !key.startsWith('{'))) {
        entry.value = Processor.toXPathValue(this.params[localName], this);
      } else if (declaration.isParam && Object.prototype.hasOwnProperty.call(this.params, key)) {
        entry.value = Processor.toXPathValue(this.params[key], this);
      } else {
        const ctx = { ...this.rootContext, scope: null, out: null };
        entry.value = this.variableValue(declaration.node, ctx);
      }
    } finally {
      entry.evaluating = false;
    }
    return entry.value;
  }

  /**
   * The value of an xsl:variable, xsl:param or xsl:with-param: its select
   * expression, a result tree fragment from its content, or an empty string.
   */
  variableValue (
    element,
    ctx
  ) {
    const select = element.getAttribute('select');
    if (select) {
      return this.evaluate(select, ctx, element);
    }
    if (!element.firstChild) {
      return new XPath.XString('');
    }
    return this.resultTreeFragment(element, ctx);
  }

  /**
   * Instantiates content into a new result tree fragment.
   */
  resultTreeFragment (
    element,
    ctx
  ) {
    const fragment = this.resultDoc.createDocumentFragment();
    this.executeChildren(element, { ...ctx, out: fragment });
    const nodeSet = new XPath.XNodeSet();
    nodeSet.add(fragment);
    nodeSet.isResultTreeFragment = true;
    return nodeSet;
  }

  /**
   * Converts a JavaScript value supplied as a parameter to an XPath value.
   */
  static toXPathValue (
    value
  ) {
    if (value === null || value === undefined) {
      return new XPath.XString('');
    }
    if (value instanceof XPath.XNodeSet || value instanceof XPath.XString || value instanceof XPath.XNumber || value instanceof XPath.XBoolean) {
      return value;
    }
    if (typeof value === 'number') {
      return new XPath.XNumber(value);
    }
    if (typeof value === 'boolean') {
      return new XPath.XBoolean(value);
    }
    if (typeof value === 'object' && value.nodeType) {
      const nodeSet = new XPath.XNodeSet();
      nodeSet.add(value);
      return nodeSet;
    }
    if (Array.isArray(value) && value.every((v) => v && v.nodeType)) {
      const nodeSet = new XPath.XNodeSet();
      nodeSet.addArray(value);
      return nodeSet;
    }
    return new XPath.XString(String(value));
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Templates
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Applies templates to a list of nodes.
   * @param {Node[]} nodes - The nodes, already sorted.
   * @param {Object} ctx - The calling context.
   * @param {string} mode - The mode's expanded name, or #default.
   * @param {Map} params - Parameter values to pass, by expanded name.
   * @param {Object} [bounds] - Precedence bounds, for apply-imports.
   */
  applyTemplatesTo (
    nodes,
    ctx,
    mode,
    params,
    bounds
  ) {
    const size = nodes.length;
    for (let i = 0; i < size; i++) {
      const node = nodes[i];
      const nodeCtx = { ...ctx, node, position: i + 1, size, current: node, mode };
      const makeContext = (n, styleNode) => this.makePatternContext(n, nodeCtx, styleNode);
      const rule = this.stylesheet.findRule(node, mode, bounds, makeContext);
      if (rule && this.options.reportConflicts) {
        this.reportConflict(node, mode, rule, makeContext);
      }
      if (rule) {
        this.invokeTemplate(rule.template, { ...nodeCtx, rule }, params, rule);
      } else {
        this.builtInRule(node, nodeCtx, mode, params);
      }
    }
  }

  /**
   * For the reportConflicts option: warns, once per pair of templates, when
   * the rule chosen is not the one that comes first in the stylesheet among
   * those that match. Versions of XSLTjs before 1.0 chose the first; XSLT
   * chooses by import precedence and priority.
   */
  reportConflict (
    node,
    mode,
    rule,
    makeContext
  ) {
    const index = this.stylesheet.modes.get(mode);
    let first = null;
    for (const candidate of index.rules) {
      if (candidate.pattern.matchesAlternative(node, candidate.alternative, (n) => makeContext(n, candidate.template))) {
        if (!first || candidate.position < first.position) {
          first = candidate;
        }
      }
    }
    if (first && first.template !== rule.template) {
      this.conflicts = this.conflicts || new Set();
      const key = first.position + ':' + rule.position;
      if (!this.conflicts.has(key)) {
        this.conflicts.add(key);
        this.logger.warn('XSLTjs conflict: for ' + node.nodeName + ', match="' + rule.pattern.text + '" (' + XsltError.locate(rule.template) +
          ', priority ' + rule.priority + ') is chosen over the earlier match="' + first.pattern.text + '" (' + XsltError.locate(first.template) +
          ', priority ' + first.priority + ')');
      }
    }
  }

  /**
   * The XPath context used to evaluate predicates while matching a pattern.
   */
  makePatternContext (
    node,
    ctx,
    styleNode
  ) {
    return this.makeXPathContext({ ...ctx, node, position: 1, size: 1, scope: null }, styleNode || null);
  }

  /**
   * The built-in template rules of XSLT 1.0 section 5.8.
   */
  builtInRule (
    node,
    ctx,
    mode,
    params
  ) {
    switch (node.nodeType) {
      case 1:
      case 9:
      case 11: {
        const children = [];
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (child.nodeType !== 10) {
            children.push(child);
          }
        }
        this.applyTemplatesTo(children, ctx, mode, params, null);
        break;
      }
      case 2:
        this.appendText(ctx.out, node.value);
        break;
      case 3:
      case 4:
        this.appendText(ctx.out, node.data);
        break;
    }
  }

  /**
   * Runs a template body with its parameters bound.
   */
  invokeTemplate (
    template,
    ctx,
    params,
    rule
  ) {
    if (++this.depth > Processor.MAX_DEPTH) {
      this.depth = 0;
      throw new XsltError('XTDE0000', 'Too many nested template calls; is there infinite recursion?', template);
    }
    try {
      const templateCtx = { ...ctx, scope: null, rule: rule || ctx.rule, current: ctx.node };
      this.executeChildren(template, templateCtx, params);
    } finally {
      this.depth--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Sequence constructors
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Executes the children of a stylesheet element in order. Variables
   * declared among them are visible to their following siblings.
   * @param {Element} element - The parent stylesheet element.
   * @param {Object} ctx - The context.
   * @param {Map} [params] - Values for xsl:param children, if this is a template body.
   */
  executeChildren (
    element,
    ctx,
    params = null
  ) {
    let scope = ctx.scope;
    let current = ctx;
    for (let child = element.firstChild; child; child = child.nextSibling) {
      switch (child.nodeType) {
        case 3:
        case 4:
          this.appendText(current.out, child.data);
          break;
        case 1: {
          if (child.namespaceURI === Processor.XSLT_NS) {
            const name = child.localName;
            if (name === 'variable' || name === 'param') {
              const key = Names.expand(child.getAttribute('name'), child);
              let value;
              if (name === 'param' && params && params.has(key)) {
                value = params.get(key);
              } else {
                value = this.variableValue(child, current);
              }
              scope = { key, value, parent: scope };
              current = { ...current, scope };
              break;
            }
            if (name === 'sort' || name === 'fallback' || name === 'with-param') {
              break;
            }
          }
          this.executeInstruction(child, current);
          break;
        }
      }
    }
  }

  /**
   * Executes one instruction or literal result element.
   */
  executeInstruction (
    element,
    ctx
  ) {
    if (element.namespaceURI !== Processor.XSLT_NS) {
      if (this.stylesheet.isExtensionElement(element)) {
        this.fallback(element, ctx);
        return;
      }
      this.literalResultElement(element, ctx);
      return;
    }

    switch (element.localName) {
      case 'apply-templates': return this.xslApplyTemplates(element, ctx);
      case 'call-template': return this.xslCallTemplate(element, ctx);
      case 'apply-imports': return this.xslApplyImports(element, ctx);
      case 'for-each': return this.xslForEach(element, ctx);
      case 'value-of': return this.xslValueOf(element, ctx);
      case 'copy-of': return this.xslCopyOf(element, ctx);
      case 'copy': return this.xslCopy(element, ctx);
      case 'element': return this.xslElement(element, ctx);
      case 'attribute': return this.xslAttribute(element, ctx);
      case 'text': return this.xslText(element, ctx);
      case 'comment': return this.xslComment(element, ctx);
      case 'processing-instruction': return this.xslProcessingInstruction(element, ctx);
      case 'if': return this.xslIf(element, ctx);
      case 'choose': return this.xslChoose(element, ctx);
      case 'number': return this.xslNumber(element, ctx);
      case 'message': return this.xslMessage(element, ctx);
      case 'sequence': return this.xslSequence(element, ctx);
      case 'debug': return this.xslDebug(element, ctx);
      default:
        this.fallback(element, ctx);
    }
  }

  /**
   * Handles an instruction this processor does not know: runs its
   * xsl:fallback children, or reports an error if it has none.
   */
  fallback (
    element,
    ctx
  ) {
    let found = false;
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && child.namespaceURI === Processor.XSLT_NS && child.localName === 'fallback') {
        found = true;
        this.executeChildren(child, ctx);
      }
    }
    if (!found) {
      const code = (element.namespaceURI === Processor.XSLT_NS) ? 'XTSE0010' : 'XTDE1450';
      throw new XsltError(code, 'Unknown instruction ' + element.nodeName + ' with no xsl:fallback', element);
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instructions
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  xslApplyTemplates (
    element,
    ctx
  ) {
    const select = element.getAttribute('select');
    let nodes;
    if (select) {
      nodes = this.selectNodes(select, ctx, element);
    } else {
      nodes = [];
      for (let child = ctx.node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 10) {
          nodes.push(child);
        }
      }
    }
    nodes = this.sortNodes(nodes, element, ctx);
    const modeName = element.getAttribute('mode');
    const mode = modeName ? Names.expand(modeName, element) : '#default';
    const params = this.withParams(element, ctx);
    this.applyTemplatesTo(nodes, ctx, mode, params, null);
  }

  xslCallTemplate (
    element,
    ctx
  ) {
    const key = Names.expand(element.getAttribute('name'), element);
    const template = this.stylesheet.namedTemplates.get(key);
    if (!template) {
      throw new XsltError('XTSE0650', 'No template named ' + element.getAttribute('name'), element);
    }
    const params = this.withParams(element, ctx);
    this.invokeTemplate(template.node, ctx, params, ctx.rule);
  }

  xslApplyImports (
    element,
    ctx
  ) {
    const rule = ctx.rule;
    if (!rule || !rule.module) {
      throw new XsltError('XTDE0560', 'xsl:apply-imports used with no current template rule', element);
    }
    const bounds = { min: rule.module.minImportPrecedence, max: rule.module.precedence - 1 };
    const params = this.withParams(element, ctx);
    const node = ctx.node;
    const nodeCtx = { ...ctx, current: node };
    const found = this.stylesheet.findRule(node, rule.mode, bounds, (n, styleNode) => this.makePatternContext(n, nodeCtx, styleNode));
    if (found) {
      this.invokeTemplate(found.template, { ...nodeCtx, rule: found }, params, found);
    } else {
      this.builtInRule(node, nodeCtx, rule.mode, params);
    }
  }

  /**
   * Gathers xsl:with-param values.
   */
  withParams (
    element,
    ctx
  ) {
    const params = new Map();
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && child.namespaceURI === Processor.XSLT_NS && child.localName === 'with-param') {
        params.set(Names.expand(child.getAttribute('name'), child), this.variableValue(child, ctx));
      }
    }
    return params;
  }

  xslForEach (
    element,
    ctx
  ) {
    const nodes = this.sortNodes(this.selectNodes(element.getAttribute('select'), ctx, element), element, ctx);
    const size = nodes.length;
    for (let i = 0; i < size; i++) {
      this.executeChildren(element, { ...ctx, node: nodes[i], current: nodes[i], position: i + 1, size, rule: null });
    }
  }

  xslValueOf (
    element,
    ctx
  ) {
    const text = this.evaluateString(element.getAttribute('select'), ctx, element);
    this.appendText(ctx.out, text, element.getAttribute('disable-output-escaping') === 'yes');
  }

  xslText (
    element,
    ctx
  ) {
    this.appendText(ctx.out, element.textContent, element.getAttribute('disable-output-escaping') === 'yes');
  }

  xslCopyOf (
    element,
    ctx
  ) {
    const value = this.evaluate(element.getAttribute('select'), ctx, element);
    if (value instanceof XPath.XNodeSet) {
      for (const node of value.toArray()) {
        this.copyNode(node, ctx.out, true);
      }
    } else {
      this.appendText(ctx.out, value.stringValue());
    }
  }

  xslCopy (
    element,
    ctx
  ) {
    const node = ctx.node;
    switch (node.nodeType) {
      case 1: {
        const copy = this.resultDoc.createElementNS(node.namespaceURI || null, node.nodeName);
        copy.xsltNamespaces = this.inScopeNamespaces(node);
        this.appendNode(ctx.out, copy);
        const inner = { ...ctx, out: copy };
        this.useAttributeSets(element.getAttribute('use-attribute-sets'), element, inner);
        this.executeChildren(element, inner);
        break;
      }
      case 9:
      case 11:
        this.executeChildren(element, ctx);
        break;
      default:
        this.copyNode(node, ctx.out, false);
    }
  }

  xslElement (
    element,
    ctx
  ) {
    const name = (this.attributeValue(element, 'name', ctx) || '').trim();
    const namespaceAttr = element.getAttributeNode('namespace');
    if (!Names.isQName(name)) {
      // XSLT 1.0 allows recovery: the content is instantiated without the element.
      this.warn('XTDE0820', 'Invalid element name "' + name + '"; its content was output without it', element);
      this.executeChildren(element, ctx);
      return;
    }
    const prefix = name.includes(':') ? name.split(':')[0] : '';
    let namespaceURI;
    if (namespaceAttr) {
      namespaceURI = this.evaluateAVT(namespaceAttr, ctx);
    } else {
      namespaceURI = Names.lookup(element, prefix || null);
      if (prefix && namespaceURI === null) {
        throw new XsltError('XTDE0830', 'Undeclared prefix in element name "' + name + '"', element);
      }
    }
    const qname = (namespaceAttr && !namespaceURI) ? name.replace(/^[^:]*:/, '') : name;
    const created = this.resultDoc.createElementNS(namespaceURI || null, qname);
    this.appendNode(ctx.out, created);
    const inner = { ...ctx, out: created };
    this.useAttributeSets(element.getAttribute('use-attribute-sets'), element, inner);
    this.executeChildren(element, inner);
  }

  xslAttribute (
    element,
    ctx
  ) {
    const name = (this.attributeValue(element, 'name', ctx) || '').trim();
    if (!Names.isQName(name) || name === 'xmlns') {
      // XSLT 1.0 allows recovery: the attribute is not added.
      this.warn('XTDE0850', 'Invalid attribute name "' + name + '"; the attribute was not added', element);
      return;
    }
    const namespaceAttr = element.getAttributeNode('namespace');
    let prefix = name.includes(':') ? name.split(':')[0] : '';
    let localName = name.replace(/^[^:]*:/, '');
    let namespaceURI = '';
    if (namespaceAttr) {
      namespaceURI = this.evaluateAVT(namespaceAttr, ctx);
      if (!namespaceURI) {
        prefix = '';
      }
    } else if (prefix) {
      namespaceURI = Names.lookup(element, prefix);
      if (namespaceURI === null) {
        throw new XsltError('XTDE0860', 'Undeclared prefix in attribute name "' + name + '"', element);
      }
    }
    if (prefix === 'xmlns') {
      prefix = 'ns';
    }
    if (namespaceURI && !prefix) {
      prefix = 'ns';
    }
    if (namespaceURI === Names.XML_NS) {
      prefix = 'xml';
    }
    if (!namespaceURI) {
      localName = name.replace(/^[^:]*:/, '');
    }
    const value = this.contentText(element, ctx);
    this.setAttribute(ctx.out, namespaceURI || null, prefix ? prefix + ':' + localName : localName, value, element);
  }

  xslComment (
    element,
    ctx
  ) {
    let text = this.contentText(element, ctx);
    text = text.replace(/--/g, '- -').replace(/-$/, '- ');
    this.appendNode(ctx.out, this.resultDoc.createComment(text));
  }

  xslProcessingInstruction (
    element,
    ctx
  ) {
    const name = this.attributeValue(element, 'name', ctx);
    if (!Names.isNCName(name) || name.toLowerCase() === 'xml') {
      throw new XsltError('XTDE0890', 'Invalid processing instruction name "' + name + '"', element);
    }
    let text = this.contentText(element, ctx);
    text = text.replace(/\?>/g, '? >').replace(/^\s+/, '');
    this.appendNode(ctx.out, this.resultDoc.createProcessingInstruction(name, text));
  }

  xslIf (
    element,
    ctx
  ) {
    if (this.evaluateBoolean(element.getAttribute('test'), ctx, element)) {
      this.executeChildren(element, ctx);
    }
  }

  xslChoose (
    element,
    ctx
  ) {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1 || child.namespaceURI !== Processor.XSLT_NS) {
        continue;
      }
      if (child.localName === 'when') {
        if (this.evaluateBoolean(child.getAttribute('test'), ctx, child)) {
          this.executeChildren(child, ctx);
          return;
        }
      } else if (child.localName === 'otherwise') {
        this.executeChildren(child, ctx);
        return;
      }
    }
  }

  xslMessage (
    element,
    ctx
  ) {
    const fragment = this.resultDoc.createDocumentFragment();
    this.executeChildren(element, { ...ctx, out: fragment });
    const { Serializer } = require('./Serializer');
    const text = new Serializer({ method: 'xml', omitXmlDeclaration: 'yes' }).serialize(fragment);
    const terminate = (this.attributeValue(element, 'terminate', ctx, 'no') || 'no').trim() === 'yes';
    if (this.options.onMessage) {
      this.options.onMessage(text, terminate);
    } else {
      this.logger.info(text);
    }
    if (terminate) {
      const error = new XsltError('XTMM9000', 'Processing terminated by xsl:message: ' + text, element);
      error.terminate = true;
      throw error;
    }
  }

  /**
   * xsl:sequence, supported only as the result of an xsl:function.
   */
  xslSequence (
    element,
    ctx
  ) {
    const value = this.evaluate(element.getAttribute('select'), ctx, element);
    if (ctx.sequence) {
      ctx.sequence.push(value);
    } else if (value instanceof XPath.XNodeSet) {
      for (const node of value.toArray()) {
        this.copyNode(node, ctx.out, true);
      }
    } else {
      this.appendText(ctx.out, value.stringValue());
    }
  }

  /**
   * xsl:debug: an extension that logs the context and any select value.
   */
  xslDebug (
    element,
    ctx
  ) {
    const select = element.getAttribute('select');
    const value = select ? this.evaluateString(select, ctx, element) : '';
    this.logger.debug('# XSLT debug: ' + (ctx.node && ctx.node.nodeName) + (select ? ' ' + select + ' = ' + value : ''));
  }

  xslNumber (
    element,
    ctx
  ) {
    let numbers;
    const value = element.getAttribute('value');
    if (value) {
      const n = this.evaluate(value, ctx, element).numberValue();
      if (!Number.isFinite(n) || n < 0.5) {
        this.appendText(ctx.out, Number.isNaN(n) ? 'NaN' : String(Math.round(n)));
        return;
      }
      numbers = [Math.round(n)];
    } else {
      numbers = this.countNodes(element, ctx);
    }
    const format = this.attributeValue(element, 'format', ctx, '1');
    const groupingSeparator = this.attributeValue(element, 'grouping-separator', ctx);
    const groupingSize = Number(this.attributeValue(element, 'grouping-size', ctx, '0'));
    const text = NumberFormat.formatList(numbers, format, {
      groupingSeparator: (groupingSeparator && groupingSize) ? groupingSeparator : null,
      groupingSize
    });
    this.appendText(ctx.out, text);
  }

  /**
   * Works out the numbers for xsl:number from the source tree.
   */
  countNodes (
    element,
    ctx
  ) {
    const level = element.getAttribute('level') || 'single';
    const node = ctx.node;
    const makeContext = (n) => this.makePatternContext(n, ctx, element);
    const countAttr = element.getAttribute('count');
    const fromAttr = element.getAttribute('from');
    const count = countAttr ? this.stylesheet.pattern(countAttr, element) : null;
    const from = fromAttr ? this.stylesheet.pattern(fromAttr, element) : null;
    const isCounted = count
      ? (n) => count.matches(n, makeContext)
      : (n) => Processor.sameKind(n, node);
    const isFrom = (n) => !!from && from.matches(n, makeContext);
    const preceding = (n) => (n.nodeType === 2) ? null : n.previousSibling;

    if (level === 'any') {
      let total = 0;
      for (let n = node; n; n = Processor.previousInDocument(n)) {
        if (n !== node && isFrom(n)) {
          break;
        }
        if (isCounted(n)) {
          total++;
        }
        if (n === node && isFrom(n)) {
          break;
        }
      }
      return total ? [total] : [];
    }

    const ancestors = [];
    for (let n = node; n; n = Pattern.parentOf(n)) {
      if (isCounted(n)) {
        ancestors.push(n);
        if (level === 'single') {
          break;
        }
      }
      if (isFrom(n)) {
        break;
      }
    }
    if (level === 'single' && from && ancestors.length) {
      let inside = false;
      for (let n = ancestors[0]; n; n = Pattern.parentOf(n)) {
        if (isFrom(n)) {
          inside = true;
          break;
        }
      }
      if (!inside) {
        return [];
      }
    }
    return ancestors.reverse().map((n) => {
      let index = 1;
      for (let s = preceding(n); s; s = s.previousSibling) {
        if (isCounted(s)) {
          index++;
        }
      }
      return index;
    });
  }

  /**
   * Are two nodes of the same kind and name, for xsl:number's default count?
   */
  static sameKind (
    a,
    b
  ) {
    if (a.nodeType !== b.nodeType) {
      return (a.nodeType === 3 || a.nodeType === 4) && (b.nodeType === 3 || b.nodeType === 4);
    }
    if (a.nodeType === 1 || a.nodeType === 2) {
      return a.localName === b.localName && (a.namespaceURI || '') === (b.namespaceURI || '');
    }
    if (a.nodeType === 7) {
      return a.target === b.target;
    }
    return true;
  }

  /**
   * The node before this one in document order (ancestors included).
   */
  static previousInDocument (
    node
  ) {
    if (node.nodeType === 2) {
      return node.ownerElement;
    }
    let previous = node.previousSibling;
    if (!previous) {
      return node.parentNode;
    }
    while (previous.lastChild) {
      previous = previous.lastChild;
    }
    return previous;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Literal result elements and attribute sets
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  literalResultElement (
    element,
    ctx
  ) {
    const info = this.stylesheet.literalInfo(element);
    const created = this.resultDoc.createElementNS(info.namespaceURI || null, info.qname);
    created.xsltNamespaces = info.namespaces;
    this.appendNode(ctx.out, created);
    const inner = { ...ctx, out: created };
    const useSets = element.getAttributeNS(Processor.XSLT_NS, 'use-attribute-sets');
    if (useSets) {
      this.useAttributeSets(useSets, element, inner);
    }
    for (const attr of info.attributes) {
      this.setAttribute(created, attr.namespaceURI, attr.qname, this.evaluateAVT(attr.node, inner), element);
    }
    this.executeChildren(element, inner);
  }

  /**
   * Adds the attributes of named attribute sets to the current element.
   */
  useAttributeSets (
    names,
    element,
    ctx,
    seen = new Set()
  ) {
    if (!names) {
      return;
    }
    for (const name of names.trim().split(/\s+/)) {
      const key = Names.expand(name, element);
      if (seen.has(key)) {
        throw new XsltError('XTSE0720', 'Attribute set ' + name + ' uses itself', element);
      }
      const sets = this.stylesheet.attributeSets.get(key);
      if (!sets) {
        throw new XsltError('XTSE0710', 'No attribute set named ' + name, element);
      }
      const inner = new Set(seen).add(key);
      for (const set of sets) {
        this.useAttributeSets(set.getAttribute('use-attribute-sets'), set, ctx, inner);
        const setCtx = { ...ctx, scope: null };
        for (let child = set.firstChild; child; child = child.nextSibling) {
          if (child.nodeType === 1 && child.namespaceURI === Processor.XSLT_NS && child.localName === 'attribute') {
            this.xslAttribute(child, setCtx);
          }
        }
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Sorting
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Sorts nodes by the xsl:sort children of an instruction.
   */
  sortNodes (
    nodes,
    element,
    ctx
  ) {
    const sorts = [];
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && child.namespaceURI === Processor.XSLT_NS && child.localName === 'sort') {
        sorts.push(child);
      }
    }
    if (sorts.length === 0 || nodes.length < 2) {
      return nodes;
    }

    const size = nodes.length;
    const keys = sorts.map((sort) => {
      const sortCtx = { ...ctx, size, rule: null };
      const dataType = this.attributeValue(sort, 'data-type', sortCtx, 'text');
      const order = this.attributeValue(sort, 'order', sortCtx, 'ascending');
      const caseOrder = this.attributeValue(sort, 'case-order', sortCtx, 'upper-first');
      const lang = this.attributeValue(sort, 'lang', sortCtx, undefined);
      const select = sort.getAttribute('select') || '.';
      const values = nodes.map((node, i) => {
        const value = this.evaluate(select, { ...sortCtx, node, current: node, position: i + 1 }, sort);
        return (dataType === 'number') ? value.numberValue() : value.stringValue();
      });
      return { values, dataType, descending: order === 'descending', caseOrder, lang };
    });

    const indexes = nodes.map((node, i) => i);
    indexes.sort((a, b) => {
      for (const key of keys) {
        const c = Processor.compareKeys(key.values[a], key.values[b], key);
        if (c !== 0) {
          return key.descending ? -c : c;
        }
      }
      return a - b;
    });
    return indexes.map((i) => nodes[i]);
  }

  /**
   * Compares two sort key values.
   */
  static compareKeys (
    a,
    b,
    key
  ) {
    if (key.dataType === 'number') {
      const an = Number.isNaN(a);
      const bn = Number.isNaN(b);
      if (an || bn) {
        return (an && bn) ? 0 : (an ? -1 : 1);
      }
      return (a < b) ? -1 : ((a > b) ? 1 : 0);
    }
    const primary = a.localeCompare(b, key.lang || 'en', { sensitivity: 'base' });
    if (primary !== 0) {
      return primary;
    }
    if (a === b) {
      return 0;
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        const aUpper = a[i] !== a[i].toLowerCase();
        const bUpper = b[i] !== b[i].toLowerCase();
        if (aUpper !== bUpper) {
          const upperFirst = key.caseOrder !== 'lower-first';
          return (aUpper === upperFirst) ? -1 : 1;
        }
        return (a[i] < b[i]) ? -1 : 1;
      }
    }
    return a.length - b.length;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Building the result tree
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Instantiates content and returns its text, for attribute values,
   * comments and processing instructions.
   */
  contentText (
    element,
    ctx
  ) {
    const select = element.getAttribute('select');
    if (select && element.localName !== 'message') {
      return this.evaluateString(select, ctx, element);
    }
    const fragment = this.resultDoc.createDocumentFragment();
    this.executeChildren(element, { ...ctx, out: fragment });
    let text = '';
    for (let child = fragment.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        text += child.data;
      }
    }
    return text;
  }

  /**
   * Reports a recoverable error.
   */
  warn (
    code,
    message,
    node
  ) {
    if (this.logger.warn) {
      const location = XsltError.locate(node);
      this.logger.warn(code + ': ' + message + (location ? ' (' + location + ')' : ''));
    }
  }

  /**
   * Appends text, merging it with a preceding text node.
   */
  appendText (
    out,
    text,
    disableEscaping = false
  ) {
    if (!out || text === '' || text === null || text === undefined) {
      return;
    }
    const last = out.lastChild;
    if (last && last.nodeType === 3 && !!last.xsltRaw === disableEscaping) {
      last.appendData(text);
      return;
    }
    const node = this.resultDoc.createTextNode(text);
    if (disableEscaping) {
      node.xsltRaw = true;
    }
    out.appendChild(node);
  }

  /**
   * Appends a node to the result.
   */
  appendNode (
    out,
    node
  ) {
    if (out) {
      out.appendChild(node);
    }
  }

  /**
   * Adds an attribute to the element being built. Attributes added after
   * children, or with no element to add them to, are ignored, which is the
   * recovery XSLT 1.0 allows.
   */
  setAttribute (
    out,
    namespaceURI,
    qname,
    value,
    styleNode
  ) {
    if (!out || out.nodeType !== 1) {
      return;
    }
    for (let child = out.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 2) {
        this.warn('XTDE0410', 'Attribute ' + qname + ' added after children was ignored', styleNode);
        return;
      }
    }
    const localName = qname.replace(/^[^:]*:/, '');
    const existing = namespaceURI ? out.getAttributeNodeNS(namespaceURI, localName) : out.getAttributeNode(localName);
    if (existing) {
      out.removeAttributeNode(existing);
    }
    if (namespaceURI) {
      out.setAttributeNS(namespaceURI, qname, value);
    } else {
      out.setAttribute(localName, value);
    }
  }

  /**
   * The namespaces in scope on a source element, as prefix → URI.
   */
  inScopeNamespaces (
    element
  ) {
    const namespaces = new Map();
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      const attributes = e.attributes;
      for (let i = 0; i < attributes.length; i++) {
        const a = attributes[i];
        if (a.name === 'xmlns' || a.prefix === 'xmlns') {
          const prefix = (a.name === 'xmlns') ? '' : a.localName;
          if (!namespaces.has(prefix)) {
            namespaces.set(prefix, a.value);
          }
        }
      }
    }
    if (namespaces.get('') === '') {
      namespaces.delete('');
    }
    return namespaces;
  }

  /**
   * Copies a source node to the result, deeply or shallowly.
   */
  copyNode (
    node,
    out,
    deep
  ) {
    const doc = this.resultDoc;
    switch (node.nodeType) {
      case 1: {
        const copy = doc.createElementNS(node.namespaceURI || null, node.nodeName);
        copy.xsltNamespaces = (node.ownerDocument === doc && node.xsltNamespaces) ? new Map(node.xsltNamespaces) : this.inScopeNamespaces(node);
        if (node.ownerDocument === doc && node.parentNode && node.parentNode.nodeType === 1) {
          for (const [prefix, uri] of this.inScopeOfResult(node.parentNode)) {
            if (!copy.xsltNamespaces.has(prefix)) {
              copy.xsltNamespaces.set(prefix, uri);
            }
          }
        }
        this.appendNode(out, copy);
        if (deep) {
          const attributes = node.attributes;
          for (let i = 0; i < attributes.length; i++) {
            const a = attributes[i];
            if (a.name === 'xmlns' || a.prefix === 'xmlns') {
              continue;
            }
            if (a.namespaceURI) {
              copy.setAttributeNS(a.namespaceURI, a.name, a.value);
            } else {
              copy.setAttribute(a.name, a.value);
            }
          }
          for (let child = node.firstChild; child; child = child.nextSibling) {
            this.copyNode(child, copy, true);
          }
        }
        break;
      }
      case 2:
        if (!Pattern.isNamespaceDeclaration(node)) {
          this.setAttribute(out, node.namespaceURI || null, node.name, node.value, null);
        }
        break;
      case 3:
      case 4:
        this.appendText(out, node.data, !!node.xsltRaw);
        break;
      case 7:
        this.appendNode(out, doc.createProcessingInstruction(node.target, node.data));
        break;
      case 8:
        this.appendNode(out, doc.createComment(node.data));
        break;
      case 9:
      case 11:
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (child.nodeType !== 10) {
            this.copyNode(child, out, true);
          }
        }
        break;
      default:
        if (node.isNamespaceNode && out && out.nodeType === 1) {
          out.xsltNamespaces = out.xsltNamespaces || new Map();
          out.xsltNamespaces.set(node.localName || node.prefix || '', node.namespaceURI || node.nodeValue);
        }
    }
  }

  /**
   * Namespaces declared on result elements in an RTF, for copying.
   */
  inScopeOfResult (
    element
  ) {
    const namespaces = new Map();
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      if (e.xsltNamespaces) {
        for (const [prefix, uri] of e.xsltNamespaces) {
          if (!namespaces.has(prefix)) {
            namespaces.set(prefix, uri);
          }
        }
      }
    }
    return namespaces;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Keys, documents and ids
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * The nodes with a key value, using an index built once per document.
   */
  keyLookup (
    keyName,
    value,
    contextNode,
    styleNode
  ) {
    const key = Names.expand(keyName, styleNode);
    const definitions = this.stylesheet.keys.get(key);
    if (!definitions) {
      throw new XsltError('XTDE1260', 'No key named ' + keyName, styleNode);
    }
    const root = this.rootOf(contextNode);
    let byRoot = this.keyIndexes.get(key);
    if (!byRoot) {
      byRoot = new Map();
      this.keyIndexes.set(key, byRoot);
    }
    let index = byRoot.get(root);
    if (!index) {
      index = this.buildKeyIndex(definitions, root);
      byRoot.set(root, index);
    }
    return index.get(value) || [];
  }

  buildKeyIndex (
    definitions,
    root
  ) {
    const index = new Map();
    const add = (value, node) => {
      let list = index.get(value);
      if (!list) {
        list = [];
        index.set(value, list);
      }
      if (list[list.length - 1] !== node) {
        list.push(node);
      }
    };
    const visit = (node) => {
      for (const definition of definitions) {
        const ctx = { ...this.rootContext, node, current: node, position: 1, size: 1, scope: null };
        if (definition.pattern.matches(node, (n) => this.makePatternContext(n, ctx, definition.node))) {
          const value = this.evaluate(definition.use, ctx, definition.node);
          if (value instanceof XPath.XNodeSet) {
            for (const n of value.toArray()) {
              add(XPath.XNodeSet.prototype.stringForNode(n), node);
            }
          } else {
            add(value.stringValue(), node);
          }
        }
      }
      if (node.nodeType === 1) {
        const attributes = node.attributes;
        for (let i = 0; i < attributes.length; i++) {
          if (!Pattern.isNamespaceDeclaration(attributes[i])) {
            visit(attributes[i]);
          }
        }
      }
      for (let child = node.firstChild; child; child = child.nextSibling) {
        visit(child);
      }
    };
    visit(root);
    return index;
  }

  /**
   * Loads a document for document(), once per URI.
   */
  loadDocument (
    uri,
    styleNode
  ) {
    if (this.documents.has(uri)) {
      return this.documents.get(uri);
    }
    let doc = null;
    try {
      doc = this.stylesheet.loadDocumentSync(uri, this.options.documentLoader);
      if (doc) {
        doc = this.stylesheet.stripSource(doc);
      }
    } catch (error) {
      this.warn('XTDE1160', 'Could not load document ' + uri + ': ' + error.message, styleNode);
      doc = null;
    }
    this.documents.set(uri, doc);
    return doc;
  }

  /**
   * A stable identifier for a node, for generate-id().
   */
  generateId (
    node
  ) {
    let id = this.ids.get(node);
    if (!id) {
      id = 'd' + (this.nextId++).toString(36) + 'n';
      this.ids.set(node, id);
    }
    return id;
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.Processor = Processor;

// ----------------------------------------------------------------------------
