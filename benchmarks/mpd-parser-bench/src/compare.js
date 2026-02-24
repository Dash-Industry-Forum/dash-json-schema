import './compare.css'

const MAX_RENDER_LINES = 8000

const xsdFiles = [
  { label: 'DASH-MPD.xsd', path: 'DASH-MPD.xsd' },
  { label: 'DASH-MPD-UP.xsd', path: 'DASH-MPD-UP.xsd' },
  { label: 'DASH-MPD-PATCH.xsd', path: 'DASH-MPD-PATCH.xsd' },
  { label: 'CENC.xsd', path: 'CENC.xsd' },
  { label: 'xlink.xsd', path: 'xlink.xsd' },
]

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function convertXsdToJsonSchema(xsdPath) {
  const response = await fetch('/api/convert-xsd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xsdPath }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error || `HTTP ${response.status}`
    throw new Error(message)
  }

  if (!payload || typeof payload.jsonSchema !== 'string') {
    throw new Error('Converter returned an invalid response payload.')
  }

  return payload.jsonSchema
}

async function loadXsdSource(xsdPath) {
  const response = await fetch('/api/read-xsd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xsdPath }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error || `HTTP ${response.status}`
    throw new Error(message)
  }

  if (!payload || typeof payload.content !== 'string') {
    throw new Error('Failed to read XSD file.')
  }

  return payload.content
}

// --- Token linking between XSD and JSON Schema ---
//
// We link XSD type definitions (complexType, simpleType, group, attributeGroup,
// element) to their corresponding JSON Schema $defs entries. The link ID format
// is:  type|<typeName>   for type definitions
//      attr|<typeName>.<attrName>   for attributes within types
//      el|<typeName>.<elementName>  for child elements within types

