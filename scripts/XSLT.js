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
 * Note: This is a partial implements of XSLT 1.0 and 2.0. Elements, attribute,
 *   and functions are being implemented on an as needed basis.
 *
 * Note: (meschkat) XSLT processing, according to the specification, is defined
 *   as operations on text documents, not as operations on DOMtrees. So,
 *   strictly speaking, this implementation is not an XSLT processor, but
 *   the processing engine that needs to be complemented by an XML parser and
 *   serializer in order to be complete.
 */

'use strict';

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

const XmlDOM = require('xmldom');
const { XsltContext } = require('./XsltContext');

// -----------------------------------------------------------------------------
/*
 * @class XSLT
 * @classdesc Primary class for the XSLT engine.
 */
var XSLT = class {

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Primary entry point for processing the stylesheet.
   * @method process
   * @static
   * @param {XmlDocument} inputDoc - The input document root, as DOM node.
   * @param {XmlDocument} stylesheet - The stylesheet document root, as DOM node.
   * @param {Object} params - An object of name/value parameters
   * @returns the processed document, as XML text in a string.
   */
  static process (
    inputDoc,
    stylesheet,
    params = {}
  ) {
    return new Promise((resolve, reject) => {
      try {
        const xmlSerializer = new XmlDOM.XMLSerializer();
        const fragmentNode = inputDoc.createDocumentFragment();

        const xsltContext = new XsltContext(inputDoc.documentElement, { variables: params });
        xsltContext.process(stylesheet.documentElement, fragmentNode);
        let xml = xmlSerializer.serializeToString(fragmentNode).replace(/\n\s*/g, '\n');
        if (XsltContext.output) {
          if (XsltContext.output.omitXmlDeclaration && XsltContext.output.omitXmlDeclaration.toLowerCase() !== 'yes') {
            let xmlDecl = '<?xml';
            xmlDecl += ' version="' + (XsltContext.output.version || '1.0') + '"';
            xmlDecl += ' encoding="' + (XsltContext.output.encoding || 'UTF-8') + '"';
            xmlDecl += ' standalone="' + (XsltContext.output.standalone || 'no') + '"';
            xmlDecl += '?>\n';
            xml = xmlDecl + xml;
          }
        }
        resolve(xml);
      } catch (exception) {
        reject(exception);
      }
    });
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * This method is intended to be a drop-in replacement for the same method
   * in xslt4node. However,
   *
   * @method transform
   * @static
   * @param {Object} transformSpec - Various parameter to be used to configure
   *   and perform the transformation -- as defined by xslt4node. As an
   *   optimization, DOM documents (XmlDOM) can be passed in using the inputDoc
   *   and stylesheet properties in the transformSpec. This is an extension of
   *   the xslt4node transformSpec.
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
    const inputDoc = transformSpec.inputDoc || DOMParser.parseFromString(transformSpec.source);
    const stylesheet = transformSpec.stylesheet || DOMParser.parseFromString(transformSpec.xslt);
    const params = transformSpec.params;
    XSLT
      .process(inputDoc, stylesheet, params)
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

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XSLT = XSLT;

// -----------------------------------------------------------------------------
