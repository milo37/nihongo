import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useCancelStudySession } from '@app/practice/hooks/useCancelStudySession'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import {
  getInitialCount,
  getInitialLevel,
  getInitialSubject,
  getRequestedMode,
  getResumablePage,
  loginRequiredModes
} from '@app/practice/practiceSetupOptions'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { isNoEligibleQuestionsApiError } from '@libs/apiError'

type SetupSearchKey = 'count' | 'level' | 'mode' | 'resumePage' | 'subject'

const RESUMABLE_PAGE_SIZE = 5

export const usePracticeSetupController = (
  resumableHeadingRef: RefObject<HTMLHeadingElement | null>
) => {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isReady, role, user } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const storedSessionId = useAppStore((state) => state.sessionId)
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null)
  const level = getInitialLevel(searchParams.get('level'))
  const subject = getInitialSubject(searchParams.get('subject'))
  const count = getInitialCount(searchParams.get('count'))
  const mode = getRequestedMode(searchParams.get('mode'))
  const resumablePage = getResumablePage(searchParams.get('resumePage'))
  const updateSearchParam = useCallback(
    (
      key: SetupSearchKey,
      value: number | string,
      defaultValue: number | string,
      replace = false
    ): void => {
      const next = new URLSearchParams(searchParams)
      if (value === defaultValue) next.delete(key)
      else next.set(key, String(value))
      setSearchParams(next, { replace })
    },
    [searchParams, setSearchParams]
  )
  const getSearchParamHref = (
    key: SetupSearchKey,
    value: number | string,
    defaultValue: number | string
  ): string => {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, String(value))
    return `?${next.toString()}`
  }
  const isProtectedGuestMode =
    role === 'GUEST' && loginRequiredModes.includes(mode)
  const createSession = useCreateStudySession()
  const principalScope = getStudyDraftPrincipalScope(user)
  const canLoadResumableSessions =
    isReady && (user !== null || storedSessionId !== null)
  const resumableSessions = useListResumableStudySessions(
    resumablePage,
    RESUMABLE_PAGE_SIZE,
    canLoadResumableSessions
  )
  const resumablePageCount = resumableSessions.data
    ? Math.max(
        1,
        Math.ceil(
          resumableSessions.data.total / resumableSessions.data.pageSize
        )
      )
    : resumablePage
  const cancelSession = useCancelStudySession(principalScope)
  const isCreatingSession = createSession.isPending || createSession.isPaused
  const noEligibleQuestions =
    createSession.isError && isNoEligibleQuestionsApiError(createSession.error)
  const hasCreateError =
    createSession.isError &&
    !isAuthTransitionSupersededError(createSession.error)
  const isResumableSourceUnavailable =
    resumableSessions.isError || resumableSessions.fetchStatus === 'paused'
  const isResumableInteractionLocked =
    isResumableSourceUnavailable || resumableSessions.isFetching

  useEffect(() => {
    if (
      !resumableSessions.data ||
      resumableSessions.data.page !== resumablePage
    ) {
      return
    }
    if (resumablePage > resumablePageCount) {
      const timerId = window.setTimeout(() => {
        updateSearchParam('resumePage', resumablePageCount, 1, true)
      }, 0)
      return () => window.clearTimeout(timerId)
    }
  }, [
    resumablePage,
    resumablePageCount,
    resumableSessions.data,
    updateSearchParam
  ])

  useEffect(() => {
    if (resumableSessions.isError && !resumableSessions.data) {
      resumableHeadingRef.current?.focus()
    }
  }, [resumableHeadingRef, resumableSessions.data, resumableSessions.isError])

  const loginHref = `/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`

  const handleStart = (): void => {
    if (!isReady || isCreatingSession || isProtectedGuestMode) {
      return
    }

    createSession.mutate(
      { level, subject, count, mode },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  // Changing any setup choice clears the previous start error before the URL updates.
  const changeSetting = (
    key: Exclude<SetupSearchKey, 'resumePage'>,
    value: number | string,
    defaultValue: number | string
  ): void => {
    createSession.reset()
    updateSearchParam(key, value, defaultValue)
  }

  const confirmCancel = (): void => {
    if (!cancelSessionId) {
      return
    }
    cancelSession.mutate(
      { sessionId: cancelSessionId },
      { onSuccess: () => setCancelSessionId(null) }
    )
  }

  return {
    cancelSessionId,
    canLoadResumableSessions,
    changeSetting,
    confirmCancel,
    count,
    getResumablePageHref: (page: number) =>
      getSearchParamHref('resumePage', page, 1),
    handleStart,
    hasCancelError:
      cancelSession.isError &&
      !isAuthTransitionSupersededError(cancelSession.error),
    hasCreateError,
    isCancelling: cancelSession.isPending,
    isCreatingSession,
    isGuest: role === 'GUEST',
    isProtectedGuestMode,
    isReady,
    isResumableInteractionLocked,
    isResumableSourceUnavailable,
    level,
    loginHref,
    mode,
    noEligibleQuestions,
    resumablePage,
    resumablePageCount,
    resumableSessions,
    setCancelSessionId,
    setResumablePage: (page: number) =>
      updateSearchParam('resumePage', page, 1),
    subject
  }
}
