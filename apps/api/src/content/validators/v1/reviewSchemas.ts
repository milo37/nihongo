import { z } from 'zod'
import {
  contentDifficultySchema,
  contentLevelSchema,
  contentQuestionTypeSchema,
  contentSubjectSchema,
  originalQuestionContentSchema,
  persistedQuestionSemanticSchema,
  tagFamilySchema
} from './contentSchemas.js'
import {
  contentKeySchema,
  contributorRefSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  releaseKeySchema,
  sha256Schema,
  unicodeScalarStringSchema,
  utcTimestampSchema,
  uuidSchema
} from './schemaHelpers.js'

export const duplicateRuleIdSchema = z.enum([
  'QUESTION_PASSAGE_TRIGRAM_V1',
  'QUESTION_TEXT_EDIT_V1',
  'READING_PASSAGE_TRIGRAM_V1'
])

export const catalogVersionCandidateSchema = z
  .object({
    kind: z.literal('CATALOG_VERSION'),
    contentKey: contentKeySchema,
    versionNumber: positiveSafeIntegerSchema,
    duplicateIdentitySha256: sha256Schema
  })
  .strict()

export const bundleItemCandidateSchema = z
  .object({
    kind: z.literal('BUNDLE_ITEM'),
    contentKey: contentKeySchema,
    itemSha256: sha256Schema,
    duplicateIdentitySha256: sha256Schema
  })
  .strict()

export const duplicateCandidateSchema = z.discriminatedUnion('kind', [
  catalogVersionCandidateSchema,
  bundleItemCandidateSchema
])

const scoreFields = {
  ruleId: duplicateRuleIdSchema,
  scoreNumerator: nonNegativeSafeIntegerSchema,
  scoreDenominator: positiveSafeIntegerSchema,
  scoreBasisPoints: nonNegativeSafeIntegerSchema.max(10000)
} as const

const validateScore = (
  value: {
    readonly scoreNumerator: number
    readonly scoreDenominator: number
    readonly scoreBasisPoints: number
  },
  context: z.RefinementCtx
): void => {
  if (
    !Number.isSafeInteger(value.scoreNumerator) ||
    value.scoreNumerator < 0 ||
    !Number.isSafeInteger(value.scoreDenominator) ||
    value.scoreDenominator < 1 ||
    !Number.isSafeInteger(value.scoreBasisPoints) ||
    value.scoreBasisPoints < 0
  ) {
    return
  }
  if (
    value.scoreNumerator > value.scoreDenominator ||
    value.scoreBasisPoints !==
      Number(
        (10000n * BigInt(value.scoreNumerator)) / BigInt(value.scoreDenominator)
      )
  ) {
    context.addIssue({ code: 'custom', message: 'DUPLICATE_SCORE_INVALID' })
  }
}

export const duplicateWarningSchema = z
  .object({
    candidate: duplicateCandidateSchema,
    ...scoreFields
  })
  .strict()
  .superRefine(validateScore)

export const duplicateReviewPlanItemSchema = z
  .object({
    contentKey: contentKeySchema,
    itemSha256: sha256Schema,
    warnings: z.array(duplicateWarningSchema).max(100)
  })
  .strict()

export const duplicateReviewPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    bundleSha256: sha256Schema,
    policySnapshotSha256: sha256Schema,
    catalogSha256: sha256Schema,
    duplicateCorpusSha256: sha256Schema,
    reviewEvidenceSha256: sha256Schema,
    createdAt: utcTimestampSchema,
    items: z.array(duplicateReviewPlanItemSchema).min(1).max(25),
    duplicateReviewPlanSha256: sha256Schema
  })
  .strict()

export const duplicateReviewEvidenceBaseSchema = z
  .object({
    kind: z.literal('CURRENT_VERSION'),
    versionNumber: positiveSafeIntegerSchema,
    semanticContentSha256: sha256Schema,
    duplicateIdentitySha256: sha256Schema,
    content: persistedQuestionSemanticSchema
  })
  .strict()

export const duplicateReviewEvidenceCandidateSchema = z
  .object({
    candidate: duplicateCandidateSchema,
    content: persistedQuestionSemanticSchema
  })
  .strict()

export const duplicateReviewEvidenceItemSchema = z
  .object({
    contentKey: contentKeySchema,
    itemSha256: sha256Schema,
    proposedContent: originalQuestionContentSchema,
    base: duplicateReviewEvidenceBaseSchema.nullable(),
    warningCandidates: z.array(duplicateReviewEvidenceCandidateSchema).max(100)
  })
  .strict()

const catalogDigestQuestionSchema = z
  .object({
    contentKey: contentKeySchema,
    lifecycleStatus: z.enum(['ACTIVE', 'ARCHIVED']),
    currentPublishedVersionNumber: positiveSafeIntegerSchema.nullable(),
    currentSemanticContentSha256: sha256Schema.nullable()
  })
  .strict()

