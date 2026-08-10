import { useId } from 'react'
import type { ComponentPropsWithRef, ReactElement } from 'react'
import { classNames } from '@common/components/classNames'

type ProgressProps = Omit<ComponentPropsWithRef<'progress'>, 'children'> & {
  label: string
  showValue?: boolean
  value: number
  max?: number
}

export const Progress = ({
  className,
  label,
  max = 100,
  showValue = true,
  value,
  ...props
}: ProgressProps): ReactElement => {
  const labelId = useId()
  const normalizedMax = Number.isFinite(max) && max > 0 ? max : 100
  const finiteValue = Number.isFinite(value) ? value : 0
  const normalizedValue = Math.min(Math.max(finiteValue, 0), normalizedMax)
  const percentage = Math.round((normalizedValue / normalizedMax) * 100)

  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-4 text-sm">
        <span className="min-w-0 font-medium text-ink" id={labelId}>
          {label}
        </span>
        {showValue ? (
          <span className="shrink-0 tabular-nums text-muted">
            {percentage}%
          </span>
        ) : null}
      </div>
      <progress
        className={classNames('ui-progress h-2.5 w-full', className)}
        value={normalizedValue}
        max={normalizedMax}
        aria-labelledby={labelId}
        {...props}
      >
        {percentage}%
      </progress>
    </div>
  )
}
