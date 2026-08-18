import { describe, expect, it, vi } from 'vitest'
import {
  parseStudySessionCleanupCommandInput,
  STUDY_SESSION_CLEANUP_CONFIRMATION
} from './studySessionCleanupCommandConfig.js'
import type { StudySessionCleanupRepository } from './studySessionCleanupRepository.js'
import {
  createStudySessionCleanupService,
  DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE
} from './studySessionCleanupService.js'
import { assertSafeStudySessionCleanupTarget } from './studySessionCleanupTargetGuard.js'

const NOW = new Date('2000-01-01T12:00:00.000Z')
const result = {
  deletedGuestPrincipalCount: 1,
  deletedIdempotencyRecordCount: 3,
  deletedStudySessionCount: 2,
  guestPrincipalBatchLimitReached: false,
  idempotencyRecordBatchLimitReached: false,
  studySessionBatchLimitReached: false
}

describe('StudySession cleanup service', () => {
  it('고정 clock과 기본 bounded batch를 repository에 전달한다', async () => {
    const cleanupExpiredGuestStudyData = vi.fn().mockResolvedValue(result)
    const repository: StudySessionCleanupRepository = {
      cleanupExpiredGuestStudyData
    }
    const service = createStudySessionCleanupService(repository, () => NOW)

    await expect(service.cleanup()).resolves.toEqual(result)
    expect(cleanupExpiredGuestStudyData).toHaveBeenCalledWith({
      batchSize: DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE,
      now: NOW
    })
  })

  it.each([0, -1, 1.5, 501])(
    'batchSize %s를 repository 호출 전에 거부한다',
    async (batchSize) => {
      const cleanupExpiredGuestStudyData = vi.fn().mockResolvedValue(result)
      const service = createStudySessionCleanupService(
        { cleanupExpiredGuestStudyData },
        () => NOW
      )

      await expect(service.cleanup({ batchSize })).rejects.toThrow()
      expect(cleanupExpiredGuestStudyData).not.toHaveBeenCalled()
    }
  )
})

describe('StudySession cleanup command config', () => {
  it('정확한 confirmation과 bounded batch만 허용한다', () => {
    expect(
      parseStudySessionCleanupCommandInput({
        STUDY_CLEANUP_CONFIRM: STUDY_SESSION_CLEANUP_CONFIRMATION,
        STUDY_CLEANUP_BATCH_SIZE: '25'
      })
    ).toEqual({ batchSize: 25 })
    expect(
      parseStudySessionCleanupCommandInput({
        STUDY_CLEANUP_CONFIRM: STUDY_SESSION_CLEANUP_CONFIRMATION
      })
    ).toEqual({ batchSize: DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE })
  })

  it.each([
    {},
    { STUDY_CLEANUP_CONFIRM: 'yes' },
    {
      STUDY_CLEANUP_CONFIRM: STUDY_SESSION_CLEANUP_CONFIRMATION,
      STUDY_CLEANUP_BATCH_SIZE: '0'
    },
    {
      STUDY_CLEANUP_CONFIRM: STUDY_SESSION_CLEANUP_CONFIRMATION,
      STUDY_CLEANUP_BATCH_SIZE: '501'
    }
  ])('unsafe command input을 fail closed한다', (source) => {
    expect(() => parseStudySessionCleanupCommandInput(source)).toThrow()
  })
})

describe('StudySession cleanup target guard', () => {
  const testUrl = 'postgresql://nihongo:secret@127.0.0.1:55432/nihongo_test'
  const developmentUrl =
    'postgresql://nihongo:secret@127.0.0.1:55432/nihongo_dev'

  it('loopback의 정확한 test/dev suffix만 허용한다', () => {
    expect(() =>
      assertSafeStudySessionCleanupTarget({
        databaseUrl: testUrl,
        nodeEnvironment: 'test'
      })
    ).not.toThrow()
    expect(() =>
      assertSafeStudySessionCleanupTarget({
        databaseUrl: developmentUrl,
        nodeEnvironment: 'development'
      })
    ).not.toThrow()
  })

  it('production과 잘못된 target을 fail closed한다', () => {
    for (const input of [
      { databaseUrl: testUrl, nodeEnvironment: 'production' as const },
      { databaseUrl: developmentUrl, nodeEnvironment: 'test' as const },
      {
        databaseUrl: 'postgresql://user:secret@db.example.com/nihongo_test',
        nodeEnvironment: 'test' as const
      }
    ]) {
      expect(() => assertSafeStudySessionCleanupTarget(input)).toThrow()
    }
  })
})
