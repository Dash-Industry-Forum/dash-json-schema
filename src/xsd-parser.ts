/**
 * XSD Parser - Parses XSD files into structured TypeScript objects
 */

import { XMLParser } from 'fast-xml-parser'
import * as fs from 'fs'
import * as path from 'path'
import {
    XSDSchema,
    XSDElement,
    XSDComplexType,
    XSDSimpleType,
    XSDAttribute,
    XSDSequence,
    XSDChoice,
    XSDAll,
    XSDRestriction,
    XSDExtension,
    XSDAnnotation,
    XSDAttributeGroup,
    XSDGroup,
    XSDAny,
    XSDAnyAttribute,
    XSDGroupRef,
    XSDList,
    XSDSimpleContent,
    XSDComplexContent,
} from './types'

const XS_PREFIX = 'xs:'

/**
 * Expand DTD entity references in XSD content
 * This handles the ENTITY declarations in DOCTYPE
 */
function expandDTDEntities(content: string): string {
    // Extract entity definitions from DOCTYPE
    const entities: Map<string, string> = new Map()
    
    // Match ENTITY declarations: <!ENTITY name "value">
    const entityRegex = /<!ENTITY\s+(\S+)\s+"([^"]*)"\s*>/g
    let match: RegExpExecArray | null
    
    while ((match = entityRegex.exec(content)) !== null) {
        entities.set(match[1], match[2])
    }
    
    // If no entities found, return original content
    if (entities.size === 0) {
        return content
    }
    
    // Remove DOCTYPE declaration to avoid parsing issues
    let result = content.replace(/<!DOCTYPE[^>]*\[[\s\S]*?\]>/g, '')
    
    // Recursively expand entity references
    // Entity references look like &entityName;
    let prevResult = ''
    let iterations = 0
    const maxIterations = 20 // Prevent infinite loops
    
    while (prevResult !== result && iterations < maxIterations) {
        prevResult = result
        iterations++
        
        for (const [name, value] of entities) {
            // Replace &entityName; with its value
            // Escape special regex characters in entity name
            const escapedName = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
            const entityRef = new RegExp(`&${escapedName};`, 'g')
            result = result.replace(entityRef, value)
        }
    }
    
    // Note: We don't decode character entities here because they need to stay
    // as valid XML. The XML parser will handle them. We only expanded the DTD
    // entity definitions.
    
    return result
}

export class XSDParser {
    private parser: XMLParser
    private basePath: string = ''

