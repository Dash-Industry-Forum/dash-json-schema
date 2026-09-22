/**
 * Type definitions for XSD to JSON Schema converter
 */

// JSON Schema 2020-12 types
export interface JSONSchema {
    $schema?: string
    $id?: string
    $ref?: string
    $defs?: Record<string, JSONSchema>
    $comment?: string

    // Type keywords
    type?: JSONSchemaType | JSONSchemaType[]
    enum?: unknown[]
    const?: unknown

    // String keywords
    minLength?: number
    maxLength?: number
    pattern?: string
    format?: string
    contentEncoding?: string
    contentMediaType?: string

    // Number keywords
    minimum?: number
    maximum?: number
    exclusiveMinimum?: number
    exclusiveMaximum?: number
    multipleOf?: number

    // Array keywords
    items?: JSONSchema | JSONSchema[]
    prefixItems?: JSONSchema[]
    contains?: JSONSchema
    minItems?: number
    maxItems?: number
    uniqueItems?: boolean

    // Object keywords
    properties?: Record<string, JSONSchema>
    patternProperties?: Record<string, JSONSchema>
    additionalProperties?: boolean | JSONSchema
    required?: string[]
    propertyNames?: JSONSchema
    minProperties?: number
    maxProperties?: number
    dependentRequired?: Record<string, string[]>
    dependentSchemas?: Record<string, JSONSchema>

    // Composition keywords
    allOf?: JSONSchema[]
    anyOf?: JSONSchema[]
    oneOf?: JSONSchema[]
    not?: JSONSchema
    if?: JSONSchema
    then?: JSONSchema
    else?: JSONSchema

    // Metadata keywords
    title?: string
    description?: string
    default?: unknown
    deprecated?: boolean
    readOnly?: boolean
    writeOnly?: boolean
    examples?: unknown[]

    // XML-specific extension (for documentation purposes)
    'x-xml-attribute'?: boolean
    'x-xml-namespace'?: string
    'x-xml-element-name'?: string
    /** Marks that this type supports xs:any extension elements */
    'x-xml-any'?: boolean
    /** Marks that this type supports xs:anyAttribute extension attributes */
    'x-xml-any-attribute'?: boolean
}

export type JSONSchemaType =
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'array'
    | 'object'
    | 'null'

// XSD parsed structure types
export interface XSDSchema {
    targetNamespace?: string
    elementFormDefault?: string
    attributeFormDefault?: string
    imports: XSDImport[]
    includes: XSDInclude[]
    elements: Map<string, XSDElement>
    complexTypes: Map<string, XSDComplexType>
    simpleTypes: Map<string, XSDSimpleType>
    attributeGroups: Map<string, XSDAttributeGroup>
    groups: Map<string, XSDGroup>
    attributes: Map<string, XSDAttribute>
}

export interface XSDImport {
    namespace: string
    schemaLocation?: string
}

export interface XSDInclude {
    schemaLocation: string
}

export interface XSDElement {
    name: string
    type?: string
    ref?: string
    minOccurs?: number
    maxOccurs?: number | 'unbounded'
    default?: string
    fixed?: string
    nillable?: boolean
    abstract?: boolean
    substitutionGroup?: string
    complexType?: XSDComplexType
    simpleType?: XSDSimpleType
    annotation?: XSDAnnotation
}

export interface XSDComplexType {
    name?: string
    mixed?: boolean
    abstract?: boolean
    sequence?: XSDSequence
    choice?: XSDChoice
    all?: XSDAll
    simpleContent?: XSDSimpleContent
    complexContent?: XSDComplexContent
    attributes: XSDAttribute[]
    attributeGroups: string[]
    anyAttribute?: XSDAnyAttribute
    annotation?: XSDAnnotation
    group?: XSDGroupRef
}

export interface XSDSimpleType {
    name?: string
    restriction?: XSDRestriction
    list?: XSDList
    union?: XSDUnion
    annotation?: XSDAnnotation
}

export interface XSDRestriction {
    base: string
    enumeration?: string[]
    pattern?: string[]
    minLength?: number
    maxLength?: number
    minInclusive?: number | string
    maxInclusive?: number | string
    minExclusive?: number | string
    maxExclusive?: number | string
    totalDigits?: number
    fractionDigits?: number
    whiteSpace?: 'preserve' | 'replace' | 'collapse'
    length?: number
}

export interface XSDList {
    itemType: string
}

export interface XSDUnion {
    memberTypes: string[]
}

export interface XSDSequence {
    elements: XSDElement[]
    choices: XSDChoice[]
    groups: XSDGroupRef[]
    sequences: XSDSequence[]
    any?: XSDAny[]
    minOccurs?: number
    maxOccurs?: number | 'unbounded'
}

export interface XSDChoice {
    elements: XSDElement[]
    sequences: XSDSequence[]
    groups: XSDGroupRef[]
    choices: XSDChoice[]
    any?: XSDAny[]
    minOccurs?: number
    maxOccurs?: number | 'unbounded'
}

