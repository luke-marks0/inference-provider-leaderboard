import { promises as fs } from "node:fs"
import path from "node:path"
import process from "node:process"

const API_BASE_URL = "https://api.projectvail.com"
const DATA_DIR = path.join(process.cwd(), "public", "data")
const FILE_PATTERN = /^(.+)_audit_results_(\d{8})_(\d{6})\.json$/
const HISTORY_START_DATE = "2020-01-01"

const MODEL_TO_VAIL_PREFIX = new Map([
  ["openai/gpt-oss-120b", "gpt-oss-120b"],
  ["Qwen/Qwen3-Coder-480B-A35B-Instruct", "qwen3-coder-480b"],
])

const PROVIDER_TO_VAIL_PROVIDER = new Map([
  ["amazonbedrock", "bedrock"],
  ["deepinfra", "deepinfra"],
  ["fireworks", "fireworks"],
  ["google", "vertex"],
  ["google-vertex", "vertex"],
  ["groq", "groq"],
  ["nebius", "nebius"],
  ["novita", "novita"],
  ["parasail", "parasail"],
  ["together", "together"],
])

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) continue

    const [key, inlineValue] = arg.slice(2).split("=", 2)
    const next = argv[index + 1]
    const value = inlineValue ?? (next && !next.startsWith("--") ? next : "true")
    if (inlineValue == null && next && !next.startsWith("--")) index += 1
    parsed[key] = value
  }

  return parsed
}

function requireApiKey(args) {
  const apiKey = args["api-key"] ?? process.env.VAIL_API_KEY
  if (!apiKey) {
    throw new Error("Missing VAIL API key. Set VAIL_API_KEY or pass --api-key.")
  }

  return apiKey
}

async function requestJson(apiKey, requestPath, params = {}) {
  const url = new URL(`${API_BASE_URL}${requestPath}`)

  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
    },
  })

  const text = await response.text()
  let json

  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }

  if (!response.ok) {
    const detail = typeof json?.detail === "string" ? json.detail : text
    throw new Error(`VAIL request failed (${response.status} ${response.statusText}): ${detail}`)
  }

  return json
}

function parseAuditTimestamp(filename) {
  const match = filename.match(FILE_PATTERN)
  if (!match) return null

  const [, , datePart, timePart] = match
  return new Date(
    `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(
      0,
      2
    )}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}Z`
  )
}

function providerBaseName(providerKey) {
  return providerKey.split("/")[0]
}

function diffMs(a, b) {
  return Math.abs(a.getTime() - b.getTime())
}

function findClosestDivergence(auditTimestamp, history) {
  if (!Array.isArray(history) || history.length === 0) return null

  const earliest = history[0]
  if (auditTimestamp.getTime() < earliest.timestamp.getTime()) {
    return null
  }

  let best = history[0]

  for (const point of history) {
    const pointDelta = diffMs(auditTimestamp, point.timestamp)
    const bestDelta = diffMs(auditTimestamp, best.timestamp)
    if (pointDelta < bestDelta) {
      best = point
      continue
    }

    if (pointDelta === bestDelta && point.timestamp.getTime() > best.timestamp.getTime()) {
      best = point
    }
  }

  return best
}

async function loadVailHistory(apiKey) {
  const endpointsResponse = await requestJson(apiKey, "/v1/endpoints")
  const endpointNames = (endpointsResponse.endpoints ?? []).map((entry) => entry.name).sort()
  const historyByEndpoint = new Map()

  for (const endpoint of endpointNames) {
    const result = await requestJson(apiKey, "/v1/divergence", {
      endpoint,
      start_date: HISTORY_START_DATE,
      end_date: new Date().toISOString().slice(0, 10),
    })

    const normalized = (result.data ?? [])
      .filter((point) => typeof point?.date === "string" && typeof point?.divergence_ratio === "number")
      .map((point) => ({
        ...point,
        timestamp: new Date(`${point.date}T00:00:00Z`),
      }))
      .filter((point) => !Number.isNaN(point.timestamp.getTime()))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    if (normalized.length > 0) {
      historyByEndpoint.set(endpoint, normalized)
    }
  }

  return historyByEndpoint
}

function buildVailEndpoint(model, providerKey, availableEndpoints) {
  const modelPrefix = MODEL_TO_VAIL_PREFIX.get(model)
  const providerPrefix = PROVIDER_TO_VAIL_PROVIDER.get(providerBaseName(providerKey))
  if (!modelPrefix || !providerPrefix) return null

  const endpoint = `${modelPrefix}-${providerPrefix}-chat`
  return availableEndpoints.has(endpoint) ? endpoint : null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = requireApiKey(args)
  const historyByEndpoint = await loadVailHistory(apiKey)
  const availableEndpoints = new Set(historyByEndpoint.keys())
  const dataFiles = (await fs.readdir(DATA_DIR))
    .filter((filename) => FILE_PATTERN.test(filename))
    .sort()

  let updatedFiles = 0
  let attachedProviders = 0
  let skippedTooEarly = 0

  for (const filename of dataFiles) {
    const filePath = path.join(DATA_DIR, filename)
    const fileContents = await fs.readFile(filePath, "utf8")
    const payload = JSON.parse(fileContents)
    const auditTimestamp = parseAuditTimestamp(filename)

    if (!auditTimestamp || typeof payload !== "object" || payload == null || typeof payload.model !== "string") {
      continue
    }

    let fileChanged = false

    for (const [providerKey, providerData] of Object.entries(payload.providers ?? {})) {
      if (!providerData || typeof providerData !== "object") continue

      if ("vail" in providerData) {
        delete providerData.vail
        fileChanged = true
      }

      const endpoint = buildVailEndpoint(payload.model, providerKey, availableEndpoints)
      if (!endpoint) continue

      const history = historyByEndpoint.get(endpoint)
      const closest = findClosestDivergence(auditTimestamp, history)

      if (!closest) {
        skippedTooEarly += 1
        continue
      }

      providerData.vail = {
        endpoint,
        divergence_ratio: closest.divergence_ratio,
        date: closest.date,
        comparison_providers: Array.isArray(closest.comparison_providers) ? closest.comparison_providers : [],
      }
      fileChanged = true
      attachedProviders += 1
    }

    if (fileChanged) {
      await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
      updatedFiles += 1
    }
  }

  console.log(
    JSON.stringify(
      {
        updatedFiles,
        attachedProviders,
        skippedTooEarly,
        supportedEndpoints: availableEndpoints.size,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
