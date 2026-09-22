#!/usr/bin/env node
/**
 * CLI for JSON to XML Converter
 * 
 * Usage:
 *   npx ts-node src/json-to-xml-cli.ts <input.json> [options]
 *   npm run json2mpd -- <input.json> [options]
 */

import * as fs from 'fs'
import * as path from 'path'
import { JsonToXmlConverter, JsonToXmlConfig } from './json-to-xml-converter'

interface CLIOptions {
    input: string
    output?: string
    noDeclaration?: boolean
    noIndent?: boolean
    help?: boolean
    verbose?: boolean
    validate?: boolean
    skipXsd?: boolean
    skipJsonSchema?: boolean
    xsdPath?: string
    jsonSchemaPath?: string
}

function parseArgs(args: string[]): CLIOptions {
    const options: CLIOptions = {
        input: '',
        verbose: false,
        validate: false,
        skipXsd: false,
        skipJsonSchema: false,
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        if (arg === '-h' || arg === '--help') {
            options.help = true
        } else if (arg === '-o' || arg === '--output') {
            options.output = args[++i]
        } else if (arg === '--no-declaration') {
            options.noDeclaration = true
        } else if (arg === '--no-indent') {
            options.noIndent = true
        } else if (arg === '-v' || arg === '--verbose') {
            options.verbose = true
        } else if (arg === '--validate') {
            options.validate = true
        } else if (arg === '--skip-xsd') {
            options.skipXsd = true
        } else if (arg === '--skip-json-schema') {
            options.skipJsonSchema = true
        } else if (arg === '--xsd') {
            options.xsdPath = args[++i]
        } else if (arg === '--json-schema') {
            options.jsonSchemaPath = args[++i]
        } else if (!arg.startsWith('-')) {
            options.input = arg
        }
    }

    return options
}

function printHelp(): void {
    console.log(`
JSON to XML Converter for DASH MPD

Converts JSON representation back to DASH MPD XML format.
Supports round-trip conversion with namespace handling.

Usage: json2mpd <input.json> [options]

Options:
  -o, --output <file>       Output XML file (default: stdout)
  --no-declaration          Omit XML declaration (<?xml ...?>)
  --no-indent               Output minified XML
  --validate                Validate input JSON and output XML against schemas
  --skip-xsd                Skip XSD validation of output XML
  --skip-json-schema        Skip JSON Schema validation of input JSON
  --xsd <path>              Path to XSD schema file
  --json-schema <path>      Path to JSON Schema file
  -v, --verbose             Show detailed messages
  -h, --help                Show this help message

Examples:
  # Convert JSON to XML and output to stdout
  json2mpd manifest.json

  # Convert JSON to XML file
  json2mpd manifest.json -o manifest.mpd

  # Convert with validation
  json2mpd manifest.json -o manifest.mpd --validate

  # Convert with minified output
  json2mpd manifest.json --no-indent -o manifest.mpd

JSON Format:
  The input JSON should follow the MPD JSON schema format:
  - \`$ns\` property for namespace declarations (URI -> prefix mapping)
  - Extension elements grouped under prefix keys (e.g., "ext": { ... })
  - \`$value\` for text content
  - Primitive values are attributes, objects/arrays are elements
`)
}

function main(): void {
    const args = process.argv.slice(2)
    const options = parseArgs(args)

    if (options.help) {
        printHelp()
        process.exit(0)
    }

    if (!options.input) {
        console.error('Error: No input file specified')
        printHelp()
        process.exit(1)
    }

    // Resolve input path
    const inputPath = path.resolve(options.input)

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`)
        process.exit(1)
    }

    // Configure the converter
    const config: Partial<JsonToXmlConfig> = {}
    
    if (options.noDeclaration) {
        config.xmlDeclaration = false
    }
    
    if (options.noIndent) {
        config.indent = false
    }

    if (options.skipXsd) {
        config.skipXsdValidation = true
    }

    if (options.skipJsonSchema) {
        config.skipJsonSchemaValidation = true
    }

    if (options.xsdPath) {
        config.xsdPath = path.resolve(options.xsdPath)
    }

    if (options.jsonSchemaPath) {
        config.jsonSchemaPath = path.resolve(options.jsonSchemaPath)
    }

    try {
        if (options.verbose) {
            console.error(`Converting: ${inputPath}`)
        }

        const converter = new JsonToXmlConverter(config)

        if (options.validate) {
            // Use validation mode
            const result = converter.convertFileWithValidation(inputPath)

            if (!result.success) {
                console.error('Conversion failed!')
                if (result.error) {
                    console.error(`Error: ${result.error}`)
                }
                if (result.jsonSchemaErrors) {
                    console.error('JSON Schema validation errors:')
                    result.jsonSchemaErrors.forEach(err => console.error(`  - ${err}`))
                }
                if (result.xsdErrors) {
                    console.error('XSD validation errors:')
                    result.xsdErrors.forEach(err => console.error(`  - ${err}`))
                }
                process.exit(1)
            }

            if (options.output) {
                const outputPath = path.resolve(options.output)
                const outputDir = path.dirname(outputPath)
                
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true })
                }
                
                fs.writeFileSync(outputPath, result.xml!)
                
                if (options.verbose) {
                    console.error(`Success! Output written to: ${outputPath}`)
                }
            } else {
                console.log(result.xml)
            }
        } else {
            // Simple conversion (no validation)
            const xml = converter.convertFile(inputPath)

            if (options.output) {
                const outputPath = path.resolve(options.output)
                const outputDir = path.dirname(outputPath)
                
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true })
                }
                
                fs.writeFileSync(outputPath, xml)
                
                if (options.verbose) {
                    console.error(`Success! Output written to: ${outputPath}`)
                }
            } else {
                console.log(xml)
            }
        }

    } catch (error) {
        console.error('Error during conversion:', error)
        process.exit(1)
    }
}

main()
