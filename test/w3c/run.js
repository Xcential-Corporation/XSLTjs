/**
 * @file run.js
 * @description Runs the XSLT 1.0 tests of the W3C XSLT test suite against XSLTjs.
 *
 * Usage:
 *   node test/w3c/run.js [--suite <dir>] [--set <name>] [--case <name>] [--report <file>] [--compare <file>]
 *
 * The suite is not part of this repository. Fetch it with `npm run fetch:w3c`,
 * which clones https://github.com/w3c/xslt30-test into .w3c/.
 */

'use strict';

// ----------------------------------------------------------------------------
// Imports & dependencies
// ----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { DOMParser } = require('@xmldom/xmldom');

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const CATALOG_NS = 'http://www.w3.org/2012/10/xslt-test-catalog';
const SET_TIMEOUT = 120000;
const CASE_TIMEOUT = 10000;

// Dependencies that an XSLT 1.0 processor is not expected to satisfy.
const UNSUPPORTED_FEATURES = [
  'schema_aware', 'streaming', 'higher_order_functions', 'XPath_3.1', 'XML_1.1',
  'backwards_compatibility', 'dynamic_evaluation', 'xquery_invocation',
  'Saxon-PE', 'Saxon-EE', 'serialization'
];

// ----------------------------------------------------------------------------
// Catalog reading
// ----------------------------------------------------------------------------

const parseXML = (text) => new DOMParser({ onError: () => {} }).parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');

const children = (node, localName) => {
  const result = [];
  for (let child = node && node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.namespaceURI === CATALOG_NS && (!localName || child.localName === localName)) {
      result.push(child);
    }
  }
  return result;
};

const child = (node, localName) => children(node, localName)[0] || null;

/**
 * Is a test case for XSLT 1.0, with no dependency we don't claim to satisfy?
 * @returns {string|null} null if it applies, or the reason it doesn't.
 */
const inScope = (testCase, testSet) => {
  const caseDeps = children(child(testCase, 'dependencies'), null);
  const caseHasSpec = caseDeps.some((d) => d.localName === 'spec');
  const setDeps = children(child(testSet, 'dependencies'), null).filter((d) => !(caseHasSpec && d.localName === 'spec'));
  const deps = [...setDeps, ...caseDeps];
  let specOK = false;
  let sawSpec = false;
  for (const dep of deps) {
    const value = dep.getAttribute('value') || '';
    const satisfied = dep.getAttribute('satisfied') !== 'false';
    if (dep.localName === 'spec') {
      sawSpec = true;
      if (value.split(/\s+/).some((v) => v === 'XSLT10' || v === 'XSLT10+')) {
        specOK = true;
      }
    } else if (dep.localName === 'feature') {
      if (satisfied && UNSUPPORTED_FEATURES.includes(value)) {
        return 'feature ' + value;
      }
      if (!satisfied && value === 'serialization') {
        return 'requires no serialization';
      }
    } else if (dep.localName === 'on-multiple-match' && value === 'error') {
      return 'on-multiple-match error';
    } else if (['year_component_values', 'default_language', 'languages', 'enable_assertions', 'additional_normalization_form', 'sweep_and_posture', 'default_html_version', 'combinations_for_numbering', 'ignore_doc_failure', 'default_calendar_in_date_formatting_functions', 'xsd-version', 'maximum_number_of_decimal_digits', 'supported_calendars_in_date_formatting_functions'].includes(dep.localName)) {
      if (satisfied) {
        return dep.localName;
      }
    }
  }
  if (!sawSpec || !specOK) {
    return 'not XSLT 1.0';
  }
  return null;
};

