import { parseXml } from '@svta/cml-xml'
import './style.css'

const MAX_RENDER_LINES = 5000

const examples = import.meta.glob('./examples/**/*.mpd', {
  eager: true,
  query: '?url',
  import: 'default',
})

const parsedExamples = Object.entries(examples)
  .map(([path, value]) => ({
    path,
    label: path.replace('./examples/', ''),
    url: value,
  }))
  .sort((a, b) => a.label.localeCompare(b.label))

const domParser = new DOMParser()

const benchmarkMethods = [
  {
    name: 'DOMParser -> object',
    run: (xml) => parseWithDom(xml),
  },
  {
    name: 'JSON.parse',
    run: (_, jsonString) => JSON.parse(jsonString),
  },
  {
    name: '@svta/cml-xml parseXml',
    run: (xml) => parseWithCmlXml(xml),
  },
]

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function convertMpdToJsonString(xml) {
  const response = await fetch('/api/convert-mpd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ xml }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error || `HTTP ${response.status}`
    throw new Error(message)
  }

  if (!payload || typeof payload.jsonString !== 'string') {
    throw new Error('Converter returned an invalid response payload.')
  }

  return payload.jsonString
}

function domNodeToObject(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return {
      nodeName: '#text',
      nodeValue: node.nodeValue,
      attributes: {},
      childNodes: [],
    }
  }

  const attributes = {}
  for (const attr of node.attributes) {
    attributes[attr.name] = attr.value
  }

  const childNodes = []
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const trimmed = child.nodeValue?.trim()
      if (trimmed) {
        childNodes.push(domNodeToObject(child))
      }
      continue
    }

    if (child.nodeType === Node.ELEMENT_NODE) {
      childNodes.push(domNodeToObject(child))
    }
  }

  return {
    nodeName: node.nodeName,
    nodeValue: null,
    attributes,
    childNodes,
  }
}

function parseWithDom(xml) {
  const doc = domParser.parseFromString(xml, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`DOMParser error: ${parserError.textContent}`)
  }
  return domNodeToObject(doc.documentElement)
}

function parseWithCmlXml(xml) {
  return parseXml(xml)
}

async function runBenchmarkOnMainThread(method, xml, jsonString, runs, warmupRuns, onProgress) {
  const totalIterations = warmupRuns + runs
  let measuredTotalMs = 0

  for (let index = 0; index < totalIterations; index += 1) {
    const before = performance.now()
    method.run(xml, jsonString)
    const elapsed = performance.now() - before

    if (index >= warmupRuns) {
      measuredTotalMs += elapsed
    }

    onProgress(index + 1, totalIterations, index < warmupRuns ? 'warmup' : 'measure')
    await nextFrame()
  }

  const avgMs = measuredTotalMs / runs
  const opsPerSecond = (runs / measuredTotalMs) * 1000

  return {
    name: method.name,
    runs,
    warmupRuns,
    totalMs: measuredTotalMs,
    avgMs,
    opsPerSecond,
  }
}

function splitQName(name) {
  const index = name.indexOf(':')
  if (index === -1) {
    return { prefix: null, localName: name }
  }
  return {
    prefix: name.slice(0, index),
    localName: name.slice(index + 1),
  }
}

function joinJsonPath(basePath, key) {
  return basePath ? `${basePath}.${key}` : key
}

function getJsonPathParts(path) {
  if (!path) {
    return []
  }
  const parts = []
  for (const chunk of path.split('.')) {
    const tokenRegex = /([^\[\]]+)|\[(\d+)\]/g
    let match
    while ((match = tokenRegex.exec(chunk)) !== null) {
      if (match[1]) {
        parts.push(match[1])
      } else if (match[2]) {
        parts.push(Number.parseInt(match[2], 10))
      }
    }
  }
  return parts
}

function getJsonPathInfo(root, path) {
  if (!path) {
    return { exists: true, value: root }
  }

  let value = root
  const parts = getJsonPathParts(path)
  for (const part of parts) {
    if (typeof part === 'number') {
      if (!Array.isArray(value) || part < 0 || part >= value.length) {
        return { exists: false, value: undefined }
      }
      value = value[part]
      continue
    }

    if (value === null || typeof value !== 'object' || !(part in value)) {
      return { exists: false, value: undefined }
    }
    value = value[part]
  }

  return { exists: true, value }
}

function addToken(lineTokens, lineIndex, token) {
  if (!lineTokens.has(lineIndex)) {
    lineTokens.set(lineIndex, [])
  }

  const tokens = lineTokens.get(lineIndex)
  if (!tokens.some((item) => item.id === token.id)) {
    tokens.push(token)
  }
}

function resolveChildJsonPath(parentJsonPath, xmlName, occurrenceIndex, jsonRoot) {
  const parentInfo = getJsonPathInfo(jsonRoot, parentJsonPath)
  if (!parentInfo.exists || parentInfo.value === null || typeof parentInfo.value !== 'object') {
    return null
  }

  const { prefix, localName } = splitQName(xmlName)
  let basePath

  if (prefix) {
    if (prefix === 'xsi' || prefix === 'xml') {
      return null
    }
    basePath = joinJsonPath(joinJsonPath(parentJsonPath, prefix), localName)
  } else {
    basePath = joinJsonPath(parentJsonPath, localName)
  }

  const childInfo = getJsonPathInfo(jsonRoot, basePath)
  if (!childInfo.exists) {
    return null
  }

  if (Array.isArray(childInfo.value)) {
    return `${basePath}[${Math.max(0, occurrenceIndex - 1)}]`
  }

  return basePath
}

