import { z } from 'zod'

import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema
} from '../common/enum.js'
import { opaqueIdSchema, requestIdSchema } from '../common/id.js'
import {
  adminQuestionVersionCursorSchema,
  phase7OccurredAtCursorSchema
} from '../common/phase7-cursor.js'
import {
  accountActorSnapshotSchema,
  adminActorSnapshotSchema,
  compareUnicodeScalars,
  createPhase7TextSchema,
  isWellFormedPhase7Text,
  nonNegativeSafeIntegerSchema,
  normalizePhase7TagKey,
  positiveSafeIntegerSchema,
  questionLifecycleStatusSchema,
  questionVersionStatusSchema,
  retirementKindSchema,
  safeActorSnapshotSchema
} from '../common/phase7.js'

const addIssue = (
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  message: string
): void => {
  context.addIssue({ code: 'custom', path, message })
}

export const adminQuestionSortSchema = z.enum([
  'UPDATED_DESC',
  'CREATED_DESC',
  'LEVEL_ASC',
  'REPORT_COUNT_DESC'
])

export const adminTagSummarySchema = z
  .object({
    id: opaqueIdSchema,
    label: createPhase7TextSchema({ maxScalars: 100 }),
    normalizedName: z
      .string()
      .min(1)
      .refine(
        (value) =>
          [...value].length <= 100 &&
          isWellFormedPhase7Text(value) &&
          !value.includes('\n') &&
          normalizePhase7TagKey(value) === value,
        {
          message:
            'normalizedName은 canonical normalizeTagKey v1 값이어야 합니다.'
        }
      )
  })
  .strict()

export const compareAdminTags = (
  left: { readonly id: string; readonly normalizedName: string },
  right: { readonly id: string; readonly normalizedName: string }
): number =>
  compareUnicodeScalars(left.normalizedName, right.normalizedName) ||
  compareUnicodeScalars(left.id, right.id)

export const assertAdminTagList = (
  tags: readonly { readonly id: string; readonly normalizedName: string }[],
  path: PropertyKey[] = ['tags']
): void => {
  const ids = new Set<string>()
  const names = new Set<string>()
  tags.forEach((tag, index) => {
    if (ids.has(tag.id) || names.has(tag.normalizedName)) {
      throw new Error(
        `${path.join('.')}.${index}: 태그 ID와 normalizedName은 고유해야 합니다.`
      )
    }
    if (index > 0 && compareAdminTags(tags[index - 1]!, tag) >= 0) {
      throw new Error(
        `${path.join('.')}.${index}: 태그는 canonical strict order여야 합니다.`
      )
    }
    ids.add(tag.id)
    names.add(tag.normalizedName)
  })
}

const adminTagListSchema = z
  .array(adminTagSummarySchema)
  .min(1)
  .max(12)
  .superRefine((tags, context) => {
    try {
      assertAdminTagList(tags)
    } catch (error) {
      addIssue(
        context,
        [],
        error instanceof Error ? error.message : 'invalid tags'
      )
    }
  })

const retirementFieldsRefinement = (
  value: {
    readonly versionStatus: z.output<typeof questionVersionStatusSchema>
    readonly retirementKind: z.output<typeof retirementKindSchema> | null
  },
  context: z.core.$RefinementCtx
): void => {
  if ((value.versionStatus === 'RETIRED') !== (value.retirementKind !== null)) {
    addIssue(
      context,
      ['retirementKind'],
      'RETIRED status와 retirementKind nullability가 일치해야 합니다.'
    )
  }
}

