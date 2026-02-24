#!/usr/bin/env node
/**
 * CLI for MPD to JSON Converter
 * 
 * Usage:
 *   npx ts-node src/mpd-converter-cli.ts <input.mpd> [options]
 *   npm run mpd2json -- <input.mpd> [options]
 */

import * as fs from 'fs'
import * as path from 'path'
import { MPDConverter, MPDConverterConfig } from './mpd-converter'

interface CLIOptions {
    input: string
    output?: string
    xsdPath?: string
    jsonSchemaPath?: string
    skipXsdValidation?: boolean
    skipJsonSchemaValidation?: boolean
    pretty?: boolean
    help?: boolean
    verbose?: boolean
}

function parseArgs(args: string[]): CLIOptions {
    const options: CLIOptions = {
        input: '',
        pretty: true,
        verbose: false,
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        if (arg === '-h' || arg === '--help') {
            options.help = true
        } else if (arg === '-o' || arg === '--output') {
            options.output = args[++i]
        } else if (arg === '--xsd') {
            options.xsdPath = args[++i]
        } else if (arg === '--json-schema') {
            options.jsonSchemaPath = args[++i]
        } else if (arg === '--skip-xsd') {
            options.skipXsdValidation = true
        } else if (arg === '--skip-json-schema') {
            options.skipJsonSchemaValidation = true
        } else if (arg === '--no-pretty') {
            options.pretty = false
        } else if (arg === '-v' || arg === '--verbose') {
            options.verbose = true
        } else if (!arg.startsWith('-')) {
            options.input = arg
        }
    }

    return options
}

function printHelp(): void {
    console.log(`
MPD to JSON Converter

Converts DASH MPD XML files to JSON format that conforms to the DASH JSON Schema.

Usage: mpd2json <input.mpd> [options]

Options:
  -o, --output <file>       Output JSON file (default: stdout)
  --xsd <path>              Path to XSD schema (default: xml-schemas/DASH-MPD.xsd)
  --json-schema <path>      Path to JSON Schema (default: output/dash-mpd.schema.json)
  --skip-xsd                Skip XSD validation
  --skip-json-schema        Skip JSON Schema validation
  --no-pretty               Output minified JSON
  -v, --verbose             Show detailed validation messages
  -h, --help                Show this help message

Examples:
  # Convert MPD and validate against both XSD and JSON Schema
  mpd2json manifest.mpd -o manifest.json

  # Convert without XSD validation (faster)
  mpd2json manifest.mpd --skip-xsd -o manifest.json

  # Convert and output to stdout
  mpd2json manifest.mpd

  # Verbose mode with custom schemas
  mpd2json manifest.mpd -v --xsd custom.xsd --json-schema custom.schema.json
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
    const config: Partial<MPDConverterConfig> = {}
    
    if (options.xsdPath) {
        config.xsdPath = path.resolve(options.xsdPath)
    }
    
    if (options.jsonSchemaPath) {
        config.jsonSchemaPath = path.resolve(options.jsonSchemaPath)
    }

    if (options.skipXsdValidation) {
        config.skipXsdValidation = true
    }

    if (options.skipJsonSchemaValidation) {
        config.skipJsonSchemaValidation = true
    }

    try {
        if (options.verbose) {
            console.error(`Converting: ${inputPath}`)
            if (!config.skipXsdValidation) {
                console.error(`XSD validation: enabled`)
            }
            if (!config.skipJsonSchemaValidation) {
                console.error(`JSON Schema validation: enabled`)
            }
        }

        const converter = new MPDConverter(config)
        const result = converter.convertFile(inputPath)

        if (!result.success) {
            console.error(`\nConversion failed: ${result.error}`)
            
            if (result.xsdErrors && result.xsdErrors.length > 0) {
                console.error('\nXSD Validation Errors:')
                result.xsdErrors.forEach(err => console.error(`  - ${err}`))
            }
            
            if (result.jsonSchemaErrors && result.jsonSchemaErrors.length > 0) {
                console.error('\nJSON Schema Validation Errors:')
                result.jsonSchemaErrors.forEach(err => console.error(`  - ${err}`))
            }

            // If we have JSON but validation failed, still output it with a warning
            if (result.json && options.output) {
                console.error('\nNote: JSON output will still be written despite validation errors')
                const jsonOutput = options.pretty
                    ? JSON.stringify(result.json, null, 2)
                    : JSON.stringify(result.json)
                
                const outputPath = path.resolve(options.output)
                const outputDir = path.dirname(outputPath)
                
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true })
                }
                
                fs.writeFileSync(outputPath, jsonOutput)
                console.error(`Output written to: ${outputPath}`)
            }
            
            process.exit(1)
        }

        // Output
        const jsonOutput = options.pretty
            ? JSON.stringify(result.json, null, 2)
            : JSON.stringify(result.json)

        if (options.output) {
            const outputPath = path.resolve(options.output)
            const outputDir = path.dirname(outputPath)
            
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true })
            }
            
            fs.writeFileSync(outputPath, jsonOutput)
            
            if (options.verbose) {
                console.error(`\nSuccess! Output written to: ${outputPath}`)
            }
        } else {
            console.log(jsonOutput)
        }

    } catch (error) {
        console.error('Error during conversion:', error)
        process.exit(1)
    }
}

main()
