import { useEffect, useState } from 'react'
import type { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import type { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { isAuthenticationBoundaryApiError } from '@libs/apiError'

type UseGuestSessionOwnerProofInput = {
  isAuthReady: boolean
  role: ReturnType<typeof useAuth>['role']
  sessionId: string
  sessionQuery: ReturnType<typeof useGetStudySession>
}

// A guest owns a session only after a fresh fetch from this mount proves it.
export const useGuestSessionOwnerProof = ({
  isAuthReady,
  role,
  sessionId,
  sessionQuery
}: UseGuestSessionOwnerProofInput): boolean => {
  const [verifiedGuestSessionId, setVerifiedGuestSessionId] = useState<
    string | null
  >(null)

  useEffect(() => {
    let nextVerifiedSessionId: string | null | undefined
    if (!isAuthReady || role !== 'GUEST') {
      nextVerifiedSessionId = null
    }
    if (
      nextVerifiedSessionId === undefined &&
      sessionQuery.isSuccess &&
      sessionQuery.isFetchedAfterMount &&
      sessionQuery.data.session.id === sessionId
    ) {
      nextVerifiedSessionId = sessionId
    }
    if (
      nextVerifiedSessionId === undefined &&
      sessionQuery.isError &&
      isAuthenticationBoundaryApiError(sessionQuery.error)
    ) {
      nextVerifiedSessionId = null
    }
    if (nextVerifiedSessionId === undefined) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (active) {
        setVerifiedGuestSessionId((current) =>
          current === nextVerifiedSessionId ? current : nextVerifiedSessionId
        )
      }
    })
    return () => {
      active = false
    }
  }, [
    isAuthReady,
    role,
    sessionId,
    sessionQuery.data,
    sessionQuery.error,
    sessionQuery.isError,
    sessionQuery.isFetchedAfterMount,
    sessionQuery.isSuccess
  ])

  return (
    isAuthReady && (role !== 'GUEST' || verifiedGuestSessionId === sessionId)
  )
}
