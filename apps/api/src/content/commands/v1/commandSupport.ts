import type { BigIntStats } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import path from 'node:path'
import { ZodError } from 'zod'
import { fileURLToPath } from 'node:url'
import { canonicalizeJson } from '@nihongo/domain/content/validators/v1/canonical-json'
import { readArtifactBytes } from '../../validators/v1/artifactReader.js'
import {
  verifyPolicyActivationChain,
  verifyPolicySnapshot,
  type PolicyActivationChainEntryV1,
  type VerifiedPolicyActivationChainV1,
  type VerifiedPolicySnapshotV1
} from '../../validators/v1/policyVerifier.js'
import { parseSshEd25519PublicKeyFile } from '../../validators/v1/sshsigVerifier.js'
import { parseStrictJsonBytes } from '../../validators/v1/strictJson.js'
import { writeNewPrivateFile } from '../../validators/v1/privateFileWriter.js'

export const POLICY_OWNER_ROOT_FINGERPRINT_SHA256 =
  'c6f8c53384aa90de0ef57edac3398cea16f1ff48aec492b7b1df742cfbeb3467'

const REPOSITORY_ROOT_URL = new URL('../../../../../../', import.meta.url)

export const resolveRepositoryRoot = async (): Promise<string> =>
  realpath(
    process.env.CONTENT_REPOSITORY_ROOT === undefined
      ? fileURLToPath(REPOSITORY_ROOT_URL)
      : (() => {
          if (
            !path.isAbsolute(process.env.CONTENT_REPOSITORY_ROOT) ||
            process.env.CONTENT_REPOSITORY_ROOT !== '/workspace'
          ) {
            throw new Error('CONTENT_REPOSITORY_ROOT_INVALID')
          }
          return process.env.CONTENT_REPOSITORY_ROOT
        })()
  )

export type CommandFlagName = `--${string}`

export const parseCommandFlags = (
  values: readonly string[],
  required: readonly CommandFlagName[],
  optional: readonly CommandFlagName[] = []
): ReadonlyMap<CommandFlagName, string> => {
  if (values.length % 2 !== 0) throw new Error('COMMAND_ARGUMENT_INVALID')
  const allowed = new Set([...required, ...optional])
  const parsed = new Map<CommandFlagName, string>()
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index]
    const value = values[index + 1]
    if (
      flag === undefined ||
      value === undefined ||
      !flag.startsWith('--') ||
      value.startsWith('--') ||
      !allowed.has(flag as CommandFlagName) ||
      parsed.has(flag as CommandFlagName)
    ) {
      throw new Error('COMMAND_ARGUMENT_INVALID')
    }
    parsed.set(flag as CommandFlagName, value)
  }
  if (required.some((flag) => !parsed.has(flag))) {
    throw new Error('COMMAND_ARGUMENT_INVALID')
  }
  return parsed
}

export const requiredFlag = (
  flags: ReadonlyMap<CommandFlagName, string>,
  flag: CommandFlagName
): string => {
  const value = flags.get(flag)
  if (value === undefined) throw new Error('COMMAND_ARGUMENT_INVALID')
  return value
}

export const emitCommandResult = (value: unknown): void => {
  process.stdout.write(`${canonicalizeJson(value)}\n`)
}

const internalRuleCode = (error: unknown): string => {
  if (error instanceof ZodError) {
    const issue = error.issues.toSorted((left, right) => {
      const leftKey = `${left.path.join('.')}\u0000${left.message}`
      const rightKey = `${right.path.join('.')}\u0000${right.message}`
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })[0]
    if (issue !== undefined && /^[A-Z][A-Z0-9_]{2,80}$/.test(issue.message)) {
      return issue.message
    }
    if (issue !== undefined) {
      return `CONTENT_SCHEMA_${issue.code.toUpperCase()}`
    }
    return 'CONTENT_SCHEMA_INVALID'
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,80}$/.test(error.code)
  ) {
    return error.code
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) {
    return error.message
  }
  return 'CONTENT_COMMAND_FAILED'
}