function resolveAttributeJsonPath(elementJsonPath, xmlAttrName, jsonRoot) {
  if (elementJsonPath == null || xmlAttrName === 'xmlns' || xmlAttrName.startsWith('xmlns:')) {
    return null
  }

  const { prefix, localName } = splitQName(xmlAttrName)
  if (prefix === 'xsi' || prefix === 'xml') {
    return null
  }

  const basePath = prefix
    ? joinJsonPath(joinJsonPath(elementJsonPath, prefix), localName)
    : joinJsonPath(elementJsonPath, localName)

  const info = getJsonPathInfo(jsonRoot, basePath)
  return info.exists ? basePath : null
}

function getLineIndexAtOffset(text, lineStartOffsets, charOffset) {
  let low = 0
  let high = lineStartOffsets.length - 1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (lineStartOffsets[mid] <= charOffset) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return Math.max(0, Math.min(high, lineStartOffsets.length - 1))
}

function buildXmlLineTokens(xmlText, jsonRoot) {
  const lineTokens = new Map()
  const linkMeta = new Map()
  const lineStartOffsets = [0]

  for (let index = 0; index < xmlText.length; index += 1) {
    if (xmlText[index] === '\n') {
      lineStartOffsets.push(index + 1)
    }
  }

  const tagRegex = /<[^>]*>/gms
  const stack = []
  let tagMatch

  while ((tagMatch = tagRegex.exec(xmlText)) !== null) {
    const tag = tagMatch[0]
    const lineIndex = getLineIndexAtOffset(xmlText, lineStartOffsets, tagMatch.index)

    if (tag.startsWith('<?') || tag.startsWith('<!--') || tag.startsWith('<!')) {
      continue
    }

    if (tag.startsWith('</')) {
      if (stack.length > 0) {
        stack.pop()
      }
      continue
    }

    const openMatch = /^<\s*([A-Za-z_][\w:.-]*)/.exec(tag)
    if (!openMatch) {
      continue
    }

    const xmlName = openMatch[1]
    const selfClosing = /\/\s*>$/.test(tag)
    let jsonPath = null

    if (stack.length === 0) {
      jsonPath = ''
    } else {
      const parent = stack[stack.length - 1]
      const occurrence = (parent.childCounts.get(xmlName) || 0) + 1
      parent.childCounts.set(xmlName, occurrence)
      jsonPath = resolveChildJsonPath(parent.jsonPath, xmlName, occurrence, jsonRoot)

      if (jsonPath) {
        const elementId = `el|${jsonPath}`
        const token = {
          id: elementId,
          kind: 'el',
          name: splitQName(xmlName).localName,
        }
        addToken(lineTokens, lineIndex, token)
        linkMeta.set(elementId, token)

        const { prefix: elPrefix } = splitQName(xmlName)
        if (elPrefix && parent.jsonPath != null) {
          const nsGroupPath = joinJsonPath(parent.jsonPath, elPrefix)
          const nsGroupId = `ns|${nsGroupPath}`
          if (!linkMeta.has(nsGroupId)) {
            const nsToken = {
              id: nsGroupId,
              kind: 'ns',
              name: elPrefix,
            }
            addToken(lineTokens, lineIndex, nsToken)
            linkMeta.set(nsGroupId, nsToken)
          }
        }
      }
    }

    const attrRegex = /\s([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g
    let attrMatch
    const seenNsPrefixes = new Set()
    while ((attrMatch = attrRegex.exec(tag)) !== null) {
      const attrOffsetInTag = attrMatch.index + attrMatch[0].indexOf(attrMatch[1])
      const attrLineIndex = getLineIndexAtOffset(
        xmlText,
        lineStartOffsets,
        tagMatch.index + attrOffsetInTag,
      )
      const attrPath = resolveAttributeJsonPath(jsonPath, attrMatch[1], jsonRoot)
      if (!attrPath) {
        continue
      }
      const attrId = `attr|${attrPath}`
      const token = {
        id: attrId,
        kind: 'attr',
        name: splitQName(attrMatch[1]).localName,
      }
      addToken(lineTokens, attrLineIndex, token)
      linkMeta.set(attrId, token)

      const { prefix: attrPrefix } = splitQName(attrMatch[1])
      if (attrPrefix && jsonPath != null && !seenNsPrefixes.has(attrPrefix)) {
        seenNsPrefixes.add(attrPrefix)
        const nsGroupPath = joinJsonPath(jsonPath, attrPrefix)
        const nsGroupId = `ns|${nsGroupPath}`
        if (!linkMeta.has(nsGroupId)) {
          const nsToken = {
            id: nsGroupId,
            kind: 'ns',
            name: attrPrefix,
          }
          addToken(lineTokens, lineIndex, nsToken)
          linkMeta.set(nsGroupId, nsToken)
        }
      }
    }

    if (!selfClosing) {
      stack.push({
        jsonPath,
        childCounts: new Map(),
      })
    }
  }

  return { lineTokens, linkMeta }
}

function buildJsonLineTokens(jsonLines, linkMeta) {
  const lineTokens = new Map()
  const stack = [{ type: 'object', path: '' }]

  const getArrayElementIdsForPath = (arrayPath) => {
    const prefix = `el|${arrayPath}[`
    const items = []

    for (const id of linkMeta.keys()) {
      if (!id.startsWith(prefix)) {
        continue
      }
      const start = prefix.length
      const end = id.indexOf(']', start)
      if (end === -1) {
        continue
      }
      if (end !== id.length - 1) {
        continue
      }
      const rawIndex = id.slice(start, end)
      const index = Number.parseInt(rawIndex, 10)
      if (Number.isFinite(index)) {
        items.push({ id, index })
      }
    }

    items.sort((a, b) => a.index - b.index)
    return items.map((item) => item.id)
  }

  for (let lineIndex = 0; lineIndex < jsonLines.length; lineIndex += 1) {
    const line = jsonLines[lineIndex]
    const trimmed = line.trim()

    const top = stack[stack.length - 1]
    if (trimmed.startsWith('{') && top?.type === 'array') {
      const itemIndex = top.nextIndex
      top.nextIndex += 1
      const itemPath = `${top.path}[${itemIndex}]`
      const elementId = `el|${itemPath}`
      if (linkMeta.has(elementId)) {
        addToken(lineTokens, lineIndex, linkMeta.get(elementId))
      }
      stack.push({ type: 'object', path: itemPath })
      continue
    }

    const keyMatch = /^"([^"]+)":\s*(.*)$/.exec(trimmed)
    if (keyMatch) {
      const objectContext = stack[stack.length - 1]
      const objectPath = objectContext?.type === 'object' ? objectContext.path : ''
      const key = keyMatch[1]
      const keyValue = keyMatch[2]
      const keyPath = joinJsonPath(objectPath, key)

      const attrId = `attr|${keyPath}`
      if (linkMeta.has(attrId)) {
        addToken(lineTokens, lineIndex, linkMeta.get(attrId))
      }

      const elementId = `el|${keyPath}`
      if (linkMeta.has(elementId)) {
        addToken(lineTokens, lineIndex, linkMeta.get(elementId))
      }

      const nsId = `ns|${keyPath}`
      if (linkMeta.has(nsId)) {
        addToken(lineTokens, lineIndex, linkMeta.get(nsId))
      }

      if (keyValue.endsWith('{')) {
        stack.push({ type: 'object', path: keyPath })
      } else if (keyValue.endsWith('[')) {
        const arrayItemIds = getArrayElementIdsForPath(keyPath)
        for (const id of arrayItemIds) {
          const token = linkMeta.get(id)
          if (token) {
            addToken(lineTokens, lineIndex, token)
          }
        }
        stack.push({ type: 'array', path: keyPath, nextIndex: 0 })
      }
      continue
    }

    if (trimmed.startsWith('}') && stack[stack.length - 1]?.type === 'object') {
      stack.pop()
      continue
    }

    if (trimmed.startsWith(']') && stack[stack.length - 1]?.type === 'array') {
      stack.pop()
    }
  }

  return lineTokens
}

