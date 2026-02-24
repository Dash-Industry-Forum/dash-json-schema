#!/usr/bin/env node
/**
 * JSON to XML Converter for DASH MPD
 * 
 * Converts JSON representation (from MPDConverter) back to XML format.
 * Supports round-trip conversion with namespace handling.
 * 
 * JSON Format Conventions:
 * - `$ns` property contains namespace declarations (URI -> prefix mapping)
 * - Primitive values are attributes, objects/arrays are elements
 * - `$value` contains text content
 * - Extension content is grouped under prefix keys (e.g., "ext": { ... })
 */

import { XMLBuilder } from 'fast-xml-parser'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { NamespaceMap, NamespaceEntry, WELL_KNOWN_NAMESPACES, getNsPrefix, getNsAttributes, isNsDefaultRedeclaration } from './types'
import { SchemaAnalyzer, TypeInfo } from './schema-analyzer'

export interface JsonToXmlConfig {
    /** Include XML declaration */
    xmlDeclaration?: boolean
    /** Indent output */
    indent?: boolean
    /** Indent characters (default: 2 spaces) */
    indentBy?: string
    /** Property name for text content */
    textPropertyName?: string
    /** Path to the XSD schema for validation */
    xsdPath?: string
    /** Path to the JSON Schema for validation */
    jsonSchemaPath?: string
    /** Skip XSD validation of output XML */
    skipXsdValidation?: boolean
    /** Skip JSON Schema validation of input JSON */
    skipJsonSchemaValidation?: boolean
}

export interface ConversionResult {
    success: boolean
    xml?: string
    xsdErrors?: string[]
    jsonSchemaErrors?: string[]
    error?: string
}

const DEFAULT_CONFIG: JsonToXmlConfig = {
    xmlDeclaration: true,
    indent: true,
    indentBy: '  ',
    textPropertyName: '$value',
    xsdPath: path.join(__dirname, '..', 'xml-schemas', 'DASH-MPD.xsd'),
    jsonSchemaPath: path.join(__dirname, '..', 'output', 'dash-mpd.schema.json'),
    skipXsdValidation: false,
    skipJsonSchemaValidation: false,
}

/**
 * JSON to XML Converter class
 * 
 * Converts JSON objects (from MPDConverter) back to DASH MPD XML format.
 * Includes optional validation against XSD and JSON Schema.
 */
export class JsonToXmlConverter {
    private config: JsonToXmlConfig
    private ajv: Ajv2020
    private jsonSchema: Record<string, unknown> | null = null
    private schemaAnalyzer: SchemaAnalyzer | null = null

    constructor(config: Partial<JsonToXmlConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
        this.ajv = new Ajv2020({ 
            allErrors: true, 
            strict: false,
            validateFormats: true,
        })
        addFormats(this.ajv)
        
        // Register custom 'iso-duration' format for ISO 8601 durations
        this.ajv.addFormat('iso-duration', {
            type: 'string',
            validate: (str: string) => {
                const pattern = /^-?P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$|^-?P(\d+)W$/
                return pattern.test(str)
            }
        })

        // Register XSD lexical-space formats for dateTime/time.
        // XSD permits optional timezone, unlike RFC 3339 (used by ajv-formats built-ins).
        this.ajv.addFormat('iso-date-time', {
            type: 'string',
            validate: (str: string) => {
                const pattern = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
                return pattern.test(str)
            },
        })
        this.ajv.addFormat('iso-time', {
            type: 'string',
            validate: (str: string) => {
                const pattern = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
                return pattern.test(str)
            },
        })
    }

    /**
     * Get the schema analyzer (lazy initialization)
     */
    private getSchemaAnalyzer(): SchemaAnalyzer | null {
        if (!this.schemaAnalyzer && this.config.jsonSchemaPath) {
            this.schemaAnalyzer = new SchemaAnalyzer(this.config.jsonSchemaPath)
        }
        return this.schemaAnalyzer
    }

    /**
     * Convert JSON object to XML string (simple conversion without validation)
     */
    convert(json: Record<string, unknown>): string {
        // Step 1: Collect all namespace declarations from the JSON tree
        const namespaces = this.collectNamespaces(json)

        // Step 2: Build the XML structure with proper attribute prefixes
        const xmlStructure = this.buildXmlStructure(json, namespaces, null, 'MPD')

        // Step 3: Wrap in MPD root element with namespace declarations
        const mpdStructure = this.wrapWithMPD(xmlStructure as Record<string, unknown>, namespaces)

        // Step 4: Build the XML string
        return this.buildXml(mpdStructure)
    }