export interface CommandFailureV1 {
  readonly code:
    | 'CONTENT_ARTIFACT_INVALID'
    | 'CONTENT_CERTIFICATE_INVALID'
    | 'CONTENT_EXACT_DUPLICATE'
    | 'CONTENT_DUPLICATE_DISPOSITION_REQUIRED'
    | 'CONTENT_COVERAGE_GATE_FAILED'
    | 'CONTENT_AUTH_REQUIRED'
    | 'CONTENT_AUTH_NOT_FRESH'
    | 'CONTENT_FORBIDDEN'
    | 'CONTENT_TARGET_MISMATCH'
    | 'CONTENT_PLAN_EXPIRED'
    | 'CONTENT_PLAN_HASH_MISMATCH'
    | 'CONTENT_RELEASE_HASH_MISMATCH'
    | 'CONTENT_BASE_VERSION_CONFLICT'
    | 'CONTENT_REQUIRES_NEW_QUESTION'
    | 'CONTENT_CATALOG_CHANGED'
    | 'CONTENT_DUPLICATE_CORPUS_CHANGED'
    | 'CONTENT_RELEASE_CHAIN_CHANGED'
    | 'CONTENT_SERIALIZATION_RETRY_EXHAUSTED'
    | 'CONTENT_REAUTH_RETRY_REQUIRED'
    | 'CONTENT_LOCK_TIMEOUT'
    | 'CONTENT_COMMAND_TIMEOUT'
    | 'CONTENT_INTERNAL_ERROR'
  readonly exitCode: 2 | 3 | 4 | 5
}

const exactFailures = new Map<string, CommandFailureV1>([
  ['BUNDLE_EXACT_DUPLICATE', { code: 'CONTENT_EXACT_DUPLICATE', exitCode: 2 }],
  [
    'CONTENT_DUPLICATE_DISPOSITION_REQUIRED',
    { code: 'CONTENT_DUPLICATE_DISPOSITION_REQUIRED', exitCode: 2 }
  ],
  [
    'CONTENT_COVERAGE_GATE_FAILED',
    { code: 'CONTENT_COVERAGE_GATE_FAILED', exitCode: 2 }
  ],
  ['CONTENT_AUTH_REQUIRED', { code: 'CONTENT_AUTH_REQUIRED', exitCode: 3 }],
  ['CONTENT_AUTH_NOT_FRESH', { code: 'CONTENT_AUTH_NOT_FRESH', exitCode: 3 }],
  ['CONTENT_FORBIDDEN', { code: 'CONTENT_FORBIDDEN', exitCode: 3 }],
  ['CONTENT_TARGET_MISMATCH', { code: 'CONTENT_TARGET_MISMATCH', exitCode: 3 }],
  ['CONTENT_PLAN_EXPIRED', { code: 'CONTENT_PLAN_EXPIRED', exitCode: 4 }],
  [
    'CONTENT_PLAN_HASH_MISMATCH',
    { code: 'CONTENT_PLAN_HASH_MISMATCH', exitCode: 4 }
  ],
  [
    'CONTENT_RELEASE_HASH_MISMATCH',
    { code: 'CONTENT_RELEASE_HASH_MISMATCH', exitCode: 4 }
  ],
  [
    'CONTENT_BASE_VERSION_CONFLICT',
    { code: 'CONTENT_BASE_VERSION_CONFLICT', exitCode: 4 }
  ],
  [
    'CONTENT_REQUIRES_NEW_QUESTION',
    { code: 'CONTENT_REQUIRES_NEW_QUESTION', exitCode: 4 }
  ],
  ['CONTENT_CATALOG_CHANGED', { code: 'CONTENT_CATALOG_CHANGED', exitCode: 4 }],
  [
    'CONTENT_DUPLICATE_CORPUS_CHANGED',
    { code: 'CONTENT_DUPLICATE_CORPUS_CHANGED', exitCode: 4 }
  ],
  [
    'CONTENT_RELEASE_CHAIN_CHANGED',
    { code: 'CONTENT_RELEASE_CHAIN_CHANGED', exitCode: 4 }
  ],
  [
    'CONTENT_SERIALIZATION_RETRY_EXHAUSTED',
    { code: 'CONTENT_SERIALIZATION_RETRY_EXHAUSTED', exitCode: 5 }
  ],
  [
    'CONTENT_REAUTH_RETRY_REQUIRED',
    { code: 'CONTENT_REAUTH_RETRY_REQUIRED', exitCode: 5 }
  ],
  ['CONTENT_LOCK_TIMEOUT', { code: 'CONTENT_LOCK_TIMEOUT', exitCode: 5 }],
  ['CONTENT_COMMAND_TIMEOUT', { code: 'CONTENT_COMMAND_TIMEOUT', exitCode: 5 }]
])

export const classifyCommandFailure = (error: unknown): CommandFailureV1 => {
  const ruleCode = internalRuleCode(error)
  const exact = exactFailures.get(ruleCode)
  if (exact !== undefined) return exact
  if (/^(?:REVIEW|CERTIFICATE|REVIEWER)_/.test(ruleCode)) {
    return { code: 'CONTENT_CERTIFICATE_INVALID', exitCode: 2 }
  }
  if (
    /^(?:ARTIFACT|BUNDLE|CONTENT_SCHEMA|CONTRIBUTOR|LEGACY|POLICY|PUBLIC_KEY|SIGNATURE|TRACKED_ARTIFACT|OUTPUT)_/.test(
      ruleCode
    )
  ) {
    return { code: 'CONTENT_ARTIFACT_INVALID', exitCode: 2 }
  }
  return { code: 'CONTENT_INTERNAL_ERROR', exitCode: 5 }
}

