import type { AdminQuestionExportAuditEvidence } from './adminQuestionWorkflowRepository.js'
import {
  canonicalizeJson,
  type CanonicalJsonValue,
  type ExportAdminQuestionsRequest
} from '@nihongo/contracts/admin/content-operations'

import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { type AuditEnvironment, toIso } from './adminRepositoryCommon.js'
import {
  AdminQuestionCommandRepositoryError,
  repositoryFailure
} from './adminQuestionCommandRepository.js'

import {
  type ExportQuestionRow,
  type ExportVersionRow,
  type ExportVersionManifestRow,
  type ExportOptionRow,
  type ExportTagRow,
  type ExportReviewUserRow,
  type ExportRetainedManifestRow,
  type ExportAuditReconciliationRow,
  EXPORT_BODY_CAP,
  EXPORT_VERSION_BATCH_SIZE
} from './adminQuestionWorkflowModel.js'
import { repositoryInvariantFailure } from './adminQuestionWorkflowTransactions.js'

export const exportTooLargeFailure = (): AdminQuestionCommandRepositoryError =>
  repositoryFailure(
    'VALIDATION_ERROR',
    '선택한 문제의 내보내기 결과가 8 MiB를 초과합니다.',
    { questionIds: ['더 작은 문제 묶음으로 나누어 내보내 주세요.'] }
  )

export class BoundedExportBody {
  #buffer: Buffer | null = Buffer.allocUnsafe(EXPORT_BODY_CAP)
  #byteLength = 0

  append(fragment: string): void {
    const bytes = Buffer.from(fragment, 'utf8')
    const nextLength = this.#byteLength + bytes.byteLength
    if (nextLength > EXPORT_BODY_CAP) throw exportTooLargeFailure()
    if (!this.#buffer) {
      throw repositoryInvariantFailure('Export body was already finalized.')
    }
    bytes.copy(this.#buffer, this.#byteLength)
    this.#byteLength = nextLength
  }

  value(): string {
    if (!this.#buffer) {
      throw repositoryInvariantFailure('Export body was already finalized.')
    }
    const value = this.#buffer.toString('utf8', 0, this.#byteLength)
    this.#buffer = null
    return value
  }
}

export const loadExportReferencedUsers = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionIds: readonly string[]
): Promise<ExportReviewUserRow[]> =>
  client.$queryRawUnsafe<ExportReviewUserRow[]>(
    `SELECT DISTINCT live_user."userId"
     FROM (
       SELECT question."createdByUserId" AS "userId"
       FROM "Question" AS question
       WHERE question."id" = ANY($1::uuid[])
       UNION
       SELECT version."createdByUserId" AS "userId"
       FROM "QuestionVersion" AS version
       WHERE version."questionId" = ANY($1::uuid[])
       UNION
       SELECT review."actorUserId" AS "userId"
       FROM "ContentReview" AS review
       JOIN "QuestionVersion" AS version
         ON version."id" = review."questionVersionId"
       WHERE version."questionId" = ANY($1::uuid[])
       UNION
       SELECT review."counterpartUserId" AS "userId"
       FROM "ContentReview" AS review
       JOIN "QuestionVersion" AS version
         ON version."id" = review."questionVersionId"
       WHERE version."questionId" = ANY($1::uuid[])
     ) AS live_user
     WHERE live_user."userId" IS NOT NULL
     ORDER BY live_user."userId"`,
    questionIds
  )

export const loadExportQuestions = async (
  transaction: Prisma.TransactionClient,
  questionIds: readonly string[]
): Promise<ExportQuestionRow[]> =>
  transaction.$queryRawUnsafe<ExportQuestionRow[]>(
    `SELECT "id", "lifecycleStatus", "currentPublishedVersionId",
       "rowVersion", "createdByUserId"
     FROM "Question" WHERE "id" = ANY($1::uuid[])
     ORDER BY "id"`,
    questionIds
  )

export const loadExportVersionPage = async (
  transaction: Prisma.TransactionClient,
  questionId: string,
  cursor: Pick<ExportVersionRow, 'id' | 'versionNumber'> | null
): Promise<ExportVersionRow[]> =>
  transaction.$queryRawUnsafe<ExportVersionRow[]>(
    `SELECT "id", "questionId", "versionNumber", "status", "rowVersion",
       "createdByUserId", "level", "subject", "questionType", "difficulty",
       "passage", "questionText", "explanationKo", "explanationJa",
       "correctOptionId"
     FROM "QuestionVersion"
     WHERE "questionId" = $1
       AND ($2::integer IS NULL OR "versionNumber" > $2
         OR ("versionNumber" = $2 AND "id" > $3::uuid))
     ORDER BY "versionNumber", "id"
     LIMIT $4`,
    questionId,
    cursor?.versionNumber ?? null,
    cursor?.id ?? null,
    EXPORT_VERSION_BATCH_SIZE
  )

