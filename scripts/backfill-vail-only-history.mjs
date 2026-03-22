import { promises as fs } from "node:fs"
import path from "node:path"
import process from "node:process"

const API_BASE_URL = "https://api.projectvail.com"
const DATA_DIR = path.join(process.cwd(), "public", "data")
const FILE_PATTERN = /^(.+)_audit_results_(\d{8})_(\d{6})\.json$/
const HISTORY_START_DATE = "2020-01-01"

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

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

function formatDateCompact(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate()
  ).padStart(2, "0")}`
}

async function loadHistoryByEndpoint(apiKey, endpoints) {
  const historyByEndpoint = new Map()

  for (const endpoint of endpoints) {
    const result = await requestJson(apiKey, "/v1/divergence", {
      endpoint,
      start_date: HISTORY_START_DATE,
      end_date: new Date().toISOString().slice(0, 10),
    })

    const byDate = new Map()

    for (const point of result.data ?? []) {
      if (typeof point?.date !== "string") continue
      if (typeof point?.divergence_ratio !== "number" || !Number.isFinite(point.divergence_ratio)) continue

      byDate.set(point.date, {
        endpoint,
        divergence_ratio: point.divergence_ratio,
        date: point.date,
        comparison_providers: Array.isArray(point.comparison_providers) ? point.comparison_providers : [],
      })
    }

    if (byDate.size > 0) {
      historyByEndpoint.set(endpoint, byDate)
    }
  }

  return historyByEndpoint
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = requireApiKey(args)
  const fileNames = (await fs.readdir(DATA_DIR)).filter((fileName) => FILE_PATTERN.test(fileName)).sort()
  const seeds = []

  for (const fileName of fileNames) {
    const match = fileName.match(FILE_PATTERN)
    if (!match) continue

    const contents = await fs.readFile(path.join(DATA_DIR, fileName), "utf8")
    const payload = JSON.parse(contents)
    if (payload?.parameters?.vail_only !== true) continue

    const endpointProviders = Object.entries(payload.providers ?? {})
      .flatMap(([provider, providerData]) => {
        const endpoint = providerData?.vail?.endpoint
        return typeof endpoint === "string" ? [{ provider, endpoint }] : []
      })

    if (endpointProviders.length === 0) continue

    seeds.push({
      fileName,
      filePrefix: match[1],
      timePart: match[3],
      model: payload.model,
      parameters: payload.parameters ?? {},
      endpointProviders,
    })
  }

  const uniqueEndpoints = Array.from(new Set(seeds.flatMap((seed) => seed.endpointProviders.map((entry) => entry.endpoint)))).sort()
  const historyByEndpoint = await loadHistoryByEndpoint(apiKey, uniqueEndpoints)

  let createdFiles = 0
  let updatedFiles = 0
  let skippedModels = 0

  for (const seed of seeds) {
    const availableDates = new Set(
      seed.endpointProviders.flatMap(({ endpoint }) => Array.from(historyByEndpoint.get(endpoint)?.keys() ?? []))
    )

    if (availableDates.size === 0) {
      skippedModels += 1
      continue
    }

    for (const divergenceDate of Array.from(availableDates).sort()) {
      const snapshotDate = addDays(divergenceDate, 1)
      const targetFileName = `${seed.filePrefix}_audit_results_${formatDateCompact(snapshotDate)}_${seed.timePart}.json`
      const targetFilePath = path.join(DATA_DIR, targetFileName)

      const providers = Object.fromEntries(
        seed.endpointProviders.flatMap(({ provider, endpoint }) => {
          const point = historyByEndpoint.get(endpoint)?.get(divergenceDate)
          return point
            ? [
                [
                  provider,
                  {
                    vail: point,
                  },
                ],
              ]
            : []
        })
      )

      if (Object.keys(providers).length === 0) continue

      const payload = {
        model: seed.model,
        parameters: seed.parameters,
        providers,
      }

      try {
        await fs.access(targetFilePath)
        updatedFiles += 1
      } catch {
        createdFiles += 1
      }

      await fs.writeFile(targetFilePath, `${JSON.stringify(payload, null, 2)}\n`)
    }
  }

  console.log(
    JSON.stringify(
      {
        seedModels: seeds.length,
        createdFiles,
        updatedFiles,
        skippedModels,
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
