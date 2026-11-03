import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { useGetStudyResult } from '@app/practice/hooks/useGetStudyResult'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { readCurrentResult } from '@app/wrong-note/reviewReturnContext'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useAppStore } from '@nihongo/browser/store/index'

export const GuestReview = (): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { user } = useAuth()
  const activeSessionId = useAppStore((state) => state.sessionId)
  const sessionId =
    readCurrentResult(getStudyDraftPrincipalScope(user)) ||
    activeSessionId ||
    ''
  const session = useGetStudySession(sessionId, true)
  const result = useGetStudyResult(sessionId, true)
  const hasVerifiedResult =
    session.isFetchedAfterMount &&
    result.isFetchedAfterMount &&
    !session.isFetching &&
    !result.isFetching &&
    !session.isError &&
    !result.isError &&
    session.fetchStatus !== 'paused' &&
    result.fetchStatus !== 'paused' &&
    session.data?.session.status === 'SUBMITTED' &&
    result.data?.sessionId === sessionId
  return (
    <section className="review-hub">
      <h1 className="review-title">{t('integration.title')}</h1>
      <EmptyState
        title={t('integration.guest.title')}
        description={t('integration.guest.description')}
        action={
          <div className="review-empty-actions">
            <Link
              className={getButtonClassName()}
              to="/login?redirect=%2Fwrong-notes"
            >
              {t('integration.guest.login')}
            </Link>
            <Link className="note-link" to="/practice">
              {t('integration.guest.practice')}
            </Link>
          </div>
        }
      />
      {hasVerifiedResult ? (
        <Link
          className="review-guest-result note-link"
          to={`/practice/result/${sessionId}`}
        >
          {t('integration.guest.result')}
        </Link>
      ) : null}
    </section>
  )
}
