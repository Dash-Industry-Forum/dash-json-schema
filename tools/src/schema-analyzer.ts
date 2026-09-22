/**
 * Schema Analyzer for MPD Converter
 * 
 * Analyzes the JSON Schema to dynamically determine type information
 * for XML to JSON conversion, replacing hardcoded type mappings.
 */

import * as fs from 'fs'

export interface TypeInfo {
    jsonType: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
    isVector: boolean           // UIntVectorType, StringVectorType, etc.
    vectorItemType?: 'integer' | 'string'
    hasSimpleContent: boolean   // has $value property
    pattern?: string            // for string validation
    format?: string             // for string format (uri-reference, date-time, etc.)
    enumValues?: string[]       // for enum types
    isAttribute?: boolean       // marked by JSON Schema generator (x-xml-attribute)
}

interface SchemaProperty {
    type?: string | string[]
    $ref?: string
    items?: SchemaProperty
    properties?: Record<string, SchemaProperty>
    allOf?: SchemaProperty[]
    anyOf?: SchemaProperty[]
    oneOf?: SchemaProperty[]
    pattern?: string
    format?: string
    enum?: string[]
    minimum?: number
    maximum?: number
    description?: string
}

interface JSONSchema {
    $schema?: string
    $ref?: string
    $defs?: Record<string, SchemaProperty>
    properties?: Record<string, SchemaProperty>
    description?: string
}

/**
 * Analyzes JSON Schema to provide type information for conversion
 */
export class SchemaAnalyzer {
    private schema: JSONSchema | null = null
    private schemaPath: string
    private initialized = false

    // Cached analysis results
    private arrayElements = new Set<string>()
    private nonArrayElements = new Map<string, Set<string>>()  // parentDef -> set of non-array child elements
    private simpleContentElements = new Set<string>()
    private elementPropertyTypes = new Map<string, Map<string, TypeInfo>>()
    private resolvedDefs = new Map<string, SchemaProperty>()

    constructor(schemaPath: string) {
        this.schemaPath = schemaPath
    }

    /**
     * Lazily initialize the analyzer by loading and analyzing the schema
     */
    private ensureInitialized(): void {
        if (this.initialized) return

        if (!fs.existsSync(this.schemaPath)) {
            console.warn(`Schema file not found: ${this.schemaPath}`)
            this.initialized = true
            return
        }

        try {
            const schemaContent = fs.readFileSync(this.schemaPath, 'utf-8')
            this.schema = JSON.parse(schemaContent)
            this.analyzeSchema()
        } catch (error) {
            console.warn(`Failed to load schema: ${error}`)
        }

        this.initialized = true
    }

    /**
     * Analyze the entire schema to build type maps
     */
    private analyzeSchema(): void {
        if (!this.schema || !this.schema.$defs) return

        // First pass: resolve all definitions
        for (const [defName, defSchema] of Object.entries(this.schema.$defs)) {
            this.resolvedDefs.set(defName, this.resolveRefs(defSchema))
        }

        // Second pass: analyze each definition for array elements and property types
        for (const [defName, defSchema] of Object.entries(this.schema.$defs)) {
            this.analyzeDefinition(defName, defSchema)
        }
    }

    /**
     * Recursively resolve $ref references in a schema
     */
    private resolveRefs(schema: SchemaProperty, visited = new Set<string>()): SchemaProperty {
        if (!schema) return schema

        if (schema.$ref) {
            const refName = this.extractRefName(schema.$ref)
            if (visited.has(refName)) {
                // Circular reference - return as-is
                return schema
            }

            visited.add(refName)
            const refSchema = this.schema?.$defs?.[refName]
            if (refSchema) {
                // Merge the referenced schema with any local properties
                const resolved = this.resolveRefs(refSchema, visited)
                return { ...resolved, ...schema, $ref: undefined }
            }
        }

        // Handle allOf composition
        if (schema.allOf) {
            let merged: SchemaProperty = {}
            for (const subSchema of schema.allOf) {
                const resolved = this.resolveRefs(subSchema, new Set(visited))
                merged = this.mergeSchemas(merged, resolved)
            }
            // Merge with local properties
            const localProps = { ...schema, allOf: undefined }
            return this.mergeSchemas(merged, localProps)
        }

        return schema
    }