export const emitCommandFailure = (failure: CommandFailureV1): void => {
  process.stderr.write(
    `${canonicalizeJson({
      schemaVersion: 1,
      code: failure.code,
      message: failure.code
    })}\n`
  )
}

const configuredRootFingerprint = (): string => {
  const configuredFingerprint =
    process.env.CONTENT_POLICY_ROOT_FINGERPRINT_SHA256
  if (configuredFingerprint !== POLICY_OWNER_ROOT_FINGERPRINT_SHA256) {
    throw new Error('POLICY_ROOT_ANCHOR_MISSING')
  }
  return configuredFingerprint
}

export interface PolicyTerminalAnchorV1 {
  readonly revision: number
  readonly activationSha256: string
}

export const configuredPolicyTerminalAnchor =
  (): PolicyTerminalAnchorV1 | null => {
    const revisionText = process.env.CONTENT_POLICY_TERMINAL_REVISION
    const activationSha256 = process.env.CONTENT_POLICY_TERMINAL_SHA256
    if (revisionText === undefined && activationSha256 === undefined)
      return null
    if (
      revisionText === undefined ||
      !/^[1-9][0-9]*$/.test(revisionText) ||
      activationSha256 === undefined ||
      !/^[a-f0-9]{64}$/.test(activationSha256)
    ) {
      throw new Error('POLICY_TERMINAL_ANCHOR_MISSING')
    }
    const revision = Number(revisionText)
    if (!Number.isSafeInteger(revision)) {
      throw new Error('POLICY_TERMINAL_ANCHOR_MISSING')
    }
    return { revision, activationSha256 }
  }

export interface LoadedPolicyActivationEntryV1
  extends PolicyActivationChainEntryV1 {
  readonly activationBytes: Buffer
  readonly activationSha256: string
  readonly directoryName: string
  readonly revision: number
}

const sameDirectoryVersion = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

const isMissingFileError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT'

