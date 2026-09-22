/**
 * Type Mapper - Maps XSD types to JSON Schema types
 */

import { JSONSchema } from './types'

// XSD built-in types to JSON Schema mapping
const XSD_TYPE_MAP: Record<string, () => JSONSchema> = {
    // String types
    'xs:string': () => ({ type: 'string' }),
    'xs:normalizedString': () => ({ type: 'string' }),
    'xs:token': () => ({ type: 'string' }),
    'xs:language': () => ({
        type: 'string',
        pattern: '^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$',
    }),
    'xs:Name': () => ({ type: 'string', pattern: '^[\\p{L}_][\\p{L}\\p{N}._-]*$' }),
    'xs:NCName': () => ({
        type: 'string',
        pattern: '^[\\p{L}_][\\p{L}\\p{N}._-]*$',
    }),
    'xs:ID': () => ({ type: 'string' }),
    'xs:IDREF': () => ({ type: 'string' }),
    'xs:IDREFS': () => ({ type: 'string' }),
    'xs:ENTITY': () => ({ type: 'string' }),
    'xs:ENTITIES': () => ({ type: 'string' }),
    'xs:NMTOKEN': () => ({ type: 'string', pattern: '^[\\p{L}\\p{N}._:-]+$' }),
    'xs:NMTOKENS': () => ({ type: 'string' }),
    'xs:QName': () => ({ type: 'string' }),

    // Numeric types
    'xs:decimal': () => ({ type: 'number' }),
    'xs:float': () => ({ type: 'number' }),
    'xs:double': () => ({ type: 'number' }),
    'xs:integer': () => ({ type: 'integer' }),
    'xs:nonPositiveInteger': () => ({ type: 'integer', maximum: 0 }),
    'xs:negativeInteger': () => ({ type: 'integer', maximum: -1 }),
    'xs:long': () => ({
        type: 'integer',
        minimum: -9223372036854775808,
        maximum: 9223372036854775807,
    }),
    'xs:int': () => ({
        type: 'integer',
        minimum: -2147483648,
        maximum: 2147483647,
    }),
    'xs:short': () => ({ type: 'integer', minimum: -32768, maximum: 32767 }),
    'xs:byte': () => ({ type: 'integer', minimum: -128, maximum: 127 }),
    'xs:nonNegativeInteger': () => ({ type: 'integer', minimum: 0 }),
    'xs:unsignedLong': () => ({
        type: 'integer',
        minimum: 0,
        maximum: 18446744073709551615,
    }),
    'xs:unsignedInt': () => ({
        type: 'integer',
        minimum: 0,
        maximum: 4294967295,
    }),
    'xs:unsignedShort': () => ({
        type: 'integer',
        minimum: 0,
        maximum: 65535,
    }),
    'xs:unsignedByte': () => ({ type: 'integer', minimum: 0, maximum: 255 }),
    'xs:positiveInteger': () => ({ type: 'integer', minimum: 1 }),

    // Boolean
    'xs:boolean': () => ({ type: 'boolean' }),

    // Date and time types
    // Note: We use 'iso-duration' instead of 'duration' because the RFC 3339 duration format
    // (used by ajv-formats) doesn't support fractional seconds, but ISO 8601 (used in XSD) does.
    // The 'iso-duration' format is a custom format registered in mpd-converter.ts
    'xs:duration': () => ({
        type: 'string',
        format: 'iso-duration',
    }),
    // Note: We use 'iso-date-time' instead of 'date-time' because RFC 3339 date-time
    // requires timezone, but ISO 8601/XSD dateTime allows optional timezone
    'xs:dateTime': () => ({
        type: 'string',
        format: 'iso-date-time',
    }),
    'xs:date': () => ({
        type: 'string',
        format: 'date',
    }),
    // Note: We use 'iso-time' instead of 'time' because RFC 3339 time
    // requires timezone, but ISO 8601/XSD time allows optional timezone  
    'xs:time': () => ({
        type: 'string',
        format: 'iso-time',
    }),
    'xs:gYear': () => ({
        type: 'string',
        pattern: '^-?\\d{4,}(Z|[+-]\\d{2}:\\d{2})?$',
    }),
    'xs:gYearMonth': () => ({
        type: 'string',
        pattern: '^-?\\d{4,}-\\d{2}(Z|[+-]\\d{2}:\\d{2})?$',
    }),
    'xs:gMonth': () => ({
        type: 'string',
        pattern: '^--\\d{2}(Z|[+-]\\d{2}:\\d{2})?$',
    }),
    'xs:gMonthDay': () => ({
        type: 'string',
        pattern: '^--\\d{2}-\\d{2}(Z|[+-]\\d{2}:\\d{2})?$',
    }),
    'xs:gDay': () => ({
        type: 'string',
        pattern: '^---\\d{2}(Z|[+-]\\d{2}:\\d{2})?$',
    }),

    // Binary types
    'xs:base64Binary': () => ({
        type: 'string',
        contentEncoding: 'base64',
    }),
    'xs:hexBinary': () => ({
        type: 'string',
        pattern: '^[0-9a-fA-F]*$',
    }),

    // URI type
    'xs:anyURI': () => ({
        type: 'string',
        format: 'uri-reference',
    }),

    // Misc
    'xs:anySimpleType': () => ({}),
    'xs:anyType': () => ({}),
}

