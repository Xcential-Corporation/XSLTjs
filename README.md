# XSLTjs

> An XSLT 1.0+ implementation written entirely in JavaScript.

[![NPM Version][npm-image]][npm-url]
[![Downloads Stats][npm-downloads]][npm-url]

## Introduction

THIS MODULE IS STILL A WORK IN PROGRESS

This is a partial implementation of XSLT 1.0 and XSLT 2.0.
Among its features:

* Pure 100% JavaScript implementation requiring no C++, C#, or Java binding
* Support for XML namespaces
* Support for include/import
* Support for XSL-T functions
* Drop-in compatibility with xslt4node

### XSLT elements supported

* &lt;xsl:apply-templates&gt;
* &lt;xsl:attribute&gt;
* &lt;xsl:call-template&gt;
* &lt;xsl:choose&gt;
* &lt;xsl:comment&gt;
* &lt;xsl:copy&gt;
* &lt;xsl:copy-of&gt;
* &lt;xsl:decimal-format&gt;
* &lt;xsl:element&gt;
* &lt;xsl:for-each&gt;
* &lt;xsl:function&gt;
* &lt;xsl:if&gt;
* &lt;xsl:import&gt;
* &lt;xsl:include&gt;
* &lt;xsl:otherwise&gt;
* &lt;xsl:output&gt;
* &lt;xsl:param&gt;
* &lt;xsl:preserve-space&gt;
* &lt;xsl:processing-instruction&gt;
* &lt;xsl:sort&gt;
* &lt;xsl:strip-space&gt;
* &lt;xsl:stylesheet&gt;
* &lt;xsl:transform&gt;
* &lt;xsl:template&gt;
* &lt;xsl:text&gt;
* &lt;xsl:value-of&gt;
* &lt;xsl:variable&gt;
* &lt;xsl:when&gt;
* &lt;xsl:with-param&gt;

### XSLT XPath functions supported (beyond those from the XPath module)

* function-available()
* current()
* document()
* format-number()
* replace()
* lower-case()
* upper-case()
* matches()
* generateId()

## Acknowledgements

XSLTjs is based on [AJAXSLT](https://github.com/4031651/ajaxslt),
originally developed by Steffen Meschkat at Google. That version was
developed around 2005 as a stopgap solution for "fat web pages" at a
time when XSLT processors weren't found in all web browsers.

This version is a substantial reworking of that original work for use
in Node.js (other uses will need accommodation). Below is a partial list
of enhancements:

* Substantial rewrite to ES2015 standards
* Formatting of JavaScript to SemiStandard.
* Replacement of internal implementations of XML DOM and XPath with
  XmlDOM and XPath modules available from NPM.
* Support for namespaces
* Support for extended (but still partial) set of XSLT functions used
  with XPath expressions.
* Support for extended set of XSLT elements.
* Drop-in compatibility with xslt4node.

At this point, features are being added as needed on our projects.
Contributions are always welcome.

## Installation

```sh
npm install xsltjs --save
```

## Performance considerations

As this XSLT engine is implemented entirely in JavaScript, special
care should be taken to optimize performance. XSLT transformations
can be quite performance intensive and involve a considerable
amount of XPath expression processing. The time spent with the
XPath processor can quickly add up.

Be aware that the transform engine is dramatically slower (as much
as 10x slower) when connected to a debugger such as Chrome developer
tools. If your configuration permits it, it is generally better,
performance-wise, to open the Chrome developer tools after a run
to view any diagnostics.

A debug option is provided as a transformSpec property or
XSLT.process() method option (see below) that will report detailed
execution counts and times via console.debug(). Measuring
performance using this option is more realistic than using the
developer tools profiler as the profiler interactions appear to
overwhelm the computation. Executions times have been observed
to be as much as 20x slower with the profiler running.

As most execution time is consumed by XPath processing and within
templates. Optimization strategies can be employed for both:

* There is an optimization for simple xPaths that are simply the
  qualified element name. Try to use simple xPaths of this form
  rather than more complex xPath expressions.

* If the templates are being called too many times, try to use
  the mode attribute to segment out the templates. Note that the
  time reported is the number of attempts to call a template --
  rather than the number of templates that are actually
  evaluated. For this reason, the total number of calls will be
  exaggerated.

Also, because only single template matches are considered,
try to reorder the templates to place commonly called templates
at the start of the transform and less commonly used ones
at the back.

## Usage example

```javascript
  XSLT
    .process(inputDoc, transformDoc, params, {
      inputURL: inputURL,
      transformURL: transformURL,
      customFunctions: {
        'http://www.xcential.com/schemas/xed': {
          'setVar': function (arg1, arg2) {...},
          'getVar': function () {...}
        }
      },
      debug: debug
      logger: electronLogger })
    .then(
      (resultXML) => {
        return ...;
      },
      (exception) => {
        return ...;
      }
    );
```

Using an xslt4node approach:

```javascript
  const transformSpec = {
    source: inputXML|inputDoc,
    xsltPath: transformPath, // Optional
    xslt: transformXML|transformDoc, // Optional
    result: string|function,
    params: {
      'docName': 'My Document',
      'docDate': 'February 24, 2019'
    },
    customFunctions: {
      'http://www.xcential.com/schemas/xed': {
        'setVar': function (arg1, arg2) {...},
        'getVar': function () {...}
      }
    },
    debug: true|false // Controls whether debug messages will log
    logger: electronLogger|null // Will log to console if not specified
  };
  XSLT.transform(transformSpec, (errorMessage, resultXML) => {
    if (errorMessage) {
      throw new Error(error);
    } else if (resultXML) {
      ...
    }
  });
```

Note that customFunctions and debug are not part of the xslt4node API.

## Custom Functions

Custom functions can be used when necessary. To use your custom function,
be sure to prefix the function name with the prefix corresponding to the
namespace the function is declared within.

The first argument is always the xPathContext object. The remainder of
the arguments are expressions relating to the arguments used in the
transform. To access the value, the expression must first be evaluated
as shown in the example below.

Any return value must be converted to an XPath type. Consult the xpath
module (available via NPM) for further details.

```javascript
    formatDate = function (xPathContext, dateTextExpr) {
      let dateText = dateTextExpr.evaluate(xPathContext).str;
      let date = new Date(Date.parse(dateText));
      let months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      let formattedDate = months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
      return new this.XPath.XString(formattedDate);
    };
```

## References

* [XSLT 1.0](http://www.w3.org/TR/1999/REC-xslt-19991116)
* [XSLT 2.0](http://www.w3.org/TR/2009/PER-xslt20-20090421/)
* [XPath 2.0](https://www.w3.org/TR/xpath20/)
* [XML DOM](https://www.w3.org/DOM/)

## Release History

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

Grant Vergottini- [@grantcv1](https://twitter.com/grantcv1) - grant.vergottini@xcential.com

Distributed under the MIT license. See ``LICENSE`` for more information.

[https://github.com/Xcential-Corporation/XSLTjs](https://github.com/Xcential-Corporation/XSLTjs)

## Contributing

1. Fork it (<https://github.com/yourname/yourproject/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

<!-- Markdown link & img dfn's -->
[npm-image]: https://img.shields.io/npm/v/datadog-metrics.svg?style=flat-square
[npm-url]: https://npmjs.org/package/datadog-metrics
[npm-downloads]: https://img.shields.io/npm/dm/datadog-metrics.svg?style=flat-square
[travis-image]: https://img.shields.io/travis/dbader/node-datadog-metrics/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/dbader/node-datadog-metrics
[wiki]: https://github.com/yourname/yourproject/wiki