export const catalogDigestSchema = z
  .object({
    schemaVersion: z.literal(1),
    questions: z.array(catalogDigestQuestionSchema).max(100_000)
  })
  .strict()

const duplicateCorpusDigestVersionSchema = z
  .object({
    contentKey: contentKeySchema,
    lifecycleStatus: z.enum(['ACTIVE', 'ARCHIVED']),
    versionNumber: positiveSafeIntegerSchema,
    versionStatus: z.enum(['PUBLISHED', 'RETIRED']),
    semanticContentSha256: sha256Schema,
    duplicateIdentitySha256: sha256Schema
  })
  .strict()

export const duplicateCorpusDigestSchema = z
  .object({
    schemaVersion: z.literal(1),
    qualityRulesVersion: z.literal('quality-rules-v1'),
    versions: z.array(duplicateCorpusDigestVersionSchema).max(100_000)
  })
  .strict()

export const duplicateCorpusEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    qualityRulesVersion: z.literal('quality-rules-v1'),
    versions: z
      .array(
        duplicateCorpusDigestVersionSchema.extend({
          content: persistedQuestionSemanticSchema
        })
      )
      .max(100_000)
  })
  .strict()

export const duplicateReviewEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    bundleSha256: sha256Schema,
    policySnapshotSha256: sha256Schema,
    catalogSha256: sha256Schema,
    duplicateCorpusSha256: sha256Schema,
    items: z.array(duplicateReviewEvidenceItemSchema).min(1).max(25),
    reviewEvidenceSha256: sha256Schema
  })
  .strict()

export const reviewChecksSchema = z
  .object({
    naturalJapanese: z.literal(true),
    singleCorrectAnswer: z.literal(true),
    distractorsUnambiguous: z.literal(true),
    distractorRationalesAccurate: z.literal(true),
    levelFit: z.literal(true),
    questionTypeFormatValid: z.literal(true),
    passageSelfContained: z.literal(true),
    explanationSufficient: z.literal(true),
    tagsAccurate: z.literal(true),
    originalNoCopy: z.literal(true),
    duplicateReviewComplete: z.literal(true),
    noPersonalDataOrSecrets: z.literal(true)
  })
  .strict()

export const revisionChecksSchema = z
  .object({
    learningObjectivePreserved: z.literal(true),
    correctAnswerMeaningPreserved: z.literal(true)
  })
  .strict()

export const nearDuplicateDispositionSchema = z
  .object({
    candidate: duplicateCandidateSchema,
    ...scoreFields,
    qualityRulesVersion: z.literal('quality-rules-v1'),
    decision: z.enum([
      'DISTINCT_LEARNING_OBJECTIVE',
      'PEDAGOGICALLY_NECESSARY_VARIANT'
    ]),
    reviewerRef: contributorRefSchema,
    reason: unicodeScalarStringSchema(20, 500)
  })
  .strict()
  .superRefine(validateScore)

export const reviewCertificateItemSchema = z
  .object({
    contentKey: contentKeySchema,
    semanticContentSha256: sha256Schema,
    itemSha256: sha256Schema,
    authorRef: contributorRefSchema,
    reviewerRef: contributorRefSchema,
    status: z.literal('APPROVED'),
    rubricVersion: z.literal('review-rubric-v1'),
    checks: reviewChecksSchema,
    revisionChecks: revisionChecksSchema.nullable(),
    nearDuplicateDispositions: z.array(nearDuplicateDispositionSchema).max(100)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.authorRef === value.reviewerRef) {
      context.addIssue({
        code: 'custom',
        message: 'AUTHOR_REVIEWER_MUST_DIFFER',
        path: ['reviewerRef']
      })
    }
    if (
      value.nearDuplicateDispositions.some(
        ({ reviewerRef }) => reviewerRef !== value.reviewerRef
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'DISPOSITION_REVIEWER_MISMATCH',
        path: ['nearDuplicateDispositions']
      })
    }
  })

export const reviewCertificateSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseKey: releaseKeySchema,
    releaseRevision: positiveSafeIntegerSchema,
    bundleSha256: sha256Schema,
    duplicateReviewPlanSha256: sha256Schema,
    reviewEvidenceSha256: sha256Schema,
    reviewedAt: utcTimestampSchema,
    items: z.array(reviewCertificateItemSchema).min(1).max(25)
  })
  .strict()
  .superRefine((value, context) => {
    const authors = new Set(value.items.map(({ authorRef }) => authorRef))
    const reviewers = new Set(value.items.map(({ reviewerRef }) => reviewerRef))
    const contentKeys = new Set(value.items.map(({ contentKey }) => contentKey))
    if (authors.size !== 1 || reviewers.size !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'CERTIFICATE_BATCH_PRINCIPAL_MISMATCH',
        path: ['items']
      })
    }
    if (contentKeys.size !== value.items.length) {
      context.addIssue({
        code: 'custom',
        message: 'CERTIFICATE_ITEM_DUPLICATE',
        path: ['items']
      })
    }
  })

