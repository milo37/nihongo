import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { readArtifactBytes, readArtifactJson } from './artifactReader.js'
import {
  canonicalJsonBytes,
  canonicalJsonSha256,
  sha256Bytes
} from './canonicalHash.js'
import {
  LEGACY_LOGICAL_VALIDATOR_SOURCES,
  type LegacySeedManifestV1,
  type LegacySeedMappingManifestV1,
  type LegacySeedPolicySnapshotV1,
  type LegacySeedSourceManifestV1,
  legacySeedManifestSchema,
  legacySeedMappingManifestSchema,
  legacySeedPolicySnapshotSchema,
  legacySeedSourceManifestSchema
} from './legacySchemas.js'
import {
  policyOwnerSignaturePayloadSchema,
  type ValidatorRuntimeManifestV1,
  validatorRuntimeManifestSchema
} from './policySchemas.js'
import {
  POLICY_OWNER_IDENTITY,
  PolicyVerificationError,
  verifyRuntimeManifestFiles
} from './policyVerifier.js'
import {
  parseSshEd25519PublicKey,
  verifySshSignature
} from './sshsigVerifier.js'
import { parseStrictJsonBytes } from './strictJson.js'

export interface LegacyStaticArtifactsV1 {
  readonly sourceManifest: LegacySeedSourceManifestV1
  readonly mappingManifest: LegacySeedMappingManifestV1
  readonly legacyManifest: LegacySeedManifestV1
}

export interface BuiltLegacyPolicyArtifactsV1 {
  readonly snapshot: LegacySeedPolicySnapshotV1
  readonly policySnapshotSha256: string
  readonly snapshotBytes: Buffer
  readonly ownerSignaturePayloadBytes: Buffer
}

export interface VerifiedLegacyPolicySnapshotV1
  extends BuiltLegacyPolicyArtifactsV1 {
  readonly runtimeManifest: ValidatorRuntimeManifestV1
}

export const readLegacyStaticArtifacts = async (
  repositoryRoot: string
): Promise<LegacyStaticArtifactsV1> => {
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
    throw new PolicyVerificationError(
      'POLICY_CONTENT_INVALID',
      'legacy manifest binding이 일치하지 않습니다.'
    )
  }
  const mappingKeys = mappingManifest.items.map(({ contentKey }) => contentKey)
  const manifestKeys = legacyManifest.items.map(({ contentKey }) => contentKey)
  if (canonicalizeJson(mappingKeys) !== canonicalizeJson(manifestKeys)) {
    throw new PolicyVerificationError(
      'POLICY_CONTENT_INVALID',
      'legacy mapping과 manifest contentKey가 일치하지 않습니다.'
    )
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
      throw new PolicyVerificationError(
        'POLICY_SOURCE_DRIFT',
        'legacy source manifest의 raw source binding이 일치하지 않습니다.'
      )
    }
  }
  return { sourceManifest, mappingManifest, legacyManifest }
}

const buildValidatorSources = async (repositoryRoot: string) =>
  Promise.all(
    LEGACY_LOGICAL_VALIDATOR_SOURCES.map(async ({ key, repositoryPath }) => ({
      key,
      repositoryPath,
      sha256: sha256Bytes(
        await readArtifactBytes({
          repositoryRoot,
          filePath: repositoryPath,
          maximumBytes: 10 * 1024 * 1024
        })
      )
    }))
  )

export interface BuildLegacyPolicyArtifactsInput {
  readonly repositoryRoot: string
  readonly validatorSourceRoot?: string
  readonly rootKeyFingerprintSha256: string
  readonly runtimeManifest?: ValidatorRuntimeManifestV1
  readonly staticArtifacts?: LegacyStaticArtifactsV1
}

export const buildLegacyPolicyArtifacts = async ({
  repositoryRoot,
  validatorSourceRoot = repositoryRoot,
  rootKeyFingerprintSha256,
  runtimeManifest: inputRuntimeManifest,
  staticArtifacts: inputStaticArtifacts
}: BuildLegacyPolicyArtifactsInput): Promise<BuiltLegacyPolicyArtifactsV1> => {
  const staticArtifacts =
    inputStaticArtifacts ?? (await readLegacyStaticArtifacts(repositoryRoot))
  const runtimeManifest = validatorRuntimeManifestSchema.parse(
    inputRuntimeManifest ??
      (await readArtifactJson({
        repositoryRoot,
        filePath: 'content/runtime/validator-runtime-manifest.v1.json',
        maximumBytes: 10 * 1024 * 1024
      }))
  )
  const snapshot = legacySeedPolicySnapshotSchema.parse({
    schemaVersion: 1,
    kind: 'LEGACY_SEED_POLICY_SNAPSHOT_V1',
    canonicalizationVersion: 'rfc8785-nihongo-v1',
    globalReviewSha256: staticArtifacts.legacyManifest.globalReviewSha256,
    seedSourceManifestSha256:
      staticArtifacts.sourceManifest.seedSourceManifestSha256,
    legacySeedMappingSha256:
      staticArtifacts.mappingManifest.legacySeedMappingSha256,
    validatorRuntimeManifest: runtimeManifest,
    validatorSources: await buildValidatorSources(validatorSourceRoot)
  })
  const snapshotBytes = canonicalJsonBytes(snapshot)
  const policySnapshotSha256 = canonicalJsonSha256(snapshot)
  const ownerPayload = policyOwnerSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'POLICY_OWNER',
    policySnapshotSha256,
    rootKeyFingerprintSha256
  })
  return {
    snapshot,
    policySnapshotSha256,
    snapshotBytes,
    ownerSignaturePayloadBytes: canonicalJsonBytes(ownerPayload)
  }
}

