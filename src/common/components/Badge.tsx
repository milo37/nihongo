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
  neutral: 'border-slate-200 bg-slate-100 text-slate-700',
  brand: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  success: 'border-green-200 bg-green-50 text-green-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800'
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
        'inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-xs font-semibold leading-5',
        'break-words',
        variantClassNames[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
