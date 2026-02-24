#!/usr/bin/env npx ts-node
/**
 * Batch Round-Trip Validation Report
 *
 * Runs the round-trip validator (MPD -> JSON -> MPD) on every example MPD
 * and produces a summary report:
 *   - Short one-liner for files that passed cleanly
 *   - Detailed section for files that failed or had errors/warnings
 *
 * Usage:
 *   npx ts-node benchmarks/run-all-roundtrips.ts [options]
 *
 * Options:
 *   --skip-xsd            Skip XSD validation (faster)
 *   --skip-json-schema    Skip JSON Schema validation (faster)
 *   --max-diffs <n>       Max diff lines to show per failed file (default: 20)
 *   --include-dashjs      Include dash-js-sources examples
 *   --include-dashif      Include dash-if-test-vectors examples (must be downloaded first)
 *   --only <glob>         Only run files matching this pattern (e.g. "example_G*")
 *   -v, --verbose         Verbose progress output
 *   -h, --help            Show help
 */

import * as fs from 'fs'
import * as path from 'path'
import { RoundTripValidator, RoundTripConfig, RoundTripResult } from '../src/round-trip-validator'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..')
const EXAMPLES_DIR = path.join(ROOT, 'examples')

interface FileResult {
    file: string           // relative path from repo root
    result: RoundTripResult
    category: string       // e.g. "spec-examples", "dash-js-sources", "dash-if-test-vectors", "other"
    sourceUrl?: string     // original download URL (for dash-if and dash-js sources)
}

interface CLIOptions {
    skipXsd: boolean
    skipJsonSchema: boolean
    maxDiffs: number
    includeDashJs: boolean
    includeDashIf: boolean
    only?: string
    verbose: boolean
    help: boolean
}

function parseArgs(args: string[]): CLIOptions {
    const opts: CLIOptions = {
        skipXsd: false,
        skipJsonSchema: false,
        maxDiffs: 20,
        includeDashJs: false,
        includeDashIf: false,
        verbose: false,
        help: false,
    }
    for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '-h' || a === '--help') opts.help = true
        else if (a === '--skip-xsd') opts.skipXsd = true
        else if (a === '--skip-json-schema') opts.skipJsonSchema = true
        else if (a === '--max-diffs') opts.maxDiffs = parseInt(args[++i], 10) || 20
        else if (a === '--include-dashjs') opts.includeDashJs = true
        else if (a === '--include-dashif') opts.includeDashIf = true
        else if (a === '--only') opts.only = args[++i]
        else if (a === '-v' || a === '--verbose') opts.verbose = true
    }
    return opts
}

function printHelp(): void {
    console.log(`
Batch Round-Trip Validation Report

Runs MPD -> JSON -> MPD round-trip on all example MPDs and reports results.

Usage:
  npx ts-node benchmarks/run-all-roundtrips.ts [options]

Options:
  --skip-xsd            Skip XSD validation (faster)
  --skip-json-schema    Skip JSON Schema validation (faster)
  --max-diffs <n>       Max diff lines per failed file (default: 20)
  --include-dashjs      Include dash-js-sources examples
  --include-dashif      Include dash-if-test-vectors examples
  --only <glob>         Only run files whose basename matches this pattern
  -v, --verbose         Show progress while running
  -h, --help            Show this message
`)
}

/** Collect MPD files from the examples directory */
function collectMpdFiles(opts: CLIOptions): string[] {
    const files: string[] = []

    // Top-level examples (spec annex examples, etc.)
    if (fs.existsSync(EXAMPLES_DIR)) {
        for (const entry of fs.readdirSync(EXAMPLES_DIR)) {
            if (entry.endsWith('.mpd')) {
                files.push(path.join(EXAMPLES_DIR, entry))
            }
        }
    }

    // dash-js-sources sub-directory
    if (opts.includeDashJs) {
        const dashJsDir = path.join(EXAMPLES_DIR, 'dash-js-sources')
        if (fs.existsSync(dashJsDir)) {
            for (const entry of fs.readdirSync(dashJsDir)) {
                if (entry.endsWith('.mpd')) {
                    files.push(path.join(dashJsDir, entry))
                }
            }
        }
    }

    // dash-if-test-vectors sub-directory
    if (opts.includeDashIf) {
        const dashIfDir = path.join(EXAMPLES_DIR, 'dash-if-test-vectors')
        if (fs.existsSync(dashIfDir)) {
            const walk = (dir: string) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name)
                    if (entry.isDirectory()) walk(full)
                    else if (entry.name.endsWith('.mpd')) files.push(full)
                }
            }
            walk(dashIfDir)
        }
    }

    // Apply --only filter
    if (opts.only) {
        const pattern = new RegExp(
            '^' + opts.only.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        )
        return files
            .filter(f => pattern.test(path.basename(f)))
            .sort()
    }

    return files.sort()
}

