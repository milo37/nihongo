import type { QueryClient } from '@tanstack/react-query'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import { authQueries } from '@app/login/queries/authQueries'
import { clearAllSubmissionAttempts } from '@app/practice/submissionAttemptStorage'
import { clearAllStudyDraftWorkingCopies } from '@app/practice/draft/studyDraftWorkingCopyStorage'
import { closeAllStudyDraftRevisionChannels } from '@app/practice/draft/useStudyDraftRevisionSync'
import {
  advanceAuthTransitionEpoch,
  isCurrentAuthTransitionEpoch
} from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'

interface AuthTransitionOptions {
  forceClear?: boolean
  forcePracticeReset?: boolean
}

interface RefreshCanonicalAuthOptions extends AuthTransitionOptions {
  expectedIdentity: 'AUTHENTICATED' | 'GUEST'
}

export interface CanonicalAuthCommitResult {
  applied: boolean
  identityChanged: boolean
}

export const hasSameAuthIdentity = (
  left: AuthenticatedUser | null,
  right: AuthenticatedUser | null
): boolean => {
  return left?.id === right?.id && left?.role === right?.role
}

export const invalidateCanonicalAuthTransitions = (): void => {
  advanceAuthTransitionEpoch()
}

const applyCanonicalAuth = (
  queryClient: QueryClient,
  user: AuthenticatedUser | null,
  options: AuthTransitionOptions,
  transitionEpoch: number
): Promise<CanonicalAuthCommitResult> => {
  const authQueryKey = authQueries.currentUser().queryKey

  if (!isCurrentAuthTransitionEpoch(transitionEpoch)) {
    return Promise.resolve({ applied: false, identityChanged: false })
  }

  const state = useAppStore.getState()
  const identityChanged = !hasSameAuthIdentity(state.currentUser, user)

  if (identityChanged || options.forceClear) {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== authQueries.allKey()[0]
    })
  }

  if (identityChanged || options.forcePracticeReset) {
    clearAllSubmissionAttempts()
    clearAllStudyDraftWorkingCopies()
    closeAllStudyDraftRevisionChannels()
    state.resetPractice()
  }

  queryClient.setQueryData(authQueryKey, user)
  state.setCurrentUser(user)
  return Promise.resolve({ applied: true, identityChanged })
}

export const commitCanonicalAuth = async (
  queryClient: QueryClient,
  user: AuthenticatedUser | null,
  options: AuthTransitionOptions = {}
): Promise<CanonicalAuthCommitResult> => {
  const transitionEpoch = advanceAuthTransitionEpoch()
  const authQueryKey = authQueries.currentUser().queryKey
  await queryClient.cancelQueries({ queryKey: authQueryKey, exact: true })

  return applyCanonicalAuth(queryClient, user, options, transitionEpoch)
}

export const refreshCanonicalAuthAfterMutation = async (
  queryClient: QueryClient,
  options: RefreshCanonicalAuthOptions
): Promise<CanonicalAuthCommitResult> => {
  const transitionEpoch = advanceAuthTransitionEpoch()
  const authQuery = authQueries.currentUser()
  const authQueryKey = authQuery.queryKey

  await queryClient.cancelQueries({ queryKey: authQueryKey, exact: true })
  if (!isCurrentAuthTransitionEpoch(transitionEpoch)) {
    return { applied: false, identityChanged: false }
  }

  const state = useAppStore.getState()
  if (options.forceClear) {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== authQueries.allKey()[0]
    })
  }
  if (options.forcePracticeReset) {
    clearAllSubmissionAttempts()
    clearAllStudyDraftWorkingCopies()
    closeAllStudyDraftRevisionChannels()
    state.resetPractice()
  }
  if (options.expectedIdentity === 'GUEST') {
    queryClient.setQueryData(authQueryKey, null)
    state.setCurrentUser(null)
  }

  queryClient.removeQueries({ queryKey: authQueryKey, exact: true })
  const user = await queryClient.fetchQuery({ ...authQuery, staleTime: 0 })

  if (!isCurrentAuthTransitionEpoch(transitionEpoch)) {
    return { applied: false, identityChanged: false }
  }
  if (options.expectedIdentity === 'AUTHENTICATED' && !user) {
    throw new Error('로그인 세션을 확인하지 못했습니다.')
  }
  if (options.expectedIdentity === 'GUEST' && user) {
    throw new Error('로그아웃 상태를 확인하지 못했습니다.')
  }

  return applyCanonicalAuth(queryClient, user, options, transitionEpoch)
}
