/**
 * @file DomHelper.js - DOM helper wrapper (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports
// ----------------------------------------------------------------------------

const XPath = require('xpath');
const HE = require('he');
const { Node } = require('./Node');
const { Utils } = require('./Utils');
const { XsltLog } = require('./XsltLog');

// ----------------------------------------------------------------------------
/*
 * @class XDomHelper
 * @classdesc A wrapper class that provides helper functions for DOM documents,
 *   nodes, or nodeLists.
 */
var XDomHelper = class {
  /*
   * @constructor
   * @param {Document|Node|NodeList} item -- The document, node, or nodeList to
   *   be wrapped in order to access the helper methods.
   */
  constructor (
    item
  ) {
    const _document = (item.createElement) ? item : null;
    const _node = (item.nodeType || item.isXPathNamespace) ? item : null; // instanceof isn't working (2/20/2019)
    const _nodeList = (item.length !== undefined && !item.nodeType) ? item : null;

    Object.defineProperty(this, 'document', {
      get: () => _document
    });

    Object.defineProperty(this, 'node', {
      get: () => _node
    });

    Object.defineProperty(this, 'nodeList', {
      get: () => _nodeList
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Tests is an element is an instance of a specified qualified name. The 'xsl'
   * prefix is special-cased to allow tests even when a different namespace
   * prefix is declared.
   * @method isA
   * @memberOf XDomHelper
   * @instance
   * @param {string|Array} qNameOrArray - The qualified name or an array of names
   *   to test against.
   * @param {Object} [options={}] - Use the options to specify a namespaceURI
   *   to use.
   * @returns {boolean}
   */
  isA (
    qNameOrArray,
    options = {}
  ) {
    if (this.node.nodeType === Node.ELEMENT_NODE) {
      const thisNamespaceURI = this.node.namespaceURI;
      const thisLocalName = (this.node.localName || this.node.nodeName).replace(/^.*:/, '');

      const qNames = (typeof qNameOrArray === 'string') ? [qNameOrArray] : qNameOrArray;
      for (let qName of qNames) {
        const invert = (/^\^/).test(qName);
        qName = (invert) ? qName.substr(1) : qName;
        const prefix = (/:/).test(qName) ? qName.replace(/:.*$/, '') : null;
        const localName = (/:/).test(qName) ? qName.replace(/^.*?:/, '') : qName;
        const namespaceURI = ((options.namespaceURI) ? options.namespaceURI
          : (options.namespaceResolver) ? options.namespaceResolver.getNamespace(prefix, this.node)
            : this.node.lookupNamespaceURI(prefix)) || undefined;

        if (invert) {
          if (thisNamespaceURI !== namespaceURI || thisLocalName !== localName) {
            return true;
          }
        } else {
          if (thisNamespaceURI === namespaceURI && thisLocalName === localName) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Tests is an element has a child of a specified qualified name. The 'xsl'
   * prefix is special-cased to allow tests even when a different namespace
   * prefix is declared.
   * @method isA
   * @memberOf XDomHelper
   * @instance
   * @param {string|Array} qNameOrArray - The qualified name or an array of names
   *   to test against.
   * @param {Object} [options={}] - Use the options to specify a namespaceURI
   *   to use.
   * @returns {boolean}
   */
  hasChild (
    qNameOrArray,
    options = {}
  ) {
    if (this.node.nodeType != Node.ELEMENT_NODE) {
      for (const childNode of this.node.childNodes) {
        if (childNode.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }
        if ($$(childNode).isA(qNameOrArray, options)) {
          return true;
        }
      }
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Wrapper function to access attribute values of template element
   * nodes. Currently this calls HE.decode because in some DOM
   * implementations the return value of node.getAttribute()
   * contains unresolved XML entities, although the DOM spec requires
   * that entity references are resolved by the DOM.
   * @method getAttribute
   * @instance
   * @param {string} name - The name of the attribute to retrieve.
   * @returns {string|undefined}
   */
  getAttribute (
    name
  ) {
    // TODO(meschkat): This should not be necessary if the DOM is working
    // correctly. The DOM is responsible for resolving entities, not the
    // application.
    const value = this.node.getAttribute(name);

    return (value) ? HE.decode(value) : value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Wrapper property to access retrieve a prior element sibling
   * @property previousElementSibling
   * @instance
   * @type {Element|null}
   */
  get previousElementSibling () {
    if (this.node) {
      let previousSibling = this.node.previousSibling;
      while (previousSibling) {
        if (previousSibling.nodeType === Node.ELEMENT_NODE) {
          return previousSibling;
        }
        previousSibling = previousSibling.previousSibling;
      }
    }

    return null;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Wrapper property to access retrieve a prior element sibling
   * @property nextElementSibling
   * @instance
   * @type {Element|null}
   */
  get nextElementSibling () {
    if (this.node) {
      let nextSibling = this.node.nextSibling;
      while (nextSibling) {
        if (nextSibling.nodeType === Node.ELEMENT_NODE) {
          return nextSibling;
        }
        nextSibling = nextSibling.nextSibling;
      }
    }

    return null;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Returns the namespaceURI
   * @param {string} qName - The name of the element
   */
  getNamespaceURI (
    qName
  ) {
    return (this.lookupNamespaceURI) ? this.lookupNamespaceURI((/:/).test(qName) ? qName.replace(/:.*/, '') : '') : null;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Create an element for the source document with the specified qName
   * @method createElement
   * @instance
   * @param name - The name of the element to create.
   * @returns {Node}
   */
  createElement (
    name
  ) {
    return this.document.createElement(name);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Create an element for the source document with the specified qName
   * @method createElementNS
   * @instance
   * @param [namespaceURI] - the namespaceURI
   * @param name - The name of the element to create.
   * @returns {Node}
   */
  createElementNS (
    namespaceURI = null,
    name
  ) {
    return (namespaceURI) ? this.document.createElementNS(namespaceURI, name) : this.document.createElement(name);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Create an text node for the source document with the specified text value.
   * @method createTextNode
   * @instance
   * @param {string} [text=''] - Text value to assign.
   * @returns {Node}
   */
  createTextNode (
    text = ''
  ) {
    text = String(text);
    // text = text.replace(/^\s+|\s(?=\s+)|\s+$/g, '');
    text = text.replace(/ +/g, ' ');
    // text = text.replace(/^(false)$/i, '__' + '$1' + '__');

    const outputDocument = this.document;
    const node = outputDocument.createTextNode(text);

    return node;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Create a processing instruction for the source document with the
   * specified target and data
   * @method createProcessingInstruction
   * @instance
   * @param {string} target - Target name is assign.
   * @param {string} [data=''] - Data to assign.
   * @returns {Node}
   */
  createProcessingInstruction (
    target,
    data = ''
  ) {
    const outputDocument = this.document;
    const node = outputDocument.createProcessingInstruction(target, data);

    return node;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /* NodeList wrapper to allow forEach construct (i.e. ES2015-style) to be
   * used. The looping will terminate if the callback returns a true.
   * @method forEach
   * @instance
   * @param {Function} callback - Function to call on each iteration.
   * @returns {boolean} - true if any callback returns true
   */
  forEach (
    callback,
    options = {}
  ) {
    if (!options.reverseOrder) {
      for (let i = 0; i < this.nodeList.length; i++) {
        const nodeItem = this.nodeList[i];
        const returnValue = callback(nodeItem, i);
        if (returnValue === true) {
          return true; // Return true whenever a callback returns true
        }
      }
    } else {
      for (let i = this.nodeList.length - 1; i >= 0; i--) {
        const nodeItem = this.nodeList[i];
        const returnValue = callback(nodeItem, i);
        if (returnValue === true) {
          return true; // Return true whenever a callback returns true
        }
      }
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /* Asynchronous nodeList wrapper to allow forEach construct
   * (i.e. ES2015-style) to be used. The looping will terminate if the
   * callback returns a true.
   * @method forEachAsync
   * @instance
   * @param {Function} callback - Function to call on each iteration.
   * @returns {boolean} - true if any callback returns true
   */
  async forEachAsync (
    callback,
    options = {}
  ) {
    if (!options.reverseOrder) {
      for (let i = 0; i < this.nodeList.length; i++) {
        const nodeItem = this.nodeList[i];
        const returnValue = await callback(nodeItem, i);
        if (returnValue === true) {
          return true; // Return true whenever a callback returns true
        }
      }
    } else {
      for (let i = this.nodeList.length - 1; i >= 0; i--) {
        const nodeItem = this.nodeList[i];
        const returnValue = await callback(nodeItem, i);
        if (returnValue === true) {
          return true; // Return true whenever a callback returns true
        }
      }
    }

    return false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Copies the specified node into this document. The source and the
   * destination nodes do not need to be in the same document.
   * @method copy
   * @instance
   * @param {Node} srcNode - The node to copy.
   * @returns {Node} - Returns the node created.
   */
  copy (
    srcNode
  ) {
    const destNode = this.node;
    const destDocument = (destNode.nodeType === Node.DOCUMENT_NODE) ? destNode : destNode.ownerDocument;

    let node;
    switch (srcNode.nodeType) {
      case Node.DOCUMENT_NODE: {
        node = destNode;
        break;
      }
      case Node.ELEMENT_NODE: {
        const qName = srcNode.nodeName;
        const namespaceURI = srcNode.namespaceURI;
        if (namespaceURI) {
          node = $$(destDocument).createElementNS(namespaceURI, qName);
        } else {
          node = $$(destDocument).createElement(qName);
        }
        destNode.appendChild(node);
        break;
      }
      case Node.ATTRIBUTE_NODE: {
        if (!srcNode.nodeName.startsWith('xmlns')) {
          const namespaceURI = srcNode.namespaceURI;
          if (namespaceURI) {
            destNode.setAttributeNS(namespaceURI, srcNode.nodeName, srcNode.nodeValue);
          } else {
            destNode.setAttribute(srcNode.nodeName, srcNode.nodeValue);
          }
          node = destNode.attributes.getNamedItem(srcNode.nodeName);
        }
        break;
      }
      case Node.TEXT_NODE: {
        const text = $$(srcNode).textContent;
        node = $$(destDocument).createTextNode(text);
        destNode.appendChild(node);
        break;
      }
      case Node.CDATA_SECTION_NODE: {
        node = destDocument.createCDATASection(srcNode.nodeValue);
        destNode.appendChild(node);
        break;
      }
      case Node.COMMENT_NODE: {
        node = destDocument.createComment(srcNode.nodeValue);
        destNode.appendChild(node);
        break;
      }
      case Node.PROCESSING_INSTRUCTION_NODE: {
        node = destDocument.createProcessingInstruction(srcNode.target, srcNode.nodeValue);
        destNode.appendChild(node);
        break;
      }
    }

    return node;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Deep copy of the specified node. The source node and the destination node
   * do not need to be in the same document.
   * @method copyDeep
   * @instance
   * @param {Node} srcNode - The node to deep copy.
   * @returns {Node} - Returns the node created. (or the last root level
   *   node creates when copying a fragment)
   */
  copyDeep (
    srcNode
  ) {
    const destNode = this.node;

    let returnNode;
    if (srcNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
      srcNode.nodeType === Node.DOCUMENT_NODE) {
      $$(srcNode.childNodes).forEach((childNode) => {
        if (childNode.nodeType === Node.ELEMENT_NODE) {
          returnNode = $$(destNode).copyDeep(childNode); // The last childNode will be returned
        }
      });
    } else {
      returnNode = $$(destNode).copy(srcNode);
      if (returnNode) {
        // This was an element node -- recurse to attributes and
        // children.
        if (srcNode.attributes) {
          $$(srcNode.attributes).forEach((attribute) => {
            $$(returnNode).copy(attribute);
          });
        }

        if (srcNode.childNodes) {
          $$(srcNode.childNodes).forEach((childNode) => {
            $$(returnNode).copyDeep(childNode);
          });
        }
      }
    }

    return returnNode;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Computes the text value of this node or this node list
   * @property textContent
   * @instance
   * @read-only
   * @returns {string}
   */
  get textContent () {
    const node = this.node;
    const nodes = this.nodeList;
    let value = '';

    if (node) {
      value = node.textContent;
    } else if (nodes) {
      $$(nodes).forEach((node) => {
        value += node.textContent;
      });
    }

    return value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Bind the XPath processor to this node and selects the specified xPath.
   * @method select
   * @instance
   * @param {string} xPath - The xPath expression to evaluate.
   * @options {object} - Various selection settings. Specify the
   *   namespaceResolver, variableResolver, functionResolver, and return
   *   type (XPath.XPathResult) as options.
   */
  select (
    xPath,
    context,
    options = {}
  ) {
    const type = (options.type !== undefined) ? options.type : XPath.XPathResult.ANY_TYPE;

    // Look for a shortcut
    if (type === XPath.XPathResult.ANY_TYPE && (/^(?:[a-zA-Z0-9\-_]+:)?[a-zA-Z0-9\-_]+$/).test(xPath)) {
      const shortcutTest = () => {
        const nodes = [];
        if ([Node.ELEMENT_NODE, Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(this.node.nodeType)) {
          for (let i = 0; i < this.node.childNodes.length; i++) {
            const childNode = this.node.childNodes[i];
            if ($$(childNode).isA(xPath, { namespaceResolver: context.namespaceResolver })) {
              nodes.push(childNode);
            }
          }
        }

        return nodes;
      };

      return (XsltLog.debugMode) ? Utils.measure('xPath shortcut', shortcutTest) : shortcutTest(context, options);
    }

    // Handle

    const xPathExpr = XPath.createExpression(xPath);
    context.functionResolver = (context.functionResolver) ? context.functionResolver.chain(xPathExpr.context.functionResolver) : xPathExpr.context.functionResolver;
    xPathExpr.context = context;

    // This is a workaround for an apparent bug in the XPath processor.
    // When computing the result set for the namespaces, an error is
    // reported that the order cannot be determined. The workaround
    // is to circumvent that problem by returning the node set prior
    // to the ordering part that fails
    if ((/namespace::/).test(xPath)) {
      xPathExpr.context.expressionContextNode = this.node;
      xPathExpr.context.caseInsensitive = false;
      const result = (XsltLog.debugMode) ? Utils.measure('xPath', () => {
        return xPathExpr.xpath.evaluate(xPathExpr.context);
      }) : xPathExpr.xpath.evaluate(xPathExpr.context);
      return result.nodes;
    }

    // let xPathTest = () => xPathExpr.evaluate(this.node, type);
    xPathExpr.context.contextNode = this.node;
    xPathExpr.context.expressionContextNode = this.node;
    xPathExpr.context.contextSize = xPathExpr.context.nodeList.length;
    const xPathTest = () => new XPath.XPathResult(xPathExpr.xpath.expression.evaluate(xPathExpr.context), type);
    const result = (XsltLog.debugMode) ? Utils.measure('xPath', xPathTest) : xPathTest();

    switch (result.resultType) {
      case XPath.XPathResult.STRING_TYPE: {
        return result.stringValue;
      }
      case XPath.XPathResult.NUMBER_TYPE: {
        return result.numberValue;
      }
      case XPath.XPathResult.BOOLEAN_TYPE: {
        return result.booleanValue;
      }
      default: {
        const nodes = [];
        let node = result.iterateNext();
        while (node) {
          nodes.push(node);
          node = result.iterateNext();
        }
        return nodes;
      }
    }
  }
};

const $$ = (item) => new XDomHelper(item);

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.XDomHelper = XDomHelper;
exports.$$ = $$;

// ----------------------------------------------------------------------------
