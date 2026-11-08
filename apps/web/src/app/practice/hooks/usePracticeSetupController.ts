import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RefObject } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useCancelStudySession } from '@app/practice/hooks/useCancelStudySession'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import {
  FALLBACK_LEVEL,
  getInitialCount,
  getInitialLevel,
  getInitialSubject,
  getRequestedMode,
  getResumablePage
} from '@app/practice/practiceSetupOptions'
import {
  asGuestAllowance,
  guestAllowanceQueries
} from '@app/practice/queries/guestAllowanceQueries'
import { GUEST_SESSION_QUESTION_LIMIT } from '@nihongo/contracts/study/guest-limits'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  getGuestLimitResetsAt,
  isAccountRestrictedApiError,
  isGuestLimitReachedApiError,
  isNoEligibleQuestionsApiError
} from '@libs/apiError'

type SetupSearchKey = 'count' | 'level' | 'mode' | 'resumePage' | 'subject'

const RESUMABLE_PAGE_SIZE = 5
// setTimeout's limit; a reset is at most a day away.
const MAX_TIMER_MS = 2 ** 31 - 1

export const usePracticeSetupController = (
  resumableHeadingRef: RefObject<HTMLHeadingElement | null>
) => {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isReady, role, user } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null)
  const defaultLevel = user?.targetLevel ?? FALLBACK_LEVEL
  const level = getInitialLevel(searchParams.get('level'), defaultLevel)
  const subject = getInitialSubject(searchParams.get('subject'))
  const isGuest = isReady && role === 'GUEST'
  const requestedCount = getInitialCount(searchParams.get('count'))
  const requestedMode = getRequestedMode(searchParams.get('mode'))
  // Guests only try short random sessions; a shared link asking for more
  // keeps its level and subject and says why the rest changed (L12).
  const count = isGuest ? GUEST_SESSION_QUESTION_LIMIT : requestedCount
  const mode = isGuest ? 'RANDOM' : requestedMode
  const isUrlLockedForGuest =
    isGuest &&
    ((searchParams.has('count') &&
      requestedCount !== GUEST_SESSION_QUESTION_LIMIT) ||
      requestedMode !== 'RANDOM')
  const queryClient = useQueryClient()
  const guestAllowance = useQuery({
    ...guestAllowanceQueries.get(),
    enabled: isGuest
  })
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
  const createSession = useCreateStudySession()
  const principalScope = getStudyDraftPrincipalScope(user)
  // Guests have no saved work to resume (G1).
  const canLoadResumableSessions = isReady && user !== null
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
  const accountRestricted =
    createSession.isError && isAccountRestrictedApiError(createSession.error)
  const guestAllowanceData = asGuestAllowance(guestAllowance.data)
  const guestLimitRejected =
    createSession.isError && isGuestLimitReachedApiError(createSession.error)
  const isGuestDailyLimitReached =
    isGuest && (guestLimitRejected || guestAllowanceData?.remaining === 0)
  // The refusal carries the reset time, so the card clears at midnight even
  // when the allowance could not be read.
  const guestResetsAt = guestLimitRejected
    ? getGuestLimitResetsAt(createSession.error)
    : guestAllowanceData?.resetsAt
  const resetCreateSession = createSession.reset
  const hasCreateError =
    createSession.isError &&
    !guestLimitRejected &&
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
    if (!isGuestDailyLimitReached || !guestResetsAt) return
    const waitMs = Date.parse(guestResetsAt) - Date.now()
    if (!(waitMs > 0) || waitMs > MAX_TIMER_MS) return
    const timerId = window.setTimeout(() => {
      resetCreateSession()
      void queryClient.invalidateQueries({
        queryKey: guestAllowanceQueries.get().queryKey
      })
    }, waitMs)
    return () => window.clearTimeout(timerId)
  }, [guestResetsAt, isGuestDailyLimitReached, queryClient, resetCreateSession])

  useEffect(() => {
    if (resumableSessions.isError && !resumableSessions.data) {
      resumableHeadingRef.current?.focus()
    }
  }, [resumableHeadingRef, resumableSessions.data, resumableSessions.isError])

  const loginHref = `/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`

  const handleStart = (): void => {
    if (!isReady || isCreatingSession || isGuestDailyLimitReached) {
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
    accountRestricted,
    cancelSessionId,
    canLoadResumableSessions,
    changeSetting,
    defaultLevel,
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
    guestAllowance: guestAllowanceData,
    isGuest,
    isGuestDailyLimitReached,
    isUrlLockedForGuest,
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
