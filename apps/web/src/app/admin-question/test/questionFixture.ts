import {
  adminQuestionSummarySchema,
  getAdminQuestionResponseSchema,
  previewQuestionVersionResponseSchema,
  createAdminQuestionRequestSchema,
  updateQuestionVersionRequestSchema,
  archiveAdminQuestionRequestSchema
} from '@nihongo/contracts/admin/phase7'
export const actorId = '10000000-0000-4000-8000-000000000003'
const questionId = '10000000-0000-4000-8000-000000000001'
export const versionId = '10000000-0000-4000-8000-000000000002'
const createdAt = '2026-10-01T00:00:00.000Z'
const author = {
  kind: 'ACCOUNT',
  actorId,
  role: 'ADMIN',
  label: 'ACTIVE_ADMIN'
} as const
const tag = {
  id: '10000000-0000-4000-8000-000000000004',
  label: '문법',
  normalizedName: '문법'
}
export const question = adminQuestionSummarySchema.parse({
  questionId,
  selectedVersionId: versionId,
  currentPublishedVersionId: null,
  openCandidateVersionId: versionId,
  versionNumber: 1,
  lifecycleStatus: 'ACTIVE',
  versionStatus: 'DRAFT',
  retirementKind: null,
  questionRowVersion: 1,
  versionRowVersion: 1,
  level: 'N3',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  difficulty: 'NORMAL',
  questionTextPreview: '（　）に入る表現を選んでください。',
  tags: [tag],
  author,
  latestReviewer: null,
  createdAt,
  updatedAt: createdAt,
  answerCount: 0,
  correctRateBasisPoints: null,
  openReportCount: 0
})
export const preview = previewQuestionVersionResponseSchema.parse({
  question: {
    id: questionId,
    questionVersionId: versionId,
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: null,
    questionText: question.questionTextPreview,
    options: ['ので', 'のに', 'まで', 'しか'].map((text, index) => ({
      id: `20000000-0000-4000-8000-00000000000${index + 1}`,
      label: String(index + 1),
      text
    })),
    difficulty: question.difficulty,
    tags: [{ id: tag.id, label: tag.label }]
  },
  adminAnswer: {
    correctOptionId: '20000000-0000-4000-8000-000000000001',
    explanationKo: '이유를 나타내는 표현입니다.',
    explanationJa: null
  }
})
export const detail = getAdminQuestionResponseSchema.parse({
  question: {
    questionId,
    lifecycleStatus: 'ACTIVE',
    rowVersion: 1,
    currentPublishedVersionId: null,
    openCandidateVersionId: versionId,
    createdAt,
    updatedAt: createdAt
  },
  versions: {
    questionId,
    items: [
      {
        questionVersionId: versionId,
        versionNumber: 1,
        versionStatus: 'DRAFT',
        retirementKind: null,
        rowVersion: 1,
        provenance: 'ADMIN_AUTHORED',
        level: question.level,
        subject: question.subject,
        questionType: question.questionType,
        difficulty: question.difficulty,
        questionTextPreview: question.questionTextPreview,
        tags: [tag],
        author,
        latestReviewer: null,
        publishedAt: null,
        retiredAt: null,
        createdAt,
        updatedAt: createdAt
      }
    ],
    nextCursor: null
  },
  auditSummary: {
    lastCommand: null,
    lastActor: null,
    lastOccurredAt: null,
    totalCount: 0
  }
})
export const createInput = createAdminQuestionRequestSchema.parse({
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  difficulty: question.difficulty,
  questionText: preview.question.questionText,
  passage: null,
  explanationKo: preview.adminAnswer.explanationKo,
  explanationJa: null,
  tagNames: ['문법'],
  options: preview.question.options.map(({ label, text }) => ({
    clientOptionKey: label,
    text
  })),
  correctOptionKey: '1'
})
const {
  options: _options,
  correctOptionKey: _correct,
  ...content
} = createInput
export const input = updateQuestionVersionRequestSchema.parse({
  ...content,
  expectedRowVersion: 1,
  options: preview.question.options.map(({ id, text }, index) => ({
    id,
    text,
    ordinal: index + 1
  })),
  correctOptionId: preview.adminAnswer.correctOptionId
})
export const archiveInput = archiveAdminQuestionRequestSchema.parse({
  expectedQuestionRowVersion: 1,
  expectedOpenCandidateVersionId: versionId,
  expectedOpenCandidateRowVersion: 1
})
export const createReceipt = {
  questionId,
  questionVersionId: versionId,
  lifecycleStatus: 'ACTIVE',
  versionStatus: 'DRAFT',
  questionRowVersion: 1,
  versionRowVersion: 1,
  occurredAt: createdAt
} as const
export const updateReceipt = { ...createReceipt, versionRowVersion: 2 }
export const archiveReceipt = {
  ...createReceipt,
  lifecycleStatus: 'ARCHIVED',
  questionRowVersion: 2,
  questionVersionId: null,
  versionStatus: null,
  versionRowVersion: null
} as const
