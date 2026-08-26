import { z } from 'zod'
import {
  compareUnicodeScalars,
  isNfc,
  normalizeTagKey
} from '@nihongo/domain/content/validators/v1/unicode'
import { parseSshEd25519PublicKey } from './sshsigVerifier.js'
import {
  contributorRefSchema,
  positiveSafeIntegerSchema,
  sha256Schema,
  utcTimestampSchema
} from './schemaHelpers.js'
import { VALIDATOR_SOURCE_PATHS_V1 } from './sourceManifest.js'

export const canonicalSshEd25519PublicKeySchema = z
  .string()
  .regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/)

export const contributorSchema = z
  .object({
    contributorRef: contributorRefSchema,
    roles: z
      .array(z.enum(['AUTHOR', 'REVIEWER']))
      .min(1)
      .max(2),
    active: z.boolean(),
    sshPublicKey: canonicalSshEd25519PublicKeySchema,
    sshKeyFingerprintSha256: sha256Schema
  })
  .strict()

export const contributorsRegistrySchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotRevision: positiveSafeIntegerSchema,
    contributors: z.array(contributorSchema)
  })
  .strict()
  .superRefine((value, context) => {
    const refs = new Set<string>()
    const activeKeys = new Set<string>()
    const activeFingerprints = new Set<string>()
    const orderedRefs = value.contributors
      .map(({ contributorRef }) => contributorRef)
      .toSorted(compareUnicodeScalars)
    for (const [index, contributor] of value.contributors.entries()) {
      if (contributor.contributorRef !== orderedRefs[index]) {
        context.addIssue({
          code: 'custom',
          message: 'CONTRIBUTOR_REF_ORDER',
          path: ['contributors', index, 'contributorRef']
        })
      }
      const validRoleOrder =
        (contributor.roles.length === 1 &&
          (contributor.roles[0] === 'AUTHOR' ||
            contributor.roles[0] === 'REVIEWER')) ||
        (contributor.roles.length === 2 &&
          contributor.roles[0] === 'AUTHOR' &&
          contributor.roles[1] === 'REVIEWER')
      if (!validRoleOrder) {
        context.addIssue({
          code: 'custom',
          message: 'CONTRIBUTOR_ROLE_ORDER_OR_DUPLICATE',
          path: ['contributors', index, 'roles']
        })
      }
      try {
        const parsed = parseSshEd25519PublicKey(contributor.sshPublicKey)
        if (parsed.fingerprintSha256 !== contributor.sshKeyFingerprintSha256) {
          context.addIssue({
            code: 'custom',
            message: 'CONTRIBUTOR_KEY_FINGERPRINT',
            path: ['contributors', index, 'sshKeyFingerprintSha256']
          })
        }
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'CONTRIBUTOR_PUBLIC_KEY_INVALID',
          path: ['contributors', index, 'sshPublicKey']
        })
      }
      if (refs.has(contributor.contributorRef)) {
        context.addIssue({
          code: 'custom',
          message: 'CONTRIBUTOR_REF_DUPLICATE',
          path: ['contributors', index, 'contributorRef']
        })
      }
      refs.add(contributor.contributorRef)
      if (!contributor.active) continue
      if (activeKeys.has(contributor.sshPublicKey)) {
        context.addIssue({
          code: 'custom',
          message: 'ACTIVE_CONTRIBUTOR_KEY_DUPLICATE',
          path: ['contributors', index, 'sshPublicKey']
        })
      }
      if (activeFingerprints.has(contributor.sshKeyFingerprintSha256)) {
        context.addIssue({
          code: 'custom',
          message: 'ACTIVE_CONTRIBUTOR_FINGERPRINT_DUPLICATE',
          path: ['contributors', index, 'sshKeyFingerprintSha256']
        })
      }
      activeKeys.add(contributor.sshPublicKey)
      activeFingerprints.add(contributor.sshKeyFingerprintSha256)
    }
  })

const validatorSourcePathSchema = z.string().superRefine((value, context) => {
  const segments = value.split('/')
  if (
    !isNfc(value) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    ) ||
    !/^(?:(?:apps|packages)\/[A-Za-z0-9._/-]+\.(?:ts|json)|scripts\/[A-Za-z0-9._/-]+\.mjs)$/.test(
      value
    )
  ) {
    context.addIssue({ code: 'custom', message: 'VALIDATOR_SOURCE_PATH' })
  }
})

