import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RefObject } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useCancelStudySession } from '@app/practice/hooks/useCancelStudySession'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import {
  FALLBACK_LEVEL,
  FALLBACK_SUBJECT,
  MEMBER_COUNT,
  getInitialLevel,
  getInitialSubject,
  getRequestedMode,
  levels
} from '@app/practice/practiceSetupOptions'
import {
  readLastPracticeChoice,
  saveLastPracticeChoice
} from '@app/practice/lastPracticeChoice'
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

type SetupSearchKey = 'level' | 'mode' | 'subject'

// Only the most recent saved session is offered (subtract table 6).
const RESUMABLE_PAGE_SIZE = 1
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
  // Read once: starting a practice saves the next default for later visits.
  const [lastChoice] = useState(readLastPracticeChoice)
  // A member picks 5, 10 or 20 each visit; not remembered (B4 §9).
  const [memberCount, setMemberCount] = useState(MEMBER_COUNT)
  // The target level wins, then the last level on this device (table 2).
  const defaultLevel = user?.targetLevel ?? lastChoice?.level ?? FALLBACK_LEVEL
  const defaultSubject = lastChoice?.subject ?? FALLBACK_SUBJECT
  const urlLevel = searchParams.get('level')
  // Without a URL level the default waits for the signed-in user, so it is
  // set once (no N5 first, then the target level).
  const level =
    isReady || levels.some((value) => value === urlLevel)
      ? getInitialLevel(urlLevel, defaultLevel)
      : null
  const subject = getInitialSubject(searchParams.get('subject'), defaultSubject)
  const isGuest = isReady && role === 'GUEST'
  const requestedMode = getRequestedMode(searchParams.get('mode'))
  // Guests only try short random sessions; a shared link asking for review
  // keeps its level and subject and says why the mode changed (L12).
  const count = isGuest ? GUEST_SESSION_QUESTION_LIMIT : memberCount
  const mode = isGuest ? 'RANDOM' : requestedMode
  const isUrlLockedForGuest = isGuest && requestedMode !== 'RANDOM'
  const queryClient = useQueryClient()
  const guestAllowance = useQuery({
    ...guestAllowanceQueries.get(),
    enabled: isGuest
  })
  const updateSearchParam = (
    key: SetupSearchKey,
    value: number | string,
    defaultValue: number | string
  ): void => {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, String(value))
    setSearchParams(next)
  }
  const createSession = useCreateStudySession()
  const principalScope = getStudyDraftPrincipalScope(user)
  // Guests have no saved work to resume (G1).
  const canLoadResumableSessions = isReady && user !== null
  const resumableSessions = useListResumableStudySessions(
    1,
    RESUMABLE_PAGE_SIZE,
    canLoadResumableSessions
  )
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
    if (!isReady || !level || isCreatingSession || isGuestDailyLimitReached) {
      return
    }

    createSession.mutate(
      { level, subject, count, mode },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          saveLastPracticeChoice({ level: input.level, subject: input.subject })
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  // Changing any setup choice clears the previous start error before the URL updates.
  const changeSetting = (
    key: SetupSearchKey,
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
    defaultSubject,
    confirmCancel,
    count,
    changeCount: setMemberCount,
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
    resumableSessions,
    setCancelSessionId,
    subject
  }
}
