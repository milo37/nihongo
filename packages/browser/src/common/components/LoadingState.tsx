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
        'flex items-center gap-3 text-muted',
        density === 'inline'
          ? 'min-h-11 py-2 text-sm'
          : 'min-h-40 flex-col justify-center px-4 py-10 text-center',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={classNames(
          'ui-spinner text-brand',
          density === 'inline' ? 'size-5' : 'size-7'
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
      <span className="text-sm font-medium">{statusMessage}</span>
    </div>
  )
}
