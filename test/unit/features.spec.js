/**
 * @file features.spec.js
 * @description XSLT 1.0 instructions and functions.
 */

/* eslint-env jasmine */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('./helpers.js');
const { XSLT } = require('../../scripts/XSLT.js');

const XSL = 'http://www.w3.org/1999/XSL/Transform';

describe('Keys', () => {
  it('finds nodes by key value, including several values at once', async () => {
    const result = await transform('<doc><p id="a" g="x">1</p><p id="b" g="y">2</p><p id="c" g="x">3</p></doc>', `
      <xsl:key name="byGroup" match="p" use="@g"/>
      <xsl:template match="/"><out><xsl:for-each select="key('byGroup', 'x')"><xsl:value-of select="."/></xsl:for-each>|<xsl:value-of select="count(key('byGroup', doc/p/@g))"/></out></xsl:template>`);
    expect(result).toBe('<out>13|3</out>');
  });

  it('supports Muenchian grouping', async () => {
    const result = await transform('<doc><i c="b"/><i c="a"/><i c="b"/></doc>', `
      <xsl:key name="k" match="i" use="@c"/>
      <xsl:template match="/"><out><xsl:for-each select="doc/i[generate-id() = generate-id(key('k', @c)[1])]"><xsl:sort select="@c"/>[<xsl:value-of select="@c"/>:<xsl:value-of select="count(key('k', @c))"/>]</xsl:for-each></out></xsl:template>`);
    expect(result).toBe('<out>[a:1][b:2]</out>');
  });
});

describe('xsl:number', () => {
  const doc = '<doc><sec><h/><sec><h/><h/></sec></sec><sec><h/></sec></doc>';

  it('numbers at a single level', async () => {
    const result = await transform(doc, `
      <xsl:template match="/"><out><xsl:for-each select="//sec"><xsl:number/>;</xsl:for-each></out></xsl:template>`);
    expect(result).toBe('<out>1;1;2;</out>');
  });

  it('numbers at multiple levels', async () => {
    const result = await transform(doc, `
      <xsl:template match="/"><out><xsl:for-each select="//sec"><xsl:number level="multiple" count="sec" format="1.1"/>;</xsl:for-each></out></xsl:template>`);
    expect(result).toBe('<out>1;1.1;2;</out>');
  });

  it('numbers across the document and formats letters and Roman numerals', async () => {
    const result = await transform(doc, `
      <xsl:template match="/"><out><xsl:for-each select="//h"><xsl:number level="any" format="(a)"/><xsl:number level="any" format="I"/></xsl:for-each></out></xsl:template>`);
    expect(result).toBe('<out>(a)I(b)II(c)III(d)IV</out>');
  });

  it('formats a value with grouping', async () => {
    const result = await transform('<doc/>', `
      <xsl:template match="/"><out><xsl:number value="1234567" grouping-separator="," grouping-size="3"/></out></xsl:template>`);
    expect(result).toBe('<out>1,234,567</out>');
  });
});

describe('format-number()', () => {
  it('formats with a picture and a named decimal format', async () => {
    const result = await transform('<doc/>', `
      <xsl:decimal-format name="eu" decimal-separator="," grouping-separator="."/>
      <xsl:template match="/"><out><xsl:value-of select="format-number(1234.5, '#,##0.00')"/>|<xsl:value-of select="format-number(0.256, '0.0%')"/>|<xsl:value-of select="format-number(-3, '0;(0)')"/>|<xsl:value-of select="format-number(1234.5, '#.##0,00', 'eu')"/></out></xsl:template>`);
    expect(result).toBe('<out>1,234.50|25.6%|(3)|1.234,50</out>');
  });
});

describe('Attribute sets', () => {
  it('adds attributes, including from sets the set uses', async () => {
    const result = await transform('<doc/>', `
      <xsl:attribute-set name="base"><xsl:attribute name="a">1</xsl:attribute></xsl:attribute-set>
      <xsl:attribute-set name="more" use-attribute-sets="base"><xsl:attribute name="b">2</xsl:attribute></xsl:attribute-set>
      <xsl:template match="/"><out xsl:use-attribute-sets="more" c="3"/></xsl:template>`);
    expect(result).toBe('<out a="1" b="2" c="3"/>');
  });
});

