import { z } from 'zod'

import {
  contentKeySchema,
  contributorRefSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  releaseKeySchema,
  sha256Schema,
  unicodeScalarStringSchema,
  utcTimestampSchema
} from './schemaHelpers.js'

const duplicateRuleIdSchema = z.enum([
  'QUESTION_PASSAGE_TRIGRAM_V1',
  'QUESTION_TEXT_EDIT_V1',
  'READING_PASSAGE_TRIGRAM_V1'
])

const catalogVersionCandidateSchema = z
  .object({
    kind: z.literal('CATALOG_VERSION'),
    contentKey: contentKeySchema,
    versionNumber: positiveSafeIntegerSchema,
    duplicateIdentitySha256: sha256Schema
  })
  .strict()

const bundleItemCandidateSchema = z
  .object({
    kind: z.literal('BUNDLE_ITEM'),
    contentKey: contentKeySchema,
    itemSha256: sha256Schema,
    duplicateIdentitySha256: sha256Schema
  })
  .strict()

const duplicateCandidateSchema = z.discriminatedUnion('kind', [
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

const duplicateWarningSchema = z
  .object({
    candidate: duplicateCandidateSchema,
    ...scoreFields
  })
  .strict()
  .superRefine(validateScore)

const duplicateReviewPlanItemSchema = z
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

const reviewChecksSchema = z
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

const revisionChecksSchema = z
  .object({
    learningObjectivePreserved: z.literal(true),
    correctAnswerMeaningPreserved: z.literal(true)
  })
  .strict()

const nearDuplicateDispositionSchema = z
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

const reviewCertificateItemSchema = z
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
