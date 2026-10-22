import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import {
  readArtifactBytes,
  readPrivateArtifactBytes
} from '../../validators/v1/artifactReader.js'
import {
  canonicalJsonBytes,
  canonicalJsonSha256,
  sha256Bytes
} from '../../validators/v1/canonicalHash.js'
import {
  getActiveContributor,
  readAndValidateBundle,
  verifyBundleAuthorSignature
} from '../../validators/v1/bundleValidator.js'
import {
  authorSignaturePayloadSchema,
  policyActivationOwnerSignaturePayloadSchema,
  policyActivationSchema
} from '../../validators/v1/policySchemas.js'
import {
  verifyPolicyActivation,
  verifyPolicySnapshot,
  verifyRuntimeManifestFiles
} from '../../validators/v1/policyVerifier.js'
import { buildPolicyArtifacts } from '../../validators/v1/policyArtifacts.js'
import {
  assertOperationalContributorEnrollment,
  assertOperationalPolicySnapshotEnrollment,
  verifyStaticContentArtifacts,
  verifyTrackedPolicySnapshots
} from '../../validators/v1/contentCheck.js'
import {
  buildLegacyPolicyArtifacts,
  verifyLegacyPolicySnapshot
} from '../../validators/v1/legacyPolicyVerifier.js'
import { verifyCanonicalLegacyProjectionInRetainedRuntime } from '../../validators/v1/retainedRuntime.js'
import { writeTrackedArtifact } from '../../validators/v1/trackedArtifactWriter.js'
import {
  prepareReviewArtifacts,
  readReviewArtifacts,
  validateReviewArtifacts
} from '../../validators/v1/reviewValidator.js'
import { parseSshEd25519PublicKeyFile } from '../../validators/v1/sshsigVerifier.js'
import { parseStrictJsonBytes } from '../../validators/v1/strictJson.js'
import {
  POLICY_OWNER_ROOT_FINGERPRINT_SHA256,
  configuredPolicyTerminalAnchor,
  emitCommandResult,
  loadVerifiedPolicy,
  loadVerifiedPolicySnapshot,
  parseCommandFlags,
  readPolicyActivationEntries,
  readPolicyConveniencePointerBytes,
  readOptionalPolicyConveniencePointerBytes,
  requiredFlag,
  resolveRepositoryRoot,
  verifyLoadedPolicyActivationChain,
  writePrivateOutput,
  writeSigningPayload,
  type PolicyTerminalAnchorV1
} from './commandSupport.js'

const POLICY_FLAGS = [
  '--bundle',
  '--policy-snapshot',
  '--policy-signature'
] as const

const loadBundleContext = async (flags: ReadonlyMap<`--${string}`, string>) => {
  const repositoryRoot = await resolveRepositoryRoot()
  const policy = await loadVerifiedPolicy(
    repositoryRoot,
    requiredFlag(flags, '--policy-snapshot'),
    requiredFlag(flags, '--policy-signature')
  )
  const bundle = await readAndValidateBundle(
    repositoryRoot,
    requiredFlag(flags, '--bundle'),
    policy,
    new Date()
  )
  return { repositoryRoot, policy, bundle }
}

