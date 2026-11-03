import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  useBlocker,
  useLocation,
  useNavigate,
  useNavigationType
} from 'react-router'
import {
  isAccountRestrictedApiError,
  isNoEligibleQuestionsApiError,
  isNotFoundApiError,
  isRetiredPracticeApiError,
  isStudyResultNotReadyApiError
} from '@libs/apiError'
import { rememberCurrentResult } from '@app/wrong-note/reviewReturnContext'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { useCreateResultRetrySession } from '@app/practice/hooks/useCreateResultRetrySession'
import { useGetStudyResult } from '@app/practice/hooks/useGetStudyResult'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { useGuestResultOwnerProof } from '@app/practice/hooks/useGuestResultOwnerProof'
import { usePracticeResultBookmark } from '@app/practice/hooks/usePracticeResultBookmark'
import { readResultRetryAttempt } from '@nihongo/browser/app/practice/resultRetryAttemptStorage'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@nihongo/browser/libs/authTransitionFence'

export type ResultRetryStatusCode = 'priorEnded' | 'sourceRefreshing'

type UsePracticeResultControllerInput = {
  sessionId: string
  summaryHeadingRef: RefObject<HTMLHeadingElement | null>
}

export const usePracticeResultController = ({
  sessionId,
  summaryHeadingRef
}: UsePracticeResultControllerInput) => {
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const location = useLocation()
  const readyResultPathRef = useRef<string | null>(null)
  const shouldRestoreRetryFocusRef = useRef(false)
  const allowRetryNavigationRef = useRef(false)
  const navigatedRetryDestinationRef = useRef<string | null>(null)
  const [retryMessage, setRetryMessage] =
    useState<ResultRetryStatusCode | null>(null)
  const [isRetrySourceRefreshing, setRetrySourceRefreshing] = useState(false)
  const [retryDestination, setRetryDestination] = useState<string | null>(null)
  const [isRetrySourceMissing, setRetrySourceMissing] = useState(false)
  const { isReady: isAuthReady, role, user } = useAuth()
  const principalScope = getStudyDraftPrincipalScope(user)
  const requireFreshGuestOwnerProbe = isAuthReady && role === 'GUEST'
  const resultQuery = useGetStudyResult(
    sessionId,
    requireFreshGuestOwnerProbe,
    isAuthReady
  )
  const sessionQuery = useGetStudySession(
    sessionId,
    requireFreshGuestOwnerProbe,
    isAuthReady
  )
  const createRetrySession = useCreateResultRetrySession()
  const retryNavigationBlocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      createRetrySession.isPending &&
      !allowRetryNavigationRef.current &&
      currentLocation.pathname !== nextLocation.pathname
  )
  const bookmark = usePracticeResultBookmark({
    resultQuestionIds:
      sessionQuery.data?.session.practiceContractVersion === 2
        ? (resultQuery.data?.items.map((item) => item.question.id).toSorted() ??
          [])
        : [],
    role
  })
  const hasCurrentGuestOwnerProof = useGuestResultOwnerProof({
    isAuthReady,
    resultQuery,
    role,
    sessionId,
    sessionQuery
  })

  const isResultReady = Boolean(resultQuery.data && sessionQuery.data)
  const hasFrozenRetryAttempt =
    sessionId.length > 0 &&
    readResultRetryAttempt(principalScope, sessionId) !== null

  useEffect(() => {
    if (
      hasCurrentGuestOwnerProof &&
      isResultReady &&
      !resultQuery.isError &&
      !sessionQuery.isError &&
      sessionQuery.data?.session.status === 'SUBMITTED'
    ) {
      rememberCurrentResult(principalScope, sessionId)
    }
  }, [
    hasCurrentGuestOwnerProof,
    isResultReady,
    principalScope,
    sessionId,
    resultQuery.isError,
    sessionQuery.isError,
    sessionQuery.data
  ])

  useEffect(() => {
    if (retryNavigationBlocker.state !== 'blocked') {
      return
    }
    if (retryDestination || !createRetrySession.isPending) {
      retryNavigationBlocker.reset()
    }
  }, [createRetrySession.isPending, retryDestination, retryNavigationBlocker])

  useEffect(() => {
    if (
      !retryDestination ||
      retryNavigationBlocker.state === 'blocked' ||
      navigatedRetryDestinationRef.current === retryDestination
    ) {
      return
    }
    navigatedRetryDestinationRef.current = retryDestination
    allowRetryNavigationRef.current = true
    void navigate(retryDestination)
  }, [navigate, retryDestination, retryNavigationBlocker.state])

  useEffect(() => {
    if (!hasFrozenRetryAttempt) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasFrozenRetryAttempt])

  useEffect(() => {
    if (
      isAuthReady &&
      hasCurrentGuestOwnerProof &&
      !isRetrySourceRefreshing &&
      isResultReady &&
      resultQuery.isSuccess &&
      sessionQuery.isSuccess
    ) {
      const isNewResultPath = readyResultPathRef.current !== location.pathname
      readyResultPathRef.current = location.pathname
      if (
        (isNewResultPath && navigationType !== 'POP') ||
        shouldRestoreRetryFocusRef.current
      ) {
        shouldRestoreRetryFocusRef.current = false
        summaryHeadingRef.current?.focus()
      }
    }
  }, [
    hasCurrentGuestOwnerProof,
    isAuthReady,
    isRetrySourceRefreshing,
    isResultReady,
    location.pathname,
    navigationType,
    resultQuery.isSuccess,
    sessionQuery.isSuccess,
    summaryHeadingRef
  ])

  const isRetiredSession = sessionQuery.isError
    ? isRetiredPracticeApiError(sessionQuery.error)
    : sessionQuery.data?.session.practiceContractVersion === 1
  const isUnverifiedGuestProbePaused =
    role === 'GUEST' &&
    !hasCurrentGuestOwnerProof &&
    (resultQuery.fetchStatus === 'paused' ||
      sessionQuery.fetchStatus === 'paused')
  const isColdOffline =
    (resultQuery.isPending &&
      !resultQuery.data &&
      resultQuery.fetchStatus === 'paused') ||
    (sessionQuery.isPending &&
      !sessionQuery.data &&
      sessionQuery.fetchStatus === 'paused')
  const hasNotFoundError =
    (resultQuery.isError && isNotFoundApiError(resultQuery.error)) ||
    (sessionQuery.isError && isNotFoundApiError(sessionQuery.error))
  const hasUnverifiedGuestProbeError =
    role === 'GUEST' &&
    !hasCurrentGuestOwnerProof &&
    (resultQuery.isError || sessionQuery.isError)
  const isWaitingForResult =
    resultQuery.isPending ||
    sessionQuery.isPending ||
    (!hasCurrentGuestOwnerProof &&
      !resultQuery.isError &&
      !sessionQuery.isError)
  const hasRetryableError =
    (hasUnverifiedGuestProbeError && !hasNotFoundError) ||
    (resultQuery.isError &&
      !resultQuery.data &&
      !isNotFoundApiError(resultQuery.error)) ||
    (sessionQuery.isError &&
      !sessionQuery.data &&
      !isNotFoundApiError(sessionQuery.error)) ||
    (!resultQuery.isError && !resultQuery.data) ||
    (!sessionQuery.isError && !sessionQuery.data)

  const items = resultQuery.data?.items ?? []
  const selection = new URLSearchParams(location.search).get('question')
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.question.id === selection)
  )
  const selectedItem = items[selectedIndex]
  const selectedIsBookmarked = Boolean(
    selectedItem && bookmark.isBookmarked(selectedItem.question.id)
  )
  const isResultSourceUnavailable =
    resultQuery.isError ||
    sessionQuery.isError ||
    resultQuery.fetchStatus === 'paused' ||
    sessionQuery.fetchStatus === 'paused'
  const incorrectItems = items.filter((item) => !item.isCorrect)
  const canRequestCanonicalRetry = incorrectItems.every(
    (item) =>
      item.sessionQuestionId !== null &&
      item.question.questionVersionId !== null
  )
  const hasNoEligibleRetry = isNoEligibleQuestionsApiError(
    createRetrySession.error
  )
  const canShowRetryButton =
    incorrectItems.length > 0 && canRequestCanonicalRetry && !hasNoEligibleRetry
  const isRetryAccountRestricted = isAccountRestrictedApiError(
    createRetrySession.error
  )
  const hasRetryRequestError =
    createRetrySession.isError &&
    !isRetryAccountRestricted &&
    !isStudyResultNotReadyApiError(createRetrySession.error) &&
    !isAuthTransitionSupersededError(createRetrySession.error)

  const refetchResult = (): void => {
    shouldRestoreRetryFocusRef.current = true
    void Promise.all([resultQuery.refetch(), sessionQuery.refetch()])
  }

  const selectQuestion = (questionId: string): void => {
    if (!items.some((item) => item.question.id === questionId)) return
    const next = new URLSearchParams(location.search)
    next.set('question', questionId)
    void navigate(
      { search: next.toString(), hash: location.hash },
      { replace: true, preventScrollReset: true }
    )
  }

  const handleRetryIncorrect = (): void => {
    if (
      incorrectItems.length === 0 ||
      !canRequestCanonicalRetry ||
      hasNoEligibleRetry ||
      isResultSourceUnavailable ||
      isRetrySourceRefreshing ||
      createRetrySession.isPending
    ) {
      return
    }
    setRetryMessage(null)
    setRetrySourceMissing(false)
    createRetrySession.reset()
    createRetrySession.mutate(
      { principalScope, sourceSessionId: sessionId },
      {
        onSuccess: ({ session: nextSession }) => {
          if (nextSession.session.status === 'SUBMITTED') {
            setRetryDestination(`/practice/result/${nextSession.session.id}`)
            return
          }
          if (nextSession.session.status === 'IN_PROGRESS') {
            setRetryDestination(`/practice/session/${nextSession.session.id}`)
            return
          }
          setRetryMessage('priorEnded')
        },
        onError: (error) => {
          if (
            isNotFoundApiError(error) &&
            !isNoEligibleQuestionsApiError(error)
          ) {
            setRetrySourceMissing(true)
            return
          }
          if (isStudyResultNotReadyApiError(error)) {
            setRetryMessage('sourceRefreshing')
            setRetrySourceRefreshing(true)
            void Promise.all([
              resultQuery.refetch(),
              sessionQuery.refetch()
            ]).then(() => {
              setRetryMessage(null)
              shouldRestoreRetryFocusRef.current = true
              setRetrySourceRefreshing(false)
            })
          }
        }
      }
    )
  }

  const toggleSelectedBookmark = (): void => {
    if (!selectedItem) return
    bookmark.toggle(
      selectedItem,
      selectedIsBookmarked,
      isResultSourceUnavailable
    )
  }

  const stayOnResult = (): void => {
    if (retryNavigationBlocker.state === 'blocked') {
      retryNavigationBlocker.reset()
    }
  }

  return {
    bookmark,
    canRequestCanonicalRetry,
    canShowRetryButton,
    createRetrySession,
    handleRetryIncorrect,
    hasNoEligibleRetry,
    hasNotFoundError,
    hasRetryableError,
    hasRetryRequestError,
    isRetryAccountRestricted,
    incorrectItems,
    isAuthReady,
    isColdOffline,
    isRetiredSession,
    isRetryBlocked: retryNavigationBlocker.state === 'blocked',
    isRetrySourceMissing,
    isRetrySourceRefreshing,
    isResultSourceUnavailable,
    isUnverifiedGuestProbePaused,
    isWaitingForResult,
    navigationType,
    principalScope,
    refetchResult,
    resultQuery,
    retryMessage,
    role,
    selectQuestion,
    selectedIndex,
    selectedIsBookmarked,
    selectedItem,
    sessionQuery,
    stayOnResult,
    toggleSelectedBookmark
  }
}

export type PracticeResultController = ReturnType<
  typeof usePracticeResultController
>