export const validatorSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    validatorVersion: z.literal('v1'),
    files: z
      .array(
        z
          .object({
            repositoryPath: validatorSourcePathSchema,
            sha256: sha256Schema
          })
          .strict()
      )
      .min(1)
      .max(256)
  })
  .strict()
  .superRefine((value, context) => {
    const ordered = value.files
      .map(({ repositoryPath }) => repositoryPath)
      .toSorted(compareUnicodeScalars)
    if (
      value.files.some(
        ({ repositoryPath }, index) => repositoryPath !== ordered[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'VALIDATOR_SOURCE_ORDER',
        path: ['files']
      })
    }
    if (new Set(ordered).size !== ordered.length) {
      context.addIssue({
        code: 'custom',
        message: 'VALIDATOR_SOURCE_DUPLICATE',
        path: ['files']
      })
    }
    if (
      new Set(ordered.map((entry) => entry.toLowerCase())).size !==
      ordered.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'VALIDATOR_SOURCE_CASE_COLLISION',
        path: ['files']
      })
    }
    if (
      ordered.length !== VALIDATOR_SOURCE_PATHS_V1.length ||
      ordered.some(
        (repositoryPath, index) =>
          repositoryPath !== VALIDATOR_SOURCE_PATHS_V1[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'VALIDATOR_SOURCE_SET',
        path: ['files']
      })
    }
  })

export const WORKSPACE_PACKAGE_MANIFEST_PATHS = [
  'apps/api/package.json',
  'apps/web/package.json',
  'package.json',
  'packages/contracts/package.json',
  'packages/domain/package.json'
] as const

export const validatorRuntimeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeImageIndexSha256: sha256Schema,
    nodeVersion: z.literal('22.23.0'),
    icuVersion: z.literal('78.2'),
    unicodeVersion: z.literal('17.0'),
    pnpmVersion: z.literal('10.2.1'),
    pnpmLockSha256: sha256Schema,
    workspacePackageManifestSha256s: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(
                /^(?:package\.json|apps\/[a-z0-9-]+\/package\.json|packages\/[a-z0-9-]+\/package\.json)$/
              ),
            sha256: sha256Schema
          })
          .strict()
      )
      .length(WORKSPACE_PACKAGE_MANIFEST_PATHS.length),
    openSshVersion: z.literal('OpenSSH_9.9p2'),
    postgresVersion: z.literal('18.4'),
    postgresImageSha256: sha256Schema,
    requiredExtensions: z.tuple([]).meta({ minItems: 0, maxItems: 0 })
  })
  .strict()
  .superRefine((value, context) => {
    const paths = value.workspacePackageManifestSha256s.map(({ path }) => path)
    if (
      paths.some(
        (manifestPath, index) =>
          manifestPath !== WORKSPACE_PACKAGE_MANIFEST_PATHS[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'WORKSPACE_PACKAGE_MANIFEST_SET_OR_ORDER',
        path: ['workspacePackageManifestSha256s']
      })
    }
  })

export const releasePolicyFileKeySchema = z.enum([
  'content-bundle-schema',
  'duplicate-review-plan-schema',
  'review-certificate-schema',
  'release-approval-receipt-schema',
  'policy-activation-schema',
  'validator-source-manifest',
  'validator-runtime-manifest',
  'tag-taxonomy',
  'quality-rules',
  'review-rubric',
  'original-content-policy',
  'contributors-registry',
  'internal-beta-coverage'
])

const RELEASE_POLICY_MEDIA_TYPES = {
  'content-bundle-schema': 'application/json',
  'duplicate-review-plan-schema': 'application/json',
  'review-certificate-schema': 'application/json',
  'release-approval-receipt-schema': 'application/json',
  'policy-activation-schema': 'application/json',
  'validator-source-manifest': 'application/json',
  'validator-runtime-manifest': 'application/json',
  'tag-taxonomy': 'application/json',
  'quality-rules': 'application/json',
  'review-rubric': 'text/markdown',
  'original-content-policy': 'text/markdown',
  'contributors-registry': 'application/json',
  'internal-beta-coverage': 'application/json'
} as const

