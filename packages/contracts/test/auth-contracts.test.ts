import { describe, expect, it } from 'vitest'
import { deleteGuestPrincipalErrorCodeSchema } from '../src/auth/delete-guest-principal.js'
import {
  currentPrincipalSchema,
  getCurrentPrincipalErrorCodeSchema
} from '../src/auth/get-current-principal.js'

describe('auth contracts', () => {
  it('guest와 최소 user projection만 허용한다', () => {
    expect(currentPrincipalSchema.parse({ kind: 'GUEST' })).toEqual({
      kind: 'GUEST'
    })
    expect(
      currentPrincipalSchema.parse({
        kind: 'USER',
        user: {
          id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
          name: '학습자',
          role: 'USER',
          targetLevel: null
        }
      })
    ).toMatchObject({ kind: 'USER', user: { role: 'USER' } })
  })

  it.each([
    {
      kind: 'USER',
      user: { id: 'not-a-uuid', name: 'x', role: 'USER', targetLevel: null }
    },
    {
      kind: 'USER',
      user: {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        name: 'x',
        role: 'GUEST',
        targetLevel: null
      }
    },
    {
      kind: 'USER',
      user: {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        name: 'x',
        role: 'USER',
        targetLevel: null,
        email: 'private@example.com'
      }
    },
    { kind: 'GUEST', token: 'credential' }
  ])('credential와 persistence metadata를 거부한다', (value) => {
    expect(currentPrincipalSchema.safeParse(value).success).toBe(false)
  })

  it('operation별 error union을 닫는다', () => {
    expect(getCurrentPrincipalErrorCodeSchema.options).toEqual([
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
    expect(deleteGuestPrincipalErrorCodeSchema.options).toEqual([
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
  })
})
