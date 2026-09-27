import { createHash } from 'node:crypto'
import {
  assertAdminAuditContentDigest,
  adminQuestionVersionChangeSchema,
  encodeAdminQuestionVersionCursor,
  encodePhase7OccurredAtCursor,
  type AdminQuestionSummary,
  type AdminQuestionVersionSummary,
  type DiffQuestionVersionQuery,
  type DiffQuestionVersionResponse,
  type GetAdminQuestionResponse,
  listAdminAuditLogResponseSchema,
  type ListAdminAuditLogQuery,
  type ListAdminAuditLogResponse,
  type ListAdminQuestionsQuery,
  type ListAdminQuestionsResponse,
  type ListAdminQuestionVersionsQuery,
  type ListAdminQuestionVersionsResponse,
  type ListAdminTagsQuery,
  type ListAdminTagsResponse,
  type ListQuestionVersionReviewsQuery,
  type ListQuestionVersionReviewsResponse,
  type PreviewQuestionVersionResponse,
  decodeAdminQuestionVersionCursor,
  decodePhase7OccurredAtCursor
} from '@nihongo/contracts/admin/phase7'
import { toPublicPracticeQuestion } from '../question/questionMapper.js'
import { ApplicationError } from '../errors/applicationError.js'
import {
  AdminQuestionRepositoryIntegrityError,
  AdminQuestionRepositoryUnavailableError,
  type AdminAccountActorRecord,
  type AdminQuestionListRecord,
  type AdminQuestionRepository,
  type AdminTagRecord,
  type AdminVersionRecord,
  type AdminVersionSummaryRecord
} from './adminQuestionRepository.js'

const adminAuditDigestPort = {
  digestUtf8: async (value: string): Promise<string> =>
    createHash('sha256').update(value, 'utf8').digest('hex')
}

const QUESTION_PREVIEW_MAX_LENGTH = 160

const toIso = (value: Date): string => value.toISOString()

const createQuestionTextPreview = (value: string): string => {
  const scalars = [...value.replaceAll('\n', ' ')]
  return scalars.length <= QUESTION_PREVIEW_MAX_LENGTH
    ? scalars.join('')
    : `${scalars.slice(0, QUESTION_PREVIEW_MAX_LENGTH - 3).join('')}...`
}

const toAuthor = (
  version: AdminVersionSummaryRecord
): AdminAccountActorRecord | null => {
  if (version.createdByLabelSnapshot === 'SYSTEM_SEED') {
    if (
      version.createdByActorId !== null ||
      version.createdByRoleSnapshot !== null
    ) {
      throw new AdminQuestionRepositoryIntegrityError(
        'System seed version has account creator evidence.'
      )
    }
    return null
  }
  if (!version.createdByActorId || version.createdByRoleSnapshot !== 'ADMIN') {
    throw new AdminQuestionRepositoryIntegrityError(
      'Admin-authored version has incomplete creator evidence.'
    )
  }
  return {
    kind: 'ACCOUNT',
    actorId: version.createdByActorId,
    role: 'ADMIN',
    label: version.createdByLabelSnapshot
  }
}

const toVersionSummary = (
  version: AdminVersionSummaryRecord
): AdminQuestionVersionSummary => {
  const author = toAuthor(version)
  return {
    questionVersionId: version.id,
    versionNumber: version.versionNumber,
    versionStatus: version.status,
    retirementKind: version.retirementKind,
    rowVersion: version.rowVersion,
    provenance: author ? 'ADMIN_AUTHORED' : 'SYSTEM_SEED',
    level: version.level,
    subject: version.subject,
    questionType: version.questionType,
    difficulty: version.difficulty,
    questionTextPreview: createQuestionTextPreview(version.questionText),
    tags: [...version.tags],
    author,
    latestReviewer: version.latestReviewer,
    publishedAt: version.publishedAt ? toIso(version.publishedAt) : null,
    retiredAt: version.retiredAt ? toIso(version.retiredAt) : null,
    createdAt: toIso(version.createdAt),
    updatedAt: toIso(version.updatedAt)
  }
}

