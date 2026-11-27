import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { classNames } from './classNames'

type LoadingStateProps = {
  label?: string
  message?: string
  className?: string
  density?: 'regular' | 'inline'
}

export const LoadingState = ({
  className,
  density = 'regular',
  label,
  message
}: LoadingStateProps): ReactElement => {
  const { t } = useTranslation('common')
  const statusMessage = message ?? label ?? t('loading.content')

  return (
    <div
      className={classNames(
        'ui-loading',
        density === 'inline' ? 'ui-loading-inline' : 'ui-loading-block',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={classNames(
          'ui-spinner ui-loading-spinner',
          density === 'inline'
            ? 'ui-loading-spinner-inline'
            : 'ui-loading-spinner-block'
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeOpacity="0.25"
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
      <span className="ui-loading-message">{statusMessage}</span>
    </div>
  )
}