export const adminQuestionSummarySchema = z
  .object({
    questionId: opaqueIdSchema,
    selectedVersionId: opaqueIdSchema,
    currentPublishedVersionId: opaqueIdSchema.nullable(),
    openCandidateVersionId: opaqueIdSchema.nullable(),
    versionNumber: positiveSafeIntegerSchema,
    lifecycleStatus: questionLifecycleStatusSchema,
    versionStatus: questionVersionStatusSchema,
    retirementKind: retirementKindSchema.nullable(),
    questionRowVersion: positiveSafeIntegerSchema,
    versionRowVersion: positiveSafeIntegerSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    difficulty: questionDifficultySchema,
    questionTextPreview: createPhase7TextSchema({ maxScalars: 160 }),
    tags: adminTagListSchema,
    author: accountActorSnapshotSchema.nullable(),
    latestReviewer: accountActorSnapshotSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    answerCount: nonNegativeSafeIntegerSchema,
    correctRateBasisPoints: z.number().int().min(0).max(10_000).nullable(),
    openReportCount: nonNegativeSafeIntegerSchema
  })
  .strict()
  .superRefine((question, context) => {
    retirementFieldsRefinement(question, context)
    if (
      question.openCandidateVersionId !== null &&
      question.selectedVersionId !== question.openCandidateVersionId
    ) {
      addIssue(
        context,
        ['selectedVersionId'],
        'open candidate가 selected version이어야 합니다.'
      )
    }
    if (
      question.openCandidateVersionId === null &&
      question.currentPublishedVersionId !== null &&
      question.selectedVersionId !== question.currentPublishedVersionId
    ) {
      addIssue(
        context,
        ['selectedVersionId'],
        'current published가 selected version이어야 합니다.'
      )
    }
    if (
      (question.answerCount === 0) !==
      (question.correctRateBasisPoints === null)
    ) {
      addIssue(
        context,
        ['correctRateBasisPoints'],
        'answerCount 0 iff correctRateBasisPoints null이어야 합니다.'
      )
    }
    if (Date.parse(question.createdAt) > Date.parse(question.updatedAt)) {
      addIssue(
        context,
        ['updatedAt'],
        'updatedAt은 createdAt보다 빠를 수 없습니다.'
      )
    }
    if (question.author !== null && question.author.role !== 'ADMIN') {
      addIssue(context, ['author'], 'author는 ADMIN actor여야 합니다.')
    }
    if (
      question.latestReviewer !== null &&
      question.latestReviewer.role !== 'ADMIN'
    ) {
      addIssue(
        context,
        ['latestReviewer'],
        'latestReviewer는 ADMIN actor여야 합니다.'
      )
    }
  })

