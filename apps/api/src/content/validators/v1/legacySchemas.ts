import { z } from 'zod'
import {
  compareUnicodeScalars,
  isNfc
} from '@nihongo/domain/content/validators/v1/unicode'
import { canonicalSelfHash } from './canonicalHash.js'
import {
  contentKeySchema,
  positiveSafeIntegerSchema,
  sha256Schema,
  uuidSchema
} from './schemaHelpers.js'
import { validatorRuntimeManifestSchema } from './policySchemas.js'

export const LEGACY_SEED_SOURCE_PATHS = [
  'apps/api/prisma/seed-data/buildQuestionSeed.ts',
  'apps/api/prisma/seed-data/contentReview.ts',
  'apps/api/prisma/seed-data/id.ts',
  'apps/api/prisma/seed-data/questions/createQuestion.ts',
  'apps/api/prisma/seed-data/questions/index.ts',
  'apps/api/prisma/seed-data/questions/n1.ts',
  'apps/api/prisma/seed-data/questions/n2.ts',
  'apps/api/prisma/seed-data/questions/n3.ts',
  'apps/api/prisma/seed-data/questions/n4.ts',
  'apps/api/prisma/seed-data/questions/n5.ts'
] as const

export const legacySeedSourceFileSchema = z
  .object({
    repositoryPath: z
      .string()
      .regex(/^apps\/api\/prisma\/seed-data\/[A-Za-z0-9._/-]+\.ts$/),
    byteLength: positiveSafeIntegerSchema,
    sha256: sha256Schema
  })
  .strict()

export const legacySeedSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('LEGACY_SEED_SOURCE_MANIFEST_V1'),
    files: z.array(legacySeedSourceFileSchema).min(1),
    seedSourceManifestSha256: sha256Schema
  })
  .strict()
  .superRefine((value, context) => {
    const paths = value.files.map(({ repositoryPath }) => repositoryPath)
    const ordered = paths.toSorted(compareUnicodeScalars)
    const pathsValid = paths.every((repositoryPath) => {
      const segments = repositoryPath.split('/')
      return (
        isNfc(repositoryPath) &&
        !repositoryPath.includes('\\') &&
        segments.every(
          (segment) => segment !== '' && segment !== '.' && segment !== '..'
        )
      )
    })
    if (!pathsValid) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_SOURCE_PATH_INVALID',
        path: ['files']
      })
    }
    if (
      paths.some(
        (repositoryPath, index) => repositoryPath !== ordered[index]
      ) ||
      new Set(paths).size !== paths.length ||
      new Set(paths.map((repositoryPath) => repositoryPath.toLowerCase()))
        .size !== paths.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_SOURCE_ORDER_OR_DUPLICATE',
        path: ['files']
      })
    }
    if (
      paths.length !== LEGACY_SEED_SOURCE_PATHS.length ||
      paths.some(
        (repositoryPath, index) =>
          repositoryPath !== LEGACY_SEED_SOURCE_PATHS[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_SOURCE_EXACT_SET',
        path: ['files']
      })
    }
    let selfHashValid = false
    try {
      selfHashValid =
        canonicalSelfHash(value, 'seedSourceManifestSha256') ===
        value.seedSourceManifestSha256
    } catch {
      selfHashValid = false
    }
    if (!selfHashValid) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_SOURCE_SELF_HASH',
        path: ['seedSourceManifestSha256']
      })
    }
  })

export const legacySeedMappingItemSchema = z
  .object({
    legacySeedId: contentKeySchema,
    contentKey: contentKeySchema,
    questionId: uuidSchema
  })
  .strict()

export const legacySeedMappingManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('LEGACY_SEED_MAPPING_MANIFEST_V1'),
    items: z.array(legacySeedMappingItemSchema).length(65),
    legacySeedMappingSha256: sha256Schema
  })
  .strict()
  .superRefine((value, context) => {
    const contentKeys = value.items.map(({ contentKey }) => contentKey)
    const ordered = contentKeys.toSorted(compareUnicodeScalars)
    const legacyIds = new Set<string>()
    const questionIds = new Set<string>()
    for (const [index, item] of value.items.entries()) {
      if (item.legacySeedId !== item.contentKey) {
        context.addIssue({
          code: 'custom',
          message: 'LEGACY_MAPPING_KEY_MISMATCH',
          path: ['items', index]
        })
      }
      if (
        legacyIds.has(item.legacySeedId) ||
        questionIds.has(item.questionId)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'LEGACY_MAPPING_DUPLICATE',
          path: ['items', index]
        })
      }
      legacyIds.add(item.legacySeedId)
      questionIds.add(item.questionId)
    }
    if (
      contentKeys.some((contentKey, index) => contentKey !== ordered[index]) ||
      new Set(contentKeys).size !== contentKeys.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_MAPPING_ORDER_OR_DUPLICATE',
        path: ['items']
      })
    }
    let selfHashValid = false
    try {
      selfHashValid =
        canonicalSelfHash(value, 'legacySeedMappingSha256') ===
        value.legacySeedMappingSha256
    } catch {
      selfHashValid = false
    }
    if (!selfHashValid) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_MAPPING_SELF_HASH',
        path: ['legacySeedMappingSha256']
      })
    }
  })