export const runPolicyPrepare = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, [
    '--runtime-image-index-sha256',
    '--postgres-image-sha256',
    '--signature-payload-output'
  ])
  const repositoryRoot = await resolveRepositoryRoot()
  const artifacts = await buildPolicyArtifacts({
    repositoryRoot,
    runtimeImageIndexSha256: requiredFlag(
      flags,
      '--runtime-image-index-sha256'
    ),
    postgresImageSha256: requiredFlag(flags, '--postgres-image-sha256'),
    rootKeyFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256
  })
  const retainedArtifacts = await buildPolicyArtifacts({
    repositoryRoot: '/opt/validator',
    runtimeImageIndexSha256: artifacts.runtimeManifest.runtimeImageIndexSha256,
    postgresImageSha256: artifacts.runtimeManifest.postgresImageSha256,
    rootKeyFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256
  })
  if (!retainedArtifacts.snapshotBytes.equals(artifacts.snapshotBytes)) {
    throw new Error('POLICY_RETAINED_IMAGE_SOURCE_DRIFT')
  }
  assertOperationalPolicySnapshotEnrollment(artifacts.snapshot)
  await verifyRuntimeManifestFiles(repositoryRoot, artifacts.runtimeManifest)
  await writeSigningPayload(
    repositoryRoot,
    requiredFlag(flags, '--signature-payload-output'),
    artifacts.ownerSignaturePayloadBytes
  )
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: `content/policy-snapshots/${artifacts.policySnapshotSha256}.json`,
    bytes: artifacts.snapshotBytes,
    maximumBytes: 10 * 1024 * 1024
  })
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: 'content/runtime/validator-source-manifest.v1.json',
    bytes: Buffer.from(canonicalizeJson(artifacts.sourceManifest), 'utf8'),
    maximumBytes: 10 * 1024 * 1024
  })
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: 'content/runtime/validator-runtime-manifest.v1.json',
    bytes: Buffer.from(canonicalizeJson(artifacts.runtimeManifest), 'utf8'),
    maximumBytes: 10 * 1024 * 1024
  })
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:policy-prepare',
    status: 'PASS',
    policySnapshotSha256: artifacts.policySnapshotSha256,
    sourceFileCount: artifacts.sourceManifest.files.length
  })
}

export const runContentCheck = async (
  args: readonly string[]
): Promise<void> => {
  parseCommandFlags(args, [])
  const repositoryRoot = await resolveRepositoryRoot()
  const verifiedStatic = await verifyStaticContentArtifacts({
    repositoryRoot,
    rootKeyFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256
  })
  const legacyProjection =
    await verifyCanonicalLegacyProjectionInRetainedRuntime()
  const trackedPolicies = await verifyTrackedPolicySnapshots({
    repositoryRoot,
    rootKeyFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256
  })
  const { policySnapshotSha256, runtimeManifest } =
    verifiedStatic.policyArtifacts
  if (
    process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256 !==
      runtimeManifest.runtimeImageIndexSha256 ||
    process.env.CONTENT_POSTGRES_IMAGE_SHA256 !==
      runtimeManifest.postgresImageSha256
  ) {
    throw new Error('POLICY_RUNTIME_ATTESTATION_MISSING')
  }
  const verifiedPolicy = await loadVerifiedPolicy(
    repositoryRoot,
    `content/policy-snapshots/${policySnapshotSha256}.json`,
    `content/policy-snapshots/${policySnapshotSha256}.owner.sshsig`
  )
  if (verifiedPolicy.policySnapshotSha256 !== policySnapshotSha256) {
    throw new Error('CONTENT_STATIC_POLICY_DRIFT')
  }
  assertOperationalContributorEnrollment(verifiedPolicy.contributorsRegistry)
  const legacyPolicy = [...trackedPolicies.legacy.values()][0]
  if (
    !trackedPolicies.normal.has(policySnapshotSha256) ||
    legacyPolicy === undefined ||
    legacyPolicy.snapshot.seedSourceManifestSha256 !==
      legacyProjection.seedSourceManifestSha256 ||
    legacyPolicy.snapshot.legacySeedMappingSha256 !==
      legacyProjection.legacySeedMappingSha256 ||
    legacyPolicy.snapshot.globalReviewSha256 !==
      legacyProjection.globalReviewSha256
  ) {
    throw new Error('CONTENT_STATIC_POLICY_DRIFT')
  }
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:check',
    status: 'PASS',
    policySnapshotSha256,
    validatorSourceCount: verifiedPolicy.sourceManifest.files.length,
    trackedPolicySnapshotCount:
      trackedPolicies.normal.size + trackedPolicies.legacy.size,
    legacyItemCount: verifiedStatic.legacyItemCount
  })
}

