import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalJsonBytes,
  canonicalJsonSha256,
  sha256Bytes
} from '../../validators/v1/canonicalHash.js'
import { policyActivationSchema } from '../../validators/v1/policySchemas.js'
import { writeTrackedArtifact } from '../../validators/v1/trackedArtifactWriter.js'
import {
  readPolicyActivationEntries,
  verifyLoadedPolicyActivationChain
} from './commandSupport.js'
import { finalizeVerifiedPolicyActivationPublication } from './commands.js'

const POLICY_SHA256 = '1'.repeat(64)
const temporaryRoots: string[] = []

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'nihongo-activation-command-')
  )
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  return root
}

const createActivation = ({
  revision,
  previousActivationSha256,
  activatedAt,
  policySnapshotSha256 = POLICY_SHA256
}: {
  readonly revision: number
  readonly previousActivationSha256: string | null
  readonly activatedAt: string
  readonly policySnapshotSha256?: string
}) => {
  const hashInput = {
    schemaVersion: 1 as const,
    activationRevision: revision,
    policySnapshotSha256,
    activatedAt,
    previousActivationSha256,
    rootEpoch: 1
  }
  return policyActivationSchema.parse({
    ...hashInput,
    activationSha256: canonicalJsonSha256(hashInput)
  })
}

const writeRegular = async (
  root: string,
  repositoryPath: string,
  bytes: Uint8Array
): Promise<void> => {
  const output = path.join(root, repositoryPath)
  await mkdir(path.dirname(output), { mode: 0o755, recursive: true })
  await writeFile(output, bytes, { mode: 0o644 })
}

const fakeVerifyActivationChain: typeof verifyLoadedPolicyActivationChain =
  async ({ entries }) => {
    const activations = entries.map(({ activation }) =>
      policyActivationSchema.parse(activation)
    )
    const terminal = activations.at(-1)
    if (terminal === undefined) {
      throw new Error('fixture activation chain is empty')
    }
    return { activations, terminal }
  }

const createRevisionTwoFixture = async () => {
  const repositoryRoot = await createTemporaryRoot()
  const previous = createActivation({
    revision: 1,
    previousActivationSha256: null,
    activatedAt: '2026-08-25T00:00:00.000Z'
  })
  const activation = createActivation({
    revision: 2,
    previousActivationSha256: previous.activationSha256,
    activatedAt: '2026-08-25T00:01:00.000Z'
  })
  const previousBytes = canonicalJsonBytes(previous)
  const activationBytes = canonicalJsonBytes(activation)
  const signatureBytes = Buffer.from('fixture-owner-signature-v2', 'utf8')
  const previousPrefix = `content/policies/activations/1-${previous.activationSha256}`
  await Promise.all([
    writeRegular(
      repositoryRoot,
      `${previousPrefix}/activation.json`,
      previousBytes
    ),
    writeRegular(
      repositoryRoot,
      `${previousPrefix}/activation.owner.sshsig`,
      Buffer.from('fixture-owner-signature-v1', 'utf8')
    ),
    writeRegular(
      repositoryRoot,
      'content/policies/release-policy-manifest.v1.json',
      previousBytes
    )
  ])
  return {
    repositoryRoot,
    previous,
    previousBytes,
    activation,
    activationBytes,
    signatureBytes
  }
}

const candidatePaths = (activation: ReturnType<typeof createActivation>) => {
  const prefix = `content/policies/activations/${activation.activationRevision}-${activation.activationSha256}`
  return {
    prefix,
    activation: `${prefix}/activation.json`,
    signature: `${prefix}/activation.owner.sshsig`,
    claim: `content/policies/.activation-finalize-claims/${activation.activationRevision}.json`,
    pointer: 'content/policies/release-policy-manifest.v1.json'
  }
}

const claimBytes = (
  activation: ReturnType<typeof createActivation>,
  signatureBytes: Uint8Array
) =>
  canonicalJsonBytes({
    activationRevision: activation.activationRevision,
    activationSha256: activation.activationSha256,
    signatureSha256: sha256Bytes(signatureBytes)
  })

