import { z } from 'zod'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import {
  containsForbiddenControlCharacter,
  isNfc
} from '@nihongo/domain/content/validators/v1/unicode'
import { readArtifactBytes } from './artifactReader.js'
import {
  canonicalJsonBytes,
  canonicalJsonSha256,
  sha256Bytes
} from './canonicalHash.js'
import {
  type InternalBetaCoverageV1,
  type QualityRulesV1,
  type TagTaxonomyV1,
  contentBundleSchema,
  internalBetaCoverageSchema,
  qualityRulesSchema,
  tagTaxonomySchema
} from './contentSchemas.js'
import {
  type ContributorsRegistryV1,
  contributorsRegistrySchema,
  policyActivationOwnerSignaturePayloadSchema,
  policyActivationSchema,
  policyOwnerSignaturePayloadSchema,
  releasePolicySnapshotSchema,
  validatorRuntimeManifestSchema,
  validatorSourceManifestSchema,
  type ReleasePolicySnapshotV1,
  type ValidatorRuntimeManifestV1
} from './policySchemas.js'
import {
  duplicateReviewPlanSchema,
  releaseApprovalReceiptSchema,
  reviewCertificateSchema
} from './reviewSchemas.js'
import { parseStrictJsonBytes } from './strictJson.js'
import {
  parseSshEd25519PublicKey,
  readOpenSshVersion,
  verifySshSignature
} from './sshsigVerifier.js'

export const POLICY_OWNER_IDENTITY = 'policy-owner'

export type PolicyVerificationErrorCode =
  | 'POLICY_ACTIVATION_INVALID'
  | 'POLICY_CONTENT_INVALID'
  | 'POLICY_DIGEST_MISMATCH'
  | 'POLICY_ROOT_MISMATCH'
  | 'POLICY_RUNTIME_DRIFT'
  | 'POLICY_SOURCE_DRIFT'

export class PolicyVerificationError extends Error {
  readonly code: PolicyVerificationErrorCode

  constructor(code: PolicyVerificationErrorCode, message: string) {
    super(message)
    this.name = 'PolicyVerificationError'
    this.code = code
  }
}

const parseCanonicalJsonContent = (value: string): unknown => {
  const parsed = parseStrictJsonBytes(Buffer.from(value, 'utf8'))
  if (canonicalizeJson(parsed) !== value) {
    throw new PolicyVerificationError(
      'POLICY_CONTENT_INVALID',
      'policy JSON canonicalContent가 JCS와 일치하지 않습니다.'
    )
  }
  return parsed
}

const validateCanonicalPolicyContent = (
  snapshot: ReleasePolicySnapshotV1
): Map<ReleasePolicySnapshotV1['files'][number]['key'], unknown> => {
  const parsed = new Map<
    ReleasePolicySnapshotV1['files'][number]['key'],
    unknown
  >()
  for (const file of snapshot.files) {
    const contentBytes = Buffer.from(file.canonicalContent, 'utf8')
    if (sha256Bytes(contentBytes) !== file.sha256) {
      throw new PolicyVerificationError(
        'POLICY_DIGEST_MISMATCH',
        'policy canonical content digest가 일치하지 않습니다.'
      )
    }
    if (file.mediaType === 'application/json') {
      parsed.set(file.key, parseCanonicalJsonContent(file.canonicalContent))
    } else {
      if (
        file.canonicalContent.startsWith('\uFEFF') ||
        file.canonicalContent.includes('\r') ||
        !file.canonicalContent.endsWith('\n') ||
        !isNfc(file.canonicalContent) ||
        containsForbiddenControlCharacter(file.canonicalContent)
      ) {
        throw new PolicyVerificationError(
          'POLICY_CONTENT_INVALID',
          'policy Markdown은 UTF-8/LF/NFC와 terminal LF가 필요합니다.'
        )
      }
      parsed.set(file.key, file.canonicalContent)
    }
  }

  validatorSourceManifestSchema.parse(parsed.get('validator-source-manifest'))
  validatorRuntimeManifestSchema.parse(parsed.get('validator-runtime-manifest'))
  contributorsRegistrySchema.parse(parsed.get('contributors-registry'))
  tagTaxonomySchema.parse(parsed.get('tag-taxonomy'))
  qualityRulesSchema.parse(parsed.get('quality-rules'))
  internalBetaCoverageSchema.parse(parsed.get('internal-beta-coverage'))

  const expectedGeneratedSchemas = [
    [
      'content-bundle-schema',
      z.toJSONSchema(contentBundleSchema, { target: 'draft-7' })
    ],
    [
      'duplicate-review-plan-schema',
      z.toJSONSchema(duplicateReviewPlanSchema, { target: 'draft-7' })
    ],
    [
      'review-certificate-schema',
      z.toJSONSchema(reviewCertificateSchema, { target: 'draft-7' })
    ],
    [
      'release-approval-receipt-schema',
      z.toJSONSchema(releaseApprovalReceiptSchema, { target: 'draft-7' })
    ],
    [
      'policy-activation-schema',
      z.toJSONSchema(policyActivationSchema, { target: 'draft-7' })
    ]
  ] as const
  for (const [key, expectedSchema] of expectedGeneratedSchemas) {
    const plainExpectedSchema = parseStrictJsonBytes(
      Buffer.from(JSON.stringify(expectedSchema), 'utf8')
    )
    if (
      canonicalizeJson(parsed.get(key)) !==
      canonicalizeJson(plainExpectedSchema)
    ) {
      throw new PolicyVerificationError(
        'POLICY_CONTENT_INVALID',
        'generated JSON Schema가 retained executable Zod schema와 다릅니다.'
      )
    }
  }
  return parsed
}

