/**
 * @file XPathFixes.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const XPath = require('xpath');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc Corrections to the xpath module's following, preceding and
 *   sibling axes, which give wrong results in some cases: following
 *   includes the context node's descendants, preceding includes its
 *   ancestors, and none of them work from an attribute. The corrections
 *   apply only to expressions XSLTjs evaluates (their context carries an
 *   xslt property), so other users of the xpath module in the same
 *   process see no change.
 */
const XPathFixes = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static installed = false;
  static namespaceCache = new WeakMap();

  /**
   * A namespace node, as the XPath data model has them and the DOM does not.
   */
  static NamespaceNode = class {
    constructor (element, prefix, uri, index) {
      this.isXPathNamespace = true;
      this.isNamespaceNode = true;
      this.nodeType = '__namespace'; // The xpath module's type for namespace nodes
      this.nodeName = prefix;
      this.localName = prefix;
      this.prefix = prefix;
      this.namespaceURI = null;
      this.nodeValue = uri;
      this.namespace = uri;
      this.data = uri;
      this.textContent = uri;
      this.ownerElement = element;
      this.ownerDocument = element.ownerDocument;
      this.index = index;
      this.childNodes = [];
      this.firstChild = null;
      this.attributes = null;
    }

    /**
     * Document order: a namespace node follows its element and precedes
     * the element's attributes and children.
     */
    compareDocumentPosition (other) {
      const element = this.ownerElement;
      if (other === this) {
        return 0;
      }
      if (other && other.isXPathNamespace && other.ownerElement === element) {
        return (other.index > this.index) ? 4 : 2;
      }
      if (other === element) {
        return 2 | 8;
      }
      if (other && other.nodeType === 2 && other.ownerElement === element) {
        return 4;
      }
      const target = (other && other.isXPathNamespace) ? other.ownerElement : other;
      const position = element.compareDocumentPosition(target);
      if (position & 16) {
        return 4;
      }
      return position & ~16;
    }
  };

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static internal methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Adds a node and its descendants, in document order.
   */
  static subtree (
    node,
    step,
    xpc,
    result
  ) {
    const stack = [node];
    while (stack.length) {
      const m = stack.pop();
      if (m.nodeType !== 10 && step.nodeTest.matches(m, xpc)) {
        result.push(m);
      }
      for (let c = m.lastChild; c; c = c.previousSibling) {
        stack.push(c);
      }
    }
  }

  /**
   * The following axis: everything after the node in document order,
   * except its descendants. From an attribute, that includes its element's
   * descendants.
   */
  static following (
    step,
    xpc,
    node
  ) {
    const result = [];
    let start = node;
    if (node.nodeType === 2) {
      start = node.ownerElement;
      if (!start) {
        return result;
      }
      for (let c = start.firstChild; c; c = c.nextSibling) {
        XPathFixes.subtree(c, step, xpc, result);
      }
    }
    for (let m = start; m && m.nodeType !== 9 && m !== xpc.virtualRoot; m = m.parentNode) {
      for (let s = m.nextSibling; s; s = s.nextSibling) {
        XPathFixes.subtree(s, step, xpc, result);
      }
    }
    return result;
  }

  /**
   * The preceding axis: everything before the node in document order,
   * except its ancestors, nearest first.
   */
  static preceding (
    step,
    xpc,
    node
  ) {
    const result = [];
    const start = (node.nodeType === 2) ? node.ownerElement : node;
    for (let m = start; m && m.nodeType !== 9 && m !== xpc.virtualRoot; m = m.parentNode) {
      for (let s = m.previousSibling; s; s = s.previousSibling) {
        const nodes = [];
        XPathFixes.subtree(s, step, xpc, nodes);
        for (let i = nodes.length - 1; i >= 0; i--) {
          result.push(nodes[i]);
        }
      }
    }
    return result;
  }

  /**
   * The namespace nodes of an element: one for each namespace in scope,
   * the xml namespace first and then by prefix. The same objects are
   * returned each time, so they can be compared and identified.
   */
  static namespaces (
    element
  ) {
    if (!element || element.nodeType !== 1) {
      return [];
    }
    let nodes = XPathFixes.namespaceCache.get(element);
    if (nodes) {
      return nodes;
    }
    const inScope = new Map();
    for (let e = element; e && e.nodeType === 1; e = e.parentNode) {
      const attributes = e.attributes;
      for (let i = 0; i < attributes.length; i++) {
        const a = attributes[i];
        if (a.name === 'xmlns' || a.prefix === 'xmlns') {
          const prefix = (a.name === 'xmlns') ? '' : a.localName;
          if (!inScope.has(prefix)) {
            inScope.set(prefix, a.value);
          }
        }
      }
      if (e.xsltNamespaces) {
        for (const [prefix, uri] of e.xsltNamespaces) {
          if (!inScope.has(prefix)) {
            inScope.set(prefix, uri);
          }
        }
      }
    }
    if (element.namespaceURI && !inScope.has(element.prefix || '')) {
      inScope.set(element.prefix || '', element.namespaceURI);
    }
    inScope.delete('xml');
    const prefixes = [...inScope.keys()].filter((p) => inScope.get(p) !== '').sort();
    nodes = [['xml', 'http://www.w3.org/XML/1998/namespace'], ...prefixes.map((p) => [p, inScope.get(p)])]
      .map(([prefix, uri], index) => new XPathFixes.NamespaceNode(element, prefix, uri, index));
    XPathFixes.namespaceCache.set(element, nodes);
    return nodes;
  }

  /**
   * Is a node test a name test (*, prefix:* or a QName)?
   */
  static isNameTest (
    nodeTest
  ) {
    const NodeTest = XPath.NodeTest;
    return [NodeTest.NAMETESTANY, NodeTest.NAMETESTPREFIXANY, NodeTest.NAMETESTQNAME].includes(nodeTest.type);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Installs the corrections, once.
   */
  static install () {
    if (XPathFixes.installed) {
      return;
    }
    XPathFixes.installed = true;
    const Step = XPath.Step;
    const original = XPath.PathExpr.applyStep;
    XPath.PathExpr.applyStep = function (step, xpc, node) {
      if (!xpc || !xpc.xslt || !node) {
        return original.call(this, step, xpc, node);
      }
      xpc.contextNode = node;
      switch (step.axis) {
        case Step.FOLLOWING:
          return XPathFixes.following(step, xpc, node);
        case Step.PRECEDING:
          return XPathFixes.preceding(step, xpc, node);
        case Step.FOLLOWINGSIBLING:
        case Step.PRECEDINGSIBLING:
          return (node.nodeType === 2) ? [] : original.call(this, step, xpc, node);
        case Step.NAMESPACE:
          return XPathFixes.namespaces(node).filter((n) => step.nodeTest.type === XPath.NodeTest.NODE || step.nodeTest.matches(n, xpc));
        case Step.SELF:
        case Step.ANCESTORORSELF:
          if (node.nodeType === 2 && XPathFixes.isNameTest(step.nodeTest)) {
            // The principal node type of these axes is element, so a name
            // test never selects the attribute itself.
            return (step.axis === Step.SELF) ? [] : original.call(this, new Step(Step.ANCESTOR, step.nodeTest, []), xpc, node);
          }
          return original.call(this, step, xpc, node);
        case Step.ATTRIBUTE: {
          const nodes = original.call(this, step, xpc, node);
          return nodes.filter((a) => !(a.name === 'xmlns' || a.prefix === 'xmlns'));
        }
        default:
          return original.call(this, step, xpc, node);
      }
    };
  }
};

XPathFixes.install();

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.XPathFixes = XPathFixes;

// ----------------------------------------------------------------------------
