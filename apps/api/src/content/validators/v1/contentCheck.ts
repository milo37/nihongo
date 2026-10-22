import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { readArtifactBytes, readArtifactJson } from './artifactReader.js'
import { sha256Bytes } from './canonicalHash.js'
import {
  verifyLegacyPolicySnapshot,
  type VerifiedLegacyPolicySnapshotV1
} from './legacyPolicyVerifier.js'
import {
  legacySeedManifestSchema,
  legacySeedMappingManifestSchema,
  legacySeedSourceManifestSchema
} from './legacySchemas.js'
import {
  buildPolicyArtifacts,
  type BuiltPolicyArtifactsV1
} from './policyArtifacts.js'
import {
  verifyPolicySnapshot,
  type VerifiedPolicySnapshotV1
} from './policyVerifier.js'
import {
  contributorsRegistrySchema,
  validatorRuntimeManifestSchema,
  type ContributorsRegistryV1,
  type ReleasePolicySnapshotV1
} from './policySchemas.js'
import { parseSshEd25519PublicKeyFile } from './sshsigVerifier.js'
import { parseStrictJsonBytes } from './strictJson.js'

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  Buffer.from(left).equals(Buffer.from(right))

export const assertOperationalContributorEnrollment = (
  registry: ContributorsRegistryV1
): void => {
  const authors = registry.contributors.filter(
    (contributor) => contributor.active && contributor.roles.includes('AUTHOR')
  )
  const reviewers = registry.contributors.filter(
    (contributor) =>
      contributor.active && contributor.roles.includes('REVIEWER')
  )
  const hasSeparatedPair = authors.some((author) =>
    reviewers.some(
      (reviewer) =>
        author.contributorRef !== reviewer.contributorRef &&
        author.sshPublicKey !== reviewer.sshPublicKey &&
        author.sshKeyFingerprintSha256 !== reviewer.sshKeyFingerprintSha256
    )
  )
  if (!hasSeparatedPair) {
    throw new Error('CONTRIBUTOR_OPERATIONAL_ENROLLMENT_REQUIRED')
  }
}

export const assertOperationalPolicySnapshotEnrollment = (
  snapshot: ReleasePolicySnapshotV1
): void => {
  const registryFile = snapshot.files.find(
    (file) => file.key === 'contributors-registry'
  )
  if (
    registryFile === undefined ||
    registryFile.mediaType !== 'application/json'
  ) {
    throw new Error('CONTRIBUTOR_OPERATIONAL_ENROLLMENT_REQUIRED')
  }
  const registry = contributorsRegistrySchema.parse(
    parseStrictJsonBytes(Buffer.from(registryFile.canonicalContent, 'utf8'))
  )
  assertOperationalContributorEnrollment(registry)
}

export interface VerifyStaticContentArtifactsInput {
  readonly repositoryRoot: string
  readonly rootKeyFingerprintSha256: string
}

export interface VerifiedStaticContentArtifactsV1 {
  readonly policyArtifacts: BuiltPolicyArtifactsV1
  readonly legacyItemCount: number
}

export interface VerifiedTrackedPolicySnapshotsV1 {
  readonly normal: ReadonlyMap<string, VerifiedPolicySnapshotV1>
  readonly legacy: ReadonlyMap<string, VerifiedLegacyPolicySnapshotV1>
}

const isLegacyPolicySnapshot = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  value.kind === 'LEGACY_SEED_POLICY_SNAPSHOT_V1'

export const verifyTrackedPolicySnapshots = async ({
  repositoryRoot,
  rootKeyFingerprintSha256
}: VerifyStaticContentArtifactsInput): Promise<VerifiedTrackedPolicySnapshotsV1> => {
  const policyDirectory = resolve(repositoryRoot, 'content/policy-snapshots')
  const directoryEntries = await readdir(policyDirectory, {
    withFileTypes: true
  })
  const snapshotDigests = new Set<string>()
  const signatureDigests = new Set<string>()
  for (const entry of directoryEntries) {
    const match = /^([a-f0-9]{64})(\.json|\.owner\.sshsig)$/.exec(entry.name)
    if (!entry.isFile() || match === null) {
      throw new Error('POLICY_SNAPSHOT_LAYOUT_INVALID')
    }
    const digest = match[1]
    if (digest === undefined) {
      throw new Error('POLICY_SNAPSHOT_LAYOUT_INVALID')
    }
    const target = match[2] === '.json' ? snapshotDigests : signatureDigests
    if (target.has(digest)) {
      throw new Error('POLICY_SNAPSHOT_LAYOUT_INVALID')
    }
    target.add(digest)
  }
  if (
    snapshotDigests.size === 0 ||
    snapshotDigests.size !== signatureDigests.size ||
    [...snapshotDigests].some((digest) => !signatureDigests.has(digest))
  ) {
    throw new Error('POLICY_SNAPSHOT_PAIR_MISSING')
  }

  const rootKeyBytes = await readArtifactBytes({
    repositoryRoot,
    filePath: 'content/trust/policy-owner-root.v1.pub',
    maximumBytes: 4 * 1024
  })
  const ownerPublicKey = parseSshEd25519PublicKeyFile(rootKeyBytes).canonical
  const normal = new Map<string, VerifiedPolicySnapshotV1>()
  const legacy = new Map<string, VerifiedLegacyPolicySnapshotV1>()
  for (const digest of [...snapshotDigests].toSorted()) {
    const [snapshotBytes, signature] = await Promise.all([
      readArtifactBytes({
        repositoryRoot,
        filePath: `content/policy-snapshots/${digest}.json`,
        maximumBytes: 10 * 1024 * 1024
      }),
      readArtifactBytes({
        repositoryRoot,
        filePath: `content/policy-snapshots/${digest}.owner.sshsig`,
        maximumBytes: 64 * 1024
      })
    ])
    const parsed = parseStrictJsonBytes(snapshotBytes)
    if (isLegacyPolicySnapshot(parsed)) {
      legacy.set(
        digest,
        await verifyLegacyPolicySnapshot({
          repositoryRoot,
          snapshotBytes,
          signature,
          ownerPublicKey,
          expectedRootFingerprintSha256: rootKeyFingerprintSha256,
          expectedPolicySnapshotSha256: digest
        })
      )
    } else {
      normal.set(
        digest,
        await verifyPolicySnapshot({
          repositoryRoot,
          snapshotBytes,
          signature,
          ownerPublicKey,
          expectedRootFingerprintSha256: rootKeyFingerprintSha256,
          expectedPolicySnapshotSha256: digest
        })
      )
    }
  }
  if (normal.size < 1 || legacy.size !== 1) {
    throw new Error('POLICY_SNAPSHOT_REQUIRED_SET_INVALID')
  }
  return { normal, legacy }
}