export const adminQuestionVersionSummarySchema = z
  .object({
    questionVersionId: opaqueIdSchema,
    versionNumber: positiveSafeIntegerSchema,
    versionStatus: questionVersionStatusSchema,
    retirementKind: retirementKindSchema.nullable(),
    rowVersion: positiveSafeIntegerSchema,
    provenance: z.enum(['SYSTEM_SEED', 'ADMIN_AUTHORED']),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    difficulty: questionDifficultySchema,
    questionTextPreview: createPhase7TextSchema({ maxScalars: 160 }),
    tags: adminTagListSchema,
    author: accountActorSnapshotSchema.nullable(),
    latestReviewer: accountActorSnapshotSchema.nullable(),
    publishedAt: isoDateTimeSchema.nullable(),
    retiredAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((version, context) => {
    retirementFieldsRefinement(version, context)
    if ((version.provenance === 'SYSTEM_SEED') !== (version.author === null)) {
      addIssue(context, ['author'], 'SYSTEM_SEED iff author null이어야 합니다.')
    }
    if (version.author !== null && version.author.role !== 'ADMIN') {
      addIssue(
        context,
        ['author'],
        'ADMIN_AUTHORED author는 ADMIN actor여야 합니다.'
      )
    }
    if (
      version.latestReviewer !== null &&
      version.latestReviewer.role !== 'ADMIN'
    ) {
      addIssue(
        context,
        ['latestReviewer'],
        'latestReviewer는 ADMIN actor여야 합니다.'
      )
    }
    if (
      (version.versionStatus === 'RETIRED') !==
      (version.retiredAt !== null)
    ) {
      addIssue(
        context,
        ['retiredAt'],
        'RETIRED status iff retiredAt non-null이어야 합니다.'
      )
    }
    const hasPublishedLineage =
      version.versionStatus === 'PUBLISHED' ||
      (version.versionStatus === 'RETIRED' &&
        version.retirementKind === 'PUBLISHED_RETIREMENT')
    if (hasPublishedLineage !== (version.publishedAt !== null)) {
      addIssue(
        context,
        ['publishedAt'],
        'published lineage와 publishedAt이 일치해야 합니다.'
      )
    }
    if (Date.parse(version.createdAt) > Date.parse(version.updatedAt)) {
      addIssue(
        context,
        ['updatedAt'],
        'updatedAt은 createdAt보다 빠를 수 없습니다.'
      )
    }
  })

export const adminContentReviewActionSchema = z.enum([
  'REQUESTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'APPROVAL_WITHDRAWN',
  'PUBLISHED',
  'RETIRED',
  'ARCHIVE_ABANDONED',
  'AUTHOR_ERASURE_ABANDONED'
])

const reviewReasonSchema = createPhase7TextSchema({
  maxScalars: 100,
  multiline: true
})
const reviewCommentSchema = createPhase7TextSchema({
  maxScalars: 1000,
  multiline: true
})

export const adminContentReviewItemSchema = z
  .object({
    id: opaqueIdSchema,
    questionId: opaqueIdSchema,
    questionVersionId: opaqueIdSchema,
    action: adminContentReviewActionSchema,
    fromState: questionVersionStatusSchema,
    toState: questionVersionStatusSchema,
    actor: safeActorSnapshotSchema,
    counterpart: accountActorSnapshotSchema.nullable(),
    reason: reviewReasonSchema.nullable(),
    comment: reviewCommentSchema.nullable(),
    operationId: opaqueIdSchema,
    requestId: requestIdSchema,
    occurredAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((review, context) => {
    const accountActorId =
      review.actor.kind === 'ACCOUNT' ? review.actor.actorId : null
    const actorsAreDistinct =
      accountActorId === null ||
      review.counterpart === null ||
      accountActorId !== review.counterpart.actorId
    const requireAdminPair = (mustBeDistinct = true): void => {
      if (
        review.actor.kind !== 'ACCOUNT' ||
        review.actor.role !== 'ADMIN' ||
        review.counterpart?.role !== 'ADMIN' ||
        (mustBeDistinct && !actorsAreDistinct)
      ) {
        addIssue(
          context,
          ['actor'],
          '서로 다른 ADMIN actor/counterpart가 필요합니다.'
        )
      }
    }

    switch (review.action) {
      case 'REQUESTED':
        if (
          !['DRAFT', 'CHANGES_REQUESTED'].includes(review.fromState) ||
          review.toState !== 'IN_REVIEW' ||
          review.actor.kind !== 'ACCOUNT' ||
          review.actor.role !== 'ADMIN' ||
          review.counterpart !== null ||
          review.reason !== null
        ) {
          addIssue(
            context,
            ['action'],
            'REQUESTED evidence matrix가 일치하지 않습니다.'
          )
        }
        break
      case 'CHANGES_REQUESTED':
        requireAdminPair()
        if (
          review.fromState !== 'IN_REVIEW' ||
          review.toState !== 'CHANGES_REQUESTED' ||
          review.reason === null
        ) {
          addIssue(
            context,
            ['action'],
            'CHANGES_REQUESTED evidence matrix가 일치하지 않습니다.'
          )
        }
        break
      case 'APPROVED':
        requireAdminPair()
        if (
          review.fromState !== 'IN_REVIEW' ||
          review.toState !== 'APPROVED' ||
          review.reason !== null
        ) {
          addIssue(
            context,
            ['action'],
            'APPROVED evidence matrix가 일치하지 않습니다.'
          )
        }
        break
      case 'APPROVAL_WITHDRAWN':
        requireAdminPair()
        if (
          review.fromState !== 'APPROVED' ||
          review.toState !== 'CHANGES_REQUESTED' ||
          review.reason === null
        ) {
          addIssue(
            context,
            ['action'],
            'APPROVAL_WITHDRAWN evidence matrix가 일치하지 않습니다.'
          )
        }
        break
      case 'PUBLISHED':
        requireAdminPair(false)
        if (
          review.fromState !== 'APPROVED' ||
          review.toState !== 'PUBLISHED' ||
          review.reason !== null ||
          review.comment !== null
        ) {
          addIssue(
            context,
            ['action'],
            'PUBLISHED evidence matrix가 일치하지 않습니다.'
          )
        }
        break
      case 'RETIRED':
        if (
          review.actor.kind !== 'ACCOUNT' ||
          review.actor.role !== 'ADMIN' ||
          review.counterpart !== null ||
          review.fromState !== 'PUBLISHED' ||
          review.toState !== 'RETIRED' ||
          ![
            'PUBLISHED_REPLACEMENT',
            'PUBLISHED_RETIREMENT',
            'QUESTION_ARCHIVE'
          ].includes(review.reason ?? '') ||
          review.comment !== null
        ) {
          addIssue(
            context,
            ['action'],
            'RETIRED evidence matrix가 일치하지 않습니다.'
          )
        }
        break
      case 'ARCHIVE_ABANDONED':
        requireAdminPair(false)
        if (
          !['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
            review.fromState
          ) ||
          review.toState !== 'RETIRED' ||
          review.reason !== 'QUESTION_ARCHIVE' ||
          review.comment !== null
        ) {
          addIssue(
            context,
            ['action'],
            'ARCHIVE_ABANDONED evidence matrix가 일치하지 않습니다.'
          )
        }
        break
      case 'AUTHOR_ERASURE_ABANDONED':
        if (
          review.actor.kind !== 'SYSTEM' ||
          review.counterpart?.role !== 'ADMIN' ||
          !review.counterpart.label.startsWith('DELETED_') ||
          !['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(
            review.fromState
          ) ||
          review.toState !== 'RETIRED' ||
          review.reason !== 'AUTHOR_ERASURE' ||
          review.comment !== null
        ) {
          addIssue(
            context,
            ['action'],
            'AUTHOR_ERASURE evidence matrix가 일치하지 않습니다.'
          )
        }
        break
    }
  })

export const adminQuestionVersionConnectionSchema = z
  .object({
    questionId: opaqueIdSchema,
    items: z.array(adminQuestionVersionSummarySchema).max(100),
    nextCursor: adminQuestionVersionCursorSchema.nullable()
  })
  .strict()

export const contentReviewConnectionSchema = z
  .object({
    questionVersionId: opaqueIdSchema,
    items: z.array(adminContentReviewItemSchema).max(100),
    nextCursor: phase7OccurredAtCursorSchema.nullable()
  })
  .strict()

export const adminAuditCommandSchema = z.enum([
  'QUESTION_CREATE',
  'QUESTION_VERSION_CREATE',
  'QUESTION_VERSION_UPDATE',
  'REVIEW_REQUEST',
  'CHANGE_REQUEST',
  'APPROVAL',
  'APPROVAL_WITHDRAWAL',
  'PUBLICATION',
  'RETIREMENT',
  'QUESTION_ARCHIVE',
  'REVIEW_REQUEST_BATCH',
  'IMPORT_APPLY',
  'EXPORT',
  'REPORT_TRIAGE',
  'REPORT_RESOLUTION',
  'REAUTHENTICATION',
  'AUTHOR_ERASURE_ABANDON'
])

export const adminQuestionDetailSchema = z
  .object({
    question: z
      .object({
        questionId: opaqueIdSchema,
        lifecycleStatus: questionLifecycleStatusSchema,
        rowVersion: positiveSafeIntegerSchema,
        currentPublishedVersionId: opaqueIdSchema.nullable(),
        openCandidateVersionId: opaqueIdSchema.nullable(),
        createdAt: isoDateTimeSchema,
        updatedAt: isoDateTimeSchema
      })
      .strict(),
    versions: adminQuestionVersionConnectionSchema.extend({
      items: z.array(adminQuestionVersionSummarySchema).max(20)
    }),
    auditSummary: z
      .object({
        lastCommand: adminAuditCommandSchema.nullable(),
        lastActor: safeActorSnapshotSchema.nullable(),
        lastOccurredAt: isoDateTimeSchema.nullable(),
        totalCount: nonNegativeSafeIntegerSchema
      })
      .strict()
  })
  .strict()
  .superRefine((detail, context) => {
    if (detail.question.questionId !== detail.versions.questionId) {
      addIssue(
        context,
        ['versions', 'questionId'],
        'detail questionId와 일치해야 합니다.'
      )
    }
    if (
      Date.parse(detail.question.createdAt) >
      Date.parse(detail.question.updatedAt)
    ) {
      addIssue(
        context,
        ['question', 'updatedAt'],
        'updatedAt은 createdAt보다 빠를 수 없습니다.'
      )
    }
    const emptyAudit = detail.auditSummary.totalCount === 0
    const allLastNull =
      detail.auditSummary.lastCommand === null &&
      detail.auditSummary.lastActor === null &&
      detail.auditSummary.lastOccurredAt === null
    if (emptyAudit !== allLastNull) {
      addIssue(
        context,
        ['auditSummary'],
        'audit count와 last projection이 일치해야 합니다.'
      )
    }
  })

export type AdminTagSummary = z.output<typeof adminTagSummarySchema>
export type AdminQuestionSummary = z.output<typeof adminQuestionSummarySchema>
export type AdminQuestionVersionSummary = z.output<
  typeof adminQuestionVersionSummarySchema
>
export type AdminContentReviewItem = z.output<
  typeof adminContentReviewItemSchema
>
export type AdminQuestionVersionConnection = z.output<
  typeof adminQuestionVersionConnectionSchema
>
export type ContentReviewConnection = z.output<
  typeof contentReviewConnectionSchema
>
export type AdminQuestionDetail = z.output<typeof adminQuestionDetailSchema>
export type AdminAuditCommand = z.output<typeof adminAuditCommandSchema>

export { adminActorSnapshotSchema, positiveSafeIntegerSchema }
