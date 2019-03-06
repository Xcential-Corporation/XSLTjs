/**
 * @file XsltContext.js - An XSLT engine written in JavaScript.
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @author {@link mailto:mesch@google.com Steffen Meschkat} (Original)
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 * @copyright &copy; 2005 Google Inc.
 *
 */

'use strict';

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

const Request = require('request');
const XmlDOM = require('xmldom');
const XPath = require('xpath');
const { $$ } = require('./XDomHelper');
const { Node } = require('./Node');
const { XPathNamespaceResolver } = require('./XPathNamespaceResolver');
const { XPathVariableResolver } = require('./XPathVariableResolver');
const { XPathFunctionResolver } = require('./XPathFunctionResolver');
const { Utils } = require('./Utils');

// -----------------------------------------------------------------------------
/* @class XsltContext
 * @classdesc Context object for evaluating XSLT elements.
 */
var XsltContext = class {

  /*
   * @constructor
   * @param {Node} node - The context node.
   * @param {Object} [options={}] - Other settings to be used in the context
   */
  constructor (
    node,
    options = {}
  ) {
    this.node = node;
    this.position = options.position || 0;
    this.nodeList = options.nodeList || [node];
    this.variables = options.variables || {};
    this.inputURL = options.inputURL || null;
    this.transformURL = options.transformURL || null;
    this.mode = options.mode || null;
    this.parent = options.parent || null;

    if (this.node.nodeType === Node.DOCUMENT_NODE) {
      // NOTE(meschkat): DOM Spec stipulates that the ownerDocument of a
      // document is null. Our root, however is the document that we are
      // processing, so the initial context is created from its document
      // node, which case we must handle here explcitly.
      this.root = node;
    } else {
      this.root = node.ownerDocument;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // Static methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static getTemplateNode (
    document,
    name
  ) {
    const transformRoot = document.documentElement;
    if (!global._cache.templatesByName) {
      global._cache.templatesByName = {};
      $$(transformRoot.childNodes).forEach((childNode) => {
        if ($$(childNode).isA('xsl:template') &&
           childNode.hasAttribute('name')) {
          global._cache.templatesByName[childNode.getAttribute('name')] = childNode;
        }
      });
    }

    return global._cache.templatesByName[name];
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static getTemplateNodes (
    document,
    mode = '_default'
  ) {
    const transformRoot = document.documentElement;
    if (!global._cache.templatesByMode) {
      global._cache.templatesByMode = {};
    }
    if (!global._cache.templatesByMode[mode]) {
      global._cache.templatesByMode[mode] = [];
      $$(transformRoot.childNodes).forEach((childNode) => {
        if ($$(childNode).isA('xsl:template') &&
           childNode.hasAttribute('match') &&
           ((mode === '_default' && !childNode.hasAttribute('mode')) || $$(childNode).getAttribute('mode') === mode)) {
          global._cache.templatesByMode[mode].push(childNode);
        }
      });
    }

    return global._cache.templatesByMode[mode];
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // Instance methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Makes a copy of the current context, replace items that are specified.
   * @method clone
   * @instance
   * @param {Node} [node=null] - Optional context node to use instead.
   * @param {Object} [options={}] - Optional parameters to use instead.
   */
  clone (
    node = null,
    options = {}
  ) {
    return new XsltContext(node || this.node, {
      position: options.position || this.position,
      nodeList: options.nodeList || this.nodeList,
      variables: options.variables || this.variables,
      inputURL: options.inputURL || this.inputURL,
      transformURL: options.transformURL || this.transformURL,
      mode: options.mode || null, // This should not be inherited
      parent: this
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Determines if a text node in the XSLT template document is to be
   * stripped according to XSLT whitespace stipping rules.
   * @method passText
   * @instance
   * @param {Node} transformNode - the XSLT node to use as source.
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
  passThrough (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;

    switch (transformNode.nodeType) {
      case Node.DOCUMENT_NODE: {
        // This applies to the DOCUMENT_NODE of the XSL transform,
        // so we don't have to treat it specially.
        this.processChildNodes(transformNode, outputNode);
        break;
      }
      case Node.ELEMENT_NODE: {
        const qName = transformNode.nodeName;
        const node = $$(outputDocument).createElement(qName, transformNode);
        $$(transformNode.attributes).forEach((attribute) => {
          const name = attribute.nodeName;
          const valueExpr = attribute.nodeValue;
          const value = this.resolveExpression(transformNode, valueExpr);
          node.setAttribute(name, value);
        });
        outputNode.appendChild(node);
        this.processChildNodes(transformNode, node);
        break;
      }
      case Node.TEXT_NODE: {
        if (this.passText(transformNode)) {
          const text = transformNode.nodeValue;
          const node = $$(outputDocument).createTextNode(text);
          outputNode.appendChild(node);
        }
        break;
      }
    }
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
    value,
  ) {
    while ((/\{[^}]+\}/).test(value)) {
      const match = value.match(/^(.*?)\{([^{}]+)\}(.*)$/);
      const leftSide = match[1];
      const xPath = match[2];
      const rightSide = match[3];

      if ((/^[.$]/).test(xPath) || (/:\/\(/).testXPath) {
        try {
          const options = {
            namespaceResolver: new XPathNamespaceResolver(transformNode),
            variableResolver: new XPathVariableResolver(transformNode, this),
            functionResolver: new XPathFunctionResolver(transformNode, this),
            type: XPath.XPathResult.STRING_TYPE
          };
          value = leftSide + $$(this.node).select(xPath, options) + rightSide;
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

    for (let i = 0; i < contextNode.childNodes.length; i++) {
      const childNode = contextNode.childNodes[i];
      if (childNode.nodeType === Node.ELEMENT_NODE) {
        if (filter && !$$(childNode).isA(filter)) {
          continue;
        }
        const name = $$(childNode).getAttribute('name');
        if (name === findName) {
          return childNode;
        } else if (name && options.namespaceURI) {
          const prefix = ((/:/).test(name)) ? name.replace(/:.*$/, '') : null;
          const namespaceURI = transformNode.lookupNamespaceURI(prefix);
          const localName = name.replace(/^.*:/, '');
          if (namespaceURI === options.namespaceURI && localName === findName) {
            return childNode;
          }
        }
      }
    }

    return null;
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

    $$(transformNode.childNodes).forEach((childNode) => {
      if ($$(childNode).isA('xsl:sort')) {
        const select = $$(childNode).getAttribute('select');
        const type = $$(childNode).getAttribute('data-type') || 'text';
        const order = $$(childNode).getAttribute('order') || 'ascending';
        sort.push({ select, type, order });
      }
    });

    if (sort.length === 0) {
      return;
    }

    const sortList = [];
    this.nodeList.forEach((node, i) => {
      const context = this.clone(node, { position: 0, nodeList: [node] });
      const sortItem = {
        node,
        key: []
      };

      sort.forEach((sortItem) => {
        const options = {
          namespaceResolver: new XPathNamespaceResolver(transformNode),
          variableResolver: new XPathVariableResolver(transformNode, this),
          functionResolver: new XPathFunctionResolver(transformNode, this)
        };
        const nodes = $$(context.node).select(sortItem.select, options);

        let eValue;
        if (sortItem.type === 'text') {
          let value = '';
          nodes.forEach((node) => {
            value += node.textContent;
          });
          eValue = String(value);
        } else if (sortItem.type === 'number') {
          let value = '';
          nodes.forEach((node) => {
            value += node.textContent;
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

    const nodes = [];
    sortList.forEach((sortItem) => {
      nodes.push(sortItem.node);
    });

    this.nodeList = nodes;
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
        this.variables[name] = Boolean(true);
      } else if (value === 'false') {
        this.variables[name] = Boolean(false);
      } else if (new RegExp('^\\d+(\\.\\d*)?$').test(value)) {
        this.variables[name] = Number(value);
      } else {
        this.variables[name] = String(value);
      }
    } else if (typeof value === 'boolean' || typeof value === 'number' || value instanceof Array) {
      this.variables[name] = value;
    } else {
      this.variables[name] = value;
    }
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
    name
  ) {
    if (this.variables[name] !== undefined) {
      return this.variables[name];
    } else if (this.parent) {
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
  processVariable (
    transformNode,
    options = {}
  ) {
    const override = options.override || false;
    const asText = options.asText || false;

    const name = $$(transformNode).getAttribute('name');
    const select = $$(transformNode).getAttribute('select');
    const as = $$(transformNode).getAttribute('as');

    let value = options.value || null;
    if (value === null) {
      if (transformNode.childNodes.length > 0) {
        const fragmentNode = transformNode.ownerDocument.createDocumentFragment();
        this.processChildNodes(transformNode, fragmentNode);
        value = fragmentNode;
      } else if (select) {
        value = this.xsltSelect(transformNode, select);
      } else {
        value = this.variables[name] || '';
      }
    }

    if (override || !this.getVariable(name)) {
      value = (asText && (value instanceof Array || value.nodeType !== undefined)) ? $$(value).textContent : value;
      value = (typeof value === 'string') ? value.replace(/^\s+|\s(?=\s+)|\s+$/g, '') : value;
      this.setVariable(name, value, as);
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
  processChildNodes (
    transformNode,
    outputNode,
    options = {}
  ) {
    let parameters = options.parameters || [];

    if (transformNode.childNodes.length === 0) {
      const textNode = outputNode.ownerDocument.createTextNode('');
      outputNode.appendChild(textNode);
      return false;
    }

    // Clone input context to keep variables declared here local to the
    // siblings of the children.
    const context = this.clone();

    $$(transformNode.childNodes).forEach((childTransformNode) => {
      if (options.ignoreText && childTransformNode.nodeType === Node.TEXT_NODE) {
        return false; // Don't break on return
      } else if (options.filter && !$$(childTransformNode).isA(options.filter)) {
        return false; // Don't break on return
      }
      switch (childTransformNode.nodeType) {
        case Node.ELEMENT_NODE: {
          const parameter = ($$(childTransformNode).isA('xsl:param')) ? parameters.shift() : undefined;
          return context.process(childTransformNode, outputNode, { parameter: parameter });
          break;
        }
        case Node.TEXT_NODE: {
          const text = childTransformNode.nodeValue;
          const node = $$(outputNode.ownerDocument).createTextNode(text);
          outputNode.appendChild(node);
          break;
        }
      }

      return false; // Don't break on return
    });
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
      let childNode = transformNode.childNodes[i];
      if (childNode.nodeType === Node.ELEMENT_NODE) {
        if ($$(childNode).isA('xsl:include')) {
          await this.xsltInclude(childNode);
        } else if ($$(childNode).isA('xsl:import')) {
          await this.xsltImport(childNode);
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

    if (namespaceURI !== new XPathNamespaceResolver(transformNode).getNamespace('xsl')) {
      this.passThrough(transformNode, outputNode);
    } else {
      const functionName = 'xslt' + localName.replace(/^[a-z]|-[a-z]/gi, (match) => {
        return match.replace(/-/, '').toUpperCase();
      });
      if (this[functionName]) {
        console.debug('# Executing: ' + transformNode.localName +
          ((transformNode.hasAttribute('name')) ? ' [' + transformNode.getAttribute('name') + ']' : ''));

        let returnValue;
        const exec = async () => await this[functionName](transformNode, outputNode, options);
        returnValue = (global.debug) ? await Utils.measureAsync(functionName, exec) : await exec();

        return returnValue;
      } else {
        throw new Error(`not implemented: ${localName}`);
      }
    }
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
  process (
    transformNode,
    outputNode,
    options = {}
  ) {
    const namespaceURI = transformNode.namespaceURI;
    const localName = transformNode.localName;

    if (namespaceURI !== new XPathNamespaceResolver(transformNode).getNamespace('xsl')) {
      this.passThrough(transformNode, outputNode);
    } else {
      const functionName = 'xslt' + localName.replace(/^[a-z]|-[a-z]/gi, (match) => {
        return match.replace(/-/, '').toUpperCase();
      });
      if (this[functionName]) {
        console.debug('# Executing: ' + transformNode.localName +
          ((transformNode.hasAttribute('name')) ? ' [' + transformNode.getAttribute('name') + ']' : ''));

        let returnValue;
        const exec = () => this[functionName](transformNode, outputNode, options);
        returnValue = (global.debug) ? Utils.measure(functionName, exec) : exec();

        return returnValue;
      } else {
        throw new Error(`not implemented: ${localName}`);
      }
    }
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
    let node = this.node;

    while (node) {
      const options = {
        namespaceResolver: new XPathNamespaceResolver(transformNode),
        variableResolver: new XPathVariableResolver(transformNode, this),
        functionResolver: new XPathFunctionResolver(transformNode, this)
      };
      const matchNodes = $$(node).select(match, options);
      for (const matchNode of matchNodes) {
        if (matchNode === this.node) {
          return true;
        }
      }
      node = node.parentNode;
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

    const options = {
      namespaceResolver: new XPathNamespaceResolver(transformNode),
      variableResolver: new XPathVariableResolver(transformNode, this),
      functionResolver: new XPathFunctionResolver(transformNode, this),
      type: XPath.XPathResult.BOOLEAN_TYPE
    };
    returnValue = $$(this.node).select(test, options);

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
  xsltSelect (
    transformNode,
    select,
    type = undefined
  ) {
    const options = {
      namespaceResolver: new XPathNamespaceResolver(transformNode),
      variableResolver: new XPathVariableResolver(transformNode, this),
      functionResolver: new XPathFunctionResolver(transformNode, this),
      type: type,
      selectMode: true
    };
    const value = $$(this.node).select(select, options);

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
  xsltApplyTemplates (
    transformNode,
    outputNode
  ) {
    const select = $$(transformNode).getAttribute('select');
    const nodes = (select) ? this.xsltSelect(transformNode, select) : this.node.childNodes;

    const mode = $$(transformNode).getAttribute('mode') || undefined;
    const modeTemplateNodes = XsltContext.getTemplateNodes(transformNode.ownerDocument, mode);

    const sortContext = this.clone(nodes[0], { position: 0, nodeList: nodes });
    sortContext.processChildNodes(transformNode, outputNode, { filter: ['xsl:with-param'], ignoreText: true });

    $$(sortContext.nodeList).forEach((contextNode, j) => {
      if (!$$(modeTemplateNodes).forEach((modeTemplateNode) => {
        return sortContext.clone(contextNode, { position: j, mode: mode }).process(modeTemplateNode, outputNode);
      })) {
        if (contextNode.nodeType === Node.TEXT_NODE) {
          $$(outputNode).copy(contextNode);
        }
      }
    });

    sortContext.sortNodes(transformNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltAttribute
   * @instance
   * @implements <xsl:attribute>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltAttribute (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const nameExpr = $$(transformNode).getAttribute('name');
    const name = this.resolveExpression(transformNode, nameExpr);
    const fragmentNode = outputDocument.createDocumentFragment();

    this.processChildNodes(transformNode, fragmentNode);
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
  xsltCallTemplate (
    transformNode,
    outputNode
  ) {
    const name = $$(transformNode).getAttribute('name');
    const paramContext = this.clone();

    paramContext.processChildNodes(transformNode, outputNode, { filter: ['xsl:with-param'], ignoreText: true });

    const templateNode = XsltContext.getTemplateNode(transformNode.ownerDocument, name);
    if (templateNode) {
      paramContext.processChildNodes(templateNode, outputNode);
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
  xsltChoose (
    transformNode,
    outputNode
  ) {
    $$(transformNode.childNodes).forEach((childNode) => {
      if (childNode.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      if ($$(childNode).isA('xsl:when')) {
        const test = $$(childNode).getAttribute('test');
        if (test && this.xsltTest(transformNode, test)) {
          this.processChildNodes(childNode, outputNode);
          return true;
        }
      } else if ($$(childNode).isA('xsl:otherwise')) {
        this.processChildNodes(childNode, outputNode);
        return true;
      }

      return false;
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltComment
   * @instance
   * @implements <xsl:comment>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltComment (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const fragmentNode = outputDocument.creatDocumentFragment();
    this.processChildNodes(transformNode, fragmentNode);
    const commentData = fragmentNode.textContent;
    const commentNode = outputDocument.createComment(commentData);
    fragmentNode.appendChild(commentNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltCopy
   * @instance
   * @implements <xsl:copy>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltCopy (
    transformNode,
    outputNode
  ) {
    const copyNode = $$(outputNode).copy(this.node);
    if (copyNode) {
      this.processChildNodes(transformNode, copyNode);
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
  xsltCopyOf (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const select = $$(transformNode).getAttribute('select');
    if (select) {
      const nodes = this.xsltSelect(transformNode, select);
      if (nodes.length > 1) {
        nodes.forEach((node) => {
          $$(outputNode).copyDeep(node);
        });
      } else if (nodes.length === 1) {
        const text = nodes[0].textContent;
        const node = $$(outputDocument).createTextNode(text);
        outputNode.appendChild(node);
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
  xsltElement (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const qNameExpr = $$(transformNode).getAttribute('name');
    const qName = this.resolveExpression(transformNode, qNameExpr);
    const node = $$(outputDocument).createElement(qName, transformNode);
    outputNode.appendChild(node);
    this.processChildNodes(transformNode, node);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltForEach
   * @instance
   * @implements <xsl:for-each>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltForEach (
    transformNode,
    outputNode
  ) {
    const select = $$(transformNode).getAttribute('select');
    if (select) {
      const selectNodes = this.xsltSelect(transformNode, select);
      if (selectNodes.length > 0) {
        console.debug('# - select: ' + select);
        const sortContext = this.clone(selectNodes[0], { position: 0, nodeList: selectNodes });
        sortContext.sortNodes(transformNode);

        $$(sortContext.nodeList).forEach((node, i) => {
          sortContext.clone(node, { position: i }).processChildNodes(transformNode, outputNode);
        });
      } else {
        console.debug('# - no nodes to iterate');
      }
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
  xsltIf (
    transformNode,
    outputNode
  ) {
    const test = $$(transformNode).getAttribute('test');
    if (test && this.xsltTest(transformNode, test)) {
      console.debug('# - test: ' + test);
      this.processChildNodes(transformNode, outputNode);
    } else {
      console.debug('# - no match');
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
    if (!transformNode.hasAttribute('href')) {
      return;
    }

    const getHTTP = (url) => {
      let promise = new Promise((resolve, reject) => {
        try {
          Request
            .get(url)
            .on('response', (response) => {
              response.on('data', (data) => {
                response.responseXML = data.toString('utf8');
                resolve(response);
              });
            })
            .on('error', (error) => {
              reject(new Error(error.message));
            });
        } catch (exception) {
          resolve({
            readyState: 4,
            status: 503,
            statusText: 'Service unavailable',
            headers: {}
          });
        }
      });

      return promise;
    };

    let url = transformNode.getAttribute('href');
    if ((/^\./).test(url) && this.transformURL) {
      url = this.transformURL.replace(/[^/]+$/, '') + url.replace(/^\.\//, '');
    }

    try {
      transformNode.removeAttribute('href'); // To prevent any infinite loops
      let response = await getHTTP(url);
      if (response.responseXML) {
        let responseXML = response.responseXML;
        const DOMParser = new XmlDOM.DOMParser();
        const responseDoc = DOMParser.parseFromString(responseXML);
        const fragmentNode = transformNode.ownerDocument.createDocumentFragment();
        const includeNode = $$(fragmentNode).copyDeep(responseDoc.documentElement);
        if (transformNode.localName === 'include') {
          while (includeNode.firstChild) {
            const childNode = includeNode.firstChild;
            includeNode.removeChild(childNode);
            transformNode.parentNode.insertBefore(childNode, transformNode);
          }
        } else {
          while (includeNode.firstChild) {
            const childNode = includeNode.firstChild;
            includeNode.removeChild(childNode);
            transformNode.parentNode.appendChild(childNode);
          }
        }
        transformNode.parentNode.removeChild(transformNode);
        console.debug('# Resolved: ' + transformNode.localName + ' -> ' + url);
      }
    } catch (exception) {}
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
    XsltContext.output = {
      method: transformNode.getAttribute('method'),
      version: transformNode.getAttribute('version') || '1.0',
      encoding: transformNode.getAttribute('encoding') || 'UTF-8',
      omitXmlDeclaration: transformNode.getAttribute('omit-xml-declaration') || 'no',
      standalone: transformNode.getAttribute('standalone') || 'no',
      indent: transformNode.getAttribute('indent') || 'no',
      mediaType: transformNode.getAttribute('media-type') || 'text/xml'
    };
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
  xsltParam (
    transformNode,
    outputNode,
    options = {}
  ) {
    this.processVariable(transformNode, { asText: true, value: options.parameter });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltProcessingInstruction
   * @instance
   * @implements <xsl:processing-instruction>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltProcessingInstruction (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const nameExpr = $$(transformNode).getAttribute('name');
    const target = this.resolveExpression(transformNode, nameExpr);

    const fragmentNode = transformNode.ownerDocument.createDocumentFragment();
    this.processChildNodes(transformNode, fragmentNode);
    const data = fragmentNode.textContent;

    const node = $$(outputDocument).createProcessingInstruction(target, data);
    outputNode.appendChild(node);
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
   * @method xsltTransfrom
   * @instance
   * @implements <xsl:transform>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltTransform (
    transformNode,
    outputNode
  ) {
    // Resolve all the imports and includes
    await this.processIncludes(transformNode);
    console.debug('# --- All includes/imports processed ---');

    let rootTemplate = false;
    $$(transformNode.childNodes).forEach((childNode) => {
      if ($$(childNode).isA('xsl:template') && childNode.getAttribute('match') === '/') {
        rootTemplate = true;
        this.processChildNodes(childNode, outputNode);
        return true;
      }
    });

    if (!rootTemplate) {
      this.processChildNodes(transformNode, outputNode, { ignoreText: true });
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
  xsltTemplate (
    transformNode,
    outputNode
  ) {
    const match = $$(transformNode).getAttribute('match');
    const mode = $$(transformNode).getAttribute('mode') || null;
    if (match && this.xsltMatch(transformNode, match)) {
      if ((mode && mode === this.mode) || (!mode && !this.mode)) {
        console.debug('# - match: ' + match + ((mode) ? ' (mode=' + mode + ')' : ''));
        this.processChildNodes(transformNode, outputNode);
        return true;
      } else {
        console.debug('# - match: ' + match + ((mode) ? ' (unmatched mode=' + mode + ')' : ''));
      }
    } else {
      console.debug('# - no match');
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
    const outputDocument = outputNode.ownerDocument;
    const text = transformNode.textContent;
    const node = $$(outputDocument).createTextNode(text);
    outputNode.appendChild(node);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltValueOf
   * @instance
   * @implements <xsl:value-of>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltValueOf (
    transformNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const select = $$(transformNode).getAttribute('select');
    if (select) {
      const value = this.xsltSelect(transformNode, select, XPath.XPathResult.STRING_TYPE);
      if (value) {
        console.debug('# - select: ' + select + ' = ' + value);
        const node = $$(outputDocument).createTextNode(value);
        outputNode.appendChild(node);
      } else {
        console.debug('# - no value');
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
  xsltVariable (
    transformNode,
    outputNode
  ) {
    this.processVariable(transformNode, { override: true, asText: true });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltWithParam
   * @instance
   * @implements <xsl:with-param>
   * @param {Node} transformNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltWithParam (
    transformNode,
    outputNode
  ) {
    this.processVariable(transformNode, { override: true, asText: true });
  }
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XsltContext = XsltContext;

// -----------------------------------------------------------------------------
