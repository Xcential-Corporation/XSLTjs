# XSLTjs
> An XSLT 1.0+ implementation written entirely in JavaScript.

[![NPM Version][npm-image]][npm-url]
[![Downloads Stats][npm-downloads]][npm-url]

## Introduction

THIS MODULE IS STILL A WORK IN PROGRESS.

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
* &lt;xsl:processing-instruction&gt;
* &lt;xsl:sort&gt;
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

```
  XSLT
    .process(inputDoc, transformDoc, params, {
      inputURL: inputURL,
      transformURL: transformURL,
      customFunctions: {
        'http://www.xcential.com/schemas/xed': {
          'setVar': function (arg1, arg2) {...},
          'getVar': function () {...}
        }
      }
      debug: debug })
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
```
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
    }
    debug: true|false
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

## References

* [XSLT 1.0](http://www.w3.org/TR/1999/REC-xslt-19991116)
* [XSLT 2.0](http://www.w3.org/TR/2009/PER-xslt20-20090421/)
* [XPath 2.0](https://www.w3.org/TR/xpath20/)
* [XML DOM](https://www.w3.org/DOM/)

## Release History

* 0.0.18
  - Adds a mechanism to use custom JavaScript functions.
* 0.0.17
  - Fixes problem when xPath position() function is used standalone
    rather than as part of a predicate.
* 0.0.16
  - Fixes problem with root handling
* 0.0.15
  - Minor documentation update
* 0.0.14
  - Fixes problems with excessive aync/await usage
  - Fixes problem xPath processing namespaces
* 0.0.13
  - Adds workaround to apparent bug in xpath module's support for
    namespace axes
  - Better handling of root node
* 0.0.12
  - Bug fixes for xsl:comment and include/imports
* 0.0.11
  - Cleanup
* 0.0.10
  - Improved XPath handling
* 0.0.9
  - Lots of performance optimizations
  - Addition of debug performance metrics
  - Bug fixes
* 0.0.8
  - Corrects problem with nodeList naming
* 0.0.7
  - Documentation corrections
* 0.0.6
  - Implements include/import
  - Bug fixes
* 0.0.5
  - Implements functions
  - Bug fixes
* 0.0.1
  - Work in progress

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