export const runLegacyPolicyPrepare = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, ['--signature-payload-output'])
  const repositoryRoot = await resolveRepositoryRoot()
  const legacyProjection =
    await verifyCanonicalLegacyProjectionInRetainedRuntime()
  const artifacts = await buildLegacyPolicyArtifacts({
    repositoryRoot,
    rootKeyFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256
  })
  const retainedArtifacts = await buildLegacyPolicyArtifacts({
    repositoryRoot,
    validatorSourceRoot: '/opt/validator',
    rootKeyFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256
  })
  if (
    artifacts.snapshot.seedSourceManifestSha256 !==
      legacyProjection.seedSourceManifestSha256 ||
    artifacts.snapshot.legacySeedMappingSha256 !==
      legacyProjection.legacySeedMappingSha256 ||
    artifacts.snapshot.globalReviewSha256 !==
      legacyProjection.globalReviewSha256 ||
    !retainedArtifacts.snapshotBytes.equals(artifacts.snapshotBytes)
  ) {
    throw new Error('LEGACY_CANONICAL_PROJECTION_DRIFT')
  }
  await writeSigningPayload(
    repositoryRoot,
    requiredFlag(flags, '--signature-payload-output'),
    artifacts.ownerSignaturePayloadBytes
  )
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: `content/policy-snapshots/${artifacts.policySnapshotSha256}.json`,
    bytes: artifacts.snapshotBytes,
    maximumBytes: 10 * 1024 * 1024
  })
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:legacy-policy-prepare',
    status: 'PASS',
    policySnapshotSha256: artifacts.policySnapshotSha256,
    legacyItemCount: 65,
    validatorSourceCount: artifacts.snapshot.validatorSources.length
  })
}

const readPolicyFinalizationInputs = async (
  flags: ReadonlyMap<`--${string}`, string>
) => {
  const repositoryRoot = await resolveRepositoryRoot()
  const snapshotPath = requiredFlag(flags, '--policy-snapshot')
  const match = /^content\/policy-snapshots\/([a-f0-9]{64})\.json$/.exec(
    snapshotPath
  )
  if (match?.[1] === undefined) {
    throw new Error('POLICY_SNAPSHOT_PATH_INVALID')
  }
  const [snapshotBytes, signatureBytes, rootKeyBytes] = await Promise.all([
    readArtifactBytes({
      repositoryRoot,
      filePath: snapshotPath,
      maximumBytes: 10 * 1024 * 1024
    }),
    readPrivateArtifactBytes({
      repositoryRoot,
      filePath: requiredFlag(flags, '--policy-signature-input'),
      maximumBytes: 64 * 1024
    }),
    readArtifactBytes({
      repositoryRoot,
      filePath: 'content/trust/policy-owner-root.v1.pub',
      maximumBytes: 4 * 1024
    })
  ])
  return {
    repositoryRoot,
    snapshotPath,
    policySnapshotSha256: match[1],
    snapshotBytes,
    signatureBytes,
    ownerPublicKey: parseSshEd25519PublicKeyFile(rootKeyBytes).canonical
  }
}

export const runPolicyFinalize = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, [
    '--policy-snapshot',
    '--policy-signature-input'
  ])
  const inputs = await readPolicyFinalizationInputs(flags)
  const verified = await verifyPolicySnapshot({
    repositoryRoot: inputs.repositoryRoot,
    snapshotBytes: inputs.snapshotBytes,
    signature: inputs.signatureBytes,
    ownerPublicKey: inputs.ownerPublicKey,
    expectedRootFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256,
    expectedPolicySnapshotSha256: inputs.policySnapshotSha256
  })
  assertOperationalContributorEnrollment(verified.contributorsRegistry)
  await writeTrackedArtifact({
    repositoryRoot: inputs.repositoryRoot,
    repositoryPath: `content/policy-snapshots/${verified.policySnapshotSha256}.owner.sshsig`,
    bytes: inputs.signatureBytes,
    maximumBytes: 64 * 1024
  })
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:policy-finalize',
    status: 'PASS',
    policySnapshotSha256: verified.policySnapshotSha256
  })
}

