import { createHash, randomUUID } from 'node:crypto'
import {
  createQuestionDuplicateIdentityKey,
  normalizeContentTagKey,
  type CreateAdminQuestionRequest,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

import {
  type AdminCommandAuthority,
  type TagRow,
  type QuestionTargetRow,
  type VersionTargetRow,
  type LifecycleVersionTargetRow,
  type OptionRow,
  type VersionTagRow,
  UPDATE_CHANGED_FIELD_ORDER
} from './adminQuestionCommandModel.js'
import { repositoryFailure } from './adminQuestionCommandFailures.js'

export const contentFingerprint = (
  content: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
): string => {
  const correctOptionText =
    'correctOptionKey' in content
      ? (content.options.find(
          (option) => option.clientOptionKey === content.correctOptionKey
        )?.text ?? '')
      : (content.options.find((option) => option.id === content.correctOptionId)
          ?.text ?? '')
  const identity = createQuestionDuplicateIdentityKey({
    correctOptionText,
    optionTexts: content.options.map((option) => option.text),
    passage: content.passage,
    questionText: content.questionText,
    questionType: content.questionType,
    subject: content.subject
  })
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

export const hasCrossQuestionDuplicate = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string,
  content: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
): Promise<boolean> => {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "QuestionVersion"
       WHERE "contentFingerprint" = $1 AND "questionId" <> $2
     ) AS "exists"`,
    contentFingerprint(content),
    questionId
  )
  return rows.length === 1 && rows[0]?.exists === true
}

export const hasCrossQuestionFingerprintDuplicate = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string,
  fingerprint: string
): Promise<boolean> => {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "QuestionVersion"
       WHERE "contentFingerprint" = $1 AND "questionId" <> $2
     ) AS "exists"`,
    fingerprint,
    questionId
  )
  return rows.length === 1 && rows[0]?.exists === true
}

export const assertNoVisibleCrossQuestionDuplicate = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string,
  content: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
): Promise<void> => {
  if (await hasCrossQuestionDuplicate(client, questionId, content)) {
    throw repositoryFailure(
      'DUPLICATE_QUESTION_CONTENT',
      '동일한 내용의 문제가 이미 존재합니다.'
    )
  }
}

export const resolveTags = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  content: Pick<CreateAdminQuestionRequest, 'tagNames'>
): Promise<TagRow[]> => {
  const normalizedNames = content.tagNames.map(normalizeContentTagKey)
  const rows = await client.$queryRawUnsafe<TagRow[]>(
    `SELECT tag."id", tag."label", tag."normalizedName"
     FROM "Tag" AS tag
     WHERE tag."normalizedName" = ANY($1::text[])
     ORDER BY tag."normalizedName" COLLATE "C", tag."id"`,
    normalizedNames
  )
  const byName = new Map(rows.map((row) => [row.normalizedName, row]))
  if (
    rows.length !== normalizedNames.length ||
    normalizedNames.some((name) => !byName.has(name))
  ) {
    throw repositoryFailure(
      'VALIDATION_ERROR',
      '문제에 적용할 수 없는 태그가 포함되어 있습니다.',
      { tagNames: ['모든 태그는 태그 목록에 있어야 합니다.'] }
    )
  }
  return normalizedNames.map((name) => byName.get(name)!)
}

export const loadQuestionTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string
): Promise<QuestionTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<QuestionTargetRow[]>(
    `SELECT question."id", question."lifecycleStatus",
       question."rowVersion", question."createdByUserId",
       question."currentPublishedVersionId",
       COALESCE(maximum."maximumVersionNumber", 0)::int AS "maximumVersionNumber",
       EXISTS (
         SELECT 1 FROM "QuestionVersion" AS candidate
         WHERE candidate."questionId" = question."id"
           AND candidate."status" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
       ) AS "hasOpenCandidate"
     FROM "Question" AS question
     LEFT JOIN LATERAL (
       SELECT MAX(version."versionNumber")::int AS "maximumVersionNumber"
       FROM "QuestionVersion" AS version
       WHERE version."questionId" = question."id"
     ) AS maximum ON TRUE
     WHERE question."id" = $1`,
    questionId
  )
  return rows[0] ?? null
}

