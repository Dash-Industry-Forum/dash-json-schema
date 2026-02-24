/**
 * Tests for MPD Converter
 * 
 * Tests the core XML to JSON conversion functionality
 */

import { describe, it, expect } from 'vitest'
import { MPDConverter } from '../mpd-converter'
import * as fs from 'fs'
import * as path from 'path'

describe('MPDConverter', () => {
    const converter = new MPDConverter({
        skipXsdValidation: true,
        skipJsonSchemaValidation: true,
    })

    describe('Basic Conversion', () => {
        it('should convert a minimal valid MPD', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0"/>
                </MPD>`
            
            const result = converter.convert(xml)
            
            expect(result.success).toBe(true)
            expect(result.json).toBeDefined()
            expect(result.json!['profiles']).toBe('urn:mpeg:dash:profile:isoff-on-demand:2011')
            expect(result.json!['minBufferTime']).toBe('PT2S')
            expect(result.json!['Period']).toBeInstanceOf(Array)
            expect((result.json!['Period'] as any[])[0]['id']).toBe('p0')
        })

        it('should convert attributes with proper types', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S"
                     type="static">
                    <Period id="p0" duration="PT30S">
                        <AdaptationSet id="1" mimeType="video/mp4" width="1920" height="1080">
                            <Representation id="rep1" bandwidth="5000000"/>
                        </AdaptationSet>
                    </Period>
                </MPD>`
            
            const result = converter.convert(xml)
            expect(result.success).toBe(true)
            
            const period = (result.json!['Period'] as any[])[0]
            const adaptationSet = period['AdaptationSet'][0]
            
            // id should be integer for AdaptationSet
            expect(adaptationSet['id']).toBe(1)
            expect(typeof adaptationSet['id']).toBe('number')
            
            // width and height should be integers
            expect(adaptationSet['width']).toBe(1920)
            expect(adaptationSet['height']).toBe(1080)
            
            // bandwidth should be integer
            expect(adaptationSet['Representation'][0]['bandwidth']).toBe(5000000)
            
            // mimeType should be string
            expect(adaptationSet['mimeType']).toBe('video/mp4')
        })

        it('should handle arrays correctly', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p1"/>
                    <Period id="p2"/>
                    <Period id="p3"/>
                </MPD>`
            
            const result = converter.convert(xml)
            expect(result.success).toBe(true)
            
            const periods = result.json!['Period'] as any[]
            expect(periods).toHaveLength(3)
            expect(periods[0]['id']).toBe('p1')
            expect(periods[1]['id']).toBe('p2')
            expect(periods[2]['id']).toBe('p3')
        })

        it('should handle $value for text content', () => {
            const xml = `<?xml version="1.0"?>
                <MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
                     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
                     minBufferTime="PT2S">
                    <Period id="p0">
                        <AdaptationSet id="1">
                            <Representation id="rep1" bandwidth="5000000">
                                <BaseURL>http://example.com/video/</BaseURL>
                            </Representation>
                        </AdaptationSet>
                    </Period>
                </MPD>`
            
            const result = converter.convert(xml)
            expect(result.success).toBe(true)
            
            const rep = (result.json!['Period'] as any[])[0]['AdaptationSet'][0]['Representation'][0]
            expect(rep['BaseURL']).toBeInstanceOf(Array)
            expect(rep['BaseURL'][0]['$value']).toBe('http://example.com/video/')
        })
    })

    describe('Example MPD Files', () => {
        const examplesDir = path.join(__dirname, '../../examples')
        
        // Get all .mpd files in examples directory
        const mpdFiles = fs.existsSync(examplesDir) 
            ? fs.readdirSync(examplesDir).filter(f => f.endsWith('.mpd'))
            : []

        it.each(mpdFiles)('should successfully convert %s', (filename) => {
            const filepath = path.join(examplesDir, filename)
            const result = converter.convertFile(filepath)
            
            // Basic structure validation
            expect(result.success).toBe(true)
            expect(result.json).toBeDefined()
            expect(result.json!['Period']).toBeDefined()
        })
    })

    describe('Error Handling', () => {
        it('should return error for invalid XML', () => {
            const xml = `<MPD><Period></MPD>`  // Malformed
            
            const result = converter.convert(xml)
            
            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })

        it('should return error for non-existent file', () => {
            const result = converter.convertFile('/nonexistent/path/file.mpd')
            
            expect(result.success).toBe(false)
            expect(result.error).toContain('not found')
        })
    })
})
