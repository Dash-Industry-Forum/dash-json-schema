#!/usr/bin/env node
/**
 * CLI for XSD to JSON Schema converter
 */

import * as fs from 'fs'
import * as path from 'path'
import { JSONSchemaGenerator } from './json-schema-generator'
import { ConverterConfig } from './types'

interface CLIOptions {
    input: string
    output?: string
    baseUri?: string
    attributePrefix?: string
    markAttributes?: boolean
    pretty?: boolean
    help?: boolean
}

function parseArgs(args: string[]): CLIOptions {
    const options: CLIOptions = {
        input: '',
        pretty: true,
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        if (arg === '-h' || arg === '--help') {
            options.help = true
        } else if (arg === '-o' || arg === '--output') {
            options.output = args[++i]
        } else if (arg === '--base-uri') {
            options.baseUri = args[++i]
        } else if (arg === '--attr-prefix') {
            options.attributePrefix = args[++i]
        } else if (arg === '--mark-attributes') {
            options.markAttributes = true
        } else if (arg === '--no-mark-attributes') {
            options.markAttributes = false
        } else if (arg === '--no-pretty') {
            options.pretty = false
        } else if (!arg.startsWith('-')) {
            options.input = arg
        }
    }

    return options
}

function printHelp(): void {
    console.log(`
XSD to JSON Schema Converter

Usage: xsd2jsonschema <input.xsd> [options]

Options:
  -o, --output <file>      Output file (default: stdout)
  --base-uri <uri>         Base URI for $id in the schema
  --attr-prefix <prefix>   Prefix for XML attributes (e.g., '@')
  --mark-attributes        Add x-xml-attribute markers to attributes
  --no-mark-attributes     Do not add x-xml-attribute markers (default)
  --no-pretty              Output minified JSON
  -h, --help               Show this help message

Examples:
  xsd2jsonschema schema.xsd -o schema.json
  xsd2jsonschema schema.xsd --base-uri "https://example.com/schema"
  xsd2jsonschema schema.xsd --attr-prefix "@" -o output.json
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
    const config: Partial<ConverterConfig> = {}
    
    if (options.baseUri) {
        config.baseUri = options.baseUri
    }
    
    if (options.attributePrefix !== undefined) {
        config.attributePrefix = options.attributePrefix
    }

    if (options.markAttributes !== undefined) {
        config.markAttributes = options.markAttributes
    }

    try {
        // Generate JSON Schema
        console.error(`Converting: ${inputPath}`)
        const generator = new JSONSchemaGenerator(config)
        const jsonSchema = generator.generateFromFile(inputPath)

        // Output
        const jsonOutput = options.pretty
            ? JSON.stringify(jsonSchema, null, 2)
            : JSON.stringify(jsonSchema)

        if (options.output) {
            const outputPath = path.resolve(options.output)
            const outputDir = path.dirname(outputPath)
            
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true })
            }
            
            fs.writeFileSync(outputPath, jsonOutput)
            console.error(`Output written to: ${outputPath}`)
        } else {
            console.log(jsonOutput)
        }
    } catch (error) {
        console.error('Error during conversion:', error)
        process.exit(1)
    }
}

main()