const collectCases = (suiteDir, filter) => {
  const catalog = parseXML(fs.readFileSync(path.join(suiteDir, 'catalog.xml'), 'utf-8'));
  const sets = [];
  for (const ref of children(catalog.documentElement, 'test-set')) {
    const setName = ref.getAttribute('name');
    if (filter.set && filter.set !== setName) {
      continue;
    }
    const file = path.join(suiteDir, ref.getAttribute('file'));
    const setDoc = parseXML(fs.readFileSync(file, 'utf-8'));
    const testSet = setDoc.documentElement;
    const cases = [];
    const skipped = [];
    for (const testCase of children(testSet, 'test-case')) {
      const name = testCase.getAttribute('name');
      if (filter.case && filter.case !== name) {
        continue;
      }
      const reason = inScope(testCase, testSet);
      if (reason) {
        skipped.push({ name, reason });
      } else {
        cases.push(name);
      }
    }
    if (cases.length || skipped.length) {
      sets.push({ setName, file, cases, skipped });
    }
  }
  return sets;
};

// ----------------------------------------------------------------------------
// Running a test set (in a worker)
// ----------------------------------------------------------------------------

const runSet = async ({ xsltPath, file, cases }) => {
  const { XSLT } = require(xsltPath);
  const { XMLSerializer } = require('@xmldom/xmldom');
  const XPath = require('xpath');

  // Let fetch() read local files, which the suite needs for include, import and document().
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if ((/^file:/).test(href) || !(/^[a-z]+:/i).test(href)) {
      const filePath = (/^file:/).test(href) ? new URL(href).pathname : href;
      const text = fs.readFileSync(decodeURIComponent(filePath), 'utf-8');
      return { ok: true, status: 200, text: async () => text };
    }
    return realFetch(url);
  };

  const quiet = { debug () {}, info () {}, warn () {}, error () {}, log () {} };
  const setDir = path.dirname(file);
  const setDoc = parseXML(fs.readFileSync(file, 'utf-8'));
  const environments = {};
  for (const env of children(setDoc.documentElement, 'environment')) {
    environments[env.getAttribute('name')] = env;
  }

  const results = [];
  for (const testCase of children(setDoc.documentElement, 'test-case')) {
    const name = testCase.getAttribute('name');
    if (!cases.includes(name)) {
      continue;
    }
    const started = Date.now();
    const outcome = await withTimeout(runCase(testCase), CASE_TIMEOUT).catch((e) => ({ status: 'error', detail: 'harness: ' + e.message + ' @ ' + String(e.stack).split('\n').slice(1, 4).join(' ') }));
    const ms = Date.now() - started;
    results.push({ name, ...outcome, ...(ms > 2000 ? { ms } : {}) });
  }
  return results;

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  async function runCase (testCase) {
    let envNode = child(testCase, 'environment');
    if (envNode && envNode.getAttribute('ref')) {
      envNode = environments[envNode.getAttribute('ref')] || null;
    }

    const test = child(testCase, 'test');
    const unsupported = ['initial-function', 'package', 'output', 'initial-template', 'initial-mode'];
    for (const node of children(test, null)) {
      if (node.localName === 'initial-template' || node.localName === 'initial-mode') {
        return { status: 'notrun', detail: node.localName };
      }
      if (unsupported.includes(node.localName) && node.localName !== 'output') {
        return { status: 'notrun', detail: node.localName };
      }
    }

    // Input document
    let inputText = '<dummy/>';
    let inputURL;
    const source = envNode && children(envNode, 'source').find((s) => s.getAttribute('role') === '.');
    if (source) {
      const content = child(source, 'content');
      if (content) {
        inputText = content.textContent;
      } else if (source.getAttribute('file')) {
        const sourceFile = path.join(path.dirname(envNode.ownerDocument === setDoc ? file : file), source.getAttribute('file'));
        inputText = fs.readFileSync(sourceFile, 'utf-8');
        inputURL = 'file://' + sourceFile;
      }
    }

    // Stylesheet
    const stylesheetNode = children(test, 'stylesheet').find((s) => !s.getAttribute('role') || s.getAttribute('role') === 'principal');
    if (!stylesheetNode) {
      return { status: 'notrun', detail: 'no principal stylesheet' };
    }
    const stylesheetFile = path.join(setDir, stylesheetNode.getAttribute('file'));
    const stylesheetText = fs.readFileSync(stylesheetFile, 'utf-8');

    // Parameters
    const params = {};
    for (const param of [...children(envNode, 'param'), ...children(test, 'param')]) {
      if (param.getAttribute('static') === 'yes') {
        continue;
      }
      const select = param.getAttribute('select') || '';
      const m = select.match(/^\s*(['"])(.*)\1\s*$/) || select.match(/^\s*(-?\d+(\.\d+)?)\s*$/);
      if (!m) {
        return { status: 'notrun', detail: 'param ' + select };
      }
      params[param.getAttribute('name')] = m[2] !== undefined && m[1] !== undefined && (/['"]/).test(m[1]) ? m[2] : m[1];
    }

    let output;
    let error;
    try {
      const inputDoc = parseXML(inputText);
      const transformDoc = parseXML(stylesheetText);
      output = await XSLT.process(inputDoc, transformDoc, params, {
        inputURL,
        transformURL: 'file://' + stylesheetFile,
        logger: quiet
      });
    } catch (e) {
      error = e;
    }

    const verdict = check(child(testCase, 'result'), output, error);
    return verdict;
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  function check (resultNode, output, error) {
    const asserts = children(resultNode, null);
    const outcomes = asserts.map((a) => assert(a, output, error));
    const failed = outcomes.find((o) => o.status !== 'pass');
    return failed || { status: 'pass' };
  }

  function assert (node, output, error) {
    switch (node.localName) {
      case 'all-of': {
        const parts = children(node, null).map((a) => assert(a, output, error));
        return parts.find((o) => o.status !== 'pass') || { status: 'pass' };
      }
      case 'any-of': {
        const parts = children(node, null).map((a) => assert(a, output, error));
        return parts.find((o) => o.status === 'pass') || parts.find((o) => o.status === 'fail') || parts[0];
      }
      case 'not': {
        const part = assert(children(node, null)[0], output, error);
        return part.status === 'pass' ? { status: 'fail', detail: 'not' } : (part.status === 'fail' ? { status: 'pass' } : part);
      }
      case 'error':
        return error ? { status: 'pass' } : { status: 'fail', detail: 'expected error ' + node.getAttribute('code') };
      case 'assert-message':
      case 'assert-result-document':
      case 'assert-warning':
      case 'assert-posture-and-sweep':
      case 'assert-type':
      case 'assert-deep-eq':
      case 'assert-count':
      case 'assert-eq':
      case 'assert-serialization-error':
        return { status: 'notrun', detail: node.localName };
    }

    if (error) {
      return { status: 'fail', detail: 'error: ' + String(error && error.message ? error.message : error).slice(0, 160) };
    }
    if (output === undefined || output === null) {
      return { status: 'fail', detail: 'no output' };
    }
    const text = String(output).replace(/^\s*<\?xml[^>]*\?>/, '');

    switch (node.localName) {
      case 'assert-xml': {
        const expected = node.getAttribute('file') ? fs.readFileSync(path.join(setDir, node.getAttribute('file')), 'utf-8') : node.textContent;
        const ignorePrologs = node.getAttribute('ignore-prefixes') === 'true';
        return sameXML(text, expected.replace(/^\s*<\?xml[^>]*\?>/, ''), ignorePrologs);
      }
      case 'assert-string-value': {
        const doc = parseXML('<wrapper>' + text + '</wrapper>');
        let actual = doc.documentElement ? doc.documentElement.textContent : text;
        let expected = node.textContent;
        if (node.getAttribute('normalize-space') === 'true') {
          actual = actual.replace(/\s+/g, ' ').trim();
          expected = expected.replace(/\s+/g, ' ').trim();
        }
        return actual === expected ? { status: 'pass' } : { status: 'fail', detail: 'string value' };
      }
      case 'assert-serialization': {
        const expected = node.getAttribute('file') ? fs.readFileSync(path.join(setDir, node.getAttribute('file')), 'utf-8') : node.textContent;
        const norm = (s) => s.replace(/^\s*<\?xml[^>]*\?>/, '').replace(/\s+/g, '');
        return norm(text) === norm(expected) ? { status: 'pass' } : { status: 'fail', detail: 'serialization' };
      }
      case 'serialization-matches': {
        try {
          const re = new RegExp(node.textContent, (node.getAttribute('flags') || '').replace(/[^imsx]/g, '').replace('x', ''));
          return re.test(String(output)) ? { status: 'pass' } : { status: 'fail', detail: 'serialization-matches' };
        } catch (e) {
          return { status: 'notrun', detail: 'regex' };
        }
      }
      case 'assert':
      case 'assert-true':
      case 'assert-false':
      case 'assert-empty': {
        const doc = parseXML('<_r_>' + text + '</_r_>');
        if (!doc.documentElement) {
          return { status: 'fail', detail: 'unparseable output' };
        }
        if (node.localName === 'assert-empty') {
          return doc.documentElement.childNodes.length === 0 ? { status: 'pass' } : { status: 'fail', detail: 'not empty' };
        }
        if (node.localName !== 'assert') {
          return { status: 'notrun', detail: node.localName };
        }
        // Evaluate the assertion with XPath 1.0 against the output, treating
        // the output as a document. Assertions that need XPath 2.0+ are not run.
        const frag = parseXML(text.trim().startsWith('<') ? text : '<_t_/>');
        try {
          const expr = node.textContent.trim();
          if ((/\b(every|some|instance of|cast|treat|eq|ne|lt|gt|le|ge|is|to|except|intersect|return|for|let|if)\b|\(:|\$result|=>|!(?!=)/).test(expr)) {
            return { status: 'notrun', detail: 'XPath 2.0 assertion' };
          }
          const value = XPath.select('boolean(' + expr + ')', frag.documentElement ? frag : doc);
          return value ? { status: 'pass' } : { status: 'fail', detail: 'assert ' + expr.slice(0, 80) };
        } catch (e) {
          return { status: 'notrun', detail: 'assertion not XPath 1.0' };
        }
      }
      default:
        return { status: 'notrun', detail: node.localName };
    }
  }

  function sameXML (actual, expected) {
    const a = parseXML('<_r_>' + actual + '</_r_>');
    const e = parseXML('<_r_>' + expected + '</_r_>');
    if (!a.documentElement) {
      return { status: 'fail', detail: 'output not well-formed' };
    }
    const strict = deepEqual(a.documentElement, e.documentElement, false);
    if (strict) {
      return { status: 'pass' };
    }
    const loose = deepEqual(a.documentElement, e.documentElement, true);
    return loose ? { status: 'pass', detail: 'whitespace differs' } : { status: 'fail', detail: 'XML differs: ' + new XMLSerializer().serializeToString(a.documentElement).slice(5, 200) };
  }

  function deepEqual (a, b, ignoreWhitespace) {
    const kids = (n) => {
      const out = [];
      let text = null;
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 || c.nodeType === 4) {
          text = (text || '') + c.nodeValue;
          continue;
        }
        if (text !== null) {
          out.push({ nodeType: 3, nodeValue: text });
          text = null;
        }
        if (c.nodeType === 1 || c.nodeType === 7 || c.nodeType === 8) {
          out.push(c);
        }
      }
      if (text !== null) {
        out.push({ nodeType: 3, nodeValue: text });
      }
      return ignoreWhitespace ? out.filter((c) => c.nodeType !== 3 || c.nodeValue.trim()) : out;
    };
    if (a.nodeType !== b.nodeType) {
      return false;
    }
    if (a.nodeType === 3) {
      return ignoreWhitespace ? a.nodeValue.trim() === b.nodeValue.trim() : a.nodeValue === b.nodeValue;
    }
    if (a.nodeType === 7) {
      return a.target === b.target && a.data.trim() === b.data.trim();
    }
    if (a.nodeType === 8) {
      return a.data === b.data;
    }
    if (a.localName !== b.localName || (a.namespaceURI || '') !== (b.namespaceURI || '')) {
      return false;
    }
    const attrs = (n) => {
      const m = {};
      for (let i = 0; i < n.attributes.length; i++) {
        const at = n.attributes[i];
        if (at.name === 'xmlns' || at.prefix === 'xmlns') {
          continue;
        }
        m['{' + (at.namespaceURI || '') + '}' + (at.localName || at.name)] = at.value;
      }
      return m;
    };
    const aa = attrs(a);
    const ba = attrs(b);
    if (Object.keys(aa).length !== Object.keys(ba).length || Object.keys(aa).some((k) => aa[k] !== ba[k])) {
      return false;
    }
    const ak = kids(a);
    const bk = kids(b);
    return ak.length === bk.length && ak.every((c, i) => deepEqual(c, bk[i], ignoreWhitespace));
  }
};

const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'fail', detail: 'timeout' }), ms);
    })
  ]);
};

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

