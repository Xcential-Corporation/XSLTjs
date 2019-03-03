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
 * @class Utils
 * @classDesc Internal utilities
 */
class Utils {
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  /*
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
   */
  static reportMeasures () {
    if (global._measures) {
      for (const key in global._measures) {
        console.debug('# ' + key + ': ' + global._measures[key].count + ' calls, ' + global._measures[key].duration / 1000 + ' seconds');
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------

exports.Utils = Utils;

// ----------------------------------------------------------------------------
