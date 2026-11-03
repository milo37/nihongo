import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getCurrentUser } from '@nihongo/browser/api/auth/getCurrentUser/index'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import type { GetCurrentUserResponse } from '@nihongo/browser/api/auth/getCurrentUser/schema'

type CurrentUser = NonNullable<GetCurrentUserResponse>

export type IdleLockRecheckState = 'idle' | 'checking' | 'failed' | 'expired'

const isAuthError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'isAuthError' in error &&
  error.isAuthError === true

/**
 * Reads /me directly instead of the shared auth query, so a failed or expired
 * check stays inside the lock dialog rather than replacing the page or
 * redirecting. Only a different, non-admin principal is committed, which lets
 * the role guard show the generic 404.
 */
export const useIdleLockRecheck = (
  onConfirmed: () => void,
  /** Extra condition on the same admin, e.g. a recent ADMIN_FRESH sign-in. */
  accepts: (current: CurrentUser) => boolean = () => true
) => {
  const client = useQueryClient()
  const { user } = useAuth()
  const [state, setState] = useState<IdleLockRecheckState>('idle')

  const recheck = async (): Promise<void> => {
    setState('checking')
    try {
      const current = await getCurrentUser()
      if (current === null) {
        setState('expired')
        return
      }
      if (current.id === user?.id && current.role === 'ADMIN') {
        if (!accepts(current)) {
          setState('failed')
          return
        }
        setState('idle')
        onConfirmed()
        return
      }
      await commitCanonicalAuth(client, current)
      setState('failed')
    } catch (error) {
      setState(isAuthError(error) ? 'expired' : 'failed')
    }
  }

  return { state, recheck }
}