/** Classify an MPD file into a reporting category */
function categorize(filePath: string): string {
    const rel = path.relative(EXAMPLES_DIR, filePath)
    if (rel.startsWith('dash-js-sources')) return 'dash-js-sources'
    if (rel.startsWith('dash-if-test-vectors')) return 'dash-if-test-vectors'
    if (path.basename(filePath).startsWith('example_G')) return 'spec-annex-G'
    if (path.basename(filePath).startsWith('example_H')) return 'spec-annex-H'
    if (path.basename(filePath).startsWith('example_K')) return 'spec-annex-K'
    return 'other'
}

/** Format milliseconds nicely */
function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

/** Relative path from repo root for display */
function relPath(filePath: string): string {
    return path.relative(ROOT, filePath)
}

// ── Source URL lookup ─────────────────────────────────────────────────────────

/**
 * Build a map from MPD filename -> source URL by parsing the dash-if
 * download_success_report.txt.  Each entry looks like:
 *
 *   [123] Some test vector name
 *       Identifier: ...
 *       Feature: ...
 *       Testcase: ...
 *       URL: https://example.com/path/to/file.mpd
 *       Saved as: Test_Vector_1__file.mpd
 *       Original name: file.mpd
 */
function loadDashIfUrlMap(): Map<string, string> {
    const map = new Map<string, string>()
    const reportPath = path.join(EXAMPLES_DIR, 'dash-if-test-vectors', 'download_success_report.txt')
    if (!fs.existsSync(reportPath)) return map

    const lines = fs.readFileSync(reportPath, 'utf-8').split('\n')
    let currentUrl: string | undefined
    for (const line of lines) {
        const urlMatch = line.match(/^\s+URL:\s+(.+)$/)
        if (urlMatch) {
            currentUrl = urlMatch[1].trim()
            continue
        }
        const savedMatch = line.match(/^\s+Saved as:\s+(.+)$/)
        if (savedMatch && currentUrl) {
            map.set(savedMatch[1].trim(), currentUrl)
            currentUrl = undefined
        }
    }
    return map
}

/**
 * Build a map from MPD filename -> source URL by parsing the dash-js
 * downloaded_mpd_map.tsv (tab-separated: URL\tfilename).
 */
function loadDashJsUrlMap(): Map<string, string> {
    const map = new Map<string, string>()
    const tsvPath = path.join(EXAMPLES_DIR, 'dash-js-sources', 'downloaded_mpd_map.tsv')
    if (!fs.existsSync(tsvPath)) return map

    const lines = fs.readFileSync(tsvPath, 'utf-8').split('\n')
    for (const line of lines) {
        const parts = line.split('\t')
        if (parts.length >= 2) {
            const url = parts[0].trim()
            const filename = parts[1].trim()
            if (url && filename) map.set(filename, url)
        }
    }
    return map
}

/**
 * Look up the source URL for a given MPD file path using the preloaded maps.
 */
function lookupSourceUrl(
    filePath: string,
    dashIfMap: Map<string, string>,
    dashJsMap: Map<string, string>,
): string | undefined {
    const filename = path.basename(filePath)
    const rel = path.relative(EXAMPLES_DIR, filePath)

    if (rel.startsWith('dash-if-test-vectors')) {
        return dashIfMap.get(filename)
    }
    if (rel.startsWith('dash-js-sources')) {
        return dashJsMap.get(filename)
    }
    return undefined
}

// ── Report rendering ─────────────────────────────────────────────────────────

