/**
 * XML Normalizer for DASH MPD
 * 
 * Normalizes XML documents to enable semantic comparison between two XML files.
 * This handles differences in:
 * - Whitespace and indentation
 * - Attribute ordering
 * - Empty elements (self-closing vs explicit close tags)
 * - Numeric precision for equivalent values
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser'

export interface XmlNormalizerConfig {
    /** Sort attributes alphabetically */
    sortAttributes?: boolean
    /** Normalize whitespace in text content */
    normalizeWhitespace?: boolean
    /** Normalize numeric values (remove trailing zeros, etc.) */
    normalizeNumbers?: boolean
    /** Remove XML comments */
    removeComments?: boolean
    /** Remove xsi: namespace attributes (schemaLocation, etc.) */
    removeXsiAttributes?: boolean
    /** Normalize boolean values (0/1 to false/true) */
    normalizeBooleans?: boolean
    /** Remove xmlns declarations (they're semantically equivalent regardless of location) */
    removeXmlnsDeclarations?: boolean
}

const DEFAULT_CONFIG: XmlNormalizerConfig = {
    sortAttributes: true,
    normalizeWhitespace: true,
    normalizeNumbers: true,
    removeComments: true,
    removeXsiAttributes: true,
    normalizeBooleans: true,
    removeXmlnsDeclarations: true,
}

/**
 * XML Normalizer class
 * 
 * Normalizes XML documents to a canonical form for comparison.
 */
export class XmlNormalizer {
    private config: XmlNormalizerConfig

    constructor(config: Partial<XmlNormalizerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
    }