export const runLegacyPolicyFinalize = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, [
    '--policy-snapshot',
    '--policy-signature-input'
  ])
  const inputs = await readPolicyFinalizationInputs(flags)
  const verified = await verifyLegacyPolicySnapshot({
    repositoryRoot: inputs.repositoryRoot,
    snapshotBytes: inputs.snapshotBytes,
    signature: inputs.signatureBytes,
    ownerPublicKey: inputs.ownerPublicKey,
    expectedRootFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256,
    expectedPolicySnapshotSha256: inputs.policySnapshotSha256
  })
  await writeTrackedArtifact({
    repositoryRoot: inputs.repositoryRoot,
    repositoryPath: `content/policy-snapshots/${verified.policySnapshotSha256}.owner.sshsig`,
    bytes: inputs.signatureBytes,
    maximumBytes: 64 * 1024
  })
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:legacy-policy-finalize',
    status: 'PASS',
    policySnapshotSha256: verified.policySnapshotSha256
  })
}

export const runPolicyActivationPrepare = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(
    args,
    [
      '--policy-snapshot',
      '--policy-signature',
      '--activated-at',
      '--activation-output',
      '--signature-payload-output'
    ],
    ['--expected-policy-activation']
  )
  const repositoryRoot = await resolveRepositoryRoot()
  const verifiedPolicy = await loadVerifiedPolicySnapshot(
    repositoryRoot,
    requiredFlag(flags, '--policy-snapshot'),
    requiredFlag(flags, '--policy-signature')
  )
  assertOperationalContributorEnrollment(verifiedPolicy.contributorsRegistry)
  const entries = await readPolicyActivationEntries(repositoryRoot)
  const terminalAnchor = configuredPolicyTerminalAnchor()
  let previousActivation:
    | ReturnType<typeof policyActivationSchema.parse>
    | undefined
  if (entries.length === 0) {
    if (terminalAnchor !== null || flags.has('--expected-policy-activation')) {
      throw new Error('POLICY_TERMINAL_ANCHOR_MISMATCH')
    }
    if (
      (await readOptionalPolicyConveniencePointerBytes(repositoryRoot)) !== null
    ) {
      throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
    }
  } else {
    if (terminalAnchor === null) {
      throw new Error('POLICY_TERMINAL_ANCHOR_MISSING')
    }
    const currentPointer =
      await readPolicyConveniencePointerBytes(repositoryRoot)
    if (
      flags.get('--expected-policy-activation') !==
      `${terminalAnchor.revision}@${terminalAnchor.activationSha256}`
    ) {
      throw new Error('POLICY_TERMINAL_ANCHOR_MISMATCH')
    }
    const currentChain = await verifyLoadedPolicyActivationChain({
      repositoryRoot,
      entries,
      conveniencePointerBytes: currentPointer,
      expectedTerminalRevision: terminalAnchor.revision,
      expectedTerminalActivationSha256: terminalAnchor.activationSha256
    })
    previousActivation = currentChain.terminal
  }
  const activationRevision = (previousActivation?.activationRevision ?? 0) + 1
  const activationBase = {
    schemaVersion: 1 as const,
    activationRevision,
    policySnapshotSha256: verifiedPolicy.policySnapshotSha256,
    activatedAt: requiredFlag(flags, '--activated-at'),
    previousActivationSha256: previousActivation?.activationSha256 ?? null,
    rootEpoch: previousActivation?.rootEpoch ?? 1
  }
  if (
    previousActivation !== undefined &&
    Date.parse(activationBase.activatedAt) <=
      Date.parse(previousActivation.activatedAt)
  ) {
    throw new Error('POLICY_ACTIVATION_TIME_INVALID')
  }
  const activation = policyActivationSchema.parse({
    ...activationBase,
    activationSha256: canonicalJsonSha256(activationBase)
  })
  const activationBytes = canonicalJsonBytes(activation)
  const ownerPayload = policyActivationOwnerSignaturePayloadSchema.parse({
    schemaVersion: 1,
    role: 'POLICY_ACTIVATOR',
    activationSha256: activation.activationSha256,
    rootKeyFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256
  })
  await writeSigningPayload(
    repositoryRoot,
    requiredFlag(flags, '--signature-payload-output'),
    canonicalJsonBytes(ownerPayload)
  )
  await writePrivateOutput(
    repositoryRoot,
    requiredFlag(flags, '--activation-output'),
    activationBytes,
    1024 * 1024
  )
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:policy-activation-prepare',
    status: 'PASS',
    activationRevision,
    activationSha256: activation.activationSha256,
    policySnapshotSha256: verifiedPolicy.policySnapshotSha256
  })
}

