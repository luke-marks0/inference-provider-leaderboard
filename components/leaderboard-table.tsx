import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { getExactMatchRateTextColor } from "@/lib/utils"

type LeaderboardData = {
  provider: string
  avgScore: number
  modelCount: number
  dataPoints: number
}

export function LeaderboardTable({ data }: { data: LeaderboardData[] }) {
  const rows = data.filter((item) => item.dataPoints > 0)

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-[var(--neutral-border-secondary)]">
            <TableHead className="w-16">Rank</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead className="text-right">Avg Exact Match Rate</TableHead>
            <TableHead className="text-right">Models</TableHead>
            <TableHead className="text-right">Data Points</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((item, index) => (
            <TableRow key={item.provider} className="hover:bg-muted/30">
              <TableCell className="font-medium">
                <span>#{index + 1}</span>
              </TableCell>
              <TableCell className="font-mono text-sm">{item.provider}</TableCell>
              <TableCell className="text-right">
                <span className={`text-lg font-bold ${getExactMatchRateTextColor(item.avgScore)}`}>
                  {(item.avgScore * 100).toFixed(2)}%
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Badge
                  variant="outline"
                  className="border border-border bg-[var(--neutral-border-secondary)] min-w-7 h-7 px-0 inline-flex items-center justify-center"
                >
                  {item.modelCount}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-muted-foreground">{item.dataPoints}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
