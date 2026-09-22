/**
 * MPD Round-Trip Validator
 * 
 * Validates that an MPD can be converted to JSON and back to MPD
 * with the two MPD files being semantically identical.
 * 
 * Pipeline: MPD -> JSON -> MPD (and compare)
 */

import * as fs from 'fs'
import * as path from 'path'
import { MPDConverter, ConversionResult as MpdConversionResult, MPDConverterConfig } from './mpd-converter'
import { JsonToXmlConverter, JsonToXmlConfig, ConversionResult as JsonConversionResult } from './json-to-xml-converter'
import { XmlNormalizer, ComparisonResult, XmlNormalizerConfig } from './xml-normalizer'

export interface RoundTripConfig {
    /** MPD converter config */
    mpdConverterConfig?: Partial<MPDConverterConfig>
    /** JSON to XML converter config */
    jsonToXmlConfig?: Partial<JsonToXmlConfig>
    /** XML normalizer config for comparison */
    normalizerConfig?: Partial<XmlNormalizerConfig>
    /** Skip XSD validation (for faster testing) */
    skipXsdValidation?: boolean
    /** Skip JSON Schema validation (for faster testing) */
    skipJsonSchemaValidation?: boolean
    /** Verbose output */
    verbose?: boolean
}

export interface RoundTripResult {
    success: boolean
    /** The original MPD XML */
    originalMpd?: string
    /** The intermediate JSON representation */
    json?: Record<string, unknown>
    /** The regenerated MPD XML */
    regeneratedMpd?: string
    /** Comparison result between original and regenerated */
    comparison?: ComparisonResult
    /** Errors during MPD to JSON conversion */
    mpdToJsonErrors?: string[]
    /** Errors during JSON to MPD conversion */
    jsonToMpdErrors?: string[]
    /** General error message */
    error?: string
    /** Timing information */
    timing?: {
        mpdToJson: number
        jsonToMpd: number
        comparison: number
        total: number
    }
}

const DEFAULT_CONFIG: RoundTripConfig = {
    skipXsdValidation: false,
    skipJsonSchemaValidation: false,
    verbose: false,
}

/**
 * MPD Round-Trip Validator class
 * 
 * Validates round-trip conversion: MPD -> JSON -> MPD
 */
export class RoundTripValidator {
    private config: RoundTripConfig
    private mpdConverter: MPDConverter
    private jsonToXmlConverter: JsonToXmlConverter
    private normalizer: XmlNormalizer

    constructor(config: Partial<RoundTripConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
        
        // Initialize converters with appropriate settings
        this.mpdConverter = new MPDConverter({
            skipXsdValidation: this.config.skipXsdValidation,
            skipJsonSchemaValidation: this.config.skipJsonSchemaValidation,
            ...this.config.mpdConverterConfig,
        })

        this.jsonToXmlConverter = new JsonToXmlConverter({
            skipXsdValidation: this.config.skipXsdValidation,
            skipJsonSchemaValidation: this.config.skipJsonSchemaValidation,
            ...this.config.jsonToXmlConfig,
        })

        this.normalizer = new XmlNormalizer(this.config.normalizerConfig)
    }

