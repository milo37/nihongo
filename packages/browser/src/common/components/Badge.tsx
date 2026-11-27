import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import { classNames } from './classNames'

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

// Styles: packages/browser/src/styles/button.css (#1186 C10).
const variantClassNames: Record<BadgeVariant, string> = {
  neutral: 'ui-badge-neutral',
  brand: 'ui-badge-brand',
  success: 'ui-badge-success',
  warning: 'ui-badge-warning',
  danger: 'ui-badge-danger',
  info: 'ui-badge-info'
}

export const Badge = ({
  children,
  className,
  variant = 'neutral',
  ...props
}: BadgeProps): ReactElement => {
  return (
    <span
      className={classNames('ui-badge', variantClassNames[variant], className)}
      {...props}
    >
      {children}
    </span>
  )
}
