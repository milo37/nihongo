import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { WrongNoteReviewState } from '@nihongo/contracts/wrong-note/list-review-list'

export const ReviewStatus = ({
  state
}: {
  state: WrongNoteReviewState
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
        {state === 'REVIEWED' ? (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="m8 12 3 3 5-6" />
          </>
        ) : (
          <>
            <path d="M3 11a9 9 0 1 1 2.6 7M3 3v8h8" />
          </>
        )}
      </svg>
      {t(`integration.status.${state}`)}
    </span>
  )
}