export interface VerifyPolicySnapshotInput {
  readonly repositoryRoot: string
  readonly snapshotBytes: Uint8Array
  readonly signature: Uint8Array
  readonly ownerPublicKey: string
  readonly expectedRootFingerprintSha256: string
  readonly expectedPolicySnapshotSha256?: string
}

export interface VerifiedPolicySnapshotV1 {
  readonly snapshot: ReleasePolicySnapshotV1
  readonly policySnapshotSha256: string
  readonly canonicalBytes: Buffer
  readonly runtimeManifest: ValidatorRuntimeManifestV1
  readonly sourceManifest: z.infer<typeof validatorSourceManifestSchema>
  readonly contributorsRegistry: ContributorsRegistryV1
  readonly taxonomy: TagTaxonomyV1
  readonly qualityRules: QualityRulesV1
  readonly internalBetaCoverage: InternalBetaCoverageV1
}

export const verifyRuntimeManifestFiles = async (
  repositoryRoot: string,
  runtimeManifest: ValidatorRuntimeManifestV1
): Promise<void> => {
  const runtimeFilesRoot =
    process.env.CONTENT_RETAINED_RUNTIME === '1'
      ? '/opt/validator'
      : repositoryRoot
  if (
    process.versions.node !== runtimeManifest.nodeVersion ||
    process.versions.icu !== runtimeManifest.icuVersion ||
    process.versions.unicode !== runtimeManifest.unicodeVersion ||
    (await readOpenSshVersion()) !== runtimeManifest.openSshVersion ||
    process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256 !==
      runtimeManifest.runtimeImageIndexSha256 ||
    process.env.CONTENT_POSTGRES_IMAGE_SHA256 !==
      runtimeManifest.postgresImageSha256
  ) {
    throw new PolicyVerificationError(
      'POLICY_RUNTIME_DRIFT',
      '실행 중인 Node/ICU/Unicode runtime이 manifest와 다릅니다.'
    )
  }
  const lockBytes = await readArtifactBytes({
    repositoryRoot: runtimeFilesRoot,
    filePath: 'pnpm-lock.yaml',
    maximumBytes: 10 * 1024 * 1024
  })
  if (sha256Bytes(lockBytes) !== runtimeManifest.pnpmLockSha256) {
    throw new PolicyVerificationError(
      'POLICY_RUNTIME_DRIFT',
      'pnpm lock digest가 runtime manifest와 다릅니다.'
    )
  }
  for (const manifest of runtimeManifest.workspacePackageManifestSha256s) {
    const bytes = await readArtifactBytes({
      repositoryRoot: runtimeFilesRoot,
      filePath: manifest.path,
      maximumBytes: 1024 * 1024
    })
    if (sha256Bytes(bytes) !== manifest.sha256) {
      throw new PolicyVerificationError(
        'POLICY_RUNTIME_DRIFT',
        'workspace package manifest digest가 일치하지 않습니다.'
      )
    }
  }
}