const listTemporaryFiles = async (root: string): Promise<string[]> => {
  const found: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(candidate)
      } else if (entry.name.endsWith('.tmp')) {
        found.push(path.relative(root, candidate))
      }
    }
  }
  await visit(root)
  return found.toSorted()
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('Phase 6 Slice 1 activation publication state machine', () => {
  it('rejects a symlinked activation root even when it is empty', async () => {
    const repositoryRoot = await createTemporaryRoot()
    const redirectedRoot = await createTemporaryRoot()
    await mkdir(path.join(repositoryRoot, 'content', 'policies'), {
      mode: 0o755,
      recursive: true
    })
    await symlink(
      redirectedRoot,
      path.join(repositoryRoot, 'content', 'policies', 'activations'),
      'dir'
    )

    await expect(readPolicyActivationEntries(repositoryRoot)).rejects.toThrow(
      'POLICY_ACTIVATION_LAYOUT_INVALID'
    )
  })

  it('publishes and idempotently recovers the genesis activation', async () => {
    const repositoryRoot = await createTemporaryRoot()
    const activation = createActivation({
      revision: 1,
      previousActivationSha256: null,
      activatedAt: '2026-08-25T00:00:00.000Z'
    })
    const activationBytes = canonicalJsonBytes(activation)
    const signatureBytes = Buffer.from(
      'fixture-owner-signature-genesis',
      'utf8'
    )
    const paths = candidatePaths(activation)
    const stagingResidue = path.join(
      repositoryRoot,
      'content',
      '.tracked-artifact-staging',
      'interrupted-invocation',
      'artifact.tmp'
    )
    await writeTrackedArtifact({
      repositoryRoot,
      repositoryPath: paths.claim,
      bytes: claimBytes(activation, signatureBytes),
      maximumBytes: 1024
    })
    await mkdir(path.dirname(stagingResidue), {
      mode: 0o700,
      recursive: true
    })
    await writeFile(stagingResidue, Buffer.from('stale-staging-temp', 'utf8'), {
      mode: 0o600
    })

    const input = {
      repositoryRoot,
      activation,
      activationBytes,
      signatureBytes,
      terminalAnchor: null
    }
    const dependencies = {
      verifyActivationChain: fakeVerifyActivationChain
    }
    await finalizeVerifiedPolicyActivationPublication(input, dependencies)
    await finalizeVerifiedPolicyActivationPublication(input, dependencies)

    expect(await readFile(path.join(repositoryRoot, paths.claim))).toEqual(
      claimBytes(activation, signatureBytes)
    )
    expect(await readFile(path.join(repositoryRoot, paths.activation))).toEqual(
      activationBytes
    )
    expect(await readFile(path.join(repositoryRoot, paths.signature))).toEqual(
      signatureBytes
    )
    expect(await readFile(path.join(repositoryRoot, paths.pointer))).toEqual(
      activationBytes
    )
    expect(
      (await readdir(path.join(repositoryRoot, paths.prefix))).toSorted()
    ).toEqual(['activation.json', 'activation.owner.sshsig'])
    expect(await readPolicyActivationEntries(repositoryRoot)).toHaveLength(1)
    expect(await listTemporaryFiles(repositoryRoot)).toEqual([
      path.relative(repositoryRoot, stagingResidue)
    ])
  })

  it.each([
    'CLAIM_ONLY',
    'CLAIM_AND_ACTIVATION',
    'FULL_PAIR_OLD_POINTER',
    'FULL_PAIR_CANDIDATE_POINTER'
  ] as const)(
    'converges from the %s recovery state',
    async (state) => {
      const fixture = await createRevisionTwoFixture()
      const paths = candidatePaths(fixture.activation)
      await writeTrackedArtifact({
        repositoryRoot: fixture.repositoryRoot,
        repositoryPath: paths.claim,
        bytes: claimBytes(fixture.activation, fixture.signatureBytes),
        maximumBytes: 1024
      })
      if (state !== 'CLAIM_ONLY') {
        await writeTrackedArtifact({
          repositoryRoot: fixture.repositoryRoot,
          repositoryPath: paths.activation,
          bytes: fixture.activationBytes,
          maximumBytes: 1024 * 1024
        })
      }
      if (
        state === 'FULL_PAIR_OLD_POINTER' ||
        state === 'FULL_PAIR_CANDIDATE_POINTER'
      ) {
        await writeTrackedArtifact({
          repositoryRoot: fixture.repositoryRoot,
          repositoryPath: paths.signature,
          bytes: fixture.signatureBytes,
          maximumBytes: 64 * 1024
        })
      }
      if (state === 'FULL_PAIR_CANDIDATE_POINTER') {
        await writeFile(
          path.join(fixture.repositoryRoot, paths.pointer),
          fixture.activationBytes
        )
      }

      const input = {
        repositoryRoot: fixture.repositoryRoot,
        activation: fixture.activation,
        activationBytes: fixture.activationBytes,
        signatureBytes: fixture.signatureBytes,
        terminalAnchor: {
          revision: 1,
          activationSha256: fixture.previous.activationSha256
        }
      }
      await finalizeVerifiedPolicyActivationPublication(input, {
        verifyActivationChain: fakeVerifyActivationChain
      })
      await finalizeVerifiedPolicyActivationPublication(input, {
        verifyActivationChain: fakeVerifyActivationChain
      })

      expect(
        await readFile(path.join(fixture.repositoryRoot, paths.claim))
      ).toEqual(claimBytes(fixture.activation, fixture.signatureBytes))
      expect(
        await readFile(path.join(fixture.repositoryRoot, paths.activation))
      ).toEqual(fixture.activationBytes)
      expect(
        await readFile(path.join(fixture.repositoryRoot, paths.signature))
      ).toEqual(fixture.signatureBytes)
      expect(
        await readFile(path.join(fixture.repositoryRoot, paths.pointer))
      ).toEqual(fixture.activationBytes)
      expect(
        (
          await readdir(path.join(fixture.repositoryRoot, paths.prefix))
        ).toSorted()
      ).toEqual(['activation.json', 'activation.owner.sshsig'])
      expect(
        await readPolicyActivationEntries(fixture.repositoryRoot)
      ).toHaveLength(2)
      expect(await listTemporaryFiles(fixture.repositoryRoot)).toEqual([])
    },
    30_000
  )

  it.each(['DIFFERENT_ACTIVATION', 'DIFFERENT_SIGNATURE'] as const)(
    'rejects a competing %s after the durable revision claim',
    async (kind) => {
      const fixture = await createRevisionTwoFixture()
      const winnerPaths = candidatePaths(fixture.activation)
      await writeTrackedArtifact({
        repositoryRoot: fixture.repositoryRoot,
        repositoryPath: winnerPaths.claim,
        bytes: claimBytes(fixture.activation, fixture.signatureBytes),
        maximumBytes: 1024
      })
      const competingActivation =
        kind === 'DIFFERENT_ACTIVATION'
          ? createActivation({
              revision: 2,
              previousActivationSha256: fixture.previous.activationSha256,
              activatedAt: '2026-08-25T00:02:00.000Z',
              policySnapshotSha256: '2'.repeat(64)
            })
          : fixture.activation
      const competingSignature =
        kind === 'DIFFERENT_SIGNATURE'
          ? Buffer.from('different-owner-signature-v2', 'utf8')
          : fixture.signatureBytes
      const competingPaths = candidatePaths(competingActivation)

      await expect(
        finalizeVerifiedPolicyActivationPublication(
          {
            repositoryRoot: fixture.repositoryRoot,
            activation: competingActivation,
            activationBytes: canonicalJsonBytes(competingActivation),
            signatureBytes: competingSignature,
            terminalAnchor: {
              revision: 1,
              activationSha256: fixture.previous.activationSha256
            }
          },
          { verifyActivationChain: fakeVerifyActivationChain }
        )
      ).rejects.toThrow('TRACKED_ARTIFACT_EXISTS')

      expect(
        await readFile(path.join(fixture.repositoryRoot, winnerPaths.claim))
      ).toEqual(claimBytes(fixture.activation, fixture.signatureBytes))
      await expect(
        lstat(path.join(fixture.repositoryRoot, competingPaths.activation))
      ).rejects.toMatchObject({ code: 'ENOENT' })
      expect(
        await readFile(path.join(fixture.repositoryRoot, winnerPaths.pointer))
      ).toEqual(fixture.previousBytes)
      expect(await listTemporaryFiles(fixture.repositoryRoot)).toEqual([])
    }
  )

  it('converges after concurrent publication of the same candidate', async () => {
    const fixture = await createRevisionTwoFixture()
    const paths = candidatePaths(fixture.activation)
    const input = {
      repositoryRoot: fixture.repositoryRoot,
      activation: fixture.activation,
      activationBytes: fixture.activationBytes,
      signatureBytes: fixture.signatureBytes,
      terminalAnchor: {
        revision: 1,
        activationSha256: fixture.previous.activationSha256
      }
    }
    const dependencies = {
      verifyActivationChain: fakeVerifyActivationChain
    }

    const attempts = await Promise.allSettled([
      finalizeVerifiedPolicyActivationPublication(input, dependencies),
      finalizeVerifiedPolicyActivationPublication(input, dependencies)
    ])
    expect(
      attempts.filter(({ status }) => status === 'fulfilled').length
    ).toBeGreaterThanOrEqual(1)
    await finalizeVerifiedPolicyActivationPublication(input, dependencies)

    expect(
      await readFile(path.join(fixture.repositoryRoot, paths.claim))
    ).toEqual(claimBytes(fixture.activation, fixture.signatureBytes))
    expect(
      await readFile(path.join(fixture.repositoryRoot, paths.pointer))
    ).toEqual(fixture.activationBytes)
    expect(
      await readFile(path.join(fixture.repositoryRoot, paths.activation))
    ).toEqual(fixture.activationBytes)
    expect(
      await readFile(path.join(fixture.repositoryRoot, paths.signature))
    ).toEqual(fixture.signatureBytes)
    expect(
      (
        await readdir(path.join(fixture.repositoryRoot, paths.prefix))
      ).toSorted()
    ).toEqual(['activation.json', 'activation.owner.sshsig'])
    expect(await listTemporaryFiles(fixture.repositoryRoot)).toEqual([])
  })

  it('durably chooses one concurrent candidate and converges on retry', async () => {
    const fixture = await createRevisionTwoFixture()
    const competingActivation = createActivation({
      revision: 2,
      previousActivationSha256: fixture.previous.activationSha256,
      activatedAt: '2026-08-25T00:02:00.000Z',
      policySnapshotSha256: '2'.repeat(64)
    })
    const competingBytes = canonicalJsonBytes(competingActivation)
    const competingSignature = Buffer.from(
      'competing-owner-signature-v2',
      'utf8'
    )
    const terminalAnchor = {
      revision: 1,
      activationSha256: fixture.previous.activationSha256
    }
    const dependencies = {
      verifyActivationChain: fakeVerifyActivationChain
    }
    const attempts = await Promise.allSettled([
      finalizeVerifiedPolicyActivationPublication(
        {
          repositoryRoot: fixture.repositoryRoot,
          activation: fixture.activation,
          activationBytes: fixture.activationBytes,
          signatureBytes: fixture.signatureBytes,
          terminalAnchor
        },
        dependencies
      ),
      finalizeVerifiedPolicyActivationPublication(
        {
          repositoryRoot: fixture.repositoryRoot,
          activation: competingActivation,
          activationBytes: competingBytes,
          signatureBytes: competingSignature,
          terminalAnchor
        },
        dependencies
      )
    ])
    expect(
      attempts.filter(({ status }) => status === 'fulfilled').length
    ).toBeLessThanOrEqual(1)
    expect(
      attempts.filter(({ status }) => status === 'rejected').length
    ).toBeGreaterThanOrEqual(1)

    const claimPath = path.join(
      fixture.repositoryRoot,
      'content/policies/.activation-finalize-claims/2.json'
    )
    const actualClaim = await readFile(claimPath)
    const firstWon = actualClaim.equals(
      claimBytes(fixture.activation, fixture.signatureBytes)
    )
    const winner = firstWon
      ? {
          activation: fixture.activation,
          bytes: fixture.activationBytes,
          signature: fixture.signatureBytes
        }
      : {
          activation: competingActivation,
          bytes: competingBytes,
          signature: competingSignature
        }
    const loser = firstWon
      ? {
          activation: competingActivation,
          bytes: competingBytes,
          signature: competingSignature
        }
      : {
          activation: fixture.activation,
          bytes: fixture.activationBytes,
          signature: fixture.signatureBytes
        }
    await finalizeVerifiedPolicyActivationPublication(
      {
        repositoryRoot: fixture.repositoryRoot,
        activation: winner.activation,
        activationBytes: winner.bytes,
        signatureBytes: winner.signature,
        terminalAnchor
      },
      dependencies
    )
    await expect(
      finalizeVerifiedPolicyActivationPublication(
        {
          repositoryRoot: fixture.repositoryRoot,
          activation: loser.activation,
          activationBytes: loser.bytes,
          signatureBytes: loser.signature,
          terminalAnchor
        },
        dependencies
      )
    ).rejects.toThrow()

    const winnerPaths = candidatePaths(winner.activation)
    const loserPaths = candidatePaths(loser.activation)
    expect(
      await readFile(path.join(fixture.repositoryRoot, winnerPaths.pointer))
    ).toEqual(winner.bytes)
    expect(
      await readFile(path.join(fixture.repositoryRoot, winnerPaths.activation))
    ).toEqual(winner.bytes)
    expect(
      await readFile(path.join(fixture.repositoryRoot, winnerPaths.signature))
    ).toEqual(winner.signature)
    expect(
      (
        await readdir(path.join(fixture.repositoryRoot, winnerPaths.prefix))
      ).toSorted()
    ).toEqual(['activation.json', 'activation.owner.sshsig'])
    await expect(
      lstat(path.join(fixture.repositoryRoot, loserPaths.prefix))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listTemporaryFiles(fixture.repositoryRoot)).toEqual([])
  })
})
