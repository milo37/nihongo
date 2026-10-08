import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readArtifactJson } from './artifactReader.js'
import { canonicalJsonBytes } from './canonicalHash.js'
import {
  buildLegacyPolicyArtifacts,
  verifyLegacyPolicySnapshot
} from './legacyPolicyVerifier.js'
import {
  LEGACY_LOGICAL_VALIDATOR_SOURCES,
  legacySeedSourceManifestSchema
} from './legacySchemas.js'
import { buildPolicyArtifacts } from './policyArtifacts.js'
import { WORKSPACE_PACKAGE_MANIFEST_PATHS } from './policySchemas.js'
import { verifyTrackedPolicySnapshots } from './contentCheck.js'
import { verifyPolicySnapshot } from './policyVerifier.js'
import { VALIDATOR_SOURCE_PATHS_V1 } from './sourceManifest.js'
import {
  parseSshEd25519PublicKey,
  readOpenSshVersion
} from './sshsigVerifier.js'

// Unit tests stay host-agnostic; the pinned retained image attests the exact toolchain.
vi.mock('./sshsigVerifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sshsigVerifier.js')>()
  return {
    ...actual,
    readOpenSshVersion: vi.fn(async () => 'OpenSSH_9.9p2')
  }
})

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []
const repositoryRoot = await realpath(
  fileURLToPath(new URL('../../../../../../', import.meta.url))
)
const runtimeDigest = '1'.repeat(64)
const postgresDigest =
  '9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'
const previousRuntimeDigest =
  process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256
const previousPostgresDigest = process.env.CONTENT_POSTGRES_IMAGE_SHA256

const createOwnerKey = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nihongo-policy-test-'))
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  const keyPath = path.join(root, 'owner-ed25519')
  await execFileAsync('/usr/bin/ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    '',
    '-f',
    keyPath
  ])
  const publicKey = (await readFile(`${keyPath}.pub`, 'utf8')).trimEnd()
  return {
    root,
    keyPath,
    publicKey,
    fingerprint: parseSshEd25519PublicKey(publicKey).fingerprintSha256
  }
}

const signPolicyPayload = async (
  key: Awaited<ReturnType<typeof createOwnerKey>>,
  payload: Uint8Array,
  name = 'policy-payload'
): Promise<Buffer> => {
  const payloadPath = path.join(key.root, `${name}.json`)
  await writeFile(payloadPath, payload, { mode: 0o600 })
  await execFileAsync('/usr/bin/ssh-keygen', [
    '-q',
    '-Y',
    'sign',
    '-f',
    key.keyPath,
    '-n',
    'nihongo-policy-v1',
    payloadPath
  ])
  return readFile(`${payloadPath}.sig`)
}

const createLegacyFixtureRepository = async (
  runtimeManifest: Awaited<
    ReturnType<typeof buildPolicyArtifacts>
  >['runtimeManifest']
): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nihongo-legacy-policy-'))
  temporaryRoots.push(root)
  const sourceManifest = legacySeedSourceManifestSchema.parse(
    await readArtifactJson({
      repositoryRoot,
      filePath: 'content/legacy/legacy-seed-source-manifest.v1.json',
      maximumBytes: 5 * 1024 * 1024
    })
  )
  const repositoryPaths = new Set<string>([
    'content/contributors.v1.json',
    'content/coverage/internal-beta.v1.json',
    'content/legacy/legacy-seed-source-manifest.v1.json',
    'content/legacy/legacy-seed-mapping-manifest.v1.json',
    'content/policies/original-content-policy.v1.md',
    'content/policies/policy-activation.schema.v1.json',
    'content/policies/quality-rules.v1.json',
    'content/releases/legacy-system-seed-v1/1/legacy-seed-manifest.json',
    'content/review/duplicate-review-plan.schema.v1.json',
    'content/review/release-approval-receipt.schema.v1.json',
    'content/review/review-certificate.schema.v1.json',
    'content/review/review-rubric.v1.md',
    'content/schema/content-bundle.schema.v1.json',
    'content/taxonomy/tags.v1.json',
    'pnpm-lock.yaml',
    ...WORKSPACE_PACKAGE_MANIFEST_PATHS,
    ...VALIDATOR_SOURCE_PATHS_V1,
    ...sourceManifest.files.map(({ repositoryPath }) => repositoryPath),
    ...LEGACY_LOGICAL_VALIDATOR_SOURCES.map(
      ({ repositoryPath }) => repositoryPath
    )
  ])
  for (const repositoryPath of repositoryPaths) {
    const target = path.join(root, repositoryPath)
    await mkdir(path.dirname(target), { mode: 0o755, recursive: true })
    await writeFile(
      target,
      await readFile(path.join(repositoryRoot, repositoryPath)),
      { mode: 0o644 }
    )
  }
  const runtimeManifestPath = path.join(
    root,
    'content/runtime/validator-runtime-manifest.v1.json'
  )
  await mkdir(path.dirname(runtimeManifestPath), {
    mode: 0o755,
    recursive: true
  })
  await writeFile(runtimeManifestPath, canonicalJsonBytes(runtimeManifest), {
    mode: 0o644
  })
  return root
}

