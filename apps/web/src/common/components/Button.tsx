import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'dark'
  | 'outline'
  | 'ghost'
  | 'danger'

export type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ComponentPropsWithRef<'button'> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  loadingLabel?: string
  fullWidth?: boolean
}

const variantClassNames: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-sm hover:bg-emerald-800 active:bg-emerald-900',
  secondary:
    'bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:bg-slate-950',
  dark: 'bg-slate-950 text-white shadow-sm hover:bg-slate-800 active:bg-black',
  outline:
    'border border-line bg-white text-ink hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'text-ink hover:bg-slate-100 active:bg-slate-200',
  danger: 'bg-red-700 text-white shadow-sm hover:bg-red-800 active:bg-red-900'
}

const sizeClassNames: Record<ButtonSize, string> = {
  sm: 'min-h-10 px-3 py-2 text-sm',
  md: 'min-h-11 px-4 py-2.5 text-sm',
  lg: 'min-h-12 px-5 py-3 text-base'
}

export const Button = ({
  children,
  className,
  disabled = false,
  fullWidth = false,
  isLoading = false,
  loadingLabel = '처리 중…',
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps): ReactElement => {
  return (
    <button
      className={classNames(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold',
        'touch-manipulation transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-55',
        variantClassNames[variant],
        sizeClassNames[size],
        fullWidth && 'w-full',
        className
      )}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <>
          <span className="ui-spinner" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeOpacity="0.28"
                strokeWidth="3"
              />
              <path
                d="M12 3a9 9 0 0 1 9 9"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="3"
              />
            </svg>
          </span>
          <span>{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