export const loadVersionTarget = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  versionId: string
): Promise<VersionTargetRow | null> => {
  const rows = await client.$queryRawUnsafe<VersionTargetRow[]>(
    `SELECT version."questionId", question."lifecycleStatus"
         AS "questionLifecycleStatus",
       question."rowVersion" AS "questionRowVersion",
       question."currentPublishedVersionId"
         AS "questionCurrentPublishedVersionId",
       question."createdByUserId" AS "questionCreatedByUserId",
       version."id" AS "versionId", version."versionNumber",
       version."status" AS "versionStatus",
       version."rowVersion" AS "versionRowVersion",
       version."createdByUserId" AS "versionCreatedByUserId",
       version."createdByActorId" AS "versionCreatedByActorId",
       version."createdByRoleSnapshot" AS "versionCreatedByRoleSnapshot",
       version."createdByLabelSnapshot" AS "versionCreatedByLabelSnapshot",
       version."contentFingerprint",
       version."level", version."subject", version."questionType",
       version."difficulty", version."passage", version."questionText",
       version."explanationKo", version."explanationJa",
       version."correctOptionId",
       EXISTS (
         SELECT 1 FROM "StudySessionQuestion" AS pinned
         WHERE pinned."questionVersionId" = version."id"
       ) AS "isPinned",
       latest_approval."actorUserId" AS "latestApproverUserId",
       latest_approval."actorId" AS "latestApproverActorId",
       latest_approval."actorRole" AS "latestApproverRole",
       latest_approval."actorLabel" AS "latestApproverLabel"
     FROM "QuestionVersion" AS version
     JOIN "Question" AS question ON question."id" = version."questionId"
     LEFT JOIN LATERAL (
         SELECT review."actorUserId", review."actorId",
           review."actorRole", review."actorLabel"
         FROM "ContentReview" AS review
         WHERE review."questionVersionId" = version."id"
           AND review."action" = 'APPROVED'
         ORDER BY review."occurredAt" DESC, review."id" DESC
         LIMIT 1
       ) AS latest_approval ON TRUE
     WHERE version."id" = $1`,
    versionId
  )
  return rows[0] ?? null
}

export const loadLifecycleVersions = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  questionId: string
): Promise<LifecycleVersionTargetRow[]> =>
  client.$queryRawUnsafe<LifecycleVersionTargetRow[]>(
    `SELECT version."id", version."questionId", version."status",
       version."rowVersion", version."createdByUserId",
       version."createdByActorId", version."createdByRoleSnapshot",
       version."createdByLabelSnapshot", version."contentFingerprint"
     FROM "QuestionVersion" AS version
     JOIN "Question" AS question ON question."id" = version."questionId"
     WHERE version."questionId" = $1
       AND (version."id" = question."currentPublishedVersionId"
         OR version."status" IN (
           'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'
         ))
     ORDER BY version."id"`,
    questionId
  )

export const loadOptions = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionId: string
): Promise<OptionRow[]> =>
  client.$queryRawUnsafe<OptionRow[]>(
    `SELECT "id", "label", "ordinal", "text"
     FROM "QuestionOption" WHERE "questionVersionId" = $1
     ORDER BY "ordinal", "id"`,
    versionId
  )

export const loadVersionTags = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionId: string
): Promise<VersionTagRow[]> =>
  client.$queryRawUnsafe<VersionTagRow[]>(
    `SELECT assignment."id" AS "assignmentId", tag."id", tag."label",
       tag."normalizedName"
     FROM "QuestionVersionTag" AS assignment
     JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
     WHERE assignment."questionVersionId" = $1
     ORDER BY tag."normalizedName" COLLATE "C", assignment."id"`,
    versionId
  )

export const createVersionContent = async (
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string
    content: CreateAdminQuestionRequest
    occurredAt: Date
    questionId: string
    tags: readonly TagRow[]
    versionId: string
    versionNumber: number
  }
): Promise<void> => {
  const optionIdByKey = new Map(
    input.content.options.map((option) => [
      option.clientOptionKey,
      randomUUID()
    ])
  )
  const correctOptionId = optionIdByKey.get(input.content.correctOptionKey)
  if (!correctOptionId) {
    throw new Error('Correct option key was not resolved.')
  }
  await transaction.$executeRawUnsafe(
    `INSERT INTO "QuestionVersion" (
       "id", "questionId", "versionNumber", "level", "subject",
       "questionType", "passage", "questionText", "correctOptionId",
       "explanationKo", "explanationJa", "difficulty", "contentFingerprint",
       "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
       "createdByLabelSnapshot", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4::"JlptLevel", $5::"QuestionSubject",
       $6::"QuestionType", $7, $8, $9, $10, $11,
       $12::"QuestionDifficulty", repeat('0', 64), $13, $13, 'ADMIN',
       'ACTIVE_ADMIN', $14, $14
     )`,
    input.versionId,
    input.questionId,
    input.versionNumber,
    input.content.level,
    input.content.subject,
    input.content.questionType,
    input.content.passage,
    input.content.questionText,
    correctOptionId,
    input.content.explanationKo,
    input.content.explanationJa,
    input.content.difficulty,
    input.actorId,
    input.occurredAt
  )
  for (const [index, option] of input.content.options.entries()) {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "QuestionOption" (
         "id", "questionVersionId", "label", "text", "ordinal"
       ) VALUES ($1, $2, $3, $4, $5)`,
      optionIdByKey.get(option.clientOptionKey),
      input.versionId,
      String(index + 1),
      option.text,
      index + 1
    )
  }
  for (const tag of input.tags) {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "QuestionVersionTag" ("id", "questionVersionId", "tagId")
       VALUES ($1, $2, $3)`,
      randomUUID(),
      input.versionId,
      tag.id
    )
  }
  await transaction.$executeRawUnsafe(
    `UPDATE "QuestionVersion" SET "questionText" = "questionText"
     WHERE "id" = $1`,
    input.versionId
  )
}

