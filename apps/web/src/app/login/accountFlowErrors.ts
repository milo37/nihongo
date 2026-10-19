import { ssoAccountErrorCodeSchema } from '@nihongo/contracts/auth/sso-account-management'
import { isApiError } from '@api/config'
import { AuthFlowError } from '@app/login/authFlowErrors'
import {
  captureAuthActorTransitionFence,
  assertCurrentAuthActorTransitionFence,
  captureAuthTransitionEpoch,
  assertCurrentAuthTransitionEpoch,
  isAuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
export class AccountFlowError extends AuthFlowError {
  readonly code
  readonly authenticationRequired: boolean
  constructor(error: unknown) {
    super(error)
    this.name = 'AccountFlowError'
    const code = ssoAccountErrorCodeSchema.safeParse(
      isApiError(error) ? error.code : null
    )
    this.code = code.success ? code.data : undefined
    this.authenticationRequired = isApiError(error) && error.status === 401
  }
}
export const accountRequest = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const epoch = captureAuthTransitionEpoch()
  try {
    const result = await operation()
    assertCurrentAuthTransitionEpoch(epoch)
    return result
  } catch (error: unknown) {
    assertCurrentAuthTransitionEpoch(epoch)
    if (isAuthTransitionSupersededError(error)) throw error
    throw new AccountFlowError(error)
  }
}
export const accountMutationRequest = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const fence = captureAuthActorTransitionFence(
    useAppStore.getState().currentUser
  )
  try {
    const result = await accountRequest(operation)
    assertCurrentAuthActorTransitionFence(
      fence,
      useAppStore.getState().currentUser
    )
    return result
  } catch (error: unknown) {
    assertCurrentAuthActorTransitionFence(
      fence,
      useAppStore.getState().currentUser
    )
    throw error
  }
}
