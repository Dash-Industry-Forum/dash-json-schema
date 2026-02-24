/**
 * XML Patch to JSON Patch Converter
 *
 * Converts an RFC 5261 XML patch document (DASH-MPD-PATCH.xsd) into the
 * JSON-only patch format defined in the spec (Section 12).
 *
 * The converter:
 * - Parses the XML patch using fast-xml-parser
 * - Translates each <add>, <remove>, <replace> operation
 * - Converts XML fragment payloads into MPD JSON objects
 * - Outputs a JSON patch conforming to dash-mpd-patch.schema.json
 */

import { XMLParser } from 'fast-xml-parser'
import { MPDConverter } from './mpd-converter'
import { SchemaAnalyzer } from './schema-analyzer'
import * as fs from 'fs'
import * as path from 'path'

export interface JsonPatchOperation {
    add?: JsonAddOp
    remove?: JsonRemoveOp
    replace?: JsonReplaceOp
}

export interface JsonAddOp {
    sel: string
    pos?: 'before' | 'after' | 'prepend'
    type?: string
    $value?: unknown
    [key: string]: unknown
}

export interface JsonRemoveOp {
    sel: string
    ws?: 'before' | 'after' | 'both'
}

export interface JsonReplaceOp {
    sel: string
    $value?: unknown
    [key: string]: unknown
}

export interface JsonPatchDocument {
    mpdId: string
    publishTime: string
    originalPublishTime: string
    operations: JsonPatchOperation[]
}

/**
 * Convert an XML patch document to JSON patch format.
 */
export class PatchConverter {
    private xmlParser: XMLParser
    private mpdConverter: MPDConverter
    private schemaAnalyzer: SchemaAnalyzer

