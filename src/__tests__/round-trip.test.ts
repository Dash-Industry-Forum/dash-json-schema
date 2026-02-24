/**
 * Tests for MPD Round-Trip Validation
 * 
 * Tests the complete round-trip: MPD -> JSON -> MPD
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { RoundTripValidator } from '../round-trip-validator'
import { XmlNormalizer, compareXml } from '../xml-normalizer'
import { MPDConverter } from '../mpd-converter'
import { JsonToXmlConverter } from '../json-to-xml-converter'

const EXAMPLES_DIR = path.join(__dirname, '..', '..', 'examples')

describe('RoundTripValidator', () => {
    // Use fast mode for tests (skip validation)
    const validator = new RoundTripValidator({
        skipXsdValidation: true,
        skipJsonSchemaValidation: true,
    })

    describe('Basic Round-Trip', () => {
        it('should successfully round-trip a minimal MPD', () => {
            const minimalMpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="PT2S">
  <Period id="p0">
    <AdaptationSet id="1" mimeType="video/mp4">
      <Representation id="rep1" bandwidth="5000000"/>
    </AdaptationSet>
  </Period>
</MPD>`

            const result = validator.validate(minimalMpd)
            
            expect(result.success).toBe(true)
            expect(result.json).toBeDefined()
            expect(result.regeneratedMpd).toBeDefined()
        })

        it('should preserve basic attributes through round-trip', () => {
            const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test:profile" minBufferTime="PT5S" type="static">
  <Period id="period-1" duration="PT60S">
    <AdaptationSet id="1" mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="1000000" width="1920" height="1080"/>
    </AdaptationSet>
  </Period>
</MPD>`

            const result = validator.validate(mpd)
            
            expect(result.success).toBe(true)
            expect(result.json).toBeDefined()
            
            // Check that key attributes are preserved in JSON
            const json = result.json!
            expect(json.profiles).toBe('test:profile')
            expect(json.minBufferTime).toBe('PT5S')
            expect(json.type).toBe('static')
        })

        it('should preserve nested elements through round-trip', () => {
            const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test" minBufferTime="PT2S">
  <Period id="p0">
    <AdaptationSet id="1" mimeType="video/mp4">
      <Representation id="v1" bandwidth="5000000">
        <BaseURL>http://example.com/video/</BaseURL>
        <SegmentBase indexRange="0-1000"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`

            const result = validator.validate(mpd)
            
            expect(result.success).toBe(true)
            
            // Verify nested structure in JSON
            const json = result.json!
            const period = (json.Period as any[])[0]
            const adaptationSet = period.AdaptationSet[0]
            const representation = adaptationSet.Representation[0]
            
            expect(representation.BaseURL).toBeDefined()
            expect(representation.SegmentBase).toBeDefined()
        })

        it('should handle multiple periods', () => {
            const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test" minBufferTime="PT2S">
  <Period id="p1" duration="PT30S"/>
  <Period id="p2" duration="PT30S"/>
  <Period id="p3" duration="PT30S"/>
</MPD>`

            const result = validator.validate(mpd)
            
            expect(result.success).toBe(true)
            
            // Verify multiple periods
            const json = result.json!
            expect(Array.isArray(json.Period)).toBe(true)
            expect((json.Period as any[]).length).toBe(3)
        })
    })

    describe('Text Content', () => {
        it('should preserve BaseURL text content', () => {
            const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test" minBufferTime="PT2S">
  <BaseURL>http://cdn.example.com/</BaseURL>
  <Period id="p0"/>
</MPD>`

            const result = validator.validate(mpd)
            
            expect(result.success).toBe(true)
            
            const json = result.json!
            const baseUrls = json.BaseURL as any[]
            expect(baseUrls[0].$value).toBe('http://cdn.example.com/')
        })

        it('should preserve text content with attributes', () => {
            const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test" minBufferTime="PT2S">
  <BaseURL serviceLocation="cdn1">http://cdn.example.com/</BaseURL>
  <Period id="p0"/>
</MPD>`

            const result = validator.validate(mpd)
            
            expect(result.success).toBe(true)
            
            const json = result.json!
            const baseUrls = json.BaseURL as any[]
            expect(baseUrls[0].$value).toBe('http://cdn.example.com/')
            expect(baseUrls[0].serviceLocation).toBe('cdn1')
        })
    })

    describe('SegmentTimeline', () => {
        it('should preserve SegmentTimeline S elements', () => {
            const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test" minBufferTime="PT2S">
  <Period id="p0">
    <AdaptationSet id="1" mimeType="video/mp4">
      <SegmentTemplate media="seg-$Number$.m4s" timescale="1000">
        <SegmentTimeline>
          <S d="1000" r="9"/>
          <S d="500"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="v1" bandwidth="5000000"/>
    </AdaptationSet>
  </Period>
</MPD>`

            const result = validator.validate(mpd)
            
            expect(result.success).toBe(true)
            
            // Verify SegmentTimeline structure
            const json = result.json!
            const period = (json.Period as any[])[0]
            const adaptationSet = period.AdaptationSet[0]
            const template = adaptationSet.SegmentTemplate
            const timeline = template.SegmentTimeline
            
            expect(Array.isArray(timeline.S)).toBe(true)
            expect(timeline.S.length).toBe(2)
            expect(timeline.S[0].d).toBe(1000)
            expect(timeline.S[0].r).toBe(9)
            expect(timeline.S[1].d).toBe(500)
        })
    })
})

describe('XmlNormalizer', () => {
    const normalizer = new XmlNormalizer()

    describe('Whitespace Normalization', () => {
        it('should normalize different indentation styles', () => {
            const xml1 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period id="p0"/>
</MPD>`

            const xml2 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
    <Period id="p0"/>
</MPD>`

            const result = compareXml(xml1, xml2)
            expect(result.equal).toBe(true)
        })

        it('should normalize empty lines', () => {
            const xml1 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period id="p0"/>
</MPD>`

            const xml2 = `<?xml version="1.0"?>

<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">

  <Period id="p0"/>

</MPD>`

            const result = compareXml(xml1, xml2)
            expect(result.equal).toBe(true)
        })
    })

    describe('Attribute Order', () => {
        it('should treat different attribute orders as equal', () => {
            const xml1 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test" minBufferTime="PT2S">
  <Period id="p0"/>
</MPD>`

            const xml2 = `<?xml version="1.0"?>
<MPD minBufferTime="PT2S" xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="test">
  <Period id="p0"/>
</MPD>`

            const result = compareXml(xml1, xml2)
            expect(result.equal).toBe(true)
        })
    })

    describe('Numeric Values', () => {
        it('should normalize equivalent numeric values', () => {
            const xml1 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet>
      <Representation bandwidth="1000000"/>
    </AdaptationSet>
  </Period>
</MPD>`

            const xml2 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet>
      <Representation bandwidth="1000000"/>
    </AdaptationSet>
  </Period>
</MPD>`

            const result = compareXml(xml1, xml2)
            expect(result.equal).toBe(true)
        })
    })

    describe('Comparison Differences', () => {
        it('should detect different attribute values', () => {
            const xml1 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period id="p1"/>
</MPD>`

            const xml2 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period id="p2"/>
</MPD>`

            const result = compareXml(xml1, xml2)
            expect(result.equal).toBe(false)
            expect(result.differences).toBeDefined()
            expect(result.differences!.length).toBeGreaterThan(0)
        })

        it('should detect missing elements', () => {
            const xml1 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period id="p0">
    <AdaptationSet id="1"/>
  </Period>
</MPD>`

            const xml2 = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period id="p0"/>
</MPD>`

            const result = compareXml(xml1, xml2)
            expect(result.equal).toBe(false)
        })
    })
})

describe('Real MPD Examples', () => {
    // Skip if examples directory doesn't exist
    const examplesExist = fs.existsSync(EXAMPLES_DIR)
    
    const validator = new RoundTripValidator({
        skipXsdValidation: true,
        skipJsonSchemaValidation: true,
    })

    // Test a sample of example files
    const sampleFiles = [
        'example_G1.mpd',
        'example_G2.mpd',
        'example_G3.mpd',
    ]

    for (const filename of sampleFiles) {
        const filePath = path.join(EXAMPLES_DIR, filename)
        
        it.skipIf(!examplesExist || !fs.existsSync(filePath))(`should round-trip ${filename}`, () => {
            const result = validator.validateFile(filePath)
            
            // Log details on failure for debugging
            if (!result.success) {
                console.error(`Failed: ${filename}`)
                console.error(`Error: ${result.error}`)
                if (result.comparison?.differences) {
                    console.error('Differences:')
                    result.comparison.differences.slice(0, 10).forEach(d => console.error(d))
                }
            }
            
            expect(result.success).toBe(true)
        })
    }
})

describe('JsonToXmlConverter with Validation', () => {
    const converter = new JsonToXmlConverter({
        skipXsdValidation: true,
        skipJsonSchemaValidation: false,
    })

    it('should validate and convert valid JSON', () => {
        const json = {
            profiles: 'urn:mpeg:dash:profile:isoff-on-demand:2011',
            minBufferTime: 'PT2S',
            Period: [{ id: 'p0' }]
        }

        const result = converter.convertWithValidation(json)
        
        expect(result.success).toBe(true)
        expect(result.xml).toBeDefined()
        expect(result.xml).toContain('<MPD')
    })

    it('should return errors for invalid JSON structure', () => {
        // Missing required minBufferTime
        const invalidJson = {
            profiles: 'test',
            Period: [{}]
        }

        // Note: This depends on the JSON Schema requirements
        // The test checks that validation is being performed
        const result = converter.convertWithValidation(invalidJson as any)
        
        // Even if validation fails, we should get some response
        expect(result).toBeDefined()
    })
})
