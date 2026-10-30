import { describe, expect, it } from 'vitest'
import { parseStudyGuestCleanupCommandInput } from './studyGuestCleanupCommandInput.js'

const base = {
  GUEST_CLEANUP_DATABASE_URL:
    'postgresql://worker@localhost/nihongo_test?schema=test',
  GUEST_CLEANUP_ENVIRONMENT: 'TEST'
}

describe('guest cleanup command input', () => {
  it('defaults to a bounded dry run', () => {
    expect(parseStudyGuestCleanupCommandInput(base)).toMatchObject({
      environment: 'TEST',
      dryRun: true,
      batchSize: 100,
      maxBatches: 10,
      maxDurationMs: 30_000
    })
  })

  it('refuses destructive mode without exact confirmation', () => {
    expect(() =>
      parseStudyGuestCleanupCommandInput({
        ...base,
        GUEST_CLEANUP_DRY_RUN: 'false'
      })
    ).toThrow()
    expect(
      parseStudyGuestCleanupCommandInput({
        ...base,
        GUEST_CLEANUP_DRY_RUN: 'false',
        GUEST_CLEANUP_CONFIRM: 'CLEANUP_EXPIRED_GUEST_DATA'
      }).dryRun
    ).toBe(false)
  })

  it('rejects wrong DB targets, environments and limits', () => {
    expect(() =>
      parseStudyGuestCleanupCommandInput({
        ...base,
        GUEST_CLEANUP_DATABASE_URL: 'postgresql://worker@localhost/nihongo_prod'
      })
    ).toThrow()
    expect(() =>
      parseStudyGuestCleanupCommandInput({
        ...base,
        GUEST_CLEANUP_ENVIRONMENT: 'DEVELOPMENT'
      })
    ).toThrow()
    expect(() =>
      parseStudyGuestCleanupCommandInput({
        ...base,
        GUEST_CLEANUP_BATCH_SIZE: '501'
      })
    ).toThrow()
    expect(() =>
      parseStudyGuestCleanupCommandInput({
        ...base,
        GUEST_CLEANUP_MAX_BATCHES: '101'
      })
    ).toThrow()
    expect(() =>
      parseStudyGuestCleanupCommandInput({
        ...base,
        GUEST_CLEANUP_MAX_DURATION_MS: '300001'
      })
    ).toThrow()
  })

  it('requires a matching production database and schema', () => {
    const production = {
      ...base,
      GUEST_CLEANUP_ENVIRONMENT: 'PRODUCTION',
      GUEST_CLEANUP_DATABASE_URL: 'postgresql://worker@db/nihongo?schema=public'
    }
    expect(() => parseStudyGuestCleanupCommandInput(production)).toThrow()
    expect(() =>
      parseStudyGuestCleanupCommandInput({
        ...production,
        PRODUCTION_DATABASE_URL: 'postgresql://other@db/nihongo?schema=other'
      })
    ).toThrow()
    expect(
      parseStudyGuestCleanupCommandInput({
        ...production,
        PRODUCTION_DATABASE_URL: 'postgresql://other@db/nihongo?schema=public'
      }).dryRun
    ).toBe(true)
  })
})
