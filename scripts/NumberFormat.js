/**
 * @file NumberFormat.js
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
 * @classdesc Number formatting for xsl:number (format tokens such as 1, a,
 *   A, i, I and 01) and for format-number() (decimal format pictures, as
 *   defined by the JDK 1.1 DecimalFormat class that XSLT 1.0 refers to).
 */
const NumberFormat = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static variables
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  static DEFAULT_DECIMAL_FORMAT = Object.freeze({
    decimalSeparator: '.',
    groupingSeparator: ',',
    infinity: 'Infinity',
    minusSign: '-',
    NaN: 'NaN',
    percent: '%',
    perMille: '‰',
    zeroDigit: '0',
    digit: '#',
    patternSeparator: ';'
  });

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static internal methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Formats a positive integer as letters: 1 = a, 26 = z, 27 = aa.
   */
  static toAlphabetic (
    n,
    upper
  ) {
    let result = '';
    while (n > 0) {
      n--;
      result = String.fromCharCode(97 + (n % 26)) + result;
      n = Math.floor(n / 26);
    }
    return upper ? result.toUpperCase() : result;
  }

  /**
   * Formats a positive integer as a Roman numeral.
   */
  static toRoman (
    n,
    upper
  ) {
    if (n <= 0 || n >= 4000) {
      return String(n);
    }
    const numerals = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let result = '';
    for (const [value, numeral] of numerals) {
      while (n >= value) {
        result += numeral;
        n -= value;
      }
    }
    return upper ? result.toUpperCase() : result;
  }

  /**
   * Adds grouping separators to a string of digits.
   */
  static group (
    digits,
    separator,
    size
  ) {
    if (!separator || !size || size <= 0) {
      return digits;
    }
    let result = '';
    let count = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
      result = digits[i] + result;
      count++;
      if (count % size === 0 && i > 0) {
        result = separator + result;
      }
    }
    return result;
  }

  /**
   * Formats one number with one alphanumeric format token.
   */
  static formatToken (
    n,
    token,
    groupingSeparator,
    groupingSize
  ) {
    if (token === 'a' || token === 'A') {
      return NumberFormat.toAlphabetic(n, token === 'A');
    }
    if (token === 'i' || token === 'I') {
      return NumberFormat.toRoman(n, token === 'I');
    }
    const decimal = token.match(/^(\p{Nd}*?)(\p{Nd})$/u);
    if (decimal) {
      const one = decimal[2];
      const zeroCode = one.codePointAt(0) - 1;
      const width = token.length;
      let digits = String(n);
      while (digits.length < width) {
        digits = '0' + digits;
      }
      if (zeroCode !== 48) {
        digits = digits.replace(/[0-9]/g, (d) => String.fromCodePoint(zeroCode + Number(d)));
      }
      return NumberFormat.group(digits, groupingSeparator, groupingSize);
    }
    return NumberFormat.group(String(n), groupingSeparator, groupingSize);
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Formats a list of numbers as xsl:number does.
   * @param {number[]} numbers - The numbers, outermost first.
   * @param {string} format - The format attribute, such as "1.a" or "(i)".
   * @param {Object} [options] - groupingSeparator and groupingSize.
   * @returns {string}
   */
  static formatList (
    numbers,
    format = '1',
    options = {}
  ) {
    const parts = [];
    const re = /[\p{L}\p{N}]+/gu;
    let last = 0;
    let match;
    while ((match = re.exec(format)) !== null) {
      parts.push({ separator: format.slice(last, match.index), token: match[0] });
      last = match.index + match[0].length;
    }
    const trailer = format.slice(last);
    if (parts.length === 0) {
      return trailer + numbers.join('.') + trailer;
    }

    const leader = parts[0].separator;
    let result = leader;
    numbers.forEach((n, i) => {
      const part = parts[Math.min(i, parts.length - 1)];
      if (i > 0) {
        result += (i < parts.length) ? part.separator : (parts.length > 1 ? parts[parts.length - 1].separator : '.');
      }
      result += NumberFormat.formatToken(n, part.token, options.groupingSeparator, options.groupingSize);
    });
    return result + trailer;
  }

  /**
   * Formats a number with a format-number() picture.
   * @param {number} number - The number to format.
   * @param {string} picture - The picture string, such as "#,##0.00".
   * @param {Object} [decimalFormat] - Symbols from an xsl:decimal-format.
   * @param {Node} [node] - The stylesheet node, for error reports.
   * @returns {string}
   */
  static formatNumber (
    number,
    picture,
    decimalFormat = NumberFormat.DEFAULT_DECIMAL_FORMAT,
    node = null
  ) {
    const df = { ...NumberFormat.DEFAULT_DECIMAL_FORMAT, ...decimalFormat };
    if (Number.isNaN(number)) {
      return df.NaN;
    }

    const subPictures = NumberFormat.splitPicture(picture, df);
    if (subPictures.length > 2 || subPictures.some((p) => p === null)) {
      throw new XsltError('XTDE1310', 'Invalid format-number picture "' + picture + '"', node);
    }
    const negative = number < 0 || Object.is(number, -0);
    const sub = (negative && subPictures.length > 1) ? subPictures[1] : subPictures[0];
    const positive = subPictures[0];
    if (negative && subPictures.length > 1) {
      // The negative sub-picture only supplies the prefix and suffix.
      sub.minInt = positive.minInt;
      sub.minFrac = positive.minFrac;
      sub.maxFrac = positive.maxFrac;
      sub.grouping = positive.grouping;
    }

    let value = Math.abs(number);
    if (!Number.isFinite(value)) {
      const body = df.infinity;
      return negative && subPictures.length === 1 ? df.minusSign + sub.prefix + body + sub.suffix : sub.prefix + body + sub.suffix;
    }
    if (sub.percent) {
      value *= 100;
    } else if (sub.perMille) {
      value *= 1000;
    }

    let fixed = NumberFormat.toFixed(value, sub.maxFrac);
    let [intPart, fracPart = ''] = fixed.split('.');
    fracPart = fracPart.replace(/0+$/, '');
    while (fracPart.length < sub.minFrac) {
      fracPart += '0';
    }
    intPart = intPart.replace(/^0+/, '');
    while (intPart.length < sub.minInt) {
      intPart = '0' + intPart;
    }
    if (intPart === '' && fracPart === '') {
      intPart = '0';
    }

    const zero = df.zeroDigit.codePointAt(0);
    const localize = (digits) => (zero === 48) ? digits : digits.replace(/[0-9]/g, (d) => String.fromCodePoint(zero + Number(d)));
    intPart = NumberFormat.group(localize(intPart), df.groupingSeparator, sub.grouping);
    fracPart = localize(fracPart);

    fixed = intPart + (fracPart ? df.decimalSeparator + fracPart : (sub.alwaysDecimal ? df.decimalSeparator : ''));
    const allZero = !(/[1-9]/).test(NumberFormat.toFixed(value, sub.maxFrac));
    const minus = (negative && subPictures.length === 1 && !allZero) ? df.minusSign : '';
    return minus + sub.prefix + fixed + sub.suffix;
  }

  /**
   * Rounds half-even to a number of fraction digits, without exponents.
   */
  static toFixed (
    value,
    digits
  ) {
    if (value >= 1e21) {
      return BigInt(Math.round(value)).toString();
    }
    const text = value.toFixed(Math.min(Math.max(digits, 0), 100));
    return text;
  }

  /**
   * Splits a picture into its positive and negative sub-pictures and
   * analyzes each.
   */
  static splitPicture (
    picture,
    df
  ) {
    const parts = picture.split(df.patternSeparator);
    return parts.map((part) => NumberFormat.analyze(part, df));
  }

  /**
   * Analyzes one sub-picture: prefix, digits, grouping, fraction and suffix.
   */
  static analyze (
    text,
    df
  ) {
    const isActive = (c) => c === df.digit || c === df.zeroDigit || c === df.groupingSeparator || c === df.decimalSeparator;
    const chars = Array.from(text);
    let start = chars.findIndex(isActive);
    if (start < 0) {
      return null;
    }
    let end = chars.length - 1;
    while (end >= 0 && !isActive(chars[end])) {
      end--;
    }
    const prefix = chars.slice(0, start).join('');
    const suffix = chars.slice(end + 1).join('');
    const body = chars.slice(start, end + 1);
    if (body.filter((c) => c === df.decimalSeparator).length > 1) {
      return null;
    }

    const pos = body.indexOf(df.decimalSeparator);
    const intChars = (pos >= 0) ? body.slice(0, pos) : body;
    const fracChars = (pos >= 0) ? body.slice(pos + 1) : [];
    const intDigits = intChars.filter((c) => c !== df.groupingSeparator);
    const minInt = intDigits.filter((c) => c === df.zeroDigit).length;
    const lastGroup = intChars.lastIndexOf(df.groupingSeparator);
    const grouping = (lastGroup >= 0) ? intChars.length - lastGroup - 1 : 0;
    const minFrac = fracChars.filter((c) => c === df.zeroDigit).length;
    const maxFrac = fracChars.filter((c) => c === df.zeroDigit || c === df.digit).length;
    start = 0;
    return {
      prefix,
      suffix,
      minInt: (minInt === 0 && maxFrac === 0) ? 1 : minInt,
      minFrac,
      maxFrac,
      grouping,
      alwaysDecimal: false,
      percent: (prefix + suffix).includes(df.percent),
      perMille: (prefix + suffix).includes(df.perMille)
    };
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

exports.NumberFormat = NumberFormat;

// ----------------------------------------------------------------------------