export interface VerifyLegacyPolicySnapshotInput {
  readonly repositoryRoot: string
  readonly snapshotBytes: Uint8Array
  readonly signature: Uint8Array
  readonly ownerPublicKey: string
  readonly expectedRootFingerprintSha256: string
  readonly expectedPolicySnapshotSha256?: string
}

export const verifyLegacyPolicySnapshot = async ({
  repositoryRoot,
  snapshotBytes: inputSnapshotBytes,
  signature,
  ownerPublicKey,
  expectedRootFingerprintSha256,
  expectedPolicySnapshotSha256
}: VerifyLegacyPolicySnapshotInput): Promise<VerifiedLegacyPolicySnapshotV1> => {
  const snapshot = legacySeedPolicySnapshotSchema.parse(
    parseStrictJsonBytes(inputSnapshotBytes)
  )
  const snapshotBytes = canonicalJsonBytes(snapshot)
  if (!Buffer.from(inputSnapshotBytes).equals(snapshotBytes)) {
    throw new PolicyVerificationError(
      'POLICY_CONTENT_INVALID',
      'legacy policy snapshot raw bytes가 canonical JCS bytes와 다릅니다.'
    )
  }
  const policySnapshotSha256 = sha256Bytes(snapshotBytes)
  if (
    expectedPolicySnapshotSha256 !== undefined &&
    policySnapshotSha256 !== expectedPolicySnapshotSha256
  ) {
    throw new PolicyVerificationError(
      'POLICY_DIGEST_MISMATCH',
      'legacy policy snapshot digest가 expected digest와 다릅니다.'
    )
  }
  const parsedRoot = parseSshEd25519PublicKey(ownerPublicKey)
  if (parsedRoot.fingerprintSha256 !== expectedRootFingerprintSha256) {
    throw new PolicyVerificationError(
      'POLICY_ROOT_MISMATCH',
      'legacy policy owner root fingerprint가 일치하지 않습니다.'
    )
  }
  const ownerPayload = policyOwnerSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'POLICY_OWNER',
    policySnapshotSha256,
    rootKeyFingerprintSha256: expectedRootFingerprintSha256
  })
  await verifySshSignature({
    payload: canonicalJsonBytes(ownerPayload),
    signature,
    publicKey: parsedRoot.canonical,
    expectedFingerprintSha256: expectedRootFingerprintSha256,
    identity: POLICY_OWNER_IDENTITY,
    namespace: 'nihongo-policy-v1'
  })

  const trackedRuntimeManifest = validatorRuntimeManifestSchema.parse(
    await readArtifactJson({
      repositoryRoot,
      filePath: 'content/runtime/validator-runtime-manifest.v1.json',
      maximumBytes: 10 * 1024 * 1024
    })
  )
  if (
    canonicalizeJson(trackedRuntimeManifest) !==
    canonicalizeJson(snapshot.validatorRuntimeManifest)
  ) {
    throw new PolicyVerificationError(
      'POLICY_RUNTIME_DRIFT',
      'legacy policy runtime manifest가 tracked runtime과 다릅니다.'
    )
  }
  const expected = await buildLegacyPolicyArtifacts({
    repositoryRoot,
    validatorSourceRoot:
      process.env.CONTENT_RETAINED_RUNTIME === '1'
        ? '/opt/validator'
        : repositoryRoot,
    rootKeyFingerprintSha256: expectedRootFingerprintSha256,
    runtimeManifest: trackedRuntimeManifest
  })
  if (
    expected.policySnapshotSha256 !== policySnapshotSha256 ||
    !expected.snapshotBytes.equals(snapshotBytes)
  ) {
    throw new PolicyVerificationError(
      'POLICY_SOURCE_DRIFT',
      'legacy policy source 또는 artifact binding이 일치하지 않습니다.'
    )
  }
  await verifyRuntimeManifestFiles(repositoryRoot, trackedRuntimeManifest)
  return {
    snapshot,
    policySnapshotSha256,
    snapshotBytes,
    ownerSignaturePayloadBytes: canonicalJsonBytes(ownerPayload),
    runtimeManifest: snapshot.validatorRuntimeManifest
  }
}
