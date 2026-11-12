import { useTranslation } from 'react-i18next'
import type {
  ComponentPropsWithRef,
  MouseEvent,
  ReactElement,
  ReactNode
} from 'react'
import { classNames } from './classNames'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'dark'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'danger-outline'

export type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ComponentPropsWithRef<'button'> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  loadingLabel?: string
  showLoadingIndicator?: boolean
  fullWidth?: boolean
}

const variantClassNames: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-on-accent shadow-control hover:bg-brand-strong active:bg-brand-active',
  secondary:
    'bg-ink text-on-accent shadow-control hover:bg-ink/90 active:bg-ink/80',
  dark: 'bg-ink text-on-accent shadow-control hover:bg-ink/90 active:bg-ink/80',
  outline:
    'border border-line-interactive bg-surface text-ink hover:border-line-strong hover:bg-surface-muted active:bg-line',
  ghost: 'text-ink hover:bg-surface-muted active:bg-line',
  danger:
    'bg-danger text-on-accent shadow-control hover:bg-danger-strong active:bg-danger-strong/90',
  // A destructive action that still needs a later confirmation step.
  'danger-outline':
    'border border-danger bg-surface text-danger hover:border-danger-strong hover:bg-danger-soft active:bg-danger-soft'
}

const sizeClassNames: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-2 text-sm',
  md: 'min-h-11 px-4 py-2.5 text-sm',
  lg: 'min-h-12 px-5 py-3 text-base'
}

export const getButtonClassName = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
} = {}): string =>
  classNames(
    'ui-button inline-flex select-none items-center justify-center gap-2 rounded-control font-semibold',
    'touch-manipulation transition-[background-color,border-color,color,box-shadow,transform] duration-150',
    'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
    'disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled-background disabled:text-disabled-text',
    // Busy buttons stay focusable (aria-disabled), so they need the same look.
    'aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:bg-disabled-background aria-disabled:text-disabled-text',
    variantClassNames[variant],
    sizeClassNames[size],
    fullWidth && 'w-full',
    className
  )

export const Button = ({
  children,
  className,
  disabled = false,
  fullWidth = false,
  isLoading = false,
  loadingLabel,
  showLoadingIndicator = true,
  size = 'md',
  type = 'button',
  variant = 'primary',
  onClick,
  ...props
}: ButtonProps): ReactElement => {
  const { t } = useTranslation('common')
  // JLP-846: a busy button keeps keyboard focus. Native disabled would drop
  // focus to the page, so while loading it is aria-disabled and ignores
  // activation (click, Enter, Space and form submit all arrive as a click).
  const blockClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (isLoading) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      className={getButtonClassName({ variant, size, fullWidth, className })}
      type={type}
      disabled={disabled && !isLoading}
      aria-disabled={isLoading || undefined}
      aria-busy={isLoading || undefined}
      {...props}
      onClick={blockClick}
    >
      {isLoading ? (
        <>
          {showLoadingIndicator ? (
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
          ) : null}
          <span>{loadingLabel ?? t('loading.processing')}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
