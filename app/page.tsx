"use client"

import { useState, useEffect } from "react"
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

export default function Page() {
  const [auditResults, setAuditResults] = useState<AuditResult[]>(sampleAuditResults)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [showAllProviders, setShowAllProviders] = useState(false)
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

  useEffect(() => {
    async function fetchData() {
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

      const parseFromManifest = async (): Promise<AuditResult[]> => {
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
                8,
              )}T${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`
              const utcTimestamp = `${formattedTimestamp}Z`

              return {
                model: fileData.model ?? modelName.replace(/_/g, "/"),
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
            .map((run) => ({
              model: run.model,
              timestamp: run.timestamp,
              providers: providersFromEntries(run.providerEntries),
            }))
        } catch {
          results = await parseFromManifest()
        }

        if (results.length > 0) {
          setAuditResults(results)
          setSelectedModel(results[0].model)
        } else {
          throw new Error("No valid audit results found")
        }
      } catch (error) {
        console.error("Error fetching audit results:", error)
        // Fallback to mock data on error
        setAuditResults(sampleAuditResults)
        setSelectedModel(sampleAuditResults[0]?.model || "")
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Get unique models
  const models = Array.from(new Set(auditResults.map((r) => r.model)))

  // Get unique providers
  const allProviders = Array.from(new Set(auditResults.flatMap((r) => Object.keys(r.providers))))

  // Calculate aggregate leaderboard data (group endpoint variants like provider/fp8, provider/fp16 under provider)
  const leaderboardAccumulator = new Map<
    string,
    { scoreSum: number; dataPoints: number; models: Set<string> }
  >()

  for (const result of auditResults) {
    for (const [endpointName, providerData] of Object.entries(result.providers)) {
      const providerName = endpointName.split("/")[0]
      const score = providerData?.exact_match_rate
      if (typeof score !== "number" || !Number.isFinite(score)) continue

      const existing = leaderboardAccumulator.get(providerName)
      if (existing) {
        existing.scoreSum += score
        existing.dataPoints += 1
        existing.models.add(result.model)
      } else {
        leaderboardAccumulator.set(providerName, {
          scoreSum: score,
          dataPoints: 1,
          models: new Set([result.model]),
        })
      }
    }
  }

  const leaderboardData = Array.from(leaderboardAccumulator.entries()).map(([provider, aggregate]) => ({
    provider,
    avgScore: aggregate.scoreSum / aggregate.dataPoints,
    modelCount: aggregate.models.size,
    dataPoints: aggregate.dataPoints,
  }))
  
  // Sort by average score
  leaderboardData.sort((a, b) => b.avgScore - a.avgScore)

  const leaderboardRows = showAllProviders ? leaderboardData : leaderboardData.slice(0, 5)

  // Get time series data for selected model
  const timeSeriesData: TimeSeriesPoint[] = selectedModel
    ? auditResults
        .filter((r) => r.model === selectedModel)
        .map((r): TimeSeriesPoint => ({
          timestamp: r.timestamp,
          ...Object.fromEntries(Object.entries(r.providers).map(([name, data]) => [name, data.exact_match_rate])),
        }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : []

  const timelineProviders = allProviders.filter((provider) =>
    timeSeriesData.some((point) => typeof point[provider] === "number" && Number.isFinite(point[provider]))
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
        <Card>
          <CardHeader>
            <CardTitle>How to read this leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              We rank inference providers on how accurately they serve models. Our ranking is based on the provider's "exact match rate": the share of output tokens sent by the provider that match tokens sourced from a trusted reference implementation of the model. We simply give inference providers the same inputs as our trusted reference implementations of models and see how similar the output tokens are.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Exact match rates above 95% are typical. Lower rates can indicate that the quantization used by the provider is causing the model to behave differently, that the provider has a bug in their inference setup, or that the provider is using a non-standard chat template or tokenizer.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              For more details on how we rank providers, read our blog post [link pending].
            </p>
          </CardContent>
        </Card>
        {/* Overall Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle>Overall Provider Rankings</CardTitle>
            <CardDescription>The rate that a token sampled from a provider matches our reference implementation averaged across all models and timesteps</CardDescription>
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

        {/* Model-Specific Timeline */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle>Provider Performance Over Time</CardTitle>
                <CardDescription>Exact match rate over time for selected model</CardDescription>
              </div>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-full sm:w-[320px]">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {timeSeriesData.length > 0 ? (
              <TimeSeriesChart data={timeSeriesData} providers={timelineProviders} />
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                Select a model to view timeline
              </div>
            )}
          </CardContent>
        </Card>

        {/* Provider Comparison */}
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
