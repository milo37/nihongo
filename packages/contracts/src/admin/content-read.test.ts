import { describe, expect, it } from 'vitest'
import {
  adminAuditEnvironmentSchema,
  adminPassageGroupSchema,
  listAdminAuditLogQuerySchema
} from './content-read.js'

describe('Admin read transport', () => {
  it('accepts the canonical production audit environment', () => {
    expect(adminAuditEnvironmentSchema.options).toEqual([
      'TEST',
      'DEVELOPMENT',
      'PRODUCTION'
    ])
    expect(
      listAdminAuditLogQuerySchema.parse({ environment: 'PRODUCTION' })
    ).toEqual({ environment: 'PRODUCTION', limit: 20 })
  })

  it('pairs an open version with its status in a passage group (#1196)', () => {
    const question = {
      questionId: '00000000-0000-4000-8000-000000000001',
      questionRowVersion: 2,
      passageOrder: 1,
      level: 'N5',
      questionType: 'SHORT_READING',
      questionTextPreview: '本文の内容に合うものを選んでください。',
      openVersionId: '00000000-0000-4000-8000-000000000002',
      openVersionStatus: 'DRAFT'
    }
    const group = {
      passageId: '00000000-0000-4000-8000-000000000003',
      questions: [question],
      editing: false
    }
    expect(adminPassageGroupSchema.parse(group)).toEqual(group)
    for (const changed of [
      { openVersionStatus: null },
      { openVersionId: null },
      { openVersionStatus: 'PUBLISHED' }
    ])
      expect(
        adminPassageGroupSchema.safeParse({
          ...group,
          questions: [{ ...question, ...changed }]
        }).success
      ).toBe(false)
  })
})
