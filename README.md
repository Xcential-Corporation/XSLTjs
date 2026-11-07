# XSLTjs

> A complete XSLT 1.0 processor written entirely in JavaScript.

[![NPM Version][npm-image]][npm-url]
[![Downloads Stats][npm-downloads]][npm-url]

## Introduction

XSLTjs implements XSLT 1.0 in plain JavaScript, with no C++, C#, or Java
binding. It runs in Node.js and uses the XmlDOM and XPath modules from npm
for the document model and XPath 1.0 expressions.

* All XSLT 1.0 instructions, declarations and functions
* Template conflict resolution by import precedence and priority, as the
  specification defines it, with xsl:import and xsl:apply-imports
* Keys, with an index built once per document
* The xml, html and text output methods
* Clear errors, with the W3C error code, the stylesheet file and the line
* Drop-in compatibility with xslt4node
* A few XPath 2.0 string functions and xsl:function, kept from earlier versions

XSLTjs is tested against the XSLT 1.0 tests of the
[W3C XSLT test suite](https://github.com/w3c/xslt30-test). It passes 94% of
them. Most of the rest need XPath 2.0, which is outside the scope of an XSLT 1.0
processor; see [Conformance](#conformance).

## Installation

```sh
npm install xsltjs --save
```

XSLTjs needs Node.js 18 or later.

## Usage

### Transform a document

```javascript
const { XSLT } = require('xsltjs');

const resultXML = await XSLT.process(inputXML, stylesheetXML, { title: 'My Document' }, {
  inputURL: 'file:///data/input.xml',
  transformURL: 'file:///xsl/main.xsl'
});
```

The input and the stylesheet can be given as XML text or as DOM documents. The
third argument holds values for the stylesheet's global parameters, by name.
The result is text, serialized as the stylesheet's `xsl:output` says.

### Compile once, run many times

```javascript
const stylesheet = await XSLT.compile(stylesheetXML, { transformURL });
const first = XSLT.run(stylesheet, firstInput, params);
const second = XSLT.run(stylesheet, secondInput, params);
```

`XSLT.run()` is synchronous.

### The xslt4node API

```javascript
XSLT.transform({
  source: inputXML,
  xslt: stylesheetXML,       // or xsltPath: 'main.xsl'
  result: String,
  params: { docName: 'My Document' }
}, (errorMessage, resultXML) => { ... });
```

### Options

| Option | Purpose |
| --- | --- |
| `inputURL` | Where the input came from, for `document()` with relative URIs. |
| `transformURL` | Where the stylesheet came from, for `xsl:include`, `xsl:import` and `document()`. |
| `loader` | `async (uri) => text`, to load included and imported modules. By default, files are read from disk and http(s) URLs are fetched. |
| `documentLoader` | `(uri) => Document or text`, to load documents for `document()`. By default, files are read from disk; http(s) needs a loader, because `document()` runs synchronously. |
| `customFunctions` | Functions to call from XPath expressions, by namespace URI and name. |
| `onMessage` | `(text, terminate) => void`, called for each `xsl:message`. By default, messages go to the logger. |
| `initialTemplate` | The name of a template to start with, instead of applying templates to the root. |
| `initialMode` | The mode to start in. |
| `output` | Settings that override `xsl:output`, such as `{ method: 'xml' }`. |
| `reportConflicts` | Log a warning wherever template conflict resolution picks a rule other than the first matching rule in the stylesheet. Useful when upgrading from 0.0.x. |
| `debug` | Log the time each transformation takes. |
| `logger` | Where to log. The console by default. |

### Custom functions

Each custom function is called with the XPath context and its argument
expressions. Evaluate an argument to get its value. Return a JavaScript string,
number, boolean or node, or an XPath value; `this.XPath` is the xpath module.

```javascript
const customFunctions = {
  'http://www.example.com/functions': {
    formatDate: function (xPathContext, dateExpr) {
      const date = new Date(dateExpr.evaluate(xPathContext).stringValue());
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }
};
```

## Conformance

XSLTjs implements XSLT 1.0 in full:

* Instructions: apply-imports, apply-templates, attribute, call-template,
  choose, comment, copy, copy-of, element, fallback, for-each, if, message,
  number, processing-instruction, sort, text, value-of, variable
* Declarations: attribute-set, decimal-format, import, include, key,
  namespace-alias, output, param, preserve-space, strip-space, template,
  variable
* Functions: current, document, element-available, format-number,
  function-available, generate-id, key, system-property,
  unparsed-entity-uri, and the XPath 1.0 core library
* Simplified stylesheets, forwards-compatible processing and xsl:fallback

Of the W3C XSLT test suite's tests that apply to XSLT 1.0, XSLTjs passes 94%.
Most of the tests it fails are written with XPath 2.0 syntax (such as `eq`,
`for`, `instance of` or `0e0` numbers) or expect XSLT 2.0 results. The others
are known limitations:

* The XPath engine does not accept a few unusual spellings, such as
  `child :: x` with spaces around `::`.
* `id()` only finds attributes named `id`; IDs declared in a DTD are not used,
  and neither are entities declared in a DTD. `unparsed-entity-uri()` always
  returns an empty string.
* `number('')` returns 0 rather than NaN, and `lang()` does not match
  language subcodes.

Extensions kept from earlier versions:

* The XPath 2.0 functions `replace()`, `matches()`, `lower-case()`,
  `upper-case()`, `ends-with()`, `string-join()` and `tokenize()`
* `xsl:function`, returning a string unless its body is `xsl:sequence` or its
  `as` type names nodes
* `xsl:debug`, which logs the context node and an optional `select` value
* `counter()`, which returns 1, 2, 3 and so on with each call
* A parameter passed by the caller can be used as a variable even if the
  stylesheet does not declare it
* A leading `./` in a pattern is ignored, so `./a` matches as `a` does

Apart from these extensions, XSLTjs does not support XSLT 2.0. A stylesheet
that needs XSLT 2.0 instructions such as `xsl:analyze-string`,
`xsl:for-each-group`, `xsl:next-match` or `xsl:character-map`, or XPath 2.0
functions such as `resolve-uri()` and `base-uri()`, or XPath 2.0 expressions
such as `for`, `some` and `every`, needs an XSLT 2.0 or 3.0 processor. In a
stylesheet with `version="2.0"`, XSLTjs runs `xsl:fallback` for an
instruction it does not know, and raises an error if there is none.

## Upgrading from 0.0.x

Version 1.0 is a new engine that follows the XSLT 1.0 specification. Most
stylesheets give the same result, faster, but some behaviors of 0.0.x that
did not follow the specification have changed:

* **Template conflicts.** 0.0.x used the first matching template in the
  stylesheet. 1.0 uses import precedence, then priority, then the last in the
  stylesheet. A template like `match="*[num]"` (priority 0.5) now wins over
  `match="part"` (priority 0), wherever each appears. Run with `reportConflicts: true` to
  list the places where the choice changed, and add `priority` attributes
  where the earlier choice was intended.
* **The root.** Expressions and patterns now start from the document node, so
  `match="/"` and relative paths from it behave as the specification says.
* **Built-in rules.** An element with no matching template now has its
  children processed; 0.0.x dropped it.
* **Attribute value templates.** `{{` and `}}` now give single braces.
  0.0.x left them doubled.
* **Whitespace in the stylesheet.** Text that is only whitespace is removed
  from the stylesheet, even when written as `&#32;`. Use `xsl:text` to output
  a space.
* **Namespaces in the result.** Literal result elements copy the namespaces
  in scope in the stylesheet, as the specification requires. Use
  `exclude-result-prefixes` to leave out the ones you don't want.
* **Output methods.** `method="html"` and `method="text"` are now honored;
  0.0.x always wrote XML. Pass `output: { method: 'xml' }` to keep XML.
* **The attribute axis** no longer returns namespace declarations; use
  `namespace::*` for those.
* **generate-id()** returns the same identifier for the same node, as the
  specification requires; 0.0.x returned a random value each time.
* **Errors** are thrown as `XsltError`, with a `code` and the stylesheet
  `location`. An empty result no longer leaves the promise unresolved.

## Performance

1.0 interprets the stylesheet directly, with expressions and patterns
compiled once and template rules indexed by name, and it runs synchronously.
On real-world legislative documents it ran up to ten times faster than
0.0.75, and typically three to eight times faster.

## Development

```sh
npm test            # unit tests
npm run lint        # semistandard
npm run fetch:w3c   # clone the W3C XSLT test suite into .w3c/
npm run test:w3c    # run its XSLT 1.0 tests, failing on any regression
```

`test/w3c/expected.json` records which W3C tests pass. Running
`node test/w3c/run.js --report test/w3c/expected.json` updates it.

## Acknowledgements

XSLTjs began as a reworking of [AJAXSLT](https://github.com/4031651/ajaxslt),
developed by Steffen Meschkat at Google around 2005. Version 1.0 is a new
engine, written for Node.js.

## References

* [XSLT 1.0](https://www.w3.org/TR/1999/REC-xslt-19991116)
* [XPath 1.0](https://www.w3.org/TR/1999/REC-xpath-19991116/)
* [W3C XSLT test suite](https://github.com/w3c/xslt30-test)

## Release History

* 1.0.0
  * A new engine that implements XSLT 1.0 in full: template conflict
    resolution by import precedence and priority, xsl:apply-imports, keys,
    xsl:number, xsl:message, attribute sets, namespace aliases, xsl:fallback,
    whitespace stripping, and the xml, html and text output methods
  * Patterns are matched directly, step by step, instead of by selection
  * Corrections to the xpath module's following, preceding, namespace and
    attribute axes, applied only within XSLTjs
  * Errors carry W3C error codes and stylesheet locations
  * XSLT.compile() and XSLT.run(), to compile a stylesheet once
  * Unit tests, a W3C test suite runner and GitHub Actions
  * Updates dependencies; needs Node.js 18 or later
  * See "Upgrading from 0.0.x" for changes in behavior

* 0.0.75
  * Handles DOM fragment as a variable

* 0.0.74
  * Removes unnecessary console.log() statements
  * Prevents xPath evaluation of select statements that retrieve single variable values

* 0.0.73
  * Fixes misnamed variable

* 0.0.72
  * Fixes special case where select = '.'

* 0.0.71
  * More adaptations to changes coming from the underlying DOM implementation

* 0.0.70
  * More adaptations to changes coming from the underlying DOM implementation

* 0.0.69
  * Bug fixes

* 0.0.68
  * Removes xpath() extension (too problematic)

* 0.0.67
  * Fixes xpath evaluation

* 0.0.66
  * Fixes misnamed variable

* 0.0.65
  * Fixes misnamed variable

* 0.0.64
  * Updates dependencies

* 0.0.63
  * Removes console.log() statement

* 0.0.62
  * More reworking of variable retrieval
  * Adds xpath() XPath extension

* 0.0.61
  * Reverts childNodes iteration

* 0.0.59
  * Second attempt for variable retrival fix
  * Adds debug extension
  * Sonarlinting
  * Adds name() XPath function

* 0.0.58
  * Fixes variable retrieval

* 0.0.57
  * Fixes test for variable when not present

* 0.0.56
  * Fixes test for variable when not present

* 0.0.55
  * Fixes function-available test

* 0.0.53
  * Fixes copying attributes in a different namespace

* 0.0.52
  * Fixes problem exiting child loops too early when processing XSLT nodes

* 0.0.51
  * Fixes problem exiting child loops too early when processing XSLT nodes

* 0.0.50
  * Fixes reference to DOM Parser

* 0.0.49
  * Fixes faulty edge conditions which arose from an update to @xmldom/xmldom

* 0.0.48
  * Fixes faulty edge conditions which arose from an update to @xmldom/xmldom

* 0.0.47
  * Fixes broken dependency

* 0.0.46
  * Updates dependencies
  * Updates version number

* 0.0.45
  * Fix for xsl:copy-of of attributes
  * Fix for xlt:transform root level matches

* 0.0.44
  * Adds a non-standard counter function

* 0.0.43
  * Removes workaround to problem working with boolean variables (0.0.39)

* 0.0.42
  * Removes workaround to problem working with boolean variables (0.0.39)

* 0.0.41
  * Fix to prevent temporary text from appearing in a document
  * Bumps various dependencies

* 0.0.40
  * Bumps version number

* 0.0.39
  * Adds workaround to working with non-string variables
  * Bumps various dependencies

* 0.0.38
  * Corrects problem processing some variables
  * Incorporates updates to node-fetch and iodash

* 0.0.37
  * Corrects NPM release issue

* 0.0.36
  * Synchronizes version numbers

* 0.0.35
  * Fixes problem copying from one DOM document to another

* 0.0.34
  * Fixes problem with upper and lower case functions

* 0.0.33
  * Improved compliance to semistandard conventions
  * Republish to address Github/NPM synchronization issues
  * Fixes problem with upper and lower case functions

* 0.0.32
  * Republish to address Github/NPM synchronization issues

* 0.0.31
  * Fixes problem with values coerced into numbers
  * Fixes problem extracting values from attributes in variables

* 0.0.30
  * Adds support for node-sets in variables
  * Adds support for xPath processing of variables
  * Adds asynchronous support for loading XML documents into variables
  * Modifications in naming to make code clearer to read
  * (Pull request merge) Set contextSize to nodeList length

* 0.0.29
  * Improved documentation for custom functions
  * Improved handling of position() function
  * Improved search for custom functions
  * Corrects retrieval of value of 0 with variable/parameters (was converting to an empty string)
  * Fixes problem with double xml declaration in some cases
  * Improved management of context objects when traversing the transform document
  * Corrects problems normalizing non-string values
  * Corrects problems storing non-string values
  * Improves chaining of variable namespaces
  * Cleans up unused code
  * Improved whitespace handling
  * Adds disable-output-escape support to xsl:value-of
* 0.0.28
  * Corrects problem with xsl:copy of comments.
* 0.0.27
  * Corrects problem with xsl:copy of processing instructions.
* 0.0.26
  * Corrects problem with xsl:output not always being seen.
* 0.0.25
  * Removes WORK IN PROGRESS notice
* 0.0.24
  * Adds workaround to strange problem in DOM processor where text nodes with a value of 'false' disappear.
* 0.0.23
  * Replaces request with Fetch API calls (request seems problematic with promises using Node.js 12.0).
* 0.0.22
  * Fixes issues with @omit-xml-declaration.
  * Implements @disable-output-escaping.
* 0.0.21
  * Provides mechanism to control where and what is logged.
  * Better global state management
* 0.0.20
  * Adds support for flags in XPath replace function.
  * Adds support for xsl:strip-space and xsl:preserve-space.
  * Further improves whitespace handling.
* 0.0.19
  * Improves whitespace handling.
  * Improves context management of variables.
* 0.0.18
  * Adds a mechanism to use custom JavaScript functions.
* 0.0.17
  * Fixes problem when xPath position() function is used standalone
    rather than as part of a predicate.
* 0.0.16
  * Fixes problem with root handling.
* 0.0.15
  * Minor documentation update.
* 0.0.14
  * Fixes problems with excessive aync/await usage.
  * Fixes problem xPath processing namespaces.
* 0.0.13
  * Adds workaround to apparent bug in xpath module's support for
    namespace axes.
  * Better handling of root node.
* 0.0.12
  * Bug fixes for xsl:comment and include/imports.
* 0.0.11
  * Cleanup.
* 0.0.10
  * Improved XPath handling.
* 0.0.9
  * Lots of performance optimizations.
  * Addition of debug performance metrics.
  * Bug fixes.
* 0.0.8
  * Corrects problem with nodeList naming.
* 0.0.7
  * Documentation corrections.
* 0.0.6
  * Implements include/import.
  * Bug fixes.
* 0.0.5
  * Implements functions.
  * Bug fixes.
* 0.0.1
  * Work in progress.


## Meta

Grant Vergottini - grant.vergottini@xcential.com

Distributed under the MIT license. See ``LICENSE`` for more information.

[https://github.com/Xcential-Corporation/XSLTjs](https://github.com/Xcential-Corporation/XSLTjs)

## Contributing

1. Fork it (<https://github.com/Xcential-Corporation/XSLTjs/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Run `npm test`, `npm run lint` and `npm run test:w3c`
4. Commit your changes (`git commit -am 'Add some fooBar'`)
5. Push to the branch (`git push origin feature/fooBar`)
6. Create a new Pull Request

<!-- Markdown link & img dfn's -->
[npm-image]: https://img.shields.io/npm/v/xsltjs.svg?style=flat-square
[npm-url]: https://npmjs.org/package/xsltjs
[npm-downloads]: https://img.shields.io/npm/dm/xsltjs.svg?style=flat-square
