import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const benchRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const ALLOWED_XSD_FILES = new Set([
  'DASH-MPD.xsd',
  'DASH-MPD-UP.xsd',
  'DASH-MPD-PATCH.xsd',
  'CENC.xsd',
  'xlink.xsd',
])

async function convertMpdWithProjectConverter(xml) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'mpd-parser-bench-'))
  const inputPath = path.join(tempDir, `${randomUUID()}.mpd`)
  const outputPath = path.join(tempDir, `${randomUUID()}.json`)

  try {
    await writeFile(inputPath, xml, 'utf8')

    await new Promise((resolve, reject) => {
      const child = spawn(
        'npx',
        [
          'ts-node',
          'src/mpd-converter-cli.ts',
          inputPath,
          '--skip-xsd',
          '--skip-json-schema',
          '--no-pretty',
          '--output',
          outputPath,
        ],
        { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      )

      let stderr = ''

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(stderr.trim() || `mpd-converter-cli failed with exit code ${code}`))
      })
    })

    return await readFile(outputPath, 'utf8')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function convertXsdToJsonSchema(xsdPath) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'xsd-convert-'))
  const outputPath = path.join(tempDir, `${randomUUID()}.json`)
  const inputPath = path.join(repoRoot, 'xml-schemas', xsdPath)

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        'npx',
        [
          'ts-node',
          'src/cli.ts',
          inputPath,
          '--output',
          outputPath,
        ],
        { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      )

      let stderr = ''

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(stderr.trim() || `xsd2jsonschema failed with exit code ${code}`))
      })
    })

    return await readFile(outputPath, 'utf8')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function createConverterMiddleware() {
  return async (req, res, next) => {
    if (req.method !== 'POST') {
      next()
      return
    }

    if (req.url === '/api/convert-mpd') {
      try {
        const rawBody = await readRequestBody(req)
        const payload = JSON.parse(rawBody)
        const xml = typeof payload?.xml === 'string' ? payload.xml : ''

        if (!xml.trim()) {
          jsonResponse(res, 400, { error: 'Request body must include a non-empty xml string.' })
          return
        }

        const jsonString = await convertMpdWithProjectConverter(xml)
        jsonResponse(res, 200, { jsonString })
      } catch (error) {
        jsonResponse(res, 500, { error: `MPD conversion failed: ${String(error)}` })
      }
      return
    }

    if (req.url === '/api/convert-xsd') {
      try {
        const rawBody = await readRequestBody(req)
        const payload = JSON.parse(rawBody)
        const xsdPath = typeof payload?.xsdPath === 'string' ? payload.xsdPath : ''

        if (!xsdPath || !ALLOWED_XSD_FILES.has(xsdPath)) {
          jsonResponse(res, 400, { error: 'Invalid XSD file path.' })
          return
        }

        const jsonSchema = await convertXsdToJsonSchema(xsdPath)
        jsonResponse(res, 200, { jsonSchema })
      } catch (error) {
        jsonResponse(res, 500, { error: `XSD conversion failed: ${String(error)}` })
      }
      return
    }

    if (req.url === '/api/read-xsd') {
      try {
        const rawBody = await readRequestBody(req)
        const payload = JSON.parse(rawBody)
        const xsdPath = typeof payload?.xsdPath === 'string' ? payload.xsdPath : ''

        if (!xsdPath || !ALLOWED_XSD_FILES.has(xsdPath)) {
          jsonResponse(res, 400, { error: 'Invalid XSD file path.' })
          return
        }

        const filePath = path.join(repoRoot, 'xml-schemas', xsdPath)
        const content = await readFile(filePath, 'utf8')
        jsonResponse(res, 200, { content })
      } catch (error) {
        jsonResponse(res, 500, { error: `Failed to read XSD: ${String(error)}` })
      }
      return
    }

    next()
  }
}

export default defineConfig({
  plugins: [
    {
      name: 'mpd-converter-api',
      configureServer(server) {
        server.middlewares.use(createConverterMiddleware())
      },
      configurePreviewServer(server) {
        server.middlewares.use(createConverterMiddleware())
      },
    },
  ],
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(benchRoot, 'index.html'),
        compare: path.resolve(benchRoot, 'compare.html'),
      },
    },
  },
  server: {
    fs: {
      allow: [benchRoot, repoRoot],
    },
  },
})
