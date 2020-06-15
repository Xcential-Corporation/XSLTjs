/**
 * @file XPathFunctionResolver.js - (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports
// ----------------------------------------------------------------------------

const XPath = require('xpath');
const { XPathFunctions } = require('./XPathFunctions');

// ----------------------------------------------------------------------------
/*
 * @class XPathFunctionResolver
 * @classDesc A function resolver to be used by the XPath processor. This
 *   resolver implements XSLT specific XPath functions.
 */
var XPathFunctionResolver = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @constructor
   * @param {Node} transformNode - The primary node used to find the document
   *   containing any custom functions.
   * @param {XsltContext} - The XSLT Context object holding the variables to
   *   be made available to the XPath processor.
   */
  constructor (
    transformNode,
    context
  ) {
    this.transformNode = transformNode;
    this.context = context;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Chains another function resolver to be used with this one in a search
   * chain.
   * @method chain
   * @instance
   * @param {Function} [functionResolver=null] - Another function resolver to be
   *   used in a chain.
   * @returns {Object} - this.
   */
  chain (
    functionResolver
  ) {
    this.functionResolver = functionResolver;

    return this;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * The function resolution function called by the XPath processor.
   * @method getFunction
   * @instance
   * @param {string} localName - the name of the function
   * @param {string} [namespaceURI]
   * @returns {Function|undefined}
   */
  getFunction (
    localName,
    namespaceURI = ''
  ) {
    if (namespaceURI === '') {
      switch (localName) {
        case 'function-available':
          return XPathFunctions.functionAvailable;
        case 'current':
          return XPathFunctions.current;
        case 'document':
          return XPathFunctions.document;
        case 'format-number':
          return XPathFunctions.formatNumber;
        case 'replace':
          return XPathFunctions.replace;
        case 'lower-case':
          return XPathFunctions.lowerCase;
        case 'upper-case':
          return XPathFunctions.upperCase;
        case 'matches':
          return XPathFunctions.matches;
        case 'generate-id':
          return XPathFunctions.generateId;
        default:
          return (this.functionResolver) ? this.functionResolver.getFunction(localName, namespaceURI) : undefined;
      }
    }

    if (this.context.customFunctions && this.context.customFunctions[namespaceURI][localName]) {
      this.XPath = XPath; // So we can create a result
      return this.context.customFunctions[namespaceURI][localName].bind(this);
    }

    if (this.functionResolver) {
      const fcn = this.functionResolver.getFunction(localName, namespaceURI);
      if (fcn) {
        return fcn;
      }
    }

    if (this.transformNode) {
      const customFcnNode = this.context.findNamedNode(this.transformNode, localName, {
        filter: 'xsl:function',
        namespaceURI: namespaceURI
      });
      if (customFcnNode) {
        return this.customFunction.bind(new XPathFunctionResolver(customFcnNode, this.context.clone()));
      }
    }

    return undefined;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method customFunction
   * @instance
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr} [nodeSetExpr=null] - The node set to be used to
   *   seed the id generation algorithm. When used, the algorithm will always
   *   generate the same id for the same set of nodes. This is only guaranteed
   *   in the current execution session, not between sessions.
   * @returns {XPath.XString}
   */
  customFunction (
    xPathContext,
    ...parameters
  ) {
    const fragmentNode = this.transformNode.ownerDocument.createDocumentFragment();
    const customFcnNode = this.transformNode;
    parameters.forEach((parameterExpr, i) => {
      const parameter = (parameterExpr && typeof parameterExpr === 'object' && parameterExpr.evaluate) ? parameterExpr.evaluate(xPathContext) : parameterExpr;
      parameters[i] = (parameter && parameter.stringValue) ? parameter.stringValue() : parameter;
    });
    this.context.processChildNodes(customFcnNode, fragmentNode, { parameters: parameters });

    return new XPath.XString(fragmentNode.textContent);
  }
};

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.XPathFunctionResolver = XPathFunctionResolver;

// ----------------------------------------------------------------------------
