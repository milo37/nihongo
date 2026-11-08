import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
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
    <Button
      className="shrink-0"
      variant="outline"
      type="button"
      disabled={isDisabled}
      aria-label={t(
        isBookmarked
          ? 'session.bookmark.removeLabel'
          : 'session.bookmark.addLabel',
        { ordinal: formatCount(questionNumber) }
      )}
      aria-pressed={isBookmarked}
      data-selected={isBookmarked}
      onClick={onToggle}
    >
      {isBookmarked ? t('session.bookmark.remove') : t('session.bookmark.add')}
    </Button>
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
  const failure =
    message?.questionId === questionId && message.code !== 'loginRequired'
      ? message.code
      : null
  return (
    <>
      {failure ? (
        // A failed change is an error next to the button, never a toast.
        <p className="mt-3 text-sm font-semibold text-danger" role="alert">
          {t(`session.bookmark.${failure}`)}
        </p>
      ) : (message?.questionId === questionId &&
          message.code === 'loginRequired') ||
        isMutationPaused ? (
        <p className="mt-3 text-sm font-semibold text-warning" role="status">
          {isMutationPaused
            ? t('session.bookmark.offlineQueued')
            : message
              ? t(`session.bookmark.${message.code}`)
              : null}{' '}
          {role === 'GUEST' ? (
            <Link
              className="inline-flex min-h-11 items-center px-1 underline hover:no-underline"
              to="/login?redirect=%2Fpractice"
            >
              {t('session.bookmark.chooseLogin')}
            </Link>
          ) : null}
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
