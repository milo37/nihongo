import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

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

const variantClassNames: Record<IconButtonVariant, string> = {
  default:
    'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-muted',
  ghost: 'text-muted hover:bg-surface-muted hover:text-ink',
  danger:
    'border border-danger/25 bg-surface text-danger hover:bg-danger-soft hover:text-danger-strong'
}

const sizeClassNames: Record<IconButtonSize, string> = {
  sm: 'size-11',
  md: 'size-11',
  lg: 'size-12'
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
        'inline-grid shrink-0 select-none place-items-center rounded-control',
        'touch-manipulation transition-[background-color,border-color,color,box-shadow] duration-150',
        'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-55',
        variantClassNames[variant],
        sizeClassNames[size],
        className
      )}
      type={type}
      aria-label={label}
      {...props}
      title={title ?? label}
    >
      <span
        className="inline-flex size-5 items-center justify-center"
        aria-hidden="true"
      >
        {icon}
      </span>
    </button>
  )
}
