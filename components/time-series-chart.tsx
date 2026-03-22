"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

const CHART_COLORS = [
  "#FF563F",
  "#FFB3A8",
  "#6E73FF",
  "#BEC9FF",
  "#606060",
  "#D6D5D5",
  "#55C89F",
  "#A6D8C0",
  "#FFD24D",
  "#FFED9E",
]

type TimeSeriesData = {
  timestamp: string
  [key: string]: string | number
}

type ChartSection = "exact" | "vail"

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatAxisDate(timestamp: string) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatMetricValue(value: number, section: ChartSection) {
  if (section === "exact") {
    return `${(value * 100).toFixed(2)}%`
  }

  return value.toFixed(3)
}

function getSectionDomain(data: TimeSeriesData[], providers: string[], section: ChartSection): [number, number] | ["auto", "auto"] {
  const values = data.flatMap((point) =>
    providers.flatMap((provider) => {
      const dataKey = section === "exact" ? provider : `${provider}__vail`
      const value = point[dataKey]
      return typeof value === "number" && Number.isFinite(value) ? [value] : []
    })
  )

  if (values.length === 0) return ["auto", "auto"]

  if (section === "exact") {
    const minPercent = Math.max(0, Math.floor(Math.min(...values) * 100))
    return [minPercent / 100, 1]
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    const padding = min === 0 ? 0.1 : Math.abs(min) * 0.1
    return [min - padding, max + padding]
  }

  const padding = Math.max((max - min) * 0.1, 0.05)
  return [Math.max(0, min - padding), max + padding]
}

function getExactAxisTicks(domain: [number, number] | ["auto", "auto"]) {
  if (domain[0] === "auto") return undefined

  const minPercent = Math.round(domain[0] * 100)
  const maxPercent = Math.round(domain[1] * 100)
  const span = maxPercent - minPercent

  let step = 2
  if (span > 24) step = 5
  else if (span > 12) step = 3

  const ticks: number[] = []
  for (let value = minPercent; value <= maxPercent; value += step) {
    ticks.push(value / 100)
  }

  if (ticks[ticks.length - 1] !== 1) {
    ticks.push(1)
  }

  return ticks
}

function SeriesChart({
  data,
  providers,
  providerColors,
  section,
  showXAxis,
  showBrush,
  height,
  startIndex,
  endIndex,
  onBrushChange,
}: {
  data: TimeSeriesData[]
  providers: string[]
  providerColors: Record<string, string>
  section: ChartSection
  showXAxis: boolean
  showBrush: boolean
  height: number
  startIndex?: number
  endIndex?: number
  onBrushChange?: (range: { startIndex?: number; endIndex?: number }) => void
}) {
  const domain = useMemo(() => getSectionDomain(data, providers, section), [data, providers, section])
  const exactTicks = useMemo(
    () => (section === "exact" ? getExactAxisTicks(domain) : undefined),
    [domain, section]
  )

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        {showXAxis ? (
          <XAxis
            dataKey="axisDate"
            stroke="var(--muted-foreground)"
            tick={{ fill: "var(--muted-foreground)" }}
            tickLine={{ stroke: "var(--border)" }}
            minTickGap={24}
            padding={{ left: 16, right: 16 }}
          />
        ) : (
          <XAxis dataKey="axisDate" hide />
        )}
        <YAxis
          domain={domain}
          ticks={exactTicks}
          tickFormatter={(value) =>
            typeof value === "number"
              ? section === "exact"
                ? `${Math.round(value * 100)}%`
                : formatMetricValue(value, section)
              : String(value)
          }
          width={section === "exact" ? 64 : 72}
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)" }}
          tickLine={{ stroke: "var(--border)" }}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          wrapperStyle={{ zIndex: 1000, pointerEvents: "none" }}
          formatter={(value: number) => formatMetricValue(value, section)}
          labelFormatter={(_, payload) => {
            const point = payload?.[0]?.payload as { time?: string } | undefined
            return point?.time ?? ""
          }}
        />
        {section === "exact" ? <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="line" /> : null}
        {showBrush ? (
          <Brush
            dataKey="time"
            height={30}
            stroke="var(--primary)"
            travellerWidth={12}
            tickFormatter={() => ""}
            startIndex={startIndex}
            endIndex={endIndex}
            onChange={onBrushChange}
          />
        ) : null}
        {providers.map((provider, index) => {
          const dataKey = section === "exact" ? provider : `${provider}__vail`
          const color = providerColors[provider] ?? CHART_COLORS[index % CHART_COLORS.length]

          return (
            <Line
              key={`${section}-${provider}`}
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={3}
              dot={{
                r: 6,
                fill: color,
                stroke: color,
                strokeWidth: 2,
              }}
              activeDot={{ r: 8 }}
              name={provider}
              connectNulls
              isAnimationActive={false}
            />
          )
        })}
      </LineChart>
    </ResponsiveContainer>
  )
}

