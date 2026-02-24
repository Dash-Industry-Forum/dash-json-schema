#!/usr/bin/env node
/**
 * CLI for MPD Round-Trip Validation
 * 
 * Validates that MPD files can be converted to JSON and back to MPD
 * with the two MPD files being semantically identical.
 * 
 * Usage:
 *   npx ts-node src/round-trip-cli.ts <input.mpd> [options]
 *   npm run validate-roundtrip -- <input.mpd> [options]
 */

import * as fs from 'fs'
import * as path from 'path'
import { RoundTripValidator, RoundTripConfig } from './round-trip-validator'

interface CLIOptions {
    inputs: string[]
    output?: string
    outputJson?: string
    outputMpd?: string
    showDiff?: boolean
    skipXsd?: boolean
    skipJsonSchema?: boolean
    verbose?: boolean
    help?: boolean
    quiet?: boolean
}

function parseArgs(args: string[]): CLIOptions {
    const options: CLIOptions = {
        inputs: [],
        verbose: false,
        showDiff: false,
        skipXsd: false,
        skipJsonSchema: false,
        quiet: false,
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        if (arg === '-h' || arg === '--help') {
            options.help = true
        } else if (arg === '-o' || arg === '--output') {
            options.output = args[++i]
        } else if (arg === '--output-json') {
            options.outputJson = args[++i]
        } else if (arg === '--output-mpd') {
            options.outputMpd = args[++i]
        } else if (arg === '-d' || arg === '--diff') {
            options.showDiff = true
        } else if (arg === '--skip-xsd') {
            options.skipXsd = true
        } else if (arg === '--skip-json-schema') {
            options.skipJsonSchema = true
        } else if (arg === '-v' || arg === '--verbose') {
            options.verbose = true
        } else if (arg === '-q' || arg === '--quiet') {
            options.quiet = true
        } else if (!arg.startsWith('-')) {
            options.inputs.push(arg)
        }
    }

    return options
}

function printHelp(): void {
    console.log(`
MPD Round-Trip Validator

Validates that MPD files can be converted to JSON and back to MPD
with the two MPD files being semantically identical.

Pipeline: MPD -> JSON -> MPD (and compare)

Usage: validate-roundtrip <input.mpd> [input2.mpd ...] [options]

Options:
  -o, --output <dir>        Output directory for generated files
  --output-json <file>      Save intermediate JSON to file (single file mode)
  --output-mpd <file>       Save regenerated MPD to file (single file mode)
  -d, --diff                Show differences when comparison fails
  --skip-xsd                Skip XSD validation
  --skip-json-schema        Skip JSON Schema validation
  -v, --verbose             Show detailed progress messages
  -q, --quiet               Only show errors (no success messages)
  -h, --help                Show this help message

Examples:
  # Validate a single MPD file
  validate-roundtrip manifest.mpd

  # Validate multiple files
  validate-roundtrip examples/*.mpd

  # Validate and show differences on failure
  validate-roundtrip manifest.mpd --diff

  # Validate and save intermediate files
  validate-roundtrip manifest.mpd --output-json manifest.json --output-mpd manifest-regenerated.mpd

  # Batch validate and save all files
  validate-roundtrip examples/*.mpd -o output/

Exit Codes:
  0  All validations passed
  1  One or more validations failed
  2  Error (invalid arguments, file not found, etc.)
`)
}

function expandGlobs(patterns: string[]): string[] {
    const files: string[] = []
    
    for (const pattern of patterns) {
        if (pattern.includes('*')) {
            // Simple glob expansion (for directories with wildcards)
            const dir = path.dirname(pattern)
            const filePattern = path.basename(pattern)
            const regex = new RegExp('^' + filePattern.replace(/\*/g, '.*') + '$')
            
            if (fs.existsSync(dir)) {
                const dirFiles = fs.readdirSync(dir)
                for (const file of dirFiles) {
                    if (regex.test(file)) {
                        files.push(path.join(dir, file))
                    }
                }
            }
        } else {
            files.push(pattern)
        }
    }
    
    return files
}

