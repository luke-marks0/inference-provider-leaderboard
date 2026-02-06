"use client"

import { useMemo } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush,
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

export function TimeSeriesChart({
  data,
  providers,
}: {
  data: TimeSeriesData[]
  providers: string[]
}) {
  const formattedData = useMemo(() => {
    const withTime = data.map((item) => ({
      ...item,
      time: new Date(
        item.timestamp.toString().replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6"),
      ).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }))

    if (providers.length === 0) return withTime

    let lastValidIndex = -1
    for (let i = withTime.length - 1; i >= 0; i--) {
      const point = withTime[i]
      const hasAnyProvider = providers.some((provider) => {
        const value = point[provider]
        return typeof value === "number" && Number.isFinite(value)
      })
      if (hasAnyProvider) {
        lastValidIndex = i
        break
      }
    }

    return lastValidIndex >= 0 ? withTime.slice(0, lastValidIndex + 1) : withTime
  }, [data, providers])

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={formattedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
        <XAxis
          dataKey="time"
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)" }}
          tickLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          domain={[0.7, 1]}
          tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)" }}
          tickLine={{ stroke: "var(--border)" }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          formatter={(value: number) => `${(value * 100).toFixed(2)}%`}
        />
        <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="line" />
        <Brush
          dataKey="time"
          height={30}
          stroke="var(--primary)"
          travellerWidth={12}
          tickFormatter={() => ""}
        />
        {providers.map((provider, index) => (
          <Line
            key={provider}
            type="monotone"
            dataKey={provider}
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth={3}
            dot={{
              r: 6,
              fill: CHART_COLORS[index % CHART_COLORS.length],
              stroke: CHART_COLORS[index % CHART_COLORS.length],
              strokeWidth: 2,
            }}
            activeDot={{ r: 8 }}
            name={provider}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
