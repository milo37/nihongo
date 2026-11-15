import { describe, expect, it } from 'vitest'
import { parseRetentionCohortCommandInput } from './retentionCohortCommand.js'

const production = {
  DATABASE_URL:
    'postgresql://runtime:secret@db.internal:5432/nihongo?schema=app',
  PRODUCTION_DATABASE_URL:
    'postgresql://runtime:secret@db.internal:5432/nihongo?schema=app',
  RETENTION_ENVIRONMENT: 'PRODUCTION',
  RETENTION_CONFIRM: 'COUNT_RETENTION_COHORTS'
}

describe('#1042 retention count command input', () => {
  it('runs PRODUCTION only against the exact production database', () => {
    expect(parseRetentionCohortCommandInput(production)).toMatchObject({
      environment: 'PRODUCTION'
    })
    for (const source of [
      { ...production, PRODUCTION_DATABASE_URL: undefined },
      {
        ...production,
        PRODUCTION_DATABASE_URL:
          'postgresql://runtime:secret@other.internal:5432/nihongo?schema=app'
      },
      { ...production, RETENTION_CONFIRM: undefined },
      { ...production, RETENTION_ENVIRONMENT: 'STAGING' }
    ])
      expect(() => parseRetentionCohortCommandInput(source)).toThrow()
  })

  it('refuses a TEST run against a non-test database', () => {
    expect(() =>
      parseRetentionCohortCommandInput({
        ...production,
        PRODUCTION_DATABASE_URL: undefined,
        RETENTION_ENVIRONMENT: 'TEST'
      })
    ).toThrow()
    expect(
      parseRetentionCohortCommandInput({
        DATABASE_URL:
          'postgresql://runtime:secret@127.0.0.1:5432/nihongo_test?schema=app',
        RETENTION_ENVIRONMENT: 'TEST',
        RETENTION_CONFIRM: 'COUNT_RETENTION_COHORTS'
      })
    ).toMatchObject({ environment: 'TEST' })
  })
})