export interface FinalizeVerifiedPolicyActivationPublicationInputV1 {
  readonly repositoryRoot: string
  readonly activation: ReturnType<typeof policyActivationSchema.parse>
  readonly activationBytes: Buffer
  readonly signatureBytes: Buffer
  readonly terminalAnchor: PolicyTerminalAnchorV1 | null
}

export interface FinalizeVerifiedPolicyActivationPublicationDependenciesV1 {
  readonly verifyActivationChain?: typeof verifyLoadedPolicyActivationChain
}

export const finalizeVerifiedPolicyActivationPublication = async (
  {
    repositoryRoot,
    activation,
    activationBytes,
    signatureBytes,
    terminalAnchor
  }: FinalizeVerifiedPolicyActivationPublicationInputV1,
  {
    verifyActivationChain = verifyLoadedPolicyActivationChain
  }: FinalizeVerifiedPolicyActivationPublicationDependenciesV1 = {}
): Promise<void> => {
  const expectedPrefix = `content/policies/activations/${activation.activationRevision}-${activation.activationSha256}`
  const candidateDirectoryName = `${activation.activationRevision}-${activation.activationSha256}`
  const revisionClaimPath = `content/policies/.activation-finalize-claims/${activation.activationRevision}.json`
  const revisionClaimBytes = canonicalJsonBytes({
    activationRevision: activation.activationRevision,
    activationSha256: activation.activationSha256,
    signatureSha256: sha256Bytes(signatureBytes)
  })
  const prefixEntries = await readPolicyActivationEntries(
    repositoryRoot,
    candidateDirectoryName
  )
  const currentPointer =
    await readOptionalPolicyConveniencePointerBytes(repositoryRoot)

  if (activation.activationRevision === 1) {
    if (
      activation.previousActivationSha256 !== null ||
      prefixEntries.length !== 0 ||
      (currentPointer !== null && !currentPointer.equals(activationBytes)) ||
      (terminalAnchor !== null &&
        (terminalAnchor.revision !== 1 ||
          terminalAnchor.activationSha256 !== activation.activationSha256))
    ) {
      throw new Error('POLICY_TERMINAL_ANCHOR_MISMATCH')
    }
  } else {
    const previousEntry = prefixEntries.at(-1)
    if (
      previousEntry === undefined ||
      prefixEntries.length !== activation.activationRevision - 1 ||
      activation.previousActivationSha256 !== previousEntry.activationSha256
    ) {
      throw new Error('POLICY_ACTIVATION_BINDING_INVALID')
    }
    const pointerAlreadyFinalized =
      currentPointer?.equals(activationBytes) ?? false
    if (
      terminalAnchor === null ||
      (!pointerAlreadyFinalized &&
        (terminalAnchor.revision !== activation.activationRevision - 1 ||
          terminalAnchor.activationSha256 !==
            activation.previousActivationSha256)) ||
      (pointerAlreadyFinalized &&
        !(
          (terminalAnchor.revision === activation.activationRevision - 1 &&
            terminalAnchor.activationSha256 ===
              activation.previousActivationSha256) ||
          (terminalAnchor.revision === activation.activationRevision &&
            terminalAnchor.activationSha256 === activation.activationSha256)
        ))
    ) {
      throw new Error('POLICY_TERMINAL_ANCHOR_MISMATCH')
    }
    if (!pointerAlreadyFinalized) {
      if (currentPointer === null) {
        throw new Error('POLICY_ACTIVATION_BINDING_INVALID')
      }
      await verifyActivationChain({
        repositoryRoot,
        entries: prefixEntries,
        conveniencePointerBytes: currentPointer,
        expectedTerminalRevision: terminalAnchor.revision,
        expectedTerminalActivationSha256: terminalAnchor.activationSha256
      })
    }
  }
  await verifyActivationChain({
    repositoryRoot,
    entries: [
      ...prefixEntries,
      {
        activation,
        activationBytes,
        activationSha256: activation.activationSha256,
        directoryName: candidateDirectoryName,
        revision: activation.activationRevision,
        signature: signatureBytes
      }
    ],
    conveniencePointerBytes: activationBytes,
    expectedTerminalRevision: activation.activationRevision,
    expectedTerminalActivationSha256: activation.activationSha256
  })
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: revisionClaimPath,
    bytes: revisionClaimBytes,
    maximumBytes: 1024
  })
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: `${expectedPrefix}/activation.json`,
    bytes: activationBytes,
    maximumBytes: 1024 * 1024
  })
  await writeTrackedArtifact({
    repositoryRoot,
    repositoryPath: `${expectedPrefix}/activation.owner.sshsig`,
    bytes: signatureBytes,
    maximumBytes: 64 * 1024
  })
  const entries = await readPolicyActivationEntries(repositoryRoot)
  await verifyActivationChain({
    repositoryRoot,
    entries,
    conveniencePointerBytes: activationBytes,
    expectedTerminalRevision: activation.activationRevision,
    expectedTerminalActivationSha256: activation.activationSha256
  })
  if (!currentPointer?.equals(activationBytes)) {
    await writeTrackedArtifact({
      repositoryRoot,
      repositoryPath: 'content/policies/release-policy-manifest.v1.json',
      bytes: activationBytes,
      maximumBytes: 1024 * 1024,
      expectedExistingBytes: currentPointer
    })
  }
  const finalPointer = await readPolicyConveniencePointerBytes(repositoryRoot)
  const finalEntries = await readPolicyActivationEntries(repositoryRoot)
  await verifyActivationChain({
    repositoryRoot,
    entries: finalEntries,
    conveniencePointerBytes: finalPointer,
    expectedTerminalRevision: activation.activationRevision,
    expectedTerminalActivationSha256: activation.activationSha256
  })
}

