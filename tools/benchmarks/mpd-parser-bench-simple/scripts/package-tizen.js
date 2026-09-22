/**
 * Package the Vite build output as a Tizen web application.
 *
 * Copies dist/ into tizen-package/ and adds the required Tizen config.xml.
 * The resulting directory can be packaged with:
 *   tizen package -t wgt -- tizen-package/
 *
 * Or sideloaded directly via:
 *   tizen install -n MpdBenchmark.wgt -t <device>
 */
import { cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(root, 'dist')
const outDir = path.join(root, 'tizen-package')

if (!existsSync(distDir)) {
  console.error('Error: dist/ not found. Run "npm run build:tizen" first.')
  process.exit(1)
}

// Clean & copy
mkdirSync(outDir, { recursive: true })
cpSync(distDir, outDir, { recursive: true })

// Write Tizen config.xml
const configXml = `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets"
        xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://example.org/MpdParserBenchmark"
        version="1.0.0"
        viewmodes="maximized">
  <tizen:application id="MpdBench00.MpdParserBenchmark" package="MpdBench00" required_version="2.3"/>
  <content src="index.html"/>
  <name>MPD Parser Benchmark</name>
  <icon src="icon.png"/>
  <tizen:profile name="tv-samsung"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <tizen:setting screen-orientation="landscape" context-menu="enable" background-support="disable" encryption="disable" install-location="auto"/>
</widget>
`
writeFileSync(path.join(outDir, 'config.xml'), configXml, 'utf8')

// Write a minimal 1x1 transparent PNG as icon placeholder if none exists
if (!existsSync(path.join(outDir, 'icon.png'))) {
  // Minimal 1x1 PNG (67 bytes)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
    'Nl7BcQAAAABJRU5ErkJggg==',
    'base64',
  )
  writeFileSync(path.join(outDir, 'icon.png'), png)
}

console.log(`Tizen package prepared in: ${outDir}`)
console.log('')
console.log('To build a .wgt file:')
console.log(`  tizen package -t wgt -- ${outDir}`)
console.log('')
console.log('To install on a connected device:')
console.log('  tizen install -n MpdBench00.MpdParserBenchmark.wgt -t <device-name>')
