/**
 * @file XSLT.js
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @copyright © 2019-2026 -- {@link http://xcential.com Xcential Corp.}
 * @license MIT
 */

'use strict';

// ----------------------------------------------------------------------------
// - Imports & dependencies
// ----------------------------------------------------------------------------

const { DOMParser } = require('@xmldom/xmldom');
const { Stylesheet } = require('./Stylesheet');
const { Processor } = require('./Processor');
const { Serializer } = require('./Serializer');
const { XsltError } = require('./XsltError');

// ----------------------------------------------------------------------------
/**
 * @class
 * @classdesc The XSLTjs entry points: XSLT.process() transforms a document
 *   and returns the result as text; XSLT.compile() compiles a stylesheet
 *   once so that it can be run many times; XSLT.transform() is a drop-in
 *   replacement for the xslt4node API.
 */
const XSLT = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static internal methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Accepts a document as a DOM document or as XML text.
   */
  static toDocument (
    value,
    uri,
    code
  ) {
    if (typeof value === 'string') {
      return Stylesheet.parse(value, uri, code);
    }
    if (value && value.nodeType === 9) {
      return value;
    }
    if (value && value.nodeType === 1) {
      return value.ownerDocument;
    }
    throw new XsltError(code, 'Expected an XML document or text');
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // - Static properties & methods
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  /**
   * Compiles a stylesheet so it can be run many times with XSLT.run().
   * @param {Document|string} transform - The stylesheet, as a DOM document or text.
   * @param {Object} [options]
   * @param {string} [options.transformURL] - Where the stylesheet came from,
   *   for resolving xsl:include, xsl:import and document().
   * @param {Function} [options.loader] - async (uri) => text, for loading
   *   included and imported modules. By default, files are read from disk
   *   and http(s) URLs are fetched.
   * @returns {Promise<Stylesheet>}
   */
  static async compile (
    transform,
    options = {}
  ) {
    const doc = XSLT.toDocument(transform, options.transformURL, 'XTSE0165');
    return Stylesheet.compile(doc, {
      baseURI: options.transformURL || '',
      loader: options.loader
    });
  }

  /**
   * Runs a compiled stylesheet.
   * @param {Stylesheet} stylesheet - From XSLT.compile().
   * @param {Document|string} input - The source document.
   * @param {Object} [params] - Values for the stylesheet's global parameters.
   * @param {Object} [options] - As for XSLT.process().
   * @returns {string} The result.
   */
  static run (
    stylesheet,
    input,
    params = {},
    options = {}
  ) {
    const logger = options.logger || console;
    const inputDoc = XSLT.toDocument(input, options.inputURL, 'XTDE0000');
    if (options.inputURL && !inputDoc.xsltBaseURI) {
      inputDoc.xsltBaseURI = options.inputURL;
    }
    const startTime = Date.now();
    const processor = new Processor(stylesheet, { ...options, logger });
    const fragment = processor.transform(inputDoc, params || {}, options);
    const output = { ...stylesheet.output, ...(options.output || {}) };
    const result = new Serializer(output, stylesheet.cdataSectionElements).serialize(fragment);
    if (options.debug && logger.debug) {
      logger.debug('# XSLT: transformed in ' + (Date.now() - startTime) + ' ms');
    }
    return result;
  }

  /**
   * Transforms a document.
   * @param {Document|string} inputDoc - The source document.
   * @param {Document|string} transform - The stylesheet.
   * @param {Object} [params] - Values for the stylesheet's global parameters, by name.
   * @param {Object} [options]
   * @param {string} [options.inputURL] - Where the source came from.
   * @param {string} [options.transformURL] - Where the stylesheet came from.
   * @param {Object} [options.customFunctions] - { namespaceURI: { name: function } }.
   *   Each function is called with the XPath context and its argument
   *   expressions; this.XPath is the xpath module, for building results.
   * @param {Function} [options.loader] - async (uri) => text, for modules.
   * @param {Function} [options.documentLoader] - (uri) => Document or text, for document().
   * @param {Function} [options.onMessage] - (text, terminate) => void, for xsl:message.
   * @param {string} [options.initialTemplate] - A named template to start with.
   * @param {string} [options.initialMode] - The mode to start in.
   * @param {Object} [options.output] - Overrides for xsl:output settings.
   * @param {boolean} [options.debug] - Log the time taken.
   * @param {Object} [options.logger] - Where to log; the console by default.
   * @returns {Promise<string>} The result.
   */
  static async process (
    inputDoc,
    transform,
    params = {},
    options = {}
  ) {
    const stylesheet = await XSLT.compile(transform, options);
    return XSLT.run(stylesheet, inputDoc, params, options);
  }

  /**
   * A drop-in replacement for xslt4node's transform().
   * @param {Object} transformSpec
   * @param {string|Document} transformSpec.source - The source document.
   * @param {string|Document} [transformSpec.xslt] - The stylesheet.
   * @param {string} [transformSpec.xsltPath] - Where the stylesheet is.
   * @param {string} [transformSpec.sourcePath] - Where the source is.
   * @param {Object} [transformSpec.params] - Parameter values.
   * @param {Object} [transformSpec.customFunctions] - Custom functions.
   * @param {boolean} [transformSpec.debug] - Log the time taken.
   * @param {Object} [transformSpec.logger] - Where to log.
   * @param {Function} callback - (errorMessage, resultXML) => void.
   */
  static transform (
    transformSpec,
    callback
  ) {
    const run = async () => {
      let transform = transformSpec.xslt;
      if (!transform && transformSpec.xsltPath) {
        transform = await Stylesheet.defaultLoader(transformSpec.xsltPath);
      }
      return XSLT.process(transformSpec.source, transform, transformSpec.params || {}, {
        inputURL: transformSpec.sourcePath,
        transformURL: transformSpec.xsltPath,
        customFunctions: transformSpec.customFunctions || {},
        debug: transformSpec.debug,
        logger: transformSpec.logger
      });
    };
    run().then(
      (resultXML) => callback(null, resultXML),
      (error) => callback(error.toString(), null)
    );
  }
};

// ----------------------------------------------------------------------------
// - Exports
// ----------------------------------------------------------------------------

XSLT.XsltError = XsltError;
XSLT.Stylesheet = Stylesheet;
XSLT.DOMParser = DOMParser;

exports.XSLT = XSLT;
exports.XsltError = XsltError;

// ----------------------------------------------------------------------------
