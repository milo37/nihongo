import { describe, expect, it } from 'vitest'
import { selectDatabaseGlobalOmit } from './database.js'

describe('selectDatabaseGlobalOmit', () => {
  it('pre-Phase-7 runtime에서 이후 추가된 scalar 전체를 기본 조회에서 제외한다', () => {
    expect(selectDatabaseGlobalOmit('pre-phase7')).toEqual({
      question: {
        createdByActorId: true,
        createdByRoleSnapshot: true,
        rowVersion: true
      },
      questionVersion: {
        contentFingerprint: true,
        createdByActorId: true,
        createdByRoleSnapshot: true,
        retirementKind: true
      },
      questionVersionTag: { normalizedNameSnapshot: true },
      session: {
        authorityGeneration: true,
        authorizationState: true,
        issuerProtocolVersion: true,
        sessionFamilyId: true
      },
      user: { authorityGeneration: true },
      verification: {
        capturedGeneration: true,
        purpose: true,
        resetUserId: true,
        tokenSelector: true
      }
    })
  })

  it('current/role runtime에는 Phase 7 field projection을 유지한다', () => {
    expect(selectDatabaseGlobalOmit('current')).toBeUndefined()
    expect(selectDatabaseGlobalOmit()).toBeUndefined()
  })
})