export const RELEASE_POLICY_FILE_KEYS = [
  'content-bundle-schema',
  'contributors-registry',
  'duplicate-review-plan-schema',
  'internal-beta-coverage',
  'original-content-policy',
  'policy-activation-schema',
  'quality-rules',
  'release-approval-receipt-schema',
  'review-certificate-schema',
  'review-rubric',
  'tag-taxonomy',
  'validator-runtime-manifest',
  'validator-source-manifest'
] as const

export const releasePolicySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    canonicalizationVersion: z.literal('rfc8785-nihongo-v1'),
    files: z.array(
      z
        .object({
          key: releasePolicyFileKeySchema,
          mediaType: z.enum(['application/json', 'text/markdown']),
          sha256: sha256Schema,
          canonicalContent: z
            .string()
            .min(1)
            .max(10 * 1024 * 1024)
        })
        .strict()
    )
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.files.map(({ key }) => key)
    if (
      keys.length !== RELEASE_POLICY_FILE_KEYS.length ||
      keys.some((key, index) => key !== RELEASE_POLICY_FILE_KEYS[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'POLICY_FILE_SET_OR_ORDER',
        path: ['files']
      })
    }
    for (const [index, file] of value.files.entries()) {
      if (file.mediaType !== RELEASE_POLICY_MEDIA_TYPES[file.key]) {
        context.addIssue({
          code: 'custom',
          message: 'POLICY_FILE_MEDIA_TYPE',
          path: ['files', index, 'mediaType']
        })
      }
    }
  })

export const policyOwnerSignaturePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('POLICY_OWNER'),
    policySnapshotSha256: sha256Schema,
    rootKeyFingerprintSha256: sha256Schema
  })
  .strict()

export const policyActivationSchema = z
  .object({
    schemaVersion: z.literal(1),
    activationRevision: positiveSafeIntegerSchema,
    policySnapshotSha256: sha256Schema,
    activatedAt: utcTimestampSchema,
    previousActivationSha256: sha256Schema.nullable(),
    rootEpoch: positiveSafeIntegerSchema,
    activationSha256: sha256Schema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.activationRevision === 1) !==
      (value.previousActivationSha256 === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'POLICY_ACTIVATION_PREDECESSOR',
        path: ['previousActivationSha256']
      })
    }
  })

export const policyActivationOwnerSignaturePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('POLICY_ACTIVATOR'),
    activationSha256: sha256Schema,
    rootKeyFingerprintSha256: sha256Schema
  })
  .strict()

export const authorSignaturePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('AUTHOR'),
    authorRef: contributorRefSchema,
    bundleSha256: sha256Schema,
    policySnapshotSha256: sha256Schema
  })
  .strict()

export const reviewerSignaturePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('REVIEWER'),
    reviewerRef: contributorRefSchema,
    bundleSha256: sha256Schema,
    duplicateReviewPlanSha256: sha256Schema,
    reviewEvidenceSha256: sha256Schema,
    certificateSha256: sha256Schema,
    policySnapshotSha256: sha256Schema
  })
  .strict()

export const releaseApprovalOwnerSignaturePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('RELEASE_APPROVER'),
    approvalReceiptSha256: sha256Schema,
    rootKeyFingerprintSha256: sha256Schema
  })
  .strict()

export const assertTaxonomyCanonicalKeys = (
  tags: readonly {
    readonly key: string
    readonly aliases: readonly string[]
  }[]
): readonly string[] => {
  const violations: string[] = []
  const targets = new Map<string, string>()

  for (const tag of tags) {
    if (normalizeTagKey(tag.key) !== tag.key) violations.push(tag.key)
    for (const source of [tag.key, ...tag.aliases]) {
      const normalized = normalizeTagKey(source)
      const previous = targets.get(normalized)
      if (previous !== undefined && previous !== tag.key) {
        violations.push(normalized)
      }
      targets.set(normalized, tag.key)
    }
  }

  return [...new Set(violations)].toSorted(compareUnicodeScalars)
}

export type ReleasePolicySnapshotV1 = z.infer<
  typeof releasePolicySnapshotSchema
>
export type ContributorsRegistryV1 = z.infer<typeof contributorsRegistrySchema>
export type ValidatorRuntimeManifestV1 = z.infer<
  typeof validatorRuntimeManifestSchema
>