function highlightXmlLine(line, lineTokens = []) {
  let html = escapeHtml(line)
  const tokens = []
  const stash = (markup) => {
    const tokenId = `%%HL${tokens.length}%%`
    tokens.push(markup)
    return tokenId
  }

  html = html.replace(/("[^"]*"|'[^']*')/g, (value) => stash(`<span class="tok-str">${value}</span>`))
  html = html.replace(/(&lt;\/?\s*)([A-Za-z_][\w:.-]*)/g, (_, open, name) => `${open}${stash(`<span class="tok-tag">${name}</span>`)}`)
  html = html.replace(/(\s)([A-Za-z_][\w:.-]*)(\s*=)/g, (_, space, name, suffix) => `${space}${stash(`<span class="tok-attr">${name}</span>`)}${suffix}`)
  html = html.replace(/%%HL(\d+)%%/g, (_, index) => tokens[Number(index)] ?? '')

  for (const token of lineTokens) {
    if (token.kind === 'ns') {
      continue
    }
    const targetClass = token.kind === 'el' ? 'tok-tag' : 'tok-attr'
    const pattern = new RegExp(`<span class="${targetClass}">(${escapeRegExp(token.name)})<\\/span>`)
    html = html.replace(pattern, `<span class="${targetClass} token-link" data-link-id="${token.id}">$1</span>`)
  }

  return html
}

function highlightJsonLine(line, lineTokens = []) {
  let html = escapeHtml(line)
  const tokens = []
  const stash = (markup) => {
    const tokenId = `%%HL${tokens.length}%%`
    tokens.push(markup)
    return tokenId
  }

  html = html.replace(/^\s*"([^"]+)":/, (full, key) => full.replace(`"${key}"`, stash(`<span class="tok-key">"${key}"</span>`)))
  html = html.replace(/:\s*"([^"]*)"/g, (_, value) => `: ${stash(`<span class="tok-str">"${value}"</span>`)}`)
  html = html.replace(/:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (_, value) => `: ${stash(`<span class="tok-num">${value}</span>`)}`)
  html = html.replace(/:\s*(true|false|null)/g, (_, value) => `: ${stash(`<span class="tok-lit">${value}</span>`)}`)
  html = html.replace(/%%HL(\d+)%%/g, (_, index) => tokens[Number(index)] ?? '')

  for (const token of lineTokens) {
    const key = token.name
    const cssClass = token.kind === 'ns' ? 'tok-key tok-ns' : 'tok-key'
    const pattern = new RegExp(`<span class="tok-key">"(${escapeRegExp(key)})"<\\/span>`)
    html = html.replace(pattern, `<span class="${cssClass} token-link" data-link-id="${token.id}">"$1"</span>`)
  }

  return html
}

