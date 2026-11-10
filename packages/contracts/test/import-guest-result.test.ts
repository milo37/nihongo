import { describe, expect, it } from 'vitest'
import {
  importGuestResultBodySchema,
  importGuestResultErrorCodeSchema,
  importGuestResultResponseSchema
} from '../src/study/import-guest-result.js'

const sessionId = '018f6b7a-1f4b-7d5e-8a91-000000000010'

describe('import guest result contract (JLP-823)', () => {
  it('takes an empty body only', () => {
    expect(importGuestResultBodySchema.parse({})).toEqual({})
    expect(importGuestResultBodySchema.safeParse({ sessionId }).success).toBe(
      false
    )
  })

  it('returns the moved session or nothing', () => {
    for (const response of [
      { importedSessionId: sessionId, wrongAnswerCount: 3 },
      { importedSessionId: sessionId, wrongAnswerCount: 0 },
      { importedSessionId: null, wrongAnswerCount: 0 }
    ]) {
      expect(importGuestResultResponseSchema.parse(response)).toEqual(response)
    }
    for (const response of [
      { importedSessionId: null, wrongAnswerCount: 1 },
      { importedSessionId: sessionId, wrongAnswerCount: -1 },
      { importedSessionId: sessionId, wrongAnswerCount: 1, extra: true }
    ]) {
      expect(importGuestResultResponseSchema.safeParse(response).success).toBe(
        false
      )
    }
  })

  it('owns a closed error list', () => {
    expect(importGuestResultErrorCodeSchema.options).toContain(
      'AUTHENTICATION_REQUIRED'
    )
    expect(importGuestResultErrorCodeSchema.options).not.toContain(
      'GUEST_LIMIT_REACHED'
    )
  })
})