export const runPolicyActivationFinalize = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, [
    '--activation-input',
    '--activation-signature-input',
    '--policy-snapshot',
    '--policy-signature'
  ])
  const repositoryRoot = await resolveRepositoryRoot()
  const verifiedPolicy = await loadVerifiedPolicySnapshot(
    repositoryRoot,
    requiredFlag(flags, '--policy-snapshot'),
    requiredFlag(flags, '--policy-signature')
  )
  assertOperationalContributorEnrollment(verifiedPolicy.contributorsRegistry)
  const [activationBytes, signatureBytes, rootKeyBytes] = await Promise.all([
    readPrivateArtifactBytes({
      repositoryRoot,
      filePath: requiredFlag(flags, '--activation-input'),
      maximumBytes: 1024 * 1024
    }),
    readPrivateArtifactBytes({
      repositoryRoot,
      filePath: requiredFlag(flags, '--activation-signature-input'),
      maximumBytes: 64 * 1024
    }),
    readArtifactBytes({
      repositoryRoot,
      filePath: 'content/trust/policy-owner-root.v1.pub',
      maximumBytes: 4 * 1024
    })
  ])
  const activation = policyActivationSchema.parse(
    parseStrictJsonBytes(activationBytes)
  )
  if (
    !Buffer.from(activationBytes).equals(canonicalJsonBytes(activation)) ||
    activation.policySnapshotSha256 !== verifiedPolicy.policySnapshotSha256
  ) {
    throw new Error('POLICY_ACTIVATION_BINDING_INVALID')
  }
  const ownerPublicKey = parseSshEd25519PublicKeyFile(rootKeyBytes).canonical
  await verifyPolicyActivation({
    activation,
    signature: signatureBytes,
    ownerPublicKey,
    expectedRootFingerprintSha256: POLICY_OWNER_ROOT_FINGERPRINT_SHA256,
    expectedRevision: activation.activationRevision,
    expectedActivationSha256: activation.activationSha256,
    expectedPolicySnapshotSha256: verifiedPolicy.policySnapshotSha256
  })

  const terminalAnchor = configuredPolicyTerminalAnchor()
  await finalizeVerifiedPolicyActivationPublication({
    repositoryRoot,
    activation,
    activationBytes,
    signatureBytes,
    terminalAnchor
  })
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:policy-activation-finalize',
    status: 'PASS',
    activationRevision: activation.activationRevision,
    activationSha256: activation.activationSha256,
    policySnapshotSha256: verifiedPolicy.policySnapshotSha256
  })
}

