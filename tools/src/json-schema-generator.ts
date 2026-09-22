/**
 * JSON Schema Generator - Converts XSD types to JSON Schema 2020-12
 */

import {
    JSONSchema,
    XSDSchema,
    XSDComplexType,
    XSDSimpleType,
    XSDElement,
    XSDAttribute,
    XSDSequence,
    XSDChoice,
    XSDAll,
    XSDRestriction,
    XSDExtension,
    ConverterConfig,
    DEFAULT_CONFIG,
    XSDGroupRef,
    NS_PROPERTY_SCHEMA,
    EXTENSION_CONTENT_SCHEMA,
} from './types'
import { TypeMapper } from './type-mapper'
import { SchemaResolver, ResolvedSchema } from './schema-resolver'

export class JSONSchemaGenerator {
    private typeMapper: TypeMapper
    private schemaResolver: SchemaResolver
    private config: ConverterConfig
    private resolvedSchema: ResolvedSchema | null = null
    private definitions: Map<string, JSONSchema> = new Map()
    private processingTypes: Set<string> = new Set() // Track types being processed to avoid infinite recursion

    constructor(config: Partial<ConverterConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
        this.typeMapper = new TypeMapper()
        this.schemaResolver = new SchemaResolver()
    }

    /**
     * Generate JSON Schema from an XSD file
     */
    generateFromFile(filePath: string): JSONSchema {
        this.resolvedSchema = this.schemaResolver.resolveFile(filePath)
        return this.generate(this.resolvedSchema)
    }

    /**
     * Generate JSON Schema from a resolved schema
     */
    generate(resolved: ResolvedSchema): JSONSchema {
        this.resolvedSchema = resolved
        this.definitions.clear()
        this.processingTypes.clear()

        const schema: JSONSchema = {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: this.config.baseUri || undefined,
        }

        // First pass: generate all type definitions
        this.generateAllDefinitions(resolved)

        // Set the root element(s)
        const rootElements = Array.from(resolved.main.elements.values())
        if (rootElements.length === 1) {
            // Single root element
            const rootElement = rootElements[0]
            const rootSchema = this.generateElementSchema(rootElement)
            Object.assign(schema, rootSchema)
        } else if (rootElements.length > 1) {
            // Multiple root elements - use oneOf
            schema.oneOf = rootElements.map((elem) => {
                const elemSchema = this.generateElementSchema(elem)
                return {
                    type: 'object' as const,
                    properties: {
                        [elem.name]: elemSchema,
                    },
                    required: [elem.name],
                }
            })
        }

        // Add $ns property at root level for namespace declarations
        if (!schema.properties) schema.properties = {}
        schema.properties['$ns'] = NS_PROPERTY_SCHEMA

        // Add definitions
        if (this.definitions.size > 0) {
            schema.$defs = Object.fromEntries(this.definitions)
        }

        return schema
    }

    /**
     * Generate all type definitions
     */
    private generateAllDefinitions(resolved: ResolvedSchema): void {
        // Generate complex type definitions
        for (const [name, complexType] of resolved.allComplexTypes) {
            const defName = this.typeMapper.normalizeTypeName(name)
            if (!this.definitions.has(defName)) {
                this.definitions.set(
                    defName,
                    this.generateComplexTypeSchema(complexType, name)
                )
            }
        }

        // Generate simple type definitions
        for (const [name, simpleType] of resolved.allSimpleTypes) {
            const defName = this.typeMapper.normalizeTypeName(name)
            if (!this.definitions.has(defName)) {
                this.definitions.set(
                    defName,
                    this.generateSimpleTypeSchema(simpleType)
                )
            }
        }
    }

