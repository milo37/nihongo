import { createHash, randomUUID } from 'node:crypto'
import {
  ADMIN_QUESTION_TAG_LIMIT,
  adminImportIssueCodeSchema,
  compareUnicodeScalars,
  createAdminImportValidationDigest,
  createQuestionDuplicateIdentityKey,
  isApplicableQuestionContentType,
  normalizeContentTagKey,
  type AdminImportItem,
  type AdminImportValidationResponse,
  type AdminQuestionContentStructureInput,
  type ApplyQuestionImportRequest
} from '@nihongo/contracts/admin/content-operations'
import { normalizeOptionComparison } from '@nihongo/domain/content/validators/v1/unicode'

import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { uniqueSorted } from './adminRepositoryCommon.js'
import { repositoryFailure } from './adminQuestionCommandRepository.js'
import { TAG_REFERENCE_SQL } from './adminQuestionCommandContent.js'

import {
  type AdminImportValidationIssue,
  type ImportTagRow,
  type BatchTargetRow,
  sha256Port
} from './adminQuestionWorkflowModel.js'

export const contentFingerprint = (
  content: AdminQuestionContentStructureInput
): string => {
  const correctOptionText =
    content.options.find(
      (option) => option.clientOptionKey === content.correctOptionKey
    )?.text ?? ''
  return createHash('sha256')
    .update(
      createQuestionDuplicateIdentityKey({
        correctOptionText,
        optionTexts: content.options.map((option) => option.text),
        passage: content.passage,
        questionText: content.questionText,
        questionType: content.questionType,
        subject: content.subject
      }),
      'utf8'
    )
    .digest('hex')
}

export const loadImportTags = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  items: readonly AdminImportItem[]
): Promise<ImportTagRow[]> => {
  const normalizedNames = uniqueSorted(
    items.flatMap((item) => item.content.tagNames.map(normalizeContentTagKey))
  )
  if (normalizedNames.length === 0) return []
  return client.$queryRawUnsafe<ImportTagRow[]>(
    TAG_REFERENCE_SQL,
    normalizedNames
  )
}

export const loadExistingFingerprints = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  fingerprints: readonly string[]
): Promise<Set<string>> => {
  if (fingerprints.length === 0) return new Set()
  const rows = await client.$queryRawUnsafe<
    Array<{ readonly contentFingerprint: string }>
  >(
    `SELECT DISTINCT "contentFingerprint" FROM "QuestionVersion"
     WHERE "contentFingerprint" = ANY($1::varchar[])`,
    fingerprints
  )
  return new Set(rows.map((row) => row.contentFingerprint))
}

/**
 * #1196: passages a new question may not join — one a passage edit has
 * replaced, or one a passage edit opened whose group is not published yet.
 * Keys are `${level}|${subject}|${md5(text)}`.
 */
export const loadClosedImportPassages = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  passages: ReadonlyArray<{
    readonly level: string
    readonly subject: string
    readonly text: string
  }>
): Promise<Set<string>> => {
  if (passages.length === 0) return new Set()
  const rows = await client.$queryRawUnsafe<Array<{ readonly key: string }>>(
    `SELECT DISTINCT passage."level"::text || '|' ||
         passage."subject"::text || '|' || passage."textMd5" AS "key"
     FROM unnest($1::text[], $2::text[], $3::text[])
       AS wanted("level", "subject", "text")
     JOIN "ReadingPassage" AS passage
       ON passage."level"::text = wanted."level"
      AND passage."subject"::text = wanted."subject"
      AND passage."textMd5" = md5(wanted."text")
     WHERE EXISTS (
         SELECT 1 FROM "ReadingPassage" AS replacement
         WHERE replacement."replacesPassageId" = passage."id"
       )
       OR (passage."replacesPassageId" IS NOT NULL AND EXISTS (
         SELECT 1
         FROM "QuestionVersion" AS member
         JOIN "Question" AS question ON question."id" = member."questionId"
         LEFT JOIN "QuestionVersion" AS published
           ON published."id" = question."currentPublishedVersionId"
         WHERE member."passageId" = passage."id"
           AND member."status" IN ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED',
             'APPROVED')
           AND question."lifecycleStatus" = 'ACTIVE'
           AND published."passageId" IS DISTINCT FROM passage."id"
       ))`,
    passages.map((passage) => passage.level),
    passages.map((passage) => passage.subject),
    passages.map((passage) => passage.text)
  )
  return new Set(rows.map((row) => row.key))
}