export const runAuthorPrepare = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, [
    ...POLICY_FLAGS,
    '--signature-payload-output'
  ])
  const { repositoryRoot, policy, bundle } = await loadBundleContext(flags)
  getActiveContributor(policy.contributorsRegistry, bundle.authorRef, 'AUTHOR')
  const payload = Buffer.from(
    canonicalizeJson(
      authorSignaturePayloadSchema.parse({
        schemaVersion: 1,
        role: 'AUTHOR',
        authorRef: bundle.authorRef,
        bundleSha256: bundle.bundleSha256,
        policySnapshotSha256: bundle.bundle.policySnapshotSha256
      })
    ),
    'utf8'
  )
  await writeSigningPayload(
    repositoryRoot,
    requiredFlag(flags, '--signature-payload-output'),
    payload
  )
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:author-prepare',
    status: 'PASS',
    bundleSha256: bundle.bundleSha256,
    itemCount: bundle.items.length
  })
}

export const runValidate = async (args: readonly string[]): Promise<void> => {
  const flags = parseCommandFlags(args, [...POLICY_FLAGS, '--author-signature'])
  const { repositoryRoot, bundle } = await loadBundleContext(flags)
  const signature = await readArtifactBytes({
    repositoryRoot,
    filePath: requiredFlag(flags, '--author-signature'),
    maximumBytes: 64 * 1024
  })
  await verifyBundleAuthorSignature({ validatedBundle: bundle, signature })
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:validate',
    status: 'PASS',
    bundleSha256: bundle.bundleSha256,
    itemCount: bundle.items.length
  })
}

export const runCoverage = async (args: readonly string[]): Promise<void> => {
  if (args.includes('--target')) {
    throw new Error('CONTENT_TARGET_COVERAGE_REQUIRES_SLICE_2')
  }
  const flags = parseCommandFlags(args, POLICY_FLAGS)
  const { bundle } = await loadBundleContext(flags)
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:coverage',
    status: 'PASS',
    bundleSha256: bundle.bundleSha256,
    coverage: bundle.coverage
  })
}

export const runDuplicates = async (args: readonly string[]): Promise<void> => {
  const flags = parseCommandFlags(args, POLICY_FLAGS)
  const { bundle } = await loadBundleContext(flags)
  if (bundle.duplicateWarnings.length > 0) {
    throw new Error('CONTENT_DUPLICATE_DISPOSITION_REQUIRED')
  }
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:duplicates',
    status: 'PASS',
    bundleSha256: bundle.bundleSha256,
    exactDuplicateCount: 0,
    warningCount: 0,
    warnings: []
  })
}

const REVIEW_FLAGS = [
  ...POLICY_FLAGS,
  '--author-signature',
  '--review-plan',
  '--review-evidence',
  '--catalog-snapshot',
  '--duplicate-corpus-snapshot',
  '--certificate'
] as const

const loadReviewContext = async (
  flags: ReadonlyMap<`--${string}`, string>,
  includeReviewerSignature: boolean
) => {
  const { repositoryRoot, bundle } = await loadBundleContext(flags)
  const review = await readReviewArtifacts({
    repositoryRoot,
    reviewPlanPath: requiredFlag(flags, '--review-plan'),
    reviewEvidencePath: requiredFlag(flags, '--review-evidence'),
    catalogSnapshotPath: requiredFlag(flags, '--catalog-snapshot'),
    duplicateCorpusSnapshotPath: requiredFlag(
      flags,
      '--duplicate-corpus-snapshot'
    ),
    certificatePath: requiredFlag(flags, '--certificate'),
    authorSignaturePath: requiredFlag(flags, '--author-signature'),
    ...(includeReviewerSignature
      ? { reviewerSignaturePath: requiredFlag(flags, '--reviewer-signature') }
      : {})
  })
  return { bundle, repositoryRoot, review }
}