    /**
     * Generate schema for a complex type
     */
    private generateComplexTypeSchema(
        complexType: XSDComplexType,
        typeName?: string
    ): JSONSchema {
        // Check for circular reference
        if (typeName && this.processingTypes.has(typeName)) {
            return { $ref: `#/$defs/${this.typeMapper.normalizeTypeName(typeName)}` }
        }

        if (typeName) {
            this.processingTypes.add(typeName)
        }

        let schema: JSONSchema = { type: 'object' }
        const properties: Record<string, JSONSchema> = {}
        const required: string[] = []

        // Handle simple content (extension of simple type with attributes)
        if (complexType.simpleContent) {
            // Check if this type has anyAttribute defined
            const hasAnyAttribute = !!complexType.anyAttribute || 
                !!complexType.simpleContent.extension?.anyAttribute
            schema = this.generateSimpleContentSchema(complexType.simpleContent, hasAnyAttribute)
            // Add attributes to the schema (if schema is an object type)
            if (schema.type === 'object') {
                this.addAttributesToSchema(
                    schema,
                    complexType.attributes,
                    complexType.attributeGroups,
                    complexType.anyAttribute
                )
            }
        }
        // Handle complex content (extension/restriction of another complex type)
        else if (complexType.complexContent) {
            schema = this.generateComplexContentSchema(complexType.complexContent)
            // Add attributes
            this.addAttributesToSchema(
                schema,
                complexType.attributes,
                complexType.attributeGroups,
                complexType.anyAttribute
            )
        }
        // Handle regular complex type with sequence/choice/all
        else {
            // Add element content
            if (complexType.sequence) {
                this.addSequenceToSchema(
                    schema,
                    properties,
                    required,
                    complexType.sequence
                )
            } else if (complexType.choice) {
                // Check if the choice repeats (maxOccurs > 1 or unbounded)
                // When a choice is repeating, it means an ordered sequence of
                // items where each item is one of the choice options.
                // This maps to a JSON array with items using oneOf.
                const choiceMaxOccurs = complexType.choice.maxOccurs
                const isRepeatingChoice = choiceMaxOccurs === 'unbounded' ||
                    (choiceMaxOccurs !== undefined && choiceMaxOccurs > 1)

                if (isRepeatingChoice) {
                    // Repeating choice -> ordered array of operations
                    const itemSchema = this.generateRepeatingChoiceItemSchema(complexType.choice)
                    properties['operations'] = {
                        type: 'array',
                        items: itemSchema,
                        minItems: complexType.choice.minOccurs ?? 1,
                        description: 'Ordered list of operations. Each item is one of the choice options. ' +
                            'Order is semantically significant and MUST be preserved.',
                    }
                    required.push('operations')
                } else {
                    const choiceSchema = this.generateChoiceSchema(complexType.choice)
                    if (choiceSchema.oneOf || choiceSchema.anyOf) {
                        schema = { ...schema, ...choiceSchema }
                    } else if (choiceSchema.properties) {
                        Object.assign(properties, choiceSchema.properties)
                    }
                }
            } else if (complexType.all) {
                this.addAllToSchema(properties, required, complexType.all)
            } else if (complexType.group) {
                this.addGroupToSchema(properties, required, complexType.group)
            }

            // Handle mixed content
            if (complexType.mixed) {
                properties[this.config.textPropertyName!] = { type: 'string' }
            }

            // Add attributes
            this.addAttributesToSchema(
                schema,
                complexType.attributes,
                complexType.attributeGroups,
                complexType.anyAttribute,
                properties,
                required
            )

            if (Object.keys(properties).length > 0) {
                schema.properties = properties
            }

            if (required.length > 0) {
                schema.required = required
            }
        }

        // Add description from annotation
        if (complexType.annotation?.documentation?.length) {
            schema.description = complexType.annotation.documentation.join('\n').trim()
        }

        if (typeName) {
            this.processingTypes.delete(typeName)
        }

        return schema
    }

    /**
     * Generate schema for simple content
     * 
     * For elements with simpleContent (text + optional attributes), we check if the type
     * has any attributes defined. If it has attributes (including anyAttribute), we use
     * object form with $value. If it has NO attributes at all, we can use the direct value.
     */
    private generateSimpleContentSchema(
        simpleContent: XSDComplexType['simpleContent'],
        hasAnyAttribute: boolean = false
    ): JSONSchema {
        if (!simpleContent) return { type: 'object' }

        const schema: JSONSchema = { type: 'object' }
        const properties: Record<string, JSONSchema> = {}
        const required: string[] = []
        let baseSchema: JSONSchema = { type: 'string' }
        let hasAttributes = hasAnyAttribute

        if (simpleContent.extension) {
            // Extension of a simple type - add value property
            baseSchema = this.typeMapper.mapType(simpleContent.extension.base)
            
            // If extending a simple type, use the value pattern
            if (this.typeMapper.isBuiltInType(simpleContent.extension.base) ||
                this.resolvedSchema?.allSimpleTypes.has(simpleContent.extension.base)) {
                properties['$value'] = baseSchema
            } else {
                // Use allOf for complex base type extension
                return {
                    allOf: [
                        { $ref: `#/$defs/${this.typeMapper.normalizeTypeName(simpleContent.extension.base)}` },
                    ],
                }
            }

            // Add extension attributes
            for (const attr of simpleContent.extension.attributes) {
                const attrSchema = this.generateAttributeSchema(attr)
                const attrName = this.getAttributeName(attr)
                if (attrName) {
                    properties[attrName] = attrSchema
                    hasAttributes = true
                    if (attr.use === 'required') {
                        required.push(attrName)
                    }
                }
            }
            
            // Check for anyAttribute in extension
            if (simpleContent.extension.anyAttribute) {
                hasAttributes = true
            }
        } else if (simpleContent.restriction) {
            // Restriction of a simple type
            const restrictionSchema = this.generateRestrictionSchema(
                simpleContent.restriction
            )
            baseSchema = restrictionSchema
            properties['$value'] = restrictionSchema

            // Add restriction attributes
            if (simpleContent.restriction.attributes) {
                for (const attr of simpleContent.restriction.attributes) {
                    const attrSchema = this.generateAttributeSchema(attr)
                    const attrName = this.getAttributeName(attr)
                    if (attrName) {
                        properties[attrName] = attrSchema
                        hasAttributes = true
                        if (attr.use === 'required') {
                            required.push(attrName)
                        }
                    }
                }
            }
        }

        // If the type has any attributes defined (including anyAttribute), 
        // we must use the object form with $value
        if (hasAttributes) {
            schema.properties = properties
            if (required.length > 0) {
                schema.required = required
            }
            return schema
        }

        // No attributes defined at all - can use direct value
        return baseSchema
    }

