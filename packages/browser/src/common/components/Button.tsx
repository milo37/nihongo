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

// Styles: packages/browser/src/styles/button.css (#1186 C10).
const variantClassNames: Record<ButtonVariant, string> = {
  primary: 'ui-btn-primary',
  secondary: 'ui-btn-dark',
  dark: 'ui-btn-dark',
  outline: 'ui-btn-outline',
  ghost: 'ui-btn-ghost',
  danger: 'ui-btn-danger',
  // A destructive action that still needs a later confirmation step.
  'danger-outline': 'ui-btn-danger-outline'
}

const sizeClassNames: Record<ButtonSize, string> = {
  sm: 'ui-btn-sm',
  md: 'ui-btn-md',
  lg: 'ui-btn-lg'
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
    // Busy buttons stay focusable (aria-disabled), so ui-btn gives them the
    // same look as disabled ones.
    'ui-button ui-btn',
    variantClassNames[variant],
    sizeClassNames[size],
    fullWidth && 'ui-btn-full',
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
