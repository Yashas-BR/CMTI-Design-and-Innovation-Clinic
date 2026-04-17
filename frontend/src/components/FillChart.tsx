import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DataRow } from '@/types/dashboard'

type FillChartProps = {
  rows: DataRow[]
}

type ChartPoint = {
  binId: string
  fill: number
  status: string
}

function getStatusColor(status: string) {
  const value = status.toLowerCase()
  if (value.includes('low')) {
    return '#34d399'
  }
  if (value.includes('medium')) {
    return '#fbbf24'
  }
  return '#f87171'
}

function FillChart({ rows }: FillChartProps) {
  const data: ChartPoint[] = rows.map((row, index) => ({
    binId: String(row.Bin_ID ?? `B-${index + 1}`),
    fill: Number(row['Fill%'] ?? 0),
    status: String(row.Status ?? 'Unknown'),
  }))

  return (
    <Card className="border-white/70 bg-card/80 shadow-sm">
      <CardHeader>
        <CardTitle>Bin Fill Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 20, left: -10, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="binId"
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 14,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--card))',
                }}
              />
              <Bar dataKey="fill" radius={[8, 8, 0, 0]}>
                {data.map((point) => (
                  <Cell key={point.binId} fill={getStatusColor(point.status)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export default FillChart
