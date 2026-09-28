import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import {
  commitCanonicalAuth,
  hasSameAuthIdentity,
  invalidateCanonicalAuthTransitions
} from '@app/login/authSession'
import { useGetCurrentUser } from '@app/login/hooks/useGetCurrentUser'
import { authQueries } from '@app/login/queries/authQueries'
import { useAppStore } from '@store/index'
import {
  APP_STORE_KEY,
  MOCK_DATABASE_STORAGE_KEY,
  PHASE7_ADMIN_CMS_STORAGE_KEY,
  subscribeStorageChanges
} from '@libs/storage'

interface AuthSynchronizationResult {
  canonicalUser: AuthenticatedUser | null | undefined
  hasError: boolean
  isReady: boolean
  retry: () => void
}

export const useAuthSynchronization = (): AuthSynchronizationResult => {
  const queryClient = useQueryClient()
  const projectedUser = useAppStore((state) => state.currentUser)
  const currentUserQuery = useGetCurrentUser()
  const [isExternalSynchronizing, setExternalSynchronizing] = useState(false)
  const [isAuthorizationBlocked, setAuthorizationBlocked] = useState(false)

  useEffect(() => {
    if (
      currentUserQuery.isSuccess &&
      !isExternalSynchronizing &&
      !hasSameAuthIdentity(projectedUser, currentUserQuery.data)
    ) {
      void commitCanonicalAuth(queryClient, currentUserQuery.data)
    }
  }, [
    currentUserQuery.data,
    currentUserQuery.isSuccess,
    isExternalSynchronizing,
    projectedUser,
    queryClient
  ])

  useEffect(() => {
    let isDisposed = false
    let isSynchronizing = false
    let revision = 0
    let handledRevision = 0
    let shouldClearDataCache = false
    const authQueryKey = authQueries.currentUser().queryKey

    const drainSynchronization = async (): Promise<void> => {
      if (isSynchronizing) {
        return
      }

      isSynchronizing = true
      try {
        while (!isDisposed) {
          const requestedRevision = revision
          const forceClear = shouldClearDataCache
          shouldClearDataCache = false

          try {
            await queryClient.cancelQueries({
              queryKey: authQueryKey,
              exact: true
            })
            if (requestedRevision !== revision) {
              shouldClearDataCache = shouldClearDataCache || forceClear
              continue
            }

            const user = await queryClient.fetchQuery({
              ...authQueries.currentUser(),
              staleTime: 0
            })

            if (isDisposed) {
              return
            }

            if (requestedRevision !== revision) {
              shouldClearDataCache = shouldClearDataCache || forceClear
              continue
            }

            await commitCanonicalAuth(queryClient, user)
            if (requestedRevision !== revision) {
              shouldClearDataCache = shouldClearDataCache || forceClear
              continue
            }

            handledRevision = requestedRevision
            setExternalSynchronizing(false)
            setAuthorizationBlocked(false)
            return
          } catch {
            if (requestedRevision !== revision) {
              shouldClearDataCache = shouldClearDataCache || forceClear
              continue
            }

            handledRevision = requestedRevision
            setExternalSynchronizing(false)
            setAuthorizationBlocked(false)
            return
          }
        }
      } finally {
        isSynchronizing = false
        if (!isDisposed && handledRevision !== revision) {
          void drainSynchronization()
        }
      }
    }

    const synchronize = (
      forceClear: boolean,
      blockAuthorization: boolean
    ): void => {
      revision += 1
      shouldClearDataCache = shouldClearDataCache || forceClear
      invalidateCanonicalAuthTransitions()
      setExternalSynchronizing(true)
      if (blockAuthorization) {
        setAuthorizationBlocked(true)
      }

      if (forceClear) {
        queryClient.removeQueries({
          predicate: (query) =>
            query.queryKey[0] !== authQueries.allKey()[0] &&
            query.getObserversCount() === 0
        })
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== authQueries.allKey()[0],
          refetchType: 'active'
        })
      }

      void drainSynchronization()
    }

    const unsubscribe = subscribeStorageChanges((event) => {
      if (event.key === APP_STORE_KEY) {
        synchronize(false, true)
        return
      }

      if (event.key === MOCK_DATABASE_STORAGE_KEY) {
        synchronize(true, false)
        return
      }

      if (event.key === PHASE7_ADMIN_CMS_STORAGE_KEY) {
        queryClient.removeQueries({
          predicate: (query) =>
            query.queryKey[0] !== authQueries.allKey()[0] &&
            query.getObserversCount() === 0
        })
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== authQueries.allKey()[0],
          refetchType: 'active'
        })
        return
      }

      if (event.key === null) {
        synchronize(true, true)
      }
    })

    return () => {
      isDisposed = true
      unsubscribe()
    }
  }, [queryClient])

  const hasReconciledIdentity =
    currentUserQuery.isSuccess &&
    projectedUser?.id === currentUserQuery.data?.id &&
    projectedUser?.role === currentUserQuery.data?.role

  return {
    canonicalUser: currentUserQuery.isSuccess
      ? currentUserQuery.data
      : undefined,
    hasError: !isExternalSynchronizing && currentUserQuery.isError,
    // Keep the mounted route (and any local draft) alive while a cross-tab
    // data-only update revalidates the same canonical actor. Auth-storage
    // changes block immediately; a DB refresh that finds a different actor or
    // role also makes the identities diverge and closes this boundary.
    isReady:
      !isAuthorizationBlocked &&
      currentUserQuery.isSuccess &&
      hasReconciledIdentity,
    retry: () => {
      void currentUserQuery.refetch()
    }
  }
}
