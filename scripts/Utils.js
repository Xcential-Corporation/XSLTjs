/**
 * @file Utils.js - Utilities (Internal Object)
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports
// ----------------------------------------------------------------------------

const { XsltLog } = require('./XsltLog');

// ----------------------------------------------------------------------------
/*
 * Gathers performance metrics for optimizing XSL transforms. Enable using the
 * debug property available via the transformSpec for XSLT.transform() or the
 * debug option for XSLT.process().
 * @class Utils
 * @classDesc Internal utilities
 */
class Utils {

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Reports a node identifier, primarily for debugging.
   * @method identify
   * @memberof Utils
   * @static
   * @param {Node} node - The node to report on
   * @returns - A string identifier
   */
  static identify (
    node
  ) {
    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        let attributes = '';
        for (let i = 0; i < node.attributes.length; i++) {
          let attribute = node.attributes[i];
          attributes += ' ' + attribute.nodeName + '="' + attribute.nodeValue + '"';
        }
        return '<' + node.nodeName + attributes + '>';
      case Node.ATTRIBUTE_NODE:
        return '@' + node.nodeName;
      case Node.TEXT_NODE:
        return '{text}';
      case Node.PROCESSING_INSTRUCTION_NODE:
        return '<?' + node.target + '?>';
      case Node.COMMENT_NODE:
        return '<!-- comment -->';
      case Node.DOCUMENT_NODE:
        return '{document}';
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Retrieves text from a URL and saves to a cache for later use
   * @method fetch
   * @memberof Utils
   * @static
   * @param {string} url - The URL to retrieve from
   * @returns - The text retrieved (or a promise still to be fulfilled)
   */
  static async fetch (
    url
  ) {
    if (!global._fetchCache) {
      global._fetchCache = {};
    }

    let srcXML = null;

    if (global._fetchCache[url]) {
      srcXML = global._fetchCache[url];
    } else {
      let response = await fetch(url)
      srcXML = response.text();

      global._fetchCache[url] = srcXML;
    }

    return srcXML;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Measures call count and duration of an synchronous call.
   * @method measure
   * @memberof Utils
   * @static
   * @param {string} name - The name to report as.
   * @param {Function} callback - The function call being measured.
   * @returns - The value returned by the callback
   */
  static measure (
    name,
    callback,
    options = {}
  ) {
    if (!global._measures) {
      global._measures = {};
      global._measureStack = [];
    }

    global._measureStack.push({
      startTime: Date.now(),
      innerTime: 0
    });
    try {
      return callback();
    } catch (exception) {
      throw exception;
    } finally {
      let startInfo = global._measureStack.pop();
      startInfo.duration = Date.now() - startInfo.startTime;
      if (global._measureStack.length > 0) {
        global._measureStack[global._measureStack.length - 1].innerTime += startInfo.duration;
      }

      global._measures[name] = global._measures[name] || { count: 0, duration: 0 };
      global._measures[name].count++;
      global._measures[name].duration = global._measures[name].duration + startInfo.duration - startInfo.innerTime;
    }
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * Measures call count and duration of an asynchronous call.
   * @method measureAsync
   * @memberof Utils
   * @static
   * @param {string} name - The name to report as.
   * @param {Function} callback - The function call being measured.
   * @returns - The (asynchronous) value returned by the callback
   */
  static async measureAsync (
    name,
    callback
  ) {
    if (!global._measures) {
      global._measures = {};
      global._measureStack = [];
    }

    global._measureStack.push({
      startTime: Date.now(),
      innerTime: 0
    });
    try {
      return await callback();
    } catch (exception) {
      throw exception;
    } finally {
      let startInfo = global._measureStack.pop();
      startInfo.duration = Date.now() - startInfo.startTime;
      if (global._measureStack.length > 0) {
        global._measureStack[global._measureStack.length - 1].innerTime += startInfo.duration;
      }

      global._measures[name] = global._measures[name] || { count: 0, duration: 0 };
      global._measures[name].count++;
      global._measures[name].duration = global._measures[name].duration + startInfo.duration - startInfo.innerTime;
    }
  }

  // --------------------------------------------------------------------------
  /*
   * Reports performance metrics that have been gathered.
   * @method reportMeasures
   * @memberOf Utils
   * @static
   */
  static reportMeasures () {
    if (global._measures) {
      let logger = XsltLog.logger;
      logger.debug('# -----------------------------------------------------');
      let totalDuration = 0;
      for (const key in global._measures) {
        const measure = global._measures[key];
        totalDuration += measure.duration;
        logger.debug('# ' + key + ': ' + measure.count + ' calls, ' + measure.duration + ' millisecs');
      }
      logger.debug('# -----------------------------------------------------');
      logger.debug('# Total measured duration: ' + totalDuration + ' millisecs');
      logger.debug('# -----------------------------------------------------');
    }
  }
}

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.Utils = Utils;

// ----------------------------------------------------------------------------
