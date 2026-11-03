import { describe, expect, it } from 'vitest'
import * as legacy from '../src/legacy/browser-schema.js'

// Export names of the former packages/browser/src/api/schema.ts (#495).
const legacyExportNames = [
  'adminQuestionSummarySchema',
  'bookmarkSchema',
  'dailyStudyCountSchema',
  'dashboardStatsSchema',
  'idParamsSchema',
  'isoDateTimeSchema',
  'jlptLevelSchema',
  'practiceQuestionOptionSchema',
  'practiceQuestionSchema',
  'questionDifficultySchema',
  'questionEditorInputSchema',
  'questionOptionRecordSchema',
  'questionRecordSchema',
  'questionStatusSchema',
  'questionSubjectSchema',
  'questionTypeSchema',
  'recentStudySessionSchema',
  'repeatedWrongQuestionSchema',
  'studyAnswerInputSchema',
  'studyModeSchema',
  'studyResultItemSchema',
  'studyResultSchema',
  'studySessionSchema',
  'studySessionStatusSchema',
  'subjectStatSchema',
  'successResponseSchema',
  'userRoleSchema',
  'userSchema',
  'wrongNoteSchema',
  'wrongNoteStatusSchema'
]

describe('legacy browser schema', () => {
  it('keeps every former export name', () => {
    expect(Object.keys(legacy).sort()).toEqual(legacyExportNames)
  })

  it('keeps the legacy-only differences', () => {
    expect(legacy.studySessionStatusSchema.options).toEqual([
      'IN_PROGRESS',
      'SUBMITTED'
    ])
    expect(legacy.userRoleSchema.options).toContain('GUEST')
    expect(legacy.isoDateTimeSchema.parse('2026-11-03T00:00:00Z')).toBe(
      '2026-11-03T00:00:00Z'
    )
  })
})
