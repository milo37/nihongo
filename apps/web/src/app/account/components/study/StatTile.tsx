import type { ReactElement, ReactNode } from 'react'

type StatTileProps = {
  label: string
  value: string
  unit: string
  note?: ReactNode
  className?: string
}

export const StatTile = ({
  label,
  value,
  unit,
  note,
  className = ''
}: StatTileProps): ReactElement => (
  <div
    className={`rounded-card border border-line bg-surface p-5 ${className}`}
  >
    <p className="text-xs text-muted">{label}</p>
    <p className="mt-1">
      <span className="text-[28px] font-bold tabular-nums">{value}</span>
      <span className="ml-1 text-[15px] text-muted">{unit}</span>
    </p>
    {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
  </div>
)
