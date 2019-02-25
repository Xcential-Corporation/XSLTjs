/**
 * @file XPathNamespaceResolver.js - (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
/*
 * @class XPathNamespaceResolver
 * @classdesc Namespace Resolver for use with XPath.
 */
var XPathNamespaceResolver = class {

  /*
   * @constructor
   * @param {Node} stylesheetNode - The primary node to use to lookup the namespace
   */
  constructor (
    stylesheetNode
  ) {
    this.stylesheetNode = stylesheetNode;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * The primary resolution function.
   * @method getNamespace
   * @instance
   * @param {string} prefix - The prefix of the namespace to retrieve.
   * @param {Node} node - The secondary node to use to lookup the namespace
   * @returns {string}
   */
  getNamespace (
    prefix,
    node
  ) {
    return this.stylesheetNode.lookupNamespaceURI(prefix) || node.lookupNamespaceURI(prefix);
  }
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XPathNamespaceResolver = XPathNamespaceResolver;

// -----------------------------------------------------------------------------
