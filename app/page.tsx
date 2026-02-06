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

export default function Page() {
  const [auditResults, setAuditResults] = useState<AuditResult[]>(sampleAuditResults)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [showAllProviders, setShowAllProviders] = useState(false)
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

  useEffect(() => {
    async function fetchData() {
      try {
        const fetchFromManifest = async () => {
          const manifestResponse = await fetch(`${basePath}/data/manifest.json`)
          if (!manifestResponse.ok) {
            throw new Error("Manifest response was not ok")
          }
          const manifest = await manifestResponse.json()
          const files = Array.isArray(manifest?.files) ? manifest.files : []
          if (files.length === 0) {
            throw new Error("No files in manifest")
          }

          const results: AuditResult[] = []
          for (const fileName of files) {
            try {
              const fileResponse = await fetch(`${basePath}/data/${fileName}`)
              if (!fileResponse.ok) continue
              const fileData = await fileResponse.json()

              const match = fileName.match(/(.+)_audit_results_(\d{8}_\d{6})\.json/)
              if (!match) continue

              const [, modelName, timestamp] = match
              const formattedTimestamp = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(
                6,
                8,
              )}T${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`

              results.push({
                model: fileData.model ?? modelName.replace(/_/g, "/"),
                timestamp: formattedTimestamp,
                providers: fileData.providers ?? {},
              })
            } catch {
              continue
            }
          }
          return results
        }

        const results = await fetchFromManifest()

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

  // Calculate aggregate leaderboard data
  const leaderboardData = allProviders.map((provider) => {
    const providerResults = auditResults.filter((r) => r.providers[provider])
  
    // Extract scores and drop NaN / non-numeric values
    const rawScores = providerResults.map((r) => r.providers[provider]?.exact_match_rate)
    const scores = rawScores.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
  
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const modelCount = new Set(providerResults.map((r) => r.model)).size
  
    return {
      provider,
      avgScore,
      modelCount,
      dataPoints: scores.length,
    }
  }).filter((entry) => entry.dataPoints > 0)
  
  // Sort by average score
  leaderboardData.sort((a, b) => b.avgScore - a.avgScore)

  const leaderboardRows = showAllProviders ? leaderboardData : leaderboardData.slice(0, 10)

  // Get time series data for selected model
  const timeSeriesData = selectedModel
    ? auditResults
        .filter((r) => r.model === selectedModel)
        .map((r) => ({
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
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inference Provider Leaderboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Inference reliability metrics</p>
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

      <div className="container mx-auto px-4 py-8 space-y-6">
        <section className="rounded-lg border border-border/60 bg-card/70 p-5">
          <h2 className="text-lg font-semibold">How to read this leaderboard</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We audit providers by comparing their outputs against trusted reference implementations of models. 
	    The exact match rate is the share of tokens that match the reference; higher means the
            provider is more likely serving models correctly. We compare tens of thousands of tokens per run. 
	    This means that low exact match rates imply that a model is behaving differently than expected.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Exact match rates above 95% are typical; sustained drops can indicate model substitution, heavy quantization, or
	    that we are incorrectly tokenizing the provider's response.
          </p>
        </section>
        {/* Overall Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle>Overall Provider Rankings</CardTitle>
            <CardDescription>The rate that a token sampled from a provider matches our reference implementation averaged across all models and timesteps</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <LeaderboardTable data={leaderboardRows} />
              {leaderboardData.length > 10 && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    className="hover:bg-[#FFB3A8] hover:text-foreground"
                    onClick={() => setShowAllProviders((prev) => !prev)}
                  >
                    {showAllProviders ? "Show top 10 providers" : "Show all providers"}
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
