let authTransitionEpoch = 0

export class AuthTransitionSupersededError extends Error {
  constructor() {
    super('인증 전환 전에 시작된 요청 응답을 무시했습니다.')
    this.name = 'AuthTransitionSupersededError'
  }
}

export const advanceAuthTransitionEpoch = (): number => {
  authTransitionEpoch += 1
  return authTransitionEpoch
}

export const captureAuthTransitionEpoch = (): number => authTransitionEpoch

export const isCurrentAuthTransitionEpoch = (epoch: number): boolean =>
  epoch === authTransitionEpoch

export const assertCurrentAuthTransitionEpoch = (epoch: number): void => {
  if (!isCurrentAuthTransitionEpoch(epoch)) {
    throw new AuthTransitionSupersededError()
  }
}

export const isAuthTransitionSupersededError = (error: unknown): boolean =>
  error instanceof AuthTransitionSupersededError

export interface AuthBoundActionFence<Input> {
  assertCurrent: (input: Input) => void
  capture: (input: Input) => void
}

export const createObjectAuthBoundActionFence = <
  Input extends object
>(): AuthBoundActionFence<Input> => {
  const epochs = new WeakMap<Input, number>()

  return {
    capture: (input) => {
      epochs.set(input, captureAuthTransitionEpoch())
    },
    assertCurrent: (input) => {
      const epoch = epochs.get(input)
      if (epoch === undefined) {
        throw new Error('action의 인증 경계를 확인하지 못했습니다.')
      }
      assertCurrentAuthTransitionEpoch(epoch)
    }
  }
}
