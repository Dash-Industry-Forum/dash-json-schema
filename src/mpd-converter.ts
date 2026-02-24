#!/usr/bin/env node
/**
 * MPD to JSON Converter
 * 
 * Converts DASH MPD XML files to JSON format that conforms to our JSON Schema.
 * Features:
 * - XSD validation of input MPD
 * - XML to JSON conversion matching our schema structure
 * - JSON Schema validation of output
 */

import * as fs from 'fs'
import * as path from 'path'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { execSync } from 'child_process'
import { NamespaceMap, NamespaceEntry, NamespaceScope, WELL_KNOWN_NAMESPACES, getNsPrefix } from './types'
import { SchemaAnalyzer } from './schema-analyzer'

export interface ConversionResult {
    success: boolean
    json?: Record<string, unknown>
    xsdErrors?: string[]
    jsonSchemaErrors?: string[]
    error?: string
}

export interface MPDConverterConfig {
    /** Path to the XSD schema for validation */
    xsdPath?: string
    /** Path to the JSON Schema for validation */
    jsonSchemaPath?: string
    /** Skip XSD validation */
    skipXsdValidation?: boolean
    /** Skip JSON Schema validation */
    skipJsonSchemaValidation?: boolean
    /** Property name for text content */
    textPropertyName?: string
}

const DEFAULT_CONFIG: MPDConverterConfig = {
    xsdPath: path.join(__dirname, '..', 'xml-schemas', 'DASH-MPD.xsd'),
    jsonSchemaPath: path.join(__dirname, '..', 'output', 'dash-mpd.schema.json'),
    skipXsdValidation: false,
    skipJsonSchemaValidation: false,
    textPropertyName: '$value',
}

/**
 * MPD to JSON Converter class
 */
export class MPDConverter {
    private config: MPDConverterConfig
    private ajv: Ajv2020
    private jsonSchema: Record<string, unknown> | null = null
    private schemaAnalyzer: SchemaAnalyzer | null = null
    /** Accumulates extension attribute names per prefix during a conversion run.
     *  Key: namespace prefix, Value: Set of attribute local names.
     *  Reset at the start of each transformMPD call. */
    private collectedExtAttrs: Record<string, Set<string>> = {}
    /** Accumulates all namespace URI→prefix mappings discovered during a conversion run.
     *  This includes inline namespace declarations on child elements (not just the root).
     *  Reset at the start of each transformMPD call. */
    private collectedNamespaces: NamespaceMap = {}

    constructor(config: Partial<MPDConverterConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
        this.ajv = new Ajv2020({ 
            allErrors: true, 
            strict: false,
            validateFormats: true,
        })
        addFormats(this.ajv)
        
        // Register custom 'iso-duration' format for ISO 8601 durations with fractional seconds support
        // The standard 'duration' format from ajv-formats follows RFC 3339 which doesn't allow fractional seconds
        // ISO 8601 (used in XSD xs:duration) does allow fractional seconds like PT1.5S
        this.ajv.addFormat('iso-duration', {
            type: 'string',
            validate: (str: string) => {
                // ISO 8601 duration pattern with optional fractional seconds
                // Format: P[n]Y[n]M[n]DT[n]H[n]M[n]S or P[n]W
                // Each component is optional but at least one must be present
                // Fractional values are allowed on the smallest component
                const pattern = /^-?P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$|^-?P(\d+)W$/
                return pattern.test(str)
            }
        })

        // Register XSD lexical-space formats for dateTime/time.
        // XSD permits optional timezone, unlike RFC 3339 (used by ajv-formats built-ins).
        this.ajv.addFormat('iso-date-time', {
            type: 'string',
            validate: (str: string) => {
                // XSD dateTime lexical space (simplified):
                // YYYY-MM-DDThh:mm:ss(.sss)?(Z|+hh:mm|-hh:mm)?
                const pattern = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
                return pattern.test(str)
            },
        })
        this.ajv.addFormat('iso-time', {
            type: 'string',
            validate: (str: string) => {
                // XSD time lexical space (simplified):
                // hh:mm:ss(.sss)?(Z|+hh:mm|-hh:mm)?
                const pattern = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/
                return pattern.test(str)
            },
        })
    }

    /**
     * Get the schema analyzer (lazy initialization)
     */
    private getSchemaAnalyzer(): SchemaAnalyzer {
        if (!this.schemaAnalyzer && this.config.jsonSchemaPath) {
            this.schemaAnalyzer = new SchemaAnalyzer(this.config.jsonSchemaPath)
        }
        if (!this.schemaAnalyzer) {
            // Fallback to default path
            this.schemaAnalyzer = new SchemaAnalyzer(DEFAULT_CONFIG.jsonSchemaPath!)
        }
        return this.schemaAnalyzer
    }

