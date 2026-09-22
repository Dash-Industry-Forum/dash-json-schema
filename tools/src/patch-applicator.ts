/**
 * JSON MPD Patch Applicator
 *
 * Applies a JSON patch document to a JSON MPD, evaluating selectors directly
 * against the JSON object model per Section 12 of the spec.
 *
 * Implements:
 * - Selector parsing and evaluation (12.3)
 * - add, remove, replace operations (12.4)
 * - Type coercion for predicates (12.3.5)
 * - Payload type coercion (12.5)
 * - Unsupported construct rejection (12.3.8, 12.6)
 */

import * as fs from 'fs'
import { SchemaAnalyzer } from './schema-analyzer'

export interface PatchResult {
    success: boolean
    mpd: Record<string, unknown>
    errors: string[]
    operationsApplied: number
}

interface SelectorStep {
    name: string
    isAttribute: boolean
    predicate?: PositionalPredicate | AttributePredicate | ValuePredicate
}

interface PositionalPredicate {
    type: 'positional'
    index: number // 1-based XPath index
}

interface AttributePredicate {
    type: 'attribute'
    name: string
    value: string
}

interface ValuePredicate {
    type: 'value'
    value: string
}

const UNSUPPORTED_PATTERNS = [
    /text\s*\(\s*\)/,
    /comment\s*\(\s*\)/,
    /processing-instruction\s*\(/,
    /namespace\s*::/,
    /\.\./,           // parent axis
    /\*/,             // wildcard (but not inside quotes)
    /\bid\s*\(/,      // id() function
]

export class PatchApplicator {
    private schemaAnalyzer: SchemaAnalyzer | null = null

    constructor(schemaPath?: string) {
        if (schemaPath && fs.existsSync(schemaPath)) {
            this.schemaAnalyzer = new SchemaAnalyzer(schemaPath)
        }
    }

    /**
     * Apply a JSON patch document to a JSON MPD.
     * Returns a deep copy of the MPD with all operations applied.
     */
    apply(
        mpd: Record<string, unknown>,
        patch: {
            operations: Array<{
                add?: Record<string, unknown>
                remove?: Record<string, unknown>
                replace?: Record<string, unknown>
            }>
        }
    ): PatchResult {
        // Deep copy the MPD
        const result = JSON.parse(JSON.stringify(mpd)) as Record<string, unknown>
        const errors: string[] = []
        let operationsApplied = 0

        // Validate all selectors before applying any operations (atomic)
        for (let i = 0; i < patch.operations.length; i++) {
            const op = patch.operations[i]
            const sel = this.getSelector(op)
            if (sel) {
                const validationError = this.validateSelector(sel)
                if (validationError) {
                    return {
                        success: false,
                        mpd: result,
                        errors: [`Operation ${i}: ${validationError}`],
                        operationsApplied: 0,
                    }
                }
            }
        }

        // Apply operations in order
        for (let i = 0; i < patch.operations.length; i++) {
            const op = patch.operations[i]
            try {
                if (op.add) {
                    this.applyAdd(result, op.add)
                } else if (op.remove) {
                    this.applyRemove(result, op.remove)
                } else if (op.replace) {
                    this.applyReplace(result, op.replace)
                } else {
                    errors.push(`Operation ${i}: Unknown operation type`)
                    return { success: false, mpd: result, errors, operationsApplied }
                }
                operationsApplied++
            } catch (e: any) {
                errors.push(`Operation ${i}: ${e.message}`)
                return { success: false, mpd: result, errors, operationsApplied }
            }
        }

        return { success: true, mpd: result, errors: [], operationsApplied }
    }

    private getSelector(op: Record<string, unknown>): string | null {
        for (const key of ['add', 'remove', 'replace']) {
            const inner = op[key] as Record<string, unknown> | undefined
            if (inner?.sel) return inner.sel as string
        }
        return null
    }

    /**
     * Validate a selector against the supported subset.
     * Returns an error message or null if valid.
     */
    private validateSelector(sel: string): string | null {
        if (!sel.startsWith('/MPD')) {
            return `Selector must begin with /MPD: "${sel}"`
        }

        // Check for unsupported constructs (but be careful not to match inside quoted predicates)
        const unquoted = sel.replace(/\[[^\]]*\]/g, '') // strip predicates for pattern check
        for (const pattern of UNSUPPORTED_PATTERNS) {
            if (pattern.test(unquoted)) {
                return `Unsupported selector construct in: "${sel}"`
            }
        }

        return null
    }

    /**
     * Parse a selector string into steps.
     */
    private parseSelector(sel: string): SelectorStep[] {
        const steps: SelectorStep[] = []

        // Remove leading /MPD
        let path = sel
        if (path.startsWith('/MPD')) {
            path = path.slice(4)
        }
        if (path.startsWith('/')) {
            path = path.slice(1)
        }
        if (!path) return steps

        // Tokenize by splitting on `/` but not inside `[]`
        const tokens: string[] = []
        let current = ''
        let bracketDepth = 0
        for (const ch of path) {
            if (ch === '[') bracketDepth++
            if (ch === ']') bracketDepth--
            if (ch === '/' && bracketDepth === 0) {
                if (current) tokens.push(current)
                current = ''
            } else {
                current += ch
            }
        }
        if (current) tokens.push(current)

        for (const token of tokens) {
            const isAttribute = token.startsWith('@')
            const cleanToken = isAttribute ? token.slice(1) : token

            // Parse predicate
            const predMatch = cleanToken.match(/^([^\[]+)(\[.+\])$/)
            if (predMatch) {
                const name = predMatch[1]
                const predStr = predMatch[2]
                steps.push({
                    name,
                    isAttribute: false,
                    predicate: this.parsePredicate(predStr),
                })
            } else {
                steps.push({
                    name: cleanToken,
                    isAttribute,
                })
            }
        }

        return steps
    }

    private parsePredicate(pred: string): PositionalPredicate | AttributePredicate | ValuePredicate {
        // Remove outer brackets
        const inner = pred.slice(1, -1)

        // Numeric positional: [1], [2], etc.
        if (/^\d+$/.test(inner)) {
            return { type: 'positional', index: parseInt(inner, 10) }
        }

        // Attribute predicate: [@id='value'] or [@id="value"]
        const attrMatch = inner.match(/^@(\w+)\s*=\s*['"](.*)['"]$/)
        if (attrMatch) {
            return { type: 'attribute', name: attrMatch[1], value: attrMatch[2] }
        }

        // Value predicate: [.='value'] or [.="value"]
        const valMatch = inner.match(/^\.\s*=\s*['"](.*)['"]$/)
        if (valMatch) {
            return { type: 'value', value: valMatch[1] }
        }

        throw new Error(`Unsupported predicate: ${pred}`)
    }

    /**
     * Resolve a selector to the target location.
     * Returns { parent, key, target } where:
     * - parent is the containing object
     * - key is the property name or array index
     * - target is the resolved value
     */
    private resolve(
        mpd: Record<string, unknown>,
        sel: string
    ): { parent: any; key: string | number; target: any } {
        const steps = this.parseSelector(sel)
        let current: any = mpd
        let parent: any = null
        let key: string | number = ''

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i]

            if (step.isAttribute) {
                // Terminal attribute step
                parent = current
                key = step.name
                current = current[step.name]
                break
            }

            const propValue = current[step.name]

            if (step.predicate) {
                // Must be an array
                if (!Array.isArray(propValue)) {
                    throw new Error(
                        `Selector step "${step.name}" with predicate requires an array, ` +
                        `but found ${typeof propValue}`
                    )
                }

                const idx = this.resolveArrayPredicate(propValue, step.name, step.predicate)
                if (idx < 0 || idx >= propValue.length) {
                    throw new Error(
                        `No match for predicate on "${step.name}": ${JSON.stringify(step.predicate)}`
                    )
                }

                parent = propValue
                key = idx
                current = propValue[idx]
            } else {
                parent = current
                key = step.name
                current = propValue
            }

            if (current === undefined && i < steps.length - 1) {
                throw new Error(`Cannot resolve selector: "${step.name}" not found`)
            }
        }

        return { parent, key, target: current }
    }

    /**
     * Resolve an array predicate to a 0-based index.
     */
    private resolveArrayPredicate(
        array: unknown[],
        elementName: string,
        predicate: PositionalPredicate | AttributePredicate | ValuePredicate
    ): number {
        switch (predicate.type) {
            case 'positional':
                return predicate.index - 1 // 1-based to 0-based

            case 'attribute': {
                const { name, value } = predicate
                return array.findIndex((item: any) => {
                    if (typeof item !== 'object' || item === null) return false
                    const propVal = item[name]
                    // Type-coerced comparison (Section 12.3.5)
                    return this.predicateMatch(propVal, value, elementName, name)
                })
            }

            case 'value': {
                return array.findIndex((item: any) => {
                    if (typeof item === 'string') return item === predicate.value
                    if (typeof item === 'object' && item !== null && '$value' in item) {
                        return String(item.$value) === predicate.value
                    }
                    return false
                })
            }
        }
    }

    /**
     * Compare a JSON property value against an XPath predicate string value
     * with type coercion per Section 12.3.5.
     */
    private predicateMatch(
        jsonValue: unknown,
        xpathValue: string,
        elementName: string,
        attrName: string
    ): boolean {
        if (jsonValue === undefined || jsonValue === null) return false

        // Try schema-based type coercion
        if (this.schemaAnalyzer) {
            const typeInfo = this.schemaAnalyzer.getAttributeType(attrName, elementName)
            if (typeInfo) {
                switch (typeInfo.jsonType) {
                    case 'integer': {
                        const parsed = parseInt(xpathValue, 10)
                        if (!isNaN(parsed)) return jsonValue === parsed
                        break
                    }
                    case 'number': {
                        const parsed = parseFloat(xpathValue)
                        if (!isNaN(parsed)) return jsonValue === parsed
                        break
                    }
                    case 'boolean':
                        return jsonValue === (xpathValue === 'true' || xpathValue === '1')
                }
            }
        }

        // Fallback: try both string and numeric comparison
        if (String(jsonValue) === xpathValue) return true
        if (typeof jsonValue === 'number' && !isNaN(Number(xpathValue))) {
            return jsonValue === Number(xpathValue)
        }
        return false
    }

    /**
     * Apply an `add` operation.
     */
    private applyAdd(mpd: Record<string, unknown>, op: Record<string, unknown>): void {
        const sel = op.sel as string
        const pos = op.pos as string | undefined
        const type = op.type as string | undefined

        const { parent, key, target } = this.resolve(mpd, sel)

        // Adding an attribute
        if (type && type.startsWith('@')) {
            const attrName = type.slice(1)
            const value = this.coercePayloadValue(op.$value, attrName, sel)
            if (typeof target === 'object' && target !== null) {
                target[attrName] = value
            } else {
                // sel points to root or a resolved element
                const resolved = this.resolve(mpd, sel)
                resolved.target[attrName] = value
            }
            return
        }

        // Adding an element — find the payload
        const payload = this.findElementPayload(op)
        if (!payload) {
            // Adding $value to the target (simpleContent)
            if ('$value' in op) {
                if (typeof target === 'object' && target !== null) {
                    (target as any).$value = op.$value
                }
            }
            return
        }

        const { elementName, elementValue } = payload

        if (pos === 'prepend') {
            // Insert at beginning of target's array for this element
            const arr = target[elementName]
            if (Array.isArray(arr)) {
                if (Array.isArray(elementValue)) {
                    arr.unshift(...elementValue)
                } else {
                    arr.unshift(elementValue)
                }
            } else {
                // Target doesn't have this array yet — create it
                target[elementName] = Array.isArray(elementValue) ? elementValue : [elementValue]
            }
        } else if (pos === 'before' || pos === 'after') {
            // sel targets a sibling element
            if (!Array.isArray(parent)) {
                throw new Error(`"${pos}" requires sel to target an array element`)
            }
            const idx = key as number
            const insertIdx = pos === 'before' ? idx : idx + 1
            if (Array.isArray(elementValue)) {
                parent.splice(insertIdx, 0, ...elementValue)
            } else {
                parent.splice(insertIdx, 0, elementValue)
            }
        } else {
            // No pos — append to array
            const arr = target[elementName]
            if (Array.isArray(arr)) {
                if (Array.isArray(elementValue)) {
                    arr.push(...elementValue)
                } else {
                    arr.push(elementValue)
                }
            } else if (arr === undefined) {
                // Create new array or set singleton
                const isArray = this.schemaAnalyzer?.isArrayElement(elementName)
                if (isArray) {
                    target[elementName] = Array.isArray(elementValue) ? elementValue : [elementValue]
                } else {
                    target[elementName] = elementValue
                }
            } else {
                // Existing singleton — replace or error
                target[elementName] = elementValue
            }
        }
    }

    /**
     * Apply a `remove` operation.
     */
    private applyRemove(mpd: Record<string, unknown>, op: Record<string, unknown>): void {
        const sel = op.sel as string
        const { parent, key } = this.resolve(mpd, sel)

        if (Array.isArray(parent)) {
            // Remove from array
            parent.splice(key as number, 1)
        } else if (typeof parent === 'object' && parent !== null) {
            // Remove property
            delete parent[key as string]
        } else {
            throw new Error(`Cannot remove: parent is ${typeof parent}`)
        }
    }

    /**
     * Apply a `replace` operation.
     */
    private applyReplace(mpd: Record<string, unknown>, op: Record<string, unknown>): void {
        const sel = op.sel as string
        const { parent, key, target } = this.resolve(mpd, sel)

        // Check for element payload
        const payload = this.findElementPayload(op)

        if (payload) {
            // Replace entire element
            if (Array.isArray(parent)) {
                parent[key as number] = payload.elementValue
            } else {
                parent[key as string] = payload.elementValue
            }
            return
        }

        // Replace with $value
        if ('$value' in op) {
            const steps = this.parseSelector(sel)
            const lastStep = steps[steps.length - 1]

            if (lastStep?.isAttribute) {
                // Replacing an attribute value
                const coerced = this.coercePayloadValue(op.$value, lastStep.name, sel)
                parent[key as string] = coerced
            } else if (typeof target === 'object' && target !== null && '$value' in target) {
                // Replacing simpleContent text
                target.$value = op.$value
            } else if (typeof target === 'object' && target !== null) {
                // Replacing simpleContent text on an object that should have $value
                // Check if this element has simpleContent
                const elementName = typeof key === 'string' ? key : lastStep?.name
                if (elementName && this.schemaAnalyzer?.hasSimpleContent(elementName)) {
                    target.$value = op.$value
                } else {
                    // Set $value anyway if replacing text
                    target.$value = op.$value
                }
            } else {
                // Replace primitive directly
                parent[key as string] = op.$value
            }
        }
    }

    /**
     * Find element payload in an operation object.
     * Skips known operation properties (sel, pos, type, $value, ws).
     */
    private findElementPayload(
        op: Record<string, unknown>
    ): { elementName: string; elementValue: unknown } | null {
        const reserved = new Set(['sel', 'pos', 'type', '$value', 'ws'])
        for (const [k, v] of Object.entries(op)) {
            if (!reserved.has(k)) {
                return { elementName: k, elementValue: v }
            }
        }
        return null
    }

    /**
     * Coerce a payload value to the target property's JSON Schema type.
     */
    private coercePayloadValue(value: unknown, attrName: string, sel: string): unknown {
        if (value === undefined || value === null) return value

        // If already the right type, return as-is
        if (typeof value !== 'string') return value

        if (!this.schemaAnalyzer) return value

        // Find the parent element to look up type
        const parentElement = this.lastElementNameFromSel(sel)
        const typeInfo = this.schemaAnalyzer.getAttributeType(attrName, parentElement || undefined)
        if (!typeInfo) return value

        const strValue = value as string
        switch (typeInfo.jsonType) {
            case 'integer': {
                const parsed = parseInt(strValue, 10)
                return isNaN(parsed) ? strValue : parsed
            }
            case 'number': {
                const parsed = parseFloat(strValue)
                return isNaN(parsed) ? strValue : parsed
            }
            case 'boolean':
                return strValue === 'true' || strValue === '1'
            default:
                return strValue
        }
    }

    private lastElementNameFromSel(sel: string): string | null {
        const steps = this.parseSelector(sel)
        for (let i = steps.length - 1; i >= 0; i--) {
            if (!steps[i].isAttribute) return steps[i].name
        }
        return null
    }
}
