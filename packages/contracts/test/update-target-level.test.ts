import { describe, expect, it } from 'vitest'
import {
  updateTargetLevelBodySchema,
  updateTargetLevelErrorSchema,
  updateTargetLevelResponseSchema
} from '../src/auth/update-target-level.js'

describe('updateTargetLevel contract (JLP-815)', () => {
  it('accepts exactly one JLPT level', () => {
    expect(updateTargetLevelBodySchema.parse({ targetLevel: 'N3' })).toEqual({
      targetLevel: 'N3'
    })
    for (const body of [
      {},
      { targetLevel: null },
      { targetLevel: 'N6' },
      { targetLevel: 'n3' },
      { targetLevel: 'N3', userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1' }
    ]) {
      expect(updateTargetLevelBodySchema.safeParse(body).success).toBe(false)
    }
  })

  it('answers with the stored level only', () => {
    expect(
      updateTargetLevelResponseSchema.parse({ targetLevel: 'N1' })
    ).toEqual({ targetLevel: 'N1' })
    expect(
      updateTargetLevelResponseSchema.safeParse({
        targetLevel: 'N1',
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
      }).success
    ).toBe(false)
  })

  it('names the sign-in failure', () => {
    expect(
      updateTargetLevelErrorSchema.safeParse({
        code: 'AUTHENTICATION_REQUIRED',
        message: '로그인이 필요합니다.',
        requestId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1',
        retryable: false
      }).success
    ).toBe(true)
  })
})
