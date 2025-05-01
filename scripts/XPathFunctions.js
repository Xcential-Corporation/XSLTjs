/**
 * @file XPathFunctions.js - (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports
// ----------------------------------------------------------------------------

const XPath = require('xpath');

// ----------------------------------------------------------------------------
/*
 * @class XPathFunctions
 * @classDesc Implements XSLT specific XPath functions.
 */
var XPathFunctions = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method functionAvailable
   * @static
   * @implements xsl:function-available()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} functionNameExpr - The name of the function
   *   to test for.
   * @returns {XPath.XBoolean}
   */
  static functionAvailable (
    xPathContext,
    functionNameExpr
  ) {
    const functionName = (typeof functionNameExpr === 'string') ? functionNameExpr : functionNameExpr.evaluate(xPathContext).str;
    const functionFound = xPathContext.functionResolver.getFunction(functionName) !== undefined;

    return new XPath.XBoolean(functionFound);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method name
   * @static
   * @implements xsl:name()
   * @param {Object} xPathContext - The XPath context to base the result on.
   *   to test for.
   * @returns {XPath.XString}
   */
  static name (
    xPathContext
  ) {
    return new XPath.XString(xPathContext.contextNode.nodeName);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method current
   * @static
   * @implements xsl:current()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @returns {XPath.XNodeSet} - The context node within a node set.
   */
  static current (
    xPathContext
  ) {
    const nodeSet = new XPath.XNodeSet();
    nodeSet.add(xPathContext.contextNode);

    return nodeSet;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method document
   * @static
   * @implements xsl:document()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @returns {XPath.XNodeSet} - The owner document within a node set.
   */
  static document (
    xPathContext
  ) {
    const nodeSet = new XPath.XNodeSet();
    nodeSet.add(xPathContext.contextNode.ownerDocument);

    return nodeSet;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method formatNumber
   * @static
   * @implements xsl:format-number()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|number} numberExpr - The number to format.
   * @param {XPath.XPathExpr|string} formatExpr - The formatting expression.
   * @param {XPath.XPathExpr|string} [decimalFormatExpr=null] - The name of
   *   a decimal format defined using <xsl:format-number> to use to define
   *   the formatting rules.
   * @returns {XPath.XString}
   */
  static formatNumber (
    xPathContext,
    numberExpr,
    formatExpr,
    decimalFormatExpr = null
  ) {
    const number = (typeof numberExpr === 'number') ? numberExpr : numberExpr.evaluate(xPathContext);
    const format = (typeof formatExpr === 'string') ? formatExpr : formatExpr.evaluate(xPathContext);
    const decimalFormatName = (typeof decimalFormatExpr === 'string') ? decimalFormatExpr : (decimalFormatExpr) ? decimalFormatExpr.evaluate(xPathContext) : '_default';
    const decimalFormat = XPathFunctions.decimalFormats[decimalFormatName];

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
      formattedNumber = (number < 0) ? formattedNumber.replace(RegExp('^.*\\' + decimalFormat.patternSeparator), '') : formattedNumber.replace(RegExp('\\' + decimalFormat.patternSeparator + '.*$'), '');

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
   * @static
   * @implements xsl:replace()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to examine.
   * @param {XPath.XPathExpr|string} regexExpr - The regular expression to
   *   evaluation.
   * @param {XPath.XPathExpr|string} replacementExpr - The text to use as
   *   the replacement.
   * @param {XPath.XPathExpr|string} flagsExpr - the flags for the regular expression.
   * @returns {XPath.XString}
   */
  static replace (
    xPathContext,
    textExpr,
    regexExpr,
    replacementExpr,
    flagsExpr = undefined
  ) {
    try {
      const text = (typeof textExpr === 'string') ? textExpr
      : textExpr.evaluate(xPathContext).stringValue();
      const regex = (typeof regexExpr === 'string') ? regexExpr
      : regexExpr.evaluate(xPathContext).stringValue();
      const replacement = (typeof replacementExpr === 'string') ? replacementExpr
      : replacementExpr.evaluate(xPathContext).stringValue();
      const flags = (typeof flagsExpr === 'string') ? flagsExpr : (flagsExpr) ? flagsExpr.evaluate(xPathContext) : undefined;
      
      return new XPath.XString(text.replace(new RegExp(regex, flags), replacement));
    } catch { console.log('ERROR IN REPLACE')}
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method lowerCase
   * @static
   * @implements xsl:lower-case()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to convert.
   * @returns {XPath.XString}
   */
  static lowerCase (
    xPathContext,
    textExpr
  ) {
    const text = (typeof textExpr === 'string') ? textExpr
      : textExpr.evaluate(xPathContext).stringValue();

    return new XPath.XString(text.toLowerCase());
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method upperCase
   * @static
   * @implements xsl:upper-case()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to convert.
   * @returns {XPath.XString}
   */
  static upperCase (
    xPathContext,
    textExpr
  ) {
    const text = (typeof textExpr === 'string') ? textExpr
      : textExpr.evaluate(xPathContext).stringValue();

    return new XPath.XString(text.toUpperCase());
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * @method matches
   * @static
   * @implements xsl:matches()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr|string} textExpr - The text to examling.
   * @param {XPath.XPathExpr|string} regexExpr - The regular expression to
   *   evaluation.
   * @returns {XPath.XString} - Values are 'true' or 'false'.
   */
  static matches (
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
   * @static
   * @implements xsl:generate-id()
   * @param {Object} xPathContext - The XPath context to base the result on.
   * @param {XPath.XPathExpr} [nodeSetExpr=null] - The node set to be used to
   *   seed the id generation algorithm. When used, the algorithm will always
   *   generate the same id for the same set of nodes. This is only guaranteed
   *   in the current execution session, not between sessions.
   * @returns {XPath.XString}
   */
  static generateId (
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
        // KLUDGE: Depending on how the nodeset was created, the column and line
        //         numbers may not always be present
        if (node.columnNumber !== undefined) {
          str += '/' + node.columnNumber + '/' + node.lineNumber;
        } else if (node._nodeId !== undefined) {
          str += '/' + node._nodeId;
        } else {
          node._nodeId = Math.random();
          str += '/' + node._nodeId;
        }
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
   * @method counter
   * @static
   * @implements xsl:counter()
   * @returns {XPath.XString} }
   */
  static counter () {
    return new XPath.XString(XPathFunctions._counter++);
  }
};

// ----------------------------------------------------------------------------
// Variables
// ----------------------------------------------------------------------------

XPathFunctions.decimalFormats = {
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

XPathFunctions._counter = 1;

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.XPathFunctions = XPathFunctions;

// ----------------------------------------------------------------------------