function sectionTitle(section: ChartSection) {
  return section === "exact" ? "Exact Match Rate" : "VAIL Divergence Score"
}

export function TimeSeriesChart({
  data,
  providers,
  showExactMatch,
  showVail,
}: {
  data: TimeSeriesData[]
  providers: string[]
  showExactMatch: boolean
  showVail: boolean
}) {
  const formattedData = useMemo(() => {
    const withTime: Array<TimeSeriesData & { time: string }> = data.map((item) => ({
      ...item,
      time: formatTimestamp(item.timestamp),
      axisDate: formatAxisDate(item.timestamp),
    }))

    if (providers.length === 0) return withTime

    let lastValidIndex = -1
    for (let i = withTime.length - 1; i >= 0; i--) {
      const point = withTime[i]
      const hasAnyProvider = providers.some((provider) => {
        const exactValue = point[provider]
        const vailValue = point[`${provider}__vail`]
        return (
          (typeof exactValue === "number" && Number.isFinite(exactValue)) ||
          (typeof vailValue === "number" && Number.isFinite(vailValue))
        )
      })
      if (hasAnyProvider) {
        lastValidIndex = i
        break
      }
    }

    return lastValidIndex >= 0 ? withTime.slice(0, lastValidIndex + 1) : withTime
  }, [data, providers])
  const [brushRange, setBrushRange] = useState(() => ({
    startIndex: 0,
    endIndex: Math.max(formattedData.length - 1, 0),
  }))

  useEffect(() => {
    setBrushRange((current) => {
      const nextEndIndex = Math.max(formattedData.length - 1, 0)
      return {
        startIndex: Math.min(current.startIndex, nextEndIndex),
        endIndex: nextEndIndex,
      }
    })
  }, [formattedData.length])

  const exactProviders = useMemo(
    () =>
      providers.filter((provider) =>
        formattedData.some((point) => typeof point[provider] === "number" && Number.isFinite(point[provider]))
      ),
    [formattedData, providers]
  )

  const vailProviders = useMemo(
    () =>
      providers.filter((provider) =>
        formattedData.some(
          (point) => typeof point[`${provider}__vail`] === "number" && Number.isFinite(point[`${provider}__vail`])
        )
      ),
    [formattedData, providers]
  )

  const shouldShowExact = showExactMatch && exactProviders.length > 0
  const shouldShowVail = showVail && vailProviders.length > 0
  const maxBrushIndex = Math.max(formattedData.length - 1, 0)
  const clampedStartIndex = Math.min(brushRange.startIndex, maxBrushIndex)
  const clampedEndIndex = Math.max(clampedStartIndex, Math.min(brushRange.endIndex, maxBrushIndex))
  const visibleData = useMemo(
    () => formattedData.slice(clampedStartIndex, clampedEndIndex + 1),
    [clampedEndIndex, clampedStartIndex, formattedData]
  )
  const handleBrushChange = (range: { startIndex?: number; endIndex?: number }) => {
    setBrushRange({
      startIndex: Math.min(range.startIndex ?? 0, maxBrushIndex),
      endIndex: Math.max(range.startIndex ?? 0, Math.min(range.endIndex ?? maxBrushIndex, maxBrushIndex)),
    })
  }
  const providerColors = useMemo(
    () =>
      Object.fromEntries(
        providers.map((provider, index) => [provider, CHART_COLORS[index % CHART_COLORS.length]])
      ) as Record<string, string>,
    [providers]
  )

  if (!shouldShowExact && !shouldShowVail) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">No timeline data enabled</div>
  }

  if (shouldShowExact && shouldShowVail) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Exact Match Rate</p>
          <SeriesChart
            data={visibleData}
            providers={exactProviders}
            providerColors={providerColors}
            section="exact"
            showXAxis={false}
            showBrush={false}
            height={240}
          />
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">VAIL Divergence Score</p>
          <SeriesChart
            data={formattedData}
            providers={vailProviders}
            providerColors={providerColors}
            section="vail"
            showXAxis={true}
            showBrush={true}
            height={240}
            startIndex={clampedStartIndex}
            endIndex={clampedEndIndex}
            onBrushChange={handleBrushChange}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {sectionTitle(shouldShowExact ? "exact" : "vail")}
      </p>
      <SeriesChart
        data={formattedData}
        providers={shouldShowExact ? exactProviders : vailProviders}
        providerColors={providerColors}
        section={shouldShowExact ? "exact" : "vail"}
        showXAxis={true}
        showBrush={true}
        height={400}
        startIndex={clampedStartIndex}
        endIndex={clampedEndIndex}
        onBrushChange={handleBrushChange}
      />
    </div>
  )
}
