/**
 * Schema Resolver - Handles XSD imports and includes, resolving references
 */

import * as fs from 'fs'
import * as path from 'path'
import { XSDParser } from './xsd-parser'
import {
    XSDSchema,
    XSDComplexType,
    XSDSimpleType,
    XSDElement,
    XSDAttribute,
    XSDAttributeGroup,
    XSDGroup,
} from './types'

export interface ResolvedSchema {
    /** The main schema */
    main: XSDSchema
    /** All imported/included schemas by namespace */
    imported: Map<string, XSDSchema>
    /** Combined type definitions from all schemas */
    allComplexTypes: Map<string, XSDComplexType>
    allSimpleTypes: Map<string, XSDSimpleType>
    allElements: Map<string, XSDElement>
    allAttributes: Map<string, XSDAttribute>
    allAttributeGroups: Map<string, XSDAttributeGroup>
    allGroups: Map<string, XSDGroup>
    /** Namespace to prefix mapping */
    namespaceToPrefix: Map<string, string>
}

export class SchemaResolver {
    private parser: XSDParser
    private loadedSchemas: Map<string, XSDSchema> = new Map()
    private basePath: string = ''

    constructor() {
        this.parser = new XSDParser()
    }

    /**
     * Resolve all imports and includes for an XSD file
     */
    resolveFile(filePath: string): ResolvedSchema {
        this.basePath = path.dirname(path.resolve(filePath))
        const mainSchema = this.parser.parseFile(filePath)

        return this.resolveSchema(mainSchema, filePath)
    }

    /**
     * Resolve all imports and includes for a parsed schema
     */
    resolveSchema(
        mainSchema: XSDSchema,
        sourcePath?: string
    ): ResolvedSchema {
        const result: ResolvedSchema = {
            main: mainSchema,
            imported: new Map(),
            allComplexTypes: new Map(),
            allSimpleTypes: new Map(),
            allElements: new Map(),
            allAttributes: new Map(),
            allAttributeGroups: new Map(),
            allGroups: new Map(),
            namespaceToPrefix: new Map(),
        }

        // Process the main schema
        this.addSchemaDefinitions(mainSchema, result, '')

        // Process imports
        for (const imp of mainSchema.imports) {
            if (imp.schemaLocation) {
                const importedSchema = this.loadSchema(imp.schemaLocation, sourcePath)
                if (importedSchema) {
                    result.imported.set(imp.namespace, importedSchema)
                    
                    // Determine prefix for this namespace
                    const prefix = this.getPrefixForNamespace(imp.namespace)
                    result.namespaceToPrefix.set(imp.namespace, prefix)
                    
                    this.addSchemaDefinitions(importedSchema, result, prefix)
                }
            }
        }

        // Process includes
        for (const inc of mainSchema.includes) {
            const includedSchema = this.loadSchema(inc.schemaLocation, sourcePath)
            if (includedSchema) {
                // Includes use the same namespace as the main schema
                this.addSchemaDefinitions(includedSchema, result, '')
            }
        }

        return result
    }

    /**
     * Load a schema from a file path or URL
     */
    private loadSchema(
        location: string,
        sourcePath?: string
    ): XSDSchema | null {
        // Check if already loaded
        if (this.loadedSchemas.has(location)) {
            return this.loadedSchemas.get(location)!
        }

        let resolvedPath: string

        // Handle relative paths
        if (!location.startsWith('http://') && !location.startsWith('https://')) {
            if (sourcePath) {
                resolvedPath = path.resolve(path.dirname(sourcePath), location)
            } else {
                resolvedPath = path.resolve(this.basePath, location)
            }
        } else {
            // For URLs, try to find a local copy
            const filename = path.basename(location)
            resolvedPath = path.resolve(this.basePath, filename)
            
            if (!fs.existsSync(resolvedPath)) {
                console.warn(
                    `Warning: Cannot resolve remote schema: ${location}. Looking for local copy at ${resolvedPath}`
                )
                return null
            }
        }

        if (!fs.existsSync(resolvedPath)) {
            console.warn(`Warning: Schema file not found: ${resolvedPath}`)
            return null
        }

        try {
            const schema = this.parser.parseFile(resolvedPath)
            this.loadedSchemas.set(location, schema)

            // Recursively resolve imports and includes
            for (const imp of schema.imports) {
                if (imp.schemaLocation) {
                    this.loadSchema(imp.schemaLocation, resolvedPath)
                }
            }

            for (const inc of schema.includes) {
                this.loadSchema(inc.schemaLocation, resolvedPath)
            }

            return schema
        } catch (error) {
            console.warn(`Warning: Error loading schema ${resolvedPath}:`, error)
            return null
        }
    }