document.querySelector('#app').innerHTML = `
  <main class="layout">
    <header>
      <h1>MPD Parser Benchmark + Visual Compare</h1>
      <p>Benchmark parsing paths and inspect synchronized XML to JSON mapping. <a href="/compare.html">XSD vs JSON Schema Compare</a></p>
    </header>

    <section class="panel controls">
      <div class="row">
        <label for="exampleSelect">Example MPD</label>
        <select id="exampleSelect"></select>
      </div>

      <div class="row url-row">
        <label for="urlInput">Remote MPD URL</label>
        <div class="url-controls">
          <input id="urlInput" type="url" placeholder="https://example.com/manifest.mpd" />
          <button id="loadUrlButton" type="button">Load URL</button>
        </div>
      </div>

      <div class="grid-two">
        <div class="row">
          <label for="runsInput">Measured runs</label>
          <input id="runsInput" type="number" min="1" step="1" value="1000" />
        </div>

        <div class="row">
          <label for="warmupInput">Warmup runs</label>
          <input id="warmupInput" type="number" min="0" step="1" value="100" />
        </div>
      </div>

      <div class="actions">
        <button id="convertButton" type="button">Convert MPD -> JSON String</button>
        <button id="runButton" type="button">Run Benchmark</button>
      </div>

      <div class="progress-block">
        <div class="progress-meta">
          <span id="progressLabel">Idle</span>
          <span id="progressPercent">0%</span>
        </div>
        <div class="progress-track">
          <div id="progressFill" class="progress-fill"></div>
        </div>
      </div>

      <p class="hint">Note: URL loading requires CORS access from the target MPD endpoint.</p>
      <p id="status" class="status">Ready.</p>
    </section>

    <section class="panel info">
      <div><strong>XML size:</strong> <span id="xmlSize">-</span></div>
      <div><strong>JSON size:</strong> <span id="jsonSize">-</span></div>
    </section>

    <section class="panel compare">
      <h2>Visual Compare</h2>
      <p id="compareHint" class="hint">Convert first, then click highlighted tags/attributes or keys to link both sides.</p>
      <div class="token-nav">
        <label for="tokenSelect">Token Navigator</label>
        <div class="token-nav-controls">
          <button id="tokenPrevButton" type="button">Prev</button>
          <select id="tokenSelect" title="Use mouse wheel while hovering to cycle tokens."></select>
          <button id="tokenNextButton" type="button">Next</button>
        </div>
        <p id="tokenStatus" class="hint">No token links available.</p>
      </div>
      <div class="compare-grid">
        <div>
          <h3>MPD XML</h3>
          <div id="xmlCode" class="code-pane"></div>
        </div>
        <div>
          <h3>Converted JSON</h3>
          <div id="jsonCode" class="code-pane"></div>
        </div>
      </div>
      <p id="linkStatus" class="hint">No active link.</p>
    </section>

    <section class="panel results">
      <h2>Results</h2>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Warmup</th>
            <th>Runs</th>
            <th>Total (ms)</th>
            <th>Avg (ms)</th>
            <th>Ops/s</th>
            <th>Delta vs DOM</th>
          </tr>
        </thead>
        <tbody id="resultsBody"></tbody>
      </table>
    </section>
  </main>
`

const exampleSelect = document.querySelector('#exampleSelect')
const urlInput = document.querySelector('#urlInput')
const loadUrlButton = document.querySelector('#loadUrlButton')
const runsInput = document.querySelector('#runsInput')
const warmupInput = document.querySelector('#warmupInput')
const convertButton = document.querySelector('#convertButton')
const runButton = document.querySelector('#runButton')
const statusNode = document.querySelector('#status')
const xmlSizeNode = document.querySelector('#xmlSize')
const jsonSizeNode = document.querySelector('#jsonSize')
const resultsBody = document.querySelector('#resultsBody')
const progressFill = document.querySelector('#progressFill')
const progressLabel = document.querySelector('#progressLabel')
const progressPercent = document.querySelector('#progressPercent')
const compareHint = document.querySelector('#compareHint')
const xmlCode = document.querySelector('#xmlCode')
const jsonCode = document.querySelector('#jsonCode')
const linkStatus = document.querySelector('#linkStatus')
const tokenPrevButton = document.querySelector('#tokenPrevButton')
const tokenNextButton = document.querySelector('#tokenNextButton')
const tokenSelect = document.querySelector('#tokenSelect')
const tokenStatus = document.querySelector('#tokenStatus')

let currentXml = ''
let currentJsonString = ''
let currentLinkMeta = new Map()
let currentTokenOrder = []
let currentTokenIndex = -1
let lastNavigationPane = null
let isSyncingScroll = false

function formatBytes(size) {
  return new Intl.NumberFormat().format(size)
}

function setStatus(message, isError = false) {
  statusNode.textContent = message
  statusNode.classList.toggle('error', isError)
}