export interface XSDAll {
    elements: XSDElement[]
    minOccurs?: number
    maxOccurs?: number | 'unbounded'
}

export interface XSDSimpleContent {
    extension?: XSDExtension
    restriction?: XSDRestriction & { attributes?: XSDAttribute[] }
}

export interface XSDComplexContent {
    extension?: XSDExtension
    restriction?: XSDComplexRestriction
    mixed?: boolean
}

export interface XSDExtension {
    base: string
    sequence?: XSDSequence
    choice?: XSDChoice
    all?: XSDAll
    attributes: XSDAttribute[]
    attributeGroups: string[]
    anyAttribute?: XSDAnyAttribute
    group?: XSDGroupRef
}

export interface XSDComplexRestriction {
    base: string
    sequence?: XSDSequence
    choice?: XSDChoice
    attributes: XSDAttribute[]
}

export interface XSDAttribute {
    name?: string
    ref?: string
    type?: string
    use?: 'required' | 'optional' | 'prohibited'
    default?: string
    fixed?: string
    simpleType?: XSDSimpleType
    annotation?: XSDAnnotation
}

export interface XSDAttributeGroup {
    name: string
    attributes: XSDAttribute[]
    attributeGroups: string[]
    anyAttribute?: XSDAnyAttribute
}

export interface XSDGroup {
    name: string
    sequence?: XSDSequence
    choice?: XSDChoice
    all?: XSDAll
    annotation?: XSDAnnotation
}

export interface XSDGroupRef {
    ref: string
    minOccurs?: number
    maxOccurs?: number | 'unbounded'
}

export interface XSDAny {
    namespace?: string
    processContents?: 'strict' | 'lax' | 'skip'
    minOccurs?: number
    maxOccurs?: number | 'unbounded'
}

export interface XSDAnyAttribute {
    namespace?: string
    processContents?: 'strict' | 'lax' | 'skip'
}

export interface XSDAnnotation {
    documentation?: string[]
    appinfo?: string[]
}

// Converter configuration
export interface ConverterConfig {
    /** Mark attributes with x-xml-attribute extension */
    markAttributes?: boolean
    /** Prefix for XML attributes in JSON (e.g., '@' or '') */
    attributePrefix?: string
    /** Include XML namespace information */
    includeNamespaces?: boolean
    /** Base URI for $id */
    baseUri?: string
    /** Handle xs:any elements */
    allowAdditionalProperties?: boolean
    /** Property name for text content in mixed content types */
    textPropertyName?: string
}

export const DEFAULT_CONFIG: ConverterConfig = {
    markAttributes: false,
    attributePrefix: '',
    includeNamespaces: false,
    baseUri: '',
    allowAdditionalProperties: true,
    textPropertyName: '$value',
}

// ============================================================================
// Namespace handling types for XML extension support
// ============================================================================

/**
 * Describes a namespace entry in the $ns map.
 * Can be a simple string (just the prefix) or an object with additional metadata.
 * 
 * When the namespace defines extension attributes (rare), the object form is used
 * with an `attributes` array listing the attribute local names. This allows the
 * JSON→XML converter to distinguish extension attributes from extension elements.
 * 
 * When `defaultNs` is true, the namespace was originally declared as a default
 * namespace redeclaration (e.g., `<pro xmlns="urn:microsoft:playready">`) rather
 * than using a prefix. The JSON→XML converter uses this to emit the correct XML.
 * 
 * @example
 * // Simple form (most common): just a prefix
 * "ext"
 * 
 * // Extended form: prefix with attribute list
 * { "prefix": "cenc", "attributes": ["default_KID"] }
 * 
 * // Default namespace redeclaration (no prefix in XML)
 * { "prefix": "pro", "defaultNs": true }
 */
export type NamespaceEntry = string | { prefix: string; attributes?: string[]; defaultNs?: boolean }

/**
 * Maps namespace URIs to their prefix declarations.
 * Used in the $ns property of JSON objects to declare namespaces.
 * 
 * Values can be a simple string (prefix only) or an object with prefix and
 * an optional list of attribute names defined in that namespace.
 * 
 * @example
 * {
 *   "urn:example:dash:extension:2026": "ext",
 *   "urn:mpeg:cenc:2013": { "prefix": "cenc", "attributes": ["default_KID"] }
 * }
 */
export type NamespaceMap = Record<string, NamespaceEntry>

/**
 * Get the prefix string from a NamespaceEntry (handles both string and object forms).
 */
export function getNsPrefix(entry: NamespaceEntry): string {
    return typeof entry === 'string' ? entry : entry.prefix
}

/**
 * Get the list of extension attribute names from a NamespaceEntry.
 * Returns an empty array for simple string entries or entries without attributes.
 */
export function getNsAttributes(entry: NamespaceEntry): string[] {
    if (typeof entry === 'object' && Array.isArray(entry.attributes)) {
        return entry.attributes
    }
    return []
}