    /**
     * Generate schema for complex content
     */
    private generateComplexContentSchema(
        complexContent: XSDComplexType['complexContent']
    ): JSONSchema {
        if (!complexContent) return { type: 'object' }

        if (complexContent.extension) {
            const baseRef = `#/$defs/${this.typeMapper.normalizeTypeName(
                complexContent.extension.base
            )}`

            // Build extension schema
            const extensionSchema: JSONSchema = { type: 'object' }
            const properties: Record<string, JSONSchema> = {}
            const required: string[] = []

            // Add sequence/choice/all from extension
            if (complexContent.extension.sequence) {
                this.addSequenceToSchema(
                    extensionSchema,
                    properties,
                    required,
                    complexContent.extension.sequence
                )
            } else if (complexContent.extension.choice) {
                const choiceSchema = this.generateChoiceSchema(
                    complexContent.extension.choice
                )
                Object.assign(properties, choiceSchema.properties || {})
            } else if (complexContent.extension.all) {
                this.addAllToSchema(
                    properties,
                    required,
                    complexContent.extension.all
                )
            } else if (complexContent.extension.group) {
                this.addGroupToSchema(
                    properties,
                    required,
                    complexContent.extension.group
                )
            }

            // Add attributes from extension
            this.addAttributesToSchema(
                extensionSchema,
                complexContent.extension.attributes,
                complexContent.extension.attributeGroups,
                complexContent.extension.anyAttribute,
                properties,
                required
            )

            if (Object.keys(properties).length > 0) {
                extensionSchema.properties = properties
            }
            if (required.length > 0) {
                extensionSchema.required = required
            }

            // Use allOf to combine base and extension
            if (Object.keys(properties).length > 0 || required.length > 0) {
                return {
                    allOf: [{ $ref: baseRef }, extensionSchema],
                }
            } else {
                return { $ref: baseRef }
            }
        } else if (complexContent.restriction) {
            const baseName = complexContent.restriction.base

            // Special handling for xs:anyType restriction.
            // Types like RFC 5261 "add" and "replace" restrict xs:anyType to define
            // their own attributes and an xs:any sequence. We cannot $ref anyType
            // (it doesn't exist as a named def), so we build the schema inline from
            // the restriction's own attributes and content model.
            if (baseName === 'xs:anyType') {
                const schema: JSONSchema = { type: 'object' }
                const properties: Record<string, JSONSchema> = {}
                const required: string[] = []

                // Process sequence (typically contains xs:any for mixed content)
                if (complexContent.restriction.sequence) {
                    this.addSequenceToSchema(schema, properties, required, complexContent.restriction.sequence)
                }

                // Process choice
                if (complexContent.restriction.choice) {
                    const choiceSchema = this.generateChoiceSchema(complexContent.restriction.choice)
                    if (choiceSchema.properties) {
                        Object.assign(properties, choiceSchema.properties)
                    }
                }

                // Process attributes
                if (complexContent.restriction.attributes.length > 0) {
                    this.addAttributesToSchema(
                        schema,
                        complexContent.restriction.attributes,
                        [],
                        undefined,
                        properties,
                        required
                    )
                }

                // If the complexContent is mixed, add $value for text content
                if (complexContent.mixed) {
                    properties[this.config.textPropertyName || '$value'] = {
                        type: 'string',
                        description: 'Text content of the element.',
                    }
                }

                if (Object.keys(properties).length > 0) {
                    schema.properties = properties
                }
                if (required.length > 0) {
                    schema.required = required
                }

                return schema
            }

            // For other restrictions, reference the base type
            const baseRef = `#/$defs/${this.typeMapper.normalizeTypeName(baseName)}`
            return { $ref: baseRef }
        }

        return { type: 'object' }
    }