function buildXsdLineTokens(xsdText) {
  const lineTokens = new Map()
  const linkMeta = new Map()
  const lines = xsdText.split('\n')

  // Match type definitions: complexType, simpleType, group, attributeGroup, element (top-level)
  const typeDefRegex = /(?:complexType|simpleType|group|attributeGroup)\s+name\s*=\s*"([^"]+)"/
  const topElementRegex = /<xs:element\s+name\s*=\s*"([^"]+)"/
  const attrRegex = /<xs:attribute\s+[^>]*name\s*=\s*"([^"]+)"/
  const elementRefRegex = /<xs:element\s+[^>]*(?:name|ref)\s*=\s*"([^"]+)"/
  const extensionBaseRegex = /<xs:(?:extension|restriction)\s+base\s*=\s*"([^"]+)"/
  const typeRefRegex = /\btype\s*=\s*"([^"]+)"/

  function addToken(lineIndex, token) {
    if (!lineTokens.has(lineIndex)) {
      lineTokens.set(lineIndex, [])
    }
    const tokens = lineTokens.get(lineIndex)
    if (!tokens.some((item) => item.id === token.id)) {
      tokens.push(token)
    }
  }

  // Track current complexType/simpleType context for attribute/element linking
  let currentType = null
  const typeStack = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]

    // Track type definition context
    const typeMatch = typeDefRegex.exec(line)
    if (typeMatch) {
      const typeName = typeMatch[1]
      currentType = typeName
      typeStack.push(typeName)

      const id = `type|${typeName}`
      const token = { id, kind: 'type', name: typeName }
      addToken(lineIndex, token)
      linkMeta.set(id, token)
    }

    // Top-level element definition
    const topElMatch = topElementRegex.exec(line)
    if (topElMatch && typeStack.length === 0) {
      const elName = topElMatch[1]
      const id = `type|${elName}`
      const token = { id, kind: 'type', name: elName }
      addToken(lineIndex, token)
      linkMeta.set(id, token)
    }

    // Attribute within a type
    const attrMatch = attrRegex.exec(line)
    if (attrMatch && currentType) {
      const attrName = attrMatch[1]
      const id = `attr|${currentType}.${attrName}`
      const token = { id, kind: 'attr', name: attrName, parentType: currentType }
      addToken(lineIndex, token)
      linkMeta.set(id, token)
    }

    // Child element within a type
    const elMatch = elementRefRegex.exec(line)
    if (elMatch && currentType && !topElMatch) {
      const elName = elMatch[1].includes(':') ? elMatch[1].split(':').pop() : elMatch[1]
      const id = `el|${currentType}.${elName}`
      const token = { id, kind: 'el', name: elName, parentType: currentType }
      addToken(lineIndex, token)
      linkMeta.set(id, token)
    }

    // Extension/restriction base type reference
    const extMatch = extensionBaseRegex.exec(line)
    if (extMatch) {
      const baseName = extMatch[1].includes(':') ? extMatch[1].split(':').pop() : extMatch[1]
      const id = `type|${baseName}`
      if (!linkMeta.has(id)) {
        const token = { id, kind: 'type', name: baseName }
        linkMeta.set(id, token)
      }
      addToken(lineIndex, linkMeta.get(id))
    }

    // Type references in type="..." attributes
    const typeRefMatch = typeRefRegex.exec(line)
    if (typeRefMatch && !typeMatch) {
      const refName = typeRefMatch[1].includes(':') ? typeRefMatch[1].split(':').pop() : typeRefMatch[1]
      // Only link to known/custom types, skip XSD built-in types
      const builtinTypes = new Set([
        'string', 'boolean', 'integer', 'int', 'long', 'short', 'byte',
        'decimal', 'float', 'double', 'duration', 'dateTime', 'time', 'date',
        'anyURI', 'unsignedInt', 'unsignedLong', 'unsignedShort', 'unsignedByte',
        'positiveInteger', 'nonNegativeInteger', 'nonPositiveInteger', 'negativeInteger',
        'hexBinary', 'base64Binary', 'token', 'normalizedString', 'language', 'ID', 'IDREF',
        'anyType', 'anySimpleType',
      ])
      if (!builtinTypes.has(refName)) {
        const id = `type|${refName}`
        if (!linkMeta.has(id)) {
          const token = { id, kind: 'type', name: refName }
          linkMeta.set(id, token)
        }
        addToken(lineIndex, linkMeta.get(id))
      }
    }

    // Track closing of type definitions
    if (line.includes('</xs:complexType') || line.includes('</xs:simpleType') ||
        line.includes('</xs:group') || line.includes('</xs:attributeGroup')) {
      typeStack.pop()
      currentType = typeStack.length > 0 ? typeStack[typeStack.length - 1] : null
    }
  }

  return { lineTokens, linkMeta }
}