export const legacySeedManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifactKind: z.literal('LEGACY_SEED_MANIFEST_V1'),
    releaseKey: z.literal('legacy-system-seed-v1'),
    releaseRevision: z.literal(1),
    globalReviewSha256: sha256Schema,
    seedSourceManifestSha256: sha256Schema,
    legacySeedMappingSha256: sha256Schema,
    items: z
      .array(
        z
          .object({
            contentKey: contentKeySchema,
            semanticContentSha256: sha256Schema,
            globalReviewSha256: sha256Schema
          })
          .strict()
      )
      .length(65)
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.items.map(({ contentKey }) => contentKey)
    const ordered = keys.toSorted(compareUnicodeScalars)
    if (
      keys.some((contentKey, index) => contentKey !== ordered[index]) ||
      new Set(keys).size !== keys.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_MANIFEST_ORDER_OR_DUPLICATE',
        path: ['items']
      })
    }
    for (const [index, item] of value.items.entries()) {
      if (item.globalReviewSha256 !== value.globalReviewSha256) {
        context.addIssue({
          code: 'custom',
          message: 'LEGACY_MANIFEST_GLOBAL_REVIEW_MISMATCH',
          path: ['items', index, 'globalReviewSha256']
        })
      }
    }
  })

export const legacyValidatorSourceKeySchema = z.enum([
  'legacy-seed-manifest-schema',
  'legacy-seed-source-manifest-schema',
  'legacy-seed-mapping-manifest-schema',
  'legacy-policy-snapshot-schema',
  'legacy-jcs-hash',
  'legacy-seed-source-projector',
  'legacy-content-key-mapping',
  'persisted-semantic-projector',
  'policy-owner-sshsig-verifier'
])

export const LEGACY_VALIDATOR_SOURCE_KEYS = [
  'legacy-content-key-mapping',
  'legacy-jcs-hash',
  'legacy-policy-snapshot-schema',
  'legacy-seed-manifest-schema',
  'legacy-seed-mapping-manifest-schema',
  'legacy-seed-source-manifest-schema',
  'legacy-seed-source-projector',
  'persisted-semantic-projector',
  'policy-owner-sshsig-verifier'
] as const

export const LEGACY_LOGICAL_VALIDATOR_SOURCES = [
  {
    key: 'legacy-content-key-mapping',
    repositoryPath: 'apps/api/prisma/phase6Slice1LegacyProjection.ts'
  },
  {
    key: 'legacy-jcs-hash',
    repositoryPath:
      'packages/domain/src/content/validators/v1/canonical-json.ts'
  },
  {
    key: 'legacy-policy-snapshot-schema',
    repositoryPath: 'apps/api/src/content/validators/v1/legacySchemas.ts'
  },
  {
    key: 'legacy-seed-manifest-schema',
    repositoryPath: 'apps/api/src/content/validators/v1/legacySchemas.ts'
  },
  {
    key: 'legacy-seed-mapping-manifest-schema',
    repositoryPath: 'apps/api/src/content/validators/v1/legacySchemas.ts'
  },
  {
    key: 'legacy-seed-source-manifest-schema',
    repositoryPath: 'apps/api/src/content/validators/v1/legacySchemas.ts'
  },
  {
    key: 'legacy-seed-source-projector',
    repositoryPath: 'apps/api/src/content/validators/v1/legacySeedProjector.ts'
  },
  {
    key: 'persisted-semantic-projector',
    repositoryPath: 'apps/api/src/content/validators/v1/legacySeedProjector.ts'
  },
  {
    key: 'policy-owner-sshsig-verifier',
    repositoryPath: 'apps/api/src/content/validators/v1/sshsigVerifier.ts'
  }
] as const

const legacyValidatorRepositoryPathSchema = z
  .string()
  .regex(/^(?:apps|packages)\/[A-Za-z0-9._/-]+\.ts$/)

export const legacySeedPolicySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('LEGACY_SEED_POLICY_SNAPSHOT_V1'),
    canonicalizationVersion: z.literal('rfc8785-nihongo-v1'),
    globalReviewSha256: sha256Schema,
    seedSourceManifestSha256: sha256Schema,
    legacySeedMappingSha256: sha256Schema,
    validatorRuntimeManifest: validatorRuntimeManifestSchema,
    validatorSources: z.array(
      z
        .object({
          key: legacyValidatorSourceKeySchema,
          repositoryPath: legacyValidatorRepositoryPathSchema,
          sha256: sha256Schema
        })
        .strict()
    )
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.validatorSources.map(({ key }) => key)
    if (
      keys.length !== LEGACY_VALIDATOR_SOURCE_KEYS.length ||
      keys.some((key, index) => key !== LEGACY_VALIDATOR_SOURCE_KEYS[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_VALIDATOR_SOURCE_SET_OR_ORDER',
        path: ['validatorSources']
      })
    }
    if (
      value.validatorSources.some((source, index) => {
        const expected = LEGACY_LOGICAL_VALIDATOR_SOURCES[index]
        return (
          expected === undefined ||
          source.key !== expected.key ||
          source.repositoryPath !== expected.repositoryPath
        )
      })
    ) {
      context.addIssue({
        code: 'custom',
        message: 'LEGACY_VALIDATOR_LOGICAL_PATH_BINDING',
        path: ['validatorSources']
      })
    }
  })

export type LegacySeedSourceManifestV1 = z.infer<
  typeof legacySeedSourceManifestSchema
>
export type LegacySeedMappingManifestV1 = z.infer<
  typeof legacySeedMappingManifestSchema
>
export type LegacySeedManifestV1 = z.infer<typeof legacySeedManifestSchema>
export type LegacySeedPolicySnapshotV1 = z.infer<
  typeof legacySeedPolicySnapshotSchema
>
