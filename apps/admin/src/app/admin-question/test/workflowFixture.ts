import {
  getAdminQuestionResponseSchema,
  adminQuestionVersionSummarySchema,
  previewQuestionVersionResponseSchema
} from '@nihongo/contracts/admin/phase7'
import {
  detail,
  preview,
  actorId,
  versionId,
  createReceipt
} from '@app/admin-question/test/questionFixture'
export { actorId, versionId, createReceipt }
export const questionId = detail.question.questionId
export const oldVersionId = '10000000-0000-4000-8000-000000000005'
export const reviewerId = '10000000-0000-4000-8000-000000000006'
export const actor = (id = actorId) => ({
  id,
  name: 'Admin',
  role: 'ADMIN' as const,
  targetLevel: 'N3' as const
})
export const newer = adminQuestionVersionSummarySchema.parse({
  ...detail.versions.items[0]!,
  versionNumber: 2
})
export const older = adminQuestionVersionSummarySchema.parse({
  ...newer,
  questionVersionId: oldVersionId,
  versionNumber: 1,
  versionStatus: 'PUBLISHED',
  publishedAt: newer.createdAt
})
export const initial = getAdminQuestionResponseSchema.parse({
  ...detail,
  question: { ...detail.question, currentPublishedVersionId: oldVersionId },
  versions: { ...detail.versions, items: [newer, older] }
})
export const previewFor = (id = versionId) =>
  previewQuestionVersionResponseSchema.parse({
    ...preview,
    question: {
      ...preview.question,
      questionVersionId: id,
      questionText: id === oldVersionId ? 'Older question' : 'Current question'
    }
  })
export const emptyDiff = {
  baseVersionId: oldVersionId,
  targetVersionId: versionId,
  changedFields: [],
  changes: []
}
export const reviewer = {
  kind: 'ACCOUNT' as const,
  actorId: reviewerId,
  role: 'ADMIN' as const,
  label: 'ACTIVE_ADMIN' as const
}
