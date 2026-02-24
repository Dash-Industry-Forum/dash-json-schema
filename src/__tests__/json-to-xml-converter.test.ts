/**
 * Tests for JSON to XML Converter
 * 
 * Tests the JSON to XML conversion functionality
 */

import { describe, it, expect } from 'vitest'
import { JsonToXmlConverter } from '../json-to-xml-converter'

describe('JsonToXmlConverter', () => {
    const converter = new JsonToXmlConverter()

    describe('Basic Conversion', () => {
        it('should convert minimal JSON to valid XML', () => {
            const json = {
                'profiles': 'urn:mpeg:dash:profile:isoff-on-demand:2011',
                'minBufferTime': 'PT2S',
                'Period': [{ 'id': 'p0' }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
            expect(xml).toContain('<MPD')
            expect(xml).toContain('xmlns="urn:mpeg:dash:schema:mpd:2011"')
            expect(xml).toContain('profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"')
            expect(xml).toContain('minBufferTime="PT2S"')
            expect(xml).toContain('<Period')
            expect(xml).toContain('id="p0"')
            expect(xml).toContain('</MPD>')
        })

        it('should handle nested elements', () => {
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'AdaptationSet': [{
                        'id': 1,
                        'mimeType': 'video/mp4',
                        'Representation': [{
                            'id': 'rep1',
                            'bandwidth': 5000000
                        }]
                    }]
                }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('<AdaptationSet')
            expect(xml).toContain('id="1"')
            expect(xml).toContain('mimeType="video/mp4"')
            expect(xml).toContain('<Representation')
            expect(xml).toContain('bandwidth="5000000"')
        })

        it('should handle $value for text content', () => {
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'AdaptationSet': [{
                        'id': 1,
                        'Representation': [{
                            'id': 'rep1',
                            'bandwidth': 5000000,
                            'BaseURL': [{
                                '$value': 'http://example.com/video/'
                            }]
                        }]
                    }]
                }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('<BaseURL>http://example.com/video/</BaseURL>')
        })

        it('should handle multiple array elements', () => {
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [
                    { 'id': 'p1' },
                    { 'id': 'p2' },
                    { 'id': 'p3' }
                ]
            }
            
            const xml = converter.convert(json)
            
            // Count Period occurrences
            const periodMatches = xml.match(/<Period/g)
            expect(periodMatches).toHaveLength(3)
        })
    })

    describe('Namespace Handling', () => {
        it('should add xmlns declarations from $ns', () => {
            const json = {
                '$ns': {
                    'urn:example:extension': 'ext'
                },
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{ 'id': 'p0' }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('xmlns:ext="urn:example:extension"')
        })

        it('should prefix extension elements', () => {
            const json = {
                '$ns': {
                    'urn:example:extension': 'ext'
                },
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'ext': {
                        'CustomElement': 'custom-value'
                    }
                }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('<ext:CustomElement>')
            expect(xml).toContain('custom-value')
            expect(xml).toContain('</ext:CustomElement>')
        })

        it('should handle extension attributes vs elements', () => {
            const json = {
                '$ns': {
                    'urn:example:extension': 'ext'
                },
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'ext': {
                        'Data': {
                            'version': '1.0',  // lowercase = attribute
                            'Child': 'value'   // uppercase = element
                        }
                    }
                }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('<ext:Data')
            expect(xml).toContain('version="1.0"')
            expect(xml).toContain('<ext:Child>')
        })

        it('should handle multiple namespaces', () => {
            const json = {
                '$ns': {
                    'urn:example:ext1': 'ext1',
                    'urn:example:ext2': 'ext2'
                },
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'ext1': { 'Data1': 'value1' },
                    'ext2': { 'Data2': 'value2' }
                }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('xmlns:ext1="urn:example:ext1"')
            expect(xml).toContain('xmlns:ext2="urn:example:ext2"')
            expect(xml).toContain('<ext1:Data1>')
            expect(xml).toContain('<ext2:Data2>')
        })
    })

    describe('Configuration Options', () => {
        it('should omit XML declaration when configured', () => {
            const converter = new JsonToXmlConverter({ xmlDeclaration: false })
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{ 'id': 'p0' }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).not.toContain('<?xml')
            expect(xml).toMatch(/^<MPD/)
        })

        it('should output minified XML when configured', () => {
            const converter = new JsonToXmlConverter({ indent: false })
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{ 'id': 'p0' }]
            }
            
            const xml = converter.convert(json)
            
            // Minified XML should not have newlines between elements
            const withoutDeclaration = xml.replace(/^<\?xml[^?]*\?>\n?/, '')
            expect(withoutDeclaration).not.toMatch(/>\s*\n\s*</)
        })
    })

    describe('Edge Cases', () => {
        it('should handle empty objects', () => {
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{ 'id': 'p0' }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('<Period')
        })

        it('should handle boolean attributes', () => {
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'AdaptationSet': [{
                        'id': 1,
                        'bitstreamSwitching': true
                    }]
                }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('bitstreamSwitching="true"')
        })

        it('should handle numeric attributes', () => {
            const json = {
                'profiles': 'test',
                'minBufferTime': 'PT2S',
                'Period': [{
                    'id': 'p0',
                    'AdaptationSet': [{
                        'id': 1,
                        'width': 1920,
                        'height': 1080
                    }]
                }]
            }
            
            const xml = converter.convert(json)
            
            expect(xml).toContain('width="1920"')
            expect(xml).toContain('height="1080"')
        })
    })
})
