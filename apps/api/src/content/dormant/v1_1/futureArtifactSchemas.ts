/**
 * Dormant Phase 6 v1.1 release/apply contracts.
 *
 * Phase 6 v1.0 foundation checks must not import or execute this module.
 */
import { z } from 'zod'
import { persistedQuestionSemanticSchema } from '../../validators/v1/contentSchemas.js'
import {
  contentKeySchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  releaseKeySchema,
  sha256Schema,
  utcTimestampSchema,
  uuidSchema
} from '../../validators/v1/schemaHelpers.js'

export const contentApplyResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseKey: releaseKeySchema,
    releaseRevision: positiveSafeIntegerSchema,
    releaseSha256: sha256Schema,
    approvalReceiptSha256: sha256Schema,
    approvalOwnerSignatureSha256: sha256Schema,
    policyActivationRevision: positiveSafeIntegerSchema,
    policyActivationSha256: sha256Schema,
    policyActivationOwnerSignatureSha256: sha256Schema,
    targetFingerprintSha256: sha256Schema,
    ledgerSequence: positiveSafeIntegerSchema,
    previousReleaseId: uuidSchema,
    previousReleaseSha256: sha256Schema,
    operatorRequestId: uuidSchema,
    approvalReferenceSnapshot: z
      .string()
      .regex(/^[\x20-\x7e]{1,200}$/)
      .nullable(),
    catalogBeforeSha256: sha256Schema,
    catalogAfterSha256: sha256Schema,
    duplicateCorpusBeforeSha256: sha256Schema,
    duplicateCorpusAfterSha256: sha256Schema,
    counts: z
      .object({
        created: nonNegativeSafeIntegerSchema,
        versioned: nonNegativeSafeIntegerSchema,
        noChange: nonNegativeSafeIntegerSchema
      })
      .strict(),
    items: z.array(
      z
        .object({
          ordinal: positiveSafeIntegerSchema,
          contentKey: contentKeySchema,
          action: z.enum(['CREATE', 'NEW_VERSION', 'NO_CHANGE']),
          versionNumber: positiveSafeIntegerSchema,
          semanticContentSha256: sha256Schema,
          itemSha256: sha256Schema
        })
        .strict()
    ),
    appliedAt: utcTimestampSchema,
    actorKind: z.literal('ADMIN'),
    actorAuditRef: uuidSchema
  })
  .strict()

const compensationSourceFields = {
  sourceAppliedQuestionVersionId: uuidSchema,
  sourceAppliedVersionNumber: positiveSafeIntegerSchema,
  sourceAppliedSemanticContentSha256: sha256Schema,
  contentKey: contentKeySchema,
  currentVersionNumber: positiveSafeIntegerSchema,
  currentSemanticContentSha256: sha256Schema
} as const

export const forwardCompensationItemSchema = z.union([
  z
    .object({
      sourceAction: z.literal('NEW_VERSION'),
      ...compensationSourceFields,
      proposedLastGoodVersionNumber: positiveSafeIntegerSchema,
      proposedContent: persistedQuestionSemanticSchema,
      proposedSemanticContentSha256: sha256Schema,
      disposition: z.literal('NEW_VERSION_CANDIDATE')
    })
    .strict(),
  z
    .object({
      sourceAction: z.literal('NEW_VERSION'),
      ...compensationSourceFields,
      disposition: z.literal('SOURCE_NO_LONGER_CURRENT_REQUIRES_MANUAL_REVIEW')
    })
    .strict(),
  z
    .object({
      sourceAction: z.literal('CREATE'),
      sourceAppliedQuestionVersionId: uuidSchema,
      sourceAppliedVersionNumber: z.literal(1),
      sourceAppliedSemanticContentSha256: sha256Schema,
      contentKey: contentKeySchema,
      currentVersionNumber: positiveSafeIntegerSchema,
      currentSemanticContentSha256: sha256Schema,
      disposition: z.literal(
        'NO_PRIOR_VERSION_REQUIRES_PHASE7_ARCHIVE_OR_HUMAN_REPLACEMENT'
      )
    })
    .strict(),
  z
    .object({
      sourceAction: z.literal('NO_CHANGE'),
      contentKey: contentKeySchema,
      currentVersionNumber: positiveSafeIntegerSchema,
      currentSemanticContentSha256: sha256Schema,
      disposition: z.literal('NO_CONTENT_COMPENSATION')
    })
    .strict()
])

export const forwardCompensationProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceReleaseKey: releaseKeySchema,
    sourceReleaseRevision: positiveSafeIntegerSchema,
    targetFingerprintSha256: sha256Schema,
    terminalLedgerSequence: positiveSafeIntegerSchema,
    terminalReleaseId: uuidSchema,
    terminalReleaseSha256: sha256Schema,
    catalogSha256: sha256Schema,
    createdAt: utcTimestampSchema,
    items: z.array(forwardCompensationItemSchema),
    proposalSha256: sha256Schema
  })
  .strict()
