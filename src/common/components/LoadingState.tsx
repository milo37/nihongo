import type { ReactElement } from 'react'
import { classNames } from '@common/components/classNames'

type LoadingStateProps = {
  label?: string
  message?: string
  className?: string
}

export const LoadingState = ({
  className,
  label,
  message
}: LoadingStateProps): ReactElement => {
  const statusMessage = message ?? label ?? '콘텐츠를 불러오는 중입니다…'

  return (
    <div
      className={classNames(
        'flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-10 text-center text-muted',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span className="ui-spinner size-7 text-brand" aria-hidden="true">
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