    /**
     * Generate schema for a simple type
     */
    private generateSimpleTypeSchema(simpleType: XSDSimpleType): JSONSchema {
        let schema: JSONSchema = {}

        if (simpleType.restriction) {
            schema = this.generateRestrictionSchema(simpleType.restriction)
        } else if (simpleType.list) {
            // XSD list -> JSON array of strings (space-separated values)
            const itemType = simpleType.list.itemType
            let itemSchema: JSONSchema

            if (this.typeMapper.isBuiltInType(itemType)) {
                itemSchema = this.typeMapper.mapType(itemType)
            } else {
                itemSchema = {
                    $ref: `#/$defs/${this.typeMapper.normalizeTypeName(itemType)}`,
                }
            }

            schema = {
                type: 'array',
                items: itemSchema,
            }
        } else if (simpleType.union) {
            // XSD union -> JSON anyOf
            schema = {
                anyOf: simpleType.union.memberTypes.map((memberType) => {
                    if (this.typeMapper.isBuiltInType(memberType)) {
                        return this.typeMapper.mapType(memberType)
                    }
                    return {
                        $ref: `#/$defs/${this.typeMapper.normalizeTypeName(memberType)}`,
                    }
                }),
            }
        }

        // Add description from annotation
        if (simpleType.annotation?.documentation?.length) {
            schema.description = simpleType.annotation.documentation
                .join('\n')
                .trim()
        }

        return schema
    }

    /**
     * Generate schema for a restriction
     */
    private generateRestrictionSchema(restriction: XSDRestriction): JSONSchema {
        // Start with base type schema
        let schema: JSONSchema
        
        if (this.typeMapper.isBuiltInType(restriction.base)) {
            schema = { ...this.typeMapper.mapType(restriction.base) }
        } else {
            // Check if it's a known simple type
            const baseType = this.resolvedSchema?.allSimpleTypes.get(restriction.base)
            if (baseType) {
                schema = { ...this.generateSimpleTypeSchema(baseType) }
            } else {
                schema = { ...this.typeMapper.mapType(restriction.base) }
            }
        }

        // Apply restrictions
        if (restriction.enumeration?.length) {
            schema.enum = restriction.enumeration
        }

        if (restriction.pattern?.length) {
            if (restriction.pattern.length === 1) {
                schema.pattern = this.sanitizePattern(restriction.pattern[0])
            } else {
                // Multiple patterns - any must match
                schema.anyOf = restriction.pattern.map((p) => ({
                    ...schema,
                    pattern: this.sanitizePattern(p),
                }))
                delete schema.pattern
            }
        }

        if (restriction.minLength !== undefined) {
            schema.minLength = restriction.minLength
        }

        if (restriction.maxLength !== undefined) {
            schema.maxLength = restriction.maxLength
        }

        if (restriction.length !== undefined) {
            schema.minLength = restriction.length
            schema.maxLength = restriction.length
        }

        if (restriction.minInclusive !== undefined) {
            schema.minimum = this.typeMapper.parseNumericConstraint(
                restriction.minInclusive
            )
        }

        if (restriction.maxInclusive !== undefined) {
            schema.maximum = this.typeMapper.parseNumericConstraint(
                restriction.maxInclusive
            )
        }

        if (restriction.minExclusive !== undefined) {
            schema.exclusiveMinimum = this.typeMapper.parseNumericConstraint(
                restriction.minExclusive
            )
        }

        if (restriction.maxExclusive !== undefined) {
            schema.exclusiveMaximum = this.typeMapper.parseNumericConstraint(
                restriction.maxExclusive
            )
        }

        return schema
    }