    constructor() {
        this.xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            allowBooleanAttributes: false,
            parseAttributeValue: false,
            trimValues: true,
            textNodeName: '#text',
            isArray: () => false,
            processEntities: true,
        })

        // Use MPDConverter for converting XML fragment payloads to JSON
        this.mpdConverter = new MPDConverter({
            skipXsdValidation: true,
            skipJsonSchemaValidation: true,
        })

        // Load schema for type info
        const schemaPath = path.join(__dirname, '..', 'output', 'dash-mpd.schema.json')
        if (fs.existsSync(schemaPath)) {
            this.schemaAnalyzer = new SchemaAnalyzer(schemaPath)
        } else {
            this.schemaAnalyzer = null as any
        }
    }

    /**
     * Convert an XML patch string to a JSON patch document.
     */
    convert(xmlPatch: string): JsonPatchDocument {
        const parsed = this.xmlParser.parse(xmlPatch)
        const patchNode = parsed['Patch'] || parsed['patch']
        if (!patchNode) {
            throw new Error('No <Patch> root element found in XML patch document')
        }

        const mpdId = patchNode['@_mpdId']
        const publishTime = patchNode['@_publishTime']
        const originalPublishTime = patchNode['@_originalPublishTime']

        if (!mpdId || !publishTime || !originalPublishTime) {
            throw new Error('Patch element missing required attributes: mpdId, publishTime, originalPublishTime')
        }

        const operations: JsonPatchOperation[] = []

        // Process operations in document order.
        // fast-xml-parser doesn't preserve sibling order across different tag names,
        // so we re-parse with a mode that preserves order.
        const orderedOps = this.parseOperationsInOrder(xmlPatch)
        for (const op of orderedOps) {
            operations.push(op)
        }

        return {
            mpdId,
            publishTime,
            originalPublishTime,
            operations,
        }
    }

    /**
     * Convert an XML patch file to a JSON patch document.
     */
    convertFile(filePath: string): JsonPatchDocument {
        const xml = fs.readFileSync(filePath, 'utf-8')
        return this.convert(xml)
    }

    /**
     * Parse patch operations preserving document order.
     * We use a regex-based approach to find operations in order since
     * fast-xml-parser doesn't guarantee sibling order across different tags.
     */
    private parseOperationsInOrder(xml: string): JsonPatchOperation[] {
        const operations: JsonPatchOperation[] = []

        // Extract the content inside the <Patch> element
        const patchMatch = xml.match(/<Patch[^>]*>([\s\S]*)<\/Patch>/)
        if (!patchMatch) return operations

        const patchContent = patchMatch[1]

        // Find all operations in order using regex for top-level elements
        const opRegex = /<(add|remove|replace)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g
        let match: RegExpExecArray | null

        while ((match = opRegex.exec(patchContent)) !== null) {
            const opType = match[1] as 'add' | 'remove' | 'replace'
            const attrsStr = match[2]
            const innerContent = match[3] || ''

            const attrs = this.parseAttributes(attrsStr)

            switch (opType) {
                case 'remove':
                    operations.push({ remove: this.convertRemove(attrs) })
                    break
                case 'replace':
                    operations.push({ replace: this.convertReplace(attrs, innerContent.trim()) })
                    break
                case 'add':
                    operations.push({ add: this.convertAdd(attrs, innerContent.trim()) })
                    break
            }
        }

        return operations
    }

    /**
     * Parse XML attributes from a string like ` sel="/MPD/@publishTime" pos="after"`.
     */
    private parseAttributes(attrsStr: string): Record<string, string> {
        const attrs: Record<string, string> = {}
        const attrRegex = /(\w+)\s*=\s*"([^"]*)"/g
        let match: RegExpExecArray | null
        while ((match = attrRegex.exec(attrsStr)) !== null) {
            attrs[match[1]] = this.decodeXmlEntities(match[2])
        }
        // Also handle single-quoted attributes
        const attrRegexSingle = /(\w+)\s*=\s*'([^']*)'/g
        while ((match = attrRegexSingle.exec(attrsStr)) !== null) {
            if (!attrs[match[1]]) {
                attrs[match[1]] = this.decodeXmlEntities(match[2])
            }
        }
        return attrs
    }

    private decodeXmlEntities(s: string): string {
        return s
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
    }

    /**
     * Convert a <remove> operation.
     */
    private convertRemove(attrs: Record<string, string>): JsonRemoveOp {
        const result: JsonRemoveOp = { sel: attrs['sel'] }
        if (attrs['ws']) {
            result.ws = attrs['ws'] as 'before' | 'after' | 'both'
        }
        return result
    }

    /**
     * Convert a <replace> operation.
     * - If the content is plain text, use $value.
     * - If the content is an XML element, convert it to JSON.
     */
    private convertReplace(attrs: Record<string, string>, content: string): JsonReplaceOp {
        const sel = attrs['sel']
        const result: JsonReplaceOp = { sel }

        if (!content) {
            // Empty replacement (clear text content)
            result.$value = ''
            return result
        }

        // Check if content is an XML element or plain text
        if (content.startsWith('<')) {
            // XML element payload — convert to JSON
            const elementJson = this.convertXmlFragmentToJson(content, sel)
            if (elementJson) {
                Object.assign(result, elementJson)
            } else {
                // Fallback: treat as text
                result.$value = content
            }
        } else {
            // Plain text — determine the target type and coerce
            result.$value = this.coerceValue(content, sel)
        }

        return result
    }

    /**
     * Convert an <add> operation.
     * - If type starts with @, it's adding an attribute.
     * - If there's an XML child element, convert to JSON.
     */
    private convertAdd(attrs: Record<string, string>, content: string): JsonAddOp {
        const sel = attrs['sel']
        const result: JsonAddOp = { sel }

        if (attrs['pos']) {
            result.pos = attrs['pos'] as 'before' | 'after' | 'prepend'
        }
        if (attrs['type']) {
            result.type = attrs['type']
        }

        if (!content) {
            return result
        }

        // Check if content is XML element or text
        if (content.startsWith('<')) {
            const elementJson = this.convertXmlFragmentToJson(content, sel)
            if (elementJson) {
                Object.assign(result, elementJson)
            } else {
                result.$value = content
            }
        } else {
            result.$value = this.coerceValue(content, sel)
        }

        return result
    }

    /**
     * Convert an XML fragment (like `<S t="123" d="456"/>`) to JSON.
     * Returns an object like { S: { t: 123, d: 456 } }.
     */
    private convertXmlFragmentToJson(xmlFragment: string, sel: string): Record<string, unknown> | null {
        try {
            // Parse the XML fragment
            const parsed = this.xmlParser.parse(xmlFragment)
            if (!parsed || typeof parsed !== 'object') return null

            // Get the element name
            const keys = Object.keys(parsed).filter(k => !k.startsWith('?'))
            if (keys.length === 0) return null

            const elementName = keys[0]
            const elementNode = parsed[elementName]

            // Convert element to JSON using schema info
            const jsonElement = this.convertElementToJson(elementName, elementNode, sel)
            return { [elementName]: jsonElement }
        } catch {
            return null
        }
    }

    /**
     * Convert a parsed XML element node to JSON form matching the MPD schema.
     */
    private convertElementToJson(
        elementName: string,
        node: any,
        sel: string
    ): unknown {
        if (node === null || node === undefined || node === '') {
            return {}
        }

        if (typeof node !== 'object') {
            // Simple text content
            return this.coerceElementValue(elementName, node, sel)
        }

        const result: Record<string, unknown> = {}

        // Determine the parent context from sel to look up types
        const parentType = this.guessParentType(sel, elementName)

        for (const [key, value] of Object.entries(node)) {
            if (key === '#text') {
                // Text content -> $value
                result['$value'] = String(value)
                continue
            }

            if (key.startsWith('@_')) {
                // Attribute
                const attrName = key.slice(2)
                result[attrName] = this.coerceAttributeValue(parentType, elementName, attrName, value)
                continue
            }

            // Child element — recursively convert
            const childJson = this.convertElementToJson(key, value, sel + '/' + elementName)
            result[key] = childJson
        }

        return result
    }

    /**
     * Coerce an attribute value to its JSON type based on schema info.
     */
    private coerceAttributeValue(
        _parentType: string | null,
        elementName: string,
        attrName: string,
        value: any
    ): unknown {
        if (!this.schemaAnalyzer) return value

        // Try to look up the type from the schema
        const typeInfo = this.schemaAnalyzer.getAttributeType(attrName, elementName)
        if (!typeInfo) return value

        const strValue = String(value)

        switch (typeInfo.jsonType) {
            case 'integer':
                const intVal = parseInt(strValue, 10)
                return isNaN(intVal) ? strValue : intVal
            case 'number':
                const numVal = parseFloat(strValue)
                return isNaN(numVal) ? strValue : numVal
            case 'boolean':
                return strValue === 'true' || strValue === '1'
            default:
                return strValue
        }
    }

    /**
     * Coerce a plain text value based on the selector target type.
     */
    private coerceValue(text: string, sel: string): unknown {
        if (!this.schemaAnalyzer) return text

        // If sel ends with @attr, look up the attribute type
        const attrMatch = sel.match(/@(\w+)$/)
        if (attrMatch) {
            const attrName = attrMatch[1]
            // Walk up to find the parent element
            const parentSel = sel.replace(/@\w+$/, '').replace(/\/$/, '')
            const parentElement = this.lastElementName(parentSel)
            if (parentElement) {
                const typeInfo = this.schemaAnalyzer.getAttributeType(attrName, parentElement)
                if (typeInfo) {
                    switch (typeInfo.jsonType) {
                        case 'integer':
                            const intVal = parseInt(text, 10)
                            return isNaN(intVal) ? text : intVal
                        case 'number':
                            const numVal = parseFloat(text)
                            return isNaN(numVal) ? text : numVal
                        case 'boolean':
                            return text === 'true' || text === '1'
                    }
                }
            }
        }

        return text
    }

    private coerceElementValue(_elementName: string, value: any, _sel: string): unknown {
        return String(value)
    }

    /**
     * Extract the last element name from a selector path.
     */
    private lastElementName(sel: string): string | null {
        const steps = sel.split('/').filter(Boolean)
        for (let i = steps.length - 1; i >= 0; i--) {
            const step = steps[i].replace(/\[.*\]/, '')
            if (step && step !== 'MPD' && !step.startsWith('@')) {
                return step
            }
        }
        return 'MPDtype'
    }

    /**
     * Guess the parent type name from the selector context.
     */
    private guessParentType(sel: string, _elementName: string): string | null {
        const parent = this.lastElementName(sel)
        return parent
    }
}
