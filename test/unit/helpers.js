/**
 * @file helpers.js
 * @description Shared helpers for the XSLTjs unit tests.
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports & dependencies
// ----------------------------------------------------------------------------

const { DOMParser } = require('@xmldom/xmldom');
const { XSLT } = require('../../scripts/XSLT.js');

// ----------------------------------------------------------------------------
// Functions
// ----------------------------------------------------------------------------

const quiet = { debug () {}, info () {}, warn () {}, error () {}, log () {} };

/**
 * Transforms an XML string with an XSLT string.
 * @param {string} xml - The input document.
 * @param {string} xsl - The stylesheet. A bare body is wrapped in xsl:stylesheet.
 * @param {Object} [params] - Stylesheet parameters.
 * @param {Object} [options] - Options passed to XSLT.process.
 * @returns {Promise<string>} The result, without any XML declaration.
 */
const transform = async (xml, xsl, params = {}, options = {}) => {
  const stylesheet = (/<xsl:(stylesheet|transform)\b/).test(xsl)
    ? xsl
    : '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">' + xsl + '</xsl:stylesheet>';
  const parser = new DOMParser();
  const inputDoc = parser.parseFromString(xml, 'application/xml');
  const transformDoc = parser.parseFromString(stylesheet, 'application/xml');
  const result = await XSLT.process(inputDoc, transformDoc, params, { logger: quiet, ...options });
  return String(result).replace(/^<\?xml[^>]*\?>\s*/, '');
};

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

module.exports = { transform };