function buildJsonSchemaLineTokens(jsonLines, linkMeta) {
  const lineTokens = new Map()

  function addToken(lineIndex, token) {
    if (!lineTokens.has(lineIndex)) {
      lineTokens.set(lineIndex, [])
    }
    const tokens = lineTokens.get(lineIndex)
    if (!tokens.some((item) => item.id === token.id)) {
      tokens.push(token)
    }
  }

  // Track JSON structure to understand context
  const stack = [] // { type: 'object'|'array', key: string }
  let inDefs = false
  let currentDefName = null
  let braceDepth = 0
  let defStartDepth = 0

  for (let lineIndex = 0; lineIndex < jsonLines.length; lineIndex++) {
    const line = jsonLines[lineIndex]
    const trimmed = line.trim()

    // Track $defs section
    const keyMatch = /^"([^"]+)":\s*(.*)$/.exec(trimmed)
    if (keyMatch) {
      const key = keyMatch[1]
      const rest = keyMatch[2]

      // Entering $defs
      if (key === '$defs' && rest.startsWith('{')) {
        inDefs = true
        braceDepth = 1
        continue
      }

      // Inside $defs - type definition
      if (inDefs && currentDefName === null && rest.startsWith('{')) {
        currentDefName = key
        defStartDepth = braceDepth
        braceDepth += 1

        const typeId = `type|${key}`
        if (linkMeta.has(typeId)) {
          addToken(lineIndex, linkMeta.get(typeId))
        }
        continue
      }

      // Inside a type definition - look for properties/attributes
      if (inDefs && currentDefName) {
        // Match property names inside "properties" object
        if (key === 'properties' && rest.startsWith('{')) {
          // Skip the "properties" key line itself
        } else if (key === '$ref') {
          // Reference to another type
          const refMatch = /#\/\$defs\/([^"]+)/.exec(rest)
          if (refMatch) {
            const refName = refMatch[1]
            const typeId = `type|${refName}`
            if (linkMeta.has(typeId)) {
              addToken(lineIndex, linkMeta.get(typeId))
            }
          }
        } else {
          // Could be a property (attribute or element) within the current type
          const attrId = `attr|${currentDefName}.${key}`
          const elId = `el|${currentDefName}.${key}`

          if (linkMeta.has(attrId)) {
            addToken(lineIndex, linkMeta.get(attrId))
          }
          if (linkMeta.has(elId)) {
            addToken(lineIndex, linkMeta.get(elId))
          }

          // Check for type references in the value
          const refInValue = /#\/\$defs\/([^"]+)/.exec(rest)
          if (refInValue) {
            const refName = refInValue[1]
            const typeId = `type|${refName}`
            if (linkMeta.has(typeId)) {
              addToken(lineIndex, linkMeta.get(typeId))
            }
          }
        }
      }
    }

    // Also check non-key lines for $ref patterns
    if (!keyMatch && inDefs) {
      const refMatch = /"\$ref"\s*:\s*"#\/\$defs\/([^"]+)"/.exec(trimmed)
      if (refMatch) {
        const refName = refMatch[1]
        const typeId = `type|${refName}`
        if (linkMeta.has(typeId)) {
          addToken(lineIndex, linkMeta.get(typeId))
        }
      }
    }

    // Track brace depth for $defs tracking
    if (inDefs) {
      for (const ch of trimmed) {
        if (ch === '{') {
          braceDepth += 1
        } else if (ch === '}') {
          braceDepth -= 1
          if (currentDefName !== null && braceDepth <= defStartDepth) {
            currentDefName = null
          }
          if (braceDepth <= 0) {
            inDefs = false
            currentDefName = null
          }
        }
      }
    }
  }

  return lineTokens
}

function highlightXsdLine(line, lineTokens = []) {
  let html = escapeHtml(line)
  const tokens = []
  const stash = (markup) => {
    const tokenId = `%%HL${tokens.length}%%`
    tokens.push(markup)
    return tokenId
  }

  // Highlight strings
  html = html.replace(/("[^"]*"|'[^']*')/g, (value) => stash(`<span class="tok-str">${value}</span>`))
  // Highlight XML tags
  html = html.replace(/(&lt;\/?\s*)([A-Za-z_][\w:.-]*)/g, (_, open, name) => `${open}${stash(`<span class="tok-tag">${name}</span>`)}`)
  // Highlight attributes
  html = html.replace(/(\s)([A-Za-z_][\w:.-]*)(\s*=)/g, (_, space, name, suffix) => `${space}${stash(`<span class="tok-attr">${name}</span>`)}${suffix}`)
  // Restore placeholders
  html = html.replace(/%%HL(\d+)%%/g, (_, index) => tokens[Number(index)] ?? '')

  // Add link decorations for tokens
  for (const token of lineTokens) {
    if (token.kind === 'type') {
      // Link type names in string values (name="TypeName")
      const strPattern = new RegExp(`<span class="tok-str">"(${escapeRegExp(token.name)})"<\\/span>`)
      html = html.replace(strPattern, `<span class="tok-str token-link" data-link-id="${token.id}">"$1"</span>`)
      // Also try single-quoted or bare attribute values containing the name
      const strPatternSingle = new RegExp(`<span class="tok-str">'(${escapeRegExp(token.name)})'<\\/span>`)
      html = html.replace(strPatternSingle, `<span class="tok-str token-link" data-link-id="${token.id}">'$1'</span>`)
    } else if (token.kind === 'attr' || token.kind === 'el') {
      // Link attribute/element names in string values
      const strPattern = new RegExp(`<span class="tok-str">"(${escapeRegExp(token.name)})"<\\/span>`)
      html = html.replace(strPattern, `<span class="tok-str token-link" data-link-id="${token.id}">"$1"</span>`)
    }
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

  // Highlight JSON key
  html = html.replace(/^\s*"([^"]+)":/, (full, key) => full.replace(`"${key}"`, stash(`<span class="tok-key">"${key}"</span>`)))
  // Highlight string values
  html = html.replace(/:\s*"([^"]*)"/g, (_, value) => `: ${stash(`<span class="tok-str">"${value}"</span>`)}`)
  // Highlight numbers
  html = html.replace(/:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (_, value) => `: ${stash(`<span class="tok-num">${value}</span>`)}`)
  // Highlight literals
  html = html.replace(/:\s*(true|false|null)/g, (_, value) => `: ${stash(`<span class="tok-lit">${value}</span>`)}`)
  // Restore placeholders
  html = html.replace(/%%HL(\d+)%%/g, (_, index) => tokens[Number(index)] ?? '')

  // Add link decorations for tokens
  for (const token of lineTokens) {
    if (token.kind === 'type') {
      // Link type name in JSON key
      const keyPattern = new RegExp(`<span class="tok-key">"(${escapeRegExp(token.name)})"<\\/span>`)
      html = html.replace(keyPattern, `<span class="tok-key token-link" data-link-id="${token.id}">"$1"</span>`)
      // Link type name in $ref string values
      const refPattern = new RegExp(`#/\\$defs/(${escapeRegExp(token.name)})`)
      if (refPattern.test(html)) {
        const strRefPattern = new RegExp(`<span class="tok-str">"([^"]*${escapeRegExp(token.name)}[^"]*)"<\\/span>`)
        html = html.replace(strRefPattern, `<span class="tok-str token-link" data-link-id="${token.id}">"$1"</span>`)
      }
    } else if (token.kind === 'attr' || token.kind === 'el') {
      const keyPattern = new RegExp(`<span class="tok-key">"(${escapeRegExp(token.name)})"<\\/span>`)
      html = html.replace(keyPattern, `<span class="tok-key token-link" data-link-id="${token.id}">"$1"</span>`)
    }
  }

  return html
}

