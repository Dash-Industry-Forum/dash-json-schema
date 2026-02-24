/**
 * XSD to JSON Schema Converter
 * 
 * Converts XML Schema Definition (XSD) files to JSON Schema 2020-12 format.
 * Also provides MPD <-> JSON round-trip conversion and validation.
 */

// XSD to JSON Schema conversion
export { JSONSchemaGenerator } from './json-schema-generator'
export { XSDParser } from './xsd-parser'
export { TypeMapper } from './type-mapper'
export { SchemaResolver, ResolvedSchema } from './schema-resolver'
export { SchemaAnalyzer, TypeInfo } from './schema-analyzer'

// MPD to JSON conversion
export { MPDConverter, MPDConverterConfig, ConversionResult as MpdConversionResult } from './mpd-converter'

// JSON to MPD conversion
export { JsonToXmlConverter, JsonToXmlConfig, ConversionResult as JsonToXmlConversionResult } from './json-to-xml-converter'

// Round-trip validation and comparison
export { 
    RoundTripValidator, 
    RoundTripConfig, 
    RoundTripResult, 
    BatchValidationResult,
    validateRoundTrip,
    validateRoundTripFile,
    validateRoundTripFiles,
} from './round-trip-validator'

export {
    XmlNormalizer,
    XmlNormalizerConfig,
    ComparisonResult,
    compareXml,
    normalizeXml,
} from './xml-normalizer'

// Types
export * from './types'
