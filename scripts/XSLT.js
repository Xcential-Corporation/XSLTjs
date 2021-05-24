/**
 * @file XSLT.js - An XSLT 1.0+ implementation written entirely in JavaScript.
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @author: {@link mailto:mesch@google.com Steffen Meschkat}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 * @copyright &copy; 2005 Google Inc.
 * @see {@link http://www.w3.org/TR/1999/REC-xslt-19991116 XSLT Specification}
 * @see {@link http://www.ecma-international.org/publications/standards/Ecma-262.htm ECMAScript Language Specification}
 *
 * NOTE: This is a partial implements of XSLT 1.0 and 2.0. Elements, attribute,
 *   and functions are being implemented on an as needed basis.
 *
 * NOTE: (meschkat) XSLT processing, according to the specification, is defined
 *   as operations on text documents, not as operations on DOMtrees. So,
 *   strictly speaking, this implementation is not an XSLT processor, but
 *   the processing engine that needs to be complemented by an XML parser and
 *   serializer in order to be complete.
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports
// ----------------------------------------------------------------------------

const XmlDOM = require('xmldom');
const { XsltContext } = require('./XsltContext');
const { XPathNamespaceResolver } = require('./XPathNamespaceResolver');
const { XPathVariableResolver } = require('./XPathVariableResolver');
const { XPathFunctionResolver } = require('./XPathFunctionResolver');
const { Utils } = require('./Utils');
const { XsltLog } = require('./XsltLog');

// ----------------------------------------------------------------------------
/*
 * @class XSLT
 * @classdesc Primary class for the XSLT engine.
 */
var XSLT = class {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Primary entry point for processing the transform.
   * @method process
   * @static
   * @param {XmlDocument} inputDoc - The input document root, as DOM node.
   * @param {XmlDocument} transform - The transform document root, as DOM node.
   * @param {Object} params - An object of name/value parameters
   * @returns the processed document, as XML text in a string.
   */
  static process (
    inputDoc,
    transform,
    params = {},
    options = {}
  ) {
    XsltLog.logger = options.logger || console;
    XsltLog.debugMode = options.debug || false;

    const logger = XsltLog.logger;

    return new Promise(async (resolve, reject) => {
      try {
        const xmlSerializer = new XmlDOM.XMLSerializer();
        const fragmentNode = inputDoc.createDocumentFragment();

        const startTime = Date.now();
        const xsltContext = new XsltContext(inputDoc.documentElement, {
          variables: params,
          inputURL: options.inputURL,
          transformURL: options.transformURL,
          customFunctions: options.customFunctions,
          cfg: { // We use an object to ensure that the lists are pass-by-reference
            stripSpaceList: {},
            preserveSpaceList: {},
            _cache: {}
          },
          logger: logger
        });
        await xsltContext.processRoot(transform.documentElement, fragmentNode);
        logger.info('# --- Processing completed in ' + (Date.now() - startTime) + ' millisecs ---');

        let xml = xmlSerializer.serializeToString(fragmentNode)
          .replace(/<\?xml\s.*?\?>\n?/, '') // Sometimes the namespace declaration appears early??
          // .replace(/__(false)__/gi, '$1') // Workaround to a strange problem within the DOM processor
          .replace(/\n\s*/g, '\n');

        // This is a kludge to support disable-output-escaping
        if ((/\[\[/).test(xml)) {
          xml = xml
            .replace(/\[\[&lt;]]/g, '<')
            .replace(/\[\[&gt;]]/g, '>')
            .replace(/\[\[&apos;]]/g, '\'')
            .replace(/\[\[&quot;]]/g, '"')
            .replace(/\[\[&amp;]]/g, '&')
            .replace(/\[\[(.)]]/g, '$1');
        }

        Utils.reportMeasures();

        if (xml) {
          if (XsltContext.output) {
            if (!XsltContext.output.omitXmlDeclaration || XsltContext.output.omitXmlDeclaration.toLowerCase() !== 'yes') {
              let xmlDecl = '<?xml';
              xmlDecl += ' version="' + (XsltContext.output.version || '1.0') + '"';
              xmlDecl += ' encoding="' + (XsltContext.output.encoding || 'UTF-8') + '"';
              xmlDecl += ' standalone="' + (XsltContext.output.standalone || 'no') + '"';
              xmlDecl += '?>\n';
              xml = xmlDecl + xml;
            }
          }
          resolve(xml);
        }
      } catch (exception) {
        reject(exception);
      }
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * This method is intended to be a drop-in replacement for the same method
   * in xslt4node.
   * @method transform
   * @static
   * @param {Object} transformSpec - Various parameter to be used to configure
   *   and perform the transformation:
   *     {string} [xsltPath] - Provide the path (URL) to the transform document
   *       if the specfied transform contains relative URLs in any <xsl:include>
   *       or <xsl:import>
   *     {string|XmlDoc} [xslt] - XSLT as XML or an XmlDOM Doc.
   *     {string} [sourcePath] - path to source (not used at this time)
   *     {string|XmlDoc} source - input document as XML or an XmlDOM doc.
   *     {string|Function} result - only a string is currently supported.
   *     params - list of parameters.
   *     props - not used.
   *     logger - object to log messages to - console is used if undefined
   *     debug - set to true for debug mode
   * @param {Function} callback - A callback function to call once the
   *   transformormation is complete. The callback takes two arguments. The
   *   first argument is any error message (as a string) or null if there is
   *   no error. The second argument is the output document as XML text.
   */
  static transform (
    transformSpec,
    callback
  ) {
    const DOMParser = new XmlDOM.DOMParser();
    const inputURL = transformSpec.sourcePath;
    const inputDoc = (typeof transformSpec.source === 'string') ? DOMParser.parseFromString(transformSpec.source) : transformSpec.source;
    const transformURL = transformSpec.xsltPath;
    const transform = (typeof transformSpec.xslt === 'string') ? DOMParser.parseFromString(transformSpec.xslt) : transformSpec.xslt;
    const params = transformSpec.params;
    const customFunctions = transformSpec.customFunctions || {};
    const debug = transformSpec.debug;
    const logger = transformSpec.logger || undefined;

    XSLT
      .process(inputDoc, transform, params, {
        inputURL: inputURL,
        transformURL: transformURL,
        customFunctions: customFunctions,
        debug: debug,
        logger: logger
      })
      .then(
        (resultXML) => {
          return callback(null, resultXML);
        },
        (exception) => {
          return callback(exception.toString(), null);
        }
      );
  }
};

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

XSLT.XsltContext = XsltContext;
XSLT.XPathNamespaceResolver = XPathNamespaceResolver;
XSLT.XPathVariableResolver = XPathVariableResolver;
XSLT.XPathFunctionResolver = XPathFunctionResolver;

exports.XSLT = XSLT;

// ----------------------------------------------------------------------------
