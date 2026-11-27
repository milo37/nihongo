import type { ReactElement } from 'react'
import type { AdminRetentionAudience } from '@nihongo/contracts/admin/retention'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useChartPointer } from '@app/admin-retention/hooks/useChartPointer'
import { RETENTION_COLORS } from '@app/admin-retention/libs/retentionColors'
import {
  RETENTION_AUDIENCES,
  rateOf,
  type RetentionPoint
} from '@app/admin-retention/libs/retentionSeries'

// Room inside the SVG for the % axis on the left, the end names on the right
// and the date axis below. Chart coordinates, not page layout.
const PLOT_LEFT = 40
const PLOT_RIGHT = 84
const PLOT_TOP = 8
const PLOT_BOTTOM = 24
const RATE_STEP = 0.2
const MIN_RATE_MAX = 0.6
const DATE_TICK_EVERY = 14
const END_LABEL_GAP = 14

type Series = Record<AdminRetentionAudience, readonly RetentionPoint[]>

const percent = (value: number, locale: Parameters<typeof formatNumber>[1]) =>
  formatNumber(value, locale, { style: 'percent', maximumFractionDigits: 0 })

/** #1271: one return measure over the cohort days, member and guest lines. */
export const RetentionChart = ({
  title,
  days,
  series
}: {
  title: string
  days: readonly string[]
  series: Series
}): ReactElement => {
  const { locale } = useUiLocale()
  const { t } = useAdminPresentation()
  const { frameRef, svgRef, box, active, onPointer, onLeave } = useChartPointer(
    {
      dayCount: days.length,
      plotLeft: PLOT_LEFT,
      plotRight: PLOT_RIGHT
    }
  )

  const dayIndex = new Map(days.map((day, index) => [day, index]))
  const rates = RETENTION_AUDIENCES.flatMap((audience) =>
    series[audience].map((point) => rateOf(point) ?? 0)
  )
  const rateMax = Math.max(
    MIN_RATE_MAX,
    Math.ceil(Math.max(0, ...rates) / RATE_STEP) * RATE_STEP
  )
  const plotWidth = Math.max(0, box.width - PLOT_LEFT - PLOT_RIGHT)
  const plotHeight = Math.max(0, box.height - PLOT_TOP - PLOT_BOTTOM)
  const x = (index: number) =>
    PLOT_LEFT + (days.length > 1 ? (plotWidth * index) / (days.length - 1) : 0)
  const y = (rate: number) => PLOT_TOP + plotHeight * (1 - rate / rateMax)
  const steps = Math.round(rateMax / RATE_STEP)
  const gridRates = Array.from(
    { length: steps + 1 },
    (_, step) => step * RATE_STEP
  )
  const dateTicks = days.flatMap((day, index) =>
    index === days.length - 1 ||
    (index % DATE_TICK_EVERY === 0 && index < days.length - DATE_TICK_EVERY / 2)
      ? [{ day, index }]
      : []
  )

  const drawn = RETENTION_AUDIENCES.map((audience) => {
    const points = series[audience].flatMap((point) => {
      const index = dayIndex.get(point.date)
      const rate = rateOf(point)
      return index === undefined || rate === null
        ? []
        : [{ ...point, index, rate }]
    })
    return { audience, points, last: points.at(-1) }
  })
  // End names sit at their line's last point, pushed apart when they meet.
  const endLabels = drawn
    .flatMap(({ audience, last }) =>
      last ? [{ audience, last, top: y(last.rate) }] : []
    )
    .sort((a, b) => a.top - b.top)
  endLabels.forEach((label, index) => {
    const above = endLabels[index - 1]
    if (above && label.top - above.top < END_LABEL_GAP)
      label.top = above.top + END_LABEL_GAP
  })

  const activeDay = active === null ? undefined : days[active]
  const tooltipLines = activeDay
    ? RETENTION_AUDIENCES.map((audience) => ({
        audience,
        point: series[audience].find((point) => point.date === activeDay)
      }))
    : []

  return (
    <figure className="mt-8">
      <figcaption className="text-[0.9375rem] font-semibold">
        {title}
      </figcaption>
      <div ref={frameRef} className="relative mt-2">
        <svg
          ref={svgRef}
          role="img"
          aria-label={t('retention.chart.label', { title })}
          className="block h-[150px] w-full touch-pan-y overflow-visible sm:h-[200px]"
          viewBox={`0 0 ${box.width} ${box.height}`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={onLeave}
        >
          <g className="stroke-line">
            {gridRates.map((rate) => (
              <line
                key={rate}
                x1={PLOT_LEFT}
                x2={PLOT_LEFT + plotWidth}
                y1={y(rate)}
                y2={y(rate)}
              />
            ))}
          </g>
          <g className="fill-muted text-[11px] tabular-nums">
            {gridRates.map((rate) => (
              <text
                key={rate}
                x={PLOT_LEFT - 6}
                y={y(rate)}
                dy="0.32em"
                textAnchor="end"
              >
                {percent(rate, locale)}
              </text>
            ))}
            {dateTicks.map(({ day, index }) => (
              <text
                key={day}
                x={x(index)}
                y={box.height - 4}
                textAnchor="middle"
              >
                {day.slice(5)}
              </text>
            ))}
          </g>
          {activeDay !== undefined && active !== null ? (
            <line
              className="stroke-line-interactive"
              x1={x(active)}
              x2={x(active)}
              y1={PLOT_TOP}
              y2={PLOT_TOP + plotHeight}
            />
          ) : null}
          {drawn.map(({ audience, points }) => (
            <path
              key={audience}
              d={points
                .map(
                  (point, index) =>
                    `${index === 0 ? 'M' : 'L'}${x(point.index).toFixed(1)} ${y(point.rate).toFixed(1)}`
                )
                .join('')}
              fill="none"
              stroke={RETENTION_COLORS[audience]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {drawn.flatMap(({ audience, points }) =>
            points
              .filter((point) => point.index === active)
              .map((point) => (
                <circle
                  key={audience}
                  cx={x(point.index)}
                  cy={y(point.rate)}
                  r={4}
                  fill={RETENTION_COLORS[audience]}
                  className="stroke-surface"
                  strokeWidth={2}
                />
              ))
          )}
          <g className="fill-ink text-xs font-semibold tabular-nums">
            {endLabels.map(({ audience, last, top }) => (
              <text key={audience} x={x(last.index) + 6} y={top} dy="0.32em">
                {`${t(`retention.audience.${audience}`)} ${percent(last.rate, locale)}`}
              </text>
            ))}
          </g>
        </svg>
        {activeDay !== undefined && active !== null ? (
          <div
            role="status"
            className={`pointer-events-none absolute top-0 z-10 rounded-control border border-line bg-surface px-3 py-2 text-xs shadow-soft ${
              active < days.length / 2
                ? 'translate-x-2'
                : '-translate-x-full -ml-2'
            }`}
            style={{ left: `${(x(active) / box.width) * 100}%` }}
          >
            <p className="font-semibold tabular-nums">{activeDay}</p>
            {tooltipLines.map(({ audience, point }) => (
              <p key={audience} className="mt-1 whitespace-nowrap tabular-nums">
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block size-2 rounded-full"
                  style={{ background: RETENTION_COLORS[audience] }}
                />
                {t(`retention.audience.${audience}`)}{' '}
                {point
                  ? `${t('retention.chart.count', {
                      base: formatNumber(point.base, locale),
                      returned: formatNumber(point.returned, locale)
                    })} · ${
                      rateOf(point) === null
                        ? t('common.none')
                        : percent(rateOf(point) ?? 0, locale)
                    }`
                  : t('retention.pending')}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  )
}