    /**
     * Generate schema for an element
     */
    private generateElementSchema(element: XSDElement): JSONSchema {
        let schema: JSONSchema = {}

        if (element.type) {
            // Reference to a type
            if (this.typeMapper.isBuiltInType(element.type)) {
                schema = this.typeMapper.mapType(element.type)
            } else {
                schema = {
                    $ref: `#/$defs/${this.typeMapper.normalizeTypeName(element.type)}`,
                }
            }
        } else if (element.complexType) {
            // Inline complex type
            schema = this.generateComplexTypeSchema(element.complexType)
        } else if (element.simpleType) {
            // Inline simple type
            schema = this.generateSimpleTypeSchema(element.simpleType)
        } else if (element.ref) {
            // Reference to another element
            const refElement = this.schemaResolver.resolveElement(
                element.ref,
                this.resolvedSchema!
            )
            if (refElement) {
                schema = this.generateElementSchema(refElement)
            } else {
                schema = {} // Unknown reference
            }
        }

        // Handle array (maxOccurs > 1 or unbounded)
        if (
            element.maxOccurs === 'unbounded' ||
            (element.maxOccurs !== undefined && element.maxOccurs > 1)
        ) {
            const itemSchema = { ...schema }
            schema = {
                type: 'array',
                items: itemSchema,
            }

            if (element.minOccurs !== undefined && element.minOccurs > 0) {
                schema.minItems = element.minOccurs
            }

            if (element.maxOccurs !== 'unbounded') {
                schema.maxItems = element.maxOccurs
            }
        }

        // Add default value
        if (element.default !== undefined) {
            schema.default = this.parseDefaultValue(element.default, schema)
        }

        // Add fixed value as const
        if (element.fixed !== undefined) {
            schema.const = this.parseDefaultValue(element.fixed, schema)
        }

        // Add description from annotation
        if (element.annotation?.documentation?.length) {
            schema.description = element.annotation.documentation.join('\n').trim()
        }

        return schema
    }

    /**
     * Generate schema for an attribute
     */
    private generateAttributeSchema(attribute: XSDAttribute): JSONSchema {
        let schema: JSONSchema = {}

        if (attribute.type) {
            if (this.typeMapper.isBuiltInType(attribute.type)) {
                schema = this.typeMapper.mapType(attribute.type)
            } else {
                schema = {
                    $ref: `#/$defs/${this.typeMapper.normalizeTypeName(attribute.type)}`,
                }
            }
        } else if (attribute.simpleType) {
            schema = this.generateSimpleTypeSchema(attribute.simpleType)
        } else if (attribute.ref) {
            const refAttr = this.schemaResolver.resolveAttribute(
                attribute.ref,
                this.resolvedSchema!
            )
            if (refAttr) {
                schema = this.generateAttributeSchema(refAttr)
            }
        } else {
            // No type specified, default to string
            schema = { type: 'string' }
        }

        // Add default value
        if (attribute.default !== undefined) {
            schema.default = this.parseDefaultValue(attribute.default, schema)
        }

        // Add fixed value as const
        if (attribute.fixed !== undefined) {
            schema.const = this.parseDefaultValue(attribute.fixed, schema)
        }

        // Add description from annotation
        if (attribute.annotation?.documentation?.length) {
            schema.description = attribute.annotation.documentation.join('\n').trim()
        }

        return schema
    }

    /**
     * Add sequence elements to a schema
     */
    private addSequenceToSchema(
        schema: JSONSchema,
        properties: Record<string, JSONSchema>,
        required: string[],
        sequence: XSDSequence
    ): void {
        // Add elements
        for (const element of sequence.elements) {
            const elemName = element.name || element.ref?.split(':').pop() || ''
            if (!elemName) continue

            const elemSchema = this.generateElementSchema(element)
            properties[elemName] = elemSchema

            // Determine if required
            const minOccurs = element.minOccurs ?? 1
            if (minOccurs > 0) {
                required.push(elemName)
            }
        }

        // Add nested choices
        for (const choice of sequence.choices) {
            const choiceSchema = this.generateChoiceSchema(choice)
            if (choiceSchema.properties) {
                Object.assign(properties, choiceSchema.properties)
            }
        }

        // Add group references
        for (const group of sequence.groups) {
            this.addGroupToSchema(properties, required, group)
        }

        // Add nested sequences
        for (const nestedSeq of sequence.sequences) {
            this.addSequenceToSchema(schema, properties, required, nestedSeq)
        }

        // Handle xs:any
        if (sequence.any && sequence.any.length > 0 && this.config.allowAdditionalProperties) {
            this.addNamespaceSupport(schema, true, false)
        }
    }