    /**
     * Validate round-trip conversion for an MPD file
     */
    validateFile(mpdPath: string): RoundTripResult {
        const absolutePath = path.resolve(mpdPath)
        
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `MPD file not found: ${absolutePath}`
            }
        }

        const mpdContent = fs.readFileSync(absolutePath, 'utf-8')
        return this.validate(mpdContent)
    }

    /**
     * Validate round-trip conversion for an MPD string
     */
    validate(mpdContent: string): RoundTripResult {
        const startTime = Date.now()
        const timing = {
            mpdToJson: 0,
            jsonToMpd: 0,
            comparison: 0,
            total: 0,
        }

        try {
            // Step 1: Convert MPD to JSON
            const mpdToJsonStart = Date.now()
            const mpdResult = this.mpdConverter.convert(mpdContent)
            timing.mpdToJson = Date.now() - mpdToJsonStart

            if (!mpdResult.success || !mpdResult.json) {
                return {
                    success: false,
                    originalMpd: mpdContent,
                    mpdToJsonErrors: mpdResult.xsdErrors || mpdResult.jsonSchemaErrors,
                    error: mpdResult.error || 'MPD to JSON conversion failed',
                    timing: { ...timing, total: Date.now() - startTime },
                }
            }

            if (this.config.verbose) {
                console.error('MPD -> JSON conversion successful')
            }

            // Step 2: Convert JSON back to MPD
            const jsonToMpdStart = Date.now()
            const jsonResult = this.jsonToXmlConverter.convertWithValidation(mpdResult.json)
            timing.jsonToMpd = Date.now() - jsonToMpdStart

            if (!jsonResult.success || !jsonResult.xml) {
                return {
                    success: false,
                    originalMpd: mpdContent,
                    json: mpdResult.json,
                    jsonToMpdErrors: jsonResult.xsdErrors || jsonResult.jsonSchemaErrors,
                    error: jsonResult.error || 'JSON to MPD conversion failed',
                    timing: { ...timing, total: Date.now() - startTime },
                }
            }

            if (this.config.verbose) {
                console.error('JSON -> MPD conversion successful')
            }

            // Step 3: Compare original and regenerated MPD
            const comparisonStart = Date.now()
            const comparison = this.normalizer.compare(mpdContent, jsonResult.xml)
            timing.comparison = Date.now() - comparisonStart
            timing.total = Date.now() - startTime

            if (this.config.verbose) {
                console.error(`Comparison: ${comparison.equal ? 'MATCH' : 'MISMATCH'}`)
            }

            return {
                success: comparison.equal,
                originalMpd: mpdContent,
                json: mpdResult.json,
                regeneratedMpd: jsonResult.xml,
                comparison,
                timing,
            }
        } catch (err) {
            return {
                success: false,
                originalMpd: mpdContent,
                error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
                timing: { ...timing, total: Date.now() - startTime },
            }
        }
    }

    /**
     * Validate multiple MPD files and return a summary
     */
    validateFiles(mpdPaths: string[]): BatchValidationResult {
        const results: Map<string, RoundTripResult> = new Map()
        let passed = 0
        let failed = 0
        const failures: string[] = []

        for (const mpdPath of mpdPaths) {
            const result = this.validateFile(mpdPath)
            results.set(mpdPath, result)

            if (result.success) {
                passed++
            } else {
                failed++
                failures.push(mpdPath)
            }

            if (this.config.verbose) {
                const status = result.success ? 'PASS' : 'FAIL'
                console.error(`${status}: ${mpdPath}`)
                if (!result.success && result.error) {
                    console.error(`  Error: ${result.error}`)
                }
            }
        }

        return {
            total: mpdPaths.length,
            passed,
            failed,
            failures,
            results,
        }
    }

    /**
     * Get the intermediate JSON for an MPD (for debugging)
     */
    getIntermediateJson(mpdContent: string): MpdConversionResult {
        return this.mpdConverter.convert(mpdContent)
    }

    /**
     * Get the regenerated MPD from JSON (for debugging)
     */
    getRegeneratedMpd(json: Record<string, unknown>): JsonConversionResult {
        return this.jsonToXmlConverter.convertWithValidation(json)
    }

    /**
     * Compare two MPD files directly
     */
    compareMpdFiles(mpdPath1: string, mpdPath2: string): ComparisonResult {
        const mpd1 = fs.readFileSync(path.resolve(mpdPath1), 'utf-8')
        const mpd2 = fs.readFileSync(path.resolve(mpdPath2), 'utf-8')
        return this.normalizer.compare(mpd1, mpd2)
    }

    /**
     * Compare two MPD strings directly
     */
    compareMpd(mpd1: string, mpd2: string): ComparisonResult {
        return this.normalizer.compare(mpd1, mpd2)
    }
}

export interface BatchValidationResult {
    total: number
    passed: number
    failed: number
    failures: string[]
    results: Map<string, RoundTripResult>
}

/**
 * Convenience function for round-trip validation
 */
export function validateRoundTrip(mpdContent: string, config?: Partial<RoundTripConfig>): RoundTripResult {
    const validator = new RoundTripValidator(config)
    return validator.validate(mpdContent)
}

/**
 * Convenience function for round-trip validation of a file
 */
export function validateRoundTripFile(mpdPath: string, config?: Partial<RoundTripConfig>): RoundTripResult {
    const validator = new RoundTripValidator(config)
    return validator.validateFile(mpdPath)
}

/**
 * Convenience function for batch validation
 */
export function validateRoundTripFiles(mpdPaths: string[], config?: Partial<RoundTripConfig>): BatchValidationResult {
    const validator = new RoundTripValidator(config)
    return validator.validateFiles(mpdPaths)
}

export default RoundTripValidator
