/**
 * @file XPathNamespaceResolver.js - (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
/*
 * @class XPathNamespaceResolver
 * @classdesc Namespace Resolver for use with XPath.
 */
var XPathNamespaceResolver = class {

  /*
   * @constructor
   * @param {Node} transformNode - The primary node to use to lookup the namespace
   */
  constructor (
    transformNode
  ) {
    this.transformNode = transformNode;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * The primary resolution function.
   * @method getNamespace
   * @instance
   * @param {string} prefix - The prefix of the namespace to retrieve.
   * @param {Node} [node=null] - The secondary node to use to lookup the namespace
   * @returns {string}
   */
  getNamespace (
    prefix,
    node = null
  ) {
    if (prefix === 'xsl') {
      return 'http://www.w3.org/1999/XSL/Transform';
    }

    return this.transformNode.lookupNamespaceURI(prefix) || ((node) ? node.lookupNamespaceURI(prefix) : undefined);
  }
};

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.XPathNamespaceResolver = XPathNamespaceResolver;

// ----------------------------------------------------------------------------