function main(): void {
    const args = process.argv.slice(2)
    const options = parseArgs(args)

    if (options.help) {
        printHelp()
        process.exit(0)
    }

    if (options.inputs.length === 0) {
        console.error('Error: No input files specified')
        printHelp()
        process.exit(2)
    }

    // Expand glob patterns
    const inputFiles = expandGlobs(options.inputs)

    if (inputFiles.length === 0) {
        console.error('Error: No matching files found')
        process.exit(2)
    }

    // Check that all files exist
    for (const file of inputFiles) {
        if (!fs.existsSync(file)) {
            console.error(`Error: File not found: ${file}`)
            process.exit(2)
        }
    }

    // Configure the validator
    const config: Partial<RoundTripConfig> = {
        skipXsdValidation: options.skipXsd,
        skipJsonSchemaValidation: options.skipJsonSchema,
        verbose: options.verbose,
    }

    const validator = new RoundTripValidator(config)

    // Single file mode with output options
    if (inputFiles.length === 1) {
        const inputPath = path.resolve(inputFiles[0])
        const result = validator.validateFile(inputPath)

        if (result.success) {
            if (!options.quiet) {
                console.log(`PASS: ${inputPath}`)
                if (result.timing) {
                    console.log(`  Timing: MPD->JSON: ${result.timing.mpdToJson}ms, JSON->MPD: ${result.timing.jsonToMpd}ms, Compare: ${result.timing.comparison}ms`)
                }
            }

            // Save intermediate files if requested
            if (options.outputJson && result.json) {
                const jsonPath = path.resolve(options.outputJson)
                fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
                fs.writeFileSync(jsonPath, JSON.stringify(result.json, null, 2))
                if (!options.quiet) {
                    console.log(`  JSON saved to: ${jsonPath}`)
                }
            }

            if (options.outputMpd && result.regeneratedMpd) {
                const mpdPath = path.resolve(options.outputMpd)
                fs.mkdirSync(path.dirname(mpdPath), { recursive: true })
                fs.writeFileSync(mpdPath, result.regeneratedMpd)
                if (!options.quiet) {
                    console.log(`  Regenerated MPD saved to: ${mpdPath}`)
                }
            }

            process.exit(0)
        } else {
            console.error(`FAIL: ${inputPath}`)
            if (result.error) {
                console.error(`  Error: ${result.error}`)
            }
            if (result.mpdToJsonErrors) {
                console.error('  MPD to JSON errors:')
                result.mpdToJsonErrors.forEach(err => console.error(`    - ${err}`))
            }
            if (result.jsonToMpdErrors) {
                console.error('  JSON to MPD errors:')
                result.jsonToMpdErrors.forEach(err => console.error(`    - ${err}`))
            }
            if (options.showDiff && result.comparison?.differences) {
                console.error('  Differences:')
                result.comparison.differences.forEach(diff => console.error(`    ${diff}`))
            }

            // Save intermediate files for debugging
            if (options.outputJson && result.json) {
                const jsonPath = path.resolve(options.outputJson)
                fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
                fs.writeFileSync(jsonPath, JSON.stringify(result.json, null, 2))
                console.error(`  JSON saved to: ${jsonPath}`)
            }

            if (options.outputMpd && result.regeneratedMpd) {
                const mpdPath = path.resolve(options.outputMpd)
                fs.mkdirSync(path.dirname(mpdPath), { recursive: true })
                fs.writeFileSync(mpdPath, result.regeneratedMpd)
                console.error(`  Regenerated MPD saved to: ${mpdPath}`)
            }

            process.exit(1)
        }
    }

    // Batch mode
    const batchResult = validator.validateFiles(inputFiles.map(f => path.resolve(f)))

    // Output directory for batch mode
    if (options.output) {
        const outputDir = path.resolve(options.output)
        fs.mkdirSync(outputDir, { recursive: true })

        for (const [inputPath, result] of batchResult.results) {
            const baseName = path.basename(inputPath, '.mpd')
            
            if (result.json) {
                const jsonPath = path.join(outputDir, `${baseName}.json`)
                fs.writeFileSync(jsonPath, JSON.stringify(result.json, null, 2))
            }
            
            if (result.regeneratedMpd) {
                const mpdPath = path.join(outputDir, `${baseName}-regenerated.mpd`)
                fs.writeFileSync(mpdPath, result.regeneratedMpd)
            }
        }

        if (!options.quiet) {
            console.log(`Output files saved to: ${outputDir}`)
        }
    }

    // Print summary
    console.log('')
    console.log(`Results: ${batchResult.passed}/${batchResult.total} passed`)
    
    if (batchResult.failed > 0) {
        console.log('')
        console.log('Failed files:')
        for (const failure of batchResult.failures) {
            const result = batchResult.results.get(failure)
            console.log(`  ${failure}`)
            if (result?.error) {
                console.log(`    Error: ${result.error}`)
            }
            if (options.showDiff && result?.comparison?.differences) {
                console.log('    Differences:')
                result.comparison.differences.slice(0, 10).forEach(diff => console.log(`      ${diff}`))
                if (result.comparison.differences.length > 10) {
                    console.log(`      ... and ${result.comparison.differences.length - 10} more`)
                }
            }
        }
        process.exit(1)
    }

    process.exit(0)
}

main()
