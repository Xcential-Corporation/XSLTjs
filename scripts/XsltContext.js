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

const XPath = require('xpath');
const { $$ } = require('./XDomHelper');
const { Node } = require('./Node');
const { XPathNamespaceResolver } = require('./XPathNamespaceResolver');
const { XPathVariableResolver } = require('./XPathVariableResolver');
const { XPathFunctionResolver } = require('./XPathFunctionResolver');

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
      nodeList: options.nodelist || this.nodelist,
      variables: options.variables || this.variables,
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
    const parts = value.split('{');
    if (parts.length === 1) {
      return value;
    }

    let returnValue = '';
    for (const part of parts) {
      const rp = part.split('}');
      if (rp.length !== 2) {
        // first literal part of the value
        returnValue += part;
        continue;
      }

      let value = '';
      let xPath = rp[0];
      const namespaceResolver = new XPathNamespaceResolver(stylesheetNode);
      const variableResolver = new XPathVariableResolver(this);
      value = $$(this.node).select(xPath, namespaceResolver, variableResolver, XPath.XPathResult.STRING_TYPE);

      returnValue += value + rp[1];
    }

    return returnValue;
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
      const sortitem = {
        node,
        key: []
      };

      sort.forEach((sortItem) => {
        const namespaceResolver = new XPathNamespaceResolver(stylesheetNode);
        const variableResolver = new XPathVariableResolver(this);
        const nodes = $$(context.node).select(sortItem.select, namespaceResolver, variableResolver);

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

        sortitem.key.push({
          value: eValue,
          order: sortItem.order
        });
      });

      // Make the sort stable by adding a lowest priority sort by
      // id. This is very convenient and furthermore required by the
      // spec ([XSLT] - Section 10 Sorting).
      sortitem.key.push({
        value: i,
        order: 'ascending'
      });

      sortList.push(sortitem);
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

    this.nodelist = nodes;
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
   *   and use .asText to force the variable to be store as a string.
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
    let value;

    if (stylesheetNode.childNodes.length > 0) {
      const fragmentNode = stylesheetNode.ownerDocument.createDocumentFragment();
      this.processChildNodes(stylesheetNode, fragmentNode);
      value = fragmentNode;
    } else if (select) {
      value = this.select(stylesheetNode, select);
    } else {
      value = this.variables[name] || '';
    }

    if (override || !this.getVariable(name)) {
      value = (asText && value instanceof Array) ? $$(value).textContent : value;
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
    outputNode
  ) {
    // Clone input context to keep variables declared here local to the
    // siblings of the children.
    const context = this.clone();
    $$(stylesheetNode.childNodes).forEach((childStylesheetNode) => {
      switch (childStylesheetNode.nodeType) {
        case Node.ELEMENT_NODE: {
          context.process(childStylesheetNode, outputNode);
          break;
        }
        case Node.TEXT_NODE: {
          const text = childStylesheetNode.nodeValue;
          const node = $$(outputNode.ownerDocument).createTextNode(text);
          outputNode.appendChild(node);
          break;
        }
      }
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * The main entry point of the XSLT processor, as explained above.
   * @method process
   * @instance
   * @param stylesheetNode - The stylesheet document root, as a DOM node.
   * @param outputNode - The root of the generated output, as a DOM node.
   */
  process (
    stylesheetNode,
    outputNode
  ) {
    const namespaceURI = stylesheetNode.namespaceURI;
    const localName = stylesheetNode.localName;

    if (namespaceURI !== 'http://www.w3.org/1999/XSL/Transform') {
      this.passThrough(stylesheetNode, outputNode);
    } else {
      const functionName = localName.replace(/-[a-z]/i, (match) => match[1].toUpperCase());
      if (this[functionName]) {
        this[functionName](stylesheetNode, outputNode);
      } else {
        throw new Error(`not implemented: ${localName}`);
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // XSL Attribute & Element implementations
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method match
   * @instance
   * @implements @match
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {string} match - The expression to evaluate
   */
  match (
    stylesheetNode,
    match
  ) {
    let node = this.node;
    while (node) {
      const namespaceResolver = new XPathNamespaceResolver(stylesheetNode);
      const variableResolver = new XPathVariableResolver(this);
      const matchNodes = $$(node).select(match, namespaceResolver, variableResolver);
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
   * @method text
   * @instance
   * @implements @test
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {string} text - The expression to evaluate.
   */
  test (
    stylesheetNode,
    test
  ) {
    let returnValue = false;

    const namespaceResolver = new XPathNamespaceResolver(stylesheetNode);
    const variableResolver = new XPathVariableResolver(this);
    returnValue = $$(this.node).select(test, namespaceResolver, variableResolver, XPath.XPathResult.BOOLEAN_TYPE);

    return returnValue;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method select
   * @instance
   * @implements @select
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} select - The expression to evaluate.
   * @param {XPath.XPathResult} [type=undefined] - The type of result to return.
   */
  select (
    stylesheetNode,
    select,
    type = undefined
  ) {
    const namespaceResolver = new XPathNamespaceResolver(stylesheetNode);
    const variableResolver = new XPathVariableResolver(this);
    const value = $$(this.node).select(select, namespaceResolver, variableResolver, type);

    return value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method applyTemplates
   * @instance
   * @implements <xsl:apply-templates>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  applyTemplates (
    stylesheetNode,
    outputNode
  ) {
    const select = $$(stylesheetNode).getAttribute('select');
    const nodes = (select) ? this.select(stylesheetNode, select) : this.node.childNodes;

    const sortContext = this.clone(nodes[0], { position: 0, nodeList: nodes });
    sortContext.withParam(stylesheetNode);
    sortContext.sortNodes(stylesheetNode);

    const mode = $$(stylesheetNode).getAttribute('mode');
    const stylesheetRoot = stylesheetNode.ownerDocument.documentElement;
    let modeTemplateNodes = [];
    $$(stylesheetRoot.childNodes).forEach((childNode) => {
      if ($$(childNode).isA('xsl:template') &&
          (!mode || $$(childNode).getAttribute('mode') === mode)) {
        modeTemplateNodes.push(childNode);
      }
    });

    sortContext.nodeList.forEach((contextNode, j) => {
      modeTemplateNodes.forEach((modeTemplateNode) => {
        sortContext.clone(contextNode, { position: j, mode: mode }).process(modeTemplateNode, outputNode);
      });
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method attribute
   * @instance
   * @implements <xsl:attribute>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  attribute (
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
   * @method callTemplate
   * @instance
   * @implements <xsl:call-template>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  callTemplate (
    stylesheetNode,
    outputNode
  ) {
    const name = $$(stylesheetNode).getAttribute('name');
    const stylesheetRoot = stylesheetNode.ownerDocument.documentElement;
    const paramContext = this.clone();

    paramContext.withParam(stylesheetNode);
    $$(stylesheetRoot.childNodes).forEach((childNode) => {
      if ($$(childNode).isA('xsl:template') &&
          $$(childNode).getAttribute('name') === name) {
        paramContext.processChildNodes(childNode, outputNode);
        return true;
      }
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method choose
   * @instance
   * @implements <xsl:choose> (and <xsl:when> and <xsl:otherwise>)
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  choose (
    stylesheetNode,
    outputNode
  ) {
    $$(stylesheetNode.childNodes).forEach((childNode) => {
      if (childNode.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      if ($$(childNode).isA('xsl:when')) {
        const test = $$(childNode).getAttribute('test');
        if (test && this.test(stylesheetNode, test)) {
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
   * @method comment
   * @instance
   * @implements <xsl:comment>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  comment (
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
   * @method copy
   * @instance
   * @implements <xsl:copy>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  copy (
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
   * @method copyOf
   * @instance
   * @implements <xsl:copy-of>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  copyOf (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const select = $$(stylesheetNode).getAttribute('select');
    if (select) {
      const nodes = this.select(stylesheetNode, select);
      if (nodes.length > 1) {
        nodes.forEach((node) => {
          $$(outputNode).copyOf(node);
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
   * @method decimalFormat
   * @instance
   * @implements <xsl:decimal-format>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  decimalFormat (
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
   * @method element
   * @instance
   * @implements <xsl:element>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  element (
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
   * @method forEach
   * @instance
   * @implements <xsl:for-each>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  forEach (
    stylesheetNode,
    outputNode
  ) {
    const select = $$(stylesheetNode).getAttribute('select');
    if (select) {
      const selectNodes = this.select(stylesheetNode, select);
      if (selectNodes.length > 0) {
        const sortContext = this.clone(selectNodes[0], { position: 0, nodeList: selectNodes });
        sortContext.sortNodes(stylesheetNode);
        sortContext.nodeList.forEach((node, i) => {
          sortContext.clone(node, { position: i }).processChildNodes(stylesheetNode, outputNode);
        });
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method if
   * @instance
   * @implements <xsl:if>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  if (
    stylesheetNode,
    outputNode
  ) {
    const test = $$(stylesheetNode).getAttribute('test');
    if (test && this.test(stylesheetNode, test)) {
      this.processChildNodes(stylesheetNode, outputNode);
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method output
   * @instance
   * @implements <xsl:output>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  output (
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
   * @method param
   * @instance
   * @implements <xsl:param>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  param (
    stylesheetNode,
    outputNode
  ) {
    this.processVariable(stylesheetNode, { asText: true });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method processingInstruction
   * @instance
   * @implements <xsl:processing-instruction>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  processingInstruction (
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
   * @method sort
   * @instance
   * @implements <xsl:sort>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  sort (
    stylesheetNode,
    outputNode
  ) {
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method stylesheet
   * @instance
   * @implements <xsl:stylesheet>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  stylesheet (
    stylesheetNode,
    outputNode
  ) {
    this.processChildNodes(stylesheetNode, outputNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method transform
   * @instance
   * @implements <xsl:transform>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  transform (
    stylesheetNode,
    outputNode
  ) {
    this.processChildNodes(stylesheetNode, outputNode);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method template
   * @instance
   * @implements <xsl:template>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  template (
    stylesheetNode,
    outputNode
  ) {
    const match = $$(stylesheetNode).getAttribute('match');
    const mode = $$(stylesheetNode).getAttribute('mode') || null;
    if (match && this.match(stylesheetNode, match)) {
      if ((mode && mode === this.mode) || (!mode && !this.mode)) {
        this.processChildNodes(stylesheetNode, outputNode);
      }
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method text
   * @instance
   * @implements <xsl:text>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  text (
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
   * @method valueOf
   * @instance
   * @implements <xsl:value-of>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  valueOf (
    stylesheetNode,
    outputNode
  ) {
    const outputDocument = outputNode.ownerDocument;
    const select = $$(stylesheetNode).getAttribute('select');
    if (select) {
      const value = this.select(stylesheetNode, select, XPath.XPathResult.STRING_TYPE);
      const node = $$(outputDocument).createTextNode(value);
      outputNode.appendChild(node);
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method variable
   * @instance
   * @implements <xsl:variable>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  variable (
    stylesheetNode,
    outputNode
  ) {
    this.processVariable(stylesheetNode, { override: true, asText: true });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method withParam
   * @instance
   * @implements <xsl:with-param>
   * @param {Node} stylesheetNode - The node being evaluated.
   * @param {Node} outputNode - The document to apply the results to.
   */
  withParam (
    stylesheetNode,
    outputNode
  ) {
    $$(stylesheetNode.childNodes).forEach((childNode) => {
      if ($$(childNode).isA('xsl:with-param')) {
        this.processVariable(childNode, { override: true, asText: true });
      }
    });
  }
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XsltContext = XsltContext;

// -----------------------------------------------------------------------------