function printReport(results: FileResult[], opts: CLIOptions): void {
    const passed = results.filter(r => r.result.success)
    const failed = results.filter(r => !r.result.success)

    const totalTime = results.reduce((s, r) => s + (r.result.timing?.total ?? 0), 0)

    // ── Header ───────────────────────────────────────────────────────────
    console.log('='.repeat(78))
    console.log('  MPD Round-Trip Validation Report')
    console.log('='.repeat(78))
    console.log()
    console.log(`  Files tested : ${results.length}`)
    console.log(`  Passed       : ${passed.length}`)
    console.log(`  Failed       : ${failed.length}`)
    console.log(`  Total time   : ${fmtMs(totalTime)}`)
    console.log()

    // ── Passed files (short) ─────────────────────────────────────────────
    if (passed.length > 0) {
        console.log('-'.repeat(78))
        console.log('  PASSED')
        console.log('-'.repeat(78))

        // Group by category
        const byCategory = new Map<string, FileResult[]>()
        for (const r of passed) {
            const cat = r.category
            if (!byCategory.has(cat)) byCategory.set(cat, [])
            byCategory.get(cat)!.push(r)
        }

        for (const [category, items] of byCategory) {
            console.log()
            console.log(`  [${category}] (${items.length} files)`)
            for (const item of items) {
                const t = item.result.timing
                const timing = t
                    ? `  (${fmtMs(t.mpdToJson)} + ${fmtMs(t.jsonToMpd)} + ${fmtMs(t.comparison)} = ${fmtMs(t.total)})`
                    : ''
                console.log(`    PASS  ${relPath(item.file)}${timing}`)
            }
        }
        console.log()
    }

    // ── Failed files (detailed) ──────────────────────────────────────────
    if (failed.length > 0) {
        console.log('-'.repeat(78))
        console.log('  FAILED')
        console.log('-'.repeat(78))

        for (const item of failed) {
            console.log()
            console.log(`  FAIL  ${relPath(item.file)}`)
            console.log(`  Category: ${item.category}`)
            if (item.sourceUrl) {
                console.log(`  Source URL: ${item.sourceUrl}`)
            }

            const r = item.result

            if (r.timing) {
                console.log(`  Timing: MPD->JSON: ${fmtMs(r.timing.mpdToJson)}, JSON->MPD: ${fmtMs(r.timing.jsonToMpd)}, Compare: ${fmtMs(r.timing.comparison)}, Total: ${fmtMs(r.timing.total)}`)
            }

            if (r.error) {
                console.log(`  Error: ${r.error}`)
            }

            if (r.mpdToJsonErrors && r.mpdToJsonErrors.length > 0) {
                console.log(`  MPD -> JSON errors:`)
                for (const err of r.mpdToJsonErrors) {
                    console.log(`    - ${err}`)
                }
            }

            if (r.jsonToMpdErrors && r.jsonToMpdErrors.length > 0) {
                console.log(`  JSON -> MPD errors:`)
                for (const err of r.jsonToMpdErrors) {
                    console.log(`    - ${err}`)
                }
            }

            if (r.comparison && !r.comparison.equal && r.comparison.differences) {
                const diffs = r.comparison.differences
                const show = diffs.slice(0, opts.maxDiffs)
                console.log(`  Differences (${diffs.length} total):`)
                for (const d of show) {
                    console.log(`    ${d}`)
                }
                if (diffs.length > opts.maxDiffs) {
                    console.log(`    ... and ${diffs.length - opts.maxDiffs} more`)
                }
            }

            console.log()
        }
    }

    // ── Summary table by category ────────────────────────────────────────
    console.log('-'.repeat(78))
    console.log('  Summary by category')
    console.log('-'.repeat(78))
    console.log()

    const categories = new Map<string, { pass: number; fail: number; time: number }>()
    for (const r of results) {
        if (!categories.has(r.category)) categories.set(r.category, { pass: 0, fail: 0, time: 0 })
        const c = categories.get(r.category)!
        if (r.result.success) c.pass++
        else c.fail++
        c.time += r.result.timing?.total ?? 0
    }

    const catHeader = '  Category                      Pass   Fail  Total  Time'
    console.log(catHeader)
    console.log('  ' + '-'.repeat(catHeader.length - 2))
    for (const [cat, stats] of categories) {
        const total = stats.pass + stats.fail
        console.log(
            `  ${cat.padEnd(30)} ${String(stats.pass).padStart(4)}   ${String(stats.fail).padStart(4)}  ${String(total).padStart(5)}  ${fmtMs(stats.time).padStart(8)}`
        )
    }
    console.log()

    // ── Final verdict ────────────────────────────────────────────────────
    console.log('='.repeat(78))
    if (failed.length === 0) {
        console.log(`  ALL ${results.length} FILES PASSED`)
    } else {
        console.log(`  ${failed.length} of ${results.length} FILES FAILED`)
    }
    console.log('='.repeat(78))
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
    const opts = parseArgs(process.argv.slice(2))

    if (opts.help) {
        printHelp()
        process.exit(0)
    }

    const mpdFiles = collectMpdFiles(opts)

    if (mpdFiles.length === 0) {
        console.error('No MPD files found. Check the examples/ directory or use --include-dashjs / --include-dashif.')
        process.exit(2)
    }

    if (opts.verbose) {
        console.error(`Found ${mpdFiles.length} MPD files to validate\n`)
    }

    // Load source URL maps for downloaded MPDs
    const dashIfUrlMap = loadDashIfUrlMap()
    const dashJsUrlMap = loadDashJsUrlMap()

    if (opts.verbose) {
        const totalUrls = dashIfUrlMap.size + dashJsUrlMap.size
        if (totalUrls > 0) {
            process.stderr.write(`Loaded ${dashIfUrlMap.size} dash-if + ${dashJsUrlMap.size} dash-js source URL mappings\n`)
        }
    }

    // Configure validator
    const config: Partial<RoundTripConfig> = {
        skipXsdValidation: opts.skipXsd,
        skipJsonSchemaValidation: opts.skipJsonSchema,
        verbose: false, // we handle our own progress output
    }
    const validator = new RoundTripValidator(config)

    // Run all validations
    const results: FileResult[] = []
    let done = 0

    for (const file of mpdFiles) {
        done++
        if (opts.verbose) {
            process.stderr.write(`[${done}/${mpdFiles.length}] ${relPath(file)} ... `)
        }

        const result = validator.validateFile(file)
        results.push({
            file,
            result,
            category: categorize(file),
            sourceUrl: lookupSourceUrl(file, dashIfUrlMap, dashJsUrlMap),
        })

        if (opts.verbose) {
            const status = result.success ? 'PASS' : 'FAIL'
            const time = result.timing ? ` (${fmtMs(result.timing.total)})` : ''
            process.stderr.write(`${status}${time}\n`)
        }
    }

    // Print the report to stdout
    printReport(results, opts)

    // Exit code
    const anyFailed = results.some(r => !r.result.success)
    process.exit(anyFailed ? 1 : 0)
}

main()
