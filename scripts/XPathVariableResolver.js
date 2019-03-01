/**
 * @file XPathVariableResolver.js - (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

const XPath = require('xpath');

// -----------------------------------------------------------------------------
/*
 * @class XPathVariableResolver
 * @classdesc Variable Resolver for use with XPath.
 */
var XPathVariableResolver = class {

  /*
   * @constructor
   * @param {Node} stylesheetNode - Currently unused.
   * @param {XsltContext} context - The XSLT Context object holding the variables to
   *   be made available to the XPath processor.
   */
  constructor (
    stylesheetNode = null,
    context
  ) {
    this.stylesheetNode = stylesheetNode;
    this.context = context;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * The primary resolution function.
   * @method getVariable
   * @instance
   * @param {string} name - The name of the variable to retrieve.
   * @return {XPath.XString}
   */
  getVariable (
    name
  ) {
    let value = this.context.getVariable(name) || '';

    return new XPath.XString(value);
  }
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XPathVariableResolver = XPathVariableResolver;

// -----------------------------------------------------------------------------
