import type { PersistedUserRole } from '@nihongo/contracts/common/enum'
import { ApplicationError } from '../errors/applicationError.js'

export type RequestActor =
  | { kind: 'GUEST'; guestPrincipalId: string }
  | { kind: 'USER'; role: PersistedUserRole; userId: string }

export const requireAuthenticatedActor = (
  actor: RequestActor
): Extract<RequestActor, { kind: 'USER' }> => {
  if (actor.kind === 'GUEST') {
    throw new ApplicationError({
      code: 'AUTHENTICATION_REQUIRED',
      message: '로그인이 필요합니다.',
      retryable: false
    })
  }

  return actor
}

export const requireAdminActor = (
  actor: RequestActor
): Extract<RequestActor, { kind: 'USER' }> => {
  const user = requireAuthenticatedActor(actor)
  if (user.role !== 'ADMIN') {
    throw new ApplicationError({
      code: 'ADMIN_REQUIRED',
      message: '관리자 권한이 필요합니다.',
      retryable: false
    })
  }

  return user
}

export const assertOwnedResource = (
  actor: RequestActor,
  owner: { guestPrincipalId: string | null; userId: string | null }
): void => {
  const hasExactlyOneOwner =
    (owner.userId === null) !== (owner.guestPrincipalId === null)
  const isOwner =
    hasExactlyOneOwner &&
    (actor.kind === 'USER'
      ? actor.userId === owner.userId
      : actor.guestPrincipalId === owner.guestPrincipalId)

  if (!isOwner) {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: '요청한 리소스를 찾을 수 없습니다.',
      retryable: false
    })
  }
}