export const readPolicyActivationEntries = async (
  repositoryRoot: string,
  excludedDirectoryName?: string
): Promise<readonly LoadedPolicyActivationEntryV1[]> => {
  const canonicalRepositoryRoot = await realpath(repositoryRoot)
  const activationRoot = resolve(
    canonicalRepositoryRoot,
    'content/policies/activations'
  )
  const readActivationRoot = async () => {
    let before: BigIntStats
    try {
      before = await lstat(activationRoot, { bigint: true })
    } catch (error: unknown) {
      if (isMissingFileError(error)) return { entries: [], metadata: null }
      throw error
    }
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      (await realpath(activationRoot)) !== activationRoot
    ) {
      throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
    }
    const entries = await readdir(activationRoot, { withFileTypes: true })
    const after = await lstat(activationRoot, { bigint: true })
    if (
      !sameDirectoryVersion(before, after) ||
      (await realpath(activationRoot)) !== activationRoot
    ) {
      throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
    }
    return { entries, metadata: after }
  }
  const initialRoot = await readActivationRoot()
  const directoryEntries = initialRoot.entries
  const initialRootLayout = directoryEntries
    .map((entry) => `${entry.isDirectory() ? 'D' : 'O'}\u0000${entry.name}`)
    .toSorted()
  const activationDirectories = directoryEntries
    .map((entry) => {
      const match = /^([1-9][0-9]*)-([a-f0-9]{64})$/.exec(entry.name)
      if (!entry.isDirectory() || match === null) {
        throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
      }
      const revision = Number(match[1])
      const activationSha256 = match[2]
      if (!Number.isSafeInteger(revision) || activationSha256 === undefined) {
        throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
      }
      return {
        activationSha256,
        directoryName: entry.name,
        revision
      }
    })
    .filter(({ directoryName }) => directoryName !== excludedDirectoryName)
    .toSorted((left, right) => left.revision - right.revision)

  const loadedEntries = await Promise.all(
    activationDirectories.map(
      async ({ activationSha256, directoryName, revision }) => {
        const prefix = `content/policies/activations/${directoryName}`
        const directory = resolve(canonicalRepositoryRoot, prefix)
        const initialDirectoryMetadata = await lstat(directory, {
          bigint: true
        })
        if (
          !initialDirectoryMetadata.isDirectory() ||
          initialDirectoryMetadata.isSymbolicLink() ||
          (await realpath(directory)) !== directory
        ) {
          throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
        }
        const childEntries = await readdir(directory, {
          withFileTypes: true
        })
        if (
          childEntries.length !== 2 ||
          childEntries.some(
            (entry) =>
              !entry.isFile() ||
              !['activation.json', 'activation.owner.sshsig'].includes(
                entry.name
              )
          )
        ) {
          throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
        }
        const [activationBytes, activationSignature] = await Promise.all([
          readArtifactBytes({
            repositoryRoot: canonicalRepositoryRoot,
            filePath: `${prefix}/activation.json`,
            maximumBytes: 1024 * 1024
          }),
          readArtifactBytes({
            repositoryRoot: canonicalRepositoryRoot,
            filePath: `${prefix}/activation.owner.sshsig`,
            maximumBytes: 64 * 1024
          })
        ])
        const finalChildEntries = await readdir(directory, {
          withFileTypes: true
        })
        const finalDirectoryMetadata = await lstat(directory, { bigint: true })
        if (
          !sameDirectoryVersion(
            initialDirectoryMetadata,
            finalDirectoryMetadata
          ) ||
          (await realpath(directory)) !== directory ||
          finalChildEntries.length !== 2 ||
          finalChildEntries.some(
            (entry) =>
              !entry.isFile() ||
              !['activation.json', 'activation.owner.sshsig'].includes(
                entry.name
              )
          )
        ) {
          throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
        }
        return {
          activation: parseStrictJsonBytes(activationBytes),
          activationBytes: Buffer.from(activationBytes),
          activationSha256,
          directoryName,
          revision,
          signature: activationSignature
        }
      }
    )
  )
  const finalRoot = await readActivationRoot()
  const finalRootLayout = finalRoot.entries
    .map((entry) => `${entry.isDirectory() ? 'D' : 'O'}\u0000${entry.name}`)
    .toSorted()
  if (
    (initialRoot.metadata === null) !== (finalRoot.metadata === null) ||
    (initialRoot.metadata !== null &&
      finalRoot.metadata !== null &&
      !sameDirectoryVersion(initialRoot.metadata, finalRoot.metadata)) ||
    initialRootLayout.length !== finalRootLayout.length ||
    initialRootLayout.some((entry, index) => entry !== finalRootLayout[index])
  ) {
    throw new Error('POLICY_ACTIVATION_LAYOUT_INVALID')
  }
  return loadedEntries
}

export const readPolicyConveniencePointerBytes = async (
  repositoryRoot: string
): Promise<Buffer> =>
  Buffer.from(
    await readArtifactBytes({
      repositoryRoot,
      filePath: 'content/policies/release-policy-manifest.v1.json',
      maximumBytes: 1024 * 1024
    })
  )

