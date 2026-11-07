/**
 * @file Pattern.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const XPath = require('xpath');
const { XsltError } = require('./XsltError');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc An XSLT 1.0 pattern, as used in the match attribute of
 *   xsl:template and xsl:key and the count and from attributes of
 *   xsl:number. A pattern is compiled once and then tested against nodes
 *   directly, step by step from the node upward, rather than by selecting
 *   nodes and searching the result.
 */
const Pattern = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static CHILD = XPath.Step.CHILD;
  static ATTRIBUTE = XPath.Step.ATTRIBUTE;
  static DESCENDANT_OR_SELF = XPath.Step.DESCENDANTORSELF;

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance initialization
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * @param {string} text - The pattern as written.
   * @param {Node} node - The stylesheet node the pattern appears on, for error reports.
   */
  constructor (
    text,
    node = null
  ) {
    this.text = text;
    let expression;
    try {
      expression = XPath.parse(text).expression.expression;
    } catch (error) {
      throw new XsltError('XTSE0340', 'Invalid pattern "' + text + '": ' + error.message, node);
    }
    this.alternatives = [];
    this.collect(expression, node);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance internal methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Splits a union into its alternatives and checks each is a valid pattern.
   */
  collect (
    expression,
    node
  ) {
    if (expression instanceof XPath.BarOperation) {
      this.collect(expression.lhs, node);
      this.collect(expression.rhs, node);
      return;
    }
    if (!(expression instanceof XPath.PathExpr)) {
      throw new XsltError('XTSE0340', 'Invalid pattern "' + this.text + '"', node);
    }

    const filter = expression.filter || null;
    if (filter) {
      const name = (filter instanceof XPath.FunctionCall) ? String(filter.functionName.name || filter.functionName) : '';
      if (!['id', 'key'].includes(name) || (expression.filterPredicates && expression.filterPredicates.length)) {
        throw new XsltError('XTSE0340', 'Invalid pattern "' + this.text + '"', node);
      }
    }

    const locationPath = expression.locationPath;
    // An extension kept for compatibility: a leading "./" (self::node()
    // with no predicates) is ignored, so "./a" matches as "a" does.
    const steps = ((locationPath) ? locationPath.steps : []).filter((step, i, all) =>
      !(step.axis === XPath.Step.SELF && step.nodeTest.type === XPath.NodeTest.NODE && step.predicates.length === 0 && i < all.length - 1));
    const absolute = !!(locationPath && locationPath.absolute);
    steps.forEach((step, i) => {
      const isDescendantMarker = step.axis === Pattern.DESCENDANT_OR_SELF &&
        step.nodeTest.type === XPath.NodeTest.NODE && step.predicates.length === 0;
      if (step.axis !== Pattern.CHILD && step.axis !== Pattern.ATTRIBUTE && !isDescendantMarker) {
        throw new XsltError('XTSE0340', 'Invalid pattern "' + this.text + '": only the child and attribute axes are allowed', node);
      }
      if (isDescendantMarker && i === steps.length - 1) {
        throw new XsltError('XTSE0340', 'Invalid pattern "' + this.text + '"', node);
      }
    });
    if (!filter && !absolute && steps.length === 0) {
      throw new XsltError('XTSE0340', 'Invalid pattern "' + this.text + '"', node);
    }

    this.alternatives.push({
      filter,
      absolute,
      steps,
      priority: Pattern.defaultPriority(filter, absolute, steps),
      lastName: Pattern.lastName(steps)
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static internal methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * The default priority of a pattern alternative, as defined in XSLT 1.0 section 5.5.
   */
  static defaultPriority (
    filter,
    absolute,
    steps
  ) {
    if (filter || absolute || steps.length !== 1) {
      return 0.5;
    }
    const step = steps[0];
    if (step.predicates.length > 0) {
      return 0.5;
    }
    const test = step.nodeTest;
    switch (test.type) {
      case XPath.NodeTest.NAMETESTQNAME:
        return 0;
      case XPath.NodeTest.PI:
        return (test.name !== undefined) ? 0 : -0.5;
      case XPath.NodeTest.NAMETESTPREFIXANY:
        return -0.25;
      default:
        return -0.5;
    }
  }

  /**
   * The local name the last step requires, if it names one, so that rules
   * can be indexed by name.
   */
  static lastName (
    steps
  ) {
    const step = steps[steps.length - 1];
    if (step && step.nodeTest.type === XPath.NodeTest.NAMETESTQNAME) {
      return {
        localName: step.nodeTest.localName,
        isAttribute: step.axis === Pattern.ATTRIBUTE
      };
    }
    return null;
  }

  /**
   * The parent of a node, treating an attribute's element as its parent.
   */
  static parentOf (
    node
  ) {
    return (node.nodeType === 2) ? (node.ownerElement || null) : (node.parentNode || null);
  }

  /**
   * Is an attribute node really a namespace declaration?
   */
  static isNamespaceDeclaration (
    node
  ) {
    return node.nodeType === 2 && (node.name === 'xmlns' || node.prefix === 'xmlns' || (/^xmlns:/).test(node.name));
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Instance properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Does a node match one alternative of this pattern?
   * @param {Node} node - The node to test.
   * @param {Object} alternative - One of this.alternatives.
   * @param {Function} makeContext - (contextNode) => an XPathContext for
   *   evaluating predicates and id() or key() filters.
   * @returns {boolean}
   */
  matchesAlternative (
    node,
    alternative,
    makeContext
  ) {
    const { steps } = alternative;
    if (steps.length === 0) {
      return this.anchors(node, alternative, makeContext);
    }
    return this.matchFrom(node, steps.length - 1, alternative, makeContext);
  }

  /**
   * Does a node match any alternative of this pattern?
   */
  matches (
    node,
    makeContext
  ) {
    for (const alternative of this.alternatives) {
      if (this.matchesAlternative(node, alternative, makeContext)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Matches steps[i] against node, then the steps before it against its ancestors.
   */
  matchFrom (
    node,
    i,
    alternative,
    makeContext
  ) {
    const steps = alternative.steps;
    if (!this.stepMatches(node, steps[i], makeContext)) {
      return false;
    }
    const parent = Pattern.parentOf(node);
    if (i === 0) {
      return this.anchors(parent, alternative, makeContext);
    }
    const previous = steps[i - 1];
    if (previous.axis === Pattern.DESCENDANT_OR_SELF) {
      for (let ancestor = parent; ancestor; ancestor = Pattern.parentOf(ancestor)) {
        const found = (i - 2 < 0)
          ? this.anchors(ancestor, alternative, makeContext)
          : this.matchFrom(ancestor, i - 2, alternative, makeContext);
        if (found) {
          return true;
        }
      }
      return false;
    }
    return !!parent && this.matchFrom(parent, i - 1, alternative, makeContext);
  }

  /**
   * Checks the node a pattern starts from: the root for an absolute
   * pattern, a node returned by id() or key() for a filtered one, and any
   * node at all otherwise.
   */
  anchors (
    node,
    alternative,
    makeContext
  ) {
    if (alternative.filter) {
      if (!node) {
        return false;
      }
      let root = node;
      while (Pattern.parentOf(root)) {
        root = Pattern.parentOf(root);
      }
      const context = makeContext(root);
      const result = alternative.filter.evaluate(context);
      const nodes = (result && result.nodes) ? result.nodes : [];
      return nodes.includes(node);
    }
    if (alternative.absolute) {
      return !!node && (node.nodeType === 9 || (node.nodeType === 11 && !Pattern.parentOf(node)));
    }
    return true;
  }

  /**
   * Does a node satisfy one step: its axis, node test and predicates?
   */
  stepMatches (
    node,
    step,
    makeContext
  ) {
    const type = node.nodeType;
    if (step.axis === Pattern.ATTRIBUTE) {
      if (type !== 2 || Pattern.isNamespaceDeclaration(node)) {
        return false;
      }
    } else if (type === 2 || type === 9 || type === 11 || node.isNamespaceNode) {
      return false;
    }

    const parent = Pattern.parentOf(node);
    const context = makeContext(parent || node);
    if (!step.nodeTest.matches(node, context)) {
      return false;
    }
    if (step.predicates.length === 0) {
      return true;
    }
    if (step.xsltPositional === undefined) {
      step.xsltPositional = step.predicates.some((p) => Pattern.isPositional(p));
    }
    if (!step.xsltPositional) {
      // A predicate that does not depend on position is tested on the node alone.
      const nodeContext = makeContext(node);
      return step.predicates.every((p) => {
        const value = p.evaluate(nodeContext);
        return value.booleanValue();
      });
    }
    if (!parent) {
      return false;
    }
    const candidates = XPath.PathExpr.applySteps([step], context, [parent]);
    return candidates.includes(node);
  }

  /**
   * Might a predicate's value depend on the node's position, either because
   * it calls position() or last() or because it may return a number?
   */
  static isPositional (
    predicate
  ) {
    const numeric = ['count', 'sum', 'number', 'string-length', 'floor', 'ceiling', 'round', 'last', 'position'];
    const top = predicate;
    if (top instanceof XPath.XNumber || top instanceof XPath.VariableReference ||
        top instanceof XPath.PlusOperation || top instanceof XPath.MinusOperation ||
        top instanceof XPath.MultiplyOperation || top instanceof XPath.DivOperation ||
        top instanceof XPath.ModOperation || top instanceof XPath.UnaryMinusOperation) {
      return true;
    }
    if (top instanceof XPath.FunctionCall) {
      const name = String(top.functionName.name || top.functionName);
      if (numeric.includes(name) || name.includes(':')) {
        return true;
      }
    }
    if (top instanceof XPath.PathExpr && top.filter && !top.locationPath && !(top.filterPredicates && top.filterPredicates.length)) {
      return Pattern.isPositional(top.filter);
    }
    const seen = new Set();
    const visit = (o) => {
      if (!o || typeof o !== 'object' || seen.has(o)) {
        return false;
      }
      seen.add(o);
      if (o instanceof XPath.Step) {
        return false; // Predicates inside a path have their own positions.
      }
      if (o instanceof XPath.FunctionCall) {
        const name = String(o.functionName.name || o.functionName);
        if (name === 'position' || name === 'last') {
          return true;
        }
      }
      return Object.values(o).some((v) => Array.isArray(v) ? v.some(visit) : visit(v));
    };
    return visit(top);
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.Pattern = Pattern;

// ----------------------------------------------------------------------------