    constructor() {
        const arrayElements = new Set([
            'xs:element',
            'xs:attribute',
            'xs:enumeration',
            'xs:pattern',
            'xs:sequence',
            'xs:choice',
            'xs:any',
            'xs:attributeGroup',
            'xs:group',
            'xs:import',
            'xs:include',
            'xs:complexType',
            'xs:simpleType',
            'xs:documentation',
            'xs:appinfo',
        ])
        
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            preserveOrder: false,
            removeNSPrefix: false,
            parseAttributeValue: false,
            trimValues: true,
            isArray: (name: string, jpath: string, isLeafNode: boolean, isAttribute: boolean) => {
                if (isAttribute) return false
                return arrayElements.has(name)
            },
        })
    }

    parseFile(filePath: string): XSDSchema {
        this.basePath = path.dirname(filePath)
        const content = fs.readFileSync(filePath, 'utf-8')
        return this.parse(content)
    }

    parse(xmlContent: string): XSDSchema {
        // Expand DTD entity references before parsing
        const expandedContent = expandDTDEntities(xmlContent)
        const parsed = this.parser.parse(expandedContent)
        const schemaNode = parsed['xs:schema']

        if (!schemaNode) {
            throw new Error('Invalid XSD: No xs:schema element found')
        }

        const schema: XSDSchema = {
            targetNamespace: schemaNode['@_targetNamespace'],
            elementFormDefault: schemaNode['@_elementFormDefault'],
            attributeFormDefault: schemaNode['@_attributeFormDefault'],
            imports: [],
            includes: [],
            elements: new Map(),
            complexTypes: new Map(),
            simpleTypes: new Map(),
            attributeGroups: new Map(),
            groups: new Map(),
            attributes: new Map(),
        }

        // Parse imports
        if (schemaNode['xs:import']) {
            for (const imp of this.ensureArray(schemaNode['xs:import'])) {
                schema.imports.push({
                    namespace: imp['@_namespace'],
                    schemaLocation: imp['@_schemaLocation'],
                })
            }
        }

        // Parse includes
        if (schemaNode['xs:include']) {
            for (const inc of this.ensureArray(schemaNode['xs:include'])) {
                schema.includes.push({
                    schemaLocation: inc['@_schemaLocation'],
                })
            }
        }

        // Parse top-level elements
        if (schemaNode['xs:element']) {
            for (const elem of this.ensureArray(schemaNode['xs:element'])) {
                const element = this.parseElement(elem)
                if (element.name) {
                    schema.elements.set(element.name, element)
                }
            }
        }

        // Parse complex types
        if (schemaNode['xs:complexType']) {
            for (const ct of this.ensureArray(schemaNode['xs:complexType'])) {
                const complexType = this.parseComplexType(ct)
                if (complexType.name) {
                    schema.complexTypes.set(complexType.name, complexType)
                }
            }
        }

        // Parse simple types
        if (schemaNode['xs:simpleType']) {
            for (const st of this.ensureArray(schemaNode['xs:simpleType'])) {
                const simpleType = this.parseSimpleType(st)
                if (simpleType.name) {
                    schema.simpleTypes.set(simpleType.name, simpleType)
                }
            }
        }

        // Parse attribute groups
        if (schemaNode['xs:attributeGroup']) {
            for (const ag of this.ensureArray(
                schemaNode['xs:attributeGroup']
            )) {
                const attrGroup = this.parseAttributeGroup(ag)
                if (attrGroup.name) {
                    schema.attributeGroups.set(attrGroup.name, attrGroup)
                }
            }
        }

        // Parse groups
        if (schemaNode['xs:group']) {
            for (const g of this.ensureArray(schemaNode['xs:group'])) {
                const group = this.parseGroup(g)
                if (group.name) {
                    schema.groups.set(group.name, group)
                }
            }
        }

        // Parse top-level attributes
        if (schemaNode['xs:attribute']) {
            for (const attr of this.ensureArray(schemaNode['xs:attribute'])) {
                const attribute = this.parseAttribute(attr)
                if (attribute.name) {
                    schema.attributes.set(attribute.name, attribute)
                }
            }
        }

        return schema
    }

    private ensureArray<T>(value: T | T[] | undefined): T[] {
        if (value === undefined) return []
        return Array.isArray(value) ? value : [value]
    }

    private parseElement(node: any): XSDElement {
        const element: XSDElement = {
            name: node['@_name'],
            type: node['@_type'],
            ref: node['@_ref'],
            minOccurs: this.parseOccurs(node['@_minOccurs']),
            maxOccurs: this.parseMaxOccurs(node['@_maxOccurs']),
            default: node['@_default'],
            fixed: node['@_fixed'],
            nillable: node['@_nillable'] === 'true',
            abstract: node['@_abstract'] === 'true',
            substitutionGroup: node['@_substitutionGroup'],
        }

        // Parse inline complex type
        if (node['xs:complexType']) {
            const ctArray = this.ensureArray(node['xs:complexType'])
            if (ctArray.length > 0) {
                element.complexType = this.parseComplexType(ctArray[0])
            }
        }

        // Parse inline simple type
        if (node['xs:simpleType']) {
            const stArray = this.ensureArray(node['xs:simpleType'])
            if (stArray.length > 0) {
                element.simpleType = this.parseSimpleType(stArray[0])
            }
        }

        // Parse annotation
        if (node['xs:annotation']) {
            element.annotation = this.parseAnnotation(node['xs:annotation'])
        }

        return element
    }

    private parseComplexType(node: any): XSDComplexType {
        const complexType: XSDComplexType = {
            name: node['@_name'],
            mixed: node['@_mixed'] === 'true',
            abstract: node['@_abstract'] === 'true',
            attributes: [],
            attributeGroups: [],
        }

        // Parse sequence
        if (node['xs:sequence']) {
            const seqArray = this.ensureArray(node['xs:sequence'])
            if (seqArray.length > 0) {
                complexType.sequence = this.parseSequence(seqArray[0])
            }
        }

        // Parse choice
        if (node['xs:choice']) {
            const choiceArray = this.ensureArray(node['xs:choice'])
            if (choiceArray.length > 0) {
                complexType.choice = this.parseChoice(choiceArray[0])
            }
        }

        // Parse all
        if (node['xs:all']) {
            complexType.all = this.parseAll(node['xs:all'])
        }

        // Parse simpleContent
        if (node['xs:simpleContent']) {
            complexType.simpleContent = this.parseSimpleContent(
                node['xs:simpleContent']
            )
        }

        // Parse complexContent
        if (node['xs:complexContent']) {
            complexType.complexContent = this.parseComplexContent(
                node['xs:complexContent']
            )
        }

        // Parse group reference
        if (node['xs:group']) {
            complexType.group = this.parseGroupRef(node['xs:group'])
        }

        // Parse attributes
        if (node['xs:attribute']) {
            for (const attr of this.ensureArray(node['xs:attribute'])) {
                complexType.attributes.push(this.parseAttribute(attr))
            }
        }

        // Parse attribute groups
        if (node['xs:attributeGroup']) {
            for (const ag of this.ensureArray(node['xs:attributeGroup'])) {
                if (ag['@_ref']) {
                    complexType.attributeGroups.push(ag['@_ref'])
                }
            }
        }

        // Parse anyAttribute
        if (node['xs:anyAttribute']) {
            complexType.anyAttribute = this.parseAnyAttribute(
                node['xs:anyAttribute']
            )
        }

        // Parse annotation
        if (node['xs:annotation']) {
            complexType.annotation = this.parseAnnotation(node['xs:annotation'])
        }

        return complexType
    }

    private parseSimpleType(node: any): XSDSimpleType {
        const simpleType: XSDSimpleType = {
            name: node['@_name'],
        }

        // Parse restriction
        if (node['xs:restriction']) {
            simpleType.restriction = this.parseRestriction(
                node['xs:restriction']
            )
        }

        // Parse list
        if (node['xs:list']) {
            simpleType.list = this.parseList(node['xs:list'])
        }

        // Parse union
        if (node['xs:union']) {
            simpleType.union = {
                memberTypes: (node['xs:union']['@_memberTypes'] || '')
                    .split(/\s+/)
                    .filter(Boolean),
            }
        }

        // Parse annotation
        if (node['xs:annotation']) {
            simpleType.annotation = this.parseAnnotation(node['xs:annotation'])
        }

        return simpleType
    }

    private parseRestriction(node: any): XSDRestriction {
        const restriction: XSDRestriction = {
            base: node['@_base'],
        }

        // Parse enumerations
        if (node['xs:enumeration']) {
            restriction.enumeration = this.ensureArray(node['xs:enumeration'])
                .map((e: any) => e['@_value'])
                .filter(Boolean)
        }

        // Parse patterns
        if (node['xs:pattern']) {
            restriction.pattern = this.ensureArray(node['xs:pattern'])
                .map((p: any) => p['@_value'])
                .filter(Boolean)
        }

        // Parse length constraints
        if (node['xs:minLength']) {
            restriction.minLength = parseInt(
                node['xs:minLength']['@_value'],
                10
            )
        }
        if (node['xs:maxLength']) {
            restriction.maxLength = parseInt(
                node['xs:maxLength']['@_value'],
                10
            )
        }
        if (node['xs:length']) {
            restriction.length = parseInt(node['xs:length']['@_value'], 10)
        }

        // Parse numeric constraints
        if (node['xs:minInclusive']) {
            restriction.minInclusive = node['xs:minInclusive']['@_value']
        }
        if (node['xs:maxInclusive']) {
            restriction.maxInclusive = node['xs:maxInclusive']['@_value']
        }
        if (node['xs:minExclusive']) {
            restriction.minExclusive = node['xs:minExclusive']['@_value']
        }
        if (node['xs:maxExclusive']) {
            restriction.maxExclusive = node['xs:maxExclusive']['@_value']
        }
        if (node['xs:totalDigits']) {
            restriction.totalDigits = parseInt(
                node['xs:totalDigits']['@_value'],
                10
            )
        }
        if (node['xs:fractionDigits']) {
            restriction.fractionDigits = parseInt(
                node['xs:fractionDigits']['@_value'],
                10
            )
        }
        if (node['xs:whiteSpace']) {
            restriction.whiteSpace = node['xs:whiteSpace']['@_value']
        }

        return restriction
    }

    private parseList(node: any): XSDList {
        return {
            itemType: node['@_itemType'],
        }
    }

    private parseSequence(node: any): XSDSequence {
        const sequence: XSDSequence = {
            elements: [],
            choices: [],
            groups: [],
            sequences: [],
            any: [],
            minOccurs: this.parseOccurs(node['@_minOccurs']),
            maxOccurs: this.parseMaxOccurs(node['@_maxOccurs']),
        }

        // Parse elements
        if (node['xs:element']) {
            for (const elem of this.ensureArray(node['xs:element'])) {
                sequence.elements.push(this.parseElement(elem))
            }
        }

        // Parse choices
        if (node['xs:choice']) {
            for (const choice of this.ensureArray(node['xs:choice'])) {
                sequence.choices.push(this.parseChoice(choice))
            }
        }

        // Parse groups
        if (node['xs:group']) {
            for (const group of this.ensureArray(node['xs:group'])) {
                sequence.groups.push(this.parseGroupRef(group))
            }
        }

        // Parse nested sequences
        if (node['xs:sequence']) {
            for (const seq of this.ensureArray(node['xs:sequence'])) {
                sequence.sequences.push(this.parseSequence(seq))
            }
        }

        // Parse any
        if (node['xs:any']) {
            for (const any of this.ensureArray(node['xs:any'])) {
                sequence.any!.push(this.parseAny(any))
            }
        }

        return sequence
    }

    private parseChoice(node: any): XSDChoice {
        const choice: XSDChoice = {
            elements: [],
            sequences: [],
            groups: [],
            choices: [],
            any: [],
            minOccurs: this.parseOccurs(node['@_minOccurs']),
            maxOccurs: this.parseMaxOccurs(node['@_maxOccurs']),
        }

        // Parse elements
        if (node['xs:element']) {
            for (const elem of this.ensureArray(node['xs:element'])) {
                choice.elements.push(this.parseElement(elem))
            }
        }

        // Parse sequences
        if (node['xs:sequence']) {
            for (const seq of this.ensureArray(node['xs:sequence'])) {
                choice.sequences.push(this.parseSequence(seq))
            }
        }

        // Parse groups
        if (node['xs:group']) {
            for (const group of this.ensureArray(node['xs:group'])) {
                choice.groups.push(this.parseGroupRef(group))
            }
        }

        // Parse nested choices
        if (node['xs:choice']) {
            for (const ch of this.ensureArray(node['xs:choice'])) {
                choice.choices.push(this.parseChoice(ch))
            }
        }

        // Parse any
        if (node['xs:any']) {
            for (const any of this.ensureArray(node['xs:any'])) {
                choice.any!.push(this.parseAny(any))
            }
        }

        return choice
    }

    private parseAll(node: any): XSDAll {
        const all: XSDAll = {
            elements: [],
            minOccurs: this.parseOccurs(node['@_minOccurs']),
            maxOccurs: this.parseMaxOccurs(node['@_maxOccurs']),
        }

        if (node['xs:element']) {
            for (const elem of this.ensureArray(node['xs:element'])) {
                all.elements.push(this.parseElement(elem))
            }
        }

        return all
    }

    private parseSimpleContent(node: any): XSDSimpleContent {
        const content: XSDSimpleContent = {}

        if (node['xs:extension']) {
            content.extension = this.parseExtension(node['xs:extension'])
        }

        if (node['xs:restriction']) {
            const restriction = this.parseRestriction(node['xs:restriction'])
            content.restriction = {
                ...restriction,
                attributes: [],
            }
            // Parse attributes within restriction
            if (node['xs:restriction']['xs:attribute']) {
                for (const attr of this.ensureArray(
                    node['xs:restriction']['xs:attribute']
                )) {
                    content.restriction.attributes!.push(
                        this.parseAttribute(attr)
                    )
                }
            }
        }

        return content
    }

    private parseComplexContent(node: any): XSDComplexContent {
        const content: XSDComplexContent = {
            mixed: node['@_mixed'] === 'true',
        }

        if (node['xs:extension']) {
            content.extension = this.parseExtension(node['xs:extension'])
        }

        if (node['xs:restriction']) {
            content.restriction = {
                base: node['xs:restriction']['@_base'],
                attributes: [],
            }
            // Parse sequence in restriction
            if (node['xs:restriction']['xs:sequence']) {
                const seqArray = this.ensureArray(
                    node['xs:restriction']['xs:sequence']
                )
                if (seqArray.length > 0) {
                    content.restriction.sequence = this.parseSequence(
                        seqArray[0]
                    )
                }
            }
            // Parse choice in restriction
            if (node['xs:restriction']['xs:choice']) {
                const choiceArray = this.ensureArray(
                    node['xs:restriction']['xs:choice']
                )
                if (choiceArray.length > 0) {
                    content.restriction.choice = this.parseChoice(choiceArray[0])
                }
            }
            // Parse attributes in restriction
            if (node['xs:restriction']['xs:attribute']) {
                for (const attr of this.ensureArray(
                    node['xs:restriction']['xs:attribute']
                )) {
                    content.restriction.attributes.push(
                        this.parseAttribute(attr)
                    )
                }
            }
        }

        return content
    }

    private parseExtension(node: any): XSDExtension {
        const extension: XSDExtension = {
            base: node['@_base'],
            attributes: [],
            attributeGroups: [],
        }

        // Parse sequence
        if (node['xs:sequence']) {
            const seqArray = this.ensureArray(node['xs:sequence'])
            if (seqArray.length > 0) {
                extension.sequence = this.parseSequence(seqArray[0])
            }
        }

        // Parse choice
        if (node['xs:choice']) {
            const choiceArray = this.ensureArray(node['xs:choice'])
            if (choiceArray.length > 0) {
                extension.choice = this.parseChoice(choiceArray[0])
            }
        }

        // Parse all
        if (node['xs:all']) {
            extension.all = this.parseAll(node['xs:all'])
        }

        // Parse group reference
        if (node['xs:group']) {
            extension.group = this.parseGroupRef(node['xs:group'])
        }

        // Parse attributes
        if (node['xs:attribute']) {
            for (const attr of this.ensureArray(node['xs:attribute'])) {
                extension.attributes.push(this.parseAttribute(attr))
            }
        }

        // Parse attribute groups
        if (node['xs:attributeGroup']) {
            for (const ag of this.ensureArray(node['xs:attributeGroup'])) {
                if (ag['@_ref']) {
                    extension.attributeGroups.push(ag['@_ref'])
                }
            }
        }

        // Parse anyAttribute
        if (node['xs:anyAttribute']) {
            extension.anyAttribute = this.parseAnyAttribute(
                node['xs:anyAttribute']
            )
        }

        return extension
    }

    private parseAttribute(node: any): XSDAttribute {
        const attribute: XSDAttribute = {
            name: node['@_name'],
            ref: node['@_ref'],
            type: node['@_type'],
            use: node['@_use'] as 'required' | 'optional' | 'prohibited',
            default: node['@_default'],
            fixed: node['@_fixed'],
        }

        // Parse inline simple type
        if (node['xs:simpleType']) {
            const stArray = this.ensureArray(node['xs:simpleType'])
            if (stArray.length > 0) {
                attribute.simpleType = this.parseSimpleType(stArray[0])
            }
        }

        // Parse annotation
        if (node['xs:annotation']) {
            attribute.annotation = this.parseAnnotation(node['xs:annotation'])
        }

        return attribute
    }

    private parseAttributeGroup(node: any): XSDAttributeGroup {
        const group: XSDAttributeGroup = {
            name: node['@_name'],
            attributes: [],
            attributeGroups: [],
        }

        if (node['xs:attribute']) {
            for (const attr of this.ensureArray(node['xs:attribute'])) {
                group.attributes.push(this.parseAttribute(attr))
            }
        }

        if (node['xs:attributeGroup']) {
            for (const ag of this.ensureArray(node['xs:attributeGroup'])) {
                if (ag['@_ref']) {
                    group.attributeGroups.push(ag['@_ref'])
                }
            }
        }

        if (node['xs:anyAttribute']) {
            group.anyAttribute = this.parseAnyAttribute(node['xs:anyAttribute'])
        }

        return group
    }

    private parseGroup(node: any): XSDGroup {
        const group: XSDGroup = {
            name: node['@_name'],
        }

        if (node['xs:sequence']) {
            const seqArray = this.ensureArray(node['xs:sequence'])
            if (seqArray.length > 0) {
                group.sequence = this.parseSequence(seqArray[0])
            }
        }

        if (node['xs:choice']) {
            const choiceArray = this.ensureArray(node['xs:choice'])
            if (choiceArray.length > 0) {
                group.choice = this.parseChoice(choiceArray[0])
            }
        }

        if (node['xs:all']) {
            group.all = this.parseAll(node['xs:all'])
        }

        if (node['xs:annotation']) {
            group.annotation = this.parseAnnotation(node['xs:annotation'])
        }

        return group
    }

    private parseGroupRef(node: any): XSDGroupRef {
        return {
            ref: node['@_ref'],
            minOccurs: this.parseOccurs(node['@_minOccurs']),
            maxOccurs: this.parseMaxOccurs(node['@_maxOccurs']),
        }
    }

    private parseAny(node: any): XSDAny {
        return {
            namespace: node['@_namespace'],
            processContents: node['@_processContents'] as
                | 'strict'
                | 'lax'
                | 'skip',
            minOccurs: this.parseOccurs(node['@_minOccurs']),
            maxOccurs: this.parseMaxOccurs(node['@_maxOccurs']),
        }
    }

    private parseAnyAttribute(node: any): XSDAnyAttribute {
        return {
            namespace: node['@_namespace'],
            processContents: node['@_processContents'] as
                | 'strict'
                | 'lax'
                | 'skip',
        }
    }

    private parseAnnotation(node: any): XSDAnnotation {
        const annotation: XSDAnnotation = {}

        if (node['xs:documentation']) {
            annotation.documentation = this.ensureArray(
                node['xs:documentation']
            ).map((d: any) => {
                if (typeof d === 'string') return d
                if (d['#text']) return d['#text']
                return ''
            })
        }

        if (node['xs:appinfo']) {
            annotation.appinfo = this.ensureArray(node['xs:appinfo']).map(
                (a: any) => {
                    if (typeof a === 'string') return a
                    if (a['#text']) return a['#text']
                    return ''
                }
            )
        }

        return annotation
    }

    private parseOccurs(value: string | undefined): number | undefined {
        if (value === undefined) return undefined
        return parseInt(value, 10)
    }

    private parseMaxOccurs(
        value: string | undefined
    ): number | 'unbounded' | undefined {
        if (value === undefined) return undefined
        if (value === 'unbounded') return 'unbounded'
        return parseInt(value, 10)
    }
}
