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

export interface AuthActorTransitionFence {
  readonly actorId: string
  readonly epoch: number
  readonly role: string
}

interface AuthActorIdentity {
  readonly id: string
  readonly role: string
}

export const captureAuthActorTransitionFence = (
  actor: AuthActorIdentity | null
): AuthActorTransitionFence => {
  if (!actor) throw new AuthTransitionSupersededError()
  return {
    actorId: actor.id,
    epoch: captureAuthTransitionEpoch(),
    role: actor.role
  }
}

export const assertCurrentAuthActorTransitionFence = (
  fence: AuthActorTransitionFence,
  actor: AuthActorIdentity | null
): void => {
  assertCurrentAuthTransitionEpoch(fence.epoch)
  if (actor?.id !== fence.actorId || actor.role !== fence.role) {
    throw new AuthTransitionSupersededError()
  }
}

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
