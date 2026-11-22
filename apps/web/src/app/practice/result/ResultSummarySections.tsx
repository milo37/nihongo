import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { gradeTiming } from '@common/components/manuscript/ProgressSheet'

/**
 * The score sentence as the heading (B4 §11), the correct count large with
 * the teacher's red circle on it (B4 §4).
 */
export const ResultScoreHeading = ({
  headingRef,
  scoreBefore,
  scoreAfter,
  correctCount,
  formattedCorrect,
  itemCount,
  animateGrading
}: {
  headingRef: RefObject<HTMLHeadingElement | null>
  scoreBefore: string
  scoreAfter: string
  correctCount: number
  formattedCorrect: ReactNode
  itemCount: number
  animateGrading: boolean
}): ReactElement => (
  <h1 ref={headingRef} className="result-b4-score outline-none" tabIndex={-1}>
    {scoreBefore}
    <b
      className={
        correctCount >= 10 ? 'result-b4-number is-wide' : 'result-b4-number'
      }
    >
      {formattedCorrect}
      {/* The teacher's red circle on the score only (B4 §4). */}
      <svg
        className="result-b4-ring"
        viewBox="0 0 24 22"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className={animateGrading ? 'manuscript-pen' : undefined}
          style={
            animateGrading
              ? {
                  animationDelay: `${gradeTiming(itemCount).scoreCircleMs}ms`,
                  animationDuration: '400ms'
                }
              : undefined
          }
          pathLength={1}
          d="M15.5 3.2C9 1.6 3 5.6 3.4 11.6c.4 5.6 7 8.4 12.2 6.2 4.6-2 5.6-7.6 2.4-11.4"
        />
      </svg>
    </b>
    {scoreAfter}
  </h1>
)

/** One login place: this line, or the limit card on the last try. */
export const ResultStatusLine = ({
  isGuest,
  isGuestDone,
  incorrectCount,
  formatCount
}: {
  isGuest: boolean
  isGuestDone: boolean
  incorrectCount: number
  formatCount: (value: number) => string
}): ReactElement | null => {
  const { t } = useTranslation('result')
  const { t: authT } = useTranslation('auth')
  return isGuest ? (
    isGuestDone ? null : incorrectCount > 0 ? (
      // One ruled line: the offer, then [로그인 ›] (B4 §4).
      <p className="result-guest-keep">
        <span>
          {t('status.guest', {
            formattedCount: formatCount(incorrectCount)
          })}
        </span>
        <Link
          className="result-guest-keep-action"
          to={`/login?redirect=${encodeURIComponent('/wrong-notes')}`}
        >
          {authT('guestToast.login')}
          <Icon name="chevron-right" className="size-4" />
        </Link>
      </p>
    ) : (
      <p className="mt-2 text-sm leading-6 text-muted">
        {t('status.guestAllCorrect')}
        <Link
          className="note-link ms-2"
          to={`/login?redirect=${encodeURIComponent('/practice')}`}
        >
          {authT('guestToast.login')}
        </Link>
      </p>
    )
  ) : incorrectCount > 0 ? (
    <p className="mt-2 text-sm leading-6 text-muted">
      {t('status.savedWrongCount', {
        formattedCount: formatCount(incorrectCount)
      })}
    </p>
  ) : null
}