export class TypeMapper {
    private customTypes: Map<string, JSONSchema> = new Map()
    private namespaceMap: Map<string, string> = new Map()

    constructor() {
        // Initialize with xlink namespace mappings
        this.namespaceMap.set('xlink', 'http://www.w3.org/1999/xlink')
    }

    /**
     * Register a namespace prefix mapping
     */
    registerNamespace(prefix: string, namespace: string): void {
        this.namespaceMap.set(prefix, namespace)
    }

    /**
     * Register a custom type definition
     */
    registerCustomType(typeName: string, schema: JSONSchema): void {
        this.customTypes.set(typeName, schema)
    }

    /**
     * Map an XSD type to a JSON Schema
     */
    mapType(xsdType: string): JSONSchema {
        // Check if it's a built-in XSD type
        const mapper = XSD_TYPE_MAP[xsdType]
        if (mapper) {
            return mapper()
        }

        // Check if it's a registered custom type
        if (this.customTypes.has(xsdType)) {
            return this.customTypes.get(xsdType)!
        }

        // Check for prefixed type (namespace:localname)
        if (xsdType.includes(':')) {
            const [prefix, localName] = xsdType.split(':')

            // Check without prefix in built-in types
            const prefixedMapper = XSD_TYPE_MAP[`xs:${localName}`]
            if (prefixedMapper) {
                return prefixedMapper()
            }

            // Return a reference to the type
            return { $ref: `#/$defs/${this.normalizeTypeName(xsdType)}` }
        }

        // Return a reference to the type
        return { $ref: `#/$defs/${this.normalizeTypeName(xsdType)}` }
    }

    /**
     * Check if a type is a built-in XSD type
     */
    isBuiltInType(xsdType: string): boolean {
        return XSD_TYPE_MAP.hasOwnProperty(xsdType)
    }

    /**
     * Normalize a type name for use as a JSON Schema definition name
     */
    normalizeTypeName(typeName: string): string {
        // Remove namespace prefix and normalize
        return typeName
            .replace(/^[^:]+:/, '') // Remove namespace prefix
            .replace(/[^a-zA-Z0-9_]/g, '_') // Replace invalid chars
    }

    /**
     * Get the JSON Schema type for a simple XSD type
     */
    getBaseType(xsdType: string): JSONSchema['type'] {
        const mapper = XSD_TYPE_MAP[xsdType]
        if (mapper) {
            const schema = mapper()
            return schema.type
        }
        return 'string' // Default to string for unknown types
    }

    /**
     * Check if a type represents a numeric value
     */
    isNumericType(xsdType: string): boolean {
        const numericTypes = [
            'xs:decimal',
            'xs:float',
            'xs:double',
            'xs:integer',
            'xs:nonPositiveInteger',
            'xs:negativeInteger',
            'xs:long',
            'xs:int',
            'xs:short',
            'xs:byte',
            'xs:nonNegativeInteger',
            'xs:unsignedLong',
            'xs:unsignedInt',
            'xs:unsignedShort',
            'xs:unsignedByte',
            'xs:positiveInteger',
        ]
        return numericTypes.includes(xsdType)
    }

    /**
     * Check if a type represents an integer value
     */
    isIntegerType(xsdType: string): boolean {
        const intTypes = [
            'xs:integer',
            'xs:nonPositiveInteger',
            'xs:negativeInteger',
            'xs:long',
            'xs:int',
            'xs:short',
            'xs:byte',
            'xs:nonNegativeInteger',
            'xs:unsignedLong',
            'xs:unsignedInt',
            'xs:unsignedShort',
            'xs:unsignedByte',
            'xs:positiveInteger',
        ]
        return intTypes.includes(xsdType)
    }

    /**
     * Parse a numeric constraint value
     */
    parseNumericConstraint(value: string | number): number {
        if (typeof value === 'number') return value
        return parseFloat(value)
    }
}
