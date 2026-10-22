import { describe, expect, it, vi } from 'vitest'
import {
  createPracticeRuntimeGate,
  PracticeRuntimeGateConfigurationError
} from './practiceRuntimeGate.js'

describe('practice runtime gate', () => {
  it('v1-v2 runtime은 migration readiness 뒤 v2 route를 연다', async () => {
    const checkDatabaseReadiness = vi.fn().mockResolvedValue(undefined)
    const checkV1Compatibility = vi.fn().mockResolvedValue(undefined)
    const gate = createPracticeRuntimeGate({
      runtime: 'v1-v2',
      checkDatabaseReadiness,
      checkV1Compatibility
    })

    await gate.checkReadiness()
    await gate.assertRequestAuthority()

    expect(gate.practiceContractV2Enabled).toBe(true)
    expect(checkDatabaseReadiness).toHaveBeenCalledOnce()
    expect(checkV1Compatibility).not.toHaveBeenCalled()
  })

  it('v1-compatible runtime은 authority를 전후 검증한 뒤 zero-fact fence를 통과한다', async () => {
    const events: string[] = []
    const gate = createPracticeRuntimeGate({
      runtime: 'v1-compatible',
      authority: {
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
        assertValid: vi.fn(() => events.push('authority'))
      },
      checkDatabaseReadiness: vi.fn(async () => {
        events.push('database')
      }),
      checkV1Compatibility: vi.fn(async () => {
        events.push('facts')
      })
    })

    await gate.checkReadiness()

    expect(gate.practiceContractV2Enabled).toBe(false)
    expect(events).toEqual(['database', 'authority', 'facts', 'authority'])

    events.length = 0
    await gate.assertRequestAuthority()
    expect(events).toEqual(['authority', 'facts', 'authority'])
  })

  it('authority가 없거나 full runtime에 잘못 주입되면 fail closed한다', () => {
    const checks = {
      checkDatabaseReadiness: vi.fn().mockResolvedValue(undefined),
      checkV1Compatibility: vi.fn().mockResolvedValue(undefined)
    }

    expect(() =>
      createPracticeRuntimeGate({ runtime: 'v1-compatible', ...checks })
    ).toThrow(PracticeRuntimeGateConfigurationError)
    expect(() =>
      createPracticeRuntimeGate({
        runtime: 'v1-v2',
        authority: {
          generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
          assertValid: vi.fn()
        },
        ...checks
      })
    ).toThrow(PracticeRuntimeGateConfigurationError)
  })

  it('DB fact가 0이어도 외부 monotonic authority가 철회되면 readiness를 거부한다', async () => {
    const checkV1Compatibility = vi.fn().mockResolvedValue(undefined)
    const gate = createPracticeRuntimeGate({
      runtime: 'v1-compatible',
      authority: {
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
        assertValid: vi.fn(() => {
          throw new Error('v2 exposure was enabled')
        })
      },
      checkDatabaseReadiness: vi.fn().mockResolvedValue(undefined),
      checkV1Compatibility
    })

    await expect(gate.checkReadiness()).rejects.toThrow()
    expect(checkV1Compatibility).not.toHaveBeenCalled()
  })

  it('listener 시작 뒤 새 v2 fact가 관찰되면 request gate도 fail closed한다', async () => {
    const checkV1Compatibility = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('v2 fact detected'))
    const gate = createPracticeRuntimeGate({
      runtime: 'v1-compatible',
      authority: {
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
        assertValid: vi.fn()
      },
      checkDatabaseReadiness: vi.fn().mockResolvedValue(undefined),
      checkV1Compatibility
    })

    await gate.checkReadiness()
    await expect(gate.assertRequestAuthority()).rejects.toThrow()
    expect(checkV1Compatibility).toHaveBeenCalledTimes(2)
  })
})
