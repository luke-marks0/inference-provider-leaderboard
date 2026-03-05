import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const FILE_PATTERN = /^(.+)_audit_results_(\d{8})_(\d{6})\.json$/
const API_VERSION = "v1"
const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema"
const DEFAULT_CONFIG = {
  ignoredModels: [],
}

function relativeUrl(fromFile, toFile) {
  return path.posix.relative(path.posix.dirname(fromFile), toFile)
}

function toIsoTimestamp(datePart, timePart) {
  return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(
    0,
    2
  )}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}Z`
}

function modelToId(model) {
  return encodeURIComponent(model)
}

function modelIdToPath(modelId) {
  return decodeURIComponent(modelId)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function sortByTimestampAsc(a, b) {
  return a.timestamp.localeCompare(b.timestamp)
}

function sanitizeProviders(providers) {
  return Object.fromEntries(
    Object.entries(providers ?? {}).filter(([, providerData]) => {
      const score = providerData?.exact_match_rate
      return typeof score === "number" && Number.isFinite(score)
    })
  )
}

function endpointToParts(endpointName) {
  const [provider, ...variantParts] = endpointName.split("/")
  const variant = variantParts.length > 0 ? variantParts.join("/") : null

  return {
    endpoint: endpointName,
    provider,
    variant,
  }
}

function toProviderEntries(providers) {
  return Object.entries(providers)
    .map(([endpointName, metrics]) => ({
      ...endpointToParts(endpointName),
      metrics,
    }))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint))
}

function summarizeProviders(runs) {
  const providerMap = new Map()

  for (const run of runs) {
    for (const [endpointName, providerData] of Object.entries(run.providers)) {
      const score = providerData?.exact_match_rate
      if (typeof score !== "number" || !Number.isFinite(score)) continue

      const providerName = endpointName.split("/")[0]
      const existing = providerMap.get(providerName)
      if (existing) {
        existing.dataPoints += 1
        const modelAggregate = existing.modelScores.get(run.model)
        if (modelAggregate) {
          modelAggregate.scoreSum += score
          modelAggregate.dataPoints += 1
        } else {
          existing.modelScores.set(run.model, {
            scoreSum: score,
            dataPoints: 1,
          })
        }
      } else {
        providerMap.set(providerName, {
          modelScores: new Map([
            [
              run.model,
              {
                scoreSum: score,
                dataPoints: 1,
              },
            ],
          ]),
          dataPoints: 1,
        })
      }
    }
  }

  return Array.from(providerMap.entries())
    .map(([provider, aggregate]) => {
      const modelAverages = Array.from(aggregate.modelScores.values()).map(
        (modelAggregate) => modelAggregate.scoreSum / modelAggregate.dataPoints
      )
      if (modelAverages.length === 0) return null

      const avgScore = modelAverages.reduce((sum, value) => sum + value, 0) / modelAverages.length

      return {
        provider,
        avgScore,
        dataPoints: aggregate.dataPoints,
        modelCount: aggregate.modelScores.size,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.avgScore - a.avgScore)
}

function buildModelDetail(model, modelRuns, toRunForFile, modelDetailFilePath) {
  const sortedRuns = [...modelRuns].sort(sortByTimestampAsc)

  const timelineProviders = Array.from(new Set(sortedRuns.flatMap((run) => Object.keys(run.providers))))
  const timelineProviderNames = Array.from(
    new Set(
      sortedRuns.flatMap((run) =>
        Object.keys(run.providers).map((providerEndpoint) => endpointToParts(providerEndpoint).provider)
      )
    )
  )

  const timeSeries = sortedRuns.map((run) => ({
    timestamp: run.timestamp,
    ...Object.fromEntries(
      Object.entries(run.providers)
        .filter(([, providerData]) => typeof providerData?.exact_match_rate === "number")
        .map(([providerName, providerData]) => [providerName, providerData.exact_match_rate])
    ),
  }))

  return {
    model,
    id: modelToId(model),
    runCount: sortedRuns.length,
    firstTimestamp: sortedRuns[0]?.timestamp ?? null,
    lastTimestamp: sortedRuns[sortedRuns.length - 1]?.timestamp ?? null,
    providers: timelineProviders,
    providerNames: timelineProviderNames,
    runs: sortedRuns.map((run) => toRunForFile(run, modelDetailFilePath)),
    timeSeries,
  }
}

function makeSchemas() {
  const providerMetricsSchema = {
    type: "object",
    required: ["exact_match_rate"],
    properties: {
      exact_match_rate: { type: "number" },
      avg_prob: { type: "number" },
      avg_margin: { type: "number" },
      avg_logit_rank: { type: "number" },
      avg_gumbel_rank: { type: "number" },
      infinite_margin_rate: { type: "number" },
      total_tokens: { type: "number" },
      n_sequences: { type: "number" },
    },
    additionalProperties: true,
  }

  const providerEntrySchema = {
    type: "object",
    required: ["endpoint", "provider", "variant", "metrics"],
    properties: {
      endpoint: { type: "string" },
      provider: { type: "string" },
      variant: { type: ["string", "null"] },
      metrics: providerMetricsSchema,
    },
    additionalProperties: false,
  }

  const runSchema = {
    type: "object",
    required: ["id", "filename", "dataUrl", "model", "timestamp", "providerEntries", "parameters"],
    properties: {
      id: { type: "string" },
      filename: { type: "string" },
      dataUrl: { type: "string" },
      model: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
      providerEntries: {
        type: "array",
        items: providerEntrySchema,
      },
      parameters: { type: ["object", "null"], additionalProperties: true },
    },
    additionalProperties: false,
  }

  const modelSummarySchema = {
    type: "object",
    required: ["model", "id", "runCount", "firstTimestamp", "lastTimestamp", "endpoint"],
    properties: {
      model: { type: "string" },
      id: { type: "string" },
      runCount: { type: "number" },
      firstTimestamp: { type: ["string", "null"], format: "date-time" },
      lastTimestamp: { type: ["string", "null"], format: "date-time" },
      endpoint: { type: "string" },
    },
    additionalProperties: false,
  }

  const leaderboardProviderSchema = {
    type: "object",
    required: ["provider", "avgScore", "dataPoints", "modelCount"],
    properties: {
      provider: { type: "string" },
      avgScore: { type: "number" },
      dataPoints: { type: "number" },
      modelCount: { type: "number" },
    },
    additionalProperties: false,
  }

  const modelDetailSchema = {
    $schema: JSON_SCHEMA_DRAFT,
    $id: `/api/${API_VERSION}/schemas/model-detail.schema.json`,
    title: "ModelDetail",
    type: "object",
    required: [
      "version",
      "generatedAt",
      "model",
      "id",
      "runCount",
      "firstTimestamp",
      "lastTimestamp",
      "providers",
      "providerNames",
      "runs",
      "timeSeries",
    ],
    properties: {
      version: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      model: { type: "string" },
      id: { type: "string" },
      runCount: { type: "number" },
      firstTimestamp: { type: ["string", "null"], format: "date-time" },
      lastTimestamp: { type: ["string", "null"], format: "date-time" },
      providers: { type: "array", items: { type: "string" } },
      providerNames: { type: "array", items: { type: "string" } },
      runs: { type: "array", items: runSchema },
      timeSeries: {
        type: "array",
        items: {
          type: "object",
          required: ["timestamp"],
          properties: {
            timestamp: { type: "string", format: "date-time" },
          },
          additionalProperties: { type: "number" },
        },
      },
    },
    additionalProperties: false,
  }

  return {
    "index.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/index.schema.json`,
      title: "IndexPayload",
      type: "object",
      required: ["version", "generatedAt", "dataset", "ignoredModels", "endpoints"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        dataset: {
          type: "object",
          required: ["runCount", "modelCount"],
          properties: {
            runCount: { type: "number" },
            modelCount: { type: "number" },
          },
          additionalProperties: false,
        },
        ignoredModels: { type: "array", items: { type: "string" } },
        endpoints: {
          type: "object",
          required: [
            "metadata",
            "runs",
            "runsIndex",
            "runsByDate",
            "models",
            "leaderboard",
            "summary",
            "modelDetails",
            "schemas",
            "rawManifest",
          ],
          properties: {
            metadata: { type: "string" },
            runs: { type: "string" },
            runsIndex: { type: "string" },
            runsByDate: { type: "string" },
            models: { type: "string" },
            leaderboard: { type: "string" },
            summary: { type: "string" },
            modelDetails: { type: "string" },
            schemas: { type: "string" },
            rawManifest: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    "meta.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/meta.schema.json`,
      title: "MetaPayload",
      type: "object",
      required: ["version", "generatedAt", "runCount", "modelCount", "providerCount", "ignoredModels"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        runCount: { type: "number" },
        modelCount: { type: "number" },
        providerCount: { type: "number" },
        ignoredModels: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    "run.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/run.schema.json`,
      title: "Run",
      ...runSchema,
    },
    "runs.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/runs.schema.json`,
      title: "RunsPayload",
      type: "object",
      required: ["version", "generatedAt", "count", "runs"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        count: { type: "number" },
        runs: { type: "array", items: runSchema },
      },
      additionalProperties: false,
    },
    "runs-index.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/runs-index.schema.json`,
      title: "RunsIndexPayload",
      type: "object",
      required: ["version", "generatedAt", "count", "firstTimestamp", "lastTimestamp", "availableDates", "dateEndpoints"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        count: { type: "number" },
        firstTimestamp: { type: ["string", "null"], format: "date-time" },
        lastTimestamp: { type: ["string", "null"], format: "date-time" },
        availableDates: { type: "array", items: { type: "string", format: "date" } },
        dateEndpoints: {
          type: "array",
          items: {
            type: "object",
            required: ["date", "endpoint", "count"],
            properties: {
              date: { type: "string", format: "date" },
              endpoint: { type: "string" },
              count: { type: "number" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    "runs-by-date.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/runs-by-date.schema.json`,
      title: "RunsByDatePayload",
      type: "object",
      required: ["version", "generatedAt", "date", "count", "runs"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        date: { type: "string", format: "date" },
        count: { type: "number" },
        runs: { type: "array", items: runSchema },
      },
      additionalProperties: false,
    },
    "models.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/models.schema.json`,
      title: "ModelsPayload",
      type: "object",
      required: ["version", "generatedAt", "count", "models"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        count: { type: "number" },
        models: { type: "array", items: modelSummarySchema },
      },
      additionalProperties: false,
    },
    "model-detail.schema.json": modelDetailSchema,
    "leaderboard.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/leaderboard.schema.json`,
      title: "LeaderboardPayload",
      type: "object",
      required: ["version", "generatedAt", "count", "providers"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        count: { type: "number" },
        providers: { type: "array", items: leaderboardProviderSchema },
      },
      additionalProperties: false,
    },
    "summary.schema.json": {
      $schema: JSON_SCHEMA_DRAFT,
      $id: `/api/${API_VERSION}/schemas/summary.schema.json`,
      title: "SummaryPayload",
      type: "object",
      required: ["version", "generatedAt", "leaderboard", "models"],
      properties: {
        version: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        leaderboard: {
          type: "object",
          required: ["count", "providers"],
          properties: {
            count: { type: "number" },
            providers: { type: "array", items: leaderboardProviderSchema },
          },
          additionalProperties: false,
        },
        models: {
          type: "array",
          items: {
            type: "object",
            required: ["model", "id", "lastTimestamp", "latestRun"],
            properties: {
              model: { type: "string" },
              id: { type: "string" },
              lastTimestamp: { type: ["string", "null"], format: "date-time" },
              latestRun: {
                anyOf: [
                  { type: "null" },
                  {
                    type: "object",
                    required: ["id", "timestamp", "dataUrl", "providerCount", "providerEntries"],
                    properties: {
                      id: { type: "string" },
                      timestamp: { type: "string", format: "date-time" },
                      dataUrl: { type: "string" },
                      providerCount: { type: "number" },
                      providerEntries: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["endpoint", "provider", "variant", "exact_match_rate"],
                          properties: {
                            endpoint: { type: "string" },
                            provider: { type: "string" },
                            variant: { type: ["string", "null"] },
                            exact_match_rate: { type: "number" },
                          },
                          additionalProperties: false,
                        },
                      },
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, "..")
  const publicDir = path.join(repoRoot, "public")
  const dataDir = path.join(publicDir, "data")
  const apiDir = path.join(publicDir, "api", API_VERSION)
  const runsDir = path.join(apiDir, "runs")
  const runsByDateDir = path.join(runsDir, "by-date")
  const modelDir = path.join(apiDir, "models")
  const schemaDir = path.join(apiDir, "schemas")
  const configPath = path.join(dataDir, "api-config.json")
  const apiBaseFile = `api/${API_VERSION}`
  const indexFile = `${apiBaseFile}/index.json`
  const metaFile = `${apiBaseFile}/meta.json`
  const runsFile = `${apiBaseFile}/runs.json`
  const modelsFile = `${apiBaseFile}/models.json`
  const leaderboardFile = `${apiBaseFile}/leaderboard.json`
  const summaryFile = `${apiBaseFile}/summary.json`
  const runsIndexFile = `${apiBaseFile}/runs/index.json`
  const modelFile = (modelId) => `${apiBaseFile}/models/${modelId}.json`
  const runsByDateFile = (date) => `${apiBaseFile}/runs/by-date/${date}.json`
  const dataFile = (fileName) => `data/${fileName}`
  const manifestFile = "data/manifest.json"
  const schemaDirFile = `${apiBaseFile}/schemas`
  const toRunForFile = (run, fromFilePath) => ({
    id: run.id,
    filename: run.filename,
    dataUrl: relativeUrl(fromFilePath, dataFile(run.filename)),
    model: run.model,
    timestamp: run.timestamp,
    providerEntries: run.providerEntries,
    parameters: run.parameters,
  })

  let config = DEFAULT_CONFIG
  try {
    const configRaw = await fs.readFile(configPath, "utf8")
    const parsedConfig = JSON.parse(configRaw)
    config = {
      ignoredModels: Array.isArray(parsedConfig?.ignoredModels)
        ? parsedConfig.ignoredModels.filter((item) => typeof item === "string")
        : [],
    }
  } catch {
    config = DEFAULT_CONFIG
  }

  const ignoredModels = new Set(config.ignoredModels)

  const dataEntries = await fs.readdir(dataDir, { withFileTypes: true })
  const files = dataEntries
    .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const runs = []
  const includedFiles = []

  for (const fileName of files) {
    const match = fileName.match(FILE_PATTERN)
    if (!match) continue

    const [, modelFromFile, datePart, timePart] = match
    const rawContents = await fs.readFile(path.join(dataDir, fileName), "utf8")
    const parsedFile = JSON.parse(rawContents)
    const model = parsedFile.model ?? modelFromFile.replace(/_/g, "/")
    if (ignoredModels.has(model)) continue

    const providers = sanitizeProviders(parsedFile.providers)

    runs.push({
      id: fileName.replace(/\.json$/, ""),
      filename: fileName,
      model,
      timestamp: toIsoTimestamp(datePart, timePart),
      providers,
      providerEntries: toProviderEntries(providers),
      parameters: parsedFile.parameters ?? null,
    })
    includedFiles.push(fileName)
  }

  runs.sort(sortByTimestampAsc)

  const models = Array.from(new Set(runs.map((run) => run.model))).sort()
  const modelIndex = models.map((model) => {
    const modelRuns = runs.filter((run) => run.model === model).sort(sortByTimestampAsc)
    const modelId = modelToId(model)

    return {
      model,
      id: modelId,
      runCount: modelRuns.length,
      firstTimestamp: modelRuns[0]?.timestamp ?? null,
      lastTimestamp: modelRuns[modelRuns.length - 1]?.timestamp ?? null,
      endpoint: relativeUrl(modelsFile, modelFile(modelId)),
    }
  })

  const modelDetails = modelIndex.map((entry) =>
    buildModelDetail(
      entry.model,
      runs.filter((run) => run.model === entry.model),
      toRunForFile,
      modelFile(entry.id)
    )
  )

  const leaderboard = summarizeProviders(runs)
  const generatedAt = new Date().toISOString()

  const runsByDate = new Map()
  for (const run of runs) {
    const date = run.timestamp.slice(0, 10)
    if (!runsByDate.has(date)) {
      runsByDate.set(date, [])
    }
    runsByDate.get(date).push(run)
  }
  const availableRunDates = Array.from(runsByDate.keys()).sort()

  const summaryModels = modelIndex.map((entry) => {
    const latestRun = runs
      .filter((run) => run.model === entry.model)
      .sort(sortByTimestampAsc)
      .at(-1)

    return {
      model: entry.model,
      id: entry.id,
      lastTimestamp: entry.lastTimestamp,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            timestamp: latestRun.timestamp,
            dataUrl: relativeUrl(summaryFile, dataFile(latestRun.filename)),
            providerCount: latestRun.providerEntries.length,
            providerEntries: latestRun.providerEntries.map((providerEntry) => ({
              endpoint: providerEntry.endpoint,
              provider: providerEntry.provider,
              variant: providerEntry.variant,
              exact_match_rate: providerEntry.metrics.exact_match_rate,
            })),
          }
        : null,
    }
  })

  const apiIndex = {
    version: API_VERSION,
    generatedAt,
    dataset: {
      runCount: runs.length,
      modelCount: modelIndex.length,
    },
    ignoredModels: [...ignoredModels].sort(),
    endpoints: {
      metadata: relativeUrl(indexFile, metaFile),
      runs: relativeUrl(indexFile, runsFile),
      runsIndex: relativeUrl(indexFile, runsIndexFile),
      runsByDate: relativeUrl(indexFile, `${apiBaseFile}/runs/by-date/{YYYY-MM-DD}.json`),
      models: relativeUrl(indexFile, modelsFile),
      leaderboard: relativeUrl(indexFile, leaderboardFile),
      summary: relativeUrl(indexFile, summaryFile),
      modelDetails: relativeUrl(indexFile, `${apiBaseFile}/models/{model_id}.json`),
      schemas: `${relativeUrl(indexFile, schemaDirFile)}/`,
      rawManifest: relativeUrl(indexFile, manifestFile),
    },
  }

  const meta = {
    version: API_VERSION,
    generatedAt,
    runCount: runs.length,
    modelCount: modelIndex.length,
    providerCount: leaderboard.length,
    ignoredModels: [...ignoredModels].sort(),
  }

  await fs.mkdir(path.dirname(apiDir), { recursive: true })
  await fs.mkdir(apiDir, { recursive: true })
  await fs.rm(runsDir, { recursive: true, force: true })
  await fs.mkdir(runsByDateDir, { recursive: true })
  await fs.rm(schemaDir, { recursive: true, force: true })
  await fs.mkdir(schemaDir, { recursive: true })
  await fs.rm(modelDir, { recursive: true, force: true })
  await fs.mkdir(modelDir, { recursive: true })

  await Promise.all([
    fs.writeFile(path.join(dataDir, "manifest.json"), JSON.stringify({ files: includedFiles }, null, 2)),
    fs.writeFile(path.join(apiDir, "index.json"), JSON.stringify(apiIndex, null, 2)),
    fs.writeFile(path.join(apiDir, "meta.json"), JSON.stringify(meta, null, 2)),
    fs.writeFile(
      path.join(apiDir, "runs.json"),
      JSON.stringify(
        { version: API_VERSION, generatedAt, count: runs.length, runs: runs.map((run) => toRunForFile(run, runsFile)) },
        null,
        2
      )
    ),
    fs.writeFile(
      path.join(apiDir, "models.json"),
      JSON.stringify({ version: API_VERSION, generatedAt, count: modelIndex.length, models: modelIndex }, null, 2)
    ),
    fs.writeFile(
      path.join(apiDir, "leaderboard.json"),
      JSON.stringify({ version: API_VERSION, generatedAt, count: leaderboard.length, providers: leaderboard }, null, 2)
    ),
    fs.writeFile(
      path.join(apiDir, "summary.json"),
      JSON.stringify(
        {
          version: API_VERSION,
          generatedAt,
          leaderboard: { count: leaderboard.length, providers: leaderboard },
          models: summaryModels,
        },
        null,
        2
      )
    ),
    fs.writeFile(
      path.join(runsDir, "index.json"),
      JSON.stringify(
        {
          version: API_VERSION,
          generatedAt,
          count: runs.length,
          firstTimestamp: runs[0]?.timestamp ?? null,
          lastTimestamp: runs[runs.length - 1]?.timestamp ?? null,
          availableDates: availableRunDates,
          dateEndpoints: availableRunDates.map((date) => ({
            date,
            endpoint: relativeUrl(runsIndexFile, runsByDateFile(date)),
            count: runsByDate.get(date).length,
          })),
        },
        null,
        2
      )
    ),
  ])

  await Promise.all(
    availableRunDates.map((date) =>
      fs.writeFile(
        path.join(runsByDateDir, `${date}.json`),
        JSON.stringify(
          {
            version: API_VERSION,
            generatedAt,
            date,
            count: runsByDate.get(date).length,
            runs: runsByDate.get(date).map((run) => toRunForFile(run, runsByDateFile(date))),
          },
          null,
          2
        )
      )
    )
  )

  await Promise.all(
    modelDetails.map(async (details) => {
      const filePath = path.join(modelDir, `${modelIdToPath(details.id)}.json`)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, JSON.stringify({ version: API_VERSION, generatedAt, ...details }, null, 2))
    })
  )

  const schemas = makeSchemas()
  await Promise.all(
    Object.entries(schemas).map(([fileName, schema]) =>
      fs.writeFile(path.join(schemaDir, fileName), JSON.stringify(schema, null, 2))
    )
  )

  process.stdout.write(
    `Generated data manifest and static API (${API_VERSION}): ${runs.length} runs across ${modelIndex.length} models.\n`
  )
}

main().catch((error) => {
  process.stderr.write(`Failed to generate manifest/API: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