    /**
     * Convert JSON object to XML string with full validation
     * Validates input JSON against JSON Schema and output XML against XSD
     */
    convertWithValidation(json: Record<string, unknown>): ConversionResult {
        // Step 1: Validate input JSON against JSON Schema (if not skipped)
        if (!this.config.skipJsonSchemaValidation) {
            const jsonSchemaValidation = this.validateAgainstJsonSchema(json)
            if (!jsonSchemaValidation.valid) {
                return {
                    success: false,
                    jsonSchemaErrors: jsonSchemaValidation.errors,
                    error: 'JSON Schema validation failed'
                }
            }
        }

        // Step 2: Convert JSON to XML
        const xml = this.convert(json)

        // Step 3: Validate output XML against XSD (if not skipped)
        if (!this.config.skipXsdValidation) {
            const xsdValidation = this.validateAgainstXSD(xml)
            if (!xsdValidation.valid) {
                return {
                    success: false,
                    xml,
                    xsdErrors: xsdValidation.errors,
                    error: 'XSD validation failed'
                }
            }
        }

        return {
            success: true,
            xml
        }
    }

    /**
     * Validate JSON against our JSON Schema
     */
    private validateAgainstJsonSchema(json: Record<string, unknown>): { valid: boolean; errors?: string[] } {
        if (!this.jsonSchema) {
            const schemaPath = this.config.jsonSchemaPath
            
            if (!schemaPath || !fs.existsSync(schemaPath)) {
                return { 
                    valid: false, 
                    errors: [`JSON Schema file not found: ${schemaPath}`] 
                }
            }

            try {
                this.jsonSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))
            } catch (error) {
                return { 
                    valid: false, 
                    errors: [`Failed to load JSON Schema: ${error}`] 
                }
            }
        }

        try {
            const validate = this.ajv.compile(this.jsonSchema!)
            const valid = validate(json)

            if (valid) {
                return { valid: true }
            }

            const errors = validate.errors?.map((err: { instancePath?: string; message?: string; params?: unknown }) => {
                return `${err.instancePath || '/'}: ${err.message}${err.params ? ` (${JSON.stringify(err.params)})` : ''}`
            }) || ['Unknown validation error']

            return { valid: false, errors }
        } catch (error) {
            return { 
                valid: false, 
                errors: [`JSON Schema validation error: ${error}`] 
            }
        }
    }

    /**
     * Validate XML against XSD using xmllint
     */
    private validateAgainstXSD(xmlContent: string): { valid: boolean; errors?: string[] } {
        const xsdPath = this.config.xsdPath
        
        if (!xsdPath || !fs.existsSync(xsdPath)) {
            return { 
                valid: false, 
                errors: [`XSD file not found: ${xsdPath}`] 
            }
        }

        // Create a temporary file for the XML content
        const tempFile = path.join('/tmp', `json2mpd-validation-${Date.now()}.xml`)
        
        try {
            fs.writeFileSync(tempFile, xmlContent)
            
            try {
                execSync(`xmllint --noout --schema "${xsdPath}" "${tempFile}" 2>&1`, {
                    encoding: 'utf-8',
                    cwd: path.dirname(xsdPath)
                })
                return { valid: true }
            } catch (error: unknown) {
                const execError = error as { stdout?: string; stderr?: string; message?: string }
                const output = execError.stdout || execError.stderr || execError.message || ''
                const errors = output
                    .split('\n')
                    .filter((line: string) => line.includes('error') || line.includes('Error'))
                    .map((line: string) => line.trim())
                
                if (errors.length === 0 && output) {
                    errors.push(output.trim())
                }
                
                return { valid: false, errors }
            }
        } finally {
            // Clean up temp file
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile)
            }
        }
    }

    /**
     * Convert JSON file to XML string
     */
    convertFile(jsonPath: string): string {
        const absolutePath = path.resolve(jsonPath)
        
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`JSON file not found: ${absolutePath}`)
        }

        const jsonContent = fs.readFileSync(absolutePath, 'utf-8')
        const json = JSON.parse(jsonContent) as Record<string, unknown>
        
        return this.convert(json)
    }

    /**
     * Convert JSON file to XML string with full validation
     */
    convertFileWithValidation(jsonPath: string): ConversionResult {
        const absolutePath = path.resolve(jsonPath)
        
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `JSON file not found: ${absolutePath}`
            }
        }

        try {
            const jsonContent = fs.readFileSync(absolutePath, 'utf-8')
            const json = JSON.parse(jsonContent) as Record<string, unknown>
            return this.convertWithValidation(json)
        } catch (error) {
            return {
                success: false,
                error: `Failed to parse JSON file: ${error}`
            }
        }
    }

    /**
     * Convert and save to file
     */
    convertToFile(json: Record<string, unknown>, outputPath: string): void {
        const xml = this.convert(json)
        const absolutePath = path.resolve(outputPath)
        
        // Ensure directory exists
        const dir = path.dirname(absolutePath)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
        
        fs.writeFileSync(absolutePath, xml, 'utf-8')
    }

    /**
     * Convert and save to file with full validation
     */
    convertToFileWithValidation(json: Record<string, unknown>, outputPath: string): ConversionResult {
        const result = this.convertWithValidation(json)
        
        if (result.success && result.xml) {
            const absolutePath = path.resolve(outputPath)
            
            // Ensure directory exists
            const dir = path.dirname(absolutePath)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            
            fs.writeFileSync(absolutePath, result.xml, 'utf-8')
        }
        
        return result
    }

    /**
     * Collect namespace declarations from the root $ns property.
     * 
     * Per the specification, $ns only appears at the root level of the JSON
     * document. This method reads the root $ns and validates the constraints:
     * - Each prefix maps to exactly one URI
     * - Each URI maps to exactly one prefix
     * - No nested $ns is present in the tree
     * 
     * Nested $ns declarations found during tree traversal trigger a warning
     * (they are ignored per the strict model).
     */
    private collectNamespaces(obj: unknown, collected: NamespaceMap = {}, isRoot: boolean = true): NamespaceMap {
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const record = obj as Record<string, unknown>
            if (record['$ns'] && typeof record['$ns'] === 'object') {
                if (isRoot) {
                    // Root $ns: collect and validate
                    const ns = record['$ns'] as Record<string, unknown>
                    const prefixToUri = new Map<string, string>()
                    
                    for (const [uri, entry] of Object.entries(ns)) {
                        const prefix = typeof entry === 'string' ? entry : (entry as { prefix: string }).prefix
                        
                        // Validate: no duplicate prefix (same prefix, different URI)
                        if (prefixToUri.has(prefix)) {
                            const existingUri = prefixToUri.get(prefix)!
                            throw new Error(
                                `Namespace prefix collision in $ns: prefix "${prefix}" ` +
                                `is used for both "${existingUri}" and "${uri}". ` +
                                `Each prefix must map to exactly one namespace URI.`
                            )
                        }
                        prefixToUri.set(prefix, uri)
                        
                        collected[uri] = entry as NamespaceEntry
                    }
                } else {
                    // Nested $ns: warn and ignore (not permitted per spec)
                    console.warn(
                        'Warning: Nested $ns declarations are not supported. ' +
                        '$ns should only appear at the root level. This nested $ns will be ignored.'
                    )
                }
            }
            // Recurse into children to detect nested $ns (for warning)
            for (const [key, value] of Object.entries(record)) {
                if (key !== '$ns') {
                    this.collectNamespaces(value, collected, false)
                }
            }
        } else if (Array.isArray(obj)) {
            for (const item of obj) {
                this.collectNamespaces(item, collected, false)
            }
        }
        return collected
    }

    /**
     * Check if a key is a namespace prefix (extension content)
     */
    private isNamespacePrefix(key: string, namespaces: NamespaceMap): boolean {
        return Object.values(namespaces).some(entry => getNsPrefix(entry) === key)
    }

    /**
     * Check if a namespace prefix represents an attribute namespace (like xlink)
     * vs an element namespace (custom extensions)
     */
    /**
     * Get the list of extension attribute names for a given prefix from the namespace map.
     */
    private getExtensionAttributes(prefix: string, namespaces: NamespaceMap): string[] {
        for (const entry of Object.values(namespaces)) {
            if (getNsPrefix(entry) === prefix) {
                return getNsAttributes(entry)
            }
        }
        return []
    }

    /**
     * Check if a namespace prefix uses default namespace redeclaration (no prefix in XML).
     * e.g., <pro xmlns="urn:microsoft:playready"> instead of <pro:element>
     */
    private isDefaultNsPrefix(prefix: string, namespaces: NamespaceMap): boolean {
        for (const entry of Object.values(namespaces)) {
            if (getNsPrefix(entry) === prefix) {
                return isNsDefaultRedeclaration(entry)
            }
        }
        return false
    }

    /**
     * Get the namespace URI for a given prefix
     */
    private getNamespaceUri(prefix: string, namespaces: NamespaceMap): string | null {
        for (const [uri, entry] of Object.entries(namespaces)) {
            if (getNsPrefix(entry) === prefix) {
                return uri
            }
        }
        return null
    }

    private isAttributeNamespace(prefix: string, namespaces: NamespaceMap): boolean {
        // Find the URI for this prefix
        for (const [uri, entry] of Object.entries(namespaces)) {
            if (getNsPrefix(entry) === prefix) {
                // xlink is an attribute namespace
                if (uri === WELL_KNOWN_NAMESPACES.XLINK) {
                    return true
                }
                // XSI is also an attribute namespace
                if (uri === WELL_KNOWN_NAMESPACES.XSI) {
                    return true
                }
            }
        }
        return false
    }

    /**
     * Build the XML structure from JSON
     * 
     * Transforms JSON to the format expected by XMLBuilder:
     * - Attributes prefixed with @_
     * - Text content in #text
     * - Extension elements prefixed with their namespace prefix
     * 
     * For standard DASH content (no prefix):
     * - Primitives are attributes, objects/arrays are elements
     * 
     * For extension content (with prefix):
     * - Keys starting with uppercase are child elements
     * - Keys starting with lowercase are attributes
     * - This follows XML naming conventions (PascalCase elements, camelCase attributes)
     */
    private buildXmlStructure(
        json: unknown,
        namespaces: NamespaceMap,
        currentPrefix: string | null,
        currentElementName: string | null
    ): unknown {
        if (json === null || json === undefined) {
            return json
        }

        // Handle arrays - recurse into each item
        if (Array.isArray(json)) {
            return json.map(item => this.buildXmlStructure(item, namespaces, currentPrefix, currentElementName))
        }

        // Handle objects
        if (typeof json === 'object') {
            const obj = json as Record<string, unknown>
            const result: Record<string, unknown> = {}

            for (const [key, value] of Object.entries(obj)) {
                // Skip $ns - these become xmlns attributes on the root
                if (key === '$ns') {
                    continue
                }

                // Handle $value -> #text (text content)
                if (key === this.config.textPropertyName) {
                    result['#text'] = this.valueToString(value)
                    continue
                }

                // Check if this key is a namespace prefix (extension content)
                if (this.isNamespacePrefix(key, namespaces)) {
                    // Process extension content under this prefix
                    const extensionContent = value as Record<string, unknown>
                    
                    // Check if this namespace uses default namespace redeclaration
                    // e.g., <pro xmlns="urn:microsoft:playready">text</pro>
                    const isDefaultNs = this.isDefaultNsPrefix(key, namespaces)
                    
                    if (isDefaultNs) {
                        // Default namespace redeclaration: emit as element with xmlns="..."
                        // The prefix IS the element name, content is inside the element
                        const nsUri = this.getNamespaceUri(key, namespaces)
                        const elementContent: Record<string, unknown> = {}
                        if (nsUri) {
                            elementContent[`@_xmlns`] = nsUri
                        }
                        
                        // Process children of the extension element
                        for (const [extKey, extValue] of Object.entries(extensionContent)) {
                            if (extKey === this.config.textPropertyName) {
                                elementContent['#text'] = this.valueToString(extValue)
                            } else if (this.isPrimitiveValue(extValue)) {
                                // Attribute or text-only child
                                const firstChar = extKey.charAt(0)
                                if (firstChar === firstChar.toLowerCase()) {
                                    elementContent[`@_${extKey}`] = this.valueToString(extValue)
                                } else {
                                    elementContent[extKey] = { '#text': this.valueToString(extValue) }
                                }
                            } else {
                                elementContent[extKey] = this.buildXmlStructure(extValue, namespaces, null, extKey)
                            }
                        }
                        
                        result[key] = elementContent
                        continue
                    }
                    
                    // Check if this is a well-known attribute namespace (like xlink)
                    const isAttributeNs = this.isAttributeNamespace(key, namespaces)
                    
                    // Get the list of extension attribute names from $ns metadata
                    const extAttrList = this.getExtensionAttributes(key, namespaces)
                    
                    for (const [extKey, extValue] of Object.entries(extensionContent)) {
                        const prefixedKey = `${key}:${extKey}`
                        
                        // Determine if this is an attribute or element:
                        // 1. Keys listed in $ns attributes are XML attributes
                        // 2. For attribute namespaces (xlink, xsi): all primitives are attributes
                        // 3. Objects/arrays are always elements
                        // 4. For non-attribute namespaces: primitives are elements by default
                        //    (unless listed in the namespace's attributes)
                        const isExtAttr = extAttrList.includes(extKey)
                        
                        if (isExtAttr || (isAttributeNs && this.isPrimitiveValue(extValue))) {
                            // XML attribute
                            result[`@_${prefixedKey}`] = this.valueToString(extValue)
                        } else if (this.isPrimitiveValue(extValue)) {
                            // Text-only extension element
                            result[prefixedKey] = { '#text': this.valueToString(extValue) }
                        } else {
                            // Complex extension element (object with children/attributes)
                            result[prefixedKey] = this.buildXmlStructure(extValue, namespaces, key, extKey)
                        }
                    }
                    continue
                }

                // Determine if this should be an attribute or element
                // In extension context, also check the $ns attributes list
                let isAttribute = this.shouldBeAttribute(key, value, currentPrefix, currentElementName)
                if (currentPrefix && !isAttribute && this.isPrimitiveValue(value)) {
                    // Check if this key is listed as an extension attribute in $ns
                    const extAttrList = this.getExtensionAttributes(currentPrefix, namespaces)
                    if (extAttrList.includes(key)) {
                        isAttribute = true
                    }
                }

                if (isAttribute) {
                    // Attributes are NOT prefixed with namespace in XML (attributes are unqualified by default)
                    // Convert arrays to space-separated strings for vector attributes
                    result[`@_${key}`] = this.valueToString(value)
                } else {
                    // Apply prefix to element name if we're in an extension context
                    const elementName = currentPrefix ? `${currentPrefix}:${key}` : key
                    
                    // For extension elements with primitive values, wrap in #text
                    if (currentPrefix && this.isPrimitiveValue(value)) {
                        result[elementName] = { '#text': this.valueToString(value) }
                    } else {
                        result[elementName] = this.buildXmlStructure(value, namespaces, currentPrefix, key)
                    }
                }
            }

            return result
        }

        // Primitives - return as-is
        return json
    }

    // Known DASH elements that have primitive string/number content but are XML elements (not attributes)
    // These are elements with simple content (text nodes) but are NOT attributes
    private static readonly KNOWN_ELEMENTS = new Set([
        // ProgramInformation children
        'Title', 'Source', 'Copyright',
        // Other text-content elements
        'BaseURL', 'Location', 'PatchLocation', 'Label', 'GroupLabel',
        'Initialization', 'RepresentationIndex', 'BitstreamSwitching',
        // EmptyAdaptationSet children (from SRD examples)
        'EmptyAdaptationSet',
    ])

    // Known extension elements that have lowercase names but are XML elements (not attributes)
    // This overrides the naming convention for specific extension elements
    private static readonly KNOWN_EXTENSION_ELEMENTS = new Set([
        // CENC elements (have lowercase names but are elements)
        'pssh',
    ])

    // Known DASH attributes that might look like elements but are attributes
    // These are attributes that have string vector values (space-separated in XML)
    private static readonly KNOWN_ATTRIBUTES = new Set([
        'profiles', 'codecs', 'contentType', 'mimeType', 'lang',
        'schemeIdUri', 'value', 'id', 'bandwidth', 'width', 'height',
        'frameRate', 'sar', 'par', 'audioSamplingRate',
        'startNumber', 'timescale', 'presentationTimeOffset', 'duration',
        'media', 'index', 'initialization', 'bitstreamSwitching',
        'indexRange', 'range', 'sourceURL', 'mediaRange', 'indexRangeExact',
        'availabilityTimeOffset', 'availabilityTimeComplete',
        'type', 'minBufferTime', 'mediaPresentationDuration',
        'minimumUpdatePeriod', 'timeShiftBufferDepth', 'suggestedPresentationDelay',
        'maxSegmentDuration', 'maxSubsegmentDuration',
        'availabilityStartTime', 'availabilityEndTime', 'publishTime',
        'segmentAlignment', 'subsegmentAlignment', 'bitstreamSwitching',
        'subsegmentStartsWithSAP', 'startWithSAP', 'maxWidth', 'maxHeight',
        'minWidth', 'minHeight', 'minBandwidth', 'maxBandwidth',
        'selectionPriority', 'group', 'contentComponent',
        'd', 't', 'r', 'n', 'k', 'presentationTime',
        'qualityRanking', 'order', 'start', 'starttime', 'actuate',
        'href', 'show', 'role', 'default_KID',
        // Representation dependencies
        'dependencyId', 'mediaStreamStructureId', 'associationId', 'associationType',
        // Event attributes
        'presentationTime', 'messageData', 'contentEncoding',
        // Segment attributes
        'eptDelta', 'pdDelta', 'availabilityTimeComplete',
    ])

    /**
     * Determine if a key/value pair should be an attribute or element
     * 
     * For standard DASH content (no prefix):
     * - Check known element/attribute sets first
     * - Use naming convention as fallback (lowercase = attribute, uppercase = element)
     * 
     * For extension content (with prefix):
     * - Keys starting with uppercase are child elements (XML element naming convention)
     * - Keys starting with lowercase are attributes (XML attribute naming convention)
     */
    private shouldBeAttribute(
        key: string,
        value: unknown,
        currentPrefix: string | null,
        parentElementName: string | null
    ): boolean {
        // In extension context, use naming convention to distinguish
        if (currentPrefix !== null) {
            // Uppercase first letter = element, lowercase = attribute
            const firstChar = key.charAt(0)
            return firstChar === firstChar.toLowerCase()
        }

        // Schema-driven attribute detection (if schema includes attribute markers)
        // Prefer this over naming conventions to avoid misclassifying DASH elements
        // with primitive content (e.g. Title/BaseURL) or attributes with uppercase
        // names in non-DASH namespaces.
        const analyzer = this.getSchemaAnalyzer()
        if (analyzer && analyzer.isAttribute(key, parentElementName || undefined)) {
            return true
        }

        // Objects and arrays are always elements
        if (!this.isPrimitiveValue(value)) {
            return false
        }

        // Check known elements (these are XML elements even though they have primitive values)
        if (JsonToXmlConverter.KNOWN_ELEMENTS.has(key)) {
            return false
        }

        // Check known attributes
        if (JsonToXmlConverter.KNOWN_ATTRIBUTES.has(key)) {
            return true
        }

        // Fallback: use naming convention
        // In DASH, attributes typically start with lowercase (camelCase)
        // Elements typically start with uppercase (PascalCase)
        const firstChar = key.charAt(0)
        return firstChar === firstChar.toLowerCase()
    }

    /**
     * Check if a value is a primitive (string, number, boolean, null, undefined)
     * Also treats arrays of primitives as primitive (for vector attributes)
     */
    private isPrimitiveValue(value: unknown): boolean {
        if (value === null || value === undefined) {
            return true
        }
        const type = typeof value
        if (type === 'string' || type === 'number' || type === 'boolean') {
            return true
        }
        // Arrays of primitives are also considered primitive (vector attributes)
        if (Array.isArray(value) && value.length > 0) {
            return value.every(item => {
                const itemType = typeof item
                return itemType === 'string' || itemType === 'number' || itemType === 'boolean'
            })
        }
        return false
    }

    /**
     * Convert a value to string for attribute output
     * Handles arrays by joining with space (for vector attributes)
     */
    private valueToString(value: unknown): string {
        if (Array.isArray(value)) {
            return value.join(' ')
        }
        return String(value)
    }

    /**
     * Wrap the converted structure in an MPD root element with namespace declarations
     */
    private wrapWithMPD(structure: Record<string, unknown>, namespaces: NamespaceMap): Record<string, unknown> {
        const mpdContent: Record<string, unknown> = {}

        // Add default DASH namespace
        mpdContent['@_xmlns'] = WELL_KNOWN_NAMESPACES.DASH

        // Add namespace declarations for all collected namespaces
        for (const [uri, entry] of Object.entries(namespaces)) {
            // Skip DASH namespace (it's the default)
            if (uri === WELL_KNOWN_NAMESPACES.DASH) {
                continue
            }
            // Skip defaultNs entries - these use xmlns="..." on the element itself
            if (isNsDefaultRedeclaration(entry)) {
                continue
            }
            mpdContent[`@_xmlns:${getNsPrefix(entry)}`] = uri
        }

        // Add all content from the structure
        for (const [key, value] of Object.entries(structure)) {
            mpdContent[key] = value
        }

        return { MPD: mpdContent }
    }

    /**
     * Build the final XML string using XMLBuilder
     */
    private buildXml(structure: Record<string, unknown>): string {
        const builder = new XMLBuilder({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            format: this.config.indent,
            indentBy: this.config.indentBy,
            suppressEmptyNode: true,
            suppressBooleanAttributes: false,
        })

        let xml = builder.build(structure) as string

        if (this.config.xmlDeclaration) {
            xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml
        }

        return xml
    }
}

export default JsonToXmlConverter