    /**
     * Add definitions from a schema to the resolved result
     */
    private addSchemaDefinitions(
        schema: XSDSchema,
        result: ResolvedSchema,
        prefix: string
    ): void {
        // Add complex types
        for (const [name, type] of schema.complexTypes) {
            const qualifiedName = prefix ? `${prefix}:${name}` : name
            result.allComplexTypes.set(qualifiedName, type)
        }

        // Add simple types
        for (const [name, type] of schema.simpleTypes) {
            const qualifiedName = prefix ? `${prefix}:${name}` : name
            result.allSimpleTypes.set(qualifiedName, type)
        }

        // Add elements
        for (const [name, element] of schema.elements) {
            const qualifiedName = prefix ? `${prefix}:${name}` : name
            result.allElements.set(qualifiedName, element)
        }

        // Add attributes
        for (const [name, attr] of schema.attributes) {
            const qualifiedName = prefix ? `${prefix}:${name}` : name
            result.allAttributes.set(qualifiedName, attr)
        }

        // Add attribute groups
        for (const [name, group] of schema.attributeGroups) {
            const qualifiedName = prefix ? `${prefix}:${name}` : name
            result.allAttributeGroups.set(qualifiedName, group)
        }

        // Add groups
        for (const [name, group] of schema.groups) {
            const qualifiedName = prefix ? `${prefix}:${name}` : name
            result.allGroups.set(qualifiedName, group)
        }
    }

    /**
     * Get a prefix for a namespace
     */
    private getPrefixForNamespace(namespace: string): string {
        // Common namespace prefixes
        const prefixMap: Record<string, string> = {
            'http://www.w3.org/1999/xlink': 'xlink',
            'http://www.w3.org/XML/1998/namespace': 'xml',
            'urn:mpeg:cenc:2013': 'cenc',
            'urn:mpeg:dash:schema:urlparam:2016': 'up',
            'urn:mpeg:dash:schema:mpd-patch:2020': 'patch',
        }

        return prefixMap[namespace] || namespace.split('/').pop()?.split(':').pop() || 'ns'
    }

    /**
     * Resolve a type reference to its definition
     */
    resolveType(
        typeName: string,
        resolved: ResolvedSchema
    ): XSDComplexType | XSDSimpleType | null {
        // Try complex type first
        if (resolved.allComplexTypes.has(typeName)) {
            return resolved.allComplexTypes.get(typeName)!
        }

        // Try simple type
        if (resolved.allSimpleTypes.has(typeName)) {
            return resolved.allSimpleTypes.get(typeName)!
        }

        // Try without namespace prefix
        const localName = typeName.includes(':')
            ? typeName.split(':')[1]
            : typeName

        for (const [name, type] of resolved.allComplexTypes) {
            if (name === localName || name.endsWith(`:${localName}`)) {
                return type
            }
        }

        for (const [name, type] of resolved.allSimpleTypes) {
            if (name === localName || name.endsWith(`:${localName}`)) {
                return type
            }
        }

        return null
    }

    /**
     * Resolve an attribute reference
     */
    resolveAttribute(
        attrRef: string,
        resolved: ResolvedSchema
    ): XSDAttribute | null {
        if (resolved.allAttributes.has(attrRef)) {
            return resolved.allAttributes.get(attrRef)!
        }

        // Try without namespace prefix
        const localName = attrRef.includes(':')
            ? attrRef.split(':')[1]
            : attrRef

        for (const [name, attr] of resolved.allAttributes) {
            if (name === localName || name.endsWith(`:${localName}`)) {
                return attr
            }
        }

        return null
    }

    /**
     * Resolve an attribute group reference
     */
    resolveAttributeGroup(
        groupRef: string,
        resolved: ResolvedSchema
    ): XSDAttributeGroup | null {
        if (resolved.allAttributeGroups.has(groupRef)) {
            return resolved.allAttributeGroups.get(groupRef)!
        }

        // Try without namespace prefix
        const localName = groupRef.includes(':')
            ? groupRef.split(':')[1]
            : groupRef

        for (const [name, group] of resolved.allAttributeGroups) {
            if (name === localName || name.endsWith(`:${localName}`)) {
                return group
            }
        }

        return null
    }

    /**
     * Resolve a group reference
     */
    resolveGroup(
        groupRef: string,
        resolved: ResolvedSchema
    ): XSDGroup | null {
        if (!groupRef) return null
        
        if (resolved.allGroups.has(groupRef)) {
            return resolved.allGroups.get(groupRef)!
        }

        // Try without namespace prefix
        const localName = groupRef.includes(':')
            ? groupRef.split(':')[1]
            : groupRef

        for (const [name, group] of resolved.allGroups) {
            if (name === localName || name.endsWith(`:${localName}`)) {
                return group
            }
        }

        return null
    }

    /**
     * Resolve an element reference
     */
    resolveElement(
        elemRef: string,
        resolved: ResolvedSchema
    ): XSDElement | null {
        if (resolved.allElements.has(elemRef)) {
            return resolved.allElements.get(elemRef)!
        }

        // Try without namespace prefix
        const localName = elemRef.includes(':')
            ? elemRef.split(':')[1]
            : elemRef

        for (const [name, elem] of resolved.allElements) {
            if (name === localName || name.endsWith(`:${localName}`)) {
                return elem
            }
        }

        return null
    }
}