export const runReviewPrepare = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, REVIEW_FLAGS, [
    '--comparison-output',
    '--comparison-confirm-sha256',
    '--signature-payload-output'
  ])
  const { bundle, repositoryRoot, review } = await loadReviewContext(
    flags,
    false
  )
  const prepared = await prepareReviewArtifacts({
    validatedBundle: bundle,
    reviewPlan: review.reviewPlan,
    reviewEvidence: review.reviewEvidence,
    catalogSnapshot: review.catalogSnapshot,
    duplicateCorpusSnapshot: review.duplicateCorpusSnapshot,
    certificate: review.certificate,
    authorSignature: review.authorSignature,
    now: new Date()
  })
  const comparisonBytes = Buffer.from(
    canonicalizeJson(review.reviewEvidence),
    'utf8'
  )
  const comparisonSha256 = sha256Bytes(comparisonBytes)
  const comparisonConfirmation = flags.get('--comparison-confirm-sha256')
  if (comparisonConfirmation === undefined) {
    if (
      !flags.has('--comparison-output') ||
      flags.has('--signature-payload-output')
    ) {
      throw new Error('COMMAND_ARGUMENT_INVALID')
    }
    await writePrivateOutput(
      repositoryRoot,
      requiredFlag(flags, '--comparison-output'),
      comparisonBytes,
      50 * 1024 * 1024
    )
    emitCommandResult({
      schemaVersion: 1,
      command: 'content:review-prepare',
      status: 'REVIEW_REQUIRED',
      bundleSha256: bundle.bundleSha256,
      certificateSha256: prepared.certificateSha256,
      reviewEvidenceSha256: prepared.reviewEvidenceSha256,
      comparisonSha256,
      itemCount: prepared.certificateItems.length
    })
    return
  }
  if (
    comparisonConfirmation !== comparisonSha256 ||
    flags.has('--comparison-output') ||
    !flags.has('--signature-payload-output')
  ) {
    throw new Error('REVIEW_COMPARISON_CONFIRMATION_INVALID')
  }
  await writeSigningPayload(
    repositoryRoot,
    requiredFlag(flags, '--signature-payload-output'),
    prepared.reviewerSignaturePayload
  )
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:review-prepare',
    status: 'PASS',
    bundleSha256: bundle.bundleSha256,
    certificateSha256: prepared.certificateSha256,
    reviewEvidenceSha256: prepared.reviewEvidenceSha256,
    comparisonSha256,
    itemCount: prepared.certificateItems.length
  })
}

export const runReviewCheck = async (
  args: readonly string[]
): Promise<void> => {
  const flags = parseCommandFlags(args, [
    ...REVIEW_FLAGS,
    '--reviewer-signature'
  ])
  const { bundle, review } = await loadReviewContext(flags, true)
  if (review.reviewerSignature === null) {
    throw new Error('REVIEWER_SIGNATURE_MISSING')
  }
  const validated = await validateReviewArtifacts({
    validatedBundle: bundle,
    reviewPlan: review.reviewPlan,
    reviewEvidence: review.reviewEvidence,
    catalogSnapshot: review.catalogSnapshot,
    duplicateCorpusSnapshot: review.duplicateCorpusSnapshot,
    certificate: review.certificate,
    authorSignature: review.authorSignature,
    reviewerSignature: review.reviewerSignature,
    now: new Date()
  })
  emitCommandResult({
    schemaVersion: 1,
    command: 'content:review-check',
    status: 'PASS',
    bundleSha256: bundle.bundleSha256,
    certificateSha256: validated.certificateSha256,
    itemCount: validated.certificateItems.length
  })
}
