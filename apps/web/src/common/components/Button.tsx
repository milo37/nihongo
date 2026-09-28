import { useTranslation } from 'react-i18next'
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
    'bg-brand text-on-accent shadow-control hover:bg-brand-strong active:bg-brand-active',
  secondary:
    'bg-ink text-on-accent shadow-control hover:bg-ink/90 active:bg-ink/80',
  dark: 'bg-ink text-on-accent shadow-control hover:bg-ink/90 active:bg-ink/80',
  outline:
    'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-muted active:bg-line',
  ghost: 'text-ink hover:bg-surface-muted active:bg-line',
  danger:
    'bg-danger text-on-accent shadow-control hover:bg-danger-strong active:bg-danger-strong/90'
}

const sizeClassNames: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-2 text-sm',
  md: 'min-h-11 px-4 py-2.5 text-sm',
  lg: 'min-h-12 px-5 py-3 text-base'
}

export const Button = ({
  children,
  className,
  disabled = false,
  fullWidth = false,
  isLoading = false,
  loadingLabel,
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps): ReactElement => {
  const { t } = useTranslation('common')

  return (
    <button
      className={classNames(
        'inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold',
        'touch-manipulation transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
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
          <span>{loadingLabel ?? t('loading.processing')}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