// --- Scroll sync and navigation (same pattern as main.js) ---

let isSyncingScroll = false
let syncScrollTimer = null
let currentLinkMeta = new Map()
let currentTokenOrder = []
let currentTokenIndex = -1
let lastNavigationPane = null

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

function syncScrollHandler(source, target) {
  if (isSyncingScroll) return
  isSyncingScroll = true
  const verticalRatio = getScrollRatio(source)
  setScrollRatio(target, verticalRatio)
  clearTimeout(syncScrollTimer)
  syncScrollTimer = setTimeout(() => { isSyncingScroll = false }, 30)
}

function findLinkedLines(container, linkId) {
  const matches = []
  for (const line of container.querySelectorAll('.code-line[data-links]')) {
    const links = (line.dataset.links || '').split(',').filter(Boolean)
    if (links.includes(linkId)) matches.push(line)
  }
  return matches
}

function findNearestLinkedLine(container, linkId) {
  const lines = findLinkedLines(container, linkId)
  if (lines.length === 0) return null
  if (lines.length === 1) return lines[0]
  const viewportCenter = container.scrollTop + Math.floor(container.clientHeight / 2)
  let bestLine = lines[0]
  let bestDistance = Math.abs(lines[0].offsetTop - viewportCenter)
  for (let i = 1; i < lines.length; i++) {
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

function getPeerPane(container) {
  return container === xsdCode ? jsonSchemaCode : xsdCode
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
    syncScrollTimer = setTimeout(() => { isSyncingScroll = false }, 50)
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
    syncScrollTimer = setTimeout(() => { isSyncingScroll = false }, 50)
  }
}

function describeToken(linkId) {
  const meta = currentLinkMeta.get(linkId)
  const path = linkId.includes('|') ? linkId.slice(linkId.indexOf('|') + 1) : linkId
  if (!meta) return path
  const kindLabel = meta.kind === 'attr' ? 'Attribute' : meta.kind === 'el' ? 'Element' : 'Type'
  return `${kindLabel}: ${meta.name} (${path})`
}

function getOrderedAvailableLinkIds() {
  const ordered = []
  const seen = new Set()
  const collect = (container) => {
    for (const tokenNode of container.querySelectorAll('.token-link[data-link-id]')) {
      const linkId = tokenNode.dataset.linkId
      if (!linkId || seen.has(linkId)) continue
      seen.add(linkId)
      ordered.push(linkId)
    }
  }
  collect(xsdCode)
  collect(jsonSchemaCode)
  return ordered
}

function clearActiveLink() {
  for (const node of document.querySelectorAll('.active-link')) node.classList.remove('active-link')
  for (const node of document.querySelectorAll('.active-token')) node.classList.remove('active-token')
  linkStatus.textContent = 'No active link.'
}

function syncTokenNavigatorToLink(linkId) {
  const index = currentTokenOrder.indexOf(linkId)
  if (index === -1) return
  currentTokenIndex = index
  if (tokenSelect.value !== linkId) tokenSelect.value = linkId
  updateTokenNavigatorStatus()
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

function getLargerPane() {
  const xsdLines = xsdCode.querySelectorAll('.code-line').length
  const jsonLines = jsonSchemaCode.querySelectorAll('.code-line').length
  return jsonLines >= xsdLines ? jsonSchemaCode : xsdCode
}

function activateLink(linkId, sourceContainer, mode = 'click') {
  clearActiveLink()
  if (sourceContainer) lastNavigationPane = sourceContainer

  let hitCount = 0
  for (const line of document.querySelectorAll('.code-line[data-links]')) {
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
  const label = meta?.kind === 'attr' ? 'Attribute' : meta?.kind === 'el' ? 'Element' : 'Type'
  const tokenName = meta?.name || linkId
  linkStatus.textContent = `${label} ${tokenName} linked across ${hitCount} lines.`

  if (mode === 'click') {
    alignPeerPaneOnClick(linkId, sourceContainer || lastNavigationPane || xsdCode)
  } else {
    alignBothPanesOnNav(linkId, sourceContainer || getLargerPane())
  }
  syncTokenNavigatorToLink(linkId)
}

function stepTokenSelection(delta) {
  const total = currentTokenOrder.length
  if (total === 0) return
  if (currentTokenIndex < 0) {
    currentTokenIndex = 0
  } else {
    currentTokenIndex = (currentTokenIndex + delta + total) % total
  }
  const linkId = currentTokenOrder[currentTokenIndex]
  tokenSelect.value = linkId
  activateLink(linkId, getLargerPane(), 'nav')
}

function renderCodePane(container, lines, lineTokensMap, kind) {
  container.innerHTML = ''
  const existingNote = container.parentElement.querySelector('.render-note')
  if (existingNote) existingNote.remove()
  const fragment = document.createDocumentFragment()

  const limitedLines = lines.slice(0, MAX_RENDER_LINES)
  for (let index = 0; index < limitedLines.length; index++) {
    const line = limitedLines[index]
    const lineTokens = lineTokensMap.get(index) || []
    const links = lineTokens.map((token) => token.id)

    const lineNode = document.createElement('div')
    lineNode.className = 'code-line'
    if (links.length > 0) lineNode.dataset.links = links.join(',')

    const number = document.createElement('span')
    number.className = 'line-number'
    number.textContent = String(index + 1)

    const content = document.createElement('span')
    content.className = 'line-content'
    content.innerHTML = kind === 'xsd' ? highlightXsdLine(line, lineTokens) : highlightJsonLine(line, lineTokens)

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
    if (!line) return
    const links = (line.dataset.links || '').split(',').filter(Boolean)
    if (links.length > 0) activateLink(links[0], container)
  })
}

// --- UI Setup ---

document.querySelector('#app').innerHTML = `
  <main class="layout">
    <header>
      <h1>XSD vs JSON Schema Compare</h1>
      <p>Visual comparison of XML Schema (XSD) and generated JSON Schema 2020-12. <a href="/">Back to Benchmark</a></p>
    </header>

    <section class="panel controls">
      <div class="row">
        <label for="xsdSelect">XSD Source</label>
        <select id="xsdSelect"></select>
      </div>

      <div class="actions">
        <button id="convertButton" type="button">Convert XSD -> JSON Schema</button>
      </div>

      <p id="status" class="status">Ready.</p>
    </section>

    <section class="panel compare">
      <p id="compareHint" class="hint">Select an XSD file and click Convert to start.</p>
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
          <h3>XSD (XML Schema)</h3>
          <div id="xsdCode" class="code-pane"></div>
        </div>
        <div>
          <h3>JSON Schema 2020-12</h3>
          <div id="jsonSchemaCode" class="code-pane"></div>
        </div>
      </div>
      <p id="linkStatus" class="hint">No active link.</p>
    </section>
  </main>
`

const xsdSelect = document.querySelector('#xsdSelect')
const convertButton = document.querySelector('#convertButton')
const statusNode = document.querySelector('#status')
const compareHint = document.querySelector('#compareHint')
const xsdCode = document.querySelector('#xsdCode')
const jsonSchemaCode = document.querySelector('#jsonSchemaCode')
const linkStatus = document.querySelector('#linkStatus')
const tokenPrevButton = document.querySelector('#tokenPrevButton')
const tokenNextButton = document.querySelector('#tokenNextButton')
const tokenSelect = document.querySelector('#tokenSelect')
const tokenStatus = document.querySelector('#tokenStatus')

let currentXsd = ''
let currentJsonSchema = ''

function setStatus(message, isError = false) {
  statusNode.textContent = message
  statusNode.classList.toggle('error', isError)
}

function renderVisualCompare(xsdText, jsonSchemaString) {
  xsdCode.innerHTML = ''
  jsonSchemaCode.innerHTML = ''
  compareHint.textContent = 'Panes scroll in sync. Click highlighted tokens or use the navigator to jump between links.'
  clearActiveLink()

  const jsonData = JSON.parse(jsonSchemaString)
  const prettyJson = JSON.stringify(jsonData, null, 2)
  const xsdLines = xsdText.split('\n')
  const jsonLines = prettyJson.split('\n')
  const xsdResult = buildXsdLineTokens(xsdText)
  const jsonLinks = buildJsonSchemaLineTokens(jsonLines, xsdResult.linkMeta)

  currentLinkMeta = xsdResult.linkMeta

  renderCodePane(xsdCode, xsdLines, xsdResult.lineTokens, 'xsd')
  renderCodePane(jsonSchemaCode, jsonLines, jsonLinks, 'json')
  refreshTokenNavigator()
}

bindLinkSelection(xsdCode)
bindLinkSelection(jsonSchemaCode)

xsdCode.addEventListener('scroll', () => syncScrollHandler(xsdCode, jsonSchemaCode))
jsonSchemaCode.addEventListener('scroll', () => syncScrollHandler(jsonSchemaCode, xsdCode))

tokenPrevButton.addEventListener('click', () => stepTokenSelection(-1))
tokenNextButton.addEventListener('click', () => stepTokenSelection(1))

tokenSelect.addEventListener('change', () => {
  const linkId = tokenSelect.value
  if (!linkId) return
  activateLink(linkId, getLargerPane(), 'nav')
})

tokenSelect.addEventListener('wheel', (event) => {
  if (currentTokenOrder.length === 0) return
  event.preventDefault()
  stepTokenSelection(event.deltaY > 0 ? 1 : -1)
}, { passive: false })

// Populate XSD select
for (const item of xsdFiles) {
  const option = document.createElement('option')
  option.value = item.path
  option.textContent = item.label
  xsdSelect.appendChild(option)
}

convertButton.addEventListener('click', async () => {
  const xsdPath = xsdSelect.value
  if (!xsdPath) {
    setStatus('Please select an XSD file.', true)
    return
  }

  convertButton.disabled = true
  try {
    setStatus('Loading XSD source...')
    currentXsd = await loadXsdSource(xsdPath)

    setStatus('Converting XSD to JSON Schema...')
    currentJsonSchema = await convertXsdToJsonSchema(xsdPath)

    renderVisualCompare(currentXsd, currentJsonSchema)
    setStatus('Conversion complete. Click linked tokens to navigate between schemas.')
  } catch (error) {
    setStatus(`Conversion failed: ${String(error)}`, true)
  } finally {
    convertButton.disabled = false
  }
})
