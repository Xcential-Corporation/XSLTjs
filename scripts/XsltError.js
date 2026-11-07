/**
 * @file XsltError.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc An error raised while compiling or running a stylesheet. It
 *   carries an error code, in the style of the W3C error codes, and the
 *   stylesheet location where the error arose, when that is known.
 */
const XsltError = class extends Error {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance initialization
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * @param {string} code - An error code such as XTSE0010.
   * @param {string} message - What went wrong.
   * @param {Node} [node] - The stylesheet node where it went wrong.
   */
  constructor (
    code,
    message,
    node = null
  ) {
    const location = XsltError.locate(node);
    super(code + ': ' + message + (location ? ' (' + location + ')' : ''));
    this.name = 'XsltError';
    this.code = code;
    this.location = location;
    this.terminate = false;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Describes where a node is: its file and line, when the parser recorded them.
   * @param {Node} node - A stylesheet node.
   * @returns {string} The location, or an empty string.
   */
  static locate (
    node
  ) {
    if (!node) {
      return '';
    }
    let element = (node.nodeType === 2) ? node.ownerElement : node;
    while (element && element.lineNumber === undefined && element.parentNode) {
      element = element.parentNode;
    }
    const doc = (node.nodeType === 9) ? node : node.ownerDocument;
    const file = (doc && doc.xsltBaseURI) ? doc.xsltBaseURI.replace(/^.*\//, '') : '';
    const line = (element && element.lineNumber) ? 'line ' + element.lineNumber : '';
    return [file, line].filter(Boolean).join(', ');
  }

  /**
   * Wraps any error raised while evaluating an expression, keeping its message.
   * @param {Error} error - The original error.
   * @param {Node} node - The stylesheet node being evaluated.
   * @param {string} [code=XPDY0050] - The code to use if the error has none.
   * @returns {XsltError}
   */
  static wrap (
    error,
    node,
    code = 'XPTY0004'
  ) {
    if (error instanceof XsltError) {
      return error;
    }
    const wrapped = new XsltError(code, (error && error.message) || String(error), node);
    wrapped.cause = error;
    return wrapped;
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.XsltError = XsltError;

// ----------------------------------------------------------------------------
