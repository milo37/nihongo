import { describe, expect, it } from 'vitest'
import {
  adminAuditCommandKey,
  adminAuditEnvironmentKey,
  adminApiErrorKeyByCode,
  adminCommandKey,
  adminDifficultyKey,
  adminImportIssueCodeKey,
  adminLifecycleStatusKey,
  adminQuestionSortKey,
  adminQuestionTypeKey,
  adminReportOutcomeKey,
  adminReportReasonKey,
  adminReportSortKey,
  adminReportStatusKey,
  adminSubjectKey,
  adminVersionStatusKey,
  getAdminApiErrorKey,
  getAdminRetryAfterSeconds,
  getFreshAssuranceReasonCode
} from '@app/admin/presentation/adminPresentation'

describe('admin presentation contracts', () => {
  it('keeps canonical values as exhaustive lookup keys', () => {
    expect(Object.keys(adminSubjectKey)).toEqual([
      'VOCABULARY',
      'GRAMMAR',
      'READING'
    ])
    expect(Object.keys(adminQuestionTypeKey)).toHaveLength(12)
    expect(Object.keys(adminDifficultyKey)).toEqual(['EASY', 'NORMAL', 'HARD'])
    expect(Object.keys(adminLifecycleStatusKey)).toEqual(['ACTIVE', 'ARCHIVED'])
    expect(Object.keys(adminVersionStatusKey)).toHaveLength(6)
    expect(Object.keys(adminQuestionSortKey)).toHaveLength(4)
    expect(Object.keys(adminCommandKey)).toHaveLength(8)
    expect(Object.keys(adminReportReasonKey)).toHaveLength(6)
    expect(Object.keys(adminReportStatusKey)).toHaveLength(4)
    expect(Object.keys(adminReportOutcomeKey)).toHaveLength(2)
    expect(Object.keys(adminReportSortKey)).toHaveLength(2)
    expect(Object.keys(adminImportIssueCodeKey)).toHaveLength(9)
    expect(Object.keys(adminAuditCommandKey)).toHaveLength(17)
    expect(Object.keys(adminAuditEnvironmentKey)).toEqual([
      'TEST',
      'DEVELOPMENT'
    ])
    expect(Object.keys(adminApiErrorKeyByCode)).toHaveLength(24)
  })

  it('presents stable error codes without using an API message', () => {
    expect(getAdminApiErrorKey({ code: 'VERSION_CONFLICT' })).toBe(
      'errors.versionConflict'
    )
    expect(getAdminApiErrorKey({ code: 'QUESTION_REPORT_DUPLICATE' })).toBe(
      'errors.reportDuplicate'
    )
    expect(getAdminApiErrorKey({ code: 'RATE_LIMITED', isOffline: true })).toBe(
      'errors.offline'
    )
    expect(getAdminApiErrorKey({ code: 'UNKNOWN_SERVER_CODE' })).toBe(
      'errors.generic'
    )
    expect(getAdminApiErrorKey({ code: 'REAUTHENTICATION_FAILED' })).toBe(
      'errors.reauthenticationFailed'
    )
    expect(
      getAdminApiErrorKey({ code: 'SEPARATION_OF_DUTIES_VIOLATION' })
    ).toBe('errors.separationOfDuties')
    expect(getAdminRetryAfterSeconds({ retryAfterMs: 1_001 })).toBe(2)
  })

  it('requires fresh assurance only for sensitive question commands', () => {
    expect(getFreshAssuranceReasonCode('PUBLISH')).toBe('QUESTION_PUBLISH')
    expect(getFreshAssuranceReasonCode('ARCHIVE')).toBe('QUESTION_ARCHIVE')
    expect(getFreshAssuranceReasonCode('REQUEST_REVIEW')).toBeNull()
    expect(getFreshAssuranceReasonCode('CREATE_VERSION')).toBeNull()
  })
})