    /**
     * Generate schema for a choice
     */
    private generateChoiceSchema(choice: XSDChoice): JSONSchema {
        const options: JSONSchema[] = []

        // Handle elements as options
        for (const element of choice.elements) {
            const elemName = element.name || element.ref?.split(':').pop() || ''
            if (!elemName) continue

            const elemSchema = this.generateElementSchema(element)
            const minOccurs = element.minOccurs ?? 1

            options.push({
                type: 'object',
                properties: { [elemName]: elemSchema },
                required: minOccurs > 0 ? [elemName] : undefined,
            })
        }

        // Handle sequences within choice
        for (const seq of choice.sequences) {
            const seqSchema: JSONSchema = { type: 'object' }
            const props: Record<string, JSONSchema> = {}
            const req: string[] = []
            this.addSequenceToSchema(seqSchema, props, req, seq)
            if (Object.keys(props).length > 0) {
                seqSchema.properties = props
                if (req.length > 0) {
                    seqSchema.required = req
                }
                options.push(seqSchema)
            }
        }

        // Handle nested choices
        for (const nestedChoice of choice.choices) {
            const nestedSchema = this.generateChoiceSchema(nestedChoice)
            if (nestedSchema.oneOf) {
                options.push(...nestedSchema.oneOf)
            } else if (nestedSchema.anyOf) {
                options.push(...nestedSchema.anyOf)
            }
        }

        // Handle groups within choice
        for (const group of choice.groups) {
            const groupSchema: JSONSchema = { type: 'object' }
            const props: Record<string, JSONSchema> = {}
            const req: string[] = []
            this.addGroupToSchema(props, req, group)
            if (Object.keys(props).length > 0) {
                groupSchema.properties = props
                if (req.length > 0) {
                    groupSchema.required = req
                }
                options.push(groupSchema)
            }
        }

        // If choice is optional (minOccurs=0), use anyOf; otherwise use oneOf
        const minOccurs = choice.minOccurs ?? 1
        if (options.length === 0) {
            return {}
        } else if (options.length === 1) {
            // Single option - just use its schema directly
            const opt = options[0]
            if (minOccurs === 0) {
                // Optional single choice
                return opt
            }
            return opt
        } else {
            // Multiple options
            if (minOccurs === 0) {
                return { anyOf: options }
            }
            return { oneOf: options }
        }
    }

    /**
     * Generate a oneOf schema for a repeating choice, suitable for use as array items.
     * Each choice alternative becomes a self-contained object schema in the oneOf.
     * This is used when xs:choice has maxOccurs > 1 or unbounded, mapping to an
     * ordered JSON array where each item is one of the alternatives.
     */
    private generateRepeatingChoiceItemSchema(choice: XSDChoice): JSONSchema {
        const options: JSONSchema[] = []
        const hasAny = choice.any && choice.any.length > 0 && this.config.allowAdditionalProperties

        // Collect all named element keys for discriminating xs:any
        const namedElementKeys: string[] = []
        for (const element of choice.elements) {
            const elemName = element.name || element.ref?.split(':').pop() || ''
            if (elemName) namedElementKeys.push(elemName)
        }

        // Handle elements as options.
        // When xs:any is also present, add additionalProperties: false to each
        // named option so that oneOf can discriminate between them and the xs:any.
        for (const element of choice.elements) {
            const elemName = element.name || element.ref?.split(':').pop() || ''
            if (!elemName) continue

            const elemSchema = this.generateElementSchema(element)
            const minOccurs = element.minOccurs ?? 1
            const option: JSONSchema = {
                type: 'object',
                properties: { [elemName]: elemSchema },
                required: minOccurs > 0 ? [elemName] : undefined,
            }
            if (hasAny) {
                option.additionalProperties = false
            }
            options.push(option)
        }

        // Handle sequences within choice
        for (const seq of choice.sequences) {
            const seqSchema: JSONSchema = { type: 'object' }
            const props: Record<string, JSONSchema> = {}
            const req: string[] = []
            this.addSequenceToSchema(seqSchema, props, req, seq)
            if (Object.keys(props).length > 0) {
                seqSchema.properties = props
                if (req.length > 0) {
                    seqSchema.required = req
                }
                options.push(seqSchema)
            }
        }

        // Handle nested choices
        for (const nestedChoice of choice.choices) {
            const nestedSchema = this.generateRepeatingChoiceItemSchema(nestedChoice)
            if (nestedSchema.oneOf) {
                options.push(...nestedSchema.oneOf)
            } else if (nestedSchema.anyOf) {
                options.push(...nestedSchema.anyOf)
            }
        }

        // Handle groups within choice
        for (const group of choice.groups) {
            const groupSchema: JSONSchema = { type: 'object' }
            const props: Record<string, JSONSchema> = {}
            const req: string[] = []
            this.addGroupToSchema(props, req, group)
            if (Object.keys(props).length > 0) {
                groupSchema.properties = props
                if (req.length > 0) {
                    groupSchema.required = req
                }
                options.push(groupSchema)
            }
        }

        // Handle xs:any within choice - allow arbitrary extension objects.
        // Use a `not` clause to exclude objects that contain any of the named
        // element keys, so the xs:any alternative only matches true extension
        // elements and oneOf discrimination works correctly.
        if (hasAny) {
            const anySchema: JSONSchema = {
                type: 'object',
                'x-xml-any': true,
                additionalProperties: true,
                description: 'Extension element from another namespace.',
            }
            if (namedElementKeys.length > 0) {
                anySchema.not = {
                    anyOf: namedElementKeys.map(key => ({
                        required: [key],
                    })),
                }
            }
            options.push(anySchema)
        }

        if (options.length === 0) {
            return {}
        } else if (options.length === 1) {
            return options[0]
        } else {
            return { oneOf: options }
        }
    }