export const verifyPolicySnapshot = async ({
  repositoryRoot,
  snapshotBytes: inputSnapshotBytes,
  signature,
  ownerPublicKey,
  expectedRootFingerprintSha256,
  expectedPolicySnapshotSha256
}: VerifyPolicySnapshotInput): Promise<VerifiedPolicySnapshotV1> => {
  const snapshot = releasePolicySnapshotSchema.parse(
    parseStrictJsonBytes(inputSnapshotBytes)
  )
  const canonicalBytes = canonicalJsonBytes(snapshot)
  if (!Buffer.from(inputSnapshotBytes).equals(canonicalBytes)) {
    throw new PolicyVerificationError(
      'POLICY_CONTENT_INVALID',
      'policy snapshot raw bytes가 canonical JCS bytes와 다릅니다.'
    )
  }
  const policySnapshotSha256 = sha256Bytes(canonicalBytes)
  if (
    expectedPolicySnapshotSha256 !== undefined &&
    policySnapshotSha256 !== expectedPolicySnapshotSha256
  ) {
    throw new PolicyVerificationError(
      'POLICY_DIGEST_MISMATCH',
      'policy snapshot digest가 expected digest와 다릅니다.'
    )
  }
  const parsedRoot = parseSshEd25519PublicKey(ownerPublicKey)
  if (parsedRoot.fingerprintSha256 !== expectedRootFingerprintSha256) {
    throw new PolicyVerificationError(
      'POLICY_ROOT_MISMATCH',
      'policy owner root fingerprint가 일치하지 않습니다.'
    )
  }
  const parsedContent = validateCanonicalPolicyContent(snapshot)
  const contributorsRegistry = contributorsRegistrySchema.parse(
    parsedContent.get('contributors-registry')
  )
  if (
    contributorsRegistry.contributors.some((contributor) => {
      const parsedContributor = parseSshEd25519PublicKey(
        contributor.sshPublicKey
      )
      return (
        parsedContributor.blob.equals(parsedRoot.blob) ||
        parsedContributor.fingerprintSha256 === parsedRoot.fingerprintSha256
      )
    })
  ) {
    throw new PolicyVerificationError(
      'POLICY_ROOT_MISMATCH',
      'policy owner root key는 contributor key로 재사용할 수 없습니다.'
    )
  }
  const signaturePayload = policyOwnerSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'POLICY_OWNER',
    policySnapshotSha256,
    rootKeyFingerprintSha256: expectedRootFingerprintSha256
  })
  await verifySshSignature({
    payload: canonicalJsonBytes(signaturePayload),
    signature,
    publicKey: parsedRoot.canonical,
    expectedFingerprintSha256: expectedRootFingerprintSha256,
    identity: POLICY_OWNER_IDENTITY,
    namespace: 'nihongo-policy-v1'
  })

  const sourceManifest = validatorSourceManifestSchema.parse(
    parsedContent.get('validator-source-manifest')
  )
  const validatorSourceRoot =
    process.env.CONTENT_RETAINED_RUNTIME === '1'
      ? '/opt/validator'
      : repositoryRoot
  for (const source of sourceManifest.files) {
    const bytes = await readArtifactBytes({
      repositoryRoot: validatorSourceRoot,
      filePath: source.repositoryPath,
      maximumBytes: 10 * 1024 * 1024
    })
    if (sha256Bytes(bytes) !== source.sha256) {
      throw new PolicyVerificationError(
        'POLICY_SOURCE_DRIFT',
        'retained validator source digest가 일치하지 않습니다.'
      )
    }
  }

  const runtimeManifest = validatorRuntimeManifestSchema.parse(
    parsedContent.get('validator-runtime-manifest')
  )
  await verifyRuntimeManifestFiles(repositoryRoot, runtimeManifest)

  return {
    snapshot,
    policySnapshotSha256,
    canonicalBytes,
    runtimeManifest,
    sourceManifest,
    contributorsRegistry,
    taxonomy: tagTaxonomySchema.parse(parsedContent.get('tag-taxonomy')),
    qualityRules: qualityRulesSchema.parse(parsedContent.get('quality-rules')),
    internalBetaCoverage: internalBetaCoverageSchema.parse(
      parsedContent.get('internal-beta-coverage')
    )
  }
}

export interface VerifyPolicyActivationInput {
  readonly activation: unknown
  readonly signature: Uint8Array
  readonly ownerPublicKey: string
  readonly expectedRootFingerprintSha256: string
  readonly expectedRevision: number
  readonly expectedActivationSha256: string
  readonly expectedPolicySnapshotSha256: string
}

export interface PolicyActivationChainEntryV1 {
  readonly activation: unknown
  readonly signature: Uint8Array
}

export interface VerifyPolicyActivationChainInput {
  readonly entries: readonly PolicyActivationChainEntryV1[]
  readonly conveniencePointer: unknown
  readonly ownerPublicKey: string
  readonly expectedRootFingerprintSha256: string
  readonly expectedTerminalRevision: number
  readonly expectedTerminalActivationSha256: string
}

export interface VerifiedPolicyActivationChainV1 {
  readonly activations: readonly ReturnType<
    typeof policyActivationSchema.parse
  >[]
  readonly terminal: ReturnType<typeof policyActivationSchema.parse>
}

