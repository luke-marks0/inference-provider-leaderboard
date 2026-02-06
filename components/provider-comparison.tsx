import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown } from "lucide-react"

type ProviderData = {
  exact_match_rate: number
  avg_prob: number
  avg_margin: number
  avg_logit_rank: number
  avg_gumbel_rank: number
  infinite_margin_rate: number
  total_tokens: number
  n_sequences: number
}

type AuditResult = {
  model: string
  timestamp: string
  providers: Record<string, ProviderData>
}

export function ProviderComparison({
  model,
  auditResults,
}: {
  model: string
  auditResults: AuditResult[]
}) {
  const getScoreColor = (score: number) => {
    if (score >= 0.95) return "text-[#55C89F]"
    if (score >= 0.9) return "text-[#A6D8C0]"
    if (score >= 0.85) return "text-[#FFB3A8]"
    if (score >= 0.8) return "text-[#FF563F]"
    return "text-muted-foreground"
  }

  const sortedResults = [...auditResults].sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  // Get unique providers for this model
  const providers = Array.from(new Set(sortedResults.flatMap((r) => Object.keys(r.providers))))

  // Calculate stats for each provider
  const providerStats = providers.map((provider) => {
    const providerData = sortedResults
      .filter((r) => r.providers[provider])
      .map((r) => r.providers[provider])

    // Extract scores and keep only finite numbers
    const rawScores = providerData.map((d) => d.exact_match_rate)
    const scores = rawScores.filter((v): v is number => typeof v === "number" && Number.isFinite(v))

    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const minScore = scores.length > 0 ? Math.min(...scores) : 0
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0

    // Latest valid score (walk backward until we find a finite number)
    const latestScore =
      (() => {
        for (let i = rawScores.length - 1; i >= 0; i--) {
          const v = rawScores[i]
          if (typeof v === "number" && Number.isFinite(v)) return v
        }
        return 0
      })()

    // Trend based on last two valid scores
    const trend =
      (() => {
        if (scores.length < 2) return 0
        const last = scores[scores.length - 1]
        const prev = scores[scores.length - 2]
        return last - prev
      })()

    return {
      provider,
      avgScore,
      minScore,
      maxScore,
      latestScore,
      trend,
      dataPoints: scores.length, // valid runs only
    }
  }).filter((stat) => stat.dataPoints > 0)

  // Sort by average score
  providerStats.sort((a, b) => b.avgScore - a.avgScore)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider Comparison - {model}</CardTitle>
        <CardDescription>Detailed statistics for each provider</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providerStats.map((stat, index) => (
            <Card key={stat.provider} className="border hover:bg-muted/50 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-base font-mono">{stat.provider}</CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant={index === 0 ? "default" : "secondary"}
                        className="border border-border"
                      >
                        #{index + 1}
                      </Badge>
                      <Badge variant="outline" className="text-xs bg-[#F0F0F0]">
                        {stat.dataPoints} runs
                      </Badge>
                    </div>
                  </div>
                  {stat.trend !== 0 && (
                    <div className="flex items-center">
                      {stat.trend > 0 ? (
                        <TrendingUp className="w-5 h-5 text-chart-3" />
                      ) : (
                        <TrendingDown className="w-5 h-5 text-destructive" />
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Average Score</p>
                  <p className={`text-2xl font-bold ${getScoreColor(stat.avgScore)}`}>
                    {(stat.avgScore * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-3 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Min</p>
                    <p className="text-sm font-semibold text-foreground">
                      {(stat.minScore * 100).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Max</p>
                    <p className="text-sm font-semibold text-foreground">
                      {(stat.maxScore * 100).toFixed(2)}%
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Latest Score</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-lg font-bold text-foreground">
                      {(stat.latestScore * 100).toFixed(2)}%
                    </p>
                    {stat.trend !== 0 && (
                      <span
                        className="text-xs font-medium text-foreground"
                      >
                        {stat.trend > 0 ? "+" : ""}
                        {(stat.trend * 100).toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
