import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ArtifactReadError,
  readArtifactBytes,
  readPrivateArtifactBytes
} from './artifactReader.js'
import { writeNewPrivateFile } from './privateFileWriter.js'
import {
  writeTrackedArtifact,
  writeTrackedArtifactWithTestDependencies
} from './trackedArtifactWriter.js'

const temporaryRoots: string[] = []

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(
    path.join(await realpath(os.tmpdir()), 'nihongo-content-io-')
  )
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('artifact IO v1', () => {
  it('reads regular immutable artifacts and rejects caps, modes and symlinks', async () => {
    const root = await createTemporaryRoot()
    await writeFile(path.join(root, 'artifact.json'), '{}', { mode: 0o644 })
    expect(
      await readArtifactBytes({
        repositoryRoot: root,
        filePath: 'artifact.json',
        maximumBytes: 2
      })
    ).toEqual(Buffer.from('{}'))
    await expect(
      readArtifactBytes({
        repositoryRoot: root,
        filePath: 'artifact.json',
        maximumBytes: 1
      })
    ).rejects.toMatchObject({ code: 'ARTIFACT_OVERSIZED' })
    await chmod(path.join(root, 'artifact.json'), 0o666)
    await expect(
      readArtifactBytes({
        repositoryRoot: root,
        filePath: 'artifact.json',
        maximumBytes: 2
      })
    ).rejects.toMatchObject({ code: 'ARTIFACT_UNSAFE_MODE' })
    await symlink('artifact.json', path.join(root, 'alias.json'))
    await expect(
      readArtifactBytes({
        repositoryRoot: root,
        filePath: 'alias.json',
        maximumBytes: 2
      })
    ).rejects.toBeInstanceOf(ArtifactReadError)
  })

  it('writes private outputs only to empty real 0700 parents without overwrite', async () => {
    const root = await createTemporaryRoot()
    const privateRoot = path.join(root, 'private')
    const repository = path.join(root, 'repository')
    await mkdir(privateRoot, { mode: 0o700 })
    await mkdir(repository)
    const output = path.join(privateRoot, 'payload.json')
    await writeNewPrivateFile({
      outputPath: output,
      bytes: Buffer.from('{"safe":true}'),
      maximumBytes: 1024,
      forbiddenRoot: repository
    })
    expect((await lstat(output)).mode & 0o777).toBe(0o600)
    await expect(
      writeNewPrivateFile({
        outputPath: output,
        bytes: Buffer.from('changed'),
        maximumBytes: 1024
      })
    ).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' })
    expect(await readFile(output, 'utf8')).toBe('{"safe":true}')
  })

  it('reads exact 0600 private inputs and atomically advances a tracked pointer', async () => {
    const root = await createTemporaryRoot()
    const privateRoot = path.join(root, 'private')
    const repository = path.join(root, 'repository')
    await mkdir(privateRoot, { mode: 0o700 })
    await mkdir(path.join(repository, 'content', 'policies'), {
      mode: 0o755,
      recursive: true
    })
    const privateFile = path.join(privateRoot, 'evidence.json')
    await writeFile(privateFile, '{"schemaVersion":1}', { mode: 0o600 })
    expect(
      await readPrivateArtifactBytes({
        repositoryRoot: repository,
        filePath: privateFile,
        maximumBytes: 1024
      })
    ).toEqual(Buffer.from('{"schemaVersion":1}'))

    const pointerPath = 'content/policies/release-policy-manifest.v1.json'
    const previous = Buffer.from('{"revision":1}')
    const next = Buffer.from('{"revision":2}')
    await writeTrackedArtifact({
      repositoryRoot: repository,
      repositoryPath: pointerPath,
      bytes: previous,
      maximumBytes: 1024
    })
    await writeTrackedArtifact({
      repositoryRoot: repository,
      repositoryPath: pointerPath,
      bytes: next,
      maximumBytes: 1024,
      expectedExistingBytes: previous
    })
    expect(await readFile(path.join(repository, pointerPath), 'utf8')).toBe(
      '{"revision":2}'
    )
    await expect(
      writeTrackedArtifact({
        repositoryRoot: repository,
        repositoryPath: pointerPath,
        bytes: Buffer.from('{"revision":3}'),
        maximumBytes: 1024,
        expectedExistingBytes: previous
      })
    ).rejects.toThrow()
  })

  it('restores exact predecessor bytes when post-publication validation fails', async () => {
    const root = await createTemporaryRoot()
    const repositoryPath = 'content/policies/release-policy-manifest.v1.json'
    const outputPath = path.join(root, repositoryPath)
    const previous = Buffer.from('{"revision":1}')
    const replacement = Buffer.from('{"revision":2}')
    const sameSizeTamper = Buffer.from('{"revision":9}')

    await writeTrackedArtifact({
      repositoryRoot: root,
      repositoryPath,
      bytes: previous,
      maximumBytes: 1024
    })

    await expect(
      writeTrackedArtifactWithTestDependencies(
        {
          repositoryRoot: root,
          repositoryPath,
          bytes: replacement,
          maximumBytes: 1024,
          expectedExistingBytes: previous
        },
        {
          afterReplacementPublished: async ({ rollbackPath }) => {
            await writeFile(rollbackPath, sameSizeTamper)
            throw new Error('INJECTED_POST_PUBLICATION_FAILURE')
          }
        }
      )
    ).rejects.toThrow('TRACKED_ARTIFACT_PUBLISH_FAILED')

    expect(await readFile(outputPath)).toEqual(previous)
    expect((await readdir(path.dirname(outputPath))).toSorted()).toEqual([
      path.basename(outputPath)
    ])
  })

  it('preserves a durable revision claim and rejects a competing candidate', async () => {
    const root = await createTemporaryRoot()
    const claimPath = 'content/policies/.activation-finalize-claims/2.json'
    const firstClaim = Buffer.from(
      '{"activationRevision":2,"activationSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
    )
    const competingClaim = Buffer.from(
      '{"activationRevision":2,"activationSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
    )
    await writeTrackedArtifact({
      repositoryRoot: root,
      repositoryPath: claimPath,
      bytes: firstClaim,
      maximumBytes: 1024
    })
    await writeTrackedArtifact({
      repositoryRoot: root,
      repositoryPath: claimPath,
      bytes: firstClaim,
      maximumBytes: 1024
    })
    await expect(
      writeTrackedArtifact({
        repositoryRoot: root,
        repositoryPath: claimPath,
        bytes: competingClaim,
        maximumBytes: 1024
      })
    ).rejects.toThrow('TRACKED_ARTIFACT_EXISTS')
    expect(await readFile(path.join(root, claimPath))).toEqual(firstClaim)
  })

  it('publishes exactly one no-replace writer under a concurrent race', async () => {
    const root = await createTemporaryRoot()
    const repositoryPath = 'content/policies/no-replace.json'
    const first = Buffer.from('{"candidate":"first"}')
    const second = Buffer.from('{"candidate":"other"}')

    const results = await Promise.allSettled([
      writeTrackedArtifact({
        repositoryRoot: root,
        repositoryPath,
        bytes: first,
        maximumBytes: 1024,
        expectedExistingBytes: null
      }),
      writeTrackedArtifact({
        repositoryRoot: root,
        repositoryPath,
        bytes: second,
        maximumBytes: 1024,
        expectedExistingBytes: null
      })
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1
    )
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1
    )
    const published = await readFile(path.join(root, repositoryPath))
    expect(published.equals(first) || published.equals(second)).toBe(true)
  })
})
