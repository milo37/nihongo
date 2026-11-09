import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { PracticeSessionBookmark } from '@app/practice/hooks/usePracticeSessionBookmark'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import type { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

type PracticeQuestionBookmarkButtonProps = {
  isBookmarked: boolean
  isDisabled: boolean
  onToggle: () => void
  questionNumber: number
}

export const PracticeQuestionBookmarkButton = ({
  isBookmarked,
  isDisabled,
  onToggle,
  questionNumber
}: PracticeQuestionBookmarkButtonProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { formatCount } = usePracticeNumberFormat()
  return (
    <button
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand aria-disabled:cursor-wait aria-disabled:opacity-70 aria-pressed:text-brand aria-pressed:[&_svg]:fill-current"
      type="button"
      // Focus stays here while busy (a toast closed with Esc returns to it).
      aria-disabled={isDisabled || undefined}
      aria-label={t(
        isBookmarked
          ? 'session.bookmark.removeLabel'
          : 'session.bookmark.addLabel',
        { ordinal: formatCount(questionNumber) }
      )}
      aria-pressed={isBookmarked}
      data-selected={isBookmarked}
      onClick={() => {
        if (!isDisabled) onToggle()
      }}
    >
      <Icon name="bookmark" />
    </button>
  )
}

type PracticeQuestionBookmarkStatusProps = {
  bookmark: PracticeSessionBookmark
  questionId: string
  role: ReturnType<typeof useAuth>['role']
}

export const PracticeQuestionBookmarkStatus = ({
  bookmark,
  questionId,
  role
}: PracticeQuestionBookmarkStatusProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { bookmarksQuery, isMutationPaused, message } = bookmark
  const failure = message?.questionId === questionId ? message.code : null
  return (
    <>
      {failure ? (
        // A failed change is an error next to the button, never a toast.
        <p className="mt-3 text-sm font-semibold text-danger" role="alert">
          {t(`session.bookmark.${failure}`)}
        </p>
      ) : isMutationPaused ? (
        <p className="mt-3 text-sm font-semibold text-warning" role="status">
          {t('session.bookmark.offlineQueued')}
        </p>
      ) : null}
      {role !== 'GUEST' && bookmarksQuery.fetchStatus === 'paused' ? (
        <p className="mt-3 text-sm font-semibold text-warning" role="status">
          {t('session.bookmark.statusLoadOffline')}
        </p>
      ) : role !== 'GUEST' && bookmarksQuery.isError ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-danger"
          role="alert"
        >
          <span>{t('session.bookmark.statusLoadFailed')}</span>
          <Button
            variant="outline"
            onClick={() => void bookmarksQuery.refetch()}
          >
            {t('session.bookmark.retryStatus')}
          </Button>
        </div>
      ) : null}
    </>
  )
}