    /**
     * Add all elements to a schema
     */
    private addAllToSchema(
        properties: Record<string, JSONSchema>,
        required: string[],
        all: XSDAll
    ): void {
        for (const element of all.elements) {
            const elemName = element.name || element.ref?.split(':').pop() || ''
            if (!elemName) continue

            const elemSchema = this.generateElementSchema(element)
            properties[elemName] = elemSchema

            const minOccurs = element.minOccurs ?? 1
            if (minOccurs > 0) {
                required.push(elemName)
            }
        }
    }

    /**
     * Add group reference to schema
     */
    private addGroupToSchema(
        properties: Record<string, JSONSchema>,
        required: string[],
        groupRef: XSDGroupRef
    ): void {
        if (!groupRef || !groupRef.ref) return
        
        const group = this.schemaResolver.resolveGroup(
            groupRef.ref,
            this.resolvedSchema!
        )
        if (!group) return

        if (group.sequence) {
            const tempSchema: JSONSchema = { type: 'object' }
            this.addSequenceToSchema(tempSchema, properties, required, group.sequence)
        } else if (group.choice) {
            const choiceSchema = this.generateChoiceSchema(group.choice)
            if (choiceSchema.properties) {
                Object.assign(properties, choiceSchema.properties)
            }
        } else if (group.all) {
            this.addAllToSchema(properties, required, group.all)
        }
    }

    /**
     * Add attributes to a schema
     */
    private addAttributesToSchema(
        schema: JSONSchema,
        attributes: XSDAttribute[],
        attributeGroups: string[],
        anyAttribute: XSDComplexType['anyAttribute'],
        properties?: Record<string, JSONSchema>,
        required?: string[]
    ): void {
        const props = properties || schema.properties || {}
        const reqs = required || []

        // Add direct attributes
        for (const attr of attributes) {
            if (attr.use === 'prohibited') continue

            const attrName = this.getAttributeName(attr)
            if (!attrName) continue

            const attrSchema = this.generateAttributeSchema(attr)

            // Optionally mark attribute properties with an extension keyword.
            // This is useful for schema-driven JSON->XML reconstruction.
            if (this.config.markAttributes) {
                ;(attrSchema as any)['x-xml-attribute'] = true
            }
            props[attrName] = attrSchema

            if (attr.use === 'required') {
                reqs.push(attrName)
            }
        }

        // Add attribute groups
        for (const groupRef of attributeGroups) {
            const group = this.schemaResolver.resolveAttributeGroup(
                groupRef,
                this.resolvedSchema!
            )
            if (group) {
                this.addAttributesToSchema(
                    schema,
                    group.attributes,
                    group.attributeGroups,
                    group.anyAttribute,
                    props,
                    reqs
                )
            }
        }

        // Handle anyAttribute
        if (anyAttribute && this.config.allowAdditionalProperties) {
            schema.additionalProperties = true
            schema['x-xml-any-attribute'] = true
        }

        if (!properties && Object.keys(props).length > 0) {
            schema.properties = props
        }

        if (!required && reqs.length > 0) {
            schema.required = reqs
        }
    }

    /**
     * Get attribute name, handling prefixes
     */
    private getAttributeName(attr: XSDAttribute): string | null {
        if (attr.name) {
            return this.config.attributePrefix + attr.name
        }
        if (attr.ref) {
            const localName = attr.ref.split(':').pop() || ''
            return this.config.attributePrefix + localName
        }
        return null
    }

    /**
     * Parse default/fixed values based on schema type
     */
    private parseDefaultValue(value: string, schema: JSONSchema): unknown {
        if (schema.type === 'boolean') {
            return value === 'true'
        }
        if (schema.type === 'integer' || schema.type === 'number') {
            return parseFloat(value)
        }
        return value
    }

