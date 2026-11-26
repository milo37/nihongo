import { Navigate } from 'react-router'
import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import {
  SessionLoadError,
  SessionSetupLinkError
} from '@app/practice/session/components/PracticeSessionStateScreens'
import type {
  SessionController,
  SessionQuestion
} from '@app/practice/session/components/SessionQuestionCards'

type SessionData = NonNullable<SessionController['sessionQuery']['data']>

/** Either a screen for a session that cannot be answered yet, or the question to show. */
export type SessionView =
  | { screen: ReactElement }
  | { data: SessionData; question: SessionQuestion }

export const readSessionView = ({
  session,
  t,
  sessionId,
  refetchSession,
  navigationPrompt
}: {
  session: SessionController
  t: TFunction<'practice'>
  sessionId: string
  refetchSession: () => void
  navigationPrompt: ReactElement
}): SessionView => {
  const screen = (element: ReactElement): SessionView => ({ screen: element })
  if (session.isRetiredSession) {
    return screen(
      <SessionSetupLinkError
        framed
        title={t('session.terminal.retiredTitle')}
        description={t('session.terminal.retiredDescription')}
      />
    )
  }

  if (session.sessionQuery.isPending) {
    if (session.sessionQuery.fetchStatus === 'paused') {
      return screen(
        <SessionLoadError
          description={t('session.errors.offlineSessionDescription')}
        />
      )
    }
    return screen(<LoadingState message={t('session.loading.questions')} />)
  }

  if (!session.sessionQuery.data) {
    if (session.isSessionNotFound) {
      return screen(
        <SessionSetupLinkError
          framed
          title={t('session.terminal.notFoundTitle')}
          description={t('session.terminal.notFoundDescription')}
        />
      )
    }
    return screen(
      <>
        <SessionLoadError
          description={
            session.isSessionOffline
              ? t('session.errors.offlineSessionDescription')
              : t('session.errors.sessionLoadDescription')
          }
          onRetry={refetchSession}
        />
        {navigationPrompt}
      </>
    )
  }

  if (!session.hasCurrentGuestOwnerProof) {
    if (session.sessionQuery.fetchStatus === 'paused') {
      return screen(
        <SessionLoadError
          description={t('session.errors.offlineSessionDescription')}
        />
      )
    }
    if (session.sessionQuery.isError) {
      return screen(
        <SessionLoadError
          description={t('session.errors.sessionLoadDescription')}
          onRetry={refetchSession}
        />
      )
    }
    return screen(
      <LoadingState message={t('session.loading.guestOwnership')} />
    )
  }

  const { status } = session.sessionQuery.data.session
  if (status === 'SUBMITTED') {
    if (session.isNavigationPromptBlocked) {
      return screen(
        <LoadingState message={t('session.loading.resultRedirect')} />
      )
    }
    return screen(<Navigate replace to={`/practice/result/${sessionId}`} />)
  }

  if (status !== 'IN_PROGRESS') {
    return screen(
      <SessionSetupLinkError
        title={
          status === 'EXPIRED'
            ? t('session.terminal.expiredTitle')
            : t('session.terminal.cancelledTitle')
        }
        description={t('session.terminal.description')}
      />
    )
  }

  if (session.hasSession && !session.draftController.isReady) {
    if (
      session.draftController.draftQuery.isError ||
      session.draftController.saveState === 'error'
    ) {
      return screen(
        <SessionLoadError
          title={t('session.errors.draftLoadTitle')}
          description={t('session.errors.draftLoadDescription')}
          retryLabel={t('session.recovery.retry')}
          onRetry={() =>
            void session.draftController.retrySave().catch(() => undefined)
          }
        />
      )
    }
    return screen(<LoadingState message={t('session.loading.draft')} />)
  }

  if (!session.currentQuestion) {
    return screen(
      <SessionSetupLinkError
        title={t('session.errors.emptyTitle')}
        description={t('session.errors.emptyDescription')}
      />
    )
  }

  return { data: session.sessionQuery.data, question: session.currentQuestion }
}