function resetProgress() {
  progressFill.style.width = '0%'
  progressLabel.textContent = 'Idle'
  progressPercent.textContent = '0%'
}

function setProgress(done, total, label) {
  const safeTotal = Math.max(total, 1)
  const percent = Math.min(100, (done / safeTotal) * 100)
  progressFill.style.width = `${percent.toFixed(2)}%`
  progressLabel.textContent = label
  progressPercent.textContent = `${percent.toFixed(1)}%`
}

function clearActiveLink() {
  for (const node of document.querySelectorAll('.active-link')) {
    node.classList.remove('active-link')
  }
  for (const node of document.querySelectorAll('.active-token')) {
    node.classList.remove('active-token')
  }
  linkStatus.textContent = 'No active link.'
}

function findFirstLinkedLine(container, linkId) {
  const lines = container.querySelectorAll('.code-line[data-links]')
  for (const line of lines) {
    const links = (line.dataset.links || '').split(',').filter(Boolean)
    if (links.includes(linkId)) {
      return line
    }
  }
  return null
}

function findLinkedLines(container, linkId) {
  const matches = []
  const lines = container.querySelectorAll('.code-line[data-links]')
  for (const line of lines) {
    const links = (line.dataset.links || '').split(',').filter(Boolean)
    if (links.includes(linkId)) {
      matches.push(line)
    }
  }
  return matches
}

function getPeerPane(container) {
  return container === xmlCode ? jsonCode : xmlCode
}

function getScrollRatio(container) {
  const maxScroll = container.scrollHeight - container.clientHeight
  return maxScroll > 0 ? container.scrollTop / maxScroll : 0
}

function setScrollRatio(container, ratio) {
  const maxScroll = container.scrollHeight - container.clientHeight
  if (maxScroll > 0) {
    container.scrollTop = Math.round(ratio * maxScroll)
  }
}

let syncScrollTimer = null

function syncScrollHandler(source, target) {
  if (isSyncingScroll) {
    return
  }
  isSyncingScroll = true
  const verticalRatio = getScrollRatio(source)
  setScrollRatio(target, verticalRatio)
  clearTimeout(syncScrollTimer)
  syncScrollTimer = setTimeout(() => {
    isSyncingScroll = false
  }, 30)
}

function findNearestLinkedLine(container, linkId) {
  const lines = findLinkedLines(container, linkId)
  if (lines.length === 0) {
    return null
  }
  if (lines.length === 1) {
    return lines[0]
  }

  const viewportCenter = container.scrollTop + Math.floor(container.clientHeight / 2)
  let bestLine = lines[0]
  let bestDistance = Math.abs(lines[0].offsetTop - viewportCenter)

  for (let i = 1; i < lines.length; i += 1) {
    const distance = Math.abs(lines[i].offsetTop - viewportCenter)
    if (distance < bestDistance) {
      bestLine = lines[i]
      bestDistance = distance
    }
  }

  return bestLine
}

function getTokenAbsoluteLeft(token, container) {
  const tokenRect = token.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return tokenRect.left - containerRect.left + container.scrollLeft
}

function ensureTokenHorizontallyVisible(container, line, linkId) {
  const tokenEl = line.querySelector(`.token-link[data-link-id="${CSS.escape(linkId)}"]`) || line
  const absLeft = getTokenAbsoluteLeft(tokenEl, container)
  const absRight = absLeft + tokenEl.offsetWidth

  if (absLeft < container.scrollLeft) {
    container.scrollLeft = Math.max(0, absLeft - 16)
  } else if (absRight > container.scrollLeft + container.clientWidth) {
    container.scrollLeft = Math.max(0, absRight - container.clientWidth + 16)
  }
}

function getVisualYInPane(container, line) {
  return line.offsetTop - container.scrollTop
}

function scrollPaneToAlignLineAtY(container, line, targetY) {
  container.scrollTop = Math.max(0, line.offsetTop - targetY)
}

function centerLineInPane(container, line) {
  const centerY = Math.floor(container.clientHeight / 2)
  scrollPaneToAlignLineAtY(container, line, centerY)
}

function alignPeerPaneOnClick(linkId, sourceContainer) {
  const source = sourceContainer
  const target = getPeerPane(source)

  const sourceLine = findNearestLinkedLine(source, linkId)
  const targetLine = findNearestLinkedLine(target, linkId)

  isSyncingScroll = true
  try {
    if (sourceLine && targetLine) {
      const sourceVisualY = getVisualYInPane(source, sourceLine)
      scrollPaneToAlignLineAtY(target, targetLine, sourceVisualY)

      const targetVisualY = getVisualYInPane(target, targetLine)
      if (Math.abs(sourceVisualY - targetVisualY) > 2) {
        scrollPaneToAlignLineAtY(source, sourceLine, targetVisualY)
      }

      ensureTokenHorizontallyVisible(source, sourceLine, linkId)
      ensureTokenHorizontallyVisible(target, targetLine, linkId)
    } else if (targetLine) {
      centerLineInPane(target, targetLine)
      ensureTokenHorizontallyVisible(target, targetLine, linkId)
    } else if (sourceLine) {
      ensureTokenHorizontallyVisible(source, sourceLine, linkId)
    }
  } finally {
    clearTimeout(syncScrollTimer)
    syncScrollTimer = setTimeout(() => {
      isSyncingScroll = false
    }, 50)
  }
}

