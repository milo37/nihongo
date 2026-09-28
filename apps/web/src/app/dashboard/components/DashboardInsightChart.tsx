import type { ReactElement } from 'react'
import type { DashboardInsightBreakdownView } from '@app/dashboard/adapters/dashboardInsightsView'

type DashboardInsightChartProps = {
  items: readonly DashboardInsightBreakdownView[]
}

export const DashboardInsightChart = ({
  items
}: DashboardInsightChartProps): ReactElement => {
  return (
    <div aria-hidden="true" className="space-y-4">
      {items.map((item) => (
        <div key={item.id}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold text-ink">{item.label}</span>
            <span className="font-semibold text-slate-600">
              {item.correctRateLabel}
            </span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-300"
              style={{
                width: `${(item.correctRateBasisPoints ?? 0) / 100}%`
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
