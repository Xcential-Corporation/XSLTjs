/**
 * @file Utils.js - Utilities (Internal Object)
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
 * Gathers performance metrics for optimizing XSL transforms. Enable using the
 * debug property available via the transformSpec for XSLT.transform() or the
 * debug option for XSLT.process().
 * @class Utils
 * @classDesc Internal utilities
 */
class Utils {
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

  // -----------------------------------------------------------------------------
  /*
   * Reports performance metrics that have been gathered.
   * @method reportMeasures
   * @memberOf Utils
   * @static
   */
  static reportMeasures () {
    if (global._measures) {
      console.debug('# -----------------------------------------------------');
      let totalDuration = 0;
      for (const key in global._measures) {
        const measure = global._measures[key];
        totalDuration += measure.duration;
        console.debug('# ' + key + ': ' + measure.count + ' calls, ' + measure.duration + ' millisecs');
      }
      console.debug('# -----------------------------------------------------');
      console.debug('# Total measured duration: ' + totalDuration + ' millisecs');
      console.debug('# -----------------------------------------------------');
    }
  }
}

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.Utils = Utils;

// ----------------------------------------------------------------------------
