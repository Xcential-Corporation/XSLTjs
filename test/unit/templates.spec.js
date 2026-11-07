/**
 * @file templates.spec.js
 * @description Template rules: matching, conflict resolution, built-in rules and sorting.
 */

/* eslint-env jasmine */

'use strict';

const { transform } = require('./helpers.js');

describe('Template rules', () => {
  it('chooses the template with the higher priority, wherever it appears', async () => {
    const result = await transform('<doc><a/></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="doc/a"/></out></xsl:template>
      <xsl:template match="a" priority="2">high</xsl:template>
      <xsl:template match="a" priority="1">low</xsl:template>`);
    expect(result).toBe('<out>high</out>');

    const reversed = await transform('<doc><a/></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="doc/a"/></out></xsl:template>
      <xsl:template match="a" priority="1">low</xsl:template>
      <xsl:template match="a" priority="2">high</xsl:template>`);
    expect(reversed).toBe('<out>high</out>');
  });

  it('gives a more specific pattern a higher default priority', async () => {
    const result = await transform('<doc><a type="x"/></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="doc/a"/></out></xsl:template>
      <xsl:template match="a[@type='x']">specific</xsl:template>
      <xsl:template match="*">general</xsl:template>
      <xsl:template match="a">named</xsl:template>`);
    expect(result).toBe('<out>specific</out>');
  });

  it('chooses the last of two templates with equal priority', async () => {
    const result = await transform('<doc><a/></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="doc/a"/></out></xsl:template>
      <xsl:template match="a">first</xsl:template>
      <xsl:template match="a">last</xsl:template>`);
    expect(result).toBe('<out>last</out>');
  });

  it('matches patterns with descendant steps and the root', async () => {
    const result = await transform('<doc><x><y><b>1</b></y></x><b>2</b></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="//b"/></out></xsl:template>
      <xsl:template match="x//b">[deep <xsl:value-of select="."/>]</xsl:template>
      <xsl:template match="b">[<xsl:value-of select="."/>]</xsl:template>`);
    expect(result).toBe('<out>[deep 1][2]</out>');
  });

  it('matches positional predicates in patterns', async () => {
    const result = await transform('<doc><i>a</i><i>b</i><i>c</i></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="doc/i"/></out></xsl:template>
      <xsl:template match="i[2]">(<xsl:value-of select="."/>)</xsl:template>
      <xsl:template match="i"><xsl:value-of select="."/></xsl:template>`);
    expect(result).toBe('<out>a(b)c</out>');
  });

  it('applies the built-in rule to unmatched elements by processing their children', async () => {
    const result = await transform('<doc><wrap><b>bold</b> and <i>plain</i></wrap></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates/></out></xsl:template>
      <xsl:template match="b"><strong><xsl:apply-templates/></strong></xsl:template>`);
    expect(result).toBe('<out><strong>bold</strong> and plain</out>');
  });

  it('sorts the nodes selected by apply-templates', async () => {
    const result = await transform('<doc><n name="c"/><n name="a"/><n name="b"/></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="doc/n"><xsl:sort select="@name"/></xsl:apply-templates></out></xsl:template>
      <xsl:template match="n"><xsl:value-of select="@name"/></xsl:template>`);
    expect(result).toBe('<out>abc</out>');
  });

  it('sorts numerically and in descending order', async () => {
    const result = await transform('<doc><n>10</n><n>9</n><n>100</n></doc>', `
      <xsl:template match="/"><out><xsl:for-each select="doc/n"><xsl:sort select="." data-type="number" order="descending"/><xsl:value-of select="."/>,</xsl:for-each></out></xsl:template>`);
    expect(result).toBe('<out>100,10,9,</out>');
  });

  it('keeps modes separate', async () => {
    const result = await transform('<doc><a/></doc>', `
      <xsl:template match="/"><out><xsl:apply-templates select="doc/a"/><xsl:apply-templates select="doc/a" mode="m"/></out></xsl:template>
      <xsl:template match="a">plain</xsl:template>
      <xsl:template match="a" mode="m">moded</xsl:template>`);
    expect(result).toBe('<out>plainmoded</out>');
  });
});