const calculateCorrectRate = (
  answerCount: number,
  correctCount: number
): number | null => {
  if (answerCount === 0) return null
  const answer = BigInt(answerCount)
  const numerator = BigInt(correctCount) * 10_000n
  return Number((numerator * 2n + answer) / (answer * 2n))
}

const toQuestionSummary = (
  record: AdminQuestionListRecord
): AdminQuestionSummary => ({
  questionId: record.questionId,
  selectedVersionId: record.selectedVersion.id,
  currentPublishedVersionId: record.currentPublishedVersionId,
  openCandidateVersionId: record.openCandidateVersionId,
  versionNumber: record.selectedVersion.versionNumber,
  lifecycleStatus: record.lifecycleStatus,
  versionStatus: record.selectedVersion.status,
  retirementKind: record.selectedVersion.retirementKind,
  questionRowVersion: record.questionRowVersion,
  versionRowVersion: record.selectedVersion.rowVersion,
  level: record.selectedVersion.level,
  subject: record.selectedVersion.subject,
  questionType: record.selectedVersion.questionType,
  difficulty: record.selectedVersion.difficulty,
  questionTextPreview: createQuestionTextPreview(
    record.selectedVersion.questionText
  ),
  tags: [...record.selectedVersion.tags],
  author: toAuthor(record.selectedVersion),
  latestReviewer: record.selectedVersion.latestReviewer,
  createdAt: toIso(record.questionCreatedAt),
  updatedAt: toIso(record.selectedVersion.updatedAt),
  answerCount: record.answerCount,
  correctRateBasisPoints: calculateCorrectRate(
    record.answerCount,
    record.correctCount
  ),
  openReportCount: record.openReportCount
})

const toDate = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value)

const throwNotFound = (message: string): never => {
  throw new ApplicationError({
    code: 'RESOURCE_NOT_FOUND',
    message,
    retryable: false
  })
}

const withRepositoryErrors = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof ApplicationError) throw error
    if (error instanceof AdminQuestionRepositoryUnavailableError) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 문제 조회 저장소에 연결할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        cause: error
      })
    }
    if (error instanceof AdminQuestionRepositoryIntegrityError) {
      throw new ApplicationError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '관리자 문제 조회 무결성을 확인할 수 없습니다.',
        retryable: true,
        cause: error
      })
    }
    throw error
  }
}

const optionDiffValue = (version: AdminVersionRecord) =>
  version.options.map((option) => ({
    ordinal: option.ordinal,
    text: option.text,
    isCorrect: option.id === version.correctOptionId
  }))

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const toVersionDiff = (
  base: AdminVersionRecord,
  target: AdminVersionRecord
): DiffQuestionVersionResponse => {
  const scalarPairs = [
    ['LEVEL', base.level, target.level],
    ['SUBJECT', base.subject, target.subject],
    ['QUESTION_TYPE', base.questionType, target.questionType],
    ['DIFFICULTY', base.difficulty, target.difficulty],
    ['PASSAGE', base.passage, target.passage],
    ['QUESTION_TEXT', base.questionText, target.questionText],
    ['EXPLANATION_KO', base.explanationKo, target.explanationKo],
    ['EXPLANATION_JA', base.explanationJa, target.explanationJa]
  ] as const
  const changes: DiffQuestionVersionResponse['changes'] = []
  for (const [field, before, after] of scalarPairs) {
    if (before !== after) {
      changes.push(
        adminQuestionVersionChangeSchema.parse({
          field,
          kind: 'SCALAR',
          before,
          after
        })
      )
    }
  }
  const beforeOptions = optionDiffValue(base)
  const afterOptions = optionDiffValue(target)
  if (!same(beforeOptions, afterOptions)) {
    changes.push({
      field: 'OPTIONS',
      kind: 'OPTIONS',
      before: beforeOptions,
      after: afterOptions
    })
  }
  if (!same(base.tags, target.tags)) {
    changes.push({
      field: 'TAGS',
      kind: 'TAGS',
      before: [...base.tags],
      after: [...target.tags]
    })
  }
  return {
    baseVersionId: base.id,
    targetVersionId: target.id,
    changedFields: changes.map((change) => change.field),
    changes
  }
}

