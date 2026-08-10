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
    'border border-line bg-white text-ink hover:border-slate-400 hover:bg-slate-50',
  ghost: 'text-muted hover:bg-slate-100 hover:text-ink',
  danger:
    'border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800'
}

const sizeClassNames: Record<IconButtonSize, string> = {
  sm: 'size-10',
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
        'inline-grid shrink-0 select-none place-items-center rounded-lg',
        'touch-manipulation transition-[background-color,border-color,color,box-shadow] duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
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