export const verifyStaticContentArtifacts = async ({
  repositoryRoot,
  rootKeyFingerprintSha256
}: VerifyStaticContentArtifactsInput): Promise<VerifiedStaticContentArtifactsV1> => {
  const runtimeManifest = validatorRuntimeManifestSchema.parse(
    await readArtifactJson({
      repositoryRoot,
      filePath: 'content/runtime/validator-runtime-manifest.v1.json',
      maximumBytes: 10 * 1024 * 1024
    })
  )
  const policyArtifacts = await buildPolicyArtifacts({
    repositoryRoot,
    runtimeImageIndexSha256: runtimeManifest.runtimeImageIndexSha256,
    postgresImageSha256: runtimeManifest.postgresImageSha256,
    rootKeyFingerprintSha256
  })
  const [sourceBytes, runtimeBytes, snapshotBytes] = await Promise.all([
    readArtifactBytes({
      repositoryRoot,
      filePath: 'content/runtime/validator-source-manifest.v1.json',
      maximumBytes: 10 * 1024 * 1024
    }),
    readArtifactBytes({
      repositoryRoot,
      filePath: 'content/runtime/validator-runtime-manifest.v1.json',
      maximumBytes: 10 * 1024 * 1024
    }),
    readArtifactBytes({
      repositoryRoot,
      filePath: `content/policy-snapshots/${policyArtifacts.policySnapshotSha256}.json`,
      maximumBytes: 10 * 1024 * 1024
    })
  ])
  if (
    !equalBytes(
      sourceBytes,
      Buffer.from(canonicalizeJson(policyArtifacts.sourceManifest), 'utf8')
    ) ||
    !equalBytes(
      runtimeBytes,
      Buffer.from(canonicalizeJson(policyArtifacts.runtimeManifest), 'utf8')
    ) ||
    !equalBytes(snapshotBytes, policyArtifacts.snapshotBytes)
  ) {
    throw new Error('CONTENT_STATIC_POLICY_DRIFT')
  }

  const [sourceManifest, mappingManifest, legacyManifest] = await Promise.all([
    readArtifactJson({
      repositoryRoot,
      filePath: 'content/legacy/legacy-seed-source-manifest.v1.json',
      maximumBytes: 5 * 1024 * 1024
    }).then((value) => legacySeedSourceManifestSchema.parse(value)),
    readArtifactJson({
      repositoryRoot,
      filePath: 'content/legacy/legacy-seed-mapping-manifest.v1.json',
      maximumBytes: 5 * 1024 * 1024
    }).then((value) => legacySeedMappingManifestSchema.parse(value)),
    readArtifactJson({
      repositoryRoot,
      filePath:
        'content/releases/legacy-system-seed-v1/1/legacy-seed-manifest.json',
      maximumBytes: 10 * 1024 * 1024
    }).then((value) => legacySeedManifestSchema.parse(value))
  ])
  if (
    legacyManifest.seedSourceManifestSha256 !==
      sourceManifest.seedSourceManifestSha256 ||
    legacyManifest.legacySeedMappingSha256 !==
      mappingManifest.legacySeedMappingSha256
  ) {
    throw new Error('LEGACY_MANIFEST_BINDING_INVALID')
  }
  for (const source of sourceManifest.files) {
    const bytes = await readArtifactBytes({
      repositoryRoot,
      filePath: source.repositoryPath,
      maximumBytes: 1024 * 1024
    })
    if (
      bytes.byteLength !== source.byteLength ||
      sha256Bytes(bytes) !== source.sha256
    ) {
      throw new Error('LEGACY_SOURCE_DRIFT')
    }
  }
  const mappingKeys = mappingManifest.items.map(({ contentKey }) => contentKey)
  const manifestKeys = legacyManifest.items.map(({ contentKey }) => contentKey)
  if (canonicalizeJson(mappingKeys) !== canonicalizeJson(manifestKeys)) {
    throw new Error('LEGACY_MANIFEST_BINDING_INVALID')
  }
  return {
    policyArtifacts,
    legacyItemCount: legacyManifest.items.length
  }
}