export const verifyPolicyActivationChain = async ({
  entries,
  conveniencePointer: inputConveniencePointer,
  ownerPublicKey,
  expectedRootFingerprintSha256,
  expectedTerminalRevision,
  expectedTerminalActivationSha256
}: VerifyPolicyActivationChainInput): Promise<VerifiedPolicyActivationChainV1> => {
  if (entries.length < 1) {
    throw new PolicyVerificationError(
      'POLICY_ACTIVATION_INVALID',
      'policy activation chain이 비어 있습니다.'
    )
  }
  const parsedRoot = parseSshEd25519PublicKey(ownerPublicKey)
  if (parsedRoot.fingerprintSha256 !== expectedRootFingerprintSha256) {
    throw new PolicyVerificationError(
      'POLICY_ROOT_MISMATCH',
      'policy activation root fingerprint가 일치하지 않습니다.'
    )
  }

  const activations: Array<ReturnType<typeof policyActivationSchema.parse>> = []
  let previousActivatedAt = -1
  let previousActivationSha256: string | null = null
  for (const [index, entry] of entries.entries()) {
    const activation = policyActivationSchema.parse(entry.activation)
    const { activationSha256: _activationSha256, ...hashInput } = activation
    const activatedAt = Date.parse(activation.activatedAt)
    if (
      activation.activationRevision !== index + 1 ||
      activation.previousActivationSha256 !== previousActivationSha256 ||
      activation.rootEpoch !== 1 ||
      activatedAt <= previousActivatedAt ||
      canonicalJsonSha256(hashInput) !== activation.activationSha256
    ) {
      throw new PolicyVerificationError(
        'POLICY_ACTIVATION_INVALID',
        'policy activation chain revision/predecessor/time/rootEpoch가 유효하지 않습니다.'
      )
    }
    const payload = policyActivationOwnerSignaturePayloadSchema.parse({
      schemaVersion: 1,
      role: 'POLICY_ACTIVATOR',
      activationSha256: activation.activationSha256,
      rootKeyFingerprintSha256: expectedRootFingerprintSha256
    })
    await verifySshSignature({
      payload: canonicalJsonBytes(payload),
      signature: entry.signature,
      publicKey: parsedRoot.canonical,
      expectedFingerprintSha256: expectedRootFingerprintSha256,
      identity: POLICY_OWNER_IDENTITY,
      namespace: 'nihongo-policy-activation-v1'
    })
    activations.push(activation)
    previousActivatedAt = activatedAt
    previousActivationSha256 = activation.activationSha256
  }

  const terminal = activations.at(-1)
  const conveniencePointer = policyActivationSchema.parse(
    inputConveniencePointer
  )
  if (
    terminal === undefined ||
    terminal.activationRevision !== expectedTerminalRevision ||
    terminal.activationSha256 !== expectedTerminalActivationSha256 ||
    canonicalizeJson(conveniencePointer) !== canonicalizeJson(terminal)
  ) {
    throw new PolicyVerificationError(
      'POLICY_ACTIVATION_INVALID',
      'protected terminal anchor 또는 convenience pointer가 chain head와 다릅니다.'
    )
  }
  return { activations, terminal }
}

export const verifyPolicyActivation = async ({
  activation: inputActivation,
  signature,
  ownerPublicKey,
  expectedRootFingerprintSha256,
  expectedRevision,
  expectedActivationSha256,
  expectedPolicySnapshotSha256
}: VerifyPolicyActivationInput): Promise<void> => {
  const activation = policyActivationSchema.parse(inputActivation)
  const { activationSha256: _activationSha256, ...hashInput } = activation
  if (
    canonicalJsonSha256(hashInput) !== activation.activationSha256 ||
    activation.activationSha256 !== expectedActivationSha256 ||
    activation.activationRevision !== expectedRevision ||
    activation.policySnapshotSha256 !== expectedPolicySnapshotSha256
  ) {
    throw new PolicyVerificationError(
      'POLICY_ACTIVATION_INVALID',
      'policy activation binding이 일치하지 않습니다.'
    )
  }
  const payload = policyActivationOwnerSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'POLICY_ACTIVATOR',
    activationSha256: activation.activationSha256,
    rootKeyFingerprintSha256: expectedRootFingerprintSha256
  })
  await verifySshSignature({
    payload: canonicalJsonBytes(payload),
    signature,
    publicKey: ownerPublicKey,
    expectedFingerprintSha256: expectedRootFingerprintSha256,
    identity: POLICY_OWNER_IDENTITY,
    namespace: 'nihongo-policy-activation-v1'
  })
}
