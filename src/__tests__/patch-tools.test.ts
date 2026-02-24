/**
 * Tests for MPD Patch Converter and Applicator
 *
 * Covers:
 * - PatchConverter: XML patch → JSON patch conversion
 * - PatchApplicator: JSON patch application to JSON MPD
 * - End-to-end: XML patch → JSON patch → applied to JSON MPD
 * - Cross-validation: JSON-domain result matches XML-domain result
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import { PatchConverter, JsonPatchDocument } from '../patch-converter'
import { PatchApplicator } from '../patch-applicator'
import { MPDConverter } from '../mpd-converter'

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'output', 'dash-mpd.schema.json')
const TMP_DIR = path.join(__dirname, '..', '..', 'tmp')

// ─── Fixtures ──────────────────────────────────────────────────────

const SIMPLE_MPD_JSON: Record<string, unknown> = {
    id: 'test-mpd',
    profiles: 'urn:mpeg:dash:profile:isoff-live:2011',
    type: 'dynamic',
    publishTime: '2026-01-01T00:00:00Z',
    minBufferTime: 'PT2S',
    PatchLocation: [
        { $value: '/patch?publishTime=2026-01-01T00%3A00%3A00Z', ttl: 60 },
    ],
    Period: [
        {
            id: 'P0',
            start: 'PT0S',
            AdaptationSet: [
                {
                    id: 1,
                    contentType: 'video',
                    mimeType: 'video/mp4',
                    SegmentTemplate: {
                        timescale: 90000,
                        SegmentTimeline: {
                            S: [
                                { t: 100000, d: 180000, r: 10 },
                            ],
                        },
                    },
                    Representation: [
                        { id: 'V300', bandwidth: 300000, width: 640, height: 360 },
                    ],
                },
                {
                    id: 2,
                    contentType: 'audio',
                    mimeType: 'audio/mp4',
                    SegmentTemplate: {
                        timescale: 48000,
                        SegmentTimeline: {
                            S: [
                                { t: 50000, d: 96256 },
                                { d: 95232 },
                                { d: 96256 },
                            ],
                        },
                    },
                    Representation: [
                        { id: 'A48', bandwidth: 48000 },
                    ],
                },
            ],
        },
    ],
}

const SIMPLE_XML_PATCH = `<?xml version="1.0" encoding="UTF-8"?>
<Patch xmlns="urn:mpeg:dash:schema:mpd-patch:2020"
       mpdId="test-mpd"
       originalPublishTime="2026-01-01T00:00:00Z"
       publishTime="2026-01-01T00:01:00Z">
  <replace sel="/MPD/@publishTime">2026-01-01T00:01:00Z</replace>
  <replace sel="/MPD/PatchLocation[1]">
    <PatchLocation ttl="60">/patch?publishTime=2026-01-01T00%3A01%3A00Z</PatchLocation>
  </replace>
  <remove sel="/MPD/Period[@id=&apos;P0&apos;]/AdaptationSet[@id=&apos;2&apos;]/SegmentTemplate/SegmentTimeline/S[1]"/>
  <add sel="/MPD/Period[@id=&apos;P0&apos;]/AdaptationSet[@id=&apos;2&apos;]/SegmentTemplate/SegmentTimeline" pos="prepend">
    <S t="49000" d="96256"/>
  </add>
  <add sel="/MPD/Period[@id=&apos;P0&apos;]/AdaptationSet[@id=&apos;2&apos;]/SegmentTemplate/SegmentTimeline/S[3]" pos="after">
    <S d="95232"/>
  </add>
</Patch>`

// ─── PatchConverter Tests ──────────────────────────────────────────

describe('PatchConverter', () => {
    let converter: PatchConverter

    beforeAll(() => {
        converter = new PatchConverter()
    })

    describe('Metadata parsing', () => {
        it('should extract mpdId, publishTime, originalPublishTime', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            expect(result.mpdId).toBe('test-mpd')
            expect(result.publishTime).toBe('2026-01-01T00:01:00Z')
            expect(result.originalPublishTime).toBe('2026-01-01T00:00:00Z')
        })

        it('should throw on missing Patch root element', () => {
            expect(() => converter.convert('<root><add sel="/MPD/@x">1</add></root>')).toThrow(
                'No <Patch> root element found',
            )
        })

        it('should throw on missing required attributes', () => {
            expect(() =>
                converter.convert(
                    '<Patch xmlns="urn:mpeg:dash:schema:mpd-patch:2020" mpdId="x"></Patch>',
                ),
            ).toThrow('missing required attributes')
        })
    })

    describe('Operation count and order', () => {
        it('should produce correct number of operations', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            expect(result.operations).toHaveLength(5)
        })

        it('should preserve operation order', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            expect(result.operations[0]).toHaveProperty('replace')
            expect(result.operations[1]).toHaveProperty('replace')
            expect(result.operations[2]).toHaveProperty('remove')
            expect(result.operations[3]).toHaveProperty('add')
            expect(result.operations[4]).toHaveProperty('add')
        })
    })

    describe('Replace operations', () => {
        it('should convert attribute replace with $value', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            const op = result.operations[0].replace!
            expect(op.sel).toBe('/MPD/@publishTime')
            expect(op.$value).toBe('2026-01-01T00:01:00Z')
        })

        it('should convert element replace with element payload', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            const op = result.operations[1].replace!
            expect(op.sel).toBe('/MPD/PatchLocation[1]')
            expect(op.PatchLocation).toBeDefined()
            const pl = op.PatchLocation as any
            expect(pl.$value).toBe('/patch?publishTime=2026-01-01T00%3A01%3A00Z')
            expect(pl.ttl).toBe(60) // Coerced to number
        })

        it('should handle empty replace content', () => {
            const xml = `<Patch xmlns="urn:mpeg:dash:schema:mpd-patch:2020"
                mpdId="x" originalPublishTime="2020-01-01T00:00:00Z" publishTime="2020-01-01T00:01:00Z">
                <replace sel="/MPD/@mediaPresentationDuration"></replace>
            </Patch>`
            const result = converter.convert(xml)
            expect(result.operations[0].replace!.$value).toBe('')
        })
    })

    describe('Remove operations', () => {
        it('should convert remove with selector', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            const op = result.operations[2].remove!
            expect(op.sel).toBe(
                "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline/S[1]",
            )
        })

        it('should decode XML entities in selector', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            const op = result.operations[2].remove!
            // &apos; should be decoded to '
            expect(op.sel).toContain("[@id='P0']")
            expect(op.sel).toContain("[@id='2']")
        })

        it('should include ws attribute when present', () => {
            const xml = `<Patch xmlns="urn:mpeg:dash:schema:mpd-patch:2020"
                mpdId="x" originalPublishTime="2020-01-01T00:00:00Z" publishTime="2020-01-01T00:01:00Z">
                <remove sel="/MPD/Period[1]" ws="after"/>
            </Patch>`
            const result = converter.convert(xml)
            expect(result.operations[0].remove!.ws).toBe('after')
        })
    })

    describe('Add operations', () => {
        it('should convert add with prepend position', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            const op = result.operations[3].add!
            expect(op.sel).toContain('SegmentTimeline')
            expect(op.pos).toBe('prepend')
            expect(op.S).toBeDefined()
            const s = op.S as any
            expect(s.t).toBe(49000) // Coerced to number
            expect(s.d).toBe(96256)
        })

        it('should convert add with after position', () => {
            const result = converter.convert(SIMPLE_XML_PATCH)
            const op = result.operations[4].add!
            expect(op.pos).toBe('after')
            expect(op.S).toBeDefined()
            const s = op.S as any
            expect(s.d).toBe(95232)
        })

        it('should handle add without position', () => {
            const xml = `<Patch xmlns="urn:mpeg:dash:schema:mpd-patch:2020"
                mpdId="x" originalPublishTime="2020-01-01T00:00:00Z" publishTime="2020-01-01T00:01:00Z">
                <add sel="/MPD/Period[@id='P0']">
                    <BaseURL>http://example.com/</BaseURL>
                </add>
            </Patch>`
            const result = converter.convert(xml)
            const op = result.operations[0].add!
            expect(op.pos).toBeUndefined()
            expect(op.BaseURL).toBeDefined()
        })
    })

    describe('Type coercion', () => {
        it('should coerce integer attribute values to numbers', () => {
            const xml = `<Patch xmlns="urn:mpeg:dash:schema:mpd-patch:2020"
                mpdId="x" originalPublishTime="2020-01-01T00:00:00Z" publishTime="2020-01-01T00:01:00Z">
                <add sel="/MPD/Period[@id='P0']" pos="prepend">
                    <S t="12345678" d="90000" r="5"/>
                </add>
            </Patch>`
            const result = converter.convert(xml)
            const s = result.operations[0].add!.S as any
            expect(typeof s.t).toBe('number')
            expect(typeof s.d).toBe('number')
            expect(typeof s.r).toBe('number')
        })
    })

    describe('File conversion', () => {
        const patchFile = path.join(TMP_DIR, 'patch.mpp')

        it('should convert real-world patch file', () => {
            if (!fs.existsSync(patchFile)) return // Skip if no test data

            const result = converter.convertFile(patchFile)
            expect(result.mpdId).toBe('auto-patch-id')
            expect(result.operations).toHaveLength(7)
        })
    })
})

// ─── PatchApplicator Tests ─────────────────────────────────────────

describe('PatchApplicator', () => {
    let applicator: PatchApplicator

    beforeAll(() => {
        applicator = new PatchApplicator(SCHEMA_PATH)
    })

    function deepClone<T>(obj: T): T {
        return JSON.parse(JSON.stringify(obj))
    }

    describe('Selector validation', () => {
        it('should reject selectors not starting with /MPD', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [{ replace: { sel: '/Root/@attr', $value: 'x' } }],
            })
            expect(result.success).toBe(false)
            expect(result.errors[0]).toContain('must begin with /MPD')
        })

        it('should reject unsupported text() construct', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [{ replace: { sel: '/MPD/Period[1]/text()', $value: 'x' } }],
            })
            expect(result.success).toBe(false)
            expect(result.errors[0]).toContain('Unsupported selector construct')
        })

        it('should reject parent axis (..)', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    { replace: { sel: '/MPD/Period[1]/../@type', $value: 'static' } },
                ],
            })
            expect(result.success).toBe(false)
        })

        it('should reject wildcard (*)', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [{ remove: { sel: '/MPD/Period/*' } }],
            })
            expect(result.success).toBe(false)
        })
    })

    describe('Replace attribute', () => {
        it('should replace a top-level attribute', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        replace: {
                            sel: '/MPD/@publishTime',
                            $value: '2026-01-01T00:01:00Z',
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            expect(result.operationsApplied).toBe(1)
            expect(result.mpd.publishTime).toBe('2026-01-01T00:01:00Z')
        })

        it('should not modify the original MPD object', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const original = deepClone(mpd)
            applicator.apply(mpd, {
                operations: [
                    { replace: { sel: '/MPD/@publishTime', $value: 'changed' } },
                ],
            })
            expect(mpd).toEqual(original)
        })
    })

    describe('Replace element', () => {
        it('should replace an array element by positional predicate', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        replace: {
                            sel: '/MPD/PatchLocation[1]',
                            PatchLocation: {
                                $value: '/patch?publishTime=2026-01-01T00%3A01%3A00Z',
                                ttl: 60,
                            },
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            const pl = (result.mpd.PatchLocation as any[])[0]
            expect(pl.$value).toBe('/patch?publishTime=2026-01-01T00%3A01%3A00Z')
            expect(pl.ttl).toBe(60)
        })
    })

    describe('Remove operations', () => {
        it('should remove an array element by positional predicate', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const audioAS = (mpd.Period as any[])[0].AdaptationSet[1]
            expect(audioAS.SegmentTemplate.SegmentTimeline.S).toHaveLength(3)

            const result = applicator.apply(mpd, {
                operations: [
                    {
                        remove: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline/S[1]",
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            const patchedAS = (result.mpd.Period as any[])[0].AdaptationSet[1]
            expect(patchedAS.SegmentTemplate.SegmentTimeline.S).toHaveLength(2)
            // First element should now be what was previously S[2]
            expect(patchedAS.SegmentTemplate.SegmentTimeline.S[0].d).toBe(95232)
        })

        it('should remove an attribute', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    { remove: { sel: '/MPD/@type' } },
                ],
            })
            expect(result.success).toBe(true)
            expect(result.mpd.type).toBeUndefined()
        })
    })

    describe('Add operations', () => {
        it('should prepend to an array', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        add: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline",
                            pos: 'prepend',
                            S: { t: 49000, d: 96256 },
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            const s = (result.mpd.Period as any[])[0].AdaptationSet[1].SegmentTemplate.SegmentTimeline.S
            expect(s).toHaveLength(4)
            expect(s[0]).toEqual({ t: 49000, d: 96256 })
        })

        it('should add after a specific element', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        add: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline/S[2]",
                            pos: 'after',
                            S: { d: 99999 },
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            const s = (result.mpd.Period as any[])[0].AdaptationSet[1].SegmentTemplate.SegmentTimeline.S
            expect(s).toHaveLength(4)
            expect(s[2]).toEqual({ d: 99999 }) // Inserted after position 1 (0-based)
        })

        it('should add before a specific element', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        add: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline/S[1]",
                            pos: 'before',
                            S: { d: 88888 },
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            const s = (result.mpd.Period as any[])[0].AdaptationSet[1].SegmentTemplate.SegmentTimeline.S
            expect(s).toHaveLength(4)
            expect(s[0]).toEqual({ d: 88888 }) // Before position 0
        })

        it('should append to an array (no pos)', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        add: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline",
                            S: { d: 77777 },
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            const s = (result.mpd.Period as any[])[0].AdaptationSet[1].SegmentTemplate.SegmentTimeline.S
            expect(s).toHaveLength(4)
            expect(s[3]).toEqual({ d: 77777 }) // Appended at end
        })
    })

    describe('Predicate matching', () => {
        it('should match string attribute predicates', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        remove: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='1']/SegmentTemplate/SegmentTimeline/S[1]",
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            // AdaptationSet id=1 (video) should have its S removed
            const videoAS = (result.mpd.Period as any[])[0].AdaptationSet[0]
            expect(videoAS.id).toBe(1)
            expect(videoAS.SegmentTemplate.SegmentTimeline.S).toHaveLength(0)
        })

        it('should match integer attribute predicates with type coercion', () => {
            // AdaptationSet.id is xs:unsignedInt → JSON integer
            // XPath predicate uses string '2', JSON has number 2
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    {
                        remove: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline/S[1]",
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            // Audio AS (id=2) should have first S removed
            const audioAS = (result.mpd.Period as any[])[0].AdaptationSet[1]
            expect(audioAS.id).toBe(2)
            expect(audioAS.SegmentTemplate.SegmentTimeline.S).toHaveLength(2)
        })
    })

    describe('Multiple operations', () => {
        it('should apply all operations in order', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    // 1. Update publishTime
                    { replace: { sel: '/MPD/@publishTime', $value: '2026-01-01T00:01:00Z' } },
                    // 2. Remove first audio S
                    {
                        remove: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline/S[1]",
                        },
                    },
                    // 3. Prepend new audio S
                    {
                        add: {
                            sel: "/MPD/Period[@id='P0']/AdaptationSet[@id='2']/SegmentTemplate/SegmentTimeline",
                            pos: 'prepend',
                            S: { t: 49000, d: 96256 },
                        },
                    },
                ],
            })

            expect(result.success).toBe(true)
            expect(result.operationsApplied).toBe(3)
            expect(result.mpd.publishTime).toBe('2026-01-01T00:01:00Z')

            const audioS = (result.mpd.Period as any[])[0].AdaptationSet[1].SegmentTemplate
                .SegmentTimeline.S
            // Original had 3, removed 1, added 1 = 3 total
            expect(audioS).toHaveLength(3)
            expect(audioS[0]).toEqual({ t: 49000, d: 96256 })
        })

        it('should fail atomically on invalid selector', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    // Valid operation
                    { replace: { sel: '/MPD/@publishTime', $value: 'new' } },
                    // Invalid operation (unsupported construct)
                    { remove: { sel: '/MPD/Period/text()' } },
                ],
            })
            expect(result.success).toBe(false)
            expect(result.operationsApplied).toBe(0) // Atomic: nothing applied
            // Original MPD should be unchanged (deep copy is returned)
            expect(result.mpd.publishTime).toBe('2026-01-01T00:00:00Z')
        })
    })

    describe('Error handling', () => {
        it('should fail on non-existent path', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    { remove: { sel: '/MPD/NonExistent/Foo' } },
                ],
            })
            expect(result.success).toBe(false)
            expect(result.errors).toHaveLength(1)
        })

        it('should fail when predicate requires array but finds non-array', () => {
            const mpd = deepClone(SIMPLE_MPD_JSON)
            const result = applicator.apply(mpd, {
                operations: [
                    { remove: { sel: '/MPD/Period[1]/AdaptationSet[1]/SegmentTemplate[1]' } },
                ],
            })
            // SegmentTemplate is not an array
            expect(result.success).toBe(false)
        })
    })
})

// ─── End-to-End Integration Tests ──────────────────────────────────

describe('Patch End-to-End', () => {
    it('should round-trip: XML patch → JSON patch → apply to JSON MPD', () => {
        const converter = new PatchConverter()
        const jsonPatch = converter.convert(SIMPLE_XML_PATCH)

        const applicator = new PatchApplicator(SCHEMA_PATH)
        const mpd = JSON.parse(JSON.stringify(SIMPLE_MPD_JSON))
        const result = applicator.apply(mpd, jsonPatch as any)

        expect(result.success).toBe(true)
        expect(result.operationsApplied).toBe(5)

        // Verify key changes
        expect(result.mpd.publishTime).toBe('2026-01-01T00:01:00Z')

        const pl = (result.mpd.PatchLocation as any[])[0]
        expect(pl.$value).toBe('/patch?publishTime=2026-01-01T00%3A01%3A00Z')

        const audioS = (result.mpd.Period as any[])[0].AdaptationSet[1].SegmentTemplate
            .SegmentTimeline.S
        // Original: 3, removed S[1], prepend 1, add after S[3] = 4
        expect(audioS).toHaveLength(4)
        expect(audioS[0]).toEqual({ t: 49000, d: 96256 }) // Prepended
    })
})

// ─── Real-World Test Data ──────────────────────────────────────────

describe('Real-World Patch (tmp/ test data)', () => {
    const manifestPath = path.join(TMP_DIR, 'manifest.mpd')
    const patchPath = path.join(TMP_DIR, 'patch.mpp')
    const manifestJsonPath = path.join(TMP_DIR, 'manifest.json')

    const hasTestData =
        fs.existsSync(manifestPath) && fs.existsSync(patchPath) && fs.existsSync(manifestJsonPath)

    it.skipIf(!hasTestData)('should convert real-world XML patch to JSON', () => {
        const converter = new PatchConverter()
        const jsonPatch = converter.convertFile(patchPath)

        expect(jsonPatch.mpdId).toBe('auto-patch-id')
        expect(jsonPatch.operations).toHaveLength(7)

        // Op 1: replace publishTime
        expect(jsonPatch.operations[0].replace!.sel).toBe('/MPD/@publishTime')

        // Op 2: replace PatchLocation[1]
        expect(jsonPatch.operations[1].replace!.sel).toBe('/MPD/PatchLocation[1]')
        expect(jsonPatch.operations[1].replace!.PatchLocation).toBeDefined()

        // Op 3: remove audio S[1]
        expect(jsonPatch.operations[2].remove!.sel).toContain("AdaptationSet[@id='2']")

        // Op 4: add prepend audio S
        expect(jsonPatch.operations[3].add!.pos).toBe('prepend')

        // Op 5: add after audio S[16]
        expect(jsonPatch.operations[4].add!.pos).toBe('after')

        // Op 6: remove video S[1]
        expect(jsonPatch.operations[5].remove!.sel).toContain("AdaptationSet[@id='1']")

        // Op 7: add prepend video S
        expect(jsonPatch.operations[6].add!.pos).toBe('prepend')
    })

    it.skipIf(!hasTestData)('should apply real-world patch to JSON MPD', () => {
        const converter = new PatchConverter()
        const jsonPatch = converter.convertFile(patchPath)
        const mpdJson = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf-8'))

        const applicator = new PatchApplicator(SCHEMA_PATH)
        const result = applicator.apply(mpdJson, jsonPatch as any)

        expect(result.success).toBe(true)
        expect(result.operationsApplied).toBe(7)

        // Verify publishTime updated
        expect(result.mpd.publishTime).toBe('2026-02-12T11:53:22Z')

        // Verify PatchLocation updated
        const pl = (result.mpd.PatchLocation as any[])[0]
        expect(pl.$value).toContain('publishTime=2026-02-12T11%3A53%3A22Z')

        // Verify audio S array: 16 → 17 (removed 1, added 2)
        const audioAS = (result.mpd.Period as any[])[0].AdaptationSet[0]
        expect(audioAS.id).toBe(2)
        expect(audioAS.SegmentTemplate.SegmentTimeline.S).toHaveLength(17)
        expect(audioAS.SegmentTemplate.SegmentTimeline.S[0].t).toBe(85003062720512)
        expect(audioAS.SegmentTemplate.SegmentTimeline.S[16].d).toBe(96256)

        // Verify video S array: 1 → 1 (removed 1, added 1)
        const videoAS = (result.mpd.Period as any[])[0].AdaptationSet[1]
        expect(videoAS.id).toBe(1)
        expect(videoAS.SegmentTemplate.SegmentTimeline.S).toHaveLength(1)
        expect(videoAS.SegmentTemplate.SegmentTimeline.S[0].t).toBe(159380742600000)
    })

    it.skipIf(!hasTestData)(
        'should produce identical result via full pipeline (XML MPD → JSON → patch)',
        () => {
            // Convert XML MPD to JSON
            const mpdConverter = new MPDConverter({
                skipXsdValidation: true,
                skipJsonSchemaValidation: true,
            })
            const mpdResult = mpdConverter.convertFile(manifestPath)
            expect(mpdResult.success).toBe(true)

            // Convert and apply patch
            const converter = new PatchConverter()
            const jsonPatch = converter.convertFile(patchPath)

            const applicator = new PatchApplicator(SCHEMA_PATH)
            const result = applicator.apply(mpdResult.json!, jsonPatch as any)

            expect(result.success).toBe(true)
            expect(result.operationsApplied).toBe(7)

            // Compare with pre-computed JSON MPD patch result
            const preJsonMpd = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf-8'))
            const preResult = applicator.apply(preJsonMpd, jsonPatch as any)

            expect(result.mpd).toEqual(preResult.mpd)
        },
    )
})
