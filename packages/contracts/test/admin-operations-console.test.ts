import { describe, expect, it } from 'vitest'
import { listAdminActivityResponseSchema } from '../src/admin/audit.js'
import {
  adminMemberDetailSchema,
  listAdminMembersQuerySchema
} from '../src/admin/members.js'
import { saveAdminReportNoteRequestSchema } from '../src/admin/reports.js'
import {
  completeQuestionReviewRequestSchema,
  publishQuestionVersionBatchRequestSchema,
  publishQuestionVersionBatchResponseSchema
} from '../src/admin/review.js'
import { getCurrentPrincipalResponseSchema } from '../src/auth/get-current-principal.js'
import { errorStatusByCode } from '../src/common/error.js'
import {
  createReportRequestSchema,
  myReportSchema
} from '../src/report/reports.js'

const id = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const iso = '2026-11-03T00:00:00.000Z'

describe('admin members', () => {
  it('defaults to joinedAt desc, page 1, pageSize 25', () => {
    expect(listAdminMembersQuerySchema.parse({})).toEqual({
      sort: 'joinedAt',
      order: 'desc',
      page: 1,
      pageSize: 25
    })
  })

  it('accepts only 25, 50 or 100 per page and known sort fields', () => {
    expect(listAdminMembersQuerySchema.parse({ pageSize: '50' }).pageSize).toBe(
      50
    )
    expect(
      listAdminMembersQuerySchema.safeParse({ pageSize: 20 }).success
    ).toBe(false)
    expect(
      listAdminMembersQuerySchema.safeParse({ sort: 'email' }).success
    ).toBe(false)
  })

  it('normalizes the exact email query', () => {
    expect(
      listAdminMembersQuerySchema.parse({ email: '  Mina@Example.com ' }).email
    ).toBe('mina@example.com')
  })

  it('keeps restriction fields consistent with status', () => {
    const member = {
      memberId: id(1),
      maskedEmail: 'mi****@e******.com',
      joinedAt: iso,
      lastStudiedAt: null,
      solvedCount: 0,
      reportCount: 0,
      status: 'ACTIVE',
      rowVersion: 1,
      restrictedAt: null,
      restrictionReason: null
    }
    expect(adminMemberDetailSchema.safeParse(member).success).toBe(true)
    expect(
      adminMemberDetailSchema.safeParse({ ...member, status: 'RESTRICTED' })
        .success
    ).toBe(false)
  })
})

describe('question review', () => {
  it('requires all three checks to complete a review', () => {
    const checks = {
      answerChecked: true,
      explanationChecked: true,
      levelAndTagsChecked: true
    }
    expect(
      completeQuestionReviewRequestSchema.safeParse({
        expectedRowVersion: 1,
        checks
      }).success
    ).toBe(true)
    expect(
      completeQuestionReviewRequestSchema.safeParse({
        expectedRowVersion: 1,
        checks: { ...checks, explanationChecked: false }
      }).success
    ).toBe(false)
  })

  it('rejects duplicate batch items and a wrong published count', () => {
    const item = { questionVersionId: id(2), expectedRowVersion: 3 }
    expect(
      publishQuestionVersionBatchRequestSchema.safeParse({
        items: [item, item]
      }).success
    ).toBe(false)
    expect(
      publishQuestionVersionBatchResponseSchema.safeParse({
        publishedCount: 1,
        items: [
          {
            questionVersionId: id(2),
            result: 'VERSION_CONFLICT',
            rowVersion: 4
          }
        ]
      }).success
    ).toBe(false)
  })
})

describe('reports', () => {
  it('requires question ids only for question reports', () => {
    const base = { location: '/practice', description: '정답이 이상해요.' }
    expect(
      createReportRequestSchema.safeParse({ ...base, kind: 'APP_ERROR' })
        .success
    ).toBe(true)
    expect(
      createReportRequestSchema.safeParse({ ...base, kind: 'QUESTION' }).success
    ).toBe(false)
    expect(
      createReportRequestSchema.safeParse({
        ...base,
        kind: 'APP_ERROR',
        questionId: id(3),
        questionVersionId: id(4)
      }).success
    ).toBe(false)
  })

  it('never exposes the internal note to the reporter', () => {
    const report = {
      reportId: id(5),
      kind: 'APP_ERROR',
      createdAt: iso,
      status: 'ANSWERED',
      reporterReply: '고쳤어요.',
      repliedAt: iso
    }
    expect(myReportSchema.safeParse(report).success).toBe(true)
    expect(
      myReportSchema.safeParse({ ...report, internalNote: '비공개' }).success
    ).toBe(false)
  })

  it('allows an empty note to clear it', () => {
    expect(
      saveAdminReportNoteRequestSchema.safeParse({
        expectedRowVersion: 1,
        internalNote: ''
      }).success
    ).toBe(true)
  })
})

describe('session and errors', () => {
  it('gives only admins a session expiry time', () => {
    const user = { id: id(6), name: '관리자', targetLevel: null }
    expect(
      getCurrentPrincipalResponseSchema.safeParse({
        kind: 'USER',
        user: {
          ...user,
          role: 'ADMIN',
          adminSessionExpiresAt: iso,
          adminFreshUntil: null
        }
      }).success
    ).toBe(true)
    expect(
      getCurrentPrincipalResponseSchema.safeParse({
        kind: 'USER',
        user: { ...user, role: 'ADMIN', adminSessionExpiresAt: iso }
      }).success
    ).toBe(false)
    expect(
      getCurrentPrincipalResponseSchema.safeParse({
        kind: 'USER',
        user: { ...user, role: 'USER', adminFreshUntil: null }
      }).success
    ).toBe(false)
    expect(
      getCurrentPrincipalResponseSchema.safeParse({
        kind: 'USER',
        user: { ...user, role: 'USER', adminSessionExpiresAt: iso }
      }).success
    ).toBe(false)
  })

  it('carries the server clock to admins only (#683)', () => {
    const user = { id: id(6), name: '관리자', targetLevel: null }
    const admin = {
      ...user,
      role: 'ADMIN',
      adminSessionExpiresAt: iso,
      adminFreshUntil: iso
    }
    expect(
      getCurrentPrincipalResponseSchema.safeParse({
        kind: 'USER',
        user: { ...admin, adminServerTime: iso }
      }).success
    ).toBe(true)
    expect(
      getCurrentPrincipalResponseSchema.safeParse({
        kind: 'USER',
        user: { ...user, role: 'USER', adminServerTime: iso }
      }).success
    ).toBe(false)
    expect(
      getCurrentPrincipalResponseSchema.safeParse({
        kind: 'USER',
        user: { ...admin, adminServerTime: 'now' }
      }).success
    ).toBe(false)
  })

  it('maps ACCOUNT_RESTRICTED to 403', () => {
    expect(errorStatusByCode.ACCOUNT_RESTRICTED).toBe(403)
  })

  it('keeps the activity log free of row versions and changed fields', () => {
    expect(
      listAdminActivityResponseSchema.safeParse({
        items: [
          {
            occurredAt: iso,
            action: 'PUBLISH',
            targetLabel: '문항 1',
            targetId: id(7),
            result: 'SUCCESS',
            changedFields: ['questionText']
          }
        ],
        nextCursor: null
      }).success
    ).toBe(false)
  })
})