export const computeUpdateChangedFields = (
  target: VersionTargetRow,
  existingOptions: readonly OptionRow[],
  existingTags: readonly VersionTagRow[],
  request: UpdateQuestionVersionRequest,
  desiredTags: readonly TagRow[]
): string[] => {
  const changed = new Set<string>()
  if (target.level !== request.level) changed.add('LEVEL')
  if (target.subject !== request.subject) changed.add('SUBJECT')
  if (target.questionType !== request.questionType) changed.add('QUESTION_TYPE')
  if (target.difficulty !== request.difficulty) changed.add('DIFFICULTY')
  if (target.passage !== request.passage) changed.add('PASSAGE')
  if (target.questionText !== request.questionText) changed.add('QUESTION_TEXT')
  if (target.explanationKo !== request.explanationKo)
    changed.add('EXPLANATION_KO')
  if (target.explanationJa !== request.explanationJa)
    changed.add('EXPLANATION_JA')
  const requestedOptions = request.options.toSorted(
    (left, right) =>
      left.ordinal - right.ordinal || left.id.localeCompare(right.id)
  )
  if (
    existingOptions.length !== requestedOptions.length ||
    existingOptions.some((option, index) => {
      const requested = requestedOptions[index]
      return (
        !requested ||
        option.id !== requested.id ||
        option.ordinal !== requested.ordinal ||
        option.label !== String(requested.ordinal) ||
        option.text !== requested.text
      )
    })
  ) {
    changed.add('OPTIONS')
  }
  if (target.correctOptionId !== request.correctOptionId)
    changed.add('CORRECT_OPTION')
  const existingTagIds = existingTags.map((tag) => tag.id).sort()
  const desiredTagIds = desiredTags.map((tag) => tag.id).sort()
  if (JSON.stringify(existingTagIds) !== JSON.stringify(desiredTagIds)) {
    changed.add('TAGS')
  }
  return UPDATE_CHANGED_FIELD_ORDER.filter((field) => changed.has(field))
}

export const validateUpdate = (
  target: VersionTargetRow,
  options: readonly OptionRow[],
  authority: AdminCommandAuthority,
  request: UpdateQuestionVersionRequest
): void => {
  if (target.versionCreatedByUserId !== authority.actorId) {
    throw repositoryFailure(
      'FORBIDDEN',
      '작성자만 문제 버전을 수정할 수 있습니다.'
    )
  }
  if (target.versionRowVersion !== request.expectedRowVersion) {
    throw repositoryFailure(
      'VERSION_CONFLICT',
      '다른 요청이 먼저 변경했습니다. 최신 상태를 다시 불러와 주세요.'
    )
  }
  if (target.questionLifecycleStatus !== 'ACTIVE') {
    throw repositoryFailure(
      'INVALID_STATE_TRANSITION',
      '보관된 문제의 버전은 수정할 수 없습니다.'
    )
  }
  if (
    !['DRAFT', 'CHANGES_REQUESTED'].includes(target.versionStatus) ||
    target.isPinned
  ) {
    throw repositoryFailure(
      'QUESTION_VERSION_IMMUTABLE',
      '검수 또는 학습에 사용된 문제 버전은 수정할 수 없습니다.'
    )
  }
  const existingIds = new Set(options.map((option) => option.id))
  const requestedIds = new Set(request.options.map((option) => option.id))
  if (
    existingIds.size !== 4 ||
    requestedIds.size !== 4 ||
    [...existingIds].some((id) => !requestedIds.has(id))
  ) {
    throw repositoryFailure(
      'VALIDATION_ERROR',
      '기존 보기 ID 네 개를 모두 유지해야 합니다.',
      { options: ['option ID 집합은 기존 문제 버전과 정확히 같아야 합니다.'] }
    )
  }
}
