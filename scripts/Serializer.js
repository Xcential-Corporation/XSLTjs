/**
 * @file Serializer.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const { Names } = require('./Names');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc Writes a result tree as text, following xsl:output: the xml,
 *   html and text methods, indentation, CDATA sections, the XML
 *   declaration and the document type declaration. Namespace declarations
 *   are written where they are needed, so every element and attribute is
 *   in the namespace it was given.
 */
const Serializer = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static HTML_EMPTY = new Set(['area', 'base', 'basefont', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'isindex', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  static HTML_RAW = new Set(['script', 'style']);
  static HTML_BOOLEAN = new Set(['checked', 'compact', 'declare', 'defer', 'disabled', 'ismap', 'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'readonly', 'selected']);
  static HTML_BLOCK = new Set(['address', 'blockquote', 'body', 'caption', 'center', 'dd', 'dir', 'div', 'dl', 'dt', 'fieldset', 'form', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'html', 'isindex', 'li', 'menu', 'meta', 'noframes', 'noscript', 'ol', 'p', 'pre', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'ul', 'link', 'script', 'style']);

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance initialization
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * @param {Object} output - The merged xsl:output settings.
   * @param {Set} [cdataSectionElements] - Expanded names whose text is written as CDATA.
   */
  constructor (
    output = {},
    cdataSectionElements = new Set()
  ) {
    this.output = output;
    this.cdata = cdataSectionElements;
    this.generated = 0;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Works out the output method when xsl:output does not give one.
   */
  static defaultMethod (
    fragment
  ) {
    for (let child = fragment.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        return (!child.namespaceURI && (child.localName || child.nodeName).toLowerCase() === 'html') ? 'html' : 'xml';
      }
      if (child.nodeType === 3 && child.data.trim()) {
        return 'xml';
      }
    }
    return 'xml';
  }

  static escapeText (
    text
  ) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  static escapeAttribute (
    text
  ) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
      .replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Serializes a result tree.
   * @param {DocumentFragment} fragment - The result.
   * @returns {string}
   */
  serialize (
    fragment
  ) {
    const method = this.output.method || Serializer.defaultMethod(fragment);
    this.method = (method === 'html' || method === 'text') ? method : 'xml';
    this.indent = (this.output.indent || (this.method === 'html' ? 'yes' : 'no')) === 'yes';

    if (this.method === 'text') {
      return this.textOf(fragment);
    }

    let result = '';
    if (this.method === 'xml') {
      if (this.output.omitXmlDeclaration !== 'yes') {
        result += '<?xml version="' + (this.output.version || '1.0') + '" encoding="' + (this.output.encoding || 'UTF-8') + '"' +
          (this.output.standalone ? ' standalone="' + this.output.standalone + '"' : '') + '?>';
        if (this.indent) {
          result += '\n';
        }
      }
      if (this.output.doctypeSystem) {
        const first = this.firstElement(fragment);
        if (first) {
          result += '<!DOCTYPE ' + first.nodeName +
            (this.output.doctypePublic ? ' PUBLIC "' + this.output.doctypePublic + '"' : ' SYSTEM') +
            ' "' + this.output.doctypeSystem + '">\n';
        }
      }
    } else if (this.output.doctypePublic || this.output.doctypeSystem) {
      result += '<!DOCTYPE html' +
        (this.output.doctypePublic ? ' PUBLIC "' + this.output.doctypePublic + '"' : '') +
        (this.output.doctypeSystem ? (this.output.doctypePublic ? '' : ' SYSTEM') + ' "' + this.output.doctypeSystem + '"' : '') + '>\n';
    }

    const parts = [];
    for (let child = fragment.firstChild; child; child = child.nextSibling) {
      this.writeNode(child, new Map([['xml', Names.XML_NS]]), parts, 0, false);
    }
    return result + parts.join('');
  }

  firstElement (
    fragment
  ) {
    for (let child = fragment.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        return child;
      }
    }
    return null;
  }

  textOf (
    node
  ) {
    let text = '';
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        text += child.data;
      } else if (child.nodeType === 1) {
        text += this.textOf(child);
      }
    }
    return text;
  }

  /**
   * Writes one node.
   */
  writeNode (
    node,
    scope,
    parts,
    depth,
    raw
  ) {
    switch (node.nodeType) {
      case 1:
        this.writeElement(node, scope, parts, depth);
        break;
      case 3:
      case 4:
        if (node.xsltRaw || raw) {
          parts.push(node.data);
        } else {
          parts.push(Serializer.escapeText(node.data));
        }
        break;
      case 7:
        parts.push('<?' + node.target + (node.data ? ' ' + node.data : '') + (this.method === 'html' ? '>' : '?>'));
        break;
      case 8:
        parts.push('<!--' + node.data + '-->');
        break;
    }
  }

  /**
   * Writes an element, declaring the namespaces it needs.
   */
  writeElement (
    element,
    parentScope,
    parts,
    depth
  ) {
    const scope = new Map(parentScope);
    const declarations = new Map();
    const declare = (prefix, uri) => {
      if (scope.get(prefix) !== uri && !(prefix === '' && !uri && !scope.has(''))) {
        declarations.set(prefix, uri);
        scope.set(prefix, uri);
      }
    };

    if (element.xsltNamespaces) {
      for (const [prefix, uri] of element.xsltNamespaces) {
        if (prefix === 'xml' || prefix === 'xmlns') {
          continue;
        }
        if (prefix === '' && (element.namespaceURI || '') !== uri) {
          continue; // The element's own default namespace takes priority.
        }
        declare(prefix, uri);
      }
    }

    const uri = element.namespaceURI || '';
    let prefix = element.prefix || '';
    let localName = element.localName || element.nodeName;
    if (prefix && declarations.has(prefix) && declarations.get(prefix) !== uri) {
      prefix = this.newPrefix(scope, declarations);
    }
    if (uri) {
      if (scope.get(prefix) !== uri) {
        if (declarations.has(prefix)) {
          prefix = this.newPrefix(scope, declarations);
        }
        declare(prefix, uri);
      }
    } else {
      prefix = '';
      if (scope.get('') && scope.get('') !== '') {
        declarations.set('', '');
        scope.set('', '');
      }
    }
    if (!uri && element.nodeName.includes(':')) {
      localName = element.nodeName.replace(/^[^:]*:/, '');
    }
    const name = (prefix ? prefix + ':' : '') + localName;

    const attributes = [];
    const attrs = element.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (a.name === 'xmlns' || a.prefix === 'xmlns') {
        continue;
      }
      const attrURI = a.namespaceURI || '';
      let attrName = a.localName || a.name;
      if (attrURI) {
        let attrPrefix = a.prefix || '';
        if (attrURI === Names.XML_NS) {
          attrPrefix = 'xml';
        } else if (!attrPrefix || scope.get(attrPrefix) !== attrURI) {
          const existing = [...scope.entries()].find(([p, u]) => p && u === attrURI);
          if (existing) {
            attrPrefix = existing[0];
          } else {
            if (!attrPrefix || (scope.has(attrPrefix) && scope.get(attrPrefix) !== attrURI) || attrPrefix === 'xmlns') {
              attrPrefix = this.newPrefix(scope, declarations);
            }
            declare(attrPrefix, attrURI);
          }
        }
        attrName = attrPrefix + ':' + attrName;
      } else {
        attrName = a.name.replace(/^[^:]*:/, '');
      }
      attributes.push([attrName, a.value]);
    }

    const isHtml = this.method === 'html' && !uri;
    const lower = localName.toLowerCase();
    let text = '<' + name;
    for (const [p, u] of declarations) {
      text += p ? ' xmlns:' + p + '="' + Serializer.escapeAttribute(u) + '"' : ' xmlns="' + Serializer.escapeAttribute(u) + '"';
    }
    for (const [attrName, value] of attributes) {
      if (isHtml && Serializer.HTML_BOOLEAN.has(attrName.toLowerCase()) && value.toLowerCase() === attrName.toLowerCase()) {
        text += ' ' + attrName;
      } else if (isHtml) {
        text += ' ' + attrName + '="' + value.replace(/&(?!\{)/g, '&amp;').replace(/"/g, '&quot;') + '"';
      } else {
        text += ' ' + attrName + '="' + Serializer.escapeAttribute(value) + '"';
      }
    }
    parts.push(text);

    if (isHtml && Serializer.HTML_EMPTY.has(lower)) {
      parts.push('>');
      return;
    }
    if (!element.firstChild) {
      parts.push(isHtml ? '></' + name + '>' : '/>');
      return;
    }
    parts.push('>');

    const indentChildren = this.indent && !this.hasText(element) && !(isHtml && (lower === 'pre' || Serializer.HTML_RAW.has(lower)));
    const raw = isHtml && Serializer.HTML_RAW.has(lower);
    const cdata = this.method === 'xml' && this.cdata.has(Names.key(uri, localName));
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (indentChildren) {
        parts.push('\n' + '  '.repeat(depth + 1));
      }
      if (cdata && (child.nodeType === 3 || child.nodeType === 4) && !child.xsltRaw) {
        parts.push('<![CDATA[' + child.data.replace(/]]>/g, ']]]]><![CDATA[>') + ']]>');
      } else {
        this.writeNode(child, scope, parts, depth + 1, raw);
      }
    }
    if (indentChildren) {
      parts.push('\n' + '  '.repeat(depth));
    }
    parts.push('</' + name + '>');
  }

  /**
   * Does an element have text content of its own (mixed content), which
   * indentation must not change?
   */
  hasText (
    element
  ) {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if ((child.nodeType === 3 || child.nodeType === 4) && child.data.trim()) {
        return true;
      }
      if (child.nodeType === 3 && !child.data.trim()) {
        return true;
      }
    }
    return false;
  }

  /**
   * A prefix not yet used, for a namespace that needs one.
   */
  newPrefix (
    scope,
    declarations
  ) {
    let prefix;
    do {
      prefix = 'ns' + this.generated++;
    } while (scope.has(prefix) || declarations.has(prefix));
    return prefix;
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.Serializer = Serializer;

// ----------------------------------------------------------------------------