describe('Imports and includes', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsltjs-'));
    fs.writeFileSync(path.join(dir, 'imported.xsl'), `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
      <xsl:template match="a">imported(<xsl:value-of select="."/>)</xsl:template>
      <xsl:template match="b">imported-b</xsl:template>
    </xsl:stylesheet>`);
    fs.writeFileSync(path.join(dir, 'included.xsl'), `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
      <xsl:template name="greet">hello</xsl:template>
    </xsl:stylesheet>`);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gives the importing stylesheet precedence, and runs apply-imports', async () => {
    const xsl = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
      <xsl:import href="imported.xsl"/>
      <xsl:include href="included.xsl"/>
      <xsl:template match="/"><out><xsl:apply-templates select="doc/*"/>|<xsl:call-template name="greet"/></out></xsl:template>
      <xsl:template match="a" priority="-5">main[<xsl:apply-imports/>]</xsl:template>
    </xsl:stylesheet>`;
    const result = await transform('<doc><a>x</a><b/></doc>', xsl, {}, { transformURL: path.join(dir, 'main.xsl') });
    expect(result).toBe('<out>main[imported(x)]imported-b|hello</out>');
  });
});

describe('Variables and parameters', () => {
  it('passes global and template parameters, and evaluates result tree fragments', async () => {
    const result = await transform('<doc/>', `
      <xsl:param name="who" select="'nobody'"/>
      <xsl:variable name="rtf"><b>bold</b> text</xsl:variable>
      <xsl:template match="/"><out><xsl:call-template name="t"><xsl:with-param name="n" select="2"/></xsl:call-template>|<xsl:value-of select="$who"/>|<xsl:copy-of select="$rtf"/>|<xsl:value-of select="$rtf"/></out></xsl:template>
      <xsl:template name="t"><xsl:param name="n" select="1"/><xsl:param name="m" select="5"/><xsl:value-of select="$n * $m"/></xsl:template>`, { who: 'Grant' });
    expect(result).toBe('<out>10|Grant|<b>bold</b> text|bold text</out>');
  });

  it('reports a circular global variable', async () => {
    await expectAsync(transform('<doc/>', `
      <xsl:variable name="a" select="$b"/>
      <xsl:variable name="b" select="$a"/>
      <xsl:template match="/"><xsl:value-of select="$a"/></xsl:template>`)).toBeRejectedWithError(/XTDE0640/);
  });
});

describe('Output', () => {
  it('writes the html method', async () => {
    const result = await transform('<doc/>', `
      <xsl:output method="html" indent="no"/>
      <xsl:template match="/"><html><body><br/><p>a &amp; b</p><script>if (a &lt; b) {}</script></body></html></xsl:template>`);
    expect(result).toBe('<html><body><br><p>a &amp; b</p><script>if (a < b) {}</script></body></html>');
  });

  it('writes the text method', async () => {
    const result = await transform('<doc><a>1</a><a>2</a></doc>', `
      <xsl:output method="text"/>
      <xsl:template match="/"><xsl:for-each select="//a"><xsl:value-of select="."/>&lt;</xsl:for-each></xsl:template>`);
    expect(result).toBe('1<2<');
  });

  it('writes CDATA sections, the doctype and disable-output-escaping', async () => {
    const result = await transform('<doc/>', `
      <xsl:output cdata-section-elements="code" doctype-system="out.dtd"/>
      <xsl:template match="/"><out><code>a &lt; b</code><xsl:text disable-output-escaping="yes">&lt;raw/&gt;</xsl:text></out></xsl:template>`);
    expect(result).toBe('<!DOCTYPE out SYSTEM "out.dtd">\n<out><code><![CDATA[a < b]]></code><raw/></out>');
  });

  it('declares the namespaces that are used', async () => {
    const result = await transform('<doc/>', `
      <xsl:template match="/"><xsl:element name="x:a" namespace="urn:x"><xsl:attribute name="y:b" namespace="urn:y">1</xsl:attribute></xsl:element></xsl:template>`);
    expect(result).toBe('<x:a xmlns:x="urn:x" xmlns:y="urn:y" y:b="1"/>');
  });

  it('applies exclude-result-prefixes and namespace-alias', async () => {
    const result = await transform('<doc/>', `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}" xmlns:skip="urn:skip" xmlns:axsl="urn:alias" exclude-result-prefixes="skip">
      <xsl:namespace-alias stylesheet-prefix="axsl" result-prefix="xsl"/>
      <xsl:template match="/"><axsl:stylesheet version="1.0"/></xsl:template>
    </xsl:stylesheet>`);
    expect(result).toBe('<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"/>');
  });
});

describe('Whitespace', () => {
  it('strips and preserves whitespace in the source', async () => {
    const result = await transform('<doc>\n  <a>\n  <b> </b>\n  </a>\n  <keep>\n  <b/>\n  </keep>\n</doc>', `
      <xsl:strip-space elements="*"/>
      <xsl:preserve-space elements="keep"/>
      <xsl:template match="/"><out><xsl:value-of select="count(//text())"/></out></xsl:template>`);
    expect(result).toBe('<out>2</out>');
  });
});

describe('Messages and fallback', () => {
  it('sends xsl:message to onMessage and stops on terminate', async () => {
    const messages = [];
    const xsl = `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
      <xsl:template match="/"><xsl:message>first</xsl:message><xsl:message terminate="yes">stop</xsl:message><out/></xsl:template>
    </xsl:stylesheet>`;
    await expectAsync(XSLT.process('<doc/>', xsl, {}, { onMessage: (text) => messages.push(text) })).toBeRejectedWithError(/XTMM9000/);
    expect(messages).toEqual(['first', 'stop']);
  });

  it('runs xsl:fallback for instructions from a later version', async () => {
    const result = await transform('<doc/>', `<xsl:stylesheet version="2.0" xmlns:xsl="${XSL}">
      <xsl:template match="/"><out><xsl:for-each-group select="x" group-by="."><xsl:fallback>fallback</xsl:fallback></xsl:for-each-group></out></xsl:template>
    </xsl:stylesheet>`);
    expect(result).toBe('<out>fallback</out>');
  });

  it('reports the system properties and available functions and elements', async () => {
    const result = await transform('<doc/>', `
      <xsl:template match="/"><out><xsl:value-of select="system-property('xsl:version')"/>|<xsl:value-of select="function-available('key')"/>|<xsl:value-of select="element-available('xsl:number')"/>|<xsl:value-of select="function-available('nope')"/></out></xsl:template>`);
    expect(result).toBe('<out>1|true|true|false</out>');
  });
});

describe('Compatibility with earlier XSLTjs versions', () => {
  it('calls custom functions with this.XPath, as before', async () => {
    const customFunctions = {
      'urn:custom': {
        shout: function (xPathContext, textExpr) {
          return new this.XPath.XString(textExpr.evaluate(xPathContext).stringValue().toUpperCase());
        }
      }
    };
    const result = await transform('<doc>hi</doc>', `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}" xmlns:c="urn:custom" exclude-result-prefixes="c">
      <xsl:template match="/"><out><xsl:value-of select="c:shout(doc)"/></out></xsl:template>
    </xsl:stylesheet>`, {}, { customFunctions });
    expect(result).toBe('<out>HI</out>');
  });

  it('still supports the xslt4node transform() API', (done) => {
    XSLT.transform({
      source: '<doc>x</doc>',
      xslt: `<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:output omit-xml-declaration="yes"/><xsl:template match="/"><out><xsl:value-of select="doc"/></out></xsl:template></xsl:stylesheet>`,
      result: String
    }, (error, result) => {
      expect(error).toBeNull();
      expect(result).toBe('<out>x</out>');
      done();
    });
  });

  it('keeps the XPath 2.0 string functions it had', async () => {
    const result = await transform('<doc/>', `
      <xsl:template match="/"><out><xsl:value-of select="replace('a-b-c', '-', '+')"/>|<xsl:value-of select="upper-case('x')"/>|<xsl:value-of select="matches('abc', '^a')"/></out></xsl:template>`);
    expect(result).toBe('<out>a+b+c|X|true</out>');
  });

  it('runs xsl:function', async () => {
    const result = await transform('<doc/>', `<xsl:stylesheet version="2.0" xmlns:xsl="${XSL}" xmlns:f="urn:f" exclude-result-prefixes="f">
      <xsl:function name="f:twice"><xsl:param name="s"/><xsl:value-of select="concat($s, $s)"/></xsl:function>
      <xsl:template match="/"><out><xsl:value-of select="f:twice('ab')"/></out></xsl:template>
    </xsl:stylesheet>`);
    expect(result).toBe('<out>abab</out>');
  });

  it('can be compiled once and run many times', async () => {
    const stylesheet = await XSLT.compile(`<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}"><xsl:output omit-xml-declaration="yes"/><xsl:template match="/"><n><xsl:value-of select="count(//*)"/></n></xsl:template></xsl:stylesheet>`);
    expect(XSLT.run(stylesheet, '<a><b/></a>')).toBe('<n>2</n>');
    expect(XSLT.run(stylesheet, '<a/>')).toBe('<n>1</n>');
  });

  it('gets the following and preceding axes right, from elements and attributes', async () => {
    const result = await transform('<a><b x="1"><c/></b><d/></a>', `
      <xsl:template match="/"><out><xsl:for-each select="//b/following::*">[<xsl:value-of select="name()"/>]</xsl:for-each>|<xsl:for-each select="//b/@x/following::*">[<xsl:value-of select="name()"/>]</xsl:for-each>|<xsl:for-each select="//d/preceding::*">[<xsl:value-of select="name()"/>]</xsl:for-each></out></xsl:template>`);
    expect(result).toBe('<out>[d]|[c][d]|[b][c]</out>');
  });
});

describe('Errors', () => {
  it('names the error code, file and line', async () => {
    await expectAsync(transform('<doc/>', `
      <xsl:template match="/"><xsl:value-of select="1 +"/></xsl:template>`)).toBeRejectedWithError(/XPST0003.*line 2/);
  });

  it('rejects invalid patterns', async () => {
    await expectAsync(transform('<doc/>', `
      <xsl:template match="ancestor::x"/>`)).toBeRejectedWithError(/XTSE0340/);
  });
});
