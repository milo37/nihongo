import { z } from 'zod'
import { compareUnicodeScalars } from '@nihongo/domain/content/validators/v1/unicode'
import { parseSshEd25519PublicKey } from './sshsigVerifier.js'
import {
  contributorRefSchema,
  positiveSafeIntegerSchema,
  sha256Schema,
  utcTimestampSchema
} from './schemaHelpers.js'

const canonicalSshEd25519PublicKeySchema = z
  .string()
  .regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/)

const contributorSchema = z
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

const WORKSPACE_PACKAGE_MANIFEST_PATHS = [
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
export type ContributorsRegistryV1 = z.infer<typeof contributorsRegistrySchema>
