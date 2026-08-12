import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { User } from '@common/types/domain'
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
  subscribeStorageChanges
} from '@libs/storage'

interface AuthSynchronizationResult {
  canonicalUser: User | null | undefined
  isReady: boolean
}

export const useAuthSynchronization = (): AuthSynchronizationResult => {
  const queryClient = useQueryClient()
  const projectedUser = useAppStore((state) => state.currentUser)
  const currentUserQuery = useGetCurrentUser()
  const [isExternalSynchronizing, setExternalSynchronizing] = useState(false)

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

            await commitCanonicalAuth(queryClient, user, { forceClear })
            if (requestedRevision !== revision) {
              shouldClearDataCache = shouldClearDataCache || forceClear
              continue
            }

            handledRevision = requestedRevision
            setExternalSynchronizing(false)
            return
          } catch {
            if (requestedRevision !== revision) {
              shouldClearDataCache = shouldClearDataCache || forceClear
              continue
            }

            handledRevision = requestedRevision
            setExternalSynchronizing(false)
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

    const synchronize = (forceClear: boolean): void => {
      revision += 1
      shouldClearDataCache = shouldClearDataCache || forceClear
      invalidateCanonicalAuthTransitions()
      setExternalSynchronizing(true)

      if (forceClear) {
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== authQueries.allKey()[0]
        })
      }

      void drainSynchronization()
    }

    const unsubscribe = subscribeStorageChanges((event) => {
      if (event.key === APP_STORE_KEY) {
        synchronize(false)
        return
      }

      if (event.key === MOCK_DATABASE_STORAGE_KEY || event.key === null) {
        synchronize(true)
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
    isReady:
      !isExternalSynchronizing &&
      (hasReconciledIdentity || currentUserQuery.isError)
  }
}
