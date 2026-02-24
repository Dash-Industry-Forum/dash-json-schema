/**
 * Tests for MPD Patch Schema Generation
 *
 * Verifies that DASH-MPD-PATCH.xsd is correctly converted to JSON Schema,
 * including the repeating choice -> operations array mapping and
 * xs:anyType restriction handling for add/replace/remove types.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { JSONSchemaGenerator } from '../json-schema-generator'
import { JSONSchema } from '../types'

const PATCH_XSD = path.join(__dirname, '..', '..', 'xml-schemas', 'DASH-MPD-PATCH.xsd')

describe('Patch Schema Generation', () => {
    let schema: JSONSchema

    beforeAll(() => {
        const generator = new JSONSchemaGenerator()
        schema = generator.generateFromFile(PATCH_XSD)
    })

    describe('Schema Structure', () => {
        it('should have a $ref to PatchType at root', () => {
            expect(schema.$ref).toBe('#/$defs/PatchType')
        })

        it('should have $defs for all expected types', () => {
            expect(schema.$defs).toBeDefined()
            const defNames = Object.keys(schema.$defs!)
            expect(defNames).toContain('PatchType')
            expect(defNames).toContain('add')
            expect(defNames).toContain('remove')
            expect(defNames).toContain('replace')
            expect(defNames).toContain('xpath')
            expect(defNames).toContain('xpath_add')
            expect(defNames).toContain('pos')
            expect(defNames).toContain('type')
            expect(defNames).toContain('ws')
        })

        it('should not have dangling $ref references', () => {
            const json = JSON.stringify(schema)
            const refs = json.match(/"\$ref"\s*:\s*"([^"]+)"/g) || []
            for (const refMatch of refs) {
                const refValue = refMatch.match(/"([^"]+)"$/)?.[1]
                if (refValue && refValue.startsWith('#/$defs/')) {
                    const typeName = refValue.replace('#/$defs/', '')
                    expect(schema.$defs).toHaveProperty(typeName)
                }
            }
        })
    })

    describe('PatchType', () => {
        it('should have operations array property', () => {
            const patchType = schema.$defs!['PatchType']
            expect(patchType.properties).toHaveProperty('operations')
            expect(patchType.properties!['operations'].type).toBe('array')
        })

        it('should have operations as required', () => {
            const patchType = schema.$defs!['PatchType']
            expect(patchType.required).toContain('operations')
        })

        it('should have minItems: 1 on operations', () => {
            const patchType = schema.$defs!['PatchType']
            expect(patchType.properties!['operations'].minItems).toBe(1)
        })

        it('should have oneOf in operations items for add/remove/replace/any', () => {
            const patchType = schema.$defs!['PatchType']
            const items = patchType.properties!['operations'].items as JSONSchema
            expect(items.oneOf).toBeDefined()
            expect(items.oneOf!.length).toBe(4) // add, remove, replace, xs:any
        })

        it('should have mpdId, publishTime, originalPublishTime as required attributes', () => {
            const patchType = schema.$defs!['PatchType']
            expect(patchType.required).toContain('mpdId')
            expect(patchType.required).toContain('publishTime')
            expect(patchType.required).toContain('originalPublishTime')
        })

        it('should have mpdId as string', () => {
            const patchType = schema.$defs!['PatchType']
            expect(patchType.properties!['mpdId']).toEqual({ type: 'string' })
        })

        it('should have publishTime and originalPublishTime as dateTime', () => {
            const patchType = schema.$defs!['PatchType']
            expect(patchType.properties!['publishTime'].format).toBe('iso-date-time')
            expect(patchType.properties!['originalPublishTime'].format).toBe('iso-date-time')
        })

        it('should support anyAttribute (additionalProperties)', () => {
            const patchType = schema.$defs!['PatchType']
            expect(patchType.additionalProperties).toBe(true)
            expect(patchType['x-xml-any-attribute']).toBe(true)
        })
    })

    describe('add type', () => {
        it('should have sel as required attribute of type xpath_add', () => {
            const addType = schema.$defs!['add']
            expect(addType.properties!['sel']).toEqual({ $ref: '#/$defs/xpath_add' })
            expect(addType.required).toContain('sel')
        })

        it('should have optional pos attribute', () => {
            const addType = schema.$defs!['add']
            expect(addType.properties!['pos']).toEqual({ $ref: '#/$defs/pos' })
            expect(addType.required).not.toContain('pos')
        })

        it('should have optional type attribute', () => {
            const addType = schema.$defs!['add']
            expect(addType.properties!['type']).toEqual({ $ref: '#/$defs/type' })
            expect(addType.required).not.toContain('type')
        })

        it('should have $value for mixed content', () => {
            const addType = schema.$defs!['add']
            expect(addType.properties!['$value']).toBeDefined()
            expect(addType.properties!['$value'].type).toBe('string')
        })

        it('should support xs:any child elements', () => {
            const addType = schema.$defs!['add']
            expect(addType['x-xml-any']).toBe(true)
            expect(addType.additionalProperties).toBe(true)
        })
    })

    describe('replace type', () => {
        it('should have sel as required attribute of type xpath', () => {
            const replaceType = schema.$defs!['replace']
            expect(replaceType.properties!['sel']).toEqual({ $ref: '#/$defs/xpath' })
            expect(replaceType.required).toContain('sel')
        })

        it('should have $value for mixed content', () => {
            const replaceType = schema.$defs!['replace']
            expect(replaceType.properties!['$value']).toBeDefined()
            expect(replaceType.properties!['$value'].type).toBe('string')
        })

        it('should support xs:any child elements', () => {
            const replaceType = schema.$defs!['replace']
            expect(replaceType['x-xml-any']).toBe(true)
        })
    })

    describe('remove type', () => {
        it('should have sel as required attribute of type xpath', () => {
            const removeType = schema.$defs!['remove']
            expect(removeType.properties!['sel']).toEqual({ $ref: '#/$defs/xpath' })
            expect(removeType.required).toContain('sel')
        })

        it('should have optional ws attribute', () => {
            const removeType = schema.$defs!['remove']
            expect(removeType.properties!['ws']).toEqual({ $ref: '#/$defs/ws' })
            expect(removeType.required).not.toContain('ws')
        })

        it('should NOT have $value (not mixed content)', () => {
            const removeType = schema.$defs!['remove']
            expect(removeType.properties!['$value']).toBeUndefined()
        })
    })

    describe('Simple types', () => {
        it('pos should be enum with before/after/prepend', () => {
            const pos = schema.$defs!['pos']
            expect(pos.type).toBe('string')
            expect(pos.enum).toEqual(['before', 'after', 'prepend'])
        })

        it('ws should be enum with before/after/both', () => {
            const ws = schema.$defs!['ws']
            expect(ws.type).toBe('string')
            expect(ws.enum).toEqual(['before', 'after', 'both'])
        })

        it('xpath should be string with pattern', () => {
            const xpath = schema.$defs!['xpath']
            expect(xpath.type).toBe('string')
            expect(xpath.pattern).toBeDefined()
        })

        it('xpath_add should be string with pattern', () => {
            const xpathAdd = schema.$defs!['xpath_add']
            expect(xpathAdd.type).toBe('string')
            expect(xpathAdd.pattern).toBeDefined()
        })
    })

    describe('Schema Validation with Ajv', () => {
        let validate: any

        beforeAll(() => {
            const ajv = new Ajv2020({ allErrors: true, strict: false })
            addFormats(ajv)
            validate = ajv.compile(schema)
        })

        it('should compile without errors', () => {
            expect(validate).toBeDefined()
            expect(typeof validate).toBe('function')
        })

        it('should validate a minimal valid patch document', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { remove: { sel: '/MPD/@availabilityStartTime' } },
                ],
            }
            const valid = validate(patch)
            if (!valid) console.log('Validation errors:', validate.errors)
            expect(valid).toBe(true)
        })

        it('should validate a patch with all operation types', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { add: { sel: '/MPD', type: '@mediaPresentationDuration', $value: 'PT3600S' } },
                    { remove: { sel: '/MPD/Period[@id="p1"]' } },
                    { replace: { sel: '/MPD/@publishTime', $value: '2024-02-01T00:00:00Z' } },
                ],
            }
            const valid = validate(patch)
            if (!valid) console.log('Validation errors:', validate.errors)
            expect(valid).toBe(true)
        })

        it('should validate add with pos attribute', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { add: { sel: '/MPD/Period[1]', pos: 'before', $value: 'PT0S' } },
                ],
            }
            const valid = validate(patch)
            if (!valid) console.log('Validation errors:', validate.errors)
            expect(valid).toBe(true)
        })

        it('should validate add with JSON element payload (add Period)', () => {
            // JSON-native payload: add a Period as a JSON object, not an XML fragment
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    {
                        add: {
                            sel: '/MPD',
                            Period: {
                                id: 'p2',
                                start: 'PT60S',
                            },
                        },
                    },
                ],
            }
            const valid = validate(patch)
            if (!valid) console.log('Validation errors:', validate.errors)
            expect(valid).toBe(true)
        })

        it('should validate replace on simpleContent element ($value replacement)', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { replace: { sel: '/MPD/PatchLocation[1]', $value: 'patch.mpp?t=2024-01-02' } },
                ],
            }
            const valid = validate(patch)
            if (!valid) console.log('Validation errors:', validate.errors)
            expect(valid).toBe(true)
        })

        it('should validate remove with ws attribute', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { remove: { sel: '/MPD/Period', ws: 'both' } },
                ],
            }
            const valid = validate(patch)
            if (!valid) console.log('Validation errors:', validate.errors)
            expect(valid).toBe(true)
        })

        it('should reject a patch missing required mpdId', () => {
            const patch = {
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { remove: { sel: '/MPD/@type' } },
                ],
            }
            expect(validate(patch)).toBe(false)
        })

        it('should reject a patch with empty operations array', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [],
            }
            expect(validate(patch)).toBe(false)
        })

        it('should reject add operation missing required sel', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { add: { pos: 'before' } },
                ],
            }
            expect(validate(patch)).toBe(false)
        })

        it('should reject invalid pos enum value', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { add: { sel: '/MPD', pos: 'invalid' } },
                ],
            }
            expect(validate(patch)).toBe(false)
        })

        it('should reject invalid ws enum value', () => {
            const patch = {
                mpdId: 'test-mpd',
                publishTime: '2024-01-01T00:00:00Z',
                originalPublishTime: '2024-01-01T00:00:00Z',
                operations: [
                    { remove: { sel: '/MPD', ws: 'invalid' } },
                ],
            }
            expect(validate(patch)).toBe(false)
        })
    })
})