    /**
     * Merge two schema objects, combining their properties
     */
    private mergeSchemas(base: SchemaProperty, overlay: SchemaProperty): SchemaProperty {
        const merged: SchemaProperty = { ...base }

        for (const [key, value] of Object.entries(overlay)) {
            if (value === undefined) continue

            if (key === 'properties' && merged.properties) {
                merged.properties = { ...merged.properties, ...value as Record<string, SchemaProperty> }
            } else if (key === 'allOf' || key === 'anyOf' || key === 'oneOf') {
                // Skip composition keywords in merge
                continue
            } else {
                (merged as Record<string, unknown>)[key] = value
            }
        }

        return merged
    }

    /**
     * Extract definition name from $ref path (e.g., "#/$defs/MPDtype" -> "MPDtype")
     */
    private extractRefName(ref: string): string {
        const match = ref.match(/#\/\$defs\/(.+)/)
        return match ? match[1] : ref
    }

    /**
     * Analyze a definition for array elements and property types
     */
    private analyzeDefinition(defName: string, schema: SchemaProperty): void {
        const resolved = this.resolveRefs(schema)
        const properties = resolved.properties

        if (!properties) return

        const propertyTypes = new Map<string, TypeInfo>()

        for (const [propName, propSchema] of Object.entries(properties)) {
            const resolvedProp = this.resolveRefs(propSchema)
            const typeInfo = this.extractTypeInfo(resolvedProp)

            propertyTypes.set(propName, typeInfo)

            // Track array elements globally
            if (typeInfo.jsonType === 'array') {
                this.arrayElements.add(propName)
            } else if (typeInfo.jsonType === 'object') {
                // Track elements that are NOT arrays in this specific parent
                // This handles cases like UTCTiming which is an array at MPD level
                // but a single object inside ProducerReferenceTimeType
                if (!this.nonArrayElements.has(defName)) {
                    this.nonArrayElements.set(defName, new Set())
                }
                this.nonArrayElements.get(defName)!.add(propName)
            }

            // Track simple content elements
            // 1. If the property itself has $value
            if (typeInfo.hasSimpleContent) {
                this.simpleContentElements.add(propName)
            }
            
            // 2. If the property references a type that has $value (via $ref)
            if (propSchema.$ref) {
                const refName = this.extractRefName(propSchema.$ref)
                const refSchema = this.schema?.$defs?.[refName]
                if (refSchema) {
                    const refResolved = this.resolveRefs(refSchema)
                    if (refResolved.properties?.$value) {
                        this.simpleContentElements.add(propName)
                    }
                }
            }
            
            // 3. If the property is an array with items that have $value or reference a type with $value
            if (resolvedProp.type === 'array' && resolvedProp.items) {
                const itemsResolved = this.resolveRefs(resolvedProp.items)
                if (itemsResolved.properties?.$value) {
                    this.simpleContentElements.add(propName)
                }
                
                // 4. Also analyze inline object items to extract their property types
                // This handles cases like S[] in SegmentTimeline where items have properties like p, pE
                if (itemsResolved.properties) {
                    for (const [itemPropName, itemPropSchema] of Object.entries(itemsResolved.properties)) {
                        const itemPropResolved = this.resolveRefs(itemPropSchema)
                        const itemTypeInfo = this.extractTypeInfo(itemPropResolved)
                        // Add to the global property types so they can be looked up
                        propertyTypes.set(itemPropName, itemTypeInfo)
                    }
                }
            }
        }

        // Check if this definition itself has simple content ($value property)
        if (properties.$value) {
            this.simpleContentElements.add(defName)
        }

        this.elementPropertyTypes.set(defName, propertyTypes)
    }

    /**
     * Extract TypeInfo from a resolved schema property
     */
    private extractTypeInfo(schema: SchemaProperty): TypeInfo {
        const info: TypeInfo = {
            jsonType: 'string',
            isVector: false,
            hasSimpleContent: false,
        }

        // Check for $ref to known vector types
        if (schema.$ref) {
            const refName = this.extractRefName(schema.$ref)
            if (refName === 'UIntVectorType') {
                info.jsonType = 'array'
                info.isVector = true
                info.vectorItemType = 'integer'
                return info
            }
            if (refName === 'StringVectorType' || refName === 'StringNoWhitespaceVectorType') {
                info.jsonType = 'array'
                info.isVector = true
                info.vectorItemType = 'string'
                return info
            }
            if (refName === 'AudioSamplingRateType') {
                info.jsonType = 'array'
                info.isVector = true
                info.vectorItemType = 'integer'
                return info
            }
            // Check for string types that should stay as strings
            if (refName === 'FrameRateType' || refName === 'RatioType' || 
                refName === 'ListOfProfilesType' || refName === 'CodecsType' ||
                refName === 'SingleRFC7233RangeType' || refName === 'TagType' ||
                refName === 'StringNoWhitespaceType' || refName === 'RFC6838ContentTypeType') {
                info.jsonType = 'string'
                return info
            }
        }

        // Determine type from schema
        const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type

        if (schemaType === 'array') {
            info.jsonType = 'array'
            // Check if items are integers
            if (schema.items) {
                const itemsResolved = this.resolveRefs(schema.items)
                if (itemsResolved.type === 'integer') {
                    info.isVector = true
                    info.vectorItemType = 'integer'
                } else if (itemsResolved.type === 'string') {
                    info.isVector = true
                    info.vectorItemType = 'string'
                }
            }
        } else if (schemaType === 'integer') {
            info.jsonType = 'integer'
        } else if (schemaType === 'number') {
            info.jsonType = 'number'
        } else if (schemaType === 'boolean') {
            info.jsonType = 'boolean'
        } else if (schemaType === 'object') {
            info.jsonType = 'object'
            // Check for simple content (has $value property)
            if (schema.properties?.$value) {
                info.hasSimpleContent = true
            }
        } else {
            info.jsonType = 'string'
        }

        // Copy additional info
        if (schema.pattern) info.pattern = schema.pattern
        if (schema.format) info.format = schema.format
        if (schema.enum) info.enumValues = schema.enum

        // Copy attribute marker (if present)
        if ((schema as any)['x-xml-attribute'] === true) info.isAttribute = true

        return info
    }

    /**
     * Determine if a property is an XML attribute according to schema markers.
     */
    isAttribute(propertyName: string, parentElement?: string): boolean {
        const typeInfo = this.getAttributeType(propertyName, parentElement)
        return typeInfo?.isAttribute === true
    }

    /**
     * Check if an element should be an array
     * @param elementName The name of the element
     * @param parentElement Optional parent element name for context-aware decisions
     */
    isArrayElement(elementName: string, parentElement?: string): boolean {
        this.ensureInitialized()
        
        // If parent element is specified, check if it has this as a non-array child
        if (parentElement) {
            const defName = this.findDefinitionForElement(parentElement)
            if (defName) {
                const nonArrayChildren = this.nonArrayElements.get(defName)
                if (nonArrayChildren?.has(elementName)) {
                    return false
                }
            }
        }
        
        return this.arrayElements.has(elementName)
    }

    /**
     * Check if an element has simple content ($value)
     */
    hasSimpleContent(elementName: string): boolean {
        this.ensureInitialized()
        return this.simpleContentElements.has(elementName)
    }

    /**
     * Get type info for an attribute, with context from parent element
     */
    getAttributeType(attributeName: string, parentElement?: string): TypeInfo | null {
        this.ensureInitialized()

        // Try to find in specific parent element first
        if (parentElement) {
            // Map element names to their definition names
            const defName = this.findDefinitionForElement(parentElement)
            if (defName) {
                const propTypes = this.elementPropertyTypes.get(defName)
                if (propTypes?.has(attributeName)) {
                    return propTypes.get(attributeName)!
                }
            }
        }

        // Search all definitions for this attribute
        for (const [, propTypes] of this.elementPropertyTypes) {
            if (propTypes.has(attributeName)) {
                return propTypes.get(attributeName)!
            }
        }

        return null
    }

    /**
     * Find the definition name for an element name
     */
    private findDefinitionForElement(elementName: string): string | null {
        // Common mappings
        const mappings: Record<string, string> = {
            'MPD': 'MPDtype',
            'Period': 'PeriodType',
            'AdaptationSet': 'AdaptationSetType',
            'Representation': 'RepresentationType',
            'SubRepresentation': 'SubRepresentationType',
            'SegmentBase': 'SegmentBaseType',
            'SegmentList': 'SegmentListType',
            'SegmentTemplate': 'SegmentTemplateType',
            'SegmentTimeline': 'SegmentTimelineType',
            'BaseURL': 'BaseURLType',
            'ContentProtection': 'ContentProtectionType',
            'Event': 'EventType',
            'EventStream': 'EventStreamType',
            'ServiceDescription': 'ServiceDescriptionType',
            'Latency': 'LatencyType',
            'PlaybackRate': 'PlaybackRateType',
            'InitializationSet': 'InitializationSetType',
            'Preselection': 'PreselectionType',
            'ContentComponent': 'ContentComponentType',
            'ProducerReferenceTime': 'ProducerReferenceTimeType',
            'Label': 'LabelType',
            'GroupLabel': 'LabelType',
            'ImportedMPD': 'ImportedMpdType',
            'CMCDParameters': 'CMCDParameterType',
        }

        if (mappings[elementName]) {
            return mappings[elementName]
        }

        // Try common patterns
        const typeName = `${elementName}Type`
        if (this.elementPropertyTypes.has(typeName)) {
            return typeName
        }

        return null
    }

    /**
     * Check if an attribute should be a UInt vector (space-separated integers)
     */
    isUIntVector(attributeName: string, parentElement?: string): boolean {
        const typeInfo = this.getAttributeType(attributeName, parentElement)
        return typeInfo?.isVector === true && typeInfo?.vectorItemType === 'integer'
    }

    /**
     * Check if an attribute should remain a string (not parsed as number)
     */
    shouldBeString(attributeName: string, parentElement?: string): boolean {
        const typeInfo = this.getAttributeType(attributeName, parentElement)
        if (!typeInfo) return false

        // String type with a pattern (like frameRate, sar, par)
        if (typeInfo.jsonType === 'string' && typeInfo.pattern) {
            return true
        }

        // Explicitly string type
        return typeInfo.jsonType === 'string'
    }

    /**
     * Check if an attribute should be an integer
     */
    shouldBeInteger(attributeName: string, parentElement?: string): boolean {
        const typeInfo = this.getAttributeType(attributeName, parentElement)
        return typeInfo?.jsonType === 'integer'
    }

    /**
     * Check if an attribute should be a number (float)
     */
    shouldBeNumber(attributeName: string, parentElement?: string): boolean {
        const typeInfo = this.getAttributeType(attributeName, parentElement)
        return typeInfo?.jsonType === 'number'
    }

    /**
     * Check if an attribute should be a boolean
     */
    shouldBeBoolean(attributeName: string, parentElement?: string): boolean {
        const typeInfo = this.getAttributeType(attributeName, parentElement)
        return typeInfo?.jsonType === 'boolean'
    }

    /**
     * Get all array element names (for debugging/testing)
     */
    getArrayElements(): Set<string> {
        this.ensureInitialized()
        return new Set(this.arrayElements)
    }

    /**
     * Get all simple content element names (for debugging/testing)
     */
    getSimpleContentElements(): Set<string> {
        this.ensureInitialized()
        return new Set(this.simpleContentElements)
    }
}

export default SchemaAnalyzer