/**
 * Check if a NamespaceEntry represents a default namespace redeclaration.
 * When true, the original XML used `xmlns="..."` instead of `xmlns:prefix="..."`.
 */
export function isNsDefaultRedeclaration(entry: NamespaceEntry): boolean {
    return typeof entry === 'object' && entry.defaultNs === true
}

/**
 * Represents the namespace scope during XML-to-JSON conversion.
 * 
 * Although the JSON output uses a flat, root-only $ns registry, the converter
 * still needs to track XML namespace scope during parsing to correctly resolve
 * prefixed elements and detect constraint violations (e.g., prefix rebinding).
 * 
 * The `declarations` field holds the namespace declarations found at the current
 * XML element level. The `resolved` field holds the combined view including
 * inherited declarations from parent scopes. The converter validates that no
 * prefix rebinding or URI aliasing occurs when merging scopes.
 */
export interface NamespaceScope {
    /** Namespace declarations at this XML element level */
    declarations: NamespaceMap
    /** Combined namespaces including inherited from parent scopes */
    resolved: NamespaceMap
    /** Parent scope for inheritance chain (used during XML parsing) */
    parent?: NamespaceScope
}

/**
 * Represents an extension element or attribute content grouped by namespace prefix.
 * 
 * @example
 * {
 *   "ext": {
 *     "MetadataBlock": {
 *       "version": "1.0",
 *       "ContentId": "movie-123"
 *     }
 *   }
 * }
 */
export type ExtensionContent = Record<string, Record<string, unknown>>

/**
 * Well-known namespace URIs used in DASH MPD documents.
 */
export const WELL_KNOWN_NAMESPACES = {
    /** DASH MPD namespace */
    DASH: 'urn:mpeg:dash:schema:mpd:2011',
    /** XLink namespace */
    XLINK: 'http://www.w3.org/1999/xlink',
    /** XML Schema Instance namespace */
    XSI: 'http://www.w3.org/2001/XMLSchema-instance',
    /** Common Encryption namespace */
    CENC: 'urn:mpeg:cenc:2013',
    /** ClearKey namespace */
    CLEARKEY: 'http://dashif.org/guidelines/clearKey',
    /** DASH-IF namespace */
    DASHIF: 'https://dashif.org/',
} as const

/**
 * Default prefix mappings for well-known namespaces.
 * Used when generating XML from JSON if no prefix is specified.
 */
export const DEFAULT_NAMESPACE_PREFIXES: Record<string, string> = {
    [WELL_KNOWN_NAMESPACES.XLINK]: 'xlink',
    [WELL_KNOWN_NAMESPACES.XSI]: 'xsi',
    [WELL_KNOWN_NAMESPACES.CENC]: 'cenc',
    [WELL_KNOWN_NAMESPACES.CLEARKEY]: 'clearkey',
    [WELL_KNOWN_NAMESPACES.DASHIF]: 'dashif',
}

/**
 * JSON Schema definition for the $ns namespace declaration property.
 * This schema validates namespace declaration objects.
 * 
 * The $ns property appears only at the root level of the JSON document and
 * provides a flat, document-wide namespace registry. Each namespace URI maps
 * to exactly one prefix, and each prefix maps to exactly one URI.
 * 
 * Values can be either:
 * - A string (the namespace prefix), e.g. "ext"
 * - An object with prefix and optional attributes list, e.g.
 *   { "prefix": "cenc", "attributes": ["default_KID"] }
 */
export const NS_PROPERTY_SCHEMA: JSONSchema = {
    type: 'object',
    additionalProperties: {
        oneOf: [
            { type: 'string' },
            {
                type: 'object',
                properties: {
                    prefix: { type: 'string' },
                    attributes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of attribute local names defined in this namespace. ' +
                            'These are emitted as XML attributes (prefix:name="value") rather than child elements.',
                    },
                    defaultNs: {
                        type: 'boolean',
                        description: 'When true, the namespace was declared as a default namespace ' +
                            'redeclaration (xmlns="...") on the element itself, rather than using a prefix.',
                    },
                },
                required: ['prefix'],
                additionalProperties: false,
            },
        ],
    },
    description: 'Namespace declarations mapping namespace URIs to prefixes. ' +
        'Values are either a prefix string or an object with prefix and optional attributes list. ' +
        'Appears only at the root level of the JSON document. ' +
        'Each prefix maps to exactly one URI and each URI maps to exactly one prefix.',
}

/**
 * JSON Schema for extension content under a namespace prefix.
 * Extension elements and attributes are grouped under their prefix key.
 */
export const EXTENSION_CONTENT_SCHEMA: JSONSchema = {
    type: 'object',
    additionalProperties: true,
    description: 'Extension elements and attributes from a declared namespace. ' +
        'Primitive values represent attributes, objects/arrays represent child elements.',
}
