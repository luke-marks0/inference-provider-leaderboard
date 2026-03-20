import process from "node:process"

const API_BASE_URL = "https://api.projectvail.com"
const DEFAULT_DAILY_LOOKBACK_DAYS = 7
const DEFAULT_HOURLY_LOOKBACK_DAYS = 2
const DEFAULT_DIVERGENCE_LOOKBACK_DAYS = 14

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

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function subtractDays(date, days) {
  const copy = new Date(date)
  copy.setUTCDate(copy.getUTCDate() - days)
  return copy
}

async function requestJson(apiKey, path, params = {}) {
  const url = new URL(`${API_BASE_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value))
  })

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

async function findEndpointWithDivergence(apiKey, endpoints, startDate, endDate) {
  for (const endpoint of endpoints) {
    const result = await requestJson(apiKey, "/v1/divergence", {
      endpoint,
      start_date: startDate,
      end_date: endDate,
    })

    if (Array.isArray(result.data) && result.data.length > 0) {
      return result
    }
  }

  return null
}

function printSection(title, data) {
  console.log(`\n=== ${title} ===`)
  console.log(JSON.stringify(data, null, 2))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = requireApiKey(args)
  const now = args.date ? new Date(`${args.date}T00:00:00Z`) : new Date()

  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid --date value. Use YYYY-MM-DD.")
  }

  const dailyStart = formatDate(subtractDays(now, DEFAULT_DAILY_LOOKBACK_DAYS))
  const hourlyStart = formatDate(subtractDays(now, DEFAULT_HOURLY_LOOKBACK_DAYS))
  const divergenceStart = formatDate(subtractDays(now, DEFAULT_DIVERGENCE_LOOKBACK_DAYS))
  const endDate = formatDate(now)

  const endpointsResponse = await requestJson(apiKey, "/v1/endpoints")
  const endpoints = endpointsResponse.endpoints.map((entry) => entry.name)
  const preferredEndpoint =
    args.endpoint ??
    endpoints.find((endpoint) => endpoint === "gpt-5.4-openai-responses") ??
    endpoints[0]

  if (!preferredEndpoint) {
    throw new Error("The VAIL API returned no endpoints for this key.")
  }

  const currentStability = await requestJson(apiKey, "/v1/stability", {
    endpoint: preferredEndpoint,
  })
  const dailyHistory = await requestJson(apiKey, "/v1/stability", {
    endpoint: preferredEndpoint,
    start_date: dailyStart,
    end_date: endDate,
  })
  const hourlyHistory = await requestJson(apiKey, "/v1/stability", {
    endpoint: preferredEndpoint,
    start_date: hourlyStart,
    end_date: endDate,
    granularity: "hourly",
  })
  const divergence = await findEndpointWithDivergence(apiKey, endpoints, divergenceStart, endDate)

  printSection("Endpoints Sample", {
    count: endpoints.length,
    firstTen: endpoints.slice(0, 10),
    selectedStabilityEndpoint: preferredEndpoint,
  })
  printSection("Current Stability", currentStability)
  printSection("Daily Stability History", {
    ...dailyHistory,
    data: dailyHistory.data.slice(0, 10),
  })
  printSection("Hourly Stability History", {
    ...hourlyHistory,
    data: hourlyHistory.data.slice(0, 12),
    totalPoints: hourlyHistory.data.length,
  })
  printSection(
    "Divergence",
    divergence ?? {
      start_date: divergenceStart,
      end_date: endDate,
      data: [],
      note: "No endpoints returned divergence data in the scanned window.",
    }
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