function alignBothPanesOnNav(linkId, primaryContainer) {
  const primary = primaryContainer
  const secondary = getPeerPane(primary)

  const primaryLine = findNearestLinkedLine(primary, linkId)
  const secondaryLine = findNearestLinkedLine(secondary, linkId)

  isSyncingScroll = true
  try {
    if (primaryLine && secondaryLine) {
      centerLineInPane(primary, primaryLine)
      const primaryVisualY = getVisualYInPane(primary, primaryLine)
      scrollPaneToAlignLineAtY(secondary, secondaryLine, primaryVisualY)

      const secondaryVisualY = getVisualYInPane(secondary, secondaryLine)
      if (Math.abs(primaryVisualY - secondaryVisualY) > 2) {
        scrollPaneToAlignLineAtY(primary, primaryLine, secondaryVisualY)
      }

      ensureTokenHorizontallyVisible(primary, primaryLine, linkId)
      ensureTokenHorizontallyVisible(secondary, secondaryLine, linkId)
    } else if (primaryLine) {
      centerLineInPane(primary, primaryLine)
      ensureTokenHorizontallyVisible(primary, primaryLine, linkId)
    } else if (secondaryLine) {
      centerLineInPane(secondary, secondaryLine)
      ensureTokenHorizontallyVisible(secondary, secondaryLine, linkId)
    }
  } finally {
    clearTimeout(syncScrollTimer)
    syncScrollTimer = setTimeout(() => {
      isSyncingScroll = false
    }, 50)
  }
}

function describeToken(linkId) {
  const meta = currentLinkMeta.get(linkId)
  const path = linkId.includes('|') ? linkId.slice(linkId.indexOf('|') + 1) : linkId
  if (!meta) {
    return path
  }

  const kindLabel = meta.kind === 'attr' ? 'Attribute' : meta.kind === 'ns' ? 'Namespace' : 'Element'
  return `${kindLabel}: ${meta.name} (${path})`
}

function getOrderedAvailableLinkIds() {
  const ordered = []
  const seen = new Set()
  const collect = (container) => {
    for (const tokenNode of container.querySelectorAll('.token-link[data-link-id]')) {
      const linkId = tokenNode.dataset.linkId
      if (!linkId || seen.has(linkId)) {
        continue
      }
      seen.add(linkId)
      ordered.push(linkId)
    }
  }

  collect(xmlCode)
  collect(jsonCode)
  return ordered
}

function updateTokenNavigatorStatus() {
  const total = currentTokenOrder.length
  if (total === 0 || currentTokenIndex < 0) {
    tokenStatus.textContent = total === 0
      ? 'No token links available.'
      : `${total} linked tokens available. Use Prev/Next or mouse wheel on the picker.`
    return
  }

  tokenStatus.textContent = `${currentTokenIndex + 1}/${total}: ${describeToken(currentTokenOrder[currentTokenIndex])}`
}

function syncTokenNavigatorToLink(linkId) {
  const index = currentTokenOrder.indexOf(linkId)
  if (index === -1) {
    return
  }

  currentTokenIndex = index
  if (tokenSelect.value !== linkId) {
    tokenSelect.value = linkId
  }
  updateTokenNavigatorStatus()
}

function refreshTokenNavigator() {
  currentTokenOrder = getOrderedAvailableLinkIds()
  const previousId = currentTokenOrder[currentTokenIndex] || tokenSelect.value

  tokenSelect.innerHTML = ''
  for (const linkId of currentTokenOrder) {
    const option = document.createElement('option')
    option.value = linkId
    option.textContent = describeToken(linkId)
    tokenSelect.appendChild(option)
  }

  if (currentTokenOrder.length === 0) {
    currentTokenIndex = -1
    tokenPrevButton.disabled = true
    tokenNextButton.disabled = true
    tokenSelect.disabled = true
    updateTokenNavigatorStatus()
    return
  }

  const matchedIndex = previousId ? currentTokenOrder.indexOf(previousId) : -1
  currentTokenIndex = matchedIndex >= 0 ? matchedIndex : 0
  tokenSelect.value = currentTokenOrder[currentTokenIndex]
  tokenPrevButton.disabled = false
  tokenNextButton.disabled = false
  tokenSelect.disabled = false
  updateTokenNavigatorStatus()
}

function stepTokenSelection(delta) {
  const total = currentTokenOrder.length
  if (total === 0) {
    return
  }

  if (currentTokenIndex < 0) {
    currentTokenIndex = 0
  } else {
    currentTokenIndex = (currentTokenIndex + delta + total) % total
  }

  const linkId = currentTokenOrder[currentTokenIndex]
  tokenSelect.value = linkId
  activateLink(linkId, getLargerPane(), 'nav')
}

function getLargerPane() {
  const xmlLines = xmlCode.querySelectorAll('.code-line').length
  const jsonLines = jsonCode.querySelectorAll('.code-line').length
  return jsonLines >= xmlLines ? jsonCode : xmlCode
}

