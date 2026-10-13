import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { WrongNoteStatus } from '@common/types/domain'

export const ReviewStatus = ({
  status
}: {
  status: WrongNoteStatus
}): ReactElement => {
  const { t } = useTranslation('wrongNote')
  return (
    <span className="review-status">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {status === 'SOLVED' ? (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="m8 12 3 3 5-6" />
          </>
        ) : status === 'NEW' ? (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01" />
          </>
        ) : (
          <>
            <path d="M3 11a9 9 0 1 1 2.6 7M3 3v8h8" />
          </>
        )}
      </svg>
      {t(`integration.status.${status}`)}
    </span>
  )
}