export const loadExportVersionChildren = async (
  transaction: Prisma.TransactionClient,
  versionIds: readonly string[]
): Promise<{
  readonly options: readonly ExportOptionRow[]
  readonly tags: readonly ExportTagRow[]
}> => {
  const options = await transaction.$queryRawUnsafe<ExportOptionRow[]>(
    `SELECT "id", "questionVersionId", "ordinal", "text"
     FROM "QuestionOption" WHERE "questionVersionId" = ANY($1::uuid[])
     ORDER BY "questionVersionId", "ordinal", "id"`,
    versionIds
  )
  const tags = await transaction.$queryRawUnsafe<ExportTagRow[]>(
    `SELECT assignment."questionVersionId", assignment."tagId" AS "id",
       assignment."labelSnapshot" AS "label",
       assignment."normalizedNameSnapshot" AS "normalizedName"
     FROM "QuestionVersionTag" AS assignment
     WHERE assignment."questionVersionId" = ANY($1::uuid[])
     ORDER BY assignment."questionVersionId",
       assignment."normalizedNameSnapshot" COLLATE "C", assignment."id"`,
    versionIds
  )
  return { options, tags }
}

export const loadExportRetainedManifest = async (
  transaction: Prisma.TransactionClient,
  questionIds: readonly string[]
): Promise<ExportRetainedManifestRow[]> =>
  transaction.$queryRawUnsafe<ExportRetainedManifestRow[]>(
    `SELECT "questionId", COUNT(*)::bigint AS "versionCount",
       MAX("versionNumber")::integer AS "maxVersionNumber",
       array_agg("id"::text ORDER BY "versionNumber", "id")
         AS "orderedVersionIds"
     FROM "QuestionVersion"
     WHERE "questionId" = ANY($1::uuid[])
     GROUP BY "questionId"
     ORDER BY "questionId"`,
    questionIds
  )