    /**
     * Sanitize XSD pattern for JSON Schema regex compatibility
     * XSD patterns use XML Schema regex flavor, JSON Schema uses ECMA-262
     */
    private sanitizePattern(pattern: string): string {
        let result = pattern

        // First, decode XML character references
        result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            return String.fromCharCode(parseInt(hex, 16))
        })
        result = result.replace(/&#(\d+);/g, (_, dec) => {
            return String.fromCharCode(parseInt(dec, 10))
        })
        
        // Fix common XSD-specific escape sequences
        // \- in character classes should have hyphen at end or escaped
        result = result.replace(/\\-/g, '-')
        
        // XSD uses \i and \c for XML name characters - convert to approximate equivalents
        // \i = initial name character: letters, underscores
        // \c = name character: letters, digits, hyphens, underscores, periods
        result = result.replace(/\\i/g, '[a-zA-Z_]')
        result = result.replace(/\\c/g, '[a-zA-Z0-9._-]')

        // Fix character classes with hyphens in wrong positions
        // Hyphens must be at start, end, or escaped within character classes
        result = this.fixCharacterClassHyphens(result)
        
        return result
    }

    /**
     * Fix hyphens within character classes
     * In regex, hyphens in character classes must be:
     * - At the start: [-abc]
     * - At the end: [abc-]
     * - Escaped: [a\-b]
     * - Part of a valid range: [a-z]
     */
    private fixCharacterClassHyphens(pattern: string): string {
        // Find all character classes and fix them
        return pattern.replace(/\[([^\]]+)\]/g, (match, content) => {
            // Check if content starts with ^
            const negated = content.startsWith('^')
            const chars = negated ? content.slice(1) : content
            
            // Parse the character class content
            let fixed = ''
            let hasHyphen = false
            let i = 0
            
            while (i < chars.length) {
                const char = chars[i]
                const nextChar = chars[i + 1]
                const nextNextChar = chars[i + 2]
                
                // Check for escape sequences
                if (char === '\\' && nextChar) {
                    fixed += char + nextChar
                    i += 2
                    continue
                }
                
                // Check for valid ranges (e.g., a-z, 0-9)
                if (nextChar === '-' && nextNextChar && 
                    char.charCodeAt(0) < nextNextChar.charCodeAt(0) &&
                    /[a-zA-Z0-9]/.test(char) && /[a-zA-Z0-9]/.test(nextNextChar)) {
                    fixed += char + '-' + nextNextChar
                    i += 3
                    continue
                }
                
                // If it's a hyphen not in a valid position, mark for moving to end
                if (char === '-') {
                    hasHyphen = true
                    i++
                    continue
                }
                
                fixed += char
                i++
            }
            
            // Add hyphen at the end if we found one in an invalid position
            if (hasHyphen) {
                fixed += '-'
            }
            
            return '[' + (negated ? '^' : '') + fixed + ']'
        })
    }

    /**
     * Get the schema for extension content under a namespace prefix.
     * Extension elements and attributes are grouped under their prefix key.
     */
    private getExtensionSchema(): JSONSchema {
        return {
            type: 'object',
            additionalProperties: true,
            description: 'Extension elements and attributes from a declared namespace. ' +
                'Primitive values represent attributes, objects/arrays represent child elements.',
        }
    }

    /**
     * Add namespace support properties to a schema.
     * This enables the schema to accept extension elements from declared namespaces.
     * 
     * @param schema - The schema to modify
     * @param hasAny - Whether xs:any is present (extension elements)
     * @param hasAnyAttribute - Whether xs:anyAttribute is present (extension attributes)
     */
    private addNamespaceSupport(schema: JSONSchema, hasAny: boolean, hasAnyAttribute: boolean): void {
        // NOTE: $ns is added only at the root level (in generate()), not on individual types.
        // This enforces the constraint that namespace declarations appear only at the document root.
        if (!schema.properties) schema.properties = {}
        
        // NOTE: We intentionally do NOT use patternProperties here.
        // patternProperties would apply to ALL matching property names, including
        // standard DASH properties like "type", "profiles", etc.
        // Instead, we rely on additionalProperties: true to allow extension content.
        // Extension content validation (under prefix keys like "ext") cannot be
        // strictly enforced via JSON Schema since we don't know prefixes ahead of time.
        
        // Mark extension support with x-xml-* properties for documentation
        if (hasAny) schema['x-xml-any'] = true
        if (hasAnyAttribute) schema['x-xml-any-attribute'] = true
        
        // Allow additional properties for extension content (under prefix keys)
        schema.additionalProperties = true
    }
}