export const readOptionalPolicyConveniencePointerBytes = async (
  repositoryRoot: string
): Promise<Buffer | null> => {
  const pointerPath = resolve(
    repositoryRoot,
    'content/policies/release-policy-manifest.v1.json'
  )
  try {
    await lstat(pointerPath, { bigint: true })
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
  return readPolicyConveniencePointerBytes(repositoryRoot)
}

export interface VerifyLoadedPolicyActivationChainInputV1 {
  readonly repositoryRoot: string
  readonly entries: readonly LoadedPolicyActivationEntryV1[]
  readonly conveniencePointerBytes: Uint8Array
  readonly expectedTerminalRevision: number
  readonly expectedTerminalActivationSha256: string
}

export const verifyLoadedPolicyActivationChain = async ({
  repositoryRoot,
  entries,
  conveniencePointerBytes,
  expectedTerminalRevision,
  expectedTerminalActivationSha256
}: VerifyLoadedPolicyActivationChainInputV1): Promise<VerifiedPolicyActivationChainV1> => {
  if (
    entries.some(
      (entry) =>
        !entry.activationBytes.equals(
          Buffer.from(canonicalizeJson(entry.activation), 'utf8')
        )
    )
  ) {
    throw new Error('POLICY_ACTIVATION_BINDING_INVALID')
  }
  const configuredFingerprint = configuredRootFingerprint()
  const rootKeyBytes = await readArtifactBytes({
    repositoryRoot,
    filePath: 'content/trust/policy-owner-root.v1.pub',
    maximumBytes: 4 * 1024
  })
  const ownerPublicKey = parseSshEd25519PublicKeyFile(rootKeyBytes).canonical
  const chain = await verifyPolicyActivationChain({
    entries,
    conveniencePointer: parseStrictJsonBytes(conveniencePointerBytes),
    ownerPublicKey,
    expectedRootFingerprintSha256: configuredFingerprint,
    expectedTerminalRevision,
    expectedTerminalActivationSha256
  })
  if (
    chain.activations.some((activation, index) => {
      const entry = entries[index]
      return (
        entry === undefined ||
        entry.revision !== activation.activationRevision ||
        entry.activationSha256 !== activation.activationSha256 ||
        entry.directoryName !==
          `${activation.activationRevision}-${activation.activationSha256}`
      )
    }) ||
    !Buffer.from(entries.at(-1)?.activationBytes ?? new Uint8Array()).equals(
      conveniencePointerBytes
    )
  ) {
    throw new Error('POLICY_ACTIVATION_BINDING_INVALID')
  }
  const verifiedActivationPolicies = new Set<string>()
  for (const activation of chain.activations) {
    if (verifiedActivationPolicies.has(activation.policySnapshotSha256)) {
      continue
    }
    await loadVerifiedPolicySnapshot(
      repositoryRoot,
      `content/policy-snapshots/${activation.policySnapshotSha256}.json`,
      `content/policy-snapshots/${activation.policySnapshotSha256}.owner.sshsig`
    )
    verifiedActivationPolicies.add(activation.policySnapshotSha256)
  }
  return chain
}

export const loadVerifiedPolicySnapshot = async (
  repositoryRoot: string,
  policySnapshotPath: string,
  policySignaturePath: string
): Promise<VerifiedPolicySnapshotV1> => {
  const configuredFingerprint = configuredRootFingerprint()
  const [snapshotBytes, signature, rootKeyBytes] = await Promise.all([
    readArtifactBytes({
      repositoryRoot,
      filePath: policySnapshotPath,
      maximumBytes: 10 * 1024 * 1024
    }),
    readArtifactBytes({
      repositoryRoot,
      filePath: policySignaturePath,
      maximumBytes: 64 * 1024
    }),
    readArtifactBytes({
      repositoryRoot,
      filePath: 'content/trust/policy-owner-root.v1.pub',
      maximumBytes: 4 * 1024
    })
  ])
  const ownerPublicKey = parseSshEd25519PublicKeyFile(rootKeyBytes).canonical
  const verified = await verifyPolicySnapshot({
    repositoryRoot,
    snapshotBytes,
    signature,
    ownerPublicKey,
    expectedRootFingerprintSha256: configuredFingerprint
  })
  const canonicalSnapshotPath = `content/policy-snapshots/${verified.policySnapshotSha256}.json`
  const canonicalSignaturePath = `content/policy-snapshots/${verified.policySnapshotSha256}.owner.sshsig`
  if (
    policySnapshotPath !== canonicalSnapshotPath ||
    policySignaturePath !== canonicalSignaturePath
  ) {
    throw new Error('POLICY_CONTENT_ADDRESS_MISMATCH')
  }
  return verified
}

export const loadVerifiedPolicy = async (
  repositoryRoot: string,
  policySnapshotPath: string,
  policySignaturePath: string
): Promise<VerifiedPolicySnapshotV1> => {
  const verified = await loadVerifiedPolicySnapshot(
    repositoryRoot,
    policySnapshotPath,
    policySignaturePath
  )
  const terminalAnchor = configuredPolicyTerminalAnchor()
  if (terminalAnchor === null) {
    throw new Error('POLICY_TERMINAL_ANCHOR_MISSING')
  }
  const entries = await readPolicyActivationEntries(repositoryRoot)
  const conveniencePointerBytes =
    await readPolicyConveniencePointerBytes(repositoryRoot)
  const chain = await verifyLoadedPolicyActivationChain({
    repositoryRoot,
    entries,
    conveniencePointerBytes,
    expectedTerminalRevision: terminalAnchor.revision,
    expectedTerminalActivationSha256: terminalAnchor.activationSha256
  })
  if (chain.terminal.policySnapshotSha256 !== verified.policySnapshotSha256) {
    throw new Error('POLICY_ACTIVATION_BINDING_INVALID')
  }
  return verified
}

export const writePrivateOutput = async (
  repositoryRoot: string,
  outputPath: string,
  payload: Uint8Array,
  maximumBytes: number
): Promise<void> =>
  writeNewPrivateFile({
    outputPath,
    bytes: payload,
    maximumBytes,
    forbiddenRoot: repositoryRoot
  })

export const writeSigningPayload = async (
  repositoryRoot: string,
  outputPath: string,
  payload: Uint8Array
): Promise<void> =>
  writePrivateOutput(repositoryRoot, outputPath, payload, 64 * 1024)
