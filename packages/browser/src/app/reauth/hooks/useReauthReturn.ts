import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authQueries } from '../../login/queries/authQueries'
import { commitCanonicalAuth } from '../../login/authSession'
import {
  captureAuthTransitionEpoch,
  isCurrentAuthTransitionEpoch
} from '../../../libs/authTransitionFence'
import { adminFreshRemainingMs } from '../adminFreshTime'

export type ReauthCheck =
  | { phase: 'checking' }
  | { phase: 'unknown' }
  | { phase: 'checked'; fresh: boolean }

/**
 * After a re-verification return, reads the current user once from the
 * server and applies it, so the result shown is the server's, not the URL's.
 * Remount (new `key`) to check again.
 */
export const useReauthReturn = (): ReauthCheck => {
  const client = useQueryClient()
  const [check, setCheck] = useState<ReauthCheck>({ phase: 'checking' })
  useEffect(() => {
    let active = true
    const epoch = captureAuthTransitionEpoch()
    void client
      .fetchQuery({ ...authQueries.currentUser(), staleTime: 0 })
      .then(async (user) => {
        if (!active) return
        if (!isCurrentAuthTransitionEpoch(epoch)) {
          setCheck({ phase: 'unknown' })
          return
        }
        const result = await commitCanonicalAuth(client, user)
        if (!active) return
        setCheck(
          result.applied
            ? {
                phase: 'checked',
                fresh: adminFreshRemainingMs(user) > 0
              }
            : { phase: 'unknown' }
        )
      })
      .catch(() => {
        if (active) setCheck({ phase: 'unknown' })
      })
    return () => {
      active = false
    }
  }, [client])
  return check
}