export const buildBoundedExportSnapshot = async (
  transaction: Prisma.TransactionClient,
  request: ExportAdminQuestionsRequest,
  exportedAt: Date
): Promise<{
  readonly canonicalBody: string
  readonly questions: readonly ExportQuestionRow[]
  readonly versions: readonly ExportVersionManifestRow[]
}> => {
  const questions = await loadExportQuestions(transaction, request.questionIds)
  const questionById = new Map(
    questions.map((question) => [question.id, question])
  )
  const missing = request.questionIds.find(
    (questionId) => !questionById.has(questionId)
  )
  if (missing) {
    throw repositoryFailure(
      'RESOURCE_NOT_FOUND',
      '내보낼 관리자 문제를 찾을 수 없습니다.'
    )
  }

  const body = new BoundedExportBody()
  body.append(
    `{"exportedAt":${canonicalizeJson(toIso(exportedAt))},"questions":[`
  )
  const versions: ExportVersionManifestRow[] = []
  const versionIdsByQuestion = new Map<string, string[]>()

  for (const [questionIndex, questionId] of request.questionIds.entries()) {
    const question = questionById.get(questionId)!
    if (questionIndex > 0) body.append(',')
    body.append(
      `{"currentPublishedVersionId":${canonicalizeJson(question.currentPublishedVersionId)},"lifecycleStatus":${canonicalizeJson(question.lifecycleStatus)},"questionId":${canonicalizeJson(question.id)},"versions":[`
    )

    let cursor: Pick<ExportVersionRow, 'id' | 'versionNumber'> | null = null
    let versionIndex = 0
    const orderedVersionIds: string[] = []
    while (true) {
      const page = await loadExportVersionPage(transaction, questionId, cursor)
      if (page.length === 0) break
      const versionIds = page.map((version) => version.id)
      const children = await loadExportVersionChildren(transaction, versionIds)
      const optionsByVersion = new Map<string, ExportOptionRow[]>()
      const tagsByVersion = new Map<string, ExportTagRow[]>()
      for (const option of children.options) {
        const values = optionsByVersion.get(option.questionVersionId) ?? []
        values.push(option)
        optionsByVersion.set(option.questionVersionId, values)
      }
      for (const tag of children.tags) {
        const values = tagsByVersion.get(tag.questionVersionId) ?? []
        values.push(tag)
        tagsByVersion.set(tag.questionVersionId, values)
      }
      for (const version of page) {
        if (versionIndex > 0) body.append(',')
        const versionDocument = {
          content: {
            correctOptionId: version.correctOptionId,
            difficulty: version.difficulty,
            explanationJa: version.explanationJa,
            explanationKo: version.explanationKo,
            level: version.level,
            options: (optionsByVersion.get(version.id) ?? []).map((option) => ({
              id: option.id,
              ordinal: option.ordinal,
              text: option.text
            })),
            passage: version.passage,
            questionText: version.questionText,
            questionType: version.questionType,
            subject: version.subject,
            tags: (tagsByVersion.get(version.id) ?? []).map((tag) => ({
              id: tag.id,
              label: tag.label,
              normalizedName: tag.normalizedName
            }))
          },
          questionVersionId: version.id,
          versionNumber: version.versionNumber,
          versionStatus: version.status
        }
        body.append(
          canonicalizeJson(versionDocument as unknown as CanonicalJsonValue)
        )
        versions.push({
          id: version.id,
          questionId: version.questionId,
          versionNumber: version.versionNumber,
          status: version.status,
          rowVersion: version.rowVersion
        })
        orderedVersionIds.push(version.id)
        versionIndex += 1
      }
      const last = page.at(-1)!
      cursor = { id: last.id, versionNumber: last.versionNumber }
      if (page.length < EXPORT_VERSION_BATCH_SIZE) break
    }
    if (versionIndex === 0) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '내보낼 문제의 보존 버전을 확인할 수 없습니다.',
        disposition: 'NO_TX'
      })
    }
    versionIdsByQuestion.set(questionId, orderedVersionIds)
    body.append(']}')
  }
  body.append('],"schemaVersion":"admin-question-export-v1"}')

  const retainedManifest = await loadExportRetainedManifest(
    transaction,
    request.questionIds
  )
  const retainedByQuestion = new Map(
    retainedManifest.map((row) => [row.questionId, row])
  )
  for (const questionId of request.questionIds) {
    const retained = retainedByQuestion.get(questionId)
    const loadedIds = versionIdsByQuestion.get(questionId) ?? []
    const loadedLast = versions.findLast(
      (version) => version.questionId === questionId
    )
    if (
      !retained ||
      retained.versionCount !== BigInt(loadedIds.length) ||
      retained.maxVersionNumber !== loadedLast?.versionNumber ||
      retained.orderedVersionIds.length !== loadedIds.length ||
      retained.orderedVersionIds.some((id, index) => id !== loadedIds[index])
    ) {
      throw new AdminQuestionCommandRepositoryError({
        code: 'SERVICE_UNAVAILABLE',
        message: '내보내기 보존 버전 목록을 완전하게 확정할 수 없습니다.',
        disposition: 'NO_TX'
      })
    }
  }

  return { canonicalBody: body.value(), questions, versions }
}

export const reconcileCommittedExport = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  input: {
    readonly actorId: string
    readonly auditContentDigest: string
    readonly auditEvidence: AdminQuestionExportAuditEvidence
    readonly environment: AuditEnvironment
    readonly occurredAt: Date
    readonly operationId: string
    readonly requestId: string
  }
): Promise<boolean> => {
  const rows = await client.$queryRawUnsafe<ExportAuditReconciliationRow[]>(
    `SELECT "operationId", "command", "targetType", "targetId",
       "actorId", "requestId", "environment", "changedFields", "metadata",
       "contentDigest", "occurredAt"
     FROM "AdminAuditLog"
     WHERE "operationId" = $1 AND "command" = 'EXPORT'
       AND "targetType" = 'EXPORT_REQUEST'`,
    input.operationId
  )
  const row = rows[0]
  const expectedMetadata = {
    kind: 'EXPORT_V1',
    ...input.auditEvidence
  } as const
  return (
    rows.length === 1 &&
    row !== undefined &&
    row.operationId === input.operationId &&
    row.command === 'EXPORT' &&
    row.targetType === 'EXPORT_REQUEST' &&
    row.targetId === input.operationId &&
    row.actorId === input.actorId &&
    row.requestId === input.requestId &&
    row.environment === input.environment &&
    row.contentDigest === input.auditContentDigest &&
    row.occurredAt.getTime() === input.occurredAt.getTime() &&
    canonicalizeJson(row.changedFields as CanonicalJsonValue) ===
      canonicalizeJson(['EXPORT_SELECTION']) &&
    canonicalizeJson(row.metadata as CanonicalJsonValue) ===
      canonicalizeJson(expectedMetadata)
  )
}
