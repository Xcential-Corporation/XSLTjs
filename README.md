# XSLTjs
> An XSLT 1.0+ implementation written entirely in JavaScript.

[![NPM Version][npm-image]][npm-url]
[![Downloads Stats][npm-downloads]][npm-url]

## Introduction

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

XSLTjs is based on, [AJAXSLT](https://github.com/4031651/ajaxslt),
originally developed by Steffen Meschkat at Google. That version was
developed around 2005 as a stopgap solution for "fat web pages" at a
time when XSLT processors weren't found in all web browsers.

This version is a substantial reworking of that original work for use
in Node.js (other uses will need accommodation). Below is a partial list
of enhancements:

* Substantial rewrite to ES2015 standards
* Fomatting of JavaScript to SemiStandard.
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
npm install XSLTjs --save
```

## Usage example

```
  const transformSpec = {
    source: inputXML|inputDoc,
    xsltPath: transformPath, // Optional
    xslt: transformXML|transformDoc, // Optional
    result: string|function,
    params: {
      'docName': 'My Document',
      'docDate': 'February 24, 2019'
    }
  };
  XSLT.transform(transformSpec, (errorMessage, resultXML) => {
    if (errorMessage) {
      throw new Error(error);
    } else if (resultXML) {
      ...
    }
  });
```
## References

* [XSLT 1.0](http://www.w3.org/TR/1999/REC-xslt-19991116)
* [XSLT 2.0](http://www.w3.org/TR/2009/PER-xslt20-20090421/)
* [XPath 2.0](https://www.w3.org/TR/xpath20/)
* [XML DOM](https://www.w3.org/DOM/)

## Release History

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