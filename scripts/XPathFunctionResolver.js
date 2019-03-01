/**
 * @file XPathFunctionResolver.js - (Internal Object)
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
 * @class XPathFunctionResolver
 * @classDesc A function resolver to be used by the XPath processor. This
 *   resolver implements XSLT specific XPath functions.
 */
var XPathFunctionResolver = class {

  /*
   * @constructor
   * @param {Node} stylesheetNode - The primary node used to find the document
   *   containing any custom functions.
   * @param {XsltContext} - The XSLT Context object holding the variables to
   *   be made available to the XPath processor.
   */
  constructor (
    stylesheetNode,
    context
  ) {
    this.stylesheetNode = stylesheetNode;
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
          return this.functionAvailable;
        case 'current':
          return this.current;
        case 'document':
          return this.document;
        case 'format-number':
          return this.formatNumber;
        case 'replace':
          return this.replace;
        case 'lower-case':
          return this.lowerCase;
        case 'upper-case':
          return this.upperCase;
        case 'matches':
          return this.matches;
        case 'generate-id':
          return this.generateId;
        default:
          return (this.functionResolver) ? this.functionResolver.getFunction(localName, namespaceURI) : undefined;
      }
    } else if (this.functionResolver) {
      let fcn = this.functionResolver.getFunction(localName, namespaceURI);
      if (!fcn && this.stylesheetNode) {
        const customFcnNode = this.context.findNamedNode(this.stylesheetNode, localName, {
          filter: 'xsl:function',
          namespaceURI: namespaceURI
        });
        if (customFcnNode) {
          return this.customFunction.bind(new XPathFunctionResolver(customFcnNode, this.context.clone()));
        }
      }
    }

    return undefined;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method functionAvailable
   * @instance
   * @implements xsl:function-available()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} functionNameExpr - The name of the function
   *   to test for.
   * @returns {XPath.XBoolean}
   */
  functionAvailable (
    xPathContext,
    functionNameExpr
  ) {
    const functionName = (typeof functionNameExpr === 'string') ? functionNameExpr
                       : functionNameExpr.evaluate(xPathContext);
    const functionFound = xPathContext.functionResolver.getFunction(functionName) !== undefined;

    return new XPath.XBoolean(functionFound);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method current
   * @instance
   * @implements xsl:current()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @returns {XPath.XNodeSet} - The context node within a node set.
   */
  current (
    xPathContext
  ) {
    const nodeSet = new XPath.XNodeSet();
    nodeSet.add(xPathContext.contextNode);

    return nodeSet;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method document
   * @instance
   * @implements xsl:document()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @returns {XPath.XNodeSet} - The owner document within a node set.
   */
  document (
    xPathContext
  ) {
    const nodeSet = new XPath.XNodeSet();
    nodeSet.add(xPathContext.contextNode.ownerDocument);

    return nodeSet;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method formatNumber
   * @instance
   * @implements xsl:format-number()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|number} numberExpr - The number to format.
   * @param {XPath.XPathExpr|string} formatExpr - The formatting expression.
   * @param {XPath.XPathExpr|string} [decimalFormatExpr=null] - The name of
   *   a decimal format defined using <xsl:format-number> to use to define
   *   the formatting rules.
   * @returns {XPath.XString}
   */
  formatNumber (
    xPathContext,
    numberExpr,
    formatExpr,
    decimalFormatExpr = null
  ) {
    const number = (typeof numberExpr === 'number') ? numberExpr
                 : numberExpr.evaluate(xPathContext);
    const format = (typeof formatExpr === 'string') ? formatExpr
                 : formatExpr.evaluate(xPathContext);
    const decimalFormatName = (typeof decimalFormatExpr === 'string') ? decimalFormatExpr
                            : (decimalFormatExpr) ? decimalFormatExpr.evaluate(xPathContext) : '_default';
    const decimalFormat = XPathFunctionResolver.decimalFormats[decimalFormatName];

    if (number === Infinity) {
      return decimalFormat.infinity;
    } else if (isNaN(number)) {
      return decimalFormat.NaN;
    }

    let formattedNumber = format;
    try {
      const mantissa = Math.abs(number) - Math.floor(Math.abs(number));
      const characteristic = Math.floor(Math.abs(number));

      if (!RegExp(decimalFormat.patternSeparator).test(formattedNumber)) {
        formattedNumber += decimalFormat.patternSeparator + decimalFormat.minusSign + formattedNumber;
      }
      formattedNumber = (number < 0) ? formattedNumber.replace(RegExp('^.*\\' + decimalFormat.patternSeparator), '')
                      : formattedNumber.replace(RegExp('\\' + decimalFormat.patternSeparator + '.*$'), '');

      let mantissaSide = (RegExp('\\' + decimalFormat.decimalSeparator).test(formattedNumber)) ? formattedNumber.replace(RegExp('^.*?\\' + decimalFormat.decimalSeparator), '') : '';
      if (mantissa > 0) {
        const mantissaSrc = mantissa.toString().replace(/^.*\./, '');
        let newMantissa = '';
        if (RegExp(decimalFormat.decimalSeparator).test(formattedNumber)) {
          for (let i = 0, j = 0; i < mantissaSide.length; i++) {
            const digit = mantissaSide[i];
            if (digit === '0') {
              newMantissa += (j < mantissaSrc.length) ? mantissaSrc[j++] : digit;
            } else if (digit === '#') {
              newMantissa += (j < mantissaSrc.length) ? mantissaSrc[j++] : '';
            } else {
              newMantissa += digit;
            }
          }
        }
        mantissaSide = newMantissa;
      }

      let characteristicSide = formattedNumber.replace(RegExp('\\' + decimalFormat.decimalSeparator + '.*$'), '');
      if (characteristic >= 0) {
        const characteristicSrc = characteristic.toString();
        let newCharacteristic = '';
        for (var i = characteristicSide.length - 1, j = characteristicSrc.length - 1; i >= 0; i--) {
          const digit = characteristicSide[i];
          if (digit === '0') {
            newCharacteristic = ((j >= 0) ? characteristicSrc[j--] : digit) + newCharacteristic;
          } else if (digit === '#') {
            newCharacteristic = ((j >= 0) ? characteristicSrc[j--] : '') + newCharacteristic;
          } else if (digit === decimalFormat.groupingSeparator) {
            newCharacteristic = ((j >= 0) ? digit : '') + newCharacteristic;
          } else if (digit === decimalFormat.minusSign) {
            newCharacteristic = digit + ((j >= 0) ? characteristicSrc.substr(0, j + 1) : '') + newCharacteristic;
            break;
          } else {
            newCharacteristic = digit + newCharacteristic;
          }

          if ((i === 0 || !(/[0#]/).test(characteristicSide.substr(0, i))) && j > 0) {
            newCharacteristic = characteristicSrc.substr(0, j + 1) + newCharacteristic;
            j = -1;
          }
        }
        characteristicSide = newCharacteristic;
      }

      formattedNumber = (characteristicSide + ((mantissaSide) ? decimalFormat.decimalSeparator + mantissaSide : '')).replace(/#/g, '');
    } catch (exception) {
      return decimalFormat.NaN;
    }

    return new XPath.XString(formattedNumber);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method replace
   * @instance
   * @implements xsl:replace()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to examling.
   * @param {XPath.XPathExpr|string} regexExpr - The regular expression to
   *   evaluation.
   * @param {XPath.XPathExpr|string} replacementExpr - The text to use as
   *   the replacement.
   * @returns {XPath.XString}
   */
  replace (
    xPathContext,
    textExpr,
    regexExpr,
    replacementExpr
  ) {
    const text = (typeof textExpr === 'string') ? textExpr
               : textExpr.evaluate(xPathContext).stringValue();
    const regex = (typeof regexExpr === 'string') ? regexExpr
                : regexExpr.evaluate(xPathContext).stringValue();
    const replacement = (typeof replacementExpr === 'string') ? replacementExpr
                      : replacementExpr.evaluate(xPathContext).stringValue();

    return new XPath.XString(text.replace(new RegExp(regex), replacement));
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method lowerCase
   * @instance
   * @implements xsl:lower-case()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to convert.
   * @returns {XPath.XString}
   */
  lowerCase (
    xPathContext,
    textExpr
  ) {
    const text = (typeof textExpr === 'string') ? textExpr
               : textExpr.evaluate(xPathContext).stringValue();

    return new XPath.XString(text.lowerCase());
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method upperCase
   * @instance
   * @implements xsl:upper-case()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to convert.
   * @returns {XPath.XString}
   */
  upperCase (
    xPathContext,
    textExpr
  ) {
    const text = (typeof textExpr === 'string') ? textExpr
               : textExpr.evaluate(xPathContext).stringValue();

    return new XPath.XString(text.upperCase());
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method matches
   * @instance
   * @implements xsl:matches()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to examling.
   * @param {XPath.XPathExpr|string} regexExpr - The regular expression to
   *   evaluation.
   * @returns {XPath.XString} - Values are 'true' or 'false'.
   */
  matches (
    xPathContext,
    textExpr,
    regexExpr
  ) {
    const text = (typeof textExpr === 'string') ? textExpr
               : textExpr.evaluate(xPathContext).stringValue();
    const regex = (typeof regexExpr === 'string') ? regexExpr
                : regexExpr.evaluate(xPathContext).stringValue();

    return new XPath.XString(new RegExp(regex).test(text) ? 'true' : 'false');
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method generateId
   * @instance
   * @implements xsl:generate-id()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr} [nodeSetExpr=null] - The node set to be used to
   *   seed the id generation algorithm. When used, the algorithm will always
   *   generate the same id for the same set of nodes. This is only guaranteed
   *   in the current execution session, not between sessions.
   * @returns {XPath.XString}
   */
  generateId (
    xPathContext,
    nodeSetExpr = null
  ) {
    const nodeSet = (nodeSetExpr) ? nodeSetExpr.evaluate(xPathContext) : null;

    function xmur3 (str) {
      for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      }
      h = h << 13 | h >>> 19;
      return function () {
        h = Math.imul(h ^ h >>> 16, 2246822507);
        h = Math.imul(h ^ h >>> 13, 3266489909);
        return (h ^= h >>> 16) >>> 0;
      };
    }

    function mulberry32 (a) {
      return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    let rndNum;
    if (nodeSet) {
      let str = '';
      nodeSet.nodes.forEach((node) => {
        str += '/' + node.columnNumber + '/' + node.lineNumber;
      });
      const seed = xmur3(str);
      rndNum = mulberry32(seed())();
    } else {
      rndNum = Math.random();
    }

    return new XPath.XString(Math.floor(rndNum * 1e12).toString(16));
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
    const fragmentNode = this.stylesheetNode.ownerDocument.createDocumentFragment();
    let customFcnNode = this.stylesheetNode;
    parameters.forEach((parameterExpr, i) => {
      let parameter = (parameterExpr && typeof parameterExpr === 'object' && parameterExpr.evaluate) ? parameterExpr.evaluate(xPathContext) : parameterExpr;
      parameters[i] = (parameter && parameter.stringValue) ? parameter.stringValue() : parameter;
    });
    this.context.processChildNodes(customFcnNode, fragmentNode, { parameters: parameters });

    return new XPath.XString(fragmentNode.textContent);
  }
};

// -----------------------------------------------------------------------------
// Variables
// -----------------------------------------------------------------------------

XPathFunctionResolver.decimalFormats = {
  _default: {
    decimalSeparator: '.',
    groupingSeparator: ',',
    infinity: 'Infinity',
    minusSign: '-',
    NaN: 'NaN',
    percent: '%',
    perMille: '\u2030',
    zeroDigit: '0',
    patternSeparator: ';'
  }
};

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XPathFunctionResolver = XPathFunctionResolver;

// -----------------------------------------------------------------------------
