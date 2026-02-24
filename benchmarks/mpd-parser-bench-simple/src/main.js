import { parseXml } from '@svta/cml-xml'
import './style.css'

// ---------------------------------------------------------------------------
// DOM parser helpers (same as the full benchmark)
// ---------------------------------------------------------------------------
const domParser = new DOMParser()

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

// ---------------------------------------------------------------------------
// Benchmark methods – same three as the full benchmark
// ---------------------------------------------------------------------------
const benchmarkMethods = [
  {
    name: 'DOMParser \u2192 object',
    run(xml, _json) {
      return parseWithDom(xml)
    },
  },
  {
    name: 'JSON.parse',
    run(_xml, jsonString) {
      return JSON.parse(jsonString)
    },
  },
  {
    name: '@svta/cml-xml parseXml',
    run(xml, _json) {
      return parseWithCmlXml(xml)
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function formatNumber(n, decimals = 2) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------
async function runBenchmark(method, xml, jsonString, runs, warmupRuns, onProgress) {
  const totalIterations = warmupRuns + runs
  let measuredTotalMs = 0

  for (let i = 0; i < totalIterations; i++) {
    const before = performance.now()
    method.run(xml, jsonString)
    const elapsed = performance.now() - before

    if (i >= warmupRuns) {
      measuredTotalMs += elapsed
    }

    onProgress(i + 1, totalIterations, i < warmupRuns ? 'warmup' : 'measure')
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

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function buildUI() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <header>
      <h1>MPD Parser Benchmark <span class="tag">Simple</span></h1>
      <p class="subtitle">livesim_very_large.mpd &mdash; Tizen / WebOS ready</p>
    </header>

    <section class="controls">
      <div class="control-row">
        <label>
          Measured iterations
          <input type="number" id="runs" value="20" min="1" max="10000" />
        </label>
        <label>
          Warmup iterations
          <input type="number" id="warmup" value="3" min="0" max="1000" />
        </label>
        <button id="btn-run" disabled>Run Benchmark</button>
      </div>
    </section>

    <section class="status-section">
      <div id="status" class="status">Loading test data&hellip;</div>
      <div class="progress-bar-container">
        <div id="progress-bar" class="progress-bar" style="width:0%"></div>
      </div>
    </section>

    <section class="file-info" id="file-info" style="display:none">
      <table>
        <tr><td>MPD (XML)</td><td id="info-xml-size"></td></tr>
        <tr><td>JSON</td><td id="info-json-size"></td></tr>
      </table>
    </section>

    <section id="results-section" style="display:none">
      <h2>Results</h2>
      <table class="results-table" id="results-table">
        <thead>
          <tr>
            <th>Method</th>
            <th>Avg (ms)</th>
            <th>Ops / sec</th>
            <th>Total (ms)</th>
            <th>Runs</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>

    <section id="history-section" style="display:none">
      <h2>Run History</h2>
      <div id="history-list"></div>
    </section>
  `
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  buildUI()

  const statusEl = document.getElementById('status')
  const progressBar = document.getElementById('progress-bar')
  const btnRun = document.getElementById('btn-run')
  const runsInput = document.getElementById('runs')
  const warmupInput = document.getElementById('warmup')
  const fileInfo = document.getElementById('file-info')
  const resultsSection = document.getElementById('results-section')
  const resultsBody = document.querySelector('#results-table tbody')
  const historySection = document.getElementById('history-section')
  const historyList = document.getElementById('history-list')

  const runHistory = []

  // Load test data from public/ directory
  statusEl.textContent = 'Fetching livesim_very_large.mpd\u2026'
  let xmlText, jsonText

  try {
    const [xmlResp, jsonResp] = await Promise.all([
      fetch('data/livesim_very_large.mpd'),
      fetch('data/livesim_very_large.mpd.json'),
    ])

    if (!xmlResp.ok) throw new Error(`Failed to load MPD: HTTP ${xmlResp.status}`)
    if (!jsonResp.ok) throw new Error(`Failed to load JSON: HTTP ${jsonResp.status}`)

    xmlText = await xmlResp.text()
    jsonText = await jsonResp.text()
  } catch (err) {
    statusEl.textContent = `Error loading test data: ${err.message}`
    statusEl.classList.add('error')
    return
  }

  // Show file info
  fileInfo.style.display = ''
  document.getElementById('info-xml-size').textContent =
    `${formatBytes(new Blob([xmlText]).size)} (${xmlText.split('\n').length.toLocaleString()} lines)`
  document.getElementById('info-json-size').textContent =
    `${formatBytes(new Blob([jsonText]).size)}`

  statusEl.textContent = 'Ready. Press "Run Benchmark" to start.'
  btnRun.disabled = false

  // Benchmark execution
  btnRun.addEventListener('click', async () => {
    const runs = Math.max(1, parseInt(runsInput.value, 10) || 20)
    const warmupRuns = Math.max(0, parseInt(warmupInput.value, 10) || 3)

    btnRun.disabled = true
    runsInput.disabled = true
    warmupInput.disabled = true
    resultsBody.innerHTML = ''
    resultsSection.style.display = ''

    const results = []
    const totalSteps = benchmarkMethods.length
    let currentMethodIndex = 0

    for (const method of benchmarkMethods) {
      currentMethodIndex++
      statusEl.textContent = `[${currentMethodIndex}/${totalSteps}] ${method.name}\u2026`

      const result = await runBenchmark(
        method,
        xmlText,
        jsonText,
        runs,
        warmupRuns,
        (done, total, phase) => {
          const globalDone =
            (currentMethodIndex - 1) * (runs + warmupRuns) + done
          const globalTotal = totalSteps * (runs + warmupRuns)
          const pct = ((globalDone / globalTotal) * 100).toFixed(1)
          progressBar.style.width = `${pct}%`
          statusEl.textContent =
            `[${currentMethodIndex}/${totalSteps}] ${method.name} \u2014 ${phase} ${done}/${total}`
        },
      )

      results.push(result)

      // Append row immediately
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${result.name}</td>
        <td>${formatNumber(result.avgMs)}</td>
        <td>${formatNumber(result.opsPerSecond)}</td>
        <td>${formatNumber(result.totalMs, 0)}</td>
        <td>${result.runs}</td>
      `
      resultsBody.appendChild(row)
    }

    progressBar.style.width = '100%'
    statusEl.textContent = 'Done.'

    // Save to history
    runHistory.push({
      timestamp: new Date().toLocaleTimeString(),
      runs,
      warmupRuns,
      results: results.map((r) => ({ ...r })),
    })
    renderHistory(historySection, historyList, runHistory)

    btnRun.disabled = false
    runsInput.disabled = false
    warmupInput.disabled = false
  })
}

function renderHistory(section, container, history) {
  section.style.display = ''
  container.innerHTML = history
    .map(
      (entry, idx) => `
      <details ${idx === history.length - 1 ? 'open' : ''}>
        <summary>Run #${idx + 1} @ ${entry.timestamp} (${entry.runs} measured, ${entry.warmupRuns} warmup)</summary>
        <table class="results-table">
          <thead>
            <tr><th>Method</th><th>Avg (ms)</th><th>Ops/sec</th></tr>
          </thead>
          <tbody>
            ${entry.results
              .map(
                (r) => `
              <tr>
                <td>${r.name}</td>
                <td>${formatNumber(r.avgMs)}</td>
                <td>${formatNumber(r.opsPerSecond)}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </details>`,
    )
    .join('')
}

main()
