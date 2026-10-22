import { describe, expect, it } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  assertOwnedResource,
  requireAdminActor,
  requireAuthenticatedActor
} from './authorization.js'

describe('authorization policy', () => {
  const guest = { kind: 'GUEST', guestPrincipalId: 'guest-1' } as const
  const user = { kind: 'USER', userId: 'user-1', role: 'USER' } as const
  const admin = { kind: 'USER', userId: 'admin-1', role: 'ADMIN' } as const

  it('guest와 USER의 admin 접근을 각각 401/403으로 막는다', () => {
    expect(() => requireAuthenticatedActor(guest)).toThrowError(
      ApplicationError
    )

    try {
      requireAdminActor(user)
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'ADMIN_REQUIRED' })
    }

    expect(requireAdminActor(admin)).toEqual(admin)
  })

  it('actor 종류와 정확히 일치하는 XOR owner만 허용한다', () => {
    const userOwner = { userId: 'user-1', guestPrincipalId: null }
    const guestOwner = { userId: null, guestPrincipalId: 'guest-1' }

    expect(() => assertOwnedResource(user, userOwner)).not.toThrow()
    expect(() => assertOwnedResource(guest, guestOwner)).not.toThrow()
    expect(() => assertOwnedResource(admin, userOwner)).toThrowError(
      ApplicationError
    )
    expect(() =>
      assertOwnedResource(guest, { ...guestOwner, guestPrincipalId: 'guest-2' })
    ).toThrowError(ApplicationError)
    expect(() =>
      assertOwnedResource(user, { userId: null, guestPrincipalId: null })
    ).toThrowError(ApplicationError)
    expect(() =>
      assertOwnedResource(user, {
        userId: 'user-1',
        guestPrincipalId: 'guest-1'
      })
    ).toThrowError(ApplicationError)
  })
})