export interface AdminQuestionReader {
  listQuestions: (
    query: ListAdminQuestionsQuery
  ) => Promise<ListAdminQuestionsResponse>
  getQuestion: (questionId: string) => Promise<GetAdminQuestionResponse>
  listVersions: (
    questionId: string,
    query: ListAdminQuestionVersionsQuery
  ) => Promise<ListAdminQuestionVersionsResponse>
  previewVersion: (versionId: string) => Promise<PreviewQuestionVersionResponse>
  diffVersion: (
    versionId: string,
    query: DiffQuestionVersionQuery
  ) => Promise<DiffQuestionVersionResponse>
  listTags: (query: ListAdminTagsQuery) => Promise<ListAdminTagsResponse>
  listReviews: (
    versionId: string,
    query: ListQuestionVersionReviewsQuery
  ) => Promise<ListQuestionVersionReviewsResponse>
  listAuditLog: (
    query: ListAdminAuditLogQuery
  ) => Promise<ListAdminAuditLogResponse>
}

export const createAdminQuestionService = (
  repository: AdminQuestionRepository
): AdminQuestionReader => ({
  listQuestions: (query) =>
    withRepositoryErrors(async () => {
      const result = await repository.listQuestions({
        ...(query.q ? { q: query.q } : {}),
        ...(query.level ? { level: query.level } : {}),
        ...(query.subject ? { subject: query.subject } : {}),
        ...(query.questionType ? { questionType: query.questionType } : {}),
        ...(query.difficulty ? { difficulty: query.difficulty } : {}),
        ...(query.lifecycleStatus
          ? { lifecycleStatus: query.lifecycleStatus }
          : {}),
        ...(query.versionStatus ? { versionStatus: query.versionStatus } : {}),
        ...(query.tag ? { normalizedTag: query.tag } : {}),
        ...(query.authorActorId ? { authorActorId: query.authorActorId } : {}),
        ...(query.reviewerActorId
          ? { reviewerActorId: query.reviewerActorId }
          : {}),
        ...(query.createdFrom
          ? { createdFrom: toDate(query.createdFrom)! }
          : {}),
        ...(query.createdTo ? { createdTo: toDate(query.createdTo)! } : {}),
        ...(query.updatedFrom
          ? { updatedFrom: toDate(query.updatedFrom)! }
          : {}),
        ...(query.updatedTo ? { updatedTo: toDate(query.updatedTo)! } : {}),
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize
      })
      return {
        items: result.items.map(toQuestionSummary),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total
      }
    }),
  getQuestion: (questionId) =>
    withRepositoryErrors(async () => {
      const detail = await repository.getQuestion(questionId)
      if (!detail) return throwNotFound('관리자 문제를 찾을 수 없습니다.')
      const items = detail.versions.map(toVersionSummary)
      return {
        question: {
          questionId: detail.questionId,
          lifecycleStatus: detail.lifecycleStatus,
          rowVersion: detail.rowVersion,
          currentPublishedVersionId: detail.currentPublishedVersionId,
          openCandidateVersionId: detail.openCandidateVersionId,
          createdAt: toIso(detail.createdAt),
          updatedAt: toIso(detail.updatedAt)
        },
        versions: {
          questionId: detail.questionId,
          items,
          nextCursor:
            detail.hasMoreVersions && items.length > 0
              ? encodeAdminQuestionVersionCursor({
                  versionNumber: items.at(-1)!.versionNumber,
                  id: items.at(-1)!.questionVersionId
                })
              : null
        },
        auditSummary: {
          lastCommand: detail.auditSummary.lastCommand,
          lastActor: detail.auditSummary.lastActor,
          lastOccurredAt: detail.auditSummary.lastOccurredAt
            ? toIso(detail.auditSummary.lastOccurredAt)
            : null,
          totalCount: detail.auditSummary.totalCount
        }
      }
    }),
  listVersions: (questionId, query) =>
    withRepositoryErrors(async () => {
      const cursor = query.cursor
        ? decodeAdminQuestionVersionCursor(query.cursor)
        : undefined
      const records = await repository.listVersions({
        questionId,
        ...(cursor
          ? { cursor: { versionNumber: cursor.versionNumber, id: cursor.id } }
          : {}),
        limit: query.limit
      })
      if (!records) return throwNotFound('관리자 문제를 찾을 수 없습니다.')
      const hasMore = records.length > query.limit
      const items = records.slice(0, query.limit).map(toVersionSummary)
      return {
        questionId,
        items,
        nextCursor:
          hasMore && items.length > 0
            ? encodeAdminQuestionVersionCursor({
                versionNumber: items.at(-1)!.versionNumber,
                id: items.at(-1)!.questionVersionId
              })
            : null
      }
    }),
  previewVersion: (versionId) =>
    withRepositoryErrors(async () => {
      const version = await repository.findVersion(versionId)
      if (!version) return throwNotFound('문제 버전을 찾을 수 없습니다.')
      return {
        question: toPublicPracticeQuestion({
          id: version.questionId,
          questionVersionId: version.id,
          level: version.level,
          subject: version.subject,
          questionType: version.questionType,
          passage: version.passage,
          questionText: version.questionText,
          options: version.options.map(({ id, label, text }) => ({
            id,
            label,
            text
          })),
          difficulty: version.difficulty,
          tags: version.tags.map(({ id, label }) => ({ id, label }))
        }),
        adminAnswer: {
          correctOptionId: version.correctOptionId,
          explanationKo: version.explanationKo,
          explanationJa: version.explanationJa
        }
      }
    }),
  diffVersion: (versionId, query) =>
    withRepositoryErrors(async () => {
      const pair = await repository.findVersionPair({
        targetVersionId: versionId,
        baseVersionId: query.baseVersionId
      })
      return pair
        ? toVersionDiff(pair.base, pair.target)
        : throwNotFound('비교할 문제 버전을 찾을 수 없습니다.')
    }),
  listTags: (query) =>
    withRepositoryErrors(async () => ({
      items: [
        ...(await repository.listTags({
          normalizedPrefix: query.q,
          limit: query.limit
        }))
      ] as AdminTagRecord[]
    })),
  listReviews: (versionId, query) =>
    withRepositoryErrors(async () => {
      const cursor = query.cursor
        ? decodePhase7OccurredAtCursor(query.cursor)
        : undefined
      const result = await repository.listReviews({
        versionId,
        ...(cursor
          ? {
              cursor: { occurredAt: new Date(cursor.occurredAt), id: cursor.id }
            }
          : {}),
        limit: query.limit
      })
      if (!result) return throwNotFound('문제 버전을 찾을 수 없습니다.')
      const hasMore = result.items.length > query.limit
      const items = result.items.slice(0, query.limit).map((item) => ({
        ...item,
        occurredAt: toIso(item.occurredAt)
      }))
      return {
        questionVersionId: versionId,
        items,
        nextCursor:
          hasMore && items.length > 0
            ? encodePhase7OccurredAtCursor({
                id: items.at(-1)!.id,
                occurredAt: items.at(-1)!.occurredAt
              })
            : null
      }
    }),
  listAuditLog: (query) =>
    withRepositoryErrors(async () => {
      const cursor = query.cursor
        ? decodePhase7OccurredAtCursor(query.cursor)
        : undefined
      const records = await repository.listAuditLog({
        ...(query.command ? { command: query.command } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.environment ? { environment: query.environment } : {}),
        ...(query.occurredFrom
          ? { occurredFrom: new Date(query.occurredFrom) }
          : {}),
        ...(query.occurredTo ? { occurredTo: new Date(query.occurredTo) } : {}),
        ...(cursor
          ? {
              cursor: { occurredAt: new Date(cursor.occurredAt), id: cursor.id }
            }
          : {}),
        limit: query.limit
      })
      const hasMore = records.length > query.limit
      const items = records.slice(0, query.limit).map((item) => ({
        ...item,
        occurredAt: toIso(item.occurredAt)
      }))
      const response = listAdminAuditLogResponseSchema.parse({
        items,
        nextCursor:
          hasMore && items.length > 0
            ? encodePhase7OccurredAtCursor({
                id: items.at(-1)!.id,
                occurredAt: items.at(-1)!.occurredAt
              })
            : null
      })
      await Promise.all(
        response.items.map((item) =>
          assertAdminAuditContentDigest(adminAuditDigestPort, item)
        )
      )
      return response
    })
})
