#!/usr/bin/env node
/**
 * CLI for JSON MPD Patch Operations
 *
 * Three modes:
 *   patch-cli convert-patch <patch.mpp> -o <patch.json>
 *     Convert XML patch to JSON patch format.
 *
 *   patch-cli apply <mpd.json> <patch.json> -o <result.json>
 *     Apply a JSON patch to a JSON MPD.
 *
 *   patch-cli full <mpd.mpd> <patch.mpp> -o <result.json>
 *     End-to-end: convert XML MPD + XML patch, apply, and output patched JSON.
 */

import * as fs from 'fs'
import * as path from 'path'
import { PatchConverter } from './patch-converter'
import { PatchApplicator } from './patch-applicator'
import { MPDConverter } from './mpd-converter'

function printHelp(): void {
    console.log(`
JSON MPD Patch Tool

Usage:
  patch-cli convert-patch <patch.mpp> [-o <output.json>]
    Convert XML patch to JSON patch format.

  patch-cli apply <mpd.json> <patch.json> [-o <output.json>]
    Apply a JSON patch to a JSON MPD.

  patch-cli full <manifest.mpd> <patch.mpp> [-o <output.json>]
    End-to-end: convert XML MPD to JSON, convert XML patch to JSON,
    apply the patch, and output the resulting JSON MPD.

Options:
  -o, --output <file>   Output file (default: stdout)
  -h, --help            Show this help message
`)
}

function main(): void {
    const args = process.argv.slice(2)

    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        printHelp()
        process.exit(0)
    }

    const command = args[0]
    let output: string | undefined
    const positional: string[] = []

    for (let i = 1; i < args.length; i++) {
        if (args[i] === '-o' || args[i] === '--output') {
            output = args[++i]
        } else if (!args[i].startsWith('-')) {
            positional.push(args[i])
        }
    }

    const schemaPath = path.join(__dirname, '..', 'output', 'dash-mpd.schema.json')

    try {
        switch (command) {
            case 'convert-patch': {
                if (positional.length < 1) {
                    console.error('Error: convert-patch requires a patch file argument')
                    process.exit(1)
                }
                const converter = new PatchConverter()
                const jsonPatch = converter.convertFile(path.resolve(positional[0]))
                writeOutput(jsonPatch, output)
                break
            }

            case 'apply': {
                if (positional.length < 2) {
                    console.error('Error: apply requires <mpd.json> and <patch.json> arguments')
                    process.exit(1)
                }
                const mpdJson = JSON.parse(fs.readFileSync(path.resolve(positional[0]), 'utf-8'))
                const patchJson = JSON.parse(fs.readFileSync(path.resolve(positional[1]), 'utf-8'))
                const applicator = new PatchApplicator(schemaPath)
                const result = applicator.apply(mpdJson, patchJson as any)

                if (!result.success) {
                    console.error('Patch application failed:')
                    result.errors.forEach(e => console.error(`  - ${e}`))
                    console.error(`Operations applied before failure: ${result.operationsApplied}`)
                    // Still write partial result
                    writeOutput(result.mpd, output)
                    process.exit(1)
                }

                console.error(`Successfully applied ${result.operationsApplied} operations`)
                writeOutput(result.mpd, output)
                break
            }

            case 'full': {
                if (positional.length < 2) {
                    console.error('Error: full requires <manifest.mpd> and <patch.mpp> arguments')
                    process.exit(1)
                }

                // Step 1: Convert XML MPD to JSON
                console.error('Step 1: Converting XML MPD to JSON...')
                const mpdConverter = new MPDConverter({
                    skipXsdValidation: true,
                    skipJsonSchemaValidation: true,
                })
                const mpdResult = mpdConverter.convertFile(path.resolve(positional[0]))
                if (!mpdResult.success || !mpdResult.json) {
                    console.error(`MPD conversion failed: ${mpdResult.error}`)
                    process.exit(1)
                }
                console.error('  MPD converted to JSON successfully')

                // Step 2: Convert XML patch to JSON
                console.error('Step 2: Converting XML patch to JSON...')
                const patchConverter = new PatchConverter()
                const jsonPatch = patchConverter.convertFile(path.resolve(positional[1]))
                console.error(`  Patch converted: ${jsonPatch.operations.length} operations`)

                // Step 3: Apply the patch
                console.error('Step 3: Applying patch...')
                const applicator = new PatchApplicator(schemaPath)
                const patchResult = applicator.apply(mpdResult.json, jsonPatch as any)

                if (!patchResult.success) {
                    console.error('Patch application failed:')
                    patchResult.errors.forEach(e => console.error(`  - ${e}`))
                    console.error(`Operations applied before failure: ${patchResult.operationsApplied}`)
                    writeOutput(patchResult.mpd, output)
                    process.exit(1)
                }

                console.error(`  Applied ${patchResult.operationsApplied} operations successfully`)
                writeOutput(patchResult.mpd, output)
                break
            }

            default:
                console.error(`Unknown command: ${command}`)
                printHelp()
                process.exit(1)
        }
    } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
    }
}

function writeOutput(data: unknown, outputPath?: string): void {
    const json = JSON.stringify(data, null, 2)
    if (outputPath) {
        const resolved = path.resolve(outputPath)
        const dir = path.dirname(resolved)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(resolved, json)
        console.error(`Output written to: ${resolved}`)
    } else {
        console.log(json)
    }
}

main()