    /**
     * Normalize an XML string to canonical form
     */
    normalize(xml: string): string {
        // Parse the XML
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            preserveOrder: false,
            commentPropName: this.config.removeComments ? undefined : '#comment',
            trimValues: true,
            parseAttributeValue: false,
            parseTagValue: false,
        })

        const parsed = parser.parse(xml)
        
        // Normalize the parsed structure
        const normalized = this.normalizeNode(parsed)
        
        // Build the normalized XML with sorted attributes
        const builder = new XMLBuilder({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            format: true,
            indentBy: '  ',
            suppressEmptyNode: false,
            suppressBooleanAttributes: false,
        })

        let result = builder.build(normalized) as string
        
        // Ensure consistent line endings
        result = result.replace(/\r\n/g, '\n').trim()
        
        // Add XML declaration if not present
        if (!result.startsWith('<?xml')) {
            result = '<?xml version="1.0" encoding="UTF-8"?>\n' + result
        }
        
        return result
    }

    /**
     * Compare two XML strings for semantic equality
     * Returns true if they are semantically equivalent
     */
    compare(xml1: string, xml2: string): ComparisonResult {
        const norm1 = this.normalize(xml1)
        const norm2 = this.normalize(xml2)
        
        if (norm1 === norm2) {
            return { equal: true }
        }
        
        // Find differences for reporting
        const differences = this.findDifferences(norm1, norm2)
        
        return {
            equal: false,
            differences,
            normalizedXml1: norm1,
            normalizedXml2: norm2,
        }
    }

    /**
     * Recursively normalize a parsed XML node
     */
    private normalizeNode(node: unknown): unknown {
        if (Array.isArray(node)) {
            return node.map(item => this.normalizeNode(item))
        }

        if (typeof node !== 'object' || node === null) {
            return this.normalizeValue(node)
        }

        const obj = node as Record<string, unknown>
        const result: Record<string, unknown> = {}

        // Separate attributes from elements
        const attributes: Array<[string, unknown]> = []
        const elements: Array<[string, unknown]> = []

        for (const [key, value] of Object.entries(obj)) {
            // Skip comments if configured
            if (this.config.removeComments && key === '#comment') {
                continue
            }

            // Skip xsi: attributes if configured
            if (this.config.removeXsiAttributes && (key.includes('xsi:') || key.includes('xmlns:xsi'))) {
                continue
            }

            // Skip xmlns declarations if configured (they're semantically equivalent)
            if (this.config.removeXmlnsDeclarations && (key.startsWith('@_xmlns') || key === 'xmlns')) {
                continue
            }

            if (key.startsWith('@_')) {
                // This is an attribute
                const normalizedValue = this.normalizeAttributeValue(key, value)
                attributes.push([key, normalizedValue])
            } else if (key === '#text') {
                // Text content
                const normalized = this.normalizeTextContent(value)
                if (normalized !== '' && normalized !== undefined) {
                    result[key] = normalized
                }
            } else if (key === '?xml') {
                // XML declaration - skip or preserve
                // We'll add our own declaration
                continue
            } else {
                // Child element
                elements.push([key, this.normalizeNode(value)])
            }
        }

        // Sort attributes if configured
        if (this.config.sortAttributes) {
            attributes.sort((a, b) => this.attributeComparator(a[0], b[0]))
        }

        // Add attributes first (sorted)
        for (const [key, value] of attributes) {
            result[key] = value
        }

        // Add elements in their original order
        for (const [key, value] of elements) {
            result[key] = value
        }

        return result
    }

    /**
     * Comparator for sorting attributes
     * Puts xmlns declarations first, then other attributes alphabetically
     */
    private attributeComparator(a: string, b: string): number {
        const aIsXmlns = a.includes('xmlns')
        const bIsXmlns = b.includes('xmlns')
        
        if (aIsXmlns && !bIsXmlns) return -1
        if (!aIsXmlns && bIsXmlns) return 1
        
        return a.localeCompare(b)
    }

    /**
     * Normalize an attribute value
     */
    private normalizeAttributeValue(key: string, value: unknown): unknown {
        if (typeof value !== 'string') {
            return value
        }

        let normalized = value

        // Normalize whitespace
        if (this.config.normalizeWhitespace) {
            normalized = normalized.trim()
        }

        // Normalize booleans (0/1 to false/true)
        if (this.config.normalizeBooleans && this.isBooleanAttribute(key)) {
            normalized = this.normalizeBooleanValue(normalized)
        }

        // Normalize numbers
        if (this.config.normalizeNumbers && this.isNumericAttribute(key)) {
            normalized = this.normalizeNumericValue(normalized)
        }

        return normalized
    }

    /**
     * Check if an attribute typically contains boolean values
     */
    private isBooleanAttribute(key: string): boolean {
        const booleanAttrs = new Set([
            '@_segmentAlignment', '@_subsegmentAlignment', '@_bitstreamSwitching',
            '@_audioPlaybackCapability', '@_videoPlaybackCapability',
        ])
        
        return booleanAttrs.has(key)
    }

    /**
     * Normalize a boolean value (0/1/true/false -> true/false)
     */
    private normalizeBooleanValue(value: string): string {
        if (value === '0' || value === 'false') {
            return 'false'
        }
        if (value === '1' || value === 'true') {
            return 'true'
        }
        return value
    }

    /**
     * Normalize text content
     */
    private normalizeTextContent(value: unknown): string | undefined {
        if (value === null || value === undefined) {
            return undefined
        }

        let text = String(value)

        if (this.config.normalizeWhitespace) {
            // Normalize internal whitespace (collapse multiple spaces to one)
            text = text.replace(/\s+/g, ' ').trim()
        }

        return text === '' ? undefined : text
    }

    /**
     * Normalize a generic value
     */
    private normalizeValue(value: unknown): unknown {
        if (typeof value === 'string') {
            return this.config.normalizeWhitespace ? value.trim() : value
        }
        return value
    }

    /**
     * Check if an attribute typically contains numeric values
     */
    private isNumericAttribute(key: string): boolean {
        const numericAttrs = new Set([
            '@_bandwidth', '@_width', '@_height', '@_startNumber', '@_timescale',
            '@_presentationTimeOffset', '@_duration', '@_d', '@_t', '@_r', '@_n', '@_k',
            '@_availabilityTimeOffset', '@_minWidth', '@_maxWidth', '@_minHeight', '@_maxHeight',
            '@_minBandwidth', '@_maxBandwidth', '@_qualityRanking', '@_selectionPriority',
            '@_maximumSAPPeriod', '@_startWithSAP', '@_subsegmentStartsWithSAP',
        ])
        
        return numericAttrs.has(key)
    }

    /**
     * Normalize a numeric string value
     * Handles cases like "1.0" vs "1" or "1.500" vs "1.5"
     */
    private normalizeNumericValue(value: string): string {
        // Try to parse as number
        const num = parseFloat(value)
        if (isNaN(num)) {
            return value
        }

        // For integers, return as integer string
        if (Number.isInteger(num)) {
            return String(Math.round(num))
        }

        // For floats, normalize precision (remove trailing zeros)
        return String(num)
    }

    /**
     * Find differences between two normalized XML strings
     */
    private findDifferences(xml1: string, xml2: string): string[] {
        const lines1 = xml1.split('\n')
        const lines2 = xml2.split('\n')
        const differences: string[] = []

        const maxLines = Math.max(lines1.length, lines2.length)
        for (let i = 0; i < maxLines; i++) {
            const line1 = lines1[i] || '<missing>'
            const line2 = lines2[i] || '<missing>'
            
            if (line1 !== line2) {
                differences.push(`Line ${i + 1}:`)
                differences.push(`  - ${line1}`)
                differences.push(`  + ${line2}`)
            }
        }

        // Limit to first 20 differences
        if (differences.length > 60) {
            return [...differences.slice(0, 60), `... and ${Math.floor((differences.length - 60) / 3)} more differences`]
        }

        return differences
    }
}

export interface ComparisonResult {
    equal: boolean
    differences?: string[]
    normalizedXml1?: string
    normalizedXml2?: string
}

/**
 * Convenience function for comparing two XML strings
 */
export function compareXml(xml1: string, xml2: string, config?: Partial<XmlNormalizerConfig>): ComparisonResult {
    const normalizer = new XmlNormalizer(config)
    return normalizer.compare(xml1, xml2)
}

/**
 * Convenience function for normalizing an XML string
 */
export function normalizeXml(xml: string, config?: Partial<XmlNormalizerConfig>): string {
    const normalizer = new XmlNormalizer(config)
    return normalizer.normalize(xml)
}

export default XmlNormalizer
