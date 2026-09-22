/**
 * Package the Vite build output as a webOS web application.
 *
 * Copies dist/ into webos-package/ and adds the required appinfo.json.
 * The resulting directory can be packaged with:
 *   ares-package webos-package/
 *
 * And installed via:
 *   ares-install com.example.mpdbenchmark_1.0.0_all.ipk
 */
import { cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(root, 'dist')
const outDir = path.join(root, 'webos-package')

if (!existsSync(distDir)) {
  console.error('Error: dist/ not found. Run "npm run build:webos" first.')
  process.exit(1)
}

// Clean & copy
mkdirSync(outDir, { recursive: true })
cpSync(distDir, outDir, { recursive: true })

// Write webOS appinfo.json
const appInfo = {
  id: 'com.example.mpdbenchmark',
  version: '1.0.0',
  vendor: 'MPD Benchmark',
  type: 'web',
  main: 'index.html',
  title: 'MPD Parser Benchmark',
  icon: 'icon.png',
  largeIcon: 'icon.png',
  bgImage: '',
  resolution: '1920x1080',
  iconColor: '#1a1a2e',
  disableBackHistoryAPI: false,
}
writeFileSync(
  path.join(outDir, 'appinfo.json'),
  JSON.stringify(appInfo, null, 2) + '\n',
  'utf8',
)

// Write a minimal 1x1 transparent PNG as icon placeholder if none exists
if (!existsSync(path.join(outDir, 'icon.png'))) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
    'Nl7BcQAAAABJRU5ErkJggg==',
    'base64',
  )
  writeFileSync(path.join(outDir, 'icon.png'), png)
}

console.log(`webOS package prepared in: ${outDir}`)
console.log('')
console.log('To build an .ipk file:')
console.log(`  ares-package ${outDir}`)
console.log('')
console.log('To install on a connected device:')
console.log('  ares-install com.example.mpdbenchmark_1.0.0_all.ipk')
