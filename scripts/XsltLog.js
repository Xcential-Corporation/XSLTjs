/**
 * @file XsltLog.js - Logger Facade
 * @author {@link mailto:grant.vergottini@xcential.com Grant Vergottini}
 * @version 1.0
 * @copyright &copy; 2019 -- {@link http://xcential.com Xcential Corp.}
 */

'use strict';

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
/*
 * @class XsltLog
 * @classDesc Logging facade
 */
class XsltLog {

  /*
   * Boolean value to control the debug and "silly" message levels.
   * @property debugMode
   * @static
   * @type {boolean}
   */
  static get debugMode () {
    return XsltLog._debugMode || false;
  }
  static set debugMode (
    value
  ) {
    XsltLog._debugMode = value;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
   * By default, the XSLT engine logger all messages to the console. This can
   * be controlled by specifying a logger object in the transformSpec of the
   * master transform() function or as an option when creating calling the
   * XSLT.process() function. The logger option should mimic the console
   * object's methods. However, any method not provided will instead become
   * a null method -- meaning that messages emitted by that level will go
   * to the bit bucket and not show. Specifying an empty object or null for
   * the logger will result no messages being emitted. The debug and "silly"
   * levels can be deactivated by setting the debugMode to false.
   * @property logger
   * @static
   * @type {Object}
   */
  static get logger () {
    return {
      info: (XsltLog._logger && XsltLog.info)
        ? XsltLog._logger.info : (message) => {},
      warn: (XsltLog._logger && XsltLog.warn)
        ? XsltLog._logger.warn : (message) => {},
      error: (XsltLog._logger && XsltLog.error)
        ? XsltLog._logger.error : (message) => {},
      debug: (XsltLog.debugMode && XsltLog._logger)
        ? XsltLog._logger.debug : (message) => {},
      silly: (XsltLog.debugMode && XsltLog._logger && XsltLog.silly)
        ? XsltLog._logger.silly : (message) => {}
    };
  }
  static set logger (
    value
  ) {
    XsltLog._logger = value;
  }
}

// -----------------------------------------------------------------------------

XsltLog._logger = console;

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

exports.XsltLog = XsltLog;

// -----------------------------------------------------------------------------
