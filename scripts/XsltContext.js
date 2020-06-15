/*
 * @file XsltContext.js - An XSLT engine written in JavaScript.
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @author {@link mailto:mesch@google.com Steffen Meschkat} (Original)
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 * @copyright &copy; 2005 Google Inc.
 *
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports
// ----------------------------------------------------------------------------

const XmlDOM = require('xmldom');
const XPath = require('xpath');
const { $$ } = require('./XDomHelper');
const { Node } = require('./Node');
const { XPathNamespaceResolver } = require('./XPathNamespaceResolver');
const { XPathVariableResolver } = require('./XPathVariableResolver');
const { XPathFunctionResolver } = require('./XPathFunctionResolver');
const { Utils } = require('./Utils');
const { XsltLog } = require('./XsltLog');

// ----------------------------------------------------------------------------
/* @class XsltContext
 * @classdesc Context object for evaluating XSLT elements.
 */
var XsltContext = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @constructor
   * @param {Node} contextNode - The node in the source document to use as the context.
   * @param {Object} [options={}] - Other settings to be used in the context
   */
  constructor (
    contextNode,
    options = {}
  ) {
    this.contextNode = contextNode;
    this.contextPosition = options.contextPosition || 1;
    this.nodeList = options.nodeList || [contextNode];
    this.variables = options.variables || {};
    this.inputURL = options.inputURL || null;
    this.transformURL = options.transformURL || null;
    this.customFunctions = options.customFunctions || {};
    this.mode = options.mode || null;
    this.parent = options.parent || null;
    this.cfg = options.cfg || {};

    this.logger = options.logger || XsltLog.logger;
    this.debug = (msg) => this.logger.debug('# XSLT: ' + (' ').repeat(XsltContext.indent * 2) + msg);
    this.logTransform = (node) => this.debug(Utils.identify(node));
    this.getContext = () => 'context node ' + (this.nodeList.length > 1 ? '#' + this.contextPosition + ' ' : '') + '-- ' + Utils.identify(this.contextNode);

    if (this.contextNode.nodeType === Node.DOCUMENT_NODE) {
      // NOTE(meschkat): DOM Spec stipulates that the ownerDocument of a
      // document is null. Our root, however is the document that we are
      // processing, so the initial context is created from its document
      // node, which case we must handle here explcitly.
      this.root = contextNode;
    } else {
      this.root = contextNode.ownerDocument;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // Instance methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Makes a copy of the current context, replace items that are specified.
   * @method clone
   * @instance
   * @param {Object} [options={}] - Optional parameters to use instead.
   */
  clone (
    options = {}
  ) {
    const clone = (variables) => {
      const clonedVariables = {};
      for (const key in variables) {
        clonedVariables[key] = variables[key];
      }
      return clonedVariables;
    };

    const context = new XsltContext(options.contextNode || this.contextNode, {
      contextPosition: options.contextPosition || this.contextPosition,
      nodeList: options.nodeList || this.nodeList,
      variables: (options.variables) ? clone(options.variables) : {},
      inputURL: options.inputURL || this.inputURL,
      transformURL: options.transformURL || this.transformURL,
      customFunctions: options.customFunctions || this.customFunctions,
      mode: options.mode || null, // This should not be inherited
      cfg: options.cfg || this.cfg,
      logger: options.logger || this.logger,
      parent: this
    });

    if (options.transformNode) {
      context.transformNode = options.transformNode;
      context.namespaceResolver = new XPathNamespaceResolver(context.transformNode);
      context.variableResolver = new XPathVariableResolver(context.transformNode, context);
      context.functionResolver = new XPathFunctionResolver(context.transformNode, context);
    }

    return context;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Determines if a text node in the XSLT template document is to be
   * stripped according to XSLT whitespace stipping rules.
   * @method passText
   * @instance
   * @param {Node} transformNode - the XSLT node to use.
   * @returns {Boolean}
   * @see [XSLT], section 3.4.
   * @todo (meschkat) Whitespace stripping on the input document is
   *   currently not implemented.
   */
  passText (
    transformNode
  ) {
    if (!transformNode.nodeValue.match(/^\s*$/)) {
      return true;
    }

    let parentElement = transformNode.parentNode;
    if ($$(parentElement).isA('xsl:text')) {
      return true;
    }

    while (parentElement && parentElement.nodeType === Node.ELEMENT_NODE) {
      const xmlSpace = $$(parentElement).getAttribute('xml:space');
      if (xmlSpace) {
        if (xmlSpace === 'default') {
          return false;
        } else if (xmlSpace === 'preserve') {
          return true;
        }
      }

      parentElement = parentElement.parentNode;
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Passes template text to the output. The current template node does
   * not specify an XSLT operation and therefore is appended to the
   * output with all its attributes. Then continues traversing the
   * template node tree.
   * @method passThrough
   * @instance
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async passThrough (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;

    switch (transformNode.nodeType) {
      case Node.DOCUMENT_NODE: {
        // This applies to the DOCUMENT_NODE of the XSL transform,
        // so we don't have to treat it specially.
        await this.processChildNodes(transformNode, outputNode);
        break;
      }
      case Node.ELEMENT_NODE: {
        const qName = transformNode.nodeName;
        const namespaceURI = transformNode.namespaceURI;
        const newElement = $$(outputDocument).createElementNS(namespaceURI, qName);
        $$(transformNode.attributes).forEach((attribute) => {
          const name = attribute.nodeName;
          const valueExpr = attribute.nodeValue;
          const value = this.resolveExpression(transformNode, valueExpr);
          newElement.setAttribute(name, value);
        });
        outputNode.appendChild(newElement);
        await this.processChildNodes(transformNode, newElement);
        break;
      }
      case Node.TEXT_NODE: {
        if (this.passText(transformNode)) {
          const text = $$(transformNode).textContent;
          const newTextNode = $$(outputDocument).createTextNode(text);
          outputNode.appendChild(newTextNode);
        }
        break;
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  getTemplateNode (
    document,
    name
  ) {
    const transformRoot = document.documentElement;
    if (!this.cfg._cache.templatesByName) {
      this.cfg._cache.templatesByName = {};
      $$(transformRoot.childNodes).forEach((childTransformNode) => {
        if ($$(childTransformNode).isA('xsl:template') &&
        childTransformNode.hasAttribute('name')) {
          this.cfg._cache.templatesByName[childTransformNode.getAttribute('name')] = childTransformNode;
        }
      });
    }

    return this.cfg._cache.templatesByName[name];
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  getTemplateNodes (
    document,
    mode = '_default'
  ) {
    const transformRoot = document.documentElement;
    if (!this.cfg._cache.templatesByMode) {
      this.cfg._cache.templatesByMode = {};
    }
    if (!this.cfg._cache.templatesByMode[mode]) {
      this.cfg._cache.templatesByMode[mode] = [];
      $$(transformRoot.childNodes).forEach((childTransformNode) => {
        if ($$(childTransformNode).isA('xsl:template') &&
            childTransformNode.hasAttribute('match') &&
            ((mode === '_default' && !childTransformNode.hasAttribute('mode')) || $$(childTransformNode).getAttribute('mode') === mode)) {
          this.cfg._cache.templatesByMode[mode].push(childTransformNode);
        }
      });
    }

    return this.cfg._cache.templatesByMode[mode];
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Evaluates an XSLT attribute value template. Attribute value
   * templates are attributes on XSLT elements that contain XPath
   * expressions in braces {}. The XSLT expressions are evaluated in
   * the current input context.
   * @method resolveExpression
   * @instance
   * @param {Node} transformNode - The node being evaluated.
   * @param {string} value - The text containing items to resolve.
   * @returns {string}
   */
  resolveExpression (
    transformNode,
    value
  ) {
    while ((/\{[^}]+\}/).test(value)) {
      const match = value.match(/^(.*?)\{([^{}]+)\}(.*)$/);
      const leftSide = match[1];
      const xPath = match[2];
      const rightSide = match[3];

      if ((/^[.$]/).test(xPath) || (/:\/\(/).testXPath) {
        try {
          const context = this.clone({ transformNode: transformNode });
          value = leftSide + this.processWhitespace($$(this.contextNode).select(xPath, context, { type: XPath.XPathResult.STRING_TYPE })) + rightSide;
        } catch (exception) {
          value = leftSide + '[[[' + xPath + ']]]' + rightSide;
        }
      } else {
        value = leftSide + '[[[' + xPath + ']]]' + rightSide;
      }
    }

    return value.replace(/\[\[\[/g, '{').replace(/]]]/g, '}');
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Finds a node with the specified name. Further filtering to an element tag
   * can be done via the options. Also, by default, the root node will be
   * searched, but an alternate transform context node can be specified.
   * @method findNamedNode
   * @instance
   * @param {string} name - The value of the name attribute to search for.
   * @param {Object} [options={}] - Specify a 'filter' as either an
   *   array or string value of qNames to filter against. Use a '^' at
   *   the start of a qName to invert the sense. Specify a 'context' as
   *   a node in the transform document. Otherwise, the documentElement
   *   will be used
   * @returns {Node|Null}
   */
  findNamedNode (
    transformNode,
    findName,
    options = {}
  ) {
    const filter = options.filter || null;
    const contextNode = options.root || transformNode.ownerDocument.documentElement;

    for (const childcontextNode of contextNode.childNodes) {
      if (childcontextNode.nodeType === Node.ELEMENT_NODE) {
        if (filter && !$$(childcontextNode).isA(filter)) {
          continue;
        }
        const name = $$(childcontextNode).getAttribute('name');
        if (name === findName) {
          return childcontextNode;
        } else if (name && options.namespaceURI) {
          const prefix = ((/:/).test(name)) ? name.replace(/:.*$/, '') : null;
          const namespaceURI = transformNode.lookupNamespaceURI(prefix);
          const localName = name.replace(/^.*:/, '');
          if (namespaceURI === options.namespaceURI && localName === findName) {
            return childcontextNode;
          }
        }
      }
    }

    return null;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Process whitespace according to current rules.
   * @method processWhitespace
   * @instance
   * @param {string} value - The text value to process.
   * @param {Element} [contextElement=null] - the parent element to consider for
   *   whitespace rules. If not set, the value is treated as an attribute value
   *   and whitespace is stripped
   * @return {string}.
   */
  processWhitespace (
    value,
    contextElement = null
  ) {
    let process = 'strip'; // Default for attribute values
    if (contextElement) {
      const namespaceURI = contextElement.namespaceURI;
      const localName = contextElement.localName;
      const fullName = ((namespaceURI) ? '{' + namespaceURI + '}' : '') + localName;
      const allNamespace = (namespaceURI) ? '{' + namespaceURI + '}*' : null;

      if (this.cfg.stripSpaceList[fullName] || (allNamespace && this.cfg.stripSpaceList[allNamespace])) {
        process = 'strip';
      } else if (this.cfg.preserveSpaceList[fullName] || (allNamespace && this.cfg.preserveSpaceList[allNamespace])) {
        process = 'preserve';
      } else if (this.cfg.stripSpaceList['*']) {
        process = 'strip';
      } else if (this.cfg.preserveSpaceList['*']) {
        process = 'preserve';
      } else {
        process = 'normalize';
      }
    }

    if (typeof value === 'string') {
      switch (process) {
        case 'strip':
          value = value.replace(/(^[ \r\n\t\f]+|[ \r\n\t](?=[\s\r\n\t\f]+)|[ \r\n\t\f]+$)/g, '');
          break;
        case 'preserve':
          // Do nothing
          break;
        case 'normalize':
          value = value.replace(/[ \r\n\t\f]+/g, ' ');
          break;
      }
    }

    return value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Orders the current node list in the input context according to the
   * sort order specified by xsl:sort child nodes of the current
   * template node. This happens before the operation specified by the
   * current template node is executed.
   * @method sortNodes
   * @instance
   * @param {Node} transformNode - The node being evaluated.
   * @todo (meschkat) Case-order is not implemented.
   */
  sortNodes (
    transformNode
  ) {
    const sort = [];

    $$(transformNode.childNodes).forEach((childTransformNode) => {
      if ($$(childTransformNode).isA('xsl:sort')) {
        const select = $$(childTransformNode).getAttribute('select');
        const type = $$(childTransformNode).getAttribute('data-type') || 'text';
        const order = $$(childTransformNode).getAttribute('order') || 'ascending';
        sort.push({ select, type, order });
      }
    });

    if (sort.length === 0) {
      return;
    }

    const sortList = [];
    this.nodeList.forEach((contextNode, i) => {
      /* const context = */ this.clone({ contextNode: contextNode, contextPosition: 1, nodeList: [contextNode] });
      const sortItem = {
        contextNode,
        key: []
      };

      sort.forEach((sortItem) => {
        const context = this.clone({ transformNode: transformNode });
        const contextNodes = $$(context.contextNode).select(sortItem.select, context);

        let eValue;
        if (sortItem.type === 'text') {
          let value = '';
          contextNodes.forEach((contextNode) => {
            value += contextNode.textContent;
          });
          eValue = String(value);
        } else if (sortItem.type === 'number') {
          let value = '';
          contextNodes.forEach((contextNode) => {
            value += contextNode.textContent;
          });
          eValue = Number(value);
        }

        sortItem.key.push({
          value: eValue,
          order: sortItem.order
        });
      });

      // Make the sort stable by adding a lowest priority sort by
      // id. This is very convenient and furthermore required by the
      // spec ([XSLT] - Section 10 Sorting).
      sortItem.key.push({
        value: i,
        order: 'ascending'
      });

      sortList.push(sortItem);
    });

    // Sorts by all order criteria defined. According to the JavaScript
    // spec ([ECMA] Section 11.8.5), the compare operators compare strings
    // as strings and numbers as numbers.
    //
    // NOTE: In browsers which do not follow the spec, this breaks only in
    // the case that numbers should be sorted as strings, which is very
    // uncommon.

    sortList.sort((v1, v2) => {
      // NOTE: Sort key vectors of different length never occur in XSLT.sort().
      for (let i = 0; i < v1.key.length; ++i) {
        const o = v1.key[i].order === 'descending' ? -1 : 1;
        if (v1.key[i].value > v2.key[i].value) {
          return +1 * o;
        } else if (v1.key[i].value < v2.key[i].value) {
          return -1 * o;
        }
      }
      return 0;
    });

    const contextNodes = [];
    sortList.forEach((sortItem) => {
      contextNodes.push(sortItem.node);
    });

    this.nodeList = contextNodes;
    this.setNode(0);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Stores a variable name/value part in this context.
   * @method setVariable
   * @instance
   * @param {string} name - The name of the variable to set.
   * @param {string|number|boolean|Array|Object} value - The value of the variable.
   */
  setVariable (
    name,
    value
  ) {
    if (typeof value === 'string') {
      if (value === 'true') {
        value = Boolean(true);
      } else if (value === 'false') {
        value = Boolean(false);
      } else if (new RegExp('^\\d+(\\.\\d*)?$').test(value)) {
        value = Number(value);
      } else {
        value = String(value);
      }
    }
    this.variables[name] = value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /* Retrieves the value of a variable stored in this context, or in a parent
   * context.
   * @method getVariable
   * @instance
   * @method {string} name - The name of the variable to retrieve.
   * @returns {string|number|boolean|array|Object}
   */
  getVariable (
    name,
    options = {}
  ) {
    if (this.variables[name] !== undefined) {
      return this.variables[name];
    } else if (!options.localOnly && this.parent) {
      return this.parent.getVariable(name);
    } else {
      return null;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Evaluates a variable or parameter and set it in the current input
   * context. Used by implementation of <xsl:variable>, <xsl:param?, and
   * <xsl:with-param>.
   * @method processVariable
   * @instance
   * @param {Node} transformNode - The node being evaluated.
   * @param {Object} [options={}] - Options to configure out the variable
   *   is stored. Use .override to allow an existing variable to be overridden
   *   and use .asText to force the variable to be store as a string. Use
   *   .value to send a value that will take precedence over the node value.
   */
  async processVariable (
    transformNode,
    options = {}
  ) {
    const override = options.override || false;
    const asText = options.asText || false;
    const name = $$(transformNode).getAttribute('name');
    const select = $$(transformNode).getAttribute('select');

    const prevDebugMode = XsltLog.debugMode;
    try {
      if (transformNode.getAttribute('debug') === 'true') {
        XsltLog.debugMode = true;
        debugger;
      }

      let value = options.value || null;
      if (value === null) {
        if (transformNode.childNodes.length > 0) {
          const fragmentNode = transformNode.ownerDocument.createDocumentFragment();
          await this.processChildNodes(transformNode, fragmentNode);
          value = fragmentNode;
        } else if (select) {
          value = await this.xsltSelect(transformNode, select);
        } else if (this.variables[name] !== undefined) {
          value = this.variables[name];
        } else {
          value = '';
        }
      }

      if (override || !this.getVariable(name, { localOnly: true })) {
        value = (asText && (value instanceof Array || value.nodeType !== undefined)) ? $$(value).textContent : value;
        value = (typeof value === 'string') ? value.replace(/\s+/g, ' ') : value;
        this.setVariable(name, value);
      }
    } finally {
      XsltLog.debugMode = prevDebugMode;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Traverses the template node tree. Calls the main processing
   * function with the current input context for every child node of the
   * current template node.
   * @method processChildNodes
   * @instance
   * @param {Node} transformNode - The node being evaluated.
   * @param {string} match - The expression to evaluate
   */
  async processChildNodes (
    transformNode,
    outputNode,
    options = {}
  ) {
    if (outputNode.childNodes == null) {
      return false;
    }

    if (transformNode.childNodes.length === 0) {
      const newTextNode = outputNode.ownerDocument.createTextNode('');
      outputNode.appendChild(newTextNode);
      return false;
    }

    for (let i = 0; i < transformNode.childNodes.length; i++) {
      const childTransformNode = transformNode.childNodes[i];
      if (options.ignoreText && childTransformNode.nodeType === Node.TEXT_NODE) {
        continue; // Don't break on return
      } else if (options.filter && !$$(childTransformNode).isA(options.filter)) {
        continue; // Don't break on return
      }

      switch (childTransformNode.nodeType) {
        case Node.ELEMENT_NODE: {
          await this.process(childTransformNode, outputNode);
          break;
        }
        case Node.TEXT_NODE: {
          const text = $$(childTransformNode).textContent;
          if (text.replace(/[ \r\n\f]/g, '').length > 0) {
            this.debug('- processing child ' + Utils.identify(childTransformNode) + ' transform node');
            const newTextNode = $$(outputNode.ownerDocument).createTextNode(text);
            outputNode.appendChild(newTextNode);
          } else if ((/^ +$/).test(text)) {
            const newTextNode = $$(outputNode.ownerDocument).createTextNode(' ');
            outputNode.appendChild(newTextNode);
          }
          break;
        }
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Remove all the include and import nodes and replace the content
   * referenced.
   * @instance
   * @param transformNode - The transform node containing the includes
   */
  async processIncludes (
    transformNode
  ) {
    for (var i = 0; i < transformNode.childNodes.length; i++) {
      const childTransformNode = transformNode.childNodes[i];
      if (childTransformNode.nodeType === Node.ELEMENT_NODE) {
        if ($$(childTransformNode).isA('xsl:include')) {
          await this.xsltInclude(childTransformNode);
        } else if ($$(childTransformNode).isA('xsl:import')) {
          await this.xsltImport(childTransformNode);
        }
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * The main entry point of the XSLT processor, as explained above.
   * @method processRoot
   * @instance
   * @param transformNode - The transform document root, as a DOM node.
   * @param outputNode - The root of the generated output, as a DOM node.
   * @param {Object} [options={}] - Any options to pass to the implementation.
   *   Use the options to pass a parameter value
   */
  async processRoot (
    transformNode,
    outputNode,
    options = {}
  ) {
    const namespaceURI = transformNode.namespaceURI;
    const localName = transformNode.localName;
    let returnValue = null;

    const prevDebugMode = XsltLog.debugMode;
    try {
      if (transformNode.getAttribute('debug') === 'true') {
        XsltLog.debugMode = true;
        debugger;
      }

      if (namespaceURI !== new XPathNamespaceResolver(transformNode).getNamespace('xsl')) {
        await this.passThrough(transformNode, outputNode);
      } else {
        const functionName = 'xslt' + localName.replace(/^[a-z]|-[a-z]/gi, (match) => {
          return match.replace(/-/, '').toUpperCase();
        });
        if (this[functionName]) {
          const exec = async () => this[functionName](transformNode, outputNode, options);
          returnValue = (XsltLog.debugMode) ? await Utils.measureAsync(functionName, exec) : await exec();
        } else {
          throw new Error(`not implemented: ${localName}`);
        }
      }
    } finally {
      XsltLog.debugMode = prevDebugMode;
    }

    return returnValue;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Processes a single transform node at the current context.
   * @method process
   * @instance
   * @param transformNode - The transform document root, as a DOM node.
   * @param outputNode - The root of the generated output, as a DOM node.
   * @param {Object} [options={}] - Any options to pass to the implementation.
   *   Use the options to pass a parameter value
   */
  async process (
    transformNode,
    outputNode,
    options = {}
  ) {
    const namespaceURI = transformNode.namespaceURI;
    const localName = transformNode.localName;
    let returnValue = null;

    const prevDebugMode = XsltLog.debugMode;
    try {
      if (transformNode.getAttribute('debug') === 'true') {
        XsltLog.debugMode = true;
        debugger;
      }

      if (namespaceURI !== new XPathNamespaceResolver(transformNode).getNamespace('xsl')) {
        await this.passThrough(transformNode, outputNode);
      } else {
        const functionName = 'xslt' + localName.replace(/^[a-z]|-[a-z]/gi, (match) => {
          return match.replace(/-/, '').toUpperCase();
        });
        if (this[functionName]) {
          const exec = async () => this[functionName](transformNode, outputNode, options);
          returnValue = (XsltLog.debugMode) ? await Utils.measureAsync(functionName, exec) : await exec();
        } else {
          throw new Error(`not implemented: ${localName}`);
        }
      }
    } finally {
      XsltLog.debugMode = prevDebugMode;
    }

    return returnValue;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // XSL Attribute & Element implementations
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltMatch
   * @instance
   * @implements @match
   * @param {Node} transformNode - The node being evaluated.
   * @param {string} match - The expression to evaluate
   */
  xsltMatch (
    transformNode,
    match
  ) {
    const contextNode = this.contextNode.ownerElement || this.contextNode.parentNode || this.contextNode;

    const context = this.clone({ contextNode: contextNode, transformNode: transformNode });
    const matchNodes = $$(contextNode).select(match, context);
    for (const matchNode of matchNodes) {
      if (matchNode === this.contextNode) {
        return true;
      }
      if (this.contextNode.nodeType === Node.DOCUMENT_NODE && this.contextNode.documentElement === matchNode) {
        return true; // This is a bit of a kludge
      }
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltTest
   * @instance
   * @implements @test
   * @param {Node} transformNode - The node being evaluated.
   * @param {string} text - The expression to evaluate.
   */
  xsltTest (
    transformNode,
    test
  ) {
    let returnValue = false;

    const context = this.clone({ transformNode: transformNode });
    returnValue = $$(this.contextNode).select(test, context, { type: XPath.XPathResult.BOOLEAN_TYPE });

    return returnValue;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltSelect
   * @instance
   * @implements @select
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} select - The expression to evaluate.
   * @param {XPath.XPathResult} [type=undefined] - The type of result to return.
   */
  async xsltSelect (
    transformNode,
    select,
    type = undefined
  ) {
    let contextNode = null;
    let variableNode = null;
    let value = null;

    // NOTE: XPath evaluation only works properly when the fragment is
    //       inserted into the document. So we do this temporarily.

    if ((/^\s*document\(\s*\$(.*?)\s*\)/).test(select)) {
      const srcVariable = select.replace(/^\s*document\(\s*\$(.*?)\s*\).*$/, '$1');
      const srcURL = (this.getVariable(srcVariable) || '').toString();
      const srcXML = await Utils.fetch(srcURL);
      if (srcXML) {
        const DOMParser = new XmlDOM.DOMParser();
        const srcDoc = DOMParser.parseFromString(srcXML);
        const documentNode = (this.contextNode.nodeType === Node.DOCUMENT_NODE) ? this.contextNode : this.contextNode.ownerDocument;
        contextNode = documentNode.createElement('temp');
        while (srcDoc.firstChild) {
          const moveNode = srcDoc.firstChild;
          moveNode.parentNode.removeChild(moveNode);
          contextNode.appendChild(moveNode);
        }
        const hostNode = this.contextNode.parentNode || this.contextNode.ownerElement || this.contextNode.documentElement;
        hostNode.appendChild(contextNode);
        select = select.replace(/^\s*document\(.*?\)/, '.');
      }
    } else if ((/^\s*\$([^/]+)/).test(select)) {
      const srcVariable = select.replace(/^\s*\$([^/]+).*$/, '$1');
      const variable = this.getVariable(srcVariable);
      if (!variable || ['string', 'number', 'boolean'].includes(typeof variable)) {
        return variable;
      } else if (variable instanceof Array && variable.length === 1 && variable[0].nodeType === Node.ATTRIBUTE_NODE) {
        return variable[0].nodeValue;
      } else {
        variableNode = variable;
      }
      const documentNode = (this.contextNode.nodeType === Node.DOCUMENT_NODE) ? this.contextNode : this.contextNode.ownerDocument;
      contextNode = documentNode.createElement('temp');
      while (variableNode.firstChild) {
        const moveNode = variableNode.firstChild;
        moveNode.parentNode.removeChild(moveNode);
        contextNode.appendChild(moveNode);
      }
      const hostNode = this.contextNode.parentNode || this.contextNode.ownerElement || this.contextNode.documentElement;
      hostNode.appendChild(contextNode);
      select = select.replace(/^\s*\$[^/]*/, '.');
    } else {
      contextNode = this.contextNode;
    }

    try {
      const context = this.clone({ contextNode: contextNode, transformNode: transformNode });
      value = $$(context.contextNode).select(select, context, { type: type });
    } finally {
      if (contextNode.nodeName === 'temp') {
        if (variableNode) {
          while (contextNode.firstChild) {
            const moveNode = contextNode.firstChild;
            moveNode.parentNode.removeChild(moveNode);
            variableNode.appendChild(moveNode);
          }
        }
        contextNode.parentNode.removeChild(contextNode);
      }
    }

    return value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltApplyTemplates
   * @instance
   * @implements <xsl:apply-templates>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltApplyTemplates (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      const mode = $$(transformNode).getAttribute('mode') || undefined;
      const modeTemplateNodes = this.getTemplateNodes(transformNode.ownerDocument, mode);
      this.debug('- ' +
        ((modeTemplateNodes.length === 0) ? 'no' : modeTemplateNodes.length) + ' ' +
        ((mode) ? mode + ' ' : '') +
        'templates to apply');
      if (modeTemplateNodes.length === 0) {
        return;
      }

      const select = $$(transformNode).getAttribute('select');
      const contextNodes = (select) ? await this.xsltSelect(transformNode, select) : this.contextNode.childNodes;
      this.debug('- ' +
        ((contextNodes.length === 0) ? 'no' : contextNodes.length) +
        ' context nodes selected against ' + this.getContext());
      if (contextNodes.length === 0) {
        return;
      }

      const sortContext = this.clone({ contextNode: contextNodes[0], transformNode: transformNode, contextPosition: 1, nodeList: contextNodes });
      await sortContext.processChildNodes(transformNode, outputNode, { filter: ['xsl:with-param'], ignoreText: true });

      for (let i = 0; i < sortContext.nodeList.length; i++) {
        const contextNode = sortContext.nodeList[i];

        let processed = false;
        for (let j = 0; j < modeTemplateNodes.length; j++) {
          const modeTemplateNode = modeTemplateNodes[j];

          const context = sortContext.clone({
            contextNode: contextNode,
            contextPosition: i + 1,
            variables: sortContext.variables,
            mode: mode
          });
          if (await context.process(modeTemplateNode, outputNode)) {
            processed = true;
            break;
          }
        }

        if (!processed && contextNode.nodeType === Node.TEXT_NODE) {
          $$(outputNode).copy(contextNode);
        }
      }

      sortContext.sortNodes(transformNode);
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltAttribute
   * @instance
   * @implements <xsl:attribute>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltAttribute (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const nameExpr = $$(transformNode).getAttribute('name');
    const name = this.resolveExpression(transformNode, nameExpr);
    const fragmentNode = outputDocument.createDocumentFragment();

    await this.processChildNodes(transformNode, fragmentNode);
    const value = fragmentNode.textContent;
    outputNode.setAttribute(name, value);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltCallTemplate
   * @instance
   * @implements <xsl:call-template>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltCallTemplate (
    transformNode,
    outputNode
  ) {
    const name = $$(transformNode).getAttribute('name');
    const paramContext = this.clone();

    await paramContext.processChildNodes(transformNode, outputNode, { filter: ['xsl:with-param'], ignoreText: true });

    const templateNode = this.getTemplateNode(transformNode.ownerDocument, name);
    if (templateNode) {
      await paramContext.processChildNodes(templateNode, outputNode);
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltChoose
   * @instance
   * @implements <xsl:choose> (and <xsl:when> and <xsl:otherwise>)
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltChoose (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      for (let i = 0; i < transformNode.childNodes.length; i++) {
        const childTransformNode = transformNode.childNodes[i];
        if (childTransformNode.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }

        if ($$(childTransformNode).isA('xsl:when')) {
          const test = $$(childTransformNode).getAttribute('test');
          if (test && this.xsltTest(transformNode, test)) {
            this.debug('- selected ' + Utils.identify(childTransformNode) + ' against ' + this.getContext());
            await this.processChildNodes(childTransformNode, outputNode);
            return true;
          }
        } else if ($$(childTransformNode).isA('xsl:otherwise')) {
          this.debug('- selected ' + Utils.identify(childTransformNode) + ' against ' + this.getContext());
          await this.processChildNodes(childTransformNode, outputNode);
          return true;
        }
      }
    } finally {
      XsltContext.indent--;
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltComment
   * @instance
   * @implements <xsl:comment>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltComment (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const fragmentNode = outputDocument.createDocumentFragment();
    await this.processChildNodes(transformNode, fragmentNode);
    const commentData = fragmentNode.textContent;
    const newComment = outputDocument.createComment(commentData);
    outputNode.appendChild(newComment);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltCopy
   * @instance
   * @implements <xsl:copy>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltCopy (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      const copyNode = $$(outputNode).copy(this.contextNode);
      if (copyNode) {
        this.debug('- ' + this.getContext() + ' copy success');
        if ([Node.ELEMENT_NODE, Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(copyNode.nodeType)) {
          await this.processChildNodes(transformNode, copyNode);
        }
      }
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltCopyOf
   * @instance
   * @implements <xsl:copy-of>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltCopyOf (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const select = $$(transformNode).getAttribute('select');
    if (select) {
      const contextNodes = await this.xsltSelect(transformNode, select);
      if (contextNodes.length > 1) {
        contextNodes.forEach((contextNode) => {
          $$(outputNode).copyDeep(contextNode);
        });
      } else if (contextNodes.length === 1) {
        const text = $$(contextNodes[0]).textContent;
        const newTextNode = $$(outputDocument).createTextNode(text);
        outputNode.appendChild(newTextNode);
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltDecimalFormat
   * @instance
   * @implements <xsl:decimal-format>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltDecimalFormat (
    transformNode,
    outputNode
  ) {
    const name = $$(transformNode).getAttribute('name') || '_default';
    XPathFunctionResolver.decimalFormats[name] = {
      decimalSeparator: $$(transformNode).getAttribute('decimal-separator') || '.',
      groupingSeparator: $$(transformNode).getAttribute('grouping-separator') || ',',
      infinity: $$(transformNode).getAttribute('infinity') || 'Infinity',
      minusSign: $$(transformNode.getAttribute('minus-sign')) || '-',
      NaN: $$(transformNode).getAttribute('NaN') || 'NaN',
      percent: $$(transformNode).getAttribute('percent') || '%',
      perMille: $$(transformNode).getAttribute('per-mille') || '\u2030',
      zeroDigit: $$(transformNode).getAttribute('zero-digit') || '0',
      patternSeparator: $$(transformNode).getAttribute('pattern-separator') || ';'
    };
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltElement
   * @instance
   * @implements <xsl:element>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltElement (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const qNameExpr = $$(transformNode).getAttribute('name');
    const qName = this.resolveExpression(transformNode, qNameExpr);
    let namespaceURI = $$(transformNode).getAttribute('namespace');
    if (!namespaceURI) {
      namespaceURI = $$(this.contextNode).getNamespaceURI(qName);
    }

    const newElement = $$(outputDocument).createElementNS(namespaceURI, qName);
    outputNode.appendChild(newElement);

    await this.processChildNodes(transformNode, newElement);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltForEach
   * @instance
   * @implements <xsl:for-each>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltForEach (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      const select = $$(transformNode).getAttribute('select');
      if (select) {
        const contextNodes = await this.xsltSelect(transformNode, select);
        if (contextNodes.length > 0) {
          this.debug('- select ' + select + ' against ' + this.getContext());
          const sortContext = this.clone({ contextNode: contextNodes[0], contextPosition: 1, nodeList: contextNodes });
          sortContext.sortNodes(transformNode);

          for (let i = 0; i < sortContext.nodeList.length; i++) {
            const contextNode = sortContext.nodeList[i];
            const context = sortContext.clone({
              contextNode: contextNode,
              contextPosition: i + 1
            });
            await context.processChildNodes(transformNode, outputNode);
          }
        } else {
          this.debug('- no nodes to iterate');
        }
      }
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltFunction
   * @instance
   * @implements <xsl:function>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltFunction (
    transformNode,
    outputNode
  ) {
    // Do nothing - the function resolver will handle this
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltIf
   * @instance
   * @implements <xsl:if>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltIf (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      const test = $$(transformNode).getAttribute('test');
      if (test && this.xsltTest(transformNode, test)) {
        this.debug('- test ' + test);
        await this.processChildNodes(transformNode, outputNode);
      } else {
        this.debug('- no match');
      }
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltInclude
   * @instance
   * @implements <xsl:include>
   * @param {Node} transformNode - The node being evaluated.
   */
  async xsltInclude (
    transformNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      if (!transformNode.hasAttribute('href')) {
        this.debug('- skipping (no href)');
        return;
      }

      let url = transformNode.getAttribute('href');
      if ((/^\./).test(url) && this.transformURL) {
        url = this.transformURL.replace(/[^/]+$/, '') + url.replace(/^\.\//, '');
      }

      try {
        transformNode.removeAttribute('href'); // To prevent any infinite loops
        const responseXML = await Utils.fetch(url);
        if (responseXML) {
          const DOMParser = new XmlDOM.DOMParser();
          const responseDoc = DOMParser.parseFromString(responseXML);
          const fragmentTransformNode = transformNode.ownerDocument.createDocumentFragment();
          const includeTransformNode = $$(fragmentTransformNode).copyDeep(responseDoc.documentElement);
          if (transformNode.localName === 'include') {
            while (includeTransformNode.firstChild) {
              const childIncludeTransformNode = includeTransformNode.firstChild;
              includeTransformNode.removeChild(childIncludeTransformNode);
              transformNode.parentNode.insertBefore(childIncludeTransformNode, transformNode);
            }
          } else {
            while (includeTransformNode.firstChild) {
              const childIncludeTransformNode = includeTransformNode.firstChild;
              includeTransformNode.removeChild(childIncludeTransformNode);
              transformNode.parentNode.appendChild(childIncludeTransformNode);
            }
          }
          transformNode.parentNode.removeChild(transformNode);
          this.debug('Resolved ' + transformNode.localName + ' -> ' + url);
        }
      } catch (exception) {}
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltImport
   * @instance
   * @implements <xsl:import>
   * @param {Node} transformNode - The node being evaluated.
   */
  async xsltImport (
    transformNode
  ) {
    // The xsltImport implementation will take care of the differences
    await this.xsltInclude(transformNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltOutput
   * @instance
   * @implements <xsl:output>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltOutput (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      XsltContext.output = {
        method: transformNode.getAttribute('method'),
        version: transformNode.getAttribute('version') || '1.0',
        encoding: transformNode.getAttribute('encoding') || 'UTF-8',
        omitXmlDeclaration: transformNode.getAttribute('omit-xml-declaration') || 'no',
        standalone: transformNode.getAttribute('standalone') || 'no',
        indent: transformNode.getAttribute('indent') || 'no',
        mediaType: transformNode.getAttribute('media-type') || 'text/xml'
      };
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltParam
   * @instance
   * @implements <xsl:param>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   * @param {Object} [options={}] -
   */
  async xsltParam (
    transformNode,
    outputNode,
    options = {}
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      await this.processVariable(transformNode, { asText: true });
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltPreserveSpace
   * @instance
   * @implements <xsl:preserve-space>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltPreserveSpace (
    transformNode,
    outputNode
  ) {
    let elements = $$(transformNode).getAttribute('elements');

    elements = elements.replace(/(^\s+|\s(?:\s+)|\s+$)/, '').split(' ');
    elements.forEach((elementName) => {
      const namespaceURI = (/:/).test(elementName) ? transformNode.lookupNamespaceURI(elementName.replace(/:.*/, '')) : null;
      const localName = elementName.replace(/^.*:/, '');
      const fullName = ((namespaceURI) ? '{' + namespaceURI + '}' : '') + localName;
      this.cfg.preserveSpaceList[fullName] = elementName;
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltProcessingInstruction
   * @instance
   * @implements <xsl:processing-instruction>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltProcessingInstruction (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const nameExpr = $$(transformNode).getAttribute('name');
    const target = this.resolveExpression(transformNode, nameExpr);

    const fragmentNode = transformNode.ownerDocument.createDocumentFragment();
    await this.processChildNodes(transformNode, fragmentNode);
    const data = fragmentNode.textContent;

    const newPI = $$(outputDocument).createProcessingInstruction(target, data);
    outputNode.appendChild(newPI);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Does nothing as sorting is handled earlier
   * @method xsltSort
   * @instance
   * @implements <xsl:sort>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltSort (
    transformNode,
    outputNode
  ) {
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltStripSpace
   * @instance
   * @implements <xsl:strip-space>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltStripSpace (
    transformNode,
    outputNode
  ) {
    let elements = $$(transformNode).getAttribute('elements');

    elements = elements.replace(/(^\s+|\s(?:\s+)|\s+$)/, '').split(' ');
    elements.forEach((elementName) => {
      const namespaceURI = (/:/).test(elementName) ? transformNode.lookupNamespaceURI(elementName.replace(/:.*/, '')) : null;
      const localName = elementName.replace(/^.*:/, '');
      const fullName = ((namespaceURI) ? '{' + namespaceURI + '}' : '') + localName;
      this.cfg.stripSpaceList[fullName] = elementName;
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltStylesheet
   * @instance
   * @implements <xsl:stylesheet>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltStylesheet (
    transformNode,
    outputNode
  ) {
    await this.xsltTransform(transformNode, outputNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltTransform
   * @instance
   * @implements <xsl:transform>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltTransform (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      // Resolve all the imports and includes
      await this.processIncludes(transformNode);
      this.debug('- all includes/imports processed');

      let rootTemplate = false;
      for (let i = 0; i < transformNode.childNodes.length; i++) {
        const childTransformNode = transformNode.childNodes[i];

        if ($$(childTransformNode).isA('xsl:output')) {
          this.xsltOutput(childTransformNode, outputNode);
        } else if ($$(childTransformNode).isA('xsl:strip-space')) {
          this.xsltStripSpace(childTransformNode, outputNode);
        } else if ($$(childTransformNode).isA('xsl:preserve-space')) {
          this.xsltPreserveSpace(childTransformNode, outputNode);
        } else if ($$(childTransformNode).isA('xsl:variable')) {
          await this.xsltVariable(childTransformNode, outputNode);
        } else if ($$(childTransformNode).isA('xsl:template') && childTransformNode.getAttribute('match') === '/') {
          rootTemplate = true;
          const context = this.clone({ contextNode: this.contextNode.ownerDocument });
          await context.processChildNodes(childTransformNode, outputNode);
          return true;
        }
      }

      if (!rootTemplate) {
        await this.processChildNodes(transformNode, outputNode, { ignoreText: true });
      }
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltTemplate
   * @instance
   * @implements <xsl:template>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltTemplate (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      const match = $$(transformNode).getAttribute('match');
      const mode = $$(transformNode).getAttribute('mode') || null;
      if (match && ((mode && mode === this.mode) || (!mode && !this.mode))) {
        if (this.xsltMatch(transformNode, match)) {
          this.debug('- matched against ' + this.getContext());
          await this.processChildNodes(transformNode, outputNode);
          return true;
        } else {
          this.debug('- skipping against ' + this.getContext());
        }
      }
    } finally {
      XsltContext.indent--;
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltText
   * @instance
   * @implements <xsl:text>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltText (
    transformNode,
    outputNode
  ) {
    let disableOutputEscaping = false;
    if (transformNode.hasAttribute('disable-output-escaping') && transformNode.getAttribute('disable-output-escaping').toLowerCase() === 'yes') {
      disableOutputEscaping = true;
    }

    const outputDocument = outputNode.ownerDocument;
    let text = $$(transformNode).textContent;
    if (disableOutputEscaping) {
      text = text.replace(/([<>'"&])/g, '[[$1]]');
    }
    const newTextNode = $$(outputDocument).createTextNode(text);
    outputNode.appendChild(newTextNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltValueOf
   * @instance
   * @implements <xsl:value-of>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltValueOf (
    transformNode,
    outputNode
  ) {
    let disableOutputEscaping = false;
    if (transformNode.hasAttribute('disable-output-escaping') && transformNode.getAttribute('disable-output-escaping').toLowerCase() === 'yes') {
      disableOutputEscaping = true;
    }

    const outputDocument = outputNode.ownerDocument;
    const select = $$(transformNode).getAttribute('select');
    if (select) {
      let value = await this.xsltSelect(transformNode, select, XPath.XPathResult.STRING_TYPE);
      if (value) {
        value = this.processWhitespace(value, this.contextNode);
        this.debug('- select ' + select + ' = ' + value);
        if (disableOutputEscaping) {
          value = value.replace(/([<>'"&])/g, '[[$1]]');
        }
        const newTextNode = $$(outputDocument).createTextNode(value);
        outputNode.appendChild(newTextNode);
      } else {
        this.debug('- no value');
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltVariable
   * @instance
   * @implements <xsl:variable>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltVariable (
    transformNode,
    outputNode
  ) {
    this.logTransform(transformNode);
    XsltContext.indent++;
    try {
      const variableName = transformNode.getAttribute('name');
      await this.processVariable(transformNode, { override: true /*, asText: true */ });
      this.debug('- variable ' + variableName + ' = "' + this.getVariable(variableName) + '"');
    } finally {
      XsltContext.indent--;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltWithParam
   * @instance
   * @implements <xsl:with-param>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltWithParam (
    transformNode,
    outputNode
  ) {
    await this.processVariable(transformNode, { override: true, asText: true });
  }
};

// ----------------------------------------------------------------------------
// Static properties
// ----------------------------------------------------------------------------

XsltContext.indent = 0;
XsltContext.fetchCache = {};

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.XsltContext = XsltContext;

// ----------------------------------------------------------------------------
