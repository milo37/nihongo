import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react'
import { classNames } from './classNames'

type IconButtonVariant = 'default' | 'ghost' | 'danger'
type IconButtonSize = 'sm' | 'md' | 'lg'

type IconButtonProps = Omit<
  ComponentPropsWithRef<'button'>,
  'aria-label' | 'children'
> & {
  label: string
  icon: ReactNode
  variant?: IconButtonVariant
  size?: IconButtonSize
}

// Styles: packages/browser/src/styles/button.css (#1186 C10).
const variantClassNames: Record<IconButtonVariant, string> = {
  default: 'ui-icon-btn-default',
  ghost: 'ui-icon-btn-ghost',
  danger: 'ui-icon-btn-danger'
}

const sizeClassNames: Record<IconButtonSize, string> = {
  sm: 'ui-icon-btn-md',
  md: 'ui-icon-btn-md',
  lg: 'ui-icon-btn-lg'
}

export const IconButton = ({
  className,
  icon,
  label,
  size = 'md',
  title,
  type = 'button',
  variant = 'default',
  ...props
}: IconButtonProps): ReactElement => {
  return (
    <button
      className={classNames(
        'ui-icon-btn',
        variantClassNames[variant],
        sizeClassNames[size],
        className
      )}
      type={type}
      aria-label={label}
      {...props}
      title={title ?? label}
    >
      <span className="ui-icon-btn-glyph" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}
