import { useEffect, useState } from 'react'
import type { useGetStudyResult } from '@app/practice/hooks/useGetStudyResult'
import type { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import type { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthenticationBoundaryApiError } from '@libs/apiError'

type UseGuestResultOwnerProofInput = {
  isAuthReady: boolean
  resultQuery: ReturnType<typeof useGetStudyResult>
  role: ReturnType<typeof useAuth>['role']
  sessionId: string
  sessionQuery: ReturnType<typeof useGetStudySession>
}

// A guest owns a result only after fresh result and session reads from this mount prove it.
export const useGuestResultOwnerProof = ({
  isAuthReady,
  resultQuery,
  role,
  sessionId,
  sessionQuery
}: UseGuestResultOwnerProofInput): boolean => {
  const [verifiedGuestResultSessionId, setVerifiedGuestResultSessionId] =
    useState<string | null>(null)

  useEffect(() => {
    let nextVerifiedSessionId: string | null | undefined
    if (!isAuthReady || role !== 'GUEST') {
      nextVerifiedSessionId = null
    }
    if (
      nextVerifiedSessionId === undefined &&
      resultQuery.isSuccess &&
      resultQuery.isFetchedAfterMount &&
      resultQuery.data.sessionId === sessionId &&
      sessionQuery.isSuccess &&
      sessionQuery.isFetchedAfterMount &&
      sessionQuery.data.session.id === sessionId
    ) {
      nextVerifiedSessionId = sessionId
    }
    if (
      nextVerifiedSessionId === undefined &&
      ((resultQuery.isError &&
        isAuthenticationBoundaryApiError(resultQuery.error)) ||
        (sessionQuery.isError &&
          isAuthenticationBoundaryApiError(sessionQuery.error)))
    ) {
      nextVerifiedSessionId = null
    }
    if (nextVerifiedSessionId === undefined) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (active) {
        setVerifiedGuestResultSessionId((current) =>
          current === nextVerifiedSessionId ? current : nextVerifiedSessionId
        )
      }
    })
    return () => {
      active = false
    }
  }, [
    isAuthReady,
    resultQuery.data,
    resultQuery.error,
    resultQuery.isError,
    resultQuery.isFetchedAfterMount,
    resultQuery.isSuccess,
    role,
    sessionId,
    sessionQuery.data,
    sessionQuery.error,
    sessionQuery.isError,
    sessionQuery.isFetchedAfterMount,
    sessionQuery.isSuccess
  ])

  return (
    isAuthReady &&
    (role !== 'GUEST' || verifiedGuestResultSessionId === sessionId)
  )
}
