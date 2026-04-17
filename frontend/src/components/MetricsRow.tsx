import { ChartColumnBig, Siren, Trash2, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardData } from '@/types/dashboard'

type MetricsRowProps = {
  data: DashboardData
}

function MetricsRow({ data }: MetricsRowProps) {
  const metrics = [
    {
      label: 'Total Bins',
      value: data.total_bins,
      icon: Trash2,
      accent: 'from-emerald-100 to-emerald-50 text-emerald-800',
    },
    {
      label: 'Full Bins',
      value: data.full_bins,
      icon: Siren,
      accent: 'from-amber-100 to-amber-50 text-amber-900',
    },
    {
      label: 'Average Fill %',
      value: `${data.avg_fill.toFixed(1)}%`,
      icon: ChartColumnBig,
      accent: 'from-teal-100 to-cyan-50 text-teal-900',
    },
    {
      label: 'Dispatch Queue',
      value: data.urgent_bins,
      icon: Truck,
      accent: 'from-sky-100 to-cyan-50 text-sky-900',
    },
  ]

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <Card key={metric.label} className="border-white/70 bg-card/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{metric.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-3xl font-semibold tracking-tight">{metric.value}</p>
                <div className={`rounded-xl bg-gradient-to-br p-2 ${metric.accent}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </section>
  )
}

export default MetricsRow
