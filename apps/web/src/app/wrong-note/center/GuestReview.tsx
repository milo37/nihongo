import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { GuestGate } from '@app/login/components/GuestGate'
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
  // The shared sign-in card (L4); a result just finished here stays linked.
  return (
    <GuestGate screen="review">
      {hasVerifiedResult ? (
        <Link to={`/practice/result/${sessionId}`}>
          {t('integration.guest.result')}
        </Link>
      ) : null}
    </GuestGate>
  )
}
