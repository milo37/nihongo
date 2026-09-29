import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

type BadgeVariant =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  children: ReactNode
  variant?: BadgeVariant
}

const variantClassNames: Record<BadgeVariant, string> = {
  neutral: 'border-line bg-surface-muted text-muted',
  brand: 'border-line-interactive bg-brand-soft text-brand-strong',
  success: 'border-success-line bg-success-soft text-success-strong',
  warning: 'border-warning-line bg-warning-soft text-warning-strong',
  danger: 'border-danger-line bg-danger-soft text-danger-strong',
  info: 'border-info-line bg-info-soft text-info-strong'
}

export const Badge = ({
  children,
  className,
  variant = 'neutral',
  ...props
}: BadgeProps): ReactElement => {
  return (
    <span
      className={classNames(
        'inline-flex max-w-full items-center rounded-control border px-2 py-0.5 text-xs font-semibold leading-5',
        '[overflow-wrap:anywhere]',
        variantClassNames[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
