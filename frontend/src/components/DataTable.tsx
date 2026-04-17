import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { DataRow, TableCell as ValueCell } from '@/types/dashboard'

type DataTableProps = {
  rows: DataRow[]
  emptyMessage?: string
}

function formatCell(value: ValueCell): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${value}` : value.toFixed(2)
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  return value ?? '-'
}

function statusVariant(value: string): 'default' | 'secondary' | 'outline' {
  const normalized = value.toLowerCase()
  if (normalized.includes('low')) {
    return 'secondary'
  }
  if (normalized.includes('high') || normalized.includes('critical')) {
    return 'default'
  }
  return 'outline'
}

function DataTable({ rows, emptyMessage = 'No data available.' }: DataTableProps) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  const columns = Object.keys(rows[0]).filter(
    (column) => !['Latitude', 'Longitude'].includes(column),
  )

  return (
    <div className="overflow-hidden rounded-2xl border bg-card/70 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead key={column} className="font-medium text-foreground/90">
                {column.replaceAll('_', ' ')}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={`row-${index}`} className="hover:bg-accent/30">
              {columns.map((column) => {
                const value = row[column]
                const isStatus = column.toLowerCase().includes('status') && typeof value === 'string'
                return (
                  <TableCell key={`cell-${index}-${column}`}>
                    {isStatus ? (
                      <Badge variant={statusVariant(value)} className="rounded-md capitalize">
                        {value}
                      </Badge>
                    ) : (
                      <span>{formatCell(value)}</span>
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default DataTable
