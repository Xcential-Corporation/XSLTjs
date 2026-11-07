/**
 * @file Names.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const { XsltError } = require('./XsltError');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc Qualified names. Names are compared in expanded form, written
 *   "{namespace-uri}local-name". As XSLT 1.0 requires, an unprefixed name
 *   in a stylesheet attribute is in no namespace; the default namespace is
 *   not used.
 */
const Names = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static XML_NS = 'http://www.w3.org/XML/1998/namespace';
  static XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

  static NCNAME = /^[\p{L}_][\p{L}\p{N}\p{M}._\-\u00B7\u203F-\u2040]*$/u;

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static isNCName (
    name
  ) {
    return typeof name === 'string' && Names.NCNAME.test(name);
  }

  static isQName (
    name
  ) {
    if (typeof name !== 'string') {
      return false;
    }
    const parts = name.split(':');
    return parts.length <= 2 && parts.every((p) => Names.isNCName(p));
  }

  /**
   * The expanded key for a namespace URI and local name.
   */
  static key (
    namespaceURI,
    localName
  ) {
    return '{' + (namespaceURI || '') + '}' + localName;
  }

  /**
   * A key shown as a name, for messages.
   */
  static display (
    key
  ) {
    return key.replace(/^\{\}/, '');
  }

  /**
   * Looks up the namespace bound to a prefix on a stylesheet element.
   * @param {Element} element - The element.
   * @param {string|null} prefix - The prefix, or null for the default namespace.
   * @returns {string|null} The namespace URI, or null if the prefix is not bound.
   */
  static lookup (
    element,
    prefix
  ) {
    if (prefix === 'xml') {
      return Names.XML_NS;
    }
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      const name = prefix ? 'xmlns:' + prefix : 'xmlns';
      const attribute = e.getAttributeNode(name);
      if (attribute) {
        return attribute.value || (prefix ? null : '');
      }
    }
    return prefix ? null : '';
  }

  /**
   * Expands a QName written in a stylesheet attribute.
   * @param {string} qname - The name, such as "xyz:mode".
   * @param {Element} [element] - The element whose namespaces apply.
   * @returns {string} The expanded key.
   */
  static expand (
    qname,
    element = null
  ) {
    if (qname === null || qname === undefined) {
      throw new XsltError('XTSE0010', 'Missing name', element);
    }
    qname = qname.trim();
    if (qname.startsWith('{')) {
      return qname;
    }
    const colon = qname.indexOf(':');
    if (colon < 0) {
      return '{}' + qname;
    }
    const prefix = qname.slice(0, colon);
    const uri = element ? Names.lookup(element, prefix) : null;
    if (uri === null) {
      throw new XsltError('XTSE0280', 'Undeclared namespace prefix in "' + qname + '"', element);
    }
    return '{' + uri + '}' + qname.slice(colon + 1);
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.Names = Names;

// ----------------------------------------------------------------------------
