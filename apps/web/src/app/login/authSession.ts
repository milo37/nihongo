import type { QueryClient } from '@tanstack/react-query'
import type { User } from '@common/types/domain'
import { authQueries } from '@app/login/queries/authQueries'
import { useAppStore } from '@store/index'

interface AuthTransitionOptions {
  forceClear?: boolean
  forcePracticeReset?: boolean
}

export interface CanonicalAuthCommitResult {
  applied: boolean
  identityChanged: boolean
}

let authTransitionEpoch = 0

export const hasSameAuthIdentity = (
  left: User | null,
  right: User | null
): boolean => {
  return left?.id === right?.id && left?.role === right?.role
}

export const invalidateCanonicalAuthTransitions = (): void => {
  authTransitionEpoch += 1
}

export const commitCanonicalAuth = async (
  queryClient: QueryClient,
  user: User | null,
  options: AuthTransitionOptions = {}
): Promise<CanonicalAuthCommitResult> => {
  const transitionEpoch = authTransitionEpoch + 1
  authTransitionEpoch = transitionEpoch
  const authQueryKey = authQueries.currentUser().queryKey
  await queryClient.cancelQueries({ queryKey: authQueryKey, exact: true })

  if (transitionEpoch !== authTransitionEpoch) {
    return { applied: false, identityChanged: false }
  }

  const state = useAppStore.getState()
  const identityChanged = !hasSameAuthIdentity(state.currentUser, user)

  if (identityChanged || options.forceClear) {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== authQueries.allKey()[0]
    })
  }

  if (identityChanged || options.forcePracticeReset) {
    state.resetPractice()
  }

  queryClient.setQueryData(authQueryKey, user)
  state.setCurrentUser(user)
  return { applied: true, identityChanged }
}