function activateLink(linkId, sourceContainer, mode = 'click') {
  clearActiveLink()

  if (sourceContainer) {
    lastNavigationPane = sourceContainer
  }

  const lines = document.querySelectorAll('.code-line[data-links]')

  let hitCount = 0
  for (const line of lines) {
    const links = (line.dataset.links || '').split(',').filter(Boolean)
    if (links.includes(linkId)) {
      line.classList.add('active-link')
      hitCount += 1
    }
  }

  for (const token of document.querySelectorAll(`.token-link[data-link-id="${CSS.escape(linkId)}"]`)) {
    token.classList.add('active-token')
    token.classList.remove('flash-highlight')
    void token.offsetWidth
    token.classList.add('flash-highlight')
  }

  const meta = currentLinkMeta.get(linkId)
  const label = meta?.kind === 'attr' ? 'Attribute' : meta?.kind === 'ns' ? 'Namespace' : 'Element'
  const tokenName = meta?.name || linkId
  linkStatus.textContent = `${label} ${tokenName} linked across ${hitCount} lines.`

  if (mode === 'click') {
    alignPeerPaneOnClick(linkId, sourceContainer || lastNavigationPane || xmlCode)
  } else {
    const primary = sourceContainer || getLargerPane()
    alignBothPanesOnNav(linkId, primary)
  }
  syncTokenNavigatorToLink(linkId)
}

function renderCodePane(container, lines, lineTokensMap, kind) {
  container.innerHTML = ''
  const existingNote = container.parentElement.querySelector('.render-note')
  if (existingNote) {
    existingNote.remove()
  }
  const fragment = document.createDocumentFragment()

  const limitedLines = lines.slice(0, MAX_RENDER_LINES)
  for (let index = 0; index < limitedLines.length; index += 1) {
    const line = limitedLines[index]
    const lineTokens = lineTokensMap.get(index) || []
    const links = lineTokens.map((token) => token.id)

    const lineNode = document.createElement('div')
    lineNode.className = 'code-line'
    if (links.length > 0) {
      lineNode.dataset.links = links.join(',')
    }

    const number = document.createElement('span')
    number.className = 'line-number'
    number.textContent = String(index + 1)

    const content = document.createElement('span')
    content.className = 'line-content'
    content.innerHTML = kind === 'xml' ? highlightXmlLine(line, lineTokens) : highlightJsonLine(line, lineTokens)

    lineNode.append(number, content)
    fragment.appendChild(lineNode)
  }

  container.appendChild(fragment)

  if (lines.length > MAX_RENDER_LINES) {
    const notice = document.createElement('p')
    notice.className = 'hint render-note'
    notice.textContent = `Rendering truncated to ${MAX_RENDER_LINES.toLocaleString()} lines for responsiveness.`
    container.parentElement.appendChild(notice)
  }
}

function bindLinkSelection(container) {
  container.addEventListener('click', (event) => {
    const token = event.target.closest('.token-link')
    if (token) {
      activateLink(token.dataset.linkId, container)
      return
    }

    const line = event.target.closest('.code-line[data-links]')
    if (!line) {
      return
    }

    const links = (line.dataset.links || '').split(',').filter(Boolean)
    if (links.length > 0) {
      activateLink(links[0], container)
    }
  })
}

function renderVisualCompare(xmlText, jsonString) {
  xmlCode.innerHTML = ''
  jsonCode.innerHTML = ''
  compareHint.textContent = 'Panes scroll in sync. Click highlighted tokens or use the navigator to jump between links.'
  clearActiveLink()

  const jsonData = JSON.parse(jsonString)
  const prettyJson = JSON.stringify(jsonData, null, 2)
  const xmlLines = xmlText.split('\n')
  const jsonLines = prettyJson.split('\n')
  const xmlResult = buildXmlLineTokens(xmlText, jsonData)
  const jsonLinks = buildJsonLineTokens(jsonLines, xmlResult.linkMeta)

  currentLinkMeta = xmlResult.linkMeta

  renderCodePane(xmlCode, xmlLines, xmlResult.lineTokens, 'xml')
  renderCodePane(jsonCode, jsonLines, jsonLinks, 'json')
  refreshTokenNavigator()
}

bindLinkSelection(xmlCode)
bindLinkSelection(jsonCode)

xmlCode.addEventListener('scroll', () => syncScrollHandler(xmlCode, jsonCode))
jsonCode.addEventListener('scroll', () => syncScrollHandler(jsonCode, xmlCode))

tokenPrevButton.addEventListener('click', () => {
  stepTokenSelection(-1)
})

tokenNextButton.addEventListener('click', () => {
  stepTokenSelection(1)
})

tokenSelect.addEventListener('change', () => {
  const linkId = tokenSelect.value
  if (!linkId) {
    return
  }
  activateLink(linkId, getLargerPane(), 'nav')
})

tokenSelect.addEventListener('wheel', (event) => {
  if (currentTokenOrder.length === 0) {
    return
  }
  event.preventDefault()
  stepTokenSelection(event.deltaY > 0 ? 1 : -1)
}, { passive: false })

