import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

type LeaderboardData = {
  provider: string
  avgScore: number
  modelCount: number
  dataPoints: number
}

export function LeaderboardTable({ data }: { data: LeaderboardData[] }) {
  const getScoreColor = (score: number) => {
    if (score >= 0.95) return "text-[#55C89F]"
    if (score >= 0.9) return "text-[#A6D8C0]"
    if (score >= 0.85) return "text-[#FFB3A8]"
    if (score >= 0.8) return "text-[#FF563F]"
    return "text-muted-foreground"
  }

  const rows = data.filter((item) => item.dataPoints > 0)

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#F0F0F0]">
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
                <span className={`text-lg font-bold ${getScoreColor(item.avgScore)}`}>
                  {(item.avgScore * 100).toFixed(2)}%
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Badge
                  variant="secondary"
                  className="border border-border min-w-7 h-7 px-0 inline-flex items-center justify-center"
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
