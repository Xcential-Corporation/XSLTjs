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
    this.stylesheetURL = options.stylesheetURL || null;
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
    const stylesheetRoot = document.documentElement;
    if (!global._cache.templatesByName) {
      global._cache.templatesByName = {};
      $$(stylesheetRoot.childNodes).forEach((childNode) => {
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
    const stylesheetRoot = document.documentElement;
    if (!global._cache.templatesByMode) {
      global._cache.templatesByMode = {};
    }
    if (!global._cache.templatesByMode[mode]) {
      global._cache.templatesByMode[mode] = [];
      $$(stylesheetRoot.childNodes).forEach((childNode) => {
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
      stylesheetURL: options.stylesheetURL || this.stylesheetURL,
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
   * @param {Node} stylesheetNode - the XSLT node to use as source.
   * @returns {Boolean}
   * @see [XSLT], section 3.4.
   * @todo (meschkat) Whitespace stripping on the input document is
   *   currently not implemented.
   */
  passText (
    stylesheetNode
  ) {
    if (!stylesheetNode.nodeValue.match(/^\s*$/)) {
      return true;
    }

    let parentElement = stylesheetNode.parentNode;
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  passThrough (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;

    switch (stylesheetNode.nodeType) {
      case Node.DOCUMENT_NODE: {
        // This applies to the DOCUMENT_NODE of the XSL stylesheet,
        // so we don't have to treat it specially.
        this.processChildNodes(stylesheetNode, outputNode);
        break;
      }
      case Node.ELEMENT_NODE: {
        const qName = stylesheetNode.nodeName;
        const node = $$(outputDocument).createElement(qName, stylesheetNode);
        $$(stylesheetNode.attributes).forEach((attribute) => {
          const name = attribute.nodeName;
          const valueExpr = attribute.nodeValue;
          const value = this.resolveExpression(stylesheetNode, valueExpr);
          node.setAttribute(name, value);
        });
        outputNode.appendChild(node);
        this.processChildNodes(stylesheetNode, node);
        break;
      }
      case Node.TEXT_NODE: {
        if (this.passText(stylesheetNode)) {
          const text = stylesheetNode.nodeValue;
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {string} value - The text containing items to resolve.
   * @returns {string}
   */
  resolveExpression (
    stylesheetNode,
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
            namespaceResolver: new XPathNamespaceResolver(stylesheetNode),
            variableResolver: new XPathVariableResolver(stylesheetNode, this),
            functionResolver: new XPathFunctionResolver(stylesheetNode, this),
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

    return value.replace(/\[\[\[/g, '{').replace(/\]\]\]/g, '}');
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Finds a node with the specified name. Further filtering to an element tag
   * can be done via the options. Also, by default, the root node will be
   * searched, but an alternate stylesheet context node can be specified.
   * @method findNamedNode
   * @instance
   * @param {string} name - The value of the name attribute to search for.
   * @param {Object} [options={}] - Specify a 'filter' as either an
   *   array or string value of qNames to filter against. Use a '^' at
   *   the start of a qName to invert the sense. Specify a 'context' as
   *   a node in the stylesheet document. Otherwise, the documentElement
   *   will be used
   * @returns {Node|Null}
   */
  findNamedNode (
    stylesheetNode,
    findName,
    options = {}
  ) {
    const filter = options.filter || null;
    const contextNode = options.root || stylesheetNode.ownerDocument.documentElement;

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
          const namespaceURI = stylesheetNode.lookupNamespaceURI(prefix);
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @todo (meschkat) Case-order is not implemented.
   */
  sortNodes (
    stylesheetNode
  ) {
    const sort = [];

    $$(stylesheetNode.childNodes).forEach((childNode) => {
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
          namespaceResolver: new XPathNamespaceResolver(stylesheetNode),
          variableResolver: new XPathVariableResolver(stylesheetNode, this),
          functionResolver: new XPathFunctionResolver(stylesheetNode, this)
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Object} [options={}] - Options to configure out the variable
   *   is stored. Use .override to allow an existing variable to be overridden
   *   and use .asText to force the variable to be store as a string. Use
   *   .value to send a value that will take precedence over the node value.
   */
  processVariable (
    stylesheetNode,
    options = {}
  ) {
    const override = options.override || false;
    const asText = options.asText || false;

    const name = $$(stylesheetNode).getAttribute('name');
    const select = $$(stylesheetNode).getAttribute('select');
    const as = $$(stylesheetNode).getAttribute('as');

    let value = options.value || null;
    if (value === null) {
      if (stylesheetNode.childNodes.length > 0) {
        const fragmentNode = stylesheetNode.ownerDocument.createDocumentFragment();
        this.processChildNodes(stylesheetNode, fragmentNode);
        value = fragmentNode;
      } else if (select) {
        value = this.xsltSelect(stylesheetNode, select);
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {string} match - The expression to evaluate
   */
  processChildNodes (
    stylesheetNode,
    outputNode,
    options = {}
  ) {
    let parameters = options.parameters || [];

    if (stylesheetNode.childNodes.length === 0) {
      const textNode = outputNode.ownerDocument.createTextNode('');
      outputNode.appendChild(textNode);
      return false;
    }

    // Clone input context to keep variables declared here local to the
    // siblings of the children.
    const context = this.clone();

    $$(stylesheetNode.childNodes).forEach((childStylesheetNode) => {
      if (options.ignoreText && childStylesheetNode.nodeType === Node.TEXT_NODE) {
        return false; // Don't break on return
      } else if (options.filter && !$$(childStylesheetNode).isA(options.filter)) {
        return false; // Don't break on return
      }
      switch (childStylesheetNode.nodeType) {
        case Node.ELEMENT_NODE: {
          const parameter = ($$(childStylesheetNode).isA('xsl:param')) ? parameters.shift() : undefined;
          context.process(childStylesheetNode, outputNode, { parameter: parameter });
          break;
        }
        case Node.TEXT_NODE: {
          const text = childStylesheetNode.nodeValue;
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
   * @param stylesheetNode - The stylesheet node containing the includes
   */
  async processIncludes (
    stylesheetNode
  ) {
    for (var i = 0; i < stylesheetNode.childNodes.length; i++) {
      let childNode = stylesheetNode.childNodes[i];
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
   * @method process
   * @instance
   * @param stylesheetNode - The stylesheet document root, as a DOM node.
   * @param outputNode - The root of the generated output, as a DOM node.
   * @param {Object} [options={}] - Any options to pass to the implementation.
   *   Use the options to pass a parameter value
   */
  async process (
    stylesheetNode,
    outputNode,
    options = {}
  ) {
    const namespaceURI = stylesheetNode.namespaceURI;
    const localName = stylesheetNode.localName;

    if (namespaceURI !== new XPathNamespaceResolver(stylesheetNode).getNamespace('xsl')) {
      this.passThrough(stylesheetNode, outputNode);
    } else {
      const functionName = 'xslt' + localName.replace(/^[a-z]|-[a-z]/gi, (match) => {
        return match.replace(/-/, '').toUpperCase();
      });
      if (this[functionName]) {
        console.debug('# Executing: ' + stylesheetNode.localName +
          ((stylesheetNode.hasAttribute('name')) ? ' [' + stylesheetNode.getAttribute('name') + ']' : ''));

        const exec = async () => await this[functionName](stylesheetNode, outputNode, options);
        return (global.debug) ? await Utils.measureAsync(functionName, exec) : await exec();
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {string} match - The expression to evaluate
   */
  xsltMatch (
    stylesheetNode,
    match
  ) {
    let node = this.node;

    while (node) {
      const options = {
        namespaceResolver: new XPathNamespaceResolver(stylesheetNode),
        variableResolver: new XPathVariableResolver(stylesheetNode, this),
        functionResolver: new XPathFunctionResolver(stylesheetNode, this)
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {string} text - The expression to evaluate.
   */
  xsltTest (
    stylesheetNode,
    test
  ) {
    let returnValue = false;

    const options = {
      namespaceResolver: new XPathNamespaceResolver(stylesheetNode),
      variableResolver: new XPathVariableResolver(stylesheetNode, this),
      functionResolver: new XPathFunctionResolver(stylesheetNode, this),
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} select - The expression to evaluate.
   * @param {XPath.XPathResult} [type=undefined] - The type of result to return.
   */
  xsltSelect (
    stylesheetNode,
    select,
    type = undefined
  ) {
    const options = {
      namespaceResolver: new XPathNamespaceResolver(stylesheetNode),
      variableResolver: new XPathVariableResolver(stylesheetNode, this),
      functionResolver: new XPathFunctionResolver(stylesheetNode, this),
      type: type
    };
    const value = $$(this.node).select(select, options);

    return value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltApplyTemplates
   * @instance
   * @implements <xsl:apply-templates>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltApplyTemplates (
    stylesheetNode,
    outputNode
  ) {
    const select = $$(stylesheetNode).getAttribute('select');
    const nodes = (select) ? this.xsltSelect(stylesheetNode, select) : this.node.childNodes;

    const mode = $$(stylesheetNode).getAttribute('mode') || undefined;
    const modeTemplateNodes = XsltContext.getTemplateNodes(stylesheetNode.ownerDocument, mode);

    const sortContext = this.clone(nodes[0], { position: 0, nodeList: nodes });
    sortContext.processChildNodes(stylesheetNode, outputNode, { filter: ['xsl:with-param'], ignoreText: true });

    $$(sortContext.nodeList).forEach((contextNode, j) => {
      if (!$$(modeTemplateNodes).forEach((modeTemplateNode) => {
        return sortContext.clone(contextNode, { position: j, mode: mode }).process(modeTemplateNode, outputNode);
      })) {
        if (contextNode.nodeType === Node.TEXT_NODE) {
          $$(outputNode).copy(contextNode);
        }
      }
    });

    sortContext.sortNodes(stylesheetNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltAttribute
   * @instance
   * @implements <xsl:attribute>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltAttribute (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const nameExpr = $$(stylesheetNode).getAttribute('name');
    const name = this.resolveExpression(stylesheetNode, nameExpr);
    const fragmentNode = outputDocument.createDocumentFragment();

    this.processChildNodes(stylesheetNode, fragmentNode);
    const value = fragmentNode.textContent;
    outputNode.setAttribute(name, value);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltCallTemplate
   * @instance
   * @implements <xsl:call-template>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltCallTemplate (
    stylesheetNode,
    outputNode
  ) {
    const name = $$(stylesheetNode).getAttribute('name');
    const paramContext = this.clone();

    paramContext.processChildNodes(stylesheetNode, outputNode, { filter: ['xsl:with-param'], ignoreText: true });

    const templateNode = XsltContext.getTemplateNode(stylesheetNode.ownerDocument, name);
    if (templateNode) {
      paramContext.processChildNodes(templateNode, outputNode);
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltChoose
   * @instance
   * @implements <xsl:choose> (and <xsl:when> and <xsl:otherwise>)
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltChoose (
    stylesheetNode,
    outputNode
  ) {
    $$(stylesheetNode.childNodes).forEach((childNode) => {
      if (childNode.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      if ($$(childNode).isA('xsl:when')) {
        const test = $$(childNode).getAttribute('test');
        if (test && this.xsltTest(stylesheetNode, test)) {
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltxsltComment (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const fragmentNode = outputDocument.creatDocumentFragment();
    this.processChildNodes(stylesheetNode, fragmentNode);
    const commentData = fragmentNode.textContent;
    const commentNode = outputDocument.createComment(commentData);
    fragmentNode.appendChild(commentNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltCopy
   * @instance
   * @implements <xsl:copy>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltCopy (
    stylesheetNode,
    outputNode
  ) {
    const copyNode = $$(outputNode).copy(this.node);
    if (copyNode) {
      this.processChildNodes(stylesheetNode, copyNode);
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltCopyOf
   * @instance
   * @implements <xsl:copy-of>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltCopyOf (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const select = $$(stylesheetNode).getAttribute('select');
    if (select) {
      const nodes = this.xsltSelect(stylesheetNode, select);
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltDecimalFormat (
    stylesheetNode,
    outputNode
  ) {
    const name = $$(stylesheetNode).getAttribute('name') || '_default';
    XPathFunctionResolver.decimalFormats[name] = {
      decimalSeparator: $$(stylesheetNode).getAttribute('decimal-separator') || '.',
      groupingSeparator: $$(stylesheetNode).getAttribute('grouping-separator') || ',',
      infinity: $$(stylesheetNode).getAttribute('infinity') || 'Infinity',
      minusSign: $$(stylesheetNode.getAttribute('minus-sign')) || '-',
      NaN: $$(stylesheetNode).getAttribute('NaN') || 'NaN',
      percent: $$(stylesheetNode).getAttribute('percent') || '%',
      perMille: $$(stylesheetNode).getAttribute('per-mille') || '\u2030',
      zeroDigit: $$(stylesheetNode).getAttribute('zero-digit') || '0',
      patternSeparator: $$(stylesheetNode).getAttribute('pattern-separator') || ';'
    };
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltElement
   * @instance
   * @implements <xsl:element>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltElement (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const qNameExpr = $$(stylesheetNode).getAttribute('name');
    const qName = this.resolveExpression(stylesheetNode, qNameExpr);
    const node = $$(outputDocument).createElement(qName, stylesheetNode);
    outputNode.appendChild(node);
    this.processChildNodes(stylesheetNode, node);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltForEach
   * @instance
   * @implements <xsl:for-each>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltForEach (
    stylesheetNode,
    outputNode
  ) {
    const select = $$(stylesheetNode).getAttribute('select');
    if (select) {
      const selectNodes = this.xsltSelect(stylesheetNode, select);
      if (selectNodes.length > 0) {
        console.debug('# - select: ' + select);
        const sortContext = this.clone(selectNodes[0], { position: 0, nodeList: selectNodes });
        sortContext.sortNodes(stylesheetNode);

        $$(sortContext.nodeList).forEach((node, i) => {
          sortContext.clone(node, { position: i }).processChildNodes(stylesheetNode, outputNode);
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltFunction (
    stylesheetNode,
    outputNode
  ) {
    // Do nothing - the function resolver will handle this
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltIf
   * @instance
   * @implements <xsl:if>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltIf (
    stylesheetNode,
    outputNode
  ) {
    const test = $$(stylesheetNode).getAttribute('test');
    if (test && this.xsltTest(stylesheetNode, test)) {
      console.debug('# - test: ' + test);
      this.processChildNodes(stylesheetNode, outputNode);
    } else {
      console.debug('# - no match');
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltInclude
   * @instance
   * @implements <xsl:include>
   * @param {Node} stylesheetNode - The node being evaluated.
   */
  async xsltInclude (
    stylesheetNode
  ) {
    if (!stylesheetNode.hasAttribute('href')) {
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

    let url = stylesheetNode.getAttribute('href');
    if ((/^\./).test(url) && this.stylesheetURL) {
      url = this.stylesheetURL.replace(/[^/]+$/, '') + url.replace(/^\.\//, '');
    }

    try {
      stylesheetNode.removeAttribute('href'); // To prevent any infinite loops
      let response = await getHTTP(url);
      if (response.responseXML) {
        let responseXML = response.responseXML;
        const DOMParser = new XmlDOM.DOMParser();
        const responseDoc = DOMParser.parseFromString(responseXML);
        const fragmentNode = stylesheetNode.ownerDocument.createDocumentFragment();
        const includeNode = $$(fragmentNode).copyDeep(responseDoc.documentElement);
        if (stylesheetNode.localName === 'include') {
          while (includeNode.firstChild) {
            const childNode = includeNode.firstChild;
            includeNode.removeChild(childNode);
            stylesheetNode.parentNode.insertBefore(childNode, stylesheetNode);
          }
        } else {
          while (includeNode.firstChild) {
            const childNode = includeNode.firstChild;
            includeNode.removeChild(childNode);
            stylesheetNode.parentNode.appendChild(childNode);
          }
        }
        stylesheetNode.parentNode.removeChild(stylesheetNode);
        console.debug('# Resolved: ' + stylesheetNode.localName + ' -> ' + url);
      }
    } catch (exception) {}
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltImport
   * @instance
   * @implements <xsl:import>
   * @param {Node} stylesheetNode - The node being evaluated.
   */
  async xsltImport (
    stylesheetNode
  ) {
    // The xsltImport implementation will take care of the differences
    await this.xsltInclude(stylesheetNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltOutput
   * @instance
   * @implements <xsl:output>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltOutput (
    stylesheetNode,
    outputNode
  ) {
    XsltContext.output = {
      method: stylesheetNode.getAttribute('method'),
      version: stylesheetNode.getAttribute('version') || '1.0',
      encoding: stylesheetNode.getAttribute('encoding') || 'UTF-8',
      omitXmlDeclaration: stylesheetNode.getAttribute('omit-xml-declaration') || 'no',
      standalone: stylesheetNode.getAttribute('standalone') || 'no',
      indent: stylesheetNode.getAttribute('indent') || 'no',
      mediaType: stylesheetNode.getAttribute('media-type') || 'text/xml'
    };
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltParam
   * @instance
   * @implements <xsl:param>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   * @param {Object} [options={}] -
   */
  xsltParam (
    stylesheetNode,
    outputNode,
    options = {}
  ) {
    this.processVariable(stylesheetNode, { asText: true, value: options.parameter });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltProcessingInstruction
   * @instance
   * @implements <xsl:processing-instruction>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltProcessingInstruction (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const nameExpr = $$(stylesheetNode).getAttribute('name');
    const target = this.resolveExpression(stylesheetNode, nameExpr);

    const fragmentNode = stylesheetNode.ownerDocument.createDocumentFragment();
    this.processChildNodes(stylesheetNode, fragmentNode);
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltSort (
    stylesheetNode,
    outputNode
  ) {
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltStylesheet
   * @instance
   * @implements <xsl:stylesheet>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  async xsltStylesheet (
    stylesheetNode,
    outputNode
  ) {
    // Resolve all the imports and includes
    await this.processIncludes(stylesheetNode);
    console.debug('# --- All includes/imports processed ---');

    this.processChildNodes(stylesheetNode, outputNode, { ignoreText: true });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltTransform
   * @instance
   * @implements <xsl:transform>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltTransform (
    stylesheetNode,
    outputNode
  ) {
    this.xsltStylesheet(stylesheetNode, outputNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltTemplate
   * @instance
   * @implements <xsl:template>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltTemplate (
    stylesheetNode,
    outputNode
  ) {
    const match = $$(stylesheetNode).getAttribute('match');
    const mode = $$(stylesheetNode).getAttribute('mode') || null;
    if (match && this.xsltMatch(stylesheetNode, match)) {
      if ((mode && mode === this.mode) || (!mode && !this.mode)) {
        console.debug('# - match: ' + match + ((mode) ? ' (mode=' + mode + ')' : ''));
        this.processChildNodes(stylesheetNode, outputNode);
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltText (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const text = stylesheetNode.textContent;
    const node = $$(outputDocument).createTextNode(text);
    outputNode.appendChild(node);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltValueOf
   * @instance
   * @implements <xsl:value-of>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltValueOf (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const select = $$(stylesheetNode).getAttribute('select');
    if (select) {
      const value = this.xsltSelect(stylesheetNode, select, XPath.XPathResult.STRING_TYPE);
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
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltVariable (
    stylesheetNode,
    outputNode
  ) {
    this.processVariable(stylesheetNode, { override: true, asText: true });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method xsltWithParam
   * @instance
   * @implements <xsl:with-param>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  xsltWithParam (
    stylesheetNode,
    outputNode
  ) {
    this.processVariable(stylesheetNode, { override: true, asText: true });
  }
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XsltContext = XsltContext;

// -----------------------------------------------------------------------------