export const releaseApprovalReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseKey: releaseKeySchema,
    releaseRevision: positiveSafeIntegerSchema,
    policySnapshotSha256: sha256Schema,
    policyActivationRevision: positiveSafeIntegerSchema,
    policyActivationSha256: sha256Schema,
    policyActivationOwnerSignatureSha256: sha256Schema,
    bundleSha256: sha256Schema,
    duplicateReviewPlanSha256: sha256Schema,
    reviewEvidenceSha256: sha256Schema,
    certificateSha256: sha256Schema,
    authorSignatureSha256: sha256Schema,
    reviewerSignatureSha256: sha256Schema,
    authorRef: contributorRefSchema,
    reviewerRef: contributorRefSchema,
    anchoredAt: utcTimestampSchema,
    approvalReceiptSha256: sha256Schema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.authorRef === value.reviewerRef) {
      context.addIssue({
        code: 'custom',
        message: 'AUTHOR_REVIEWER_MUST_DIFFER',
        path: ['reviewerRef']
      })
    }
  })

export const contentCoverageSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogSha256: sha256Schema,
    evidenceLedgerSequence: positiveSafeIntegerSchema,
    evidenceLedgerReleaseSha256: sha256Schema,
    coverageEvidenceSha256: sha256Schema,
    total: nonNegativeSafeIntegerSchema,
    byLevelSubject: z.array(
      z
        .object({
          level: contentLevelSchema,
          subject: contentSubjectSchema,
          count: nonNegativeSafeIntegerSchema
        })
        .strict()
    ),
    byLevelSubjectType: z.array(
      z
        .object({
          level: contentLevelSchema,
          subject: contentSubjectSchema,
          questionType: contentQuestionTypeSchema,
          applicable: z.boolean(),
          count: nonNegativeSafeIntegerSchema
        })
        .strict()
    ),
    byLevelSubjectDifficulty: z.array(
      z
        .object({
          level: contentLevelSchema,
          subject: contentSubjectSchema,
          difficulty: contentDifficultySchema,
          count: nonNegativeSafeIntegerSchema
        })
        .strict()
    ),
    byLevelSubjectTagFamily: z.array(
      z
        .object({
          level: contentLevelSchema,
          subject: contentSubjectSchema,
          family: tagFamilySchema,
          count: nonNegativeSafeIntegerSchema
        })
        .strict()
    ),
    legacyOutOfProfileContentKeys: z.array(contentKeySchema)
  })
  .strict()

export const contentReleasePlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseKey: releaseKeySchema,
    releaseRevision: positiveSafeIntegerSchema,
    bundleSha256: sha256Schema,
    certificateSha256: sha256Schema,
    duplicateReviewPlanSha256: sha256Schema,
    reviewEvidenceSha256: sha256Schema,
    authorSignatureSha256: sha256Schema,
    reviewerSignatureSha256: sha256Schema,
    approvalReceiptSha256: sha256Schema,
    approvalOwnerSignatureSha256: sha256Schema,
    policyActivationRevision: positiveSafeIntegerSchema,
    policyActivationSha256: sha256Schema,
    policyActivationOwnerSignatureSha256: sha256Schema,
    policySnapshotSha256: sha256Schema,
    policyOwnerSignatureSha256: sha256Schema,
    releaseSha256: sha256Schema,
    target: z.enum(['test', 'development', 'staging', 'production']),
    targetFingerprintSha256: sha256Schema,
    operatorRequestId: uuidSchema,
    expectedLedgerSequence: positiveSafeIntegerSchema,
    expectedPreviousReleaseId: uuidSchema,
    expectedPreviousReleaseSha256: sha256Schema,
    catalogBeforeSha256: sha256Schema,
    duplicateCorpusBeforeSha256: sha256Schema,
    actions: z.array(
      z
        .object({
          ordinal: positiveSafeIntegerSchema,
          contentKey: contentKeySchema,
          action: z.enum(['CREATE', 'NEW_VERSION', 'NO_CHANGE']),
          expectedCurrentVersionNumber: positiveSafeIntegerSchema.nullable(),
          expectedCurrentSemanticContentSha256: sha256Schema.nullable(),
          semanticContentSha256: sha256Schema,
          itemSha256: sha256Schema
        })
        .strict()
    ),
    projectedCatalogAfterSha256: sha256Schema,
    projectedDuplicateCorpusAfterSha256: sha256Schema,
    coverageBefore: contentCoverageSummarySchema,
    coverageAfter: contentCoverageSummarySchema,
    createdAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    planSha256: sha256Schema
  })
  .strict()
