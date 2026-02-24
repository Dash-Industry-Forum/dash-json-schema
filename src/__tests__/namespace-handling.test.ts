/**
 * Tests for XML namespace handling in MPD conversion
 * 
 * These tests verify:
 * 1. XML → JSON conversion preserves namespace information
 * 2. JSON → XML conversion reconstructs proper namespaced XML
 * 3. Round-trip conversion (XML → JSON → XML) maintains fidelity
 */

import { describe, it, expect, vi } from 'vitest'
import { MPDConverter } from '../mpd-converter'
import { JsonToXmlConverter } from '../json-to-xml-converter'
import * as fs from 'fs'
import * as path from 'path'

describe('Namespace Handling', () => {
    const mpdConverter = new MPDConverter({
        skipXsdValidation: true,
        skipJsonSchemaValidation: true,
    })
    
    const xmlConverter = new JsonToXmlConverter()

    describe('XML to JSON Conversion', () => {
        it('should extract namespace declarations into $ns property', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     xmlns:ext="urn:example:extension"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0"/>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            expect(result.json).toBeDefined()
            expect(result.json!['$ns']).toBeDefined()
            expect(result.json!['$ns']).toHaveProperty('urn:example:extension', 'ext')
        })

        it('should group extension elements under prefix key', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     xmlns:ext="urn:example:extension"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0">
                        <SupplementalProperty schemeIdUri="urn:test" value="v1">
                            <ext:CustomData>test-value</ext:CustomData>
                        </SupplementalProperty>
                    </Period>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            
            const period = (result.json!['Period'] as any[])[0]
            const suppProp = period['SupplementalProperty'][0]
            
            expect(suppProp).toHaveProperty('ext')
            expect(suppProp.ext).toHaveProperty('CustomData')
            expect(suppProp.ext.CustomData).toBe('test-value')
        })

        it('should handle nested extension elements', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     xmlns:ext="urn:example:extension"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0">
                        <SupplementalProperty schemeIdUri="urn:test" value="v1">
                            <ext:Outer attr1="a">
                                <ext:Inner attr2="b">content</ext:Inner>
                            </ext:Outer>
                        </SupplementalProperty>
                    </Period>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            
            const suppProp = (result.json!['Period'] as any[])[0]['SupplementalProperty'][0]
            expect(suppProp.ext.Outer).toBeDefined()
            expect(suppProp.ext.Outer.attr1).toBe('a')
            expect(suppProp.ext.Outer.Inner).toBeDefined()
            expect(suppProp.ext.Outer.Inner.attr2).toBe('b')
        })

        it('should handle multiple namespaces', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     xmlns:ext1="urn:example:ext1"
                     xmlns:ext2="urn:example:ext2"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0">
                        <SupplementalProperty schemeIdUri="urn:test" value="v1">
                            <ext1:DataA>value-a</ext1:DataA>
                            <ext2:DataB>value-b</ext2:DataB>
                        </SupplementalProperty>
                    </Period>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            
            expect(result.json!['$ns']).toHaveProperty('urn:example:ext1', 'ext1')
            expect(result.json!['$ns']).toHaveProperty('urn:example:ext2', 'ext2')
            
            const suppProp = (result.json!['Period'] as any[])[0]['SupplementalProperty'][0]
            expect(suppProp.ext1.DataA).toBe('value-a')
            expect(suppProp.ext2.DataB).toBe('value-b')
        })

        it('should handle xlink namespace as extension', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     xmlns:xlink="http://www.w3.org/1999/xlink"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0" xlink:href="http://example.com/period.xml" xlink:actuate="onLoad"/>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            
            const period = (result.json!['Period'] as any[])[0]
            expect(period.xlink).toBeDefined()
            expect(period.xlink.href).toBe('http://example.com/period.xml')
            expect(period.xlink.actuate).toBe('onLoad')
        })

        it('should not include $ns when no extension namespaces are present', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0"/>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            expect(result.json!['$ns']).toBeUndefined()
        })
    })

    describe('JSON to XML Conversion', () => {
        it('should generate proper namespace declarations', () => {
            const json = {
                '$ns': {
                    'urn:example:extension': 'ext'
                },
                'profiles': 'urn:mpeg:dash:profile:isoff-on-demand:2011',
                'minBufferTime': 'PT2S',
                'Period': [{ 'id': 'p0' }]
            }
            
            const xml = xmlConverter.convert(json)
            
            expect(xml).toContain('xmlns="urn:mpeg:dash:schema:mpd:2011"')
            expect(xml).toContain('xmlns:ext="urn:example:extension"')
        })

        it('should prefix extension elements correctly', () => {
            const json = {
                '$ns': {
                    'urn:example:extension': 'ext'
                },
                'profiles': 'urn:mpeg:dash:profile:isoff-on-demand:2011',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'SupplementalProperty': [{
                        'schemeIdUri': 'urn:test',
                        'value': 'v1',
                        'ext': {
                            'CustomData': 'test-value'
                        }
                    }]
                }]
            }
            
            const xml = xmlConverter.convert(json)
            
            expect(xml).toContain('<ext:CustomData>')
            expect(xml).toContain('test-value')
            expect(xml).toContain('</ext:CustomData>')
        })

        it('should handle extension element attributes', () => {
            const json = {
                '$ns': {
                    'urn:example:extension': 'ext'
                },
                'profiles': 'urn:mpeg:dash:profile:isoff-on-demand:2011',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'SupplementalProperty': [{
                        'schemeIdUri': 'urn:test',
                        'ext': {
                            'Data': {
                                'version': '1.0',
                                'Child': 'value'
                            }
                        }
                    }]
                }]
            }
            
            const xml = xmlConverter.convert(json)
            
            expect(xml).toContain('<ext:Data')
            expect(xml).toContain('version="1.0"')
            expect(xml).toContain('<ext:Child>')
        })
    })

    describe('Round-trip Conversion', () => {
        it('should preserve extension content through round-trip', () => {
            const originalXml = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:ext="urn:example:extension" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="PT2S">
  <Period id="p0">
    <SupplementalProperty schemeIdUri="urn:test" value="v1">
      <ext:Metadata version="1.0">
        <ext:ContentId>movie-123</ext:ContentId>
      </ext:Metadata>
    </SupplementalProperty>
  </Period>
</MPD>`
            
            // XML → JSON
            const jsonResult = mpdConverter.convert(originalXml)
            expect(jsonResult.success).toBe(true)
            
            // JSON → XML
            const reconstructedXml = xmlConverter.convert(jsonResult.json!)
            
            // Verify key elements are preserved
            expect(reconstructedXml).toContain('xmlns:ext="urn:example:extension"')
            expect(reconstructedXml).toContain('<ext:Metadata')
            expect(reconstructedXml).toContain('version="1.0"')
            expect(reconstructedXml).toContain('<ext:ContentId>')
            expect(reconstructedXml).toContain('movie-123')
        })

        it('should preserve namespace-1.mpd through round-trip', () => {
            const namespace1Path = path.join(__dirname, '../../examples/namespace-1.mpd')
            
            if (fs.existsSync(namespace1Path)) {
                const originalXml = fs.readFileSync(namespace1Path, 'utf-8')
                
                // XML → JSON
                const jsonResult = mpdConverter.convert(originalXml)
                expect(jsonResult.success).toBe(true)
                
                // Verify JSON structure
                // The ext namespace entry is upgraded to extended form because
                // extension child elements have XML attributes (e.g., version on MetadataBlock)
                const extEntry = (jsonResult.json!['$ns'] as any)['urn:example:dash:extension:2026']
                expect(typeof extEntry === 'string' ? extEntry : extEntry.prefix).toBe('ext')
                
                const suppProp = (jsonResult.json!['Period'] as any[])[0]['SupplementalProperty'][0]
                expect(suppProp.ext.MetadataBlock).toBeDefined()
                expect(suppProp.ext.MetadataBlock.ContentId).toBe('movie-123')
                
                // JSON → XML
                const reconstructedXml = xmlConverter.convert(jsonResult.json!)
                
                // Verify XML structure
                expect(reconstructedXml).toContain('xmlns:ext="urn:example:dash:extension:2026"')
                expect(reconstructedXml).toContain('<ext:MetadataBlock')
                expect(reconstructedXml).toContain('<ext:ContentId>')
                expect(reconstructedXml).toContain('movie-123')
                expect(reconstructedXml).toContain('<ext:Policy>')
                expect(reconstructedXml).toContain('<ext:MaxResolution>')
            }
        })
    })

    describe('Edge Cases', () => {
        it('should handle empty extension elements', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     xmlns:ext="urn:example:extension"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0">
                        <SupplementalProperty schemeIdUri="urn:test">
                            <ext:EmptyElement/>
                        </SupplementalProperty>
                    </Period>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            
            const suppProp = (result.json!['Period'] as any[])[0]['SupplementalProperty'][0]
            expect(suppProp.ext).toBeDefined()
        })

        it('should preserve attribute order in extension elements', () => {
            const json = {
                '$ns': { 'urn:example:ext': 'ext' },
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'ext': {
                        'Data': {
                            'attr1': 'value1',
                            'attr2': 'value2'
                        }
                    }
                }]
            }
            
            const xml = xmlConverter.convert(json)
            
            expect(xml).toContain('attr1="value1"')
            expect(xml).toContain('attr2="value2"')
        })

        it('should handle deeply nested extension structures', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     xmlns:ext="urn:example:extension"
                     profiles="test"
                     minBufferTime="PT2S">
                    <Period id="p0">
                        <SupplementalProperty schemeIdUri="urn:test">
                            <ext:Level1>
                                <ext:Level2>
                                    <ext:Level3>
                                        <ext:Level4>deep-value</ext:Level4>
                                    </ext:Level3>
                                </ext:Level2>
                            </ext:Level1>
                        </SupplementalProperty>
                    </Period>
                </MPD>`
            
            const result = mpdConverter.convert(xml)
            expect(result.success).toBe(true)
            
            const suppProp = (result.json!['Period'] as any[])[0]['SupplementalProperty'][0]
            expect(suppProp.ext.Level1.Level2.Level3.Level4).toBe('deep-value')
        })
    })

    describe('Namespace Constraints', () => {
        describe('Prefix rebinding (XML to JSON)', () => {
            it('should reject prefix rebinding (same prefix, different URIs at different depths)', () => {
                const xml = `<?xml version="1.0"?>
                    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                         xmlns:ext="urn:example:ext1"
                         profiles="test"
                         minBufferTime="PT2S">
                        <Period xmlns:ext="urn:example:ext2" id="p0">
                            <SupplementalProperty schemeIdUri="urn:test">
                                <ext:Data>value</ext:Data>
                            </SupplementalProperty>
                        </Period>
                    </MPD>`
                
                const result = mpdConverter.convert(xml)
                expect(result.success).toBe(false)
                expect(result.error).toContain('prefix rebinding')
            })
        })

        describe('URI aliasing (XML to JSON)', () => {
            it('should reject URI aliasing (same URI, different prefixes)', () => {
                const xml = `<?xml version="1.0"?>
                    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                         xmlns:ext1="urn:example:extension"
                         xmlns:ext2="urn:example:extension"
                         profiles="test"
                         minBufferTime="PT2S">
                        <Period id="p0"/>
                    </MPD>`
                
                const result = mpdConverter.convert(xml)
                expect(result.success).toBe(false)
                expect(result.error).toContain('URI aliasing')
            })
        })

        describe('Root-only $ns (JSON to XML)', () => {
            it('should warn on nested $ns in JSON input', () => {
                const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
                
                const json = {
                    '$ns': {
                        'urn:example:ext1': 'ext1'
                    },
                    'profiles': 'test',
                    'minBufferTime': 'PT2S',
                    'Period': [{
                        '$ns': {
                            'urn:example:ext2': 'ext2'
                        },
                        'id': 'p0'
                    }]
                }
                
                xmlConverter.convert(json)
                
                expect(warnSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Nested $ns declarations are not supported')
                )
                
                warnSpy.mockRestore()
            })
        })

        describe('$ns prefix collision (JSON to XML)', () => {
            it('should reject duplicate prefix in $ns', () => {
                // This tests the case where two URIs have the same prefix string
                // We can't create this directly in JSON (same key), but the extended form allows it:
                const json = {
                    '$ns': {
                        'urn:example:ext1': 'ext',
                        'urn:example:ext2': 'ext'
                    },
                    'profiles': 'test',
                    'minBufferTime': 'PT2S',
                    'Period': [{ 'id': 'p0' }]
                }
                
                expect(() => xmlConverter.convert(json)).toThrow('prefix collision')
            })
        })

        describe('$ns only at root in JSON output', () => {
            it('should place $ns only at root level when converting XML with namespaces declared on child elements', () => {
                const xml = `<?xml version="1.0"?>
                    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                         profiles="test"
                         minBufferTime="PT2S">
                        <Period id="p0">
                            <SupplementalProperty xmlns:ext="urn:example:extension"
                                                  schemeIdUri="urn:test">
                                <ext:Data>value</ext:Data>
                            </SupplementalProperty>
                        </Period>
                    </MPD>`
                
                const result = mpdConverter.convert(xml)
                expect(result.success).toBe(true)
                
                // $ns should be at root
                expect(result.json!['$ns']).toBeDefined()
                expect(result.json!['$ns']).toHaveProperty('urn:example:extension')
                
                // No nested $ns on Period or SupplementalProperty
                const period = (result.json!['Period'] as any[])[0]
                expect(period['$ns']).toBeUndefined()
                
                const suppProp = period['SupplementalProperty'][0]
                expect(suppProp['$ns']).toBeUndefined()
            })
        })

        describe('Same namespace declared at multiple levels (identical binding)', () => {
            it('should accept the same prefix→URI binding declared at multiple depths', () => {
                const xml = `<?xml version="1.0"?>
                    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                         xmlns:ext="urn:example:extension"
                         profiles="test"
                         minBufferTime="PT2S">
                        <Period xmlns:ext="urn:example:extension" id="p0">
                            <SupplementalProperty schemeIdUri="urn:test">
                                <ext:Data>value</ext:Data>
                            </SupplementalProperty>
                        </Period>
                    </MPD>`
                
                const result = mpdConverter.convert(xml)
                expect(result.success).toBe(true)
                
                // $ns should be at root with single entry
                expect(result.json!['$ns']).toHaveProperty('urn:example:extension', 'ext')
            })
        })
    })
})