function renderResults(results) {
  resultsBody.innerHTML = ''
  const domBaseline = results.find((row) => row.name === 'DOMParser -> object')

  for (const row of results) {
    let deltaText = '-'
    if (domBaseline && domBaseline.opsPerSecond > 0 && row.name !== domBaseline.name) {
      const ratio = (row.opsPerSecond / domBaseline.opsPerSecond) - 1
      const percent = Math.round(Math.abs(ratio) * 100)
      deltaText = ratio >= 0 ? `${percent}% faster` : `${percent}% slower`
    }

    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${row.name}</td>
      <td>${row.warmupRuns}</td>
      <td>${row.runs}</td>
      <td>${Math.round(row.totalMs)}</td>
      <td>${Math.round(row.avgMs)}</td>
      <td>${Math.round(row.opsPerSecond)}</td>
      <td>${deltaText}</td>
    `
    resultsBody.appendChild(tr)
  }
}

function setXmlSource(xml) {
  currentXml = xml
  currentJsonString = ''
  xmlSizeNode.textContent = `${formatBytes(xml.length)} chars`
  jsonSizeNode.textContent = '-'
  resultsBody.innerHTML = ''
  xmlCode.innerHTML = ''
  jsonCode.innerHTML = ''
  compareHint.textContent = 'Convert first, then click highlighted tags/attributes or keys to link both sides.'
  clearActiveLink()
  currentLinkMeta = new Map()
  currentTokenOrder = []
  currentTokenIndex = -1
  lastNavigationPane = null
  isSyncingScroll = false
  refreshTokenNavigator()
  resetProgress()
  setStatus('MPD loaded. Convert to JSON string when ready.')
}

async function loadExampleByPath(examplePath) {
  const selected = parsedExamples.find((item) => item.path === examplePath)
  if (!selected) {
    return
  }

  setStatus('Loading example...')
  const response = await fetch(selected.url)
  if (!response.ok) {
    throw new Error(`Failed to load example: HTTP ${response.status}`)
  }
  const xml = await response.text()
  setXmlSource(xml)
}

for (const item of parsedExamples) {
  const option = document.createElement('option')
  option.value = item.path
  option.textContent = item.label
  exampleSelect.appendChild(option)
}

if (parsedExamples.length > 0) {
  exampleSelect.value = parsedExamples[0].path
  loadExampleByPath(parsedExamples[0].path).catch((error) => {
    setStatus(`Example load failed: ${String(error)}`, true)
  })
}

exampleSelect.addEventListener('change', async () => {
  try {
    await loadExampleByPath(exampleSelect.value)
  } catch (error) {
    setStatus(`Example load failed: ${String(error)}`, true)
  }
})

loadUrlButton.addEventListener('click', async () => {
  const url = urlInput.value.trim()
  if (!url) {
    setStatus('Please enter a URL.', true)
    return
  }

  setStatus('Loading MPD URL...')
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const text = await response.text()
    setXmlSource(text)
    setStatus('URL loaded successfully.')
  } catch (error) {
    setStatus(`Failed to load URL: ${String(error)}`, true)
  }
})

convertButton.addEventListener('click', async () => {
  if (!currentXml) {
    setStatus('No MPD source is loaded.', true)
    return
  }

  convertButton.disabled = true
  runButton.disabled = true

  try {
    setStatus('Converting with json-scheme MPDConverter...')
    currentJsonString = await convertMpdToJsonString(currentXml)
    jsonSizeNode.textContent = `${formatBytes(currentJsonString.length)} chars`
    resultsBody.innerHTML = ''
    resetProgress()
    renderVisualCompare(currentXml, currentJsonString)
    setStatus('Converted MPD XML using json-scheme MPDConverter and refreshed visual compare.')
  } catch (error) {
    setStatus(`Conversion failed: ${String(error)}`, true)
  } finally {
    convertButton.disabled = false
    runButton.disabled = false
  }
})

runButton.addEventListener('click', async () => {
  const runs = Number.parseInt(runsInput.value, 10)
  const warmupRuns = Number.parseInt(warmupInput.value, 10)

  if (!Number.isFinite(runs) || runs < 1) {
    setStatus('Measured runs must be a positive integer.', true)
    return
  }

  if (!Number.isFinite(warmupRuns) || warmupRuns < 0) {
    setStatus('Warmup runs must be a non-negative integer.', true)
    return
  }

  if (!currentXml) {
    setStatus('No MPD source is loaded.', true)
    return
  }

  if (!currentJsonString) {
    setStatus('Convert XML to JSON string first.', true)
    return
  }

  const iterationsPerMethod = runs + warmupRuns
  const overallTotal = Math.max(iterationsPerMethod * benchmarkMethods.length, 1)

  runButton.disabled = true
  convertButton.disabled = true
  loadUrlButton.disabled = true
  exampleSelect.disabled = true
  setProgress(0, overallTotal, 'Starting...')

  try {
    setStatus(`Running benchmark (${runs} measured, ${warmupRuns} warmup)...`)
    const results = []

    for (const [methodIndex, method] of benchmarkMethods.entries()) {
      const result = await runBenchmarkOnMainThread(
        method,
        currentXml,
        currentJsonString,
        runs,
        warmupRuns,
        (iterationDone, methodTotal, phase) => {
          const overallCompleted = methodIndex * methodTotal + iterationDone
          setProgress(overallCompleted, overallTotal, `${method.name} (${phase})`)
        },
      )
      results.push(result)
    }

    renderResults(results)
    setProgress(overallTotal, overallTotal, 'Completed')
    setStatus('Benchmark completed.')
  } catch (error) {
    setStatus(`Benchmark failed: ${String(error)}`, true)
  } finally {
    runButton.disabled = false
    convertButton.disabled = false
    loadUrlButton.disabled = false
    exampleSelect.disabled = false
  }
})

resetProgress()
