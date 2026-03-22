"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LeaderboardTable } from "@/components/leaderboard-table"
import { TimeSeriesChart } from "@/components/time-series-chart"
import { ProviderComparison } from "@/components/provider-comparison"
import { sampleAuditResults } from "@/lib/mock-data"
import type { AuditResult } from "@/lib/types"

type TimeSeriesPoint = {
  timestamp: string
  [key: string]: string | number
}

function formatModelLabel(model: string) {
  return model.split("/").at(-1)?.toLowerCase() ?? model.toLowerCase()
}

export function LeaderboardPage({ enableVailTimeline }: { enableVailTimeline: boolean }) {
  const [auditResults, setAuditResults] = useState<AuditResult[]>(sampleAuditResults)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [showAllProviders, setShowAllProviders] = useState(false)
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

  useEffect(() => {
    async function fetchData() {
      const fetchIgnoredModels = async (): Promise<Set<string>> => {
        try {
          const metaResponse = await fetch(`${basePath}/api/v1/meta.json`)
          if (metaResponse.ok) {
            const meta = await metaResponse.json()
            const ignored = Array.isArray(meta?.ignoredModels)
              ? meta.ignoredModels.filter((value: unknown): value is string => typeof value === "string")
              : []
            return new Set(ignored)
          }
        } catch {
          // Fall through to api-config fallback.
        }

        try {
          const configResponse = await fetch(`${basePath}/data/api-config.json`)
          if (!configResponse.ok) return new Set()
          const config = await configResponse.json()
          const ignored = Array.isArray(config?.ignoredModels)
            ? config.ignoredModels.filter((value: unknown): value is string => typeof value === "string")
            : []
          return new Set(ignored)
        } catch {
          return new Set()
        }
      }

      const providersFromEntries = (entries: unknown): AuditResult["providers"] => {
        if (!Array.isArray(entries)) return {}

        return Object.fromEntries(
          entries
            .filter(
              (entry): entry is { endpoint: string; metrics: AuditResult["providers"][string] } =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { endpoint?: unknown }).endpoint === "string" &&
                typeof (entry as { metrics?: unknown }).metrics === "object" &&
                (entry as { metrics?: unknown }).metrics !== null
            )
            .map((entry) => [entry.endpoint, entry.metrics])
        )
      }

      const parseFromManifest = async (ignoredModels: Set<string>): Promise<AuditResult[]> => {
        const manifestResponse = await fetch(`${basePath}/data/manifest.json`)
        if (!manifestResponse.ok) {
          throw new Error("Manifest response was not ok")
        }

        const manifest = await manifestResponse.json()
        const files = Array.isArray(manifest?.files) ? manifest.files : []
        if (files.length === 0) {
          throw new Error("No files in manifest")
        }

        const candidateFiles = files.filter((fileName: string) =>
          /(.+)_audit_results_(\d{8}_\d{6})\.json/.test(fileName)
        )
        if (candidateFiles.length === 0) {
          throw new Error("No valid audit result filenames in manifest")
        }

        const parsedResults = await Promise.all(
          candidateFiles.map(async (fileName: string): Promise<AuditResult | null> => {
            const match = fileName.match(/(.+)_audit_results_(\d{8}_\d{6})\.json/)
            if (!match) return null

            try {
              const fileResponse = await fetch(`${basePath}/data/${fileName}`)
              if (!fileResponse.ok) return null

              const fileData = await fileResponse.json()
              const [, modelName, timestamp] = match
              const formattedTimestamp = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(
                6,
                8
              )}T${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`
              const utcTimestamp = `${formattedTimestamp}Z`
              const resolvedModel = fileData.model ?? modelName.replace(/_/g, "/")
              if (ignoredModels.has(resolvedModel)) return null

              return {
                model: resolvedModel,
                timestamp: utcTimestamp,
                providers: fileData.providers ?? {},
              }
            } catch {
              return null
            }
          })
        )

        return parsedResults.filter((result): result is AuditResult => result !== null)
      }

      try {
        let results: AuditResult[] = []
        const ignoredModels = await fetchIgnoredModels()

        try {
          const runsResponse = await fetch(`${basePath}/api/v1/runs.json`)
          if (!runsResponse.ok) {
            throw new Error("Static API response was not ok")
          }

          const payload = await runsResponse.json()
          const apiRuns: unknown[] = Array.isArray(payload?.runs) ? payload.runs : []
          results = apiRuns
            .filter(
              (run: unknown): run is { model: string; timestamp: string; providerEntries?: unknown } =>
                typeof run === "object" &&
                run !== null &&
                typeof (run as { model?: unknown }).model === "string" &&
                typeof (run as { timestamp?: unknown }).timestamp === "string"
            )
            .filter((run) => !ignoredModels.has(run.model))
            .map((run) => ({
              model: run.model,
              timestamp: run.timestamp,
              providers: providersFromEntries(run.providerEntries),
            }))
        } catch {
          results = await parseFromManifest(ignoredModels)
        }

        if (results.length > 0) {
          setAuditResults(results)
          setSelectedModel(results[0].model)
        } else {
          throw new Error("No valid audit results found")
        }
      } catch (error) {
        console.error("Error fetching audit results:", error)
        const fallbackResults = sampleAuditResults
        setAuditResults(fallbackResults)
        setSelectedModel(fallbackResults[0]?.model || "")
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [basePath])

  const modelMetricAvailability = useMemo(() => {
    const availability = new Map<string, { hasExact: boolean; hasVail: boolean }>()

    for (const result of auditResults) {
      const current = availability.get(result.model) ?? { hasExact: false, hasVail: false }

      for (const providerData of Object.values(result.providers)) {
        if (typeof providerData?.exact_match_rate === "number" && Number.isFinite(providerData.exact_match_rate)) {
          current.hasExact = true
        }

        if (
          typeof providerData?.vail?.divergence_ratio === "number" &&
          Number.isFinite(providerData.vail.divergence_ratio)
        ) {
          current.hasVail = true
        }
      }

      availability.set(result.model, current)
    }

    return availability
  }, [auditResults])

  const models = useMemo(
    () =>
      Array.from(modelMetricAvailability.entries())
        .filter(([, availability]) =>
          enableVailTimeline ? availability.hasExact || availability.hasVail : availability.hasExact
        )
        .map(([model]) => model)
        .sort(),
    [enableVailTimeline, modelMetricAvailability]
  )
  const allProviders = Array.from(new Set(auditResults.flatMap((r) => Object.keys(r.providers))))

  useEffect(() => {
    if (models.length === 0) {
      if (selectedModel !== "") {
        setSelectedModel("")
      }
      return
    }

    if (!models.includes(selectedModel)) {
      setSelectedModel(models[0])
    }
  }, [models, selectedModel])

  const leaderboardAccumulator = new Map<
    string,
    {
      modelScores: Map<string, { scoreSum: number; dataPoints: number }>
      dataPoints: number
    }
  >()

  for (const result of auditResults) {
    for (const [endpointName, providerData] of Object.entries(result.providers)) {
      const providerName = endpointName.split("/")[0]
      const score = providerData?.exact_match_rate
      if (typeof score !== "number" || !Number.isFinite(score)) continue

      const existing = leaderboardAccumulator.get(providerName)
      if (existing) {
        existing.dataPoints += 1
        const modelAggregate = existing.modelScores.get(result.model)
        if (modelAggregate) {
          modelAggregate.scoreSum += score
          modelAggregate.dataPoints += 1
        } else {
          existing.modelScores.set(result.model, {
            scoreSum: score,
            dataPoints: 1,
          })
        }
      } else {
        leaderboardAccumulator.set(providerName, {
          modelScores: new Map([
            [
              result.model,
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

  const leaderboardData = Array.from(leaderboardAccumulator.entries())
    .map(([provider, aggregate]) => {
      const modelAverages = Array.from(aggregate.modelScores.values()).map(
        (modelAggregate) => modelAggregate.scoreSum / modelAggregate.dataPoints
      )

      if (modelAverages.length === 0) return null

      const avgScore = modelAverages.reduce((sum, value) => sum + value, 0) / modelAverages.length

      return {
        provider,
        avgScore,
        modelCount: aggregate.modelScores.size,
        dataPoints: aggregate.dataPoints,
      }
    })
    .filter((item): item is { provider: string; avgScore: number; modelCount: number; dataPoints: number } => item !== null)

  leaderboardData.sort((a, b) => b.avgScore - a.avgScore)

  const leaderboardRows = showAllProviders ? leaderboardData : leaderboardData.slice(0, 5)

  const timeSeriesData: TimeSeriesPoint[] = selectedModel
    ? auditResults
        .filter((r) => r.model === selectedModel)
        .map((r): TimeSeriesPoint => ({
          timestamp: r.timestamp,
          ...Object.fromEntries(
            Object.entries(r.providers).flatMap(([name, data]) => {
              const entries: Array<[string, number]> = []

              if (typeof data.exact_match_rate === "number" && Number.isFinite(data.exact_match_rate)) {
                entries.push([name, data.exact_match_rate])
              }

              if (
                typeof data.vail?.divergence_ratio === "number" &&
                Number.isFinite(data.vail.divergence_ratio)
              ) {
                entries.push([`${name}__vail`, data.vail.divergence_ratio])
              }

              return entries
            })
          ),
        }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : []

  const timelineProviders = allProviders.filter((provider) =>
    timeSeriesData.some(
      (point) =>
        (typeof point[provider] === "number" && Number.isFinite(point[provider])) ||
        (typeof point[`${provider}__vail`] === "number" && Number.isFinite(point[`${provider}__vail`]))
    )
  )
  const selectedModelHasExactData = timelineProviders.some((provider) =>
    timeSeriesData.some((point) => typeof point[provider] === "number" && Number.isFinite(point[provider]))
  )

  const selectedModelHasVailData =
    enableVailTimeline &&
    timelineProviders.some((provider) =>
      timeSeriesData.some(
        (point) => typeof point[`${provider}__vail`] === "number" && Number.isFinite(point[`${provider}__vail`])
      )
    )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading audit results...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-[var(--neutral-border-secondary)] bg-card/95 backdrop-blur-sm sticky top-0 z-10 mb-[var(--size-64)]">
        <div className="container mx-auto px-[var(--size-24)] md:px-[var(--size-48)] py-[var(--size-24)] md:py-[var(--size-48)] flex items-center justify-between gap-[var(--size-24)]">
          <div>
            <h1 className="text-2xl md:text-3xl">Inference Provider Leaderboard</h1>
            <p className="text-sm text-muted-foreground mt-[var(--size-4)]">Inference reliability metrics</p>
          </div>
          <Image
            src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon_Light_Primary.svg`}
            alt="Company logo"
            className="h-12 w-auto"
            width={200}
            height={48}
          />
        </div>
      </header>

      <div className="container mx-auto px-[var(--size-24)] md:px-[var(--size-48)] pb-[var(--size-48)] space-y-[var(--size-24)]">
        <Card className="gap-1">
          <CardHeader className="pb-2">
            <CardTitle>How to read this leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              We rank inference providers on how accurately they serve models. Our ranking is based on the provider&apos;s
              &quot;exact match rate&quot;: the share of output tokens sent by the provider that match tokens sourced from a trusted
              reference implementation of the model. We simply give inference providers the same inputs as our trusted
              reference implementations of models and see how similar the output tokens are.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Exact match rates above 95% are typical. Lower rates can indicate that the quantization used by the provider is
              causing the model to behave differently, that the provider has a bug in their inference setup, or that the
              provider is using a non-standard chat template or tokenizer.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              For more details on how we rank providers, read our blog post [link pending].
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Overall Provider Rankings</CardTitle>
            <CardDescription>
              The average exact match rate per model, then averaged across models so each model contributes equally
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <LeaderboardTable data={leaderboardRows} />
              {leaderboardData.length > 5 && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    className="hover:bg-[var(--brand-primary-light)] hover:text-foreground"
                    onClick={() => setShowAllProviders((prev) => !prev)}
                  >
                    {showAllProviders ? "Show top 5 providers" : "Show all providers"}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-1">
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <CardTitle>Provider Performance Over Time</CardTitle>
                <CardDescription>
                  {selectedModelHasExactData && selectedModelHasVailData
                    ? "Exact match rate and VAIL divergence over time for selected model"
                    : selectedModelHasVailData
                      ? "VAIL divergence over time for selected model"
                      : "Exact match rate over time for selected model"}
                </CardDescription>
              </div>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-full sm:w-[320px]">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {formatModelLabel(model)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {timeSeriesData.length > 0 ? (
              <div className="space-y-2">
                <TimeSeriesChart
                  data={timeSeriesData}
                  providers={timelineProviders}
                  showExactMatch={true}
                  showVail={selectedModelHasVailData}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                Select a model to view timeline
              </div>
            )}
          </CardContent>
        </Card>

        {selectedModel && (
          <ProviderComparison
            model={selectedModel}
            auditResults={auditResults.filter((r) => r.model === selectedModel)}
          />
        )}
      </div>
    </div>
  )
}