const md5Hex = (text: string): string =>
  createHash('md5').update(text, 'utf8').digest('hex')

export const eligibleImportFingerprints = (
  items: readonly AdminImportItem[]
): string[] =>
  uniqueSorted(
    items.map((item) => {
      const optionKeys = new Set<string>()
      const optionTexts = new Set<string>()
      let duplicateOptionKey = false
      let duplicateOptionText = false
      for (const option of item.content.options) {
        if (optionKeys.has(option.clientOptionKey)) duplicateOptionKey = true
        const normalizedText = normalizeOptionComparison(option.text)
        if (optionTexts.has(normalizedText)) duplicateOptionText = true
        optionKeys.add(option.clientOptionKey)
        optionTexts.add(normalizedText)
      }
      const correctKeyMatchCount = item.content.options.filter(
        (option) => option.clientOptionKey === item.content.correctOptionKey
      ).length
      const passageIsValid =
        item.content.subject === 'READING'
          ? item.content.passage !== null
          : item.content.questionType === 'TEXT_GRAMMAR' ||
            item.content.passage === null
      return !duplicateOptionKey &&
        !duplicateOptionText &&
        correctKeyMatchCount === 1 &&
        passageIsValid &&
        isApplicableQuestionContentType(
          item.content.level,
          item.content.subject,
          item.content.questionType
        )
        ? contentFingerprint(item.content)
        : null
    })
  )

export const pushIssue = (
  issues: AdminImportValidationIssue[],
  issue: AdminImportValidationIssue
): void => {
  if (
    !issues.some(
      (existing) =>
        existing.itemIndex === issue.itemIndex &&
        existing.fieldPath === issue.fieldPath &&
        existing.code === issue.code
    )
  ) {
    issues.push(issue)
  }
}

