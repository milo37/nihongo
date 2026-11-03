import {
  adminReportDetailSchema,
  type AdminReportDetail
} from '@nihongo/contracts/admin/reports'

export const actorId = '10000000-0000-4000-8000-000000000001'
export const reportId = '10000000-0000-4000-8000-000000000002'
export const questionId = '10000000-0000-4000-8000-000000000003'
export const versionId = '10000000-0000-4000-8000-000000000004'
export const memberId = '8f2c41aa-0000-4000-8000-000000000005'

export const adminActor = () => ({
  id: actorId,
  name: '관리자',
  role: 'ADMIN' as const,
  targetLevel: 'N3' as const
})

export const reportDetail = (
  overrides: Partial<AdminReportDetail> = {}
): AdminReportDetail =>
  adminReportDetailSchema.parse({
    reportId,
    kind: 'QUESTION',
    status: 'RECEIVED',
    location: 'result#2',
    questionId,
    questionVersionId: versionId,
    description: '정답이 두 개처럼 보여요\n2번과 4번 둘 다 맞는 것 같습니다.',
    reporterMemberId: memberId,
    createdAt: '2026-11-01T12:14:00Z',
    rowVersion: 1,
    reporterReply: null,
    repliedAt: null,
    internalNote: null,
    closedAt: null,
    updatedAt: '2026-11-01T12:14:00Z',
    ...overrides
  })

export const reportSummary = (detail: AdminReportDetail = reportDetail()) => {
  const {
    description,
    reporterReply: _reply,
    repliedAt: _repliedAt,
    internalNote: _note,
    closedAt: _closedAt,
    updatedAt: _updatedAt,
    ...summary
  } = detail
  return { ...summary, descriptionPreview: description.slice(0, 160) }
}
