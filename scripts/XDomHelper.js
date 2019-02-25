/**
 * @file DomHelper.js - DOM helper wrapper (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

const XPath = require('xpath');
const HE = require('he');
const { XPathFunctionResolver } = require('./XPathVariableResolver');
const { XsltContext } = require('./XsltContext');

const Node = window.Node;

// -----------------------------------------------------------------------------
/*
 * @class XDomHelper
 * @classdesc A wrapper class that provides helper functions for DOM documents,
 *   nodes, or nodeLists.
 */
var $ = (nodeOrList) => new class {

  /*
   * @constructor
   * @param {Document|Node|NodeList} item -- The document, node, or nodeList to
   *   be wrapped in order to access the helper methods.
   */
  constructor (
    item
  ) {
    let _document = (item).createElement ? item : null;
    let _node = (item.nodeType) ? item : null; // instanceof isn't working (2/20/2019)
    let _nodeList = (item.length !== undefined && !item.nodeType) ? item : null;

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
   * @param {string} qName - The qualified name to test against.
   * @returns {boolean}
   */
  isA (
    qName
  ) {
    if (this.node.nodeType === Node.ELEMENT_NODE) {
      const prefix = (/:/).test(qName) ? qName.replace(/:.*$/, '') : null;
      const localName = (/:/).test(qName) ? qName.replace(/^.*?:/, '') : qName;
      const namespaceURI = (prefix === 'xsl') ? XsltContext.NAMESPACE_URI : this.node.lookupNamespaceURI(prefix);

      if (this.node.namespaceURI === namespaceURI && this.node.localName === localName) {
        return true;
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
   * Create an element for the source document with the specified qName
   * @method createElement
   * @instance
   * @param qName - The name of the element to create.
   * @param {Node} [contextNode=null] - Node to lookup the namespace URI. If not
   *   specified, a null namespace is used.
   * @returns {Node}
   */
  createElement (
    qName,
    contextNode = null
  ) {
    const outputDocument = this.document;
    const namespaceURI = (contextNode) ? contextNode.lookupNamespaceURI((/:/).test(qName) ? qName.replace(/:.*/, '') : '') : null;
    const node = (namespaceURI) ? outputDocument.createElementNS(namespaceURI, qName) : outputDocument.createElement(qName);

    return node;
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
    // text = text.replace(/^\s*|\s(?=\s*)|\s*$/g, '');
    text = text.replace(/ +/g, ' ');

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
   */
  forEach (
    callback
  ) {
    for (let i = 0; i < this.nodeList.length; i++) {
      const nodeItem = this.nodeList[i];
      if (callback(nodeItem, i)) {
        break; // Break whenever a callback returns true
      }
    }
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
    const destDocument = destNode.ownerDocument;

    switch (srcNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const qName = srcNode.nodeName;
        const node = $(destDocument).createElement(qName, srcNode);
        destNode.appendChild(node);
        return node;
      }
      case Node.TEXT_NODE: {
        const text = srcNode.nodeValue;
        const node = $(destDocument).createTextNode(text);
        destNode.appendChild(node);
        break;
      }
      case Node.CDATA_SECTION_NODE: {
        const node = destDocument.createCDATASection(srcNode.nodeValue);
        destNode.appendChild(node);
        break;
      }
      case Node.COMMENT_NODE: {
        const node = destDocument.createComment(srcNode.nodeValue);
        destNode.appendChild(node);
        break;
      }
      case Node.PROCESSING_INSTRUCTION_NODE: {
        const node = destDocument.createProcessingInstruction(srcNode.nodeValue);
        destNode.appendChild(node);
        break;
      }
      case Node.ATTRIBUTE_NODE: {
        destNode.setAttribute(srcNode.nodeName, srcNode.nodeValue);
        break;
      }
    }

    return destNode;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Deep copy of the specified node. The source node and the destination node
   * do not need to be in the same document.
   * @method copyOf
   * @instance
   * @param {Node} srcNode - The node to deep copy.
   * @returns {Node} - Returns the node created.
   */
  copyOf (
    srcNode
  ) {
    const destNode = this.node;

    if (srcNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
      srcNode.nodeType === Node.DOCUMENT_NODE) {
      $(srcNode.childNodes).forEach((childNode) => {
        $(destNode).copyOf(childNode);
      });
    } else {
      const node = $(destNode).copy(srcNode);
      if (node) {
        // This was an element node -- recurse to attributes and
        // children.
        $(srcNode.attributes).forEach((attribute) => {
          $(node).copyOf(attribute);
        });

        $(srcNode.childNodes).forEach((childNode) => {
          $(node).copyOf(childNode);
        });
      }
    }
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
    let node = this.node;
    let nodes = this.nodeList;
    let value = '';

    if (node) {
      value = node.textContent;
    } else if (nodes) {
      $(nodes).forEach((node) => {
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
   * @param {Object} namespaceResolver - The object containing the namespace
   *   resolution method to use.
   * @param {Object} variableResolver - The object containing the variable
   *   resolution method to use.
   * @type {XPath.XPathResult} [type=XPath.XPathResult.ANY_TYPE] - The type
   *   of object to return.
   */
  select (
    xPath,
    namespaceResolver,
    variableResolver,
    type = XPath.XPathResult.ANY_TYPE
  ) {
    const xPathExpr = XPath.createExpression(xPath);
    xPathExpr.context.namespaceResolver = namespaceResolver;
    xPathExpr.context.variableResolver = variableResolver;
    xPathExpr.context.functionResolver = new XPathFunctionResolver(xPathExpr.context.functionResolver);
    const result = xPathExpr.evaluate(this.node, type);

    switch (result.resultType) {
      case XPath.XPathResult.STRING_TYPE: {
        return result.stringValue
          .replace(/^\s+/, '')
          .replace(/\s+$/, '')
          .replace(/\s+/, ' ');
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

}(nodeOrList);

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.$ = $;

// -----------------------------------------------------------------------------