    /**
     * Convert an MPD file to JSON
     */
    convertFile(mpdPath: string): ConversionResult {
        const absolutePath = path.resolve(mpdPath)
        
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `MPD file not found: ${absolutePath}`
            }
        }

        const xmlContent = fs.readFileSync(absolutePath, 'utf-8')
        return this.convert(xmlContent)
    }

    /**
     * Convert MPD XML string to JSON
     */
    convert(xmlContent: string): ConversionResult {
        // Step 1: Basic XML validation
        const xmlValidation = XMLValidator.validate(xmlContent)
        if (xmlValidation !== true) {
            return {
                success: false,
                error: `Invalid XML: ${JSON.stringify(xmlValidation)}`
            }
        }

        // Step 2: XSD validation (if not skipped)
        if (!this.config.skipXsdValidation) {
            const xsdValidation = this.validateAgainstXSD(xmlContent)
            if (!xsdValidation.valid) {
                return {
                    success: false,
                    xsdErrors: xsdValidation.errors,
                    error: 'XSD validation failed'
                }
            }
        }

        // Step 3: Convert XML to JSON
        let json: Record<string, unknown> | null
        try {
            json = this.xmlToJson(xmlContent)
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to convert XML to JSON'
            }
        }
        if (!json) {
            return {
                success: false,
                error: 'Failed to convert XML to JSON'
            }
        }

        // Step 4: JSON Schema validation (if not skipped)
        if (!this.config.skipJsonSchemaValidation) {
            const jsonSchemaValidation = this.validateAgainstJsonSchema(json)
            if (!jsonSchemaValidation.valid) {
                return {
                    success: false,
                    json,
                    jsonSchemaErrors: jsonSchemaValidation.errors,
                    error: 'JSON Schema validation failed'
                }
            }
        }

        return {
            success: true,
            json
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
        const tempFile = path.join('/tmp', `mpd-validation-${Date.now()}.xml`)
        
        try {
            fs.writeFileSync(tempFile, xmlContent)
            
            // Use xmllint for XSD validation (cross-platform alternative to libxmljs)
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

    // Fallback array elements (used when schema is not available)
    // This list is kept for backwards compatibility but schema analyzer is preferred
    private static readonly FALLBACK_ARRAY_ELEMENTS = new Set([
        'ProgramInformation', 'BaseURL', 'Location', 'PatchLocation',
        'RequestParam', 'ServiceDescription', 'InitializationSet',
        'InitializationGroup', 'InitializationPresentation', 'ContentProtection',
        'Period', 'Metrics', 'EssentialProperty', 'SupplementalProperty',
        'UTCTiming', 'AdaptationSet', 'Representation', 'SubRepresentation',
        'SegmentURL', 'S', 'Event', 'EventStream', 'Subset', 'Label',
        'Accessibility', 'Role', 'Rating', 'Viewpoint', 'FramePacking',
        'AudioChannelConfiguration', 'ProducerReferenceTime', 'Resync',
        'InbandEventStream', 'Switching', 'RandomAccess', 'GroupLabel',
        'Preselection', 'Range', 'Reporting', 'EmptyAdaptationSet',
        'ContentComponent', 'OperatingQuality', 'OperatingBandwidth',
        'Latency', 'PlaybackRate', 'Scope', 'DefaultKID',
        'Element', 'Url', 'FCS', 'ContentSteering', 'OperatingQuality',
        'OperatingBandwidth', 'ClientDataReporting', 'PlaybackRestrictions',
    ])

    /**
     * Check if an element should be an array (schema-driven)
     * @param name Element name
     * @param parentElement Optional parent element name for context-aware decisions
     */
    private isArrayElement(name: string, parentElement?: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        if (analyzer.isArrayElement(name, parentElement)) {
            return true
        }
        // Check if schema says it's explicitly NOT an array in this context
        if (parentElement && !analyzer.isArrayElement(name, parentElement)) {
            // Schema has explicit info - don't use fallback
            const typeInfo = analyzer.getAttributeType(name, parentElement)
            if (typeInfo) {
                return typeInfo.jsonType === 'array'
            }
        }
        // Fallback to static set
        return MPDConverter.FALLBACK_ARRAY_ELEMENTS.has(name)
    }

    // Fallback simple content elements (used when schema is not available)
    // These are elements with simpleContent (text + optional attributes)
    private static readonly FALLBACK_SIMPLE_CONTENT_ELEMENTS = new Set([
        'BaseURL', 'Location', 'PatchLocation', 'Label', 'GroupLabel',
        'Initialization', 'RepresentationIndex', 'BitstreamSwitching',
        'ImportedMPD', 'SegmentURL',
    ])

    /**
     * Check if an element has simple content (schema-driven)
     */
    private hasSimpleContentElement(name: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        if (analyzer.hasSimpleContent(name)) {
            return true
        }
        // Fallback to static set
        return MPDConverter.FALLBACK_SIMPLE_CONTENT_ELEMENTS.has(name)
    }

    /**
     * Check if an element is a complex type (object with properties, not simple content)
     * This is used to determine if an empty element should become an empty object vs empty string
     */
    private isComplexElementType(name: string): boolean {
        // If it has simple content, it's not purely complex
        if (this.hasSimpleContentElement(name)) {
            return false
        }
        // Most DASH elements are complex types - check for known simple types
        const simpleTypes = new Set(['Title', 'Source', 'Copyright'])
        return !simpleTypes.has(name)
    }

    // Fallback attributes that should always be strings (not parsed as numbers)
    // Note: 'id' is NOT included here because it has context-dependent typing
    private static readonly FALLBACK_STRING_ATTRIBUTES = new Set([
        'frameRate', 'minFrameRate', 'maxFrameRate', 'profiles', 'codecs', 'mimeType',
        'contentType', 'lang', 'schemeIdUri', 'value', 'messageData',
        'range', 'indexRange', 'byteRange', 'sourceURL', 'media', 'index',
        'initialization', 'bitstreamSwitching', 'sar', 'par',
    ])

    // Fallback attributes that should be arrays of unsigned integers (UIntVectorType)
    // These are space-separated lists in XML that become arrays in JSON
    private static readonly FALLBACK_UINT_VECTOR_ATTRIBUTES = new Set([
        'audioSamplingRate',
    ])

    // Fallback integer attributes (common in DASH)
    private static readonly FALLBACK_INTEGER_ATTRIBUTES = new Set([
        'bandwidth', 'width', 'height', 'startNumber', 'timescale',
        'presentationTimeOffset', 'startWithSAP',
        'qualityRanking', 'group', 'maxPlayoutRate', 'order',
        'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
        'minBandwidth', 'maxBandwidth',
        'selectionPriority', 'numChannels', 'sampleRate',
        'subsegmentStartsWithSAP', 'segmentAlignment', 'subsegmentAlignment',
        'bitStreamSwitching', 'd', 't', 'r', 'n', 'k', 'duration',
        'endNumber', 'endSubNumber', 'presentationTime',
    ])

    // Fallback number attributes (floats)
    private static readonly FALLBACK_NUMBER_ATTRIBUTES = new Set([
        'availabilityTimeOffset', 'ttl', 'earliestResolutionTimeOffset',
        'eptDelta', 'pdDelta', 'target', 'max', 'min',
        'referenceId', 'inband', 'maxDifference',
    ])

    /**
     * Extract namespace declarations from an element (xmlns:prefix="uri" attributes).
     * Validates that no URI aliasing occurs (same URI, different prefixes).
     */
    private extractNamespaceDeclarations(obj: Record<string, unknown>): NamespaceMap {
        const namespaces: NamespaceMap = {}
        // Track prefix -> URI for detecting URI aliasing (same URI, different prefixes)
        const prefixToUri = new Map<string, string>()
        
        for (const [key, value] of Object.entries(obj)) {
            let prefix: string | null = null
            let uri: string | null = null
            
            // Handle both @_xmlns:prefix (from XML parser with attribute prefix)
            // and xmlns:prefix (legacy format)
            if (key.startsWith('@_xmlns:') && typeof value === 'string') {
                prefix = key.substring(8) // Remove '@_xmlns:'
                uri = value
            } else if (key.startsWith('xmlns:') && typeof value === 'string') {
                prefix = key.substring(6) // Remove 'xmlns:'
                uri = value
            }
            
            if (prefix && uri) {
                // Check for URI aliasing: is this URI already mapped to a different prefix?
                const existingEntry = namespaces[uri]
                if (existingEntry) {
                    const existingPrefix = getNsPrefix(existingEntry)
                    if (existingPrefix !== prefix) {
                        throw new Error(
                            `Namespace URI aliasing is not supported: URI "${uri}" ` +
                            `is declared with prefix "${existingPrefix}" and also with prefix "${prefix}". ` +
                            `Each namespace URI must map to exactly one prefix. ` +
                            `Refactor the XML to use a single prefix per namespace URI.`
                        )
                    }
                }
                
                // Check for prefix rebinding within the same element: same prefix, different URI
                if (prefixToUri.has(prefix)) {
                    const existingUri = prefixToUri.get(prefix)!
                    if (existingUri !== uri) {
                        throw new Error(
                            `Namespace prefix rebinding is not supported: prefix "${prefix}" ` +
                            `is bound to "${existingUri}" and also to "${uri}" on the same element. ` +
                            `Each prefix must map to exactly one namespace URI.`
                        )
                    }
                }
                
                prefixToUri.set(prefix, uri)
                namespaces[uri] = prefix // URI -> prefix
            }
        }
        return namespaces
    }

    /**
     * Create a new namespace scope with optional parent scope for inheritance.
     * Validates namespace constraints: no prefix rebinding, no URI aliasing.
     * Throws an error if constraints are violated.
     */
    private createNamespaceScope(declarations: NamespaceMap, parent?: NamespaceScope): NamespaceScope {
        if (parent) {
            // Validate: no prefix rebinding (same prefix, different URI)
            for (const [newUri, newEntry] of Object.entries(declarations)) {
                const newPrefix = getNsPrefix(newEntry)
                for (const [existingUri, existingEntry] of Object.entries(parent.resolved)) {
                    const existingPrefix = getNsPrefix(existingEntry)
                    
                    // Same prefix, different URI = prefix rebinding (rejected)
                    if (newPrefix === existingPrefix && newUri !== existingUri) {
                        throw new Error(
                            `Namespace prefix rebinding is not supported: prefix "${newPrefix}" ` +
                            `is bound to "${existingUri}" but is being rebound to "${newUri}". ` +
                            `Each prefix must map to exactly one namespace URI. ` +
                            `Refactor the XML to use unique prefixes on the root element.`
                        )
                    }
                    
                    // Same URI, different prefix = URI aliasing (rejected)
                    if (newUri === existingUri && newPrefix !== existingPrefix) {
                        throw new Error(
                            `Namespace URI aliasing is not supported: URI "${newUri}" ` +
                            `is already declared with prefix "${existingPrefix}" but is being redeclared ` +
                            `with prefix "${newPrefix}". Each namespace URI must map to exactly one prefix. ` +
                            `Refactor the XML to use a single prefix per namespace URI.`
                        )
                    }
                }
            }
        }
        const resolved = parent ? { ...parent.resolved, ...declarations } : { ...declarations }
        return { declarations, resolved, parent }
    }

    /**
     * Check if a prefix maps to the DASH namespace (and thus is a standard element)
     */
    private isDashElement(prefix: string | null, scope: NamespaceScope): boolean {
        if (!prefix) return true // Unprefixed elements are DASH
        // Check if prefix maps to DASH namespace
        for (const [uri, entry] of Object.entries(scope.resolved)) {
            if (getNsPrefix(entry) === prefix && uri === WELL_KNOWN_NAMESPACES.DASH) {
                return true
            }
        }
        return false
    }

    /**
     * Parse a qualified name (QName) into prefix and local name
     */
    private parseQName(name: string): { prefix: string | null; localName: string } {
        const colonIndex = name.indexOf(':')
        if (colonIndex === -1) {
            return { prefix: null, localName: name }
        }
        return {
            prefix: name.substring(0, colonIndex),
            localName: name.substring(colonIndex + 1)
        }
    }

    /**
     * Convert XML to JSON matching our schema structure
     */
    private xmlToJson(xmlContent: string): Record<string, unknown> | null {
        const textNodeName = this.config.textPropertyName || '$value'
        
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: textNodeName,
            parseAttributeValue: false, // Keep all values as strings initially
            parseTagValue: false,       // Keep all values as strings initially
            trimValues: true,
            isArray: (name, jPath, isLeafNode, isAttribute) => {
                // Attributes are never arrays in XML - they are space-separated strings
                // that get converted to arrays later via coerceType
                if (isAttribute) {
                    return false
                }
                // Extract parent element from jPath (e.g., "MPD.Period.AdaptationSet.ProducerReferenceTime.UTCTiming")
                const parts = jPath.split('.')
                const parentElement = parts.length > 1 ? parts[parts.length - 2] : undefined
                return this.isArrayElement(name, parentElement)
            },
            transformTagName: (tagName) => tagName,
            transformAttributeName: (attrName) => attrName,
        })

        try {
            const result = parser.parse(xmlContent)
            
            // Extract the MPD element and transform it
            if (result.MPD) {
                return this.transformMPD(result.MPD, textNodeName)
            }
            
            return null
        } catch (error) {
            console.error('XML parsing error:', error)
            // Re-throw namespace constraint violations so the caller gets a descriptive error
            if (error instanceof Error && (
                error.message.includes('prefix rebinding') ||
                error.message.includes('URI aliasing') ||
                error.message.includes('namespace redeclaration conflict') ||
                error.message.includes('Namespace')
            )) {
                throw error
            }
            return null
        }
    }

    // Fallback: Elements where 'id' attribute should be an integer
    // This is now handled by schema analyzer but kept as documentation
    private static readonly FALLBACK_INTEGER_ID_ELEMENTS = new Set([
        'AdaptationSet', 'SubRepresentation', 'ContentComponent',
        'Subset', 'Preselection', 'Event', 'ServiceDescription',
        'InitializationSet', 'ProducerReferenceTime', 'Latency',
    ])

    /**
     * Transform the parsed MPD to match our JSON Schema structure
     */
    private transformMPD(mpd: Record<string, unknown>, textNodeName: string): Record<string, unknown> {
        // Reset the extension attributes accumulator for this conversion
        this.collectedExtAttrs = {}
        this.collectedNamespaces = {}
        
        // Extract namespace declarations from the root MPD element
        const nsDeclarations = this.extractNamespaceDeclarations(mpd)
        
        // Seed collectedNamespaces with root declarations
        for (const [uri, entry] of Object.entries(nsDeclarations)) {
            this.collectedNamespaces[uri] = entry
        }
        
        // Create the root namespace scope
        const rootScope = this.createNamespaceScope(nsDeclarations)
        
        // Transform the MPD element - this will add $ns if needed
        // During the transform, collectedExtAttrs and collectedNamespaces will be populated
        const transformed = this.transformElement(mpd, 'MPD', textNodeName, rootScope) as Record<string, unknown>
        
        // Post-process: ensure all collected namespaces are in the root $ns
        // This captures namespaces declared inline on child elements
        const rootNs = (transformed.$ns as NamespaceMap) || {}
        let nsChanged = false
        for (const [uri, entry] of Object.entries(this.collectedNamespaces)) {
            if (uri !== WELL_KNOWN_NAMESPACES.DASH && uri !== WELL_KNOWN_NAMESPACES.XSI) {
                if (!rootNs[uri]) {
                    // Preserve the full entry (including defaultNs flag if present)
                    rootNs[uri] = entry
                    nsChanged = true
                }
            }
        }
        if (nsChanged || Object.keys(rootNs).length > 0) {
            transformed.$ns = rootNs
        }
        
        // Post-process: merge collected extension attributes into the root $ns
        if (transformed.$ns && Object.keys(this.collectedExtAttrs).length > 0) {
            const nsMap = transformed.$ns as NamespaceMap
            for (const [uri, entry] of Object.entries(nsMap)) {
                const prefix = getNsPrefix(entry)
                const attrs = this.collectedExtAttrs[prefix]
                if (attrs && attrs.size > 0) {
                    // Upgrade to extended form, preserving existing metadata (like defaultNs)
                    const existing = typeof entry === 'object' ? entry : {}
                    nsMap[uri] = { ...existing, prefix, attributes: [...attrs].sort() }
                }
            }
        }
        
        return transformed
    }

    /**
     * Recursively transform elements to match schema structure
     * @param element - The element to transform
     * @param currentElementName - The name of the current element being processed (for context-aware type coercion)
     * @param textNodeName - The property name for text content
     * @param namespaceScope - Current namespace scope for handling extension elements
     * @param insideExtension - Whether we're processing children of an extension element
     */
    private transformElement(
        element: unknown, 
        currentElementName: string, 
        textNodeName: string,
        namespaceScope?: NamespaceScope,
        insideExtension?: boolean
    ): unknown {
        if (element === null || element === undefined) {
            return element
        }

        if (Array.isArray(element)) {
            return element.map(item => {
                // Handle empty strings in arrays - convert to empty objects for complex element types
                // This handles cases like empty <ProgramInformation></ProgramInformation>
                if (item === '' && this.isComplexElementType(currentElementName)) {
                    return {}
                }
                return this.transformElement(item, currentElementName, textNodeName, namespaceScope, insideExtension)
            })
        }

        if (typeof element === 'object') {
            const obj = element as Record<string, unknown>
            
            // Extract namespace declarations from this element
            const newDeclarations = this.extractNamespaceDeclarations(obj)
            
            // Create new scope if there are declarations, otherwise use parent scope
            let currentScope = namespaceScope
            if (Object.keys(newDeclarations).length > 0 && namespaceScope) {
                // createNamespaceScope validates prefix rebinding and URI aliasing
                currentScope = this.createNamespaceScope(newDeclarations, namespaceScope)
                // Propagate all namespace declarations to collectedNamespaces
                // so they end up in the root $ns even if declared inline on child elements
                for (const [uri, entry] of Object.entries(newDeclarations)) {
                    if (!this.collectedNamespaces[uri]) {
                        this.collectedNamespaces[uri] = entry
                    }
                }
            } else if (!currentScope) {
                // Create empty scope if none exists
                currentScope = this.createNamespaceScope({})
            }
            
            // Separate DASH attributes, DASH child elements, and extension content
            const attributes: Array<[string, unknown]> = []
            const childElements: Array<[string, unknown]> = []
            const extensionContent: Record<string, Record<string, unknown>> = {}

            for (const [rawKey, value] of Object.entries(obj)) {
                // Strip the @_ attribute prefix added by fast-xml-parser
                const isXmlAttribute = rawKey.startsWith('@_')
                const key = isXmlAttribute ? rawKey.substring(2) : rawKey
                
                // Skip XML declaration attributes, xmlns declarations, and xsi: attributes
                if (key === '?xml' || key.startsWith('xmlns') || key.startsWith('xsi:')) {
                    continue
                }

                const { prefix, localName } = this.parseQName(key)
                
                // Check if this is an extension (non-DASH) element or attribute
                let isExtension = prefix !== null && !this.isDashElement(prefix, currentScope)
                
                // Check if this is a child element (object or array) vs an attribute (primitive)
                // With @_ prefix, we can now reliably distinguish:
                // - Keys with @_ prefix were XML attributes (always primitives)
                // - Keys without @_ prefix that are objects/arrays are child elements
                // - Keys without @_ prefix that are primitives are text-only child elements
                const isChildElement = !isXmlAttribute && typeof value === 'object' && value !== null
                
                // Handle unprefixed elements with default namespace redeclaration
                // e.g., <pro xmlns="urn:microsoft:playready">text</pro>
                // These are extension elements even though they have no prefix
                let syntheticPrefix: string | null = null
                if (!isExtension && !isXmlAttribute && prefix === null && isChildElement && value !== null) {
                    const childObj = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null
                    if (childObj && typeof childObj === 'object') {
                        const defaultNs = childObj['@_xmlns'] as string | undefined
                        if (defaultNs && defaultNs !== WELL_KNOWN_NAMESPACES.DASH) {
                            // Validate: check if this URI is already registered with a different prefix
                            const existingEntry = this.collectedNamespaces[defaultNs]
                            if (existingEntry) {
                                const existingPrefix = getNsPrefix(existingEntry)
                                if (existingPrefix !== localName) {
                                    throw new Error(
                                        `Namespace URI aliasing is not supported: URI "${defaultNs}" ` +
                                        `is already declared with prefix "${existingPrefix}" but element ` +
                                        `"${localName}" uses a default namespace redeclaration for the same URI. ` +
                                        `Each namespace URI must map to exactly one prefix.`
                                    )
                                }
                            }
                            // Validate: check if the synthetic prefix collides with another namespace's prefix
                            for (const [existingUri, existingEntry] of Object.entries(this.collectedNamespaces)) {
                                if (existingUri !== defaultNs && getNsPrefix(existingEntry) === localName) {
                                    throw new Error(
                                        `Default namespace redeclaration conflict: element name "${localName}" ` +
                                        `would be used as a synthetic prefix for URI "${defaultNs}", ` +
                                        `but "${localName}" is already used as a prefix for URI "${existingUri}". ` +
                                        `Refactor the XML to use explicit namespace prefixes.`
                                    )
                                }
                            }
                            // This unprefixed element redefines its default namespace to a non-DASH namespace
                            // Treat it as an extension element with the element name as its own "prefix"
                            isExtension = true
                            syntheticPrefix = localName
                            // Register this namespace so it gets into the root $ns
                            // Mark as defaultNs so JSON→XML knows to emit xmlns="..." instead of xmlns:prefix="..."
                            this.collectedNamespaces[defaultNs] = { prefix: localName, defaultNs: true }
                        }
                    }
                }

                if (isExtension && (prefix || syntheticPrefix)) {
                    const effectivePrefix = prefix || syntheticPrefix!
                    // Handle extension elements/attributes - group under prefix key
                    if (!extensionContent[effectivePrefix]) {
                        extensionContent[effectivePrefix] = {}
                    }
                    
                    if (isXmlAttribute) {
                        // Extension attribute (had @_ prefix) - store as plain value
                        // and accumulate into collectedExtAttrs so $ns can record it
                        extensionContent[effectivePrefix][localName] = value
                        if (!this.collectedExtAttrs[effectivePrefix]) {
                            this.collectedExtAttrs[effectivePrefix] = new Set()
                        }
                        this.collectedExtAttrs[effectivePrefix].add(localName)
                    } else if (isChildElement) {
                        // Extension element with child elements - transform recursively
                        // For synthetic prefix (default namespace redecl), the element itself IS the extension
                        // so we transform its children, not wrap it under another level
                        if (syntheticPrefix) {
                            // The element name IS the prefix; transform its content as extension children
                            const transformedExtValue = this.transformExtensionElement(value, localName, textNodeName, currentScope, syntheticPrefix)
                            // For synthetic prefix, the extension content IS the transformed value
                            // Merge the transformed object into the extension content
                            if (typeof transformedExtValue === 'object' && transformedExtValue !== null && !Array.isArray(transformedExtValue)) {
                                Object.assign(extensionContent[effectivePrefix], transformedExtValue)
                            } else {
                                extensionContent[effectivePrefix]['$value'] = transformedExtValue
                            }
                        } else {
                            const transformedExtValue = this.transformExtensionElement(value, localName, textNodeName, currentScope, effectivePrefix)
                            extensionContent[effectivePrefix][localName] = transformedExtValue
                        }
                    } else {
                        // Extension element with text-only content - store as plain value
                        if (syntheticPrefix) {
                            // For synthetic prefix, the text IS the $value of the extension element
                            extensionContent[effectivePrefix]['$value'] = value
                        } else {
                            extensionContent[effectivePrefix][localName] = value
                        }
                    }
                } else {
                    // DASH element or attribute
                    const cleanKey = localName

                    // Transform the value - pass the key as the element name for child elements
                    let transformedValue = this.transformElement(
                        value, 
                        isChildElement ? cleanKey : currentElementName, 
                        textNodeName,
                        currentScope,
                        insideExtension
                    )
                    
                    // Wrap simple content elements that are strings into objects with $value
                    // This is required because these types CAN have attributes defined in the schema
                    if (this.hasSimpleContentElement(cleanKey)) {
                        if (Array.isArray(transformedValue)) {
                            transformedValue = transformedValue.map(item => 
                                this.wrapSimpleContent(item, textNodeName)
                            )
                        } else {
                            transformedValue = this.wrapSimpleContent(transformedValue, textNodeName)
                        }
                    }
                    
                    // Apply type coercion for attributes, with context from current element
                    // For attributes (primitives), use the current element name as context
                    const coercedValue = this.coerceType(cleanKey, transformedValue, currentElementName)

                    // Sort into attributes or child elements
                    // $value (text content) is treated as an attribute for ordering purposes
                    if (isChildElement && cleanKey !== textNodeName) {
                        childElements.push([cleanKey, coercedValue])
                    } else {
                        attributes.push([cleanKey, coercedValue])
                    }
                }
            }

            // Build the result object: attributes, then child elements, then extensions.
            // Note: $ns is only placed at the root level (in transformMPD), not on
            // individual elements. All namespace declarations are hoisted to root.
            const transformed: Record<string, unknown> = {}
            
            for (const [key, value] of attributes) {
                transformed[key] = value
            }
            
            for (const [key, value] of childElements) {
                transformed[key] = value
            }
            
            // Add extension content grouped by prefix
            for (const [prefix, content] of Object.entries(extensionContent)) {
                transformed[prefix] = content
            }

            return transformed
        }

        // For string values, apply type coercion based on attribute name
        return element
    }

    /**
     * Transform an extension element and its children.
     * Children of extension elements inherit the namespace, so we don't repeat the prefix.
     * @param inheritedPrefix - The prefix of the parent extension namespace (e.g., "ext")
     */
    private transformExtensionElement(
        element: unknown, 
        elementName: string, 
        textNodeName: string,
        namespaceScope: NamespaceScope,
        inheritedPrefix?: string
    ): unknown {
        if (element === null || element === undefined) {
            return element
        }

        if (Array.isArray(element)) {
            return element.map(item => this.transformExtensionElement(item, elementName, textNodeName, namespaceScope, inheritedPrefix))
        }

        if (typeof element === 'object') {
            const obj = element as Record<string, unknown>
            const transformed: Record<string, unknown> = {}
            
            // Extract namespace declarations from this element
            const newDeclarations = this.extractNamespaceDeclarations(obj)
            
            // Create new scope if there are declarations
            let currentScope = namespaceScope
            if (Object.keys(newDeclarations).length > 0) {
                currentScope = this.createNamespaceScope(newDeclarations, namespaceScope)
                // Propagate namespace declarations to collectedNamespaces
                // so they end up in the root $ns even if declared inline on extension elements
                for (const [uri, entry] of Object.entries(newDeclarations)) {
                    if (!this.collectedNamespaces[uri]) {
                        this.collectedNamespaces[uri] = entry
                    }
                }
            }
            
            // Track attributes from other namespaces (like xlink: inside extension elements)
            const otherNsContent: Record<string, Record<string, unknown>> = {}

            for (const [rawKey, value] of Object.entries(obj)) {
                // Strip the @_ attribute prefix added by fast-xml-parser
                const isXmlAttribute = rawKey.startsWith('@_')
                const key = isXmlAttribute ? rawKey.substring(2) : rawKey
                
                // Skip xmlns declarations
                if (key.startsWith('xmlns')) {
                    continue
                }

                const { prefix, localName } = this.parseQName(key)
                
                // Check if this is a child element (object or array) vs an attribute (primitive)
                const isChildElement = !isXmlAttribute && typeof value === 'object' && value !== null
                
                // Check if this prefix matches the inherited extension prefix
                // If so, it's part of the same extension namespace and should be treated as local
                const isSameNamespace = prefix !== null && prefix === inheritedPrefix
                
                // Check if this attribute is from a different namespace (e.g., xlink: in an extension element)
                if (isXmlAttribute && prefix !== null && !isSameNamespace) {
                    // This is a namespaced attribute from a different namespace - group it under its prefix
                    if (!otherNsContent[prefix]) {
                        otherNsContent[prefix] = {}
                    }
                    otherNsContent[prefix][localName] = value
                } else if (isChildElement) {
                    // Recursively transform child elements
                    // Pass the current prefix so child elements in the same namespace are recognized
                    const childPrefix = isSameNamespace ? inheritedPrefix : (prefix || inheritedPrefix)
                    transformed[localName] = this.transformExtensionElement(value, localName, textNodeName, currentScope, childPrefix)
                } else if (isXmlAttribute) {
                    // XML attribute (had @_ prefix) - store as plain value
                    transformed[localName] = value
                    // Track this as an extension attribute so JSON→XML knows it's an attribute
                    // (otherwise the naming convention might misidentify it as an element)
                    if (inheritedPrefix) {
                        if (!this.collectedExtAttrs[inheritedPrefix]) {
                            this.collectedExtAttrs[inheritedPrefix] = new Set()
                        }
                        this.collectedExtAttrs[inheritedPrefix].add(localName)
                    }
                } else {
                    // Text-only extension child element (no @_ prefix, primitive value)
                    // Store as plain value - within extension elements, the naming convention
                    // (lowercase=attr, uppercase=element) is used by JSON→XML to reconstruct
                    transformed[localName] = value
                }
            }
            
            // Add namespace-prefixed content (all declarations are hoisted to root $ns)
            for (const [pref, content] of Object.entries(otherNsContent)) {
                transformed[pref] = content
            }

            return transformed
        }

        return element
    }

    /**
     * Wrap simple content into an object with $value property
     * This is required for elements that CAN have attributes defined in the schema,
     * even if the actual XML instance doesn't have any attributes.
     */
    private wrapSimpleContent(value: unknown, textNodeName: string): unknown {
        if (typeof value === 'string' || typeof value === 'number') {
            return { [textNodeName]: String(value) }
        }
        // Already an object, return as-is
        return value
    }

    /**
     * Check if an attribute should be a UInt vector (schema-driven)
     */
    private isUIntVector(name: string, parentElement?: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        if (analyzer.isUIntVector(name, parentElement)) {
            return true
        }
        return MPDConverter.FALLBACK_UINT_VECTOR_ATTRIBUTES.has(name)
    }

    /**
     * Check if an attribute should be a string vector (schema-driven)
     */
    private isStringVector(name: string, parentElement?: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        const typeInfo = analyzer.getAttributeType(name, parentElement)
        return typeInfo?.isVector === true && typeInfo?.vectorItemType === 'string'
    }

    /**
     * Check if an attribute should be a string (schema-driven)
     * Schema takes precedence over fallbacks
     */
    private shouldBeString(name: string, parentElement?: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        const typeInfo = analyzer.getAttributeType(name, parentElement)
        
        // If schema has type info, use it exclusively
        if (typeInfo) {
            return typeInfo.jsonType === 'string'
        }
        
        // Fallback only when schema doesn't have info
        return MPDConverter.FALLBACK_STRING_ATTRIBUTES.has(name)
    }

    /**
     * Check if an attribute should be an integer (schema-driven)
     * Schema takes precedence over fallbacks
     */
    private shouldBeInteger(name: string, parentElement?: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        const typeInfo = analyzer.getAttributeType(name, parentElement)
        
        // If schema has type info, use it exclusively
        if (typeInfo) {
            return typeInfo.jsonType === 'integer'
        }
        
        // Fallback only when schema doesn't have info
        return MPDConverter.FALLBACK_INTEGER_ATTRIBUTES.has(name)
    }

    /**
     * Check if an attribute should be a number/float (schema-driven)
     * Schema takes precedence over fallbacks
     */
    private shouldBeNumber(name: string, parentElement?: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        const typeInfo = analyzer.getAttributeType(name, parentElement)
        
        // If schema has type info, use it exclusively
        if (typeInfo) {
            return typeInfo.jsonType === 'number'
        }
        
        // Fallback only when schema doesn't have info
        return MPDConverter.FALLBACK_NUMBER_ATTRIBUTES.has(name)
    }

    /**
     * Check if an attribute should be a boolean (schema-driven)
     */
    private shouldBeBoolean(name: string, parentElement?: string): boolean {
        const analyzer = this.getSchemaAnalyzer()
        const typeInfo = analyzer.getAttributeType(name, parentElement)
        
        if (typeInfo) {
            return typeInfo.jsonType === 'boolean'
        }
        
        return false
    }

    /**
     * Coerce types to match JSON Schema expectations (schema-driven)
     */
    private coerceType(name: string, value: unknown, parentElement?: string): unknown {
        if (value === null || value === undefined) {
            return value
        }

        // Handle UIntVector attributes (space-separated lists of integers -> arrays)
        if (this.isUIntVector(name, parentElement)) {
            if (typeof value === 'string') {
                // Split by whitespace and convert each to integer
                return value.trim().split(/\s+/).map(v => parseInt(v, 10))
            }
            // Already an array or single number
            if (Array.isArray(value)) {
                return value.map(v => typeof v === 'string' ? parseInt(v, 10) : v)
            }
            if (typeof value === 'number') {
                return [value]
            }
            return [parseInt(String(value), 10)]
        }

        // Handle StringVector attributes (space-separated lists of strings -> arrays)
        if (this.isStringVector(name, parentElement)) {
            if (typeof value === 'string') {
                // Split by whitespace
                return value.trim().split(/\s+/)
            }
            // Already an array
            if (Array.isArray(value)) {
                return value.map(v => String(v))
            }
            return [String(value)]
        }

        // Keep these as strings
        if (this.shouldBeString(name, parentElement)) {
            return String(value)
        }

        // If it's a string, apply type coercion
        if (typeof value === 'string') {
            // Check for boolean first (schema-driven)
            // DASH allows boolean values as "true"/"false" OR "0"/"1" (ConditionalUintType)
            if (this.shouldBeBoolean(name, parentElement)) {
                if (value === 'true' || value === '1') return true
                if (value === 'false' || value === '0') return false
            }
            // Also handle explicit true/false even without schema
            if (value === 'true') return true
            if (value === 'false') return false

            // Schema-driven integer check
            if (this.shouldBeInteger(name, parentElement) && /^-?\d+$/.test(value)) {
                return parseInt(value, 10)
            }

            // Schema-driven number check
            if (this.shouldBeNumber(name, parentElement) && /^-?\d+\.?\d*$/.test(value)) {
                return parseFloat(value)
            }
        }

        return value
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
     * Load and return the JSON Schema
     */
    getJsonSchema(): Record<string, unknown> | null {
        if (!this.jsonSchema && this.config.jsonSchemaPath) {
            try {
                this.jsonSchema = JSON.parse(
                    fs.readFileSync(this.config.jsonSchemaPath, 'utf-8')
                )
            } catch {
                return null
            }
        }
        return this.jsonSchema
    }
}

// Export for CLI use
export default MPDConverter