const main = async () => {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return (i >= 0) ? args[i + 1] : fallback;
  };
  const suiteDir = path.resolve(opt('suite', path.join(__dirname, '..', '..', '.w3c')));
  const xsltPath = path.resolve(opt('engine', path.join(__dirname, '..', '..', 'scripts', 'XSLT.js')));
  const reportFile = opt('report', null);
  const compareFile = opt('compare', null);
  if (!fs.existsSync(path.join(suiteDir, 'catalog.xml'))) {
    console.error('W3C test suite not found at ' + suiteDir + '. Run `npm run fetch:w3c` first.');
    process.exit(2);
  }

  const sets = collectCases(suiteDir, { set: opt('set'), case: opt('case') });
  const report = { engine: xsltPath, date: new Date().toISOString(), sets: {} };
  const totals = { pass: 0, fail: 0, error: 0, notrun: 0, skipped: 0 };

  for (const set of sets) {
    totals.skipped += set.skipped.length;
    if (!set.cases.length) {
      continue;
    }
    const results = await new Promise((resolve) => {
      const worker = new Worker(__filename, { workerData: { xsltPath, file: set.file, cases: set.cases } });
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(set.cases.map((name) => ({ name, status: 'fail', detail: 'set timeout' })));
      }, SET_TIMEOUT);
      worker.on('message', (msg) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(msg);
      });
      worker.on('error', (e) => {
        clearTimeout(timer);
        resolve(set.cases.map((name) => ({ name, status: 'error', detail: 'worker: ' + e.message })));
      });
    });
    report.sets[set.setName] = results;
    const counts = { pass: 0, fail: 0, error: 0, notrun: 0 };
    for (const r of results) {
      counts[r.status]++;
      totals[r.status]++;
    }
    console.log(set.setName.padEnd(28) + ' pass ' + String(counts.pass).padStart(4) + '  fail ' + String(counts.fail + counts.error).padStart(4) + '  not run ' + String(counts.notrun).padStart(4));
  }

  const run = totals.pass + totals.fail + totals.error;
  console.log('\nXSLT 1.0 tests run: ' + run + '  passed: ' + totals.pass + ' (' + (run ? (100 * totals.pass / run).toFixed(1) : 0) + '%)  failed: ' + (totals.fail + totals.error) + '  not run: ' + totals.notrun + '  out of scope: ' + totals.skipped);
  report.totals = totals;

  if (compareFile) {
    const before = JSON.parse(fs.readFileSync(compareFile, 'utf-8'));
    const regressions = [];
    for (const [setName, results] of Object.entries(report.sets)) {
      for (const r of results) {
        const old = (before.sets[setName] || []).find((o) => o.name === r.name);
        if (old && old.status === 'pass' && r.status !== 'pass') {
          regressions.push(setName + '/' + r.name + ': ' + (r.detail || r.status));
        }
      }
    }
    console.log('Regressions against ' + path.basename(compareFile) + ': ' + regressions.length);
    regressions.slice(0, 50).forEach((r) => console.log('  ' + r));
    if (regressions.length) {
      process.exitCode = 1;
    }
  }

  if (reportFile) {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
  }
};

if (isMainThread) {
  main();
} else {
  runSet(workerData).then((results) => parentPort.postMessage(results), (e) => parentPort.postMessage(workerData.cases.map((name) => ({ name, status: 'error', detail: 'worker: ' + e.message }))));
}