afterEach(async () => {
  if (previousRuntimeDigest === undefined) {
    delete process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256
  } else {
    process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256 =
      previousRuntimeDigest
  }
  if (previousPostgresDigest === undefined) {
    delete process.env.CONTENT_POSTGRES_IMAGE_SHA256
  } else {
    process.env.CONTENT_POSTGRES_IMAGE_SHA256 = previousPostgresDigest
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('Phase 6 Slice 1 owner-signed policy snapshot', () => {
  it('verifies the exact canonical snapshot, runtime and owner namespace', async () => {
    const owner = await createOwnerKey()
    const built = await buildPolicyArtifacts({
      repositoryRoot,
      runtimeImageIndexSha256: runtimeDigest,
      postgresImageSha256: postgresDigest,
      rootKeyFingerprintSha256: owner.fingerprint
    })
    const signature = await signPolicyPayload(
      owner,
      built.ownerSignaturePayloadBytes
    )
    process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256 = runtimeDigest
    process.env.CONTENT_POSTGRES_IMAGE_SHA256 = postgresDigest

    await expect(
      verifyPolicySnapshot({
        repositoryRoot,
        snapshotBytes: built.snapshotBytes,
        signature,
        ownerPublicKey: owner.publicKey,
        expectedRootFingerprintSha256: owner.fingerprint,
        expectedPolicySnapshotSha256: built.policySnapshotSha256
      })
    ).resolves.toMatchObject({
      policySnapshotSha256: built.policySnapshotSha256,
      runtimeManifest: built.runtimeManifest,
      sourceManifest: built.sourceManifest
    })

    vi.mocked(readOpenSshVersion).mockResolvedValueOnce('OpenSSH_0.0')
    await expect(
      verifyPolicySnapshot({
        repositoryRoot,
        snapshotBytes: built.snapshotBytes,
        signature,
        ownerPublicKey: owner.publicKey,
        expectedRootFingerprintSha256: owner.fingerprint,
        expectedPolicySnapshotSha256: built.policySnapshotSha256
      })
    ).rejects.toMatchObject({ code: 'POLICY_RUNTIME_DRIFT' })

    await expect(
      verifyPolicySnapshot({
        repositoryRoot,
        snapshotBytes: Buffer.concat([built.snapshotBytes, Buffer.from('\n')]),
        signature,
        ownerPublicKey: owner.publicKey,
        expectedRootFingerprintSha256: owner.fingerprint,
        expectedPolicySnapshotSha256: built.policySnapshotSha256
      })
    ).rejects.toMatchObject({ code: 'POLICY_CONTENT_INVALID' })
  }, 30_000)

  it('verifies the owner-signed legacy policy and detects retained source drift', async () => {
    const owner = await createOwnerKey()
    const normal = await buildPolicyArtifacts({
      repositoryRoot,
      runtimeImageIndexSha256: runtimeDigest,
      postgresImageSha256: postgresDigest,
      rootKeyFingerprintSha256: owner.fingerprint
    })
    const fixtureRepository = await createLegacyFixtureRepository(
      normal.runtimeManifest
    )
    const built = await buildLegacyPolicyArtifacts({
      repositoryRoot: fixtureRepository,
      rootKeyFingerprintSha256: owner.fingerprint
    })
    const [normalSignature, signature] = await Promise.all([
      signPolicyPayload(
        owner,
        normal.ownerSignaturePayloadBytes,
        'normal-policy-payload'
      ),
      signPolicyPayload(
        owner,
        built.ownerSignaturePayloadBytes,
        'legacy-policy-payload'
      )
    ])
    const trackedArtifacts = new Map<string, Uint8Array>([
      [
        'content/trust/policy-owner-root.v1.pub',
        Buffer.from(`${owner.publicKey}\n`, 'utf8')
      ],
      [
        `content/policy-snapshots/${normal.policySnapshotSha256}.json`,
        normal.snapshotBytes
      ],
      [
        `content/policy-snapshots/${normal.policySnapshotSha256}.owner.sshsig`,
        normalSignature
      ],
      [
        `content/policy-snapshots/${built.policySnapshotSha256}.json`,
        built.snapshotBytes
      ],
      [
        `content/policy-snapshots/${built.policySnapshotSha256}.owner.sshsig`,
        signature
      ]
    ])
    for (const [repositoryPath, bytes] of trackedArtifacts) {
      const target = path.join(fixtureRepository, repositoryPath)
      await mkdir(path.dirname(target), { mode: 0o755, recursive: true })
      await writeFile(target, bytes, { mode: 0o644 })
    }
    process.env.CONTENT_VALIDATOR_RUNTIME_IMAGE_INDEX_SHA256 = runtimeDigest
    process.env.CONTENT_POSTGRES_IMAGE_SHA256 = postgresDigest

    await expect(
      verifyLegacyPolicySnapshot({
        repositoryRoot: fixtureRepository,
        snapshotBytes: built.snapshotBytes,
        signature,
        ownerPublicKey: owner.publicKey,
        expectedRootFingerprintSha256: owner.fingerprint,
        expectedPolicySnapshotSha256: built.policySnapshotSha256
      })
    ).resolves.toMatchObject({
      policySnapshotSha256: built.policySnapshotSha256,
      runtimeManifest: normal.runtimeManifest
    })
    await expect(
      verifyTrackedPolicySnapshots({
        repositoryRoot: fixtureRepository,
        rootKeyFingerprintSha256: owner.fingerprint
      })
    ).resolves.toSatisfy(
      ({ normal: normalSnapshots, legacy: legacySnapshots }) =>
        normalSnapshots.size === 1 && legacySnapshots.size === 1
    )

    const driftPath = path.join(
      fixtureRepository,
      LEGACY_LOGICAL_VALIDATOR_SOURCES[0].repositoryPath
    )
    const originalSourceBytes = await readFile(driftPath)
    await writeFile(
      driftPath,
      Buffer.concat([originalSourceBytes, Buffer.from('\n')]),
      { mode: 0o644 }
    )
    await expect(
      verifyLegacyPolicySnapshot({
        repositoryRoot: fixtureRepository,
        snapshotBytes: built.snapshotBytes,
        signature,
        ownerPublicKey: owner.publicKey,
        expectedRootFingerprintSha256: owner.fingerprint,
        expectedPolicySnapshotSha256: built.policySnapshotSha256
      })
    ).rejects.toMatchObject({ code: 'POLICY_SOURCE_DRIFT' })
    await writeFile(driftPath, originalSourceBytes, { mode: 0o644 })
    await unlink(
      path.join(
        fixtureRepository,
        `content/policy-snapshots/${built.policySnapshotSha256}.owner.sshsig`
      )
    )
    await expect(
      verifyTrackedPolicySnapshots({
        repositoryRoot: fixtureRepository,
        rootKeyFingerprintSha256: owner.fingerprint
      })
    ).rejects.toThrow('POLICY_SNAPSHOT_PAIR_MISSING')
  }, 30_000)
})