export const collectImportValidation = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  items: readonly AdminImportItem[]
): Promise<{
  readonly response: AdminImportValidationResponse
  readonly importTags: readonly ImportTagRow[]
}> => {
  // The request contract allows two tags; the repository holds the same
  // limit for any caller that skips it (#712).
  const overTagLimit = items.flatMap((item, itemIndex) =>
    item.content.tagNames.length > ADMIN_QUESTION_TAG_LIMIT
      ? [`/items/${itemIndex}/content/tagNames`]
      : []
  )
  if (overTagLimit.length > 0) {
    throw repositoryFailure(
      'IMPORT_VALIDATION_FAILED',
      `문제당 태그는 ${ADMIN_QUESTION_TAG_LIMIT}개까지입니다.`,
      Object.fromEntries(
        overTagLimit.map((fieldPath) => [
          fieldPath,
          [`태그는 ${ADMIN_QUESTION_TAG_LIMIT}개까지입니다.`]
        ])
      )
    )
  }
  const [importTags, validationDigest] = await Promise.all([
    loadImportTags(client, items),
    createAdminImportValidationDigest(sha256Port, items)
  ])
  const tagsByReference = new Map(importTags.map((tag) => [tag.reference, tag]))
  const issues: AdminImportValidationIssue[] = []
  const seenItemIds = new Set<string>()
  const eligibleFingerprints: Array<string | null> = items.map(() => null)

  items.forEach((item, itemIndex) => {
    const prefix = `/items/${itemIndex}`
    if (seenItemIds.has(item.clientItemId)) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/clientItemId`,
        code: 'DUPLICATE_CLIENT_ITEM_ID',
        message: 'clientItemId는 import 요청 안에서 고유해야 합니다.'
      })
    }
    seenItemIds.add(item.clientItemId)

    const optionKeys = new Set<string>()
    const optionTexts = new Set<string>()
    let hasDuplicateOptionKey = false
    let hasDuplicateOptionText = false
    item.content.options.forEach((option, optionIndex) => {
      if (optionKeys.has(option.clientOptionKey)) {
        hasDuplicateOptionKey = true
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/options/${optionIndex}/clientOptionKey`,
          code: 'DUPLICATE_CLIENT_OPTION_KEY',
          message: 'clientOptionKey는 문제 안에서 고유해야 합니다.'
        })
      }
      const normalizedText = normalizeOptionComparison(option.text)
      if (optionTexts.has(normalizedText)) {
        hasDuplicateOptionText = true
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/options/${optionIndex}/text`,
          code: 'DUPLICATE_OPTION_TEXT',
          message: '정규화된 보기 내용은 문제 안에서 고유해야 합니다.'
        })
      }
      optionKeys.add(option.clientOptionKey)
      optionTexts.add(normalizedText)
    })
    const correctKeyMatchCount = item.content.options.filter(
      (option) => option.clientOptionKey === item.content.correctOptionKey
    ).length
    if (correctKeyMatchCount === 0) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/content/correctOptionKey`,
        code: 'CORRECT_OPTION_KEY_NOT_FOUND',
        message: 'correctOptionKey는 같은 문제의 보기 key여야 합니다.'
      })
    }

    const tagKeys = new Set<string>()
    item.content.tagNames.forEach((tagName, tagIndex) => {
      const reference = normalizeContentTagKey(tagName)
      const tag = tagsByReference.get(reference)
      // A key and its label name the same tag.
      const identity = tag?.id ?? reference
      if (tagKeys.has(identity)) {
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/tagNames/${tagIndex}`,
          code: 'DUPLICATE_TAG',
          message: '정규화된 태그는 문제 안에서 고유해야 합니다.'
        })
      }
      const tagSubject = tag?.subject
      if (tagSubject === undefined) {
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/tagNames/${tagIndex}`,
          code: 'UNKNOWN_TAG',
          message: '태그 목록에 있는 태그가 필요합니다.'
        })
      } else if (tagSubject !== null && tagSubject !== item.content.subject) {
        // A tag without a subject predates the tag list file.
        pushIssue(issues, {
          itemIndex,
          fieldPath: `${prefix}/content/tagNames/${tagIndex}`,
          code: 'TAG_SUBJECT_MISMATCH',
          message: '태그 과목이 문제 과목과 같아야 합니다.'
        })
      }
      tagKeys.add(identity)
    })

    const passageIsValid =
      item.content.subject === 'READING'
        ? item.content.passage !== null
        : item.content.questionType === 'TEXT_GRAMMAR' ||
          item.content.passage === null
    if (!passageIsValid) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/content/passage`,
        code: 'INVALID_READING_PASSAGE',
        message: '문제 분류에 맞는 passage 구성이 필요합니다.'
      })
    }
    const contentIsValid = isApplicableQuestionContentType(
      item.content.level,
      item.content.subject,
      item.content.questionType
    )
    if (!contentIsValid) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `${prefix}/content/questionType`,
        code: 'INVALID_CONTENT',
        message: 'level/subject/questionType 조합이 올바르지 않습니다.'
      })
    }

    if (
      !hasDuplicateOptionKey &&
      !hasDuplicateOptionText &&
      correctKeyMatchCount === 1 &&
      passageIsValid &&
      contentIsValid
    ) {
      eligibleFingerprints[itemIndex] = contentFingerprint(item.content)
    }
  })

  const existingFingerprints = await loadExistingFingerprints(
    client,
    uniqueSorted(eligibleFingerprints)
  )
  const seenFingerprints = new Set<string>()
  eligibleFingerprints.forEach((fingerprint, itemIndex) => {
    if (fingerprint === null) return
    if (
      existingFingerprints.has(fingerprint) ||
      seenFingerprints.has(fingerprint)
    ) {
      pushIssue(issues, {
        itemIndex,
        fieldPath: `/items/${itemIndex}/content/questionText`,
        code: 'DUPLICATE_QUESTION_CONTENT',
        message: '동일한 내용의 문제가 이미 존재합니다.'
      })
    }
    seenFingerprints.add(fingerprint)
  })

  const withPassage = items.flatMap((item, itemIndex) =>
    item.content.passage === null
      ? []
      : [
          {
            itemIndex,
            level: item.content.level,
            subject: item.content.subject,
            text: item.content.passage
          }
        ]
  )
  const closedPassages = await loadClosedImportPassages(client, withPassage)
  for (const passage of withPassage) {
    if (
      closedPassages.has(
        [passage.level, passage.subject, md5Hex(passage.text)].join('|')
      )
    ) {
      pushIssue(issues, {
        itemIndex: passage.itemIndex,
        fieldPath: `/items/${passage.itemIndex}/content/passage`,
        code: 'INVALID_READING_PASSAGE',
        message:
          '이 지문은 지문 고치기로 바뀌었거나 고치는 중이라 새 문제를 붙일 수 없습니다.'
      })
    }
  }

  issues.sort(
    (left, right) =>
      left.itemIndex - right.itemIndex ||
      compareUnicodeScalars(left.fieldPath, right.fieldPath) ||
      adminImportIssueCodeSchema.options.indexOf(left.code) -
        adminImportIssueCodeSchema.options.indexOf(right.code) ||
      compareUnicodeScalars(left.message, right.message)
  )
  return {
    response: {
      valid: issues.length === 0,
      validationDigest,
      itemCount: items.length,
      errors: issues
    },
    importTags
  }
}

export type ImportValidationResult = Awaited<
  ReturnType<typeof collectImportValidation>
>

export const assertImportApplyValidation = (
  request: ApplyQuestionImportRequest,
  validation: ImportValidationResult
): void => {
  if (validation.response.validationDigest !== request.validationDigest) {
    throw repositoryFailure(
      'IMPORT_IDENTITY_CONFLICT',
      'import 검증 digest와 적용 요청이 일치하지 않습니다.'
    )
  }
  if (validation.response.valid) return

  const fieldErrors: Record<string, string[]> = {}
  validation.response.errors.forEach((issue) => {
    fieldErrors[issue.fieldPath] = [
      ...(fieldErrors[issue.fieldPath] ?? []),
      issue.message
    ]
  })
  throw repositoryFailure(
    'IMPORT_VALIDATION_FAILED',
    'import 의미 검증을 통과하지 못했습니다.',
    fieldErrors
  )
}

export const createVersionContent = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly actorId: string
    readonly content: AdminQuestionContentStructureInput
    readonly occurredAt: Date
    readonly questionId: string
    readonly tags: readonly ImportTagRow[]
    readonly versionId: string
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
    throw repositoryFailure(
      'IMPORT_VALIDATION_FAILED',
      '정답 보기 key가 존재하지 않습니다.'
    )
  }
  await transaction.$executeRawUnsafe(
    `INSERT INTO "QuestionVersion" (
       "id", "questionId", "versionNumber", "level", "subject",
       "questionType", "passage", "questionText", "correctOptionId",
       "explanationKo", "explanationJa", "difficulty", "contentFingerprint",
       "createdByUserId", "createdByActorId", "createdByRoleSnapshot",
       "createdByLabelSnapshot", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, 1, $3::"JlptLevel", $4::"QuestionSubject",
       $5::"QuestionType", $6, $7, $8, $9, $10,
       $11::"QuestionDifficulty", repeat('0', 64), $12, $12, 'ADMIN',
       'ACTIVE_ADMIN', $13, $13
     )`,
    input.versionId,
    input.questionId,
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

export const loadBatchTargets = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'> | Prisma.TransactionClient,
  versionIds: readonly string[]
): Promise<BatchTargetRow[]> =>
  client.$queryRawUnsafe<BatchTargetRow[]>(
    `SELECT question."id" AS "questionId",
       question."lifecycleStatus" AS "questionLifecycleStatus",
       question."rowVersion" AS "questionRowVersion",
       question."createdByUserId" AS "questionCreatedByUserId",
       version."id" AS "versionId", version."status" AS "versionStatus",
       version."rowVersion" AS "versionRowVersion",
       version."createdByUserId" AS "versionCreatedByUserId"
     FROM "QuestionVersion" AS version
     JOIN "Question" AS question ON question."id" = version."questionId"
     WHERE version."id" = ANY($1::uuid[])
     ORDER BY version."id"`,
    versionIds
